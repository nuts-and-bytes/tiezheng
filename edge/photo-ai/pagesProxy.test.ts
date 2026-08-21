import { describe, expect, test, vi } from 'vitest';

import {
  photoAiEstimateInFlightFixture,
  photoAiEstimateSuccessFixture,
  photoAiFailureFixture,
  photoAiSessionSuccessFixture,
} from '../../src/test/photoAiFixtures';
import {
  proxyPhotoAiRequest,
  type PhotoAiPagesEnv,
} from './pagesProxy';

const ACCOUNT_KEY = 'a'.repeat(64);

function env(fetcher?: Fetcher['fetch']): PhotoAiPagesEnv {
  return {
    PHOTO_AI_TEAM_DOMAIN: 'team-alpha',
    PHOTO_AI_ACCESS_AUD: 'photo-ai-audience',
    PHOTO_AI_ALLOWED_EMAILS: 'alice@example.com,bob@example.com,carol@example.com',
    PHOTO_AI_ACCOUNT_HMAC_KEY: '0123456789abcdef0123456789abcdef',
    PHOTO_AI_ALLOWED_ORIGINS: 'https://app.example.test',
    PHOTO_AI_GATEWAY: fetcher === undefined ? undefined : { fetch: fetcher } as Fetcher,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json();
}

function expectSecure(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

function headerRecord(init?: HeadersInit): Record<string, string> {
  const record: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

describe('photo AI Pages service proxy', () => {
  test('fails closed when the private service binding is missing', async () => {
    const response = await proxyPhotoAiRequest(
      new Request('https://app.example.test/api/nutrition/photo/session'),
      env(),
      ACCOUNT_KEY,
      'session',
    );

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expectSecure(response);
  });

  test('forwards an estimate body stream once with only the account and required content headers', async () => {
    const source = new Request('https://app.example.test/api/nutrition/photo/estimate?return=https://evil.test', {
      method: 'POST',
      headers: {
        authorization: 'private-jwt',
        'cf-access-jwt-assertion': 'private-access-token',
        'content-length': '3',
        'content-type': 'multipart/form-data; boundary=a',
        origin: 'https://app.example.test',
        'sec-fetch-site': 'same-origin',
        'x-private-email': 'alice@example.com',
      },
      body: 'abc',
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://photo-ai-gateway.internal/estimate');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(source.body);
      expect(headerRecord(init?.headers)).toEqual({
        'content-length': '3',
        'content-type': 'multipart/form-data; boundary=a',
        'x-tiezheng-account-key': ACCOUNT_KEY,
      });
      expect(await new Response(init?.body).text()).toBe('abc');
      return json(photoAiEstimateSuccessFixture);
    });

    const response = await proxyPhotoAiRequest(source, env(fetcher), ACCOUNT_KEY, 'estimate');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(source.bodyUsed).toBe(true);
    expect(response.status).toBe(200);
    expect(await responseBody(response)).toEqual(photoAiEstimateSuccessFixture);
    expectSecure(response);
  });

  test('uses a fixed internal session target and forwards no caller query or identity headers', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://photo-ai-gateway.internal/session');
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      expect(headerRecord(init?.headers)).toEqual({
        'x-tiezheng-account-key': ACCOUNT_KEY,
      });
      return json(photoAiSessionSuccessFixture);
    });
    const request = new Request(
      'https://app.example.test/api/nutrition/photo/session?return=https://evil.test',
      { headers: { 'cf-access-jwt-assertion': 'private', 'x-private-email': 'alice@example.com' } },
    );

    const response = await proxyPhotoAiRequest(request, env(fetcher), ACCOUNT_KEY, 'session');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await responseBody(response)).toEqual(photoAiSessionSuccessFixture);
  });

  test.each([
    ['in-flight', photoAiEstimateInFlightFixture, 202],
    ['conflict', { ...photoAiFailureFixture, code: 'idempotency-conflict', retryAt: null }, 409],
    ['rate limit', { ...photoAiFailureFixture, code: 'rate-limited' }, 429],
  ])('preserves an approved %s JSON response', async (_case, downstreamBody, status) => {
    const fetcher = vi.fn(async () => json(downstreamBody, status));
    const response = await proxyPhotoAiRequest(
      new Request('https://app.example.test/api/nutrition/photo/estimate', {
        method: 'POST',
        headers: {
          'content-length': '1',
          'content-type': 'multipart/form-data; boundary=a',
        },
        body: 'x',
      }),
      env(fetcher),
      ACCOUNT_KEY,
      'estimate',
    );

    expect(response.status).toBe(status);
    expect(await responseBody(response)).toEqual(downstreamBody);
    expectSecure(response);
  });

  test.each([
    ['HTML', new Response('<h1>private stack</h1>', { status: 500, headers: { 'content-type': 'text/html' } })],
    ['JSON stack', json({ stack: 'private stack' }, 500)],
    ['unapproved status', json(photoAiEstimateSuccessFixture, 201)],
    ['oversized JSON', new Response(`{"padding":"${'x'.repeat(256_001)}"}`, { headers: { 'content-type': 'application/json' } })],
  ])('maps a downstream %s response to a fixed provider error', async (_case, downstream) => {
    const fetcher = vi.fn(async () => downstream.clone());
    const response = await proxyPhotoAiRequest(
      new Request('https://app.example.test/api/nutrition/photo/session'),
      env(fetcher),
      ACCOUNT_KEY,
      'session',
    );

    expect(response.status).toBe(503);
    const serialized = await response.text();
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      code: 'provider-unavailable',
      retryAt: null,
      resetAt: null,
    });
    expect(serialized).not.toMatch(/private stack|padding/);
    expectSecure(response);
  });
});
