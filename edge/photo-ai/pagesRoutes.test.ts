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

function headerRecord(init?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('photo AI Pages routes', () => {
  test('keeps identity, health and provider details out of logs, network metadata and failure JSON', async () => {
    const accessToken = token();
    const forbidden = [
      accessToken,
      'user-123',
      'alice@example.com',
      '203.0.113.7',
      'data:image/webp;base64,UklGRg==',
      'private-food-name',
      'private-preparation',
      'private-assumption',
      '2026-08-21',
      'dinner',
      '88kg',
      'private-goal',
      '0123456789abcdef0123456789abcdef',
      'private-ark-key',
      'private-aes-key',
      'provider-private-body',
      'private-system-prompt',
      'private-json-schema',
    ];
    const networkInputs: Array<{ url: string; headers: Record<string, string> }> = [];
    const authFetch = vi.fn<typeof fetch>(async (input, init) => {
      networkInputs.push({ url: String(input), headers: headerRecord(init?.headers) });
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', authFetch);
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      networkInputs.push({ url: String(input), headers: headerRecord(init?.headers) });
      return new Response(JSON.stringify({
        stack: forbidden.join('|'),
        prompt: 'private-system-prompt',
        schema: 'private-json-schema',
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new Request(`${ORIGIN}/api/nutrition/photo/session`, {
      headers: {
        ...sameOriginHeaders(accessToken),
        'cf-connecting-ip': '203.0.113.7',
        'x-food-name': 'private-food-name',
        'x-preparation': 'private-preparation',
        'x-assumption': 'private-assumption',
        'x-meal-date': '2026-08-21',
        'x-meal-slot': 'dinner',
        'x-weight': '88kg',
        'x-goal': 'private-goal',
        'x-image': 'data:image/webp;base64,UklGRg==',
      },
    });

    const response = await session(context(request, env(gatewayFetch)));
    const serializedResponse = await response.text();
    const audit = JSON.stringify({
      consoleLog: consoleLog.mock.calls,
      consoleError: consoleError.mock.calls,
      networkInputs,
      response: serializedResponse,
    });

    expect(response.status).toBe(503);
    expect(JSON.parse(serializedResponse)).toEqual({
      ok: false,
      code: 'provider-unavailable',
      retryAt: null,
      resetAt: null,
    });
    expect(networkInputs).toEqual([
      {
        url: `${ISSUER}/cdn-cgi/access/certs`,
        headers: { accept: 'application/json, application/jwk-set+json' },
      },
      {
        url: 'https://photo-ai-gateway.internal/session',
        headers: { 'x-tiezheng-account-key': '8870f376de268ea42aabb3bae207e1696f98f0952560e9fc087579dc59dcbd97' },
      },
    ]);
    for (const value of forbidden) expect(audit).not.toContain(value);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('keeps an estimate upload private to the fixed service binding when the service fails', async () => {
    const accessToken = token();
    const riffWebp = `RIFF${String.fromCharCode(16, 0, 0, 0)}WEBPprivate-image-bytes`;
    const uploadSecrets = [
      riffWebp,
      'sha-input-private-bytes',
      'private-food-name',
      'private-preparation',
      'private-assumption',
      '2026-08-21',
      'dinner',
      '88kg',
      'private-goal',
    ];
    const forbidden = [
      ...uploadSecrets,
      accessToken,
      'user-123',
      'alice@example.com',
      '203.0.113.7',
      '0123456789abcdef0123456789abcdef',
      'provider-private-body',
      'private-system-prompt',
      'private-json-schema',
    ];
    const uploadBytes = new TextEncoder().encode(uploadSecrets.join('|'));
    const externalInputs: Array<{ url: string; headers: Record<string, string> }> = [];
    const privateInputs: Array<{ url: string; headers: Record<string, string> }> = [];
    let approvedPrivateBody = '';
    const authFetch = vi.fn<typeof fetch>(async (input, init) => {
      externalInputs.push({ url: String(input), headers: headerRecord(init?.headers) });
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', authFetch);
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      privateInputs.push({ url: String(input), headers: headerRecord(init?.headers) });
      approvedPrivateBody = await new Response(init?.body).text();
      return new Response(JSON.stringify({
        stack: forbidden.join('|'),
        prompt: 'private-system-prompt',
        schema: 'private-json-schema',
      }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = new Request(`${ORIGIN}/api/nutrition/photo/estimate`, {
      method: 'POST',
      headers: {
        ...sameOriginHeaders(accessToken),
        'cf-connecting-ip': '203.0.113.7',
        'content-length': String(uploadBytes.byteLength),
        'content-type': 'multipart/form-data; boundary=audit',
      },
      body: uploadBytes,
    });

    const response = await estimate(context(request, env(gatewayFetch)));
    const serializedResponse = await response.text();
    const unapprovedAudit = JSON.stringify({
      consoleLog: consoleLog.mock.calls,
      consoleError: consoleError.mock.calls,
      externalInputs,
      privateMetadata: privateInputs,
      response: serializedResponse,
    });

    expect(response.status).toBe(503);
    expect(JSON.parse(serializedResponse)).toEqual({
      ok: false,
      code: 'provider-unavailable',
      retryAt: null,
      resetAt: null,
    });
    expect(externalInputs).toEqual([{
      url: `${ISSUER}/cdn-cgi/access/certs`,
      headers: { accept: 'application/json, application/jwk-set+json' },
    }]);
    expect(privateInputs).toEqual([{
      url: 'https://photo-ai-gateway.internal/estimate',
      headers: {
        'content-length': String(uploadBytes.byteLength),
        'content-type': 'multipart/form-data; boundary=audit',
        'x-tiezheng-account-key': '8870f376de268ea42aabb3bae207e1696f98f0952560e9fc087579dc59dcbd97',
      },
    }]);
    for (const value of uploadSecrets) expect(approvedPrivateBody).toContain(value);
    for (const value of forbidden) expect(unapprovedAudit).not.toContain(value);
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test('authenticates an ordinary same-origin session GET without an Origin header', async () => {
    installJwks();
    const gatewayFetch = vi.fn(async () => new Response(
      JSON.stringify(photoAiSessionSuccessFixture),
      { headers: { 'content-type': 'application/json' } },
    ));
    const request = new Request(`${ORIGIN}/api/nutrition/photo/session`, {
      headers: {
        'cf-access-jwt-assertion': token(),
        'sec-fetch-site': 'same-origin',
      },
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
