import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { onRequestPost as estimate } from '../../functions/api/nutrition/photo/estimate';
import { onRequestPost as logout } from '../../functions/api/nutrition/photo/logout';
import { onRequestGet as session } from '../../functions/api/nutrition/photo/session';
import routes from '../../public/_routes.json';
import {
  photoAiEstimateSuccessFixture,
  photoAiSessionSuccessFixture,
} from '../../src/test/photoAiFixtures';
import type { PhotoAiPagesEnv } from './pagesProxy';

const ORIGIN = 'https://app.example.test';
const ISSUER = 'https://team-alpha.cloudflareaccess.com';
const AUDIENCE = 'photo-ai-audience';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'pages-route-test-key';

function base64Url(value: Record<string, unknown>): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function token(email = 'alice@example.com'): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url({ alg: 'RS256', kid: jwk.kid });
  const payload = base64Url({
    aud: AUDIENCE,
    email,
    exp: now + 300,
    iat: now,
    iss: ISSUER,
    nbf: now - 1,
    sub: 'user-123',
  });
  const input = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  return `${input}.${base64UrlBytes(signer.sign(privateKey))}`;
}

function installJwks(): ReturnType<typeof vi.fn<typeof fetch>> {
  const authFetch = vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify({ keys: [jwk] }),
    { headers: { 'content-type': 'application/json' } },
  ));
  vi.stubGlobal('fetch', authFetch);
  return authFetch;
}

function env(gatewayFetch?: Fetcher['fetch']): PhotoAiPagesEnv {
  return {
    PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
    PHOTO_AI_ACCESS_AUD: AUDIENCE,
    PHOTO_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com,carol@example.com',
    PHOTO_AI_ACCOUNT_HMAC_KEY: '0123456789abcdef0123456789abcdef',
    PHOTO_AI_ALLOWED_ORIGINS: ORIGIN,
    PHOTO_AI_GATEWAY: gatewayFetch === undefined
      ? undefined
      : { fetch: gatewayFetch } as Fetcher,
  };
}

function sameOriginHeaders(accessToken = token()): HeadersInit {
  return {
    'cf-access-jwt-assertion': accessToken,
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
  };
}

function context(request: Request, routeEnv: PhotoAiPagesEnv): Parameters<typeof session>[0] {
  return {
    request,
    env: routeEnv,
    params: {},
    data: {},
    functionPath: '',
    waitUntil: vi.fn(),
    next: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as Parameters<typeof session>[0];
}

function expectSecure(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('photo AI Pages routes', () => {
  test('authenticates a session request and returns the private service JSON', async () => {
    installJwks();
    const gatewayFetch = vi.fn(async () => new Response(
      JSON.stringify(photoAiSessionSuccessFixture),
      { headers: { 'content-type': 'application/json' } },
    ));
    const request = new Request(`${ORIGIN}/api/nutrition/photo/session`, {
      headers: sameOriginHeaders(),
    });

    const response = await session(context(request, env(gatewayFetch)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(photoAiSessionSuccessFixture);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expectSecure(response);
  });

  test('resumes only to the fixed same-origin health URL and never calls the service', async () => {
    installJwks();
    const gatewayFetch = vi.fn();
    const request = new Request(`${ORIGIN}/api/nutrition/photo/session?resume=1`, {
      headers: { 'cf-access-jwt-assertion': token() },
    });

    const response = await session(context(request, env(gatewayFetch)));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/health?photoAi=resume`);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('does not read or reflect a caller-controlled return URL', async () => {
    const authFetch = installJwks();
    const gatewayFetch = vi.fn();
    const request = new Request(
      `${ORIGIN}/api/nutrition/photo/session?resume=1&return=https://evil.test/private`,
      { headers: { 'cf-access-jwt-assertion': token() } },
    );

    const response = await session(context(request, env(gatewayFetch)));

    expect(response.status).toBe(401);
    const serialized = await response.text();
    expect(serialized).not.toContain('evil.test');
    expect(response.headers.get('location')).toBeNull();
    expect(authFetch).not.toHaveBeenCalled();
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('returns the fixed logout URL after auth without touching the service', async () => {
    installJwks();
    const gatewayFetch = vi.fn();
    const request = new Request(`${ORIGIN}/api/nutrition/photo/logout`, {
      method: 'POST',
      headers: sameOriginHeaders(),
    });

    const response = await logout(context(request, env(gatewayFetch)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ logoutUrl: '/cdn-cgi/access/logout' });
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('authenticates and streams an estimate request to the private service', async () => {
    installJwks();
    const gatewayFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(await new Response(init?.body).text()).toBe('abc');
      return new Response(
        JSON.stringify(photoAiEstimateSuccessFixture),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const request = new Request(`${ORIGIN}/api/nutrition/photo/estimate`, {
      method: 'POST',
      headers: {
        ...sameOriginHeaders(),
        'content-length': '3',
        'content-type': 'multipart/form-data; boundary=a',
      },
      body: 'abc',
    });

    const response = await estimate(context(request, env(gatewayFetch)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(photoAiEstimateSuccessFixture);
    expect(request.bodyUsed).toBe(true);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expectSecure(response);
  });

  test.each([
    ['missing JWT', undefined, ORIGIN, 'same-origin'],
    ['wrong allowlist', token('mallory@example.com'), ORIGIN, 'same-origin'],
    ['wrong origin', token(), 'https://evil.test', 'cross-site'],
  ])('rejects %s before calling the private service', async (_case, accessToken, origin, site) => {
    installJwks();
    const gatewayFetch = vi.fn();
    const headers: Record<string, string> = {
      origin,
      'sec-fetch-site': site,
    };
    if (accessToken !== undefined) headers['cf-access-jwt-assertion'] = accessToken;
    const response = await session(context(
      new Request(`${ORIGIN}/api/nutrition/photo/session`, { headers }),
      env(gatewayFetch),
    ));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'auth-required',
      retryAt: null,
      resetAt: null,
    });
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('fails closed after authentication when the service binding is absent', async () => {
    installJwks();
    const response = await session(context(
      new Request(`${ORIGIN}/api/nutrition/photo/session`, { headers: sameOriginHeaders() }),
      env(),
    ));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expectSecure(response);
  });

  test('routes only the photo API families through Pages Functions', () => {
    expect(routes).toEqual({
      version: 1,
      include: [
        '/api/nutrition/photo/*',
        '/api/nutrition/photo-admin/*',
      ],
      exclude: [],
    });
    expect(routes.include).not.toContain('/*');
  });
});
