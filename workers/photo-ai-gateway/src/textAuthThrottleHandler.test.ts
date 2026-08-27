import { describe, expect, test, vi } from 'vitest';

import type { GatewayEnv } from './env';
import worker from './index';
import {
  handleTextAuthThrottleRequest,
  isExactTextAuthThrottleRoute,
  type TextAuthThrottleDependencies,
} from './textAuthThrottleHandler';

const THROTTLE_URL = 'https://photo-ai-gateway.internal/internal/text-auth-attempt';
const ATTEMPT_KEY = 'a'.repeat(64);
const NOW = Date.UTC(2026, 7, 27, 9, 0, 0);
const NOW_DEPENDENCIES: TextAuthThrottleDependencies = Object.freeze({ now: () => NOW });

function harness(result: unknown = { kind: 'allowed' }) {
  const consumeTextAuthAttempt = vi.fn(async () => result);
  const clearTextAuthAttempts = vi.fn(async () => undefined);
  const getByName = vi.fn(() => ({ consumeTextAuthAttempt, clearTextAuthAttempts }));
  const gatewayEnv = {
    PHOTO_AI_COORDINATOR: { getByName },
  } as unknown as GatewayEnv;
  return {
    clearTextAuthAttempts,
    consumeTextAuthAttempt,
    gatewayEnv,
    getByName,
  };
}

function throttleRequest(options: {
  action?: string;
  anonymous?: string;
  attemptKey?: string;
  body?: BodyInit | null;
  headers?: HeadersInit;
  method?: string;
  redirect?: RequestRedirect;
  url?: string;
} = {}): Request {
  const headers = new Headers(options.headers);
  if (options.action !== null) headers.set('x-tiezheng-auth-action', options.action ?? 'consume');
  if (options.attemptKey !== null) {
    headers.set('x-tiezheng-auth-attempt-key', options.attemptKey ?? ATTEMPT_KEY);
  }
  if (options.anonymous !== null) {
    headers.set('x-tiezheng-auth-anonymous', options.anonymous ?? 'false');
  }
  return new Request(options.url ?? THROTTLE_URL, {
    method: options.method ?? 'POST',
    headers,
    body: options.body,
    redirect: options.redirect ?? 'manual',
  });
}

async function expectJson(
  response: Response,
  status: number,
  body: unknown,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await response.json()).toEqual(body);
}

describe('private text authentication throttle protocol', () => {
  test('consumes one exact non-anonymous attempt through the stage2 coordinator', async () => {
    const { consumeTextAuthAttempt, gatewayEnv, getByName } = harness();
    await expectJson(
      await handleTextAuthThrottleRequest(
        throttleRequest(),
        gatewayEnv,
        NOW_DEPENDENCIES,
      ),
      200,
      { kind: 'allowed' },
    );

    expect(getByName).toHaveBeenCalledWith('stage2');
    expect(consumeTextAuthAttempt).toHaveBeenCalledWith({
      attemptKey: ATTEMPT_KEY,
      anonymous: false,
      now: NOW,
    });
  });

  test('returns only the bounded blocked result', async () => {
    const { gatewayEnv } = harness({ kind: 'blocked', retryAfterMs: 900_000 });
    await expectJson(
      await handleTextAuthThrottleRequest(
        throttleRequest({ anonymous: 'true' }),
        gatewayEnv,
        NOW_DEPENDENCIES,
      ),
      200,
      { kind: 'blocked', retryAfterMs: 900_000 },
    );
  });

  test('clears one exact key with a bodyless 204 response', async () => {
    const { clearTextAuthAttempts, consumeTextAuthAttempt, gatewayEnv } = harness();
    const response = await handleTextAuthThrottleRequest(
      throttleRequest({ action: 'clear', anonymous: 'true' }),
      gatewayEnv,
      NOW_DEPENDENCIES,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.has('content-type')).toBe(false);
    expect(await response.text()).toBe('');
    expect(clearTextAuthAttempts).toHaveBeenCalledWith(ATTEMPT_KEY);
    expect(consumeTextAuthAttempt).not.toHaveBeenCalled();
  });

  test.each([
    ['wrong method', () => throttleRequest({ method: 'GET' })],
    ['wrong origin', () => throttleRequest({ url: 'https://example.test/internal/text-auth-attempt' })],
    ['trailing slash', () => throttleRequest({ url: `${THROTTLE_URL}/` })],
    ['encoded path', () => throttleRequest({ url: 'https://photo-ai-gateway.internal/internal/%74ext-auth-attempt' })],
    ['empty query', () => throttleRequest({ url: `${THROTTLE_URL}?` })],
    ['query', () => throttleRequest({ url: `${THROTTLE_URL}?x=1` })],
    ['follow redirect mode', () => throttleRequest({ redirect: 'follow' })],
    ['body', () => throttleRequest({ body: '' })],
    ['content length', () => throttleRequest({ headers: { 'content-length': '0' } })],
    ['content type', () => throttleRequest({ headers: { 'content-type': 'application/json' } })],
    ['missing action', () => throttleRequest({ action: null as unknown as string })],
    ['wrong action', () => throttleRequest({ action: 'inspect' })],
    ['missing key', () => throttleRequest({ attemptKey: null as unknown as string })],
    ['uppercase key', () => throttleRequest({ attemptKey: 'A'.repeat(64) })],
    ['missing anonymous', () => throttleRequest({ anonymous: null as unknown as string })],
    ['wrong anonymous', () => throttleRequest({ anonymous: '0' })],
  ])('rejects %s before coordinator RPC', async (_name, makeRequest) => {
    const { gatewayEnv, getByName } = harness();
    await expectJson(
      await handleTextAuthThrottleRequest(makeRequest(), gatewayEnv, NOW_DEPENDENCIES),
      400,
      { kind: 'invalid' },
    );
    expect(getByName).not.toHaveBeenCalled();
  });

  test.each([
    ['throwing RPC', () => harness(Promise.reject(new Error('private failure')))],
    ['malformed kind', () => harness({ kind: 'other' })],
    ['zero retry', () => harness({ kind: 'blocked', retryAfterMs: 0 })],
    ['oversized retry', () => harness({ kind: 'blocked', retryAfterMs: 1_800_001 })],
    ['extra response key', () => harness({ kind: 'allowed', private: true })],
  ])('fails closed for %s without exposing the attempt key', async (_name, makeHarness) => {
    const { gatewayEnv } = makeHarness();
    const response = await handleTextAuthThrottleRequest(
      throttleRequest(),
      gatewayEnv,
      NOW_DEPENDENCIES,
    );
    const serialized = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toEqual({ kind: 'unavailable' });
    expect(serialized).not.toContain(ATTEMPT_KEY);
    expect(serialized).not.toContain('private failure');
  });

  test('fails closed before RPC for an unsafe clock', async () => {
    const { gatewayEnv, getByName } = harness();
    await expectJson(
      await handleTextAuthThrottleRequest(throttleRequest(), gatewayEnv, { now: () => Number.NaN }),
      503,
      { kind: 'unavailable' },
    );
    expect(getByName).not.toHaveBeenCalled();
  });
});

describe('private text authentication throttle route', () => {
  test('recognizes only the exact manual POST origin and path', () => {
    const exact = throttleRequest();
    expect(isExactTextAuthThrottleRoute(exact, new URL(exact.url))).toBe(true);
    for (const request of [
      throttleRequest({ method: 'GET' }),
      throttleRequest({ redirect: 'follow' }),
      throttleRequest({ url: `${THROTTLE_URL}?` }),
      throttleRequest({ url: `${THROTTLE_URL}/` }),
      throttleRequest({ url: 'https://example.test/internal/text-auth-attempt' }),
    ]) {
      expect(isExactTextAuthThrottleRoute(request, new URL(request.url))).toBe(false);
    }
  });

  test('dispatches the exact route before every public gateway route', async () => {
    const exact = harness();
    await expectJson(
      await worker.fetch(throttleRequest(), exact.gatewayEnv),
      200,
      { kind: 'allowed' },
    );
    expect(exact.consumeTextAuthAttempt).toHaveBeenCalledTimes(1);

    const malformed = harness();
    await expectJson(
      await worker.fetch(throttleRequest({ action: 'inspect' }), malformed.gatewayEnv),
      400,
      { kind: 'invalid' },
    );
    expect(malformed.getByName).not.toHaveBeenCalled();
  });

  test('keeps near-miss routes inside the existing fail-closed gateway response', async () => {
    const { gatewayEnv, getByName } = harness();
    const response = await worker.fetch(
      throttleRequest({ url: `${THROTTLE_URL}/` }),
      gatewayEnv,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expect(getByName).not.toHaveBeenCalled();
  });
});
