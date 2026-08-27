// @vitest-environment node

import { describe, expect, test, vi } from 'vitest';

import { onRequestPost as estimateRoute } from '../../functions/api/nutrition/text/estimate';
import { onRequestPost as loginRoute } from '../../functions/api/nutrition/text/login';
import { onRequestPost as logoutRoute } from '../../functions/api/nutrition/text/logout';
import { onRequestGet as sessionRoute } from '../../functions/api/nutrition/text/session';
import {
  textAiEstimateInFlightFixture,
  textAiEstimateSuccessFixture,
  textAiFailureFixture,
  textAiSessionSuccessFixture,
} from '../../src/test/textAiFixtures';
import {
  TEXT_SESSION_COOKIE,
  authenticateTextAccessCode,
  issueTextSession,
  parseTextAuthConfig,
} from './auth';
import {
  authorizeTextAiPagesRequest,
  proxyTextAiRequest,
  textAiPagesFailure,
  textAiPagesJson,
  type TextAiPagesEnv,
} from './pagesProxy';

const ORIGIN = 'https://app.example.test';
const ACCOUNT_KEY = 'a'.repeat(64);
const USER_1_CODE = 'A'.repeat(32);
const USER_2_CODE = 'B'.repeat(32);

function env(fetcher?: Fetcher['fetch']): TextAiPagesEnv {
  return {
    PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
    PHOTO_AI_ACCOUNT_HMAC_KEY: 'a'.repeat(32),
    PHOTO_AI_ALLOWED_ORIGINS: ORIGIN,
    TEXT_AI_ACCESS_AUD: 'legacy-user-audience',
    TEXT_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com',
    TEXT_AI_ALLOWED_EMAIL_COUNT: '2',
    TEXT_AI_ADMIN_ACCESS_AUD: 'legacy-admin-audience',
    TEXT_AI_ADMIN_EMAIL: 'alice@example.com',
    TEXT_AI_ADMIN_SERVICE_CLIENT_ID: 'text-preview-admin.access',
    TEXT_AI_ADMIN_SIGNING_KEY: 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ',
    TEXT_AI_USER_1_ACCESS_CODE_PEPPER: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
    TEXT_AI_USER_1_ACCESS_CODE_DIGEST: '36beb527ff694b5a0e5d86f3e2c987a2b44ba8c7153fd6fd04107a2260bec302',
    TEXT_AI_USER_2_ACCESS_CODE_PEPPER: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU',
    TEXT_AI_USER_2_ACCESS_CODE_DIGEST: 'ab3efc3483e04a785d3bddc5d796c2508630e095bfad4de07f9fc345e5577dae',
    TEXT_AI_SESSION_SIGNING_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
    TEXT_AI_RATE_LIMIT_HMAC_KEY: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM',
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

function sameOriginHeaders(cookie?: string): HeadersInit {
  return {
    ...(cookie === undefined ? {} : { cookie }),
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
  };
}

async function sessionCookie(code = USER_1_CODE, routeEnv = env()): Promise<string> {
  const config = parseTextAuthConfig(routeEnv);
  const identity = await authenticateTextAccessCode(code, config);
  const token = await issueTextSession(identity, config);
  return `${TEXT_SESSION_COOKIE}=${token}`;
}

function context(request: Request, routeEnv: TextAiPagesEnv): Parameters<typeof sessionRoute>[0] {
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

});

describe('text AI Pages authorization', () => {
  test('validates the closed route before attempting session verification', async () => {
    await expect(authorizeTextAiPagesRequest(
      new Request(`${ORIGIN}/api/nutrition/text/session`, {
        headers: {
          'sec-fetch-site': 'same-origin',
        },
      }),
      env(),
      ['estimate'],
    )).rejects.toThrow('Invalid Pages route');
  });

  test('returns only the HMAC account key, fixed origin and validated route', async () => {
    const cookie = await sessionCookie();
    const authorized = await authorizeTextAiPagesRequest(
      new Request(`${ORIGIN}/api/nutrition/text/session`, {
        headers: {
          cookie,
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

  test.each([USER_1_CODE, USER_2_CODE])(
    'allows one configured access-code account to reach the private binding',
    async (code) => {
      const gatewayFetch = vi.fn(async () => json(textAiSessionSuccessFixture));
      const routeEnv = env(gatewayFetch);

      const response = await sessionRoute(context(
        new Request(`${ORIGIN}/api/nutrition/text/session`, {
          headers: {
            cookie: await sessionCookie(code, routeEnv),
            'sec-fetch-site': 'same-origin',
          },
        }),
        routeEnv,
      ));

      expect(response.status).toBe(200);
      expect(gatewayFetch).toHaveBeenCalledTimes(1);
    },
  );

  test('rejects a Cloudflare Access assertion when the session cookie is absent', async () => {
    const gatewayFetch = vi.fn();

    const response = await sessionRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/session`, {
        headers: {
          'cf-access-jwt-assertion': 'valid-only-for-the-removed-access-layer',
          'sec-fetch-site': 'same-origin',
        },
      }),
      env(gatewayFetch),
    ));

    expect(response.status).toBe(401);
    expect(gatewayFetch).not.toHaveBeenCalled();
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
        'x-private-token': 'private-access-token',
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
        'x-private-token': 'private-access-token',
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
    ['terminal gateway failure', textAiFailureFixture, 503],
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
  ])('maps an indeterminate downstream %s response to a fixed empty transport failure', async (
    _case,
    downstream,
  ) => {
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
    expect(response.status).toBe(502);
    expect(serialized).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(serialized).not.toMatch(/private stack|photo-request-001/);
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
  test('serves only the exact session route and rejects the removed resume query', async () => {
    const gatewayFetch = vi.fn(async () => json(textAiSessionSuccessFixture));
    const routeEnv = env(gatewayFetch);
    const cookie = await sessionCookie(USER_1_CODE, routeEnv);
    const sessionResponse = await sessionRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/session`, {
        headers: {
          cookie,
          'sec-fetch-site': 'same-origin',
        },
      }),
      routeEnv,
    ));
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toEqual(textAiSessionSuccessFixture);
    expectSecure(sessionResponse);

    const resumeResponse = await sessionRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/session?resume=1`, {
        headers: { cookie, 'sec-fetch-site': 'same-origin' },
      }),
      routeEnv,
    ));
    expect(resumeResponse.status).toBe(401);
    expect(await resumeResponse.json()).toEqual({
      ok: false,
      code: 'auth-required',
      retryAt: null,
      resetAt: null,
    });
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expectSecure(resumeResponse);
  });

  test('exposes the access-code login Function and sets the session cookie only after clear', async () => {
    const actions: string[] = [];
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const action = request.headers.get('x-tiezheng-auth-action');
      if (action !== null) actions.push(action);
      return action === 'clear'
        ? new Response(null, { status: 204 })
        : json({ kind: 'allowed' });
    });
    const response = await loginRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/login`, {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.7',
          'content-type': 'application/json',
          origin: ORIGIN,
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ accessCode: USER_1_CODE }),
      }),
      env(gatewayFetch),
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toContain(`${TEXT_SESSION_COOKIE}=`);
    expect(actions).toEqual(['consume', 'clear']);
    expectSecure(response);
  });

  test('serves only estimate and keeps a safe proxy failure distinct from auth failure', async () => {
    const gatewayFetch = vi.fn(async () => new Response('private downstream body', {
      status: 500,
      headers: { 'content-type': 'text/plain' },
    }));
    const routeEnv = env(gatewayFetch);
    const response = await estimateRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/estimate`, {
        method: 'POST',
        headers: {
          ...sameOriginHeaders(await sessionCookie(USER_1_CODE, routeEnv)),
          'content-type': 'application/json',
        },
        body: '{}',
      }),
      routeEnv,
    ));
    const serialized = await response.text();

    expect(response.status).toBe(502);
    expect(serialized).toBe('');
    expect(serialized).not.toContain('private downstream body');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  test.each([undefined, `${TEXT_SESSION_COOKIE}=corrupted`])(
    'clears logout with a missing or invalid session and never calls the gateway',
    async (cookie) => {
    const gatewayFetch = vi.fn();
    const response = await logoutRoute(context(
      new Request(`${ORIGIN}/api/nutrition/text/logout`, {
        method: 'POST',
        headers: sameOriginHeaders(cookie),
      }),
      env(gatewayFetch),
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toBe(
      `${TEXT_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`,
    );
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
    },
  );

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
          ? {
            ...sameOriginHeaders(`${TEXT_SESSION_COOKIE}=private-invalid-jwt`),
            'content-type': 'application/json',
          }
          : {
            'cf-access-jwt-assertion': 'removed-access-token',
            'sec-fetch-site': 'same-origin',
          },
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
    expect(serialized).not.toMatch(/private-invalid-jwt|removed-access-token|private gateway detail/);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expectSecure(response);
  });
});
