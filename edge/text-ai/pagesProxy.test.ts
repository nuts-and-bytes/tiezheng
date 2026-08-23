import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { onRequestPost as estimateRoute } from '../../functions/api/nutrition/text/estimate';
import { onRequestPost as logoutRoute } from '../../functions/api/nutrition/text/logout';
import { onRequestGet as sessionRoute } from '../../functions/api/nutrition/text/session';
import {
  textAiEstimateInFlightFixture,
  textAiEstimateSuccessFixture,
  textAiFailureFixture,
  textAiSessionSuccessFixture,
} from '../../src/test/textAiFixtures';
import {
  authorizeTextAiPagesRequest,
  proxyTextAiRequest,
  textAiPagesFailure,
  textAiPagesJson,
  textAiPagesResumeRedirect,
} from './pagesProxy';
import type { PhotoAiPagesEnv } from '../photo-ai/pagesProxy';

const ORIGIN = 'https://app.example.test';
const ISSUER = 'https://team-alpha.cloudflareaccess.com';
const AUDIENCE = 'photo-ai-audience';
const ACCOUNT_KEY = 'a'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'text-pages-route-test-key';

function env(fetcher?: Fetcher['fetch']): PhotoAiPagesEnv {
  return {
    PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
    PHOTO_AI_ACCESS_AUD: AUDIENCE,
    PHOTO_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com,carol@example.com',
    PHOTO_AI_ACCOUNT_HMAC_KEY: '0123456789abcdef0123456789abcdef',
    PHOTO_AI_ALLOWED_ORIGINS: ORIGIN,
    PHOTO_AI_GATEWAY: fetcher === undefined ? undefined : { fetch: fetcher } as Fetcher,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function headerRecord(init?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function expectSecure(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

function base64Url(value: Record<string, unknown>): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function token(email = 'alice@example.com'): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = base64Url({ alg: 'RS256', kid: jwk.kid });
  const payload = base64Url({
    aud: AUDIENCE,
    email,
    exp: now + 300,
    iat: now,
    iss: ISSUER,
    nbf: now - 1,
    sub: 'text-user-123',
  });
  const input = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  return `${input}.${base64UrlBytes(signer.sign(privateKey))}`;
}

function installJwks(): ReturnType<typeof vi.fn<typeof fetch>> {
  const authFetch = vi.fn<typeof fetch>(async () => json({ keys: [jwk] }));
  vi.stubGlobal('fetch', authFetch);
  return authFetch;
}

function sameOriginHeaders(accessToken = token()): HeadersInit {
  return {
    'cf-access-jwt-assertion': accessToken,
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
  };
}

function context(request: Request, routeEnv: PhotoAiPagesEnv): Parameters<typeof sessionRoute>[0] {
  return {
    request,
    env: routeEnv,
    params: {},
    data: {},
    functionPath: '',
    waitUntil: vi.fn(),
    next: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as Parameters<typeof sessionRoute>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('text AI Pages response helpers', () => {
  test('adds the fixed security headers to success and failure JSON', async () => {
    const success = textAiPagesJson({ ok: true }, 200);
    const failure = textAiPagesFailure('provider-unavailable', 503);

    expect(await success.json()).toEqual({ ok: true });
    expect(await failure.json()).toEqual({
      ok: false,
      code: 'provider-unavailable',
      retryAt: null,
      resetAt: null,
    });
    expectSecure(success);
    expectSecure(failure);
  });

  test('builds only the fixed same-origin text resume URL', () => {
    const response = textAiPagesResumeRedirect(ORIGIN);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/health?textAi=resume`);
    expectSecure(response);
  });
});

describe('text AI Pages authorization', () => {
  test('validates the closed route before attempting Access verification', async () => {
    const authFetch = installJwks();
    await expect(authorizeTextAiPagesRequest(
      new Request(`${ORIGIN}/api/nutrition/text/session`, {
        headers: {
          'cf-access-jwt-assertion': token(),
          'sec-fetch-site': 'same-origin',
        },
      }),
      env(),
      ['estimate'],
    )).rejects.toThrow('Invalid Pages route');
    expect(authFetch).not.toHaveBeenCalled();
  });

  test('returns only the HMAC account key, fixed origin and validated route', async () => {
    installJwks();
    const authorized = await authorizeTextAiPagesRequest(
      new Request(`${ORIGIN}/api/nutrition/text/session`, {
        headers: {
          'cf-access-jwt-assertion': token(),
          'sec-fetch-site': 'same-origin',
        },
      }),
      env(),
      ['session'],
    );

    expect(authorized).toEqual({
      accountKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      origin: ORIGIN,
      route: 'session',
    });
  });
});

describe('text AI Pages service proxy', () => {
  test.each([true, {}, { fetch: 'not-a-function' }])(
    'fails closed before consuming the body for an invalid binding %#',
    async (gateway) => {
      const routeEnv = env();
      routeEnv.PHOTO_AI_GATEWAY = gateway as unknown as Fetcher;
      const source = new Request(`${ORIGIN}/api/nutrition/text/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"private":"meal"}',
      });

      const response = await proxyTextAiRequest(source, routeEnv, ACCOUNT_KEY, 'estimate');

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        code: 'service-disabled',
        retryAt: null,
        resetAt: null,
      });
      expect(source.bodyUsed).toBe(false);
      expectSecure(response);
    },
  );

  test('maps an invalid account key to the fixed provider failure without a fetch', async () => {
    const fetcher = vi.fn();
    const response = await proxyTextAiRequest(
      new Request(`${ORIGIN}/api/nutrition/text/session`),
      env(fetcher),
      'not-an-account',
      'session',
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'provider-unavailable',
      retryAt: null,
      resetAt: null,
    });
    expectSecure(response);
  });

  test('uses the fixed text session target and strips every caller header', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://photo-ai-gateway.internal/text/session');
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(headerRecord(init?.headers)).toEqual({
        'x-tiezheng-account-key': ACCOUNT_KEY,
      });
      return json(textAiSessionSuccessFixture);
    });
    const request = new Request(`${ORIGIN}/api/nutrition/text/session?target=https://evil.test`, {
      headers: {
        authorization: 'private-authorization',
        cookie: 'private-cookie',
        'cf-access-jwt-assertion': 'private-access-token',
        origin: ORIGIN,
        'sec-fetch-site': 'same-origin',
        'x-private-description': 'private meal',
      },
    });

    const response = await proxyTextAiRequest(request, env(fetcher), ACCOUNT_KEY, 'session');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(textAiSessionSuccessFixture);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expectSecure(response);
  });

  test('copies JSON once and sends the actual byte length to the fixed text estimate target', async () => {
    const source = new Request(`${ORIGIN}/api/nutrition/text/estimate?target=https://evil.test`, {
      method: 'POST',
      headers: {
        authorization: 'private-authorization',
        'cf-access-jwt-assertion': 'private-access-token',
        'content-length': '1',
        'content-type': 'application/json',
        cookie: 'private-cookie',
        origin: ORIGIN,
        'sec-fetch-site': 'same-origin',
      },
      body: '{}',
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://photo-ai-gateway.internal/text/estimate');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(Uint8Array);
      expect(init?.body).not.toBe(source.body);
      expect(await new Response(init?.body).text()).toBe('{}');
      expect(headerRecord(init?.headers)).toEqual({
        'content-length': '2',
        'content-type': 'application/json',
        'x-tiezheng-account-key': ACCOUNT_KEY,
      });
      return json(textAiEstimateSuccessFixture);
    });

    const response = await proxyTextAiRequest(source, env(fetcher), ACCOUNT_KEY, 'estimate');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(textAiEstimateSuccessFixture);
    expect(source.bodyUsed).toBe(true);
    expectSecure(response);
  });

  test.each([
    ['in-flight', textAiEstimateInFlightFixture, 202],
    ['conflict', { ...textAiFailureFixture, code: 'idempotency-conflict', retryAt: null }, 409],
    ['rate limit', { ...textAiFailureFixture, code: 'rate-limited' }, 429],
  ])('preserves an approved %s response and status', async (_case, body, status) => {
    const fetcher = vi.fn(async () => json(body, status));
    const response = await proxyTextAiRequest(
      new Request(`${ORIGIN}/api/nutrition/text/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      env(fetcher),
      ACCOUNT_KEY,
      'estimate',
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expectSecure(response);
  });

  test.each([
    ['HTML', new Response('<h1>private stack</h1>', { status: 500, headers: { 'content-type': 'text/html' } })],
    ['invalid schema', json({ stack: 'private stack' }, 500)],
    ['status mismatch', json(textAiEstimateSuccessFixture, 201)],
    ['photo schema', json({ ...textAiEstimateSuccessFixture, requestId: 'photo-request-001' })],
  ])('maps an invalid downstream %s response without leaking it', async (_case, downstream) => {
    const fetcher = vi.fn(async () => downstream);
    const response = await proxyTextAiRequest(
      new Request(`${ORIGIN}/api/nutrition/text/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      env(fetcher),
      ACCOUNT_KEY,
      'estimate',
    );

    const serialized = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      code: 'provider-unavailable',
      retryAt: null,
      resetAt: null,
    });
    expect(serialized).not.toMatch(/private stack|photo-request-001/);
    expectSecure(response);
  });

  test('does not accept a photo multipart request on the text estimate wrapper', async () => {
    const fetcher = vi.fn();
    const response = await proxyTextAiRequest(
      new Request(`${ORIGIN}/api/nutrition/text/estimate`, {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=a' },
        body: 'private-image',
      }),
      env(fetcher),
      ACCOUNT_KEY,
      'estimate',
    );

    const serialized = await response.text();
    expect(response.status).toBe(503);
    expect(serialized).not.toContain('private-image');
    expect(fetcher).not.toHaveBeenCalled();
    expectSecure(response);
  });
});

describe('text AI Pages Function routes', () => {
  test('serves session and resume only from the session Function', async () => {
    installJwks();
    const gatewayFetch = vi.fn(async () => json(textAiSessionSuccessFixture));
    const sessionResponse = await sessionRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/session`, {
        headers: {
          'cf-access-jwt-assertion': token(),
          'sec-fetch-site': 'same-origin',
        },
      }),
      env(gatewayFetch),
    ));
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toEqual(textAiSessionSuccessFixture);
    expectSecure(sessionResponse);

    const resumeResponse = await sessionRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/session?resume=1`, {
        headers: { 'cf-access-jwt-assertion': token() },
      }),
      env(gatewayFetch),
    ));
    expect(resumeResponse.status).toBe(302);
    expect(resumeResponse.headers.get('location')).toBe(`${ORIGIN}/health?textAi=resume`);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expectSecure(resumeResponse);
  });

  test('serves only estimate and keeps a safe proxy failure distinct from auth failure', async () => {
    installJwks();
    const gatewayFetch = vi.fn(async () => new Response('private downstream body', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    }));
    const response = await estimateRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/estimate`, {
        method: 'POST',
        headers: {
          ...sameOriginHeaders(),
          'content-type': 'application/json',
        },
        body: '{}',
      }),
      env(gatewayFetch),
    ));
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      code: 'provider-unavailable',
      retryAt: null,
      resetAt: null,
    });
    expect(serialized).not.toContain('private downstream body');
    expectSecure(response);
  });

  test('serves only logout and never calls the gateway', async () => {
    installJwks();
    const gatewayFetch = vi.fn();
    const response = await logoutRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/logout`, {
        method: 'POST',
        headers: sameOriginHeaders(),
      }),
      env(gatewayFetch),
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ logoutUrl: '/cdn-cgi/access/logout' });
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });

  test.each([
    ['session missing JWT', sessionRoute, `${ORIGIN}/api/nutrition/text/session`, 'GET'],
    ['session wrong route', sessionRoute, `${ORIGIN}/api/nutrition/text/logout`, 'POST'],
    ['estimate wrong route', estimateRoute, `${ORIGIN}/api/nutrition/text/session`, 'GET'],
    ['logout wrong route', logoutRoute, `${ORIGIN}/api/nutrition/text/estimate`, 'POST'],
  ])('normalizes %s to auth-required without an Access or gateway leak', async (
    _case,
    route,
    url,
    method,
  ) => {
    const gatewayFetch = vi.fn(async () => {
      throw new Error('private gateway detail');
    });
    const response = await route(context(
      new Request(url, {
        method,
        headers: method === 'POST'
          ? { ...sameOriginHeaders('private-invalid-jwt'), 'content-type': 'application/json' }
          : { 'sec-fetch-site': 'same-origin' },
        body: method === 'POST' && url.endsWith('/estimate') ? '{}' : undefined,
      }),
      env(gatewayFetch),
    ));
    const serialized = await response.text();

    expect(response.status).toBe(401);
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      code: 'auth-required',
      retryAt: null,
      resetAt: null,
    });
    expect(serialized).not.toMatch(/private-invalid-jwt|private gateway detail/);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });
});
