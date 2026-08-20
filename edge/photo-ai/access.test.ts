import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { AccessDeniedError, parseAccessConfig, verifyAccess, type AccessConfig, type AccessEnv } from './access';

const issuer = 'https://team-alpha.cloudflareaccess.com';
const audience = 'photo-ai-audience';
const baseEnv: AccessEnv = {
  PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
  PHOTO_AI_ACCESS_AUD: audience,
  PHOTO_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com,carol@example.com',
  PHOTO_AI_ACCOUNT_HMAC_KEY: '0123456789abcdef0123456789abcdef',
};

async function fixture(tokenIssuer = issuer) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'test-key';
  const requestedUrls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
  };
  const sign = async (claims: Record<string, unknown> = {}, options: { alg?: string; aud?: string; exp?: number; iss?: string; nbf?: number; withoutExpiry?: boolean } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { ...claims, iss: options.iss ?? tokenIssuer, aud: options.aud ?? audience, iat: now, nbf: options.nbf ?? now - 1 } as Record<string, unknown>;
    if (!options.withoutExpiry) payload.exp = options.exp ?? now + 300;
    const input = `${base64Url({ alg: options.alg ?? 'RS256', kid: 'test-key' })}.${base64Url(payload)}`;
    const signer = createSign('RSA-SHA256');
    signer.update(input);
    const signature = base64UrlBytes(signer.sign(privateKey));
    return `${input}.${signature}`;
  };
  return { fetcher, privateKey, requestedUrls, sign };
}

function base64Url(value: Record<string, unknown>): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function request(token?: string) {
  return new Request('https://app.example.test/api/nutrition/photo/session', {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  });
}

describe('parseAccessConfig', () => {
  test('accepts exactly three distinct lowercase emails and a safe team slug', () => {
    const config = parseAccessConfig(baseEnv);
    expect(config.issuer).toBe(issuer);
    expect(Object.keys(config).sort()).toEqual(['accountHmacSecret', 'allowedEmails', 'audience', 'issuer']);
    expectTypeOf<AccessConfig>().toEqualTypeOf<{
      issuer: string;
      audience: string;
      allowedEmails: ReadonlySet<string>;
      accountHmacSecret: string;
    }>();
  });

  test.each([
    [{ ...baseEnv, PHOTO_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com' }],
    [{ ...baseEnv, PHOTO_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com,alice@example.com' }],
    [{ ...baseEnv, PHOTO_AI_ALLOWED_EMAILS: 'Alice@example.com,bob@example.com,carol@example.com' }],
    [{ ...baseEnv, PHOTO_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example,carol@example.com' }],
    [{ ...baseEnv, PHOTO_AI_TEAM_DOMAIN: 'https://evil.example' }],
    [{ ...baseEnv, PHOTO_AI_TEAM_DOMAIN: 'team-alpha.evil.example' }],
    [{ ...baseEnv, PHOTO_AI_TEAM_DOMAIN: 'team-alpha/path' }],
    [{ ...baseEnv, PHOTO_AI_TEAM_DOMAIN: 'team-alpha?x=1' }],
    [{ ...baseEnv, PHOTO_AI_TEAM_DOMAIN: 'user@team-alpha' }],
    [{ ...baseEnv, PHOTO_AI_ACCESS_AUD: '' }],
    [{ ...baseEnv, PHOTO_AI_ACCOUNT_HMAC_KEY: 'too-short' }],
  ])('rejects unsafe Access configuration', (env) => {
    expect(() => parseAccessConfig(env)).toThrow();
  });
});

describe('verifyAccess', () => {
  test('returns only a stable HMAC account key and expiry for a permitted mixed-case email', async () => {
    const { fetcher, requestedUrls, sign } = await fixture();
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const token = await sign({ sub: 'user-123', email: 'Alice@Example.Com' }, { exp: expiresAt });

    await expect(verifyAccess(request(token), parseAccessConfig(baseEnv), fetcher)).resolves.toEqual({
      accountKey: '8870f376de268ea42aabb3bae207e1696f98f0952560e9fc087579dc59dcbd97',
      expiresAt,
    });
    expect(requestedUrls).toEqual([`${issuer}/cdn-cgi/access/certs`]);
  });

  test.each([
    ['missing token', undefined],
    ['malformed token', 'not-a-jwt'],
  ])('rejects a %s', async (_name, token) => {
    await expect(verifyAccess(request(token), parseAccessConfig(baseEnv), (async () => new Response()) as typeof fetch)).rejects.toThrow();
  });

  test('rejects wrong algorithm, signature, issuer, audience, time and identity claims', async () => {
    const { fetcher, sign } = await fixture();
    const config = parseAccessConfig(baseEnv);
    const now = Math.floor(Date.now() / 1000);
    const wrongAlgorithm = await sign({ sub: 'user', email: 'alice@example.com' }, { alg: 'HS256' });
    const wrongSignature = `${await sign({ sub: 'user', email: 'alice@example.com' })}x`;
    const wrongIssuer = await sign({ sub: 'user', email: 'alice@example.com' }, { iss: 'https://other.cloudflareaccess.com' });
    const wrongAudience = await sign({ sub: 'user', email: 'alice@example.com' }, { aud: 'other-audience' });
    const expired = await sign({ sub: 'user', email: 'alice@example.com' }, { exp: now - 31 });
    const notYetValid = await sign({ sub: 'user', email: 'alice@example.com' }, { nbf: now + 31 });
    const missingSub = await sign({ email: 'alice@example.com' });
    const missingEmail = await sign({ sub: 'user' });
    const nonStringSub = await sign({ sub: 1, email: 'alice@example.com' });
    const nonStringEmail = await sign({ sub: 'user', email: ['alice@example.com'] });
    const missingExpiry = await sign({ sub: 'user', email: 'alice@example.com' }, { withoutExpiry: true });

    for (const token of [wrongAlgorithm, wrongSignature, wrongIssuer, wrongAudience, expired, notYetValid, missingSub, missingEmail, nonStringSub, nonStringEmail, missingExpiry]) {
      await expect(verifyAccess(request(token), config, fetcher)).rejects.toThrow();
    }
  });

  test('rejects a valid token for an email outside the allowlist', async () => {
    const { fetcher, sign } = await fixture();
    await expect(verifyAccess(request(await sign({ sub: 'user', email: 'mallory@example.com' })), parseAccessConfig(baseEnv), fetcher)).rejects.toThrow();
  });

  test('reuses one remote JWKS fetch for sequential and concurrent valid tokens', async () => {
    const { fetcher, requestedUrls, sign } = await fixture();
    const config = parseAccessConfig(baseEnv);
    const [first, second, third] = await Promise.all([
      sign({ sub: 'first', email: 'alice@example.com' }),
      sign({ sub: 'second', email: 'alice@example.com' }),
      sign({ sub: 'third', email: 'alice@example.com' }),
    ]);

    await Promise.all([
      verifyAccess(request(first), config, fetcher),
      verifyAccess(request(second), config, fetcher),
    ]);
    expect(requestedUrls).toEqual([`${issuer}/cdn-cgi/access/certs`]);

    await verifyAccess(request(third), config, fetcher);
    expect(requestedUrls).toEqual([`${issuer}/cdn-cgi/access/certs`]);
  });

  test('isolates remote key sets by fetcher identity and certificate URL', async () => {
    const first = await fixture();
    const second = await fixture();
    const alphaConfig = parseAccessConfig(baseEnv);
    await expect(verifyAccess(request(await first.sign({ sub: 'first', email: 'alice@example.com' })), alphaConfig, first.fetcher)).resolves.toEqual(expect.any(Object));
    await expect(verifyAccess(request(await second.sign({ sub: 'second', email: 'alice@example.com' })), alphaConfig, second.fetcher)).resolves.toEqual(expect.any(Object));
    expect(first.requestedUrls).toHaveLength(1);
    expect(second.requestedUrls).toHaveLength(1);

    const betaIssuer = 'https://team-beta.cloudflareaccess.com';
    const beta = await fixture(betaIssuer);
    const multiplexedFetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      return url.startsWith(betaIssuer) ? beta.fetcher(input, init) : first.fetcher(input, init);
    };
    const betaConfig = parseAccessConfig({ ...baseEnv, PHOTO_AI_TEAM_DOMAIN: 'team-beta' });
    await expect(verifyAccess(request(await first.sign({ sub: 'alpha-multiplexed', email: 'alice@example.com' })), alphaConfig, multiplexedFetcher)).resolves.toEqual(expect.any(Object));
    await expect(verifyAccess(request(await beta.sign({ sub: 'beta', email: 'alice@example.com' })), betaConfig, multiplexedFetcher)).resolves.toEqual(expect.any(Object));
    expect(first.requestedUrls).toHaveLength(2);
    expect(beta.requestedUrls).toEqual([`${betaIssuer}/cdn-cgi/access/certs`]);
  });

  test('fails before fetching when a caller supplies an untrusted issuer', async () => {
    const { fetcher, requestedUrls, sign } = await fixture();
    const config = { ...parseAccessConfig(baseEnv), issuer: 'https://evil.example' };
    await expect(verifyAccess(request(await sign({ sub: 'user', email: 'alice@example.com' })), config, fetcher)).rejects.toBeInstanceOf(AccessDeniedError);
    expect(requestedUrls).toEqual([]);
  });

  test.each([
    ['a rejected JWKS fetch', (async () => Promise.reject(new Error('network diagnostic'))) as typeof fetch],
    ['a non-success JWKS response', (async () => new Response('upstream detail', { status: 503 })) as typeof fetch],
    ['an empty JWKS response', (async () => new Response(JSON.stringify({ keys: [] }), { headers: { 'content-type': 'application/json' } })) as typeof fetch],
  ])('fails closed without leaking details for %s', async (_name, fetcher) => {
    const { sign } = await fixture();
    try {
      await verifyAccess(request(await sign({ sub: 'user', email: 'alice@example.com' })), parseAccessConfig(baseEnv), fetcher);
      throw new Error('expected Access denial');
    } catch (error) {
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect((error as Error).message).toBe('Access denied');
    }
  });
});
