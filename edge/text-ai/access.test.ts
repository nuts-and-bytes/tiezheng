import { createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { AccessDeniedError } from '../photo-ai/access';
import {
  parseTextAdminAccessConfig,
  parseTextUserAccessConfig,
  verifyTextAdminAccess,
  type TextAccessEnv,
} from './access';

const issuer = 'https://team-alpha.cloudflareaccess.com';
const userAudience = 'text-user-audience';
const adminAudience = 'text-admin-audience';
const serviceClientId = 'text-preview-admin.access';
const baseEnv: TextAccessEnv = {
  PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
  PHOTO_AI_ACCOUNT_HMAC_KEY: '0123456789abcdef0123456789abcdef',
  TEXT_AI_ACCESS_AUD: userAudience,
  TEXT_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
  TEXT_AI_ALLOWED_EMAIL_COUNT: '2',
  TEXT_AI_ADMIN_ACCESS_AUD: adminAudience,
  TEXT_AI_ADMIN_EMAIL: 'alice@example.com',
  TEXT_AI_ADMIN_SERVICE_CLIENT_ID: serviceClientId,
};

async function fixture(tokenIssuer = issuer) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = 'text-access-test-key';
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), {
    headers: { 'content-type': 'application/json' },
  });
  const sign = async (
    claims: Record<string, unknown>,
    options: { aud?: string; exp?: number; withoutExpiry?: boolean } = {},
  ) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      ...claims,
      iss: tokenIssuer,
      aud: options.aud ?? adminAudience,
      iat: now,
      nbf: now - 1,
    } as Record<string, unknown>;
    if (!options.withoutExpiry) payload.exp = options.exp ?? now + 300;
    const input = `${base64Url({ alg: 'RS256', kid: 'text-access-test-key' })}.${base64Url(payload)}`;
    const signer = createSign('RSA-SHA256');
    signer.update(input);
    return `${input}.${base64UrlBytes(signer.sign(privateKey))}`;
  };
  return { fetcher, sign };
}

function base64Url(value: Record<string, unknown>): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function request(token: string) {
  return new Request('https://app.example.test/api/nutrition/text/admin', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });
}

describe('text access configuration', () => {
  test('exposes only the dedicated text user and administrator fields', () => {
    expectTypeOf<TextAccessEnv>().toEqualTypeOf<{
      PHOTO_AI_TEAM_DOMAIN: string;
      PHOTO_AI_ACCOUNT_HMAC_KEY: string;
      TEXT_AI_ACCESS_AUD: string;
      TEXT_AI_ALLOWED_EMAILS: string;
      TEXT_AI_ALLOWED_EMAIL_COUNT: string;
      TEXT_AI_ADMIN_ACCESS_AUD: string;
      TEXT_AI_ADMIN_EMAIL: string;
      TEXT_AI_ADMIN_SERVICE_CLIENT_ID: string;
    }>();
  });

  test('accepts the current exact two-user profile and one administrator in that list', () => {
    const userConfig = parseTextUserAccessConfig(baseEnv);
    const adminConfig = parseTextAdminAccessConfig(baseEnv);

    expect(userConfig).toMatchObject({
      issuer,
      audience: userAudience,
      accountHmacSecret: baseEnv.PHOTO_AI_ACCOUNT_HMAC_KEY,
    });
    expect([...userConfig.allowedEmails]).toEqual(['alice@example.com', 'bob@example.com']);
    expect(adminConfig).toMatchObject({
      issuer,
      audience: adminAudience,
      adminEmail: 'alice@example.com',
      serviceClientId,
    });
  });

  test('rejects an administrator outside the text-user allowlist', () => {
    expect(() => parseTextAdminAccessConfig({
      ...baseEnv,
      TEXT_AI_ADMIN_EMAIL: 'carol@example.com',
    })).toThrow('Access denied');
  });

  test.each(['1', '02', ' 2', '3 ', '4'])(
    'rejects unsupported user-count string %s',
    (TEXT_AI_ALLOWED_EMAIL_COUNT) => {
      expect(() => parseTextUserAccessConfig({
        ...baseEnv,
        TEXT_AI_ALLOWED_EMAIL_COUNT,
      })).toThrow('Access denied');
    },
  );

  test.each([
    ['2', 'alice@example.com,bob@example.com,carol@example.com'],
    ['3', 'alice@example.com,bob@example.com'],
  ])('requires count %s to match its allowlist exactly', (TEXT_AI_ALLOWED_EMAIL_COUNT, TEXT_AI_ALLOWED_EMAILS) => {
    expect(() => parseTextUserAccessConfig({
      ...baseEnv,
      TEXT_AI_ALLOWED_EMAIL_COUNT,
      TEXT_AI_ALLOWED_EMAILS,
    })).toThrow('Access denied');
  });

  test('supports a future third distinct valid text user', () => {
    const config = parseTextUserAccessConfig({
      ...baseEnv,
      TEXT_AI_ALLOWED_EMAIL_COUNT: '3',
      TEXT_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com,carol@example.com',
    });

    expect([...config.allowedEmails]).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);
  });
});

describe('verifyTextAdminAccess', () => {
  test('accepts only the configured administrator user or official service-token principal', async () => {
    const { fetcher, sign } = await fixture();
    const config = parseTextAdminAccessConfig(baseEnv);
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const adminUser = await sign({ sub: 'admin-subject', email: 'Alice@Example.Com' }, { exp: expiresAt });
    const service = await sign({ sub: '', common_name: serviceClientId }, { exp: expiresAt });
    const ordinaryUser = await sign({ sub: 'ordinary-subject', email: 'bob@example.com' });

    await expect(verifyTextAdminAccess(request(adminUser), config, fetcher)).resolves.toEqual({
      kind: 'user',
      email: 'alice@example.com',
      expiresAt,
    });
    await expect(verifyTextAdminAccess(request(service), config, fetcher)).resolves.toEqual({
      kind: 'service',
      clientId: serviceClientId,
      expiresAt,
    });
    await expect(verifyTextAdminAccess(request(ordinaryUser), config, fetcher)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  test('rejects invalid service-token identity, audience, claim shape, or expiry', async () => {
    const { fetcher, sign } = await fixture();
    const config = parseTextAdminAccessConfig(baseEnv);
    const wrongAudience = await sign({ sub: '', common_name: serviceClientId }, { aud: userAudience });
    const wrongCommonName = await sign({ sub: '', common_name: 'other-client.access' });
    const nonEmptySub = await sign({ sub: 'service-subject', common_name: serviceClientId });
    const missingSub = await sign({ common_name: serviceClientId });
    const mixedIdentity = await sign({
      sub: '',
      email: 'alice@example.com',
      common_name: serviceClientId,
    });
    const missingExpiry = await sign(
      { sub: '', common_name: serviceClientId },
      { withoutExpiry: true },
    );

    for (const token of [wrongAudience, wrongCommonName, nonEmptySub, missingSub, mixedIdentity, missingExpiry]) {
      await expect(verifyTextAdminAccess(request(token), config, fetcher)).rejects.toBeInstanceOf(AccessDeniedError);
    }
  });
});
