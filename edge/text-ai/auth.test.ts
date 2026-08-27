// @vitest-environment node

import {
  SignJWT,
  decodeJwt,
  decodeProtectedHeader,
  type JWTHeaderParameters,
} from 'jose';
import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  TEXT_SESSION_COOKIE,
  TEXT_SESSION_SECONDS,
  authenticateTextAccessCode,
  clearTextSessionCookie,
  deriveTextAttemptKey,
  digestTextAccessCode,
  issueTextSession,
  parseTextAuthConfig,
  textSessionCookie,
  verifyTextSession,
  type TextAuthConfig,
  type TextAuthEnv,
  type TextIdentity,
} from './auth';

const USER_1_CODE = 'A'.repeat(32);
const USER_2_CODE = 'B'.repeat(32);
const USER_1_PEPPER = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const USER_2_PEPPER = 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU';
const SESSION_KEY = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';
const RATE_LIMIT_KEY = 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM';
const ROTATED_USER_1_PEPPER = 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ';
const NOW_MS = 1_777_777_777_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

async function validEnv(): Promise<TextAuthEnv> {
  return {
    PHOTO_AI_ACCOUNT_HMAC_KEY: 'a'.repeat(32),
    TEXT_AI_USER_1_ACCESS_CODE_PEPPER: USER_1_PEPPER,
    TEXT_AI_USER_1_ACCESS_CODE_DIGEST: await digestTextAccessCode(
      USER_1_CODE,
      decodeBase64Url(USER_1_PEPPER),
    ),
    TEXT_AI_USER_2_ACCESS_CODE_PEPPER: USER_2_PEPPER,
    TEXT_AI_USER_2_ACCESS_CODE_DIGEST: await digestTextAccessCode(
      USER_2_CODE,
      decodeBase64Url(USER_2_PEPPER),
    ),
    TEXT_AI_SESSION_SIGNING_KEY: SESSION_KEY,
    TEXT_AI_RATE_LIMIT_HMAC_KEY: RATE_LIMIT_KEY,
  };
}

async function configured(): Promise<TextAuthConfig> {
  return parseTextAuthConfig(await validEnv());
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = `${value.replace(/-/g, '+').replace(/_/g, '/')}=`;
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function cookieRequest(token: string, cookieName = TEXT_SESSION_COOKIE): Request {
  return new Request('https://text-ai-preview.tiezheng.pages.dev/', {
    headers: { cookie: `${cookieName}=${token}` },
  });
}

async function signClaims(
  payload: Record<string, unknown>,
  protectedHeader: JWTHeaderParameters = { alg: 'HS256', typ: 'JWT' },
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader(protectedHeader)
    .sign(decodeBase64Url(SESSION_KEY));
}

describe('text access-code configuration', () => {
  test('exposes only the fixed access-code authentication environment', () => {
    expectTypeOf<TextAuthEnv>().toEqualTypeOf<{
      PHOTO_AI_ACCOUNT_HMAC_KEY: string;
      TEXT_AI_USER_1_ACCESS_CODE_PEPPER: string;
      TEXT_AI_USER_1_ACCESS_CODE_DIGEST: string;
      TEXT_AI_USER_2_ACCESS_CODE_PEPPER: string;
      TEXT_AI_USER_2_ACCESS_CODE_DIGEST: string;
      TEXT_AI_SESSION_SIGNING_KEY: string;
      TEXT_AI_RATE_LIMIT_HMAC_KEY: string;
    }>();
  });

  test('parses distinct canonical keys and digests without retaining access codes', async () => {
    const config = parseTextAuthConfig(await validEnv());

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.keys(config).sort()).toEqual([
      'accountHmacSecret',
      'rateLimitHmacKey',
      'sessionSigningKey',
      'user1AccessCodeDigest',
      'user1AccessCodePepper',
      'user2AccessCodeDigest',
      'user2AccessCodePepper',
    ]);
    expect(JSON.stringify(config)).not.toContain(USER_1_CODE);
    expect(JSON.stringify(config)).not.toContain(USER_2_CODE);
  });

  test('rejects duplicate digests, duplicate keys, and noncanonical key material', async () => {
    const env = await validEnv();
    const invalid = [
      { ...env, TEXT_AI_USER_2_ACCESS_CODE_DIGEST: env.TEXT_AI_USER_1_ACCESS_CODE_DIGEST },
      { ...env, TEXT_AI_USER_2_ACCESS_CODE_PEPPER: env.TEXT_AI_USER_1_ACCESS_CODE_PEPPER },
      { ...env, TEXT_AI_SESSION_SIGNING_KEY: env.TEXT_AI_USER_1_ACCESS_CODE_PEPPER },
      { ...env, TEXT_AI_RATE_LIMIT_HMAC_KEY: env.TEXT_AI_SESSION_SIGNING_KEY },
      { ...env, TEXT_AI_USER_1_ACCESS_CODE_PEPPER: `${USER_1_PEPPER}=` },
      { ...env, TEXT_AI_USER_1_ACCESS_CODE_DIGEST: env.TEXT_AI_USER_1_ACCESS_CODE_DIGEST.toUpperCase() },
      { ...env, PHOTO_AI_ACCOUNT_HMAC_KEY: 'too-short' },
    ];

    for (const value of invalid) expect(() => parseTextAuthConfig(value)).toThrow('Access denied');
  });

  test('does not invoke accessors or read required configuration through the prototype', async () => {
    const env = await validEnv();
    let getterCalls = 0;
    const accessor = { ...env };
    Object.defineProperty(accessor, 'TEXT_AI_SESSION_SIGNING_KEY', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return SESSION_KEY;
      },
    });

    expect(() => parseTextAuthConfig(accessor)).toThrow('Access denied');
    expect(getterCalls).toBe(0);
    expect(() => parseTextAuthConfig(Object.create(env) as TextAuthEnv)).toThrow('Access denied');
  });
});

describe('access-code digest and identity', () => {
  test('matches fixed HMAC-SHA-256 vectors', async () => {
    await expect(digestTextAccessCode(USER_1_CODE, decodeBase64Url(USER_1_PEPPER)))
      .resolves.toBe('36beb527ff694b5a0e5d86f3e2c987a2b44ba8c7153fd6fd04107a2260bec302');
    await expect(digestTextAccessCode(USER_2_CODE, decodeBase64Url(USER_2_PEPPER)))
      .resolves.toBe('ab3efc3483e04a785d3bddc5d796c2508630e095bfad4de07f9fc345e5577dae');
  });

  test.each([
    '',
    'A'.repeat(31),
    'A'.repeat(33),
    ` ${'A'.repeat(31)}`,
    `${'A'.repeat(31)}=`,
    `密${'A'.repeat(31)}`,
  ])('rejects a noncanonical access code %j', async (accessCode) => {
    await expect(digestTextAccessCode(accessCode, decodeBase64Url(USER_1_PEPPER)))
      .rejects.toThrow('Access denied');
  });

  test('authenticates each code to a distinct opaque account and credential version', async () => {
    const config = await configured();
    const first = await authenticateTextAccessCode(USER_1_CODE, config);
    const second = await authenticateTextAccessCode(USER_2_CODE, config);

    expect(first).toMatchObject({
      slot: 'user-1',
      accountKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      credentialVersion: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(second).toMatchObject({
      slot: 'user-2',
      accountKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      credentialVersion: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(first.accountKey).not.toBe(second.accountKey);
    expect(first.credentialVersion).not.toBe(second.credentialVersion);
    expect(Object.isFrozen(first)).toBe(true);
    expectTypeOf(first).toEqualTypeOf<TextIdentity>();
  });

  test('rejects an unknown or whitespace-normalized code', async () => {
    const config = await configured();
    await expect(authenticateTextAccessCode('C'.repeat(32), config)).rejects.toThrow('Access denied');
    await expect(authenticateTextAccessCode(` ${'A'.repeat(31)}`, config)).rejects.toThrow('Access denied');
  });
});

describe('30-day text session JWT', () => {
  test('issues only the fixed HS256 header and complete exact claims', async () => {
    const config = await configured();
    const identity = await authenticateTextAccessCode(USER_1_CODE, config);
    const token = await issueTextSession(identity, config, NOW_MS);

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decodeJwt(token)).toEqual({
      aud: 'tiezheng-text-ai-preview',
      cv: identity.credentialVersion,
      exp: NOW_SECONDS + TEXT_SESSION_SECONDS,
      iat: NOW_SECONDS,
      iss: 'tiezheng-text-ai',
      sub: 'user-1',
    });
    await expect(verifyTextSession(cookieRequest(token), config, NOW_MS + 1_000))
      .resolves.toEqual(identity);
  });

  test('rejects missing or drifted claims, unsafe lifetime, and non-HS256 headers', async () => {
    const config = await configured();
    const identity = await authenticateTextAccessCode(USER_1_CODE, config);
    const base = {
      aud: 'tiezheng-text-ai-preview',
      cv: identity.credentialVersion,
      exp: NOW_SECONDS + TEXT_SESSION_SECONDS,
      iat: NOW_SECONDS,
      iss: 'tiezheng-text-ai',
      sub: 'user-1',
    };
    const { cv: _cv, ...withoutCv } = base;
    const invalidClaims = [
      withoutCv,
      { ...base, iss: 'other-issuer' },
      { ...base, aud: ['tiezheng-text-ai-preview'] },
      { ...base, sub: 'user-3' },
      { ...base, iat: NOW_SECONDS + 1, exp: NOW_SECONDS + TEXT_SESSION_SECONDS },
      { ...base, exp: NOW_SECONDS + TEXT_SESSION_SECONDS + 1 },
      { ...base, cv: 'x'.repeat(43) },
      { ...base, extra: true },
    ];

    for (const claims of invalidClaims) {
      const token = await signClaims(claims);
      await expect(verifyTextSession(cookieRequest(token), config, NOW_MS)).rejects.toThrow('Access denied');
    }

    const wrongType = await signClaims(base, { alg: 'HS256', typ: 'jwt' });
    const extraHeader = await signClaims(base, { alg: 'HS256', kid: 'unexpected', typ: 'JWT' });
    const wrongAlgorithm = await new SignJWT(base)
      .setProtectedHeader({ alg: 'HS384', typ: 'JWT' })
      .sign(decodeBase64Url(SESSION_KEY));
    for (const token of [wrongType, extraHeader, wrongAlgorithm]) {
      await expect(verifyTextSession(cookieRequest(token), config, NOW_MS)).rejects.toThrow('Access denied');
    }
  });

  test('rotating one account pepper and digest invalidates only that account JWT', async () => {
    const env = await validEnv();
    const original = parseTextAuthConfig(env);
    const first = await authenticateTextAccessCode(USER_1_CODE, original);
    const second = await authenticateTextAccessCode(USER_2_CODE, original);
    const firstToken = await issueTextSession(first, original, NOW_MS);
    const secondToken = await issueTextSession(second, original, NOW_MS);
    const rotatedCode = 'C'.repeat(32);
    const rotated = parseTextAuthConfig({
      ...env,
      TEXT_AI_USER_1_ACCESS_CODE_PEPPER: ROTATED_USER_1_PEPPER,
      TEXT_AI_USER_1_ACCESS_CODE_DIGEST: await digestTextAccessCode(
        rotatedCode,
        decodeBase64Url(ROTATED_USER_1_PEPPER),
      ),
    });

    await expect(verifyTextSession(cookieRequest(firstToken), rotated, NOW_MS + 1_000))
      .rejects.toThrow('Access denied');
    await expect(verifyTextSession(cookieRequest(secondToken), rotated, NOW_MS + 1_000))
      .resolves.toEqual(second);
    await expect(authenticateTextAccessCode(rotatedCode, rotated)).resolves.toMatchObject({ slot: 'user-1' });
  });
});

describe('session Cookie and login attempt key', () => {
  test('uses one host-only secure strict HttpOnly Cookie and an exact clearing Cookie', async () => {
    const config = await configured();
    const identity = await authenticateTextAccessCode(USER_1_CODE, config);
    const token = await issueTextSession(identity, config, NOW_MS);

    expect(textSessionCookie(token)).toBe(
      `${TEXT_SESSION_COOKIE}=${token}; Max-Age=${TEXT_SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`,
    );
    expect(clearTextSessionCookie()).toBe(
      `${TEXT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`,
    );
  });

  test('rejects a missing, duplicate, wrong-name, oversized, or noncanonical Cookie token', async () => {
    const config = await configured();
    const identity = await authenticateTextAccessCode(USER_1_CODE, config);
    const token = await issueTextSession(identity, config, NOW_MS);
    const invalidRequests = [
      new Request('https://text-ai-preview.tiezheng.pages.dev/'),
      cookieRequest(token, 'other-session'),
      new Request('https://text-ai-preview.tiezheng.pages.dev/', {
        headers: { cookie: `${TEXT_SESSION_COOKIE}=${token}; ${TEXT_SESSION_COOKIE}=${token}` },
      }),
      cookieRequest('a'.repeat(4_097)),
      cookieRequest(`${token}=`),
    ];

    for (const request of invalidRequests) {
      await expect(verifyTextSession(request, config, NOW_MS + 1_000)).rejects.toThrow('Access denied');
    }
  });

  test('blinds IP addresses and collapses missing or malformed values into one anonymous bucket', async () => {
    const config = await configured();
    const first = await deriveTextAttemptKey('203.0.113.10', config);
    const second = await deriveTextAttemptKey('203.0.113.11', config);
    const missing = await deriveTextAttemptKey(null, config);
    const malformed = await deriveTextAttemptKey(' 203.0.113.10', config);

    expect(first).toEqual({ attemptKey: expect.stringMatching(/^[a-f0-9]{64}$/), anonymous: false });
    expect(second.attemptKey).not.toBe(first.attemptKey);
    expect(first.attemptKey).not.toContain('203.0.113.10');
    expect(missing).toEqual({ attemptKey: expect.stringMatching(/^[a-f0-9]{64}$/), anonymous: true });
    expect(malformed).toEqual(missing);
  });
});
