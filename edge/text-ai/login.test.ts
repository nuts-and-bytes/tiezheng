// @vitest-environment node

import { describe, expect, test, vi } from 'vitest';

import {
  TEXT_SESSION_COOKIE,
  type TextAuthEnv,
} from './auth';
import {
  handleTextLoginRequest,
} from './login';
import type { TextAiPagesEnv } from './pagesProxy';

const ORIGIN = 'https://app.example.test';
const LOGIN_URL = `${ORIGIN}/api/nutrition/text/login`;
const THROTTLE_URL = 'https://photo-ai-gateway.internal/internal/text-auth-attempt';
const USER_1_CODE = 'A'.repeat(32);
const UNKNOWN_CODE = 'Z'.repeat(32);
const RAW_IP = '203.0.113.7';
const NOW_MS = Date.UTC(2026, 7, 27, 9, 0, 0);

const AUTH_ENV: TextAuthEnv = Object.freeze({
  PHOTO_AI_ACCOUNT_HMAC_KEY: 'a'.repeat(32),
  TEXT_AI_USER_1_ACCESS_CODE_PEPPER: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  TEXT_AI_USER_1_ACCESS_CODE_DIGEST: '36beb527ff694b5a0e5d86f3e2c987a2b44ba8c7153fd6fd04107a2260bec302',
  TEXT_AI_USER_2_ACCESS_CODE_PEPPER: 'BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU',
  TEXT_AI_USER_2_ACCESS_CODE_DIGEST: 'ab3efc3483e04a785d3bddc5d796c2508630e095bfad4de07f9fc345e5577dae',
  TEXT_AI_SESSION_SIGNING_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
  TEXT_AI_RATE_LIMIT_HMAC_KEY: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM',
});

function throttleJson(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });
}

function harness(options: {
  clear?: () => Response | Promise<Response>;
  consume?: () => Response | Promise<Response>;
  includeBinding?: boolean;
} = {}) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const action = request.headers.get('x-tiezheng-auth-action');
    if (action === 'clear') return options.clear?.() ?? new Response(null, { status: 204 });
    return options.consume?.() ?? throttleJson({ kind: 'allowed' });
  });
  const env = {
    ...AUTH_ENV,
    PHOTO_AI_ALLOWED_ORIGINS: ORIGIN,
    TEXT_AI_ADMIN_SIGNING_KEY: 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ',
    ...(options.includeBinding === false
      ? {}
      : { PHOTO_AI_GATEWAY: { fetch } as unknown as Fetcher }),
  } as unknown as TextAiPagesEnv;
  return { env, fetch, requests };
}

function loginRequest(
  body: string,
  headers: HeadersInit = {},
): Request {
  return new Request(LOGIN_URL, {
    method: 'POST',
    headers: {
      'cf-connecting-ip': RAW_IP,
      'content-type': 'application/json',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body,
  });
}

async function expectFailure(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.json()).toEqual({
    ok: false,
    code,
    retryAt: null,
    resetAt: null,
  });
}

describe('text AI access-code login', () => {
  test('consumes one blinded attempt, clears it, and returns only a hardened session cookie', async () => {
    const { env, fetch, requests } = harness();
    const response = await handleTextLoginRequest(
      loginRequest(JSON.stringify({ accessCode: USER_1_CODE })),
      env,
      NOW_MS,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toMatch(
      new RegExp(`^${TEXT_SESSION_COOKIE}=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Strict$`),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(requests.map((request) => request.headers.get('x-tiezheng-auth-action')))
      .toEqual(['consume', 'clear']);

    for (const request of requests) {
      expect(request.url).toBe(THROTTLE_URL);
      expect(request.method).toBe('POST');
      expect(request.redirect).toBe('manual');
      expect(request.body).toBeNull();
      expect(request.headers.has('content-type')).toBe(false);
      expect(request.headers.has('content-length')).toBe(false);
      expect(request.headers.get('x-tiezheng-auth-attempt-key'))
        .toMatch(/^[a-f0-9]{64}$/);
      expect(request.headers.get('x-tiezheng-auth-anonymous')).toBe('false');
      expect(request.url).not.toContain(USER_1_CODE);
      expect(request.url).not.toContain(RAW_IP);
      let serializedHeaders = '';
      request.headers.forEach((value) => {
        serializedHeaders += `${value}\n`;
      });
      expect(serializedHeaders).not.toContain(USER_1_CODE);
      expect(serializedHeaders).not.toContain(RAW_IP);
    }
  });

  test('consumes but does not clear or sign a session for a wrong code', async () => {
    const { env, fetch, requests } = harness();
    const response = await handleTextLoginRequest(
      loginRequest(JSON.stringify({ accessCode: UNKNOWN_CODE })),
      env,
      NOW_MS,
    );

    await expectFailure(response, 401, 'auth-required');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(requests[0]?.headers.get('x-tiezheng-auth-action')).toBe('consume');
  });

  test('returns the bounded retry instant without testing the code when blocked', async () => {
    const { env, fetch } = harness({
      consume: () => throttleJson({ kind: 'blocked', retryAfterMs: 900_000 }),
    });
    const response = await handleTextLoginRequest(
      loginRequest(JSON.stringify({ accessCode: USER_1_CODE })),
      env,
      NOW_MS,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({
      ok: false,
      code: 'rate-limited',
      retryAt: new Date(NOW_MS + 900_000).toISOString(),
      resetAt: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('uses the fixed anonymous bucket when Cloudflare supplies no canonical client IP', async () => {
    const { env, requests } = harness();
    const request = loginRequest(JSON.stringify({ accessCode: USER_1_CODE }));
    request.headers.delete('cf-connecting-ip');

    const response = await handleTextLoginRequest(request, env, NOW_MS);

    expect(response.status).toBe(200);
    expect(requests[0]?.headers.get('x-tiezheng-auth-anonymous')).toBe('true');
    expect(requests[0]?.headers.get('x-tiezheng-auth-attempt-key'))
      .toMatch(/^[a-f0-9]{64}$/);
  });

  test.each([
    ['missing binding', () => harness({ includeBinding: false })],
    ['consume redirect', () => harness({
      consume: () => new Response(null, { status: 302, headers: { location: 'https://example.test/' } }),
    })],
    ['wrong content type', () => harness({
      consume: () => new Response('{"kind":"allowed"}', { status: 200, headers: { 'content-type': 'text/plain' } }),
    })],
    ['malformed JSON', () => harness({
      consume: () => new Response('{', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }),
    })],
    ['schema drift', () => harness({
      consume: () => throttleJson({ kind: 'allowed', private: true }),
    })],
    ['oversized response', () => harness({
      consume: () => throttleJson({ kind: 'allowed', padding: 'x'.repeat(512) }),
    })],
    ['throwing binding', () => harness({
      consume: () => Promise.reject(new Error('private gateway failure')),
    })],
  ])('fails closed for %s without returning private details', async (_name, makeHarness) => {
    const { env } = makeHarness();
    const response = await handleTextLoginRequest(
      loginRequest(JSON.stringify({ accessCode: USER_1_CODE })),
      env,
      NOW_MS,
    );

    const serialized = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expect(serialized).not.toContain(USER_1_CODE);
    expect(serialized).not.toContain(RAW_IP);
    expect(serialized).not.toContain('private gateway failure');
  });

  test('does not sign or return a cookie when clearing the successful attempt fails', async () => {
    const { env, fetch } = harness({
      clear: () => throttleJson({ kind: 'allowed' }),
    });
    const response = await handleTextLoginRequest(
      loginRequest(JSON.stringify({ accessCode: USER_1_CODE })),
      env,
      NOW_MS,
    );

    await expectFailure(response, 503, 'service-disabled');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['malformed JSON', '{'],
    ['missing code', '{}'],
    ['extra field', JSON.stringify({ accessCode: USER_1_CODE, remember: true })],
    ['wrong type', JSON.stringify({ accessCode: 7 })],
    ['noncanonical code', JSON.stringify({ accessCode: 'A'.repeat(31) })],
    ['oversized body', JSON.stringify({ accessCode: 'A'.repeat(513) })],
  ])('rejects %s before consuming a throttle attempt', async (_name, body) => {
    const { env, fetch } = harness();
    const response = await handleTextLoginRequest(loginRequest(body), env, NOW_MS);

    await expectFailure(response, 401, 'auth-required');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('fails closed before binding access when authentication configuration is absent', async () => {
    const { env, fetch } = harness();
    delete (env as Partial<TextAiPagesEnv>).TEXT_AI_SESSION_SIGNING_KEY;
    const response = await handleTextLoginRequest(
      loginRequest(JSON.stringify({ accessCode: USER_1_CODE })),
      env,
      NOW_MS,
    );

    await expectFailure(response, 503, 'service-disabled');
    expect(fetch).not.toHaveBeenCalled();
  });
});
