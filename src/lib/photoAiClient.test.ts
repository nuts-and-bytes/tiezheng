import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import {
  PHOTO_AI_VERSIONS,
  type PhotoAiEstimateResponse,
  type PhotoAiSessionResponse,
} from './photoAiContract';
import {
  createPhotoAiClient,
  type PhotoAiClient,
  type PhotoAiEstimateInput,
} from './photoAiClient';
import {
  photoAiEstimateInFlightFixture,
  photoAiEstimateSuccessFixture,
  photoAiSessionSuccessFixture,
} from '../test/photoAiFixtures';

const PREFIX = '/api/nutrition/photo/';
const REQUEST_ID = 'photo-request-001';
const IDEMPOTENCY_KEY = '0123456789abcdef0123456789abcdef';
const UPLOAD_SHA = 'b'.repeat(64);

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function redirectedJsonResponse(value: unknown): Response {
  const response = jsonResponse(value);
  Object.defineProperty(response, 'redirected', { value: true });
  return response;
}

function estimateInput(): PhotoAiEstimateInput {
  return {
    requestId: REQUEST_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    uploadBlobSha256: UPLOAD_SHA,
    uploadBlob: new Blob(['webp-image'], { type: 'image/webp' }),
  };
}

function fetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(implementation) as unknown as typeof fetch;
}

function failure(code: string) {
  return { ok: false, code, retryAt: null, resetAt: null };
}

function formEntries(body: BodyInit | null | undefined): Record<string, FormDataEntryValue> {
  expect(body).toBeInstanceOf(FormData);
  return Object.fromEntries((body as FormData).entries());
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('photo AI same-origin client', () => {
  test('exports the exact public client types', () => {
    expectTypeOf<PhotoAiClient['session']>().returns.resolves.toMatchTypeOf<PhotoAiSessionResponse>();
    expectTypeOf<PhotoAiClient['estimate']>().returns.resolves.toMatchTypeOf<PhotoAiEstimateResponse>();
    expectTypeOf<PhotoAiClient['logout']>().returns.resolves.toEqualTypeOf<{
      logoutUrl: '/cdn-cgi/access/logout';
    }>();
  });

  test('uses only fixed same-origin endpoints with credentials and no cache', async () => {
    const fetcher = fetchMock(async (input) => {
      if (input === `${PREFIX}session`) return jsonResponse(photoAiSessionSuccessFixture);
      if (input === `${PREFIX}estimate`) return jsonResponse(photoAiEstimateSuccessFixture);
      return jsonResponse({ logoutUrl: '/cdn-cgi/access/logout' });
    });
    const client = createPhotoAiClient(fetcher);

    await client.session();
    await client.estimate(estimateInput());
    await client.logout();

    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, init] of vi.mocked(fetcher).mock.calls) {
      expect(String(url).startsWith(PREFIX)).toBe(true);
      expect(String(url)).not.toContain('http://');
      expect(String(url)).not.toContain('https://');
      expect(init).toMatchObject({ credentials: 'include', cache: 'no-store' });
    }
    expect(vi.mocked(fetcher).mock.calls.map(([url]) => url)).toEqual([
      `${PREFIX}session`,
      `${PREFIX}estimate`,
      `${PREFIX}logout`,
    ]);
  });

  test('sends only the image and fixed request/version metadata', async () => {
    const fetcher = fetchMock(async () => jsonResponse(photoAiEstimateSuccessFixture));
    const input = estimateInput();
    await createPhotoAiClient(fetcher).estimate(input);

    const [, init] = vi.mocked(fetcher).mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
    const entries = formEntries(init?.body);
    expect(Object.keys(entries).sort()).toEqual([
      'catalogVersion',
      'idempotencyKey',
      'image',
      'locale',
      'modelVersion',
      'promptVersion',
      'providerPolicyVersion',
      'requestId',
      'schemaVersion',
      'transformVersion',
      'uncertaintyVersion',
      'uploadBlobSha256',
    ]);
    expect(entries).toMatchObject({
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      uploadBlobSha256: UPLOAD_SHA,
      modelVersion: PHOTO_AI_VERSIONS.model,
      promptVersion: PHOTO_AI_VERSIONS.prompt,
      schemaVersion: PHOTO_AI_VERSIONS.schema,
      catalogVersion: PHOTO_AI_VERSIONS.catalog,
      transformVersion: PHOTO_AI_VERSIONS.transform,
      uncertaintyVersion: PHOTO_AI_VERSIONS.uncertainty,
      providerPolicyVersion: PHOTO_AI_VERSIONS.providerPolicy,
      locale: 'zh-CN',
    });
    expect(entries.image).toBeInstanceOf(Blob);
    expect((entries.image as Blob).type).toBe('image/webp');
    for (const forbidden of ['date', 'slot', 'weight', 'goal', 'email', 'history', 'food']) {
      expect(entries).not.toHaveProperty(forbidden);
    }
  });

  test.each([
    ['HTML', new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } })],
    ['redirect', redirectedJsonResponse(photoAiSessionSuccessFixture)],
  ])('maps a %s session response to auth-required', async (_label, response) => {
    const client = createPhotoAiClient(fetchMock(async () => response));
    await expect(client.session()).resolves.toEqual(failure('auth-required'));
  });

  test('uses the closed-world parser for JSON responses', async () => {
    const response = { ...photoAiSessionSuccessFixture, leaked: 'secret' };
    const client = createPhotoAiClient(fetchMock(async () => jsonResponse(response)));
    await expect(client.session()).resolves.toEqual(failure('invalid-estimate'));
  });

  test('retries one 202 response after a bounded delay with identical metadata', async () => {
    const bodies: Record<string, FormDataEntryValue>[] = [];
    const responses = [
      jsonResponse({ ...photoAiEstimateInFlightFixture, retryAfterMs: 60_000 }, { status: 202 }),
      jsonResponse(photoAiEstimateSuccessFixture),
    ];
    const fetcher = fetchMock(async (_url, init) => {
      bodies.push(formEntries(init?.body));
      return responses.shift()!;
    });
    const delay = vi.fn(async (_ms: number) => undefined);
    const input = estimateInput();
    const result = await createPhotoAiClient(fetcher, delay).estimate(input);

    expect(result).toEqual(photoAiEstimateSuccessFixture);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(delay.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
    expect(delay.mock.calls[0][0]).toBeLessThanOrEqual(5_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  test('rebuilds immutable multipart metadata after a 202 retry', async () => {
    let attempt = 0;
    let secondBody: Record<string, FormDataEntryValue> | undefined;
    const fetcher = fetchMock(async (_url, init) => {
      attempt += 1;
      const body = init?.body as FormData;
      if (attempt === 1) {
        body.set('requestId', 'attacker-request');
        body.set('idempotencyKey', 'f'.repeat(32));
        body.delete('image');
        return jsonResponse(photoAiEstimateInFlightFixture, { status: 202 });
      }
      secondBody = formEntries(body);
      return jsonResponse(photoAiEstimateSuccessFixture);
    });

    await createPhotoAiClient(fetcher, async () => undefined).estimate(estimateInput());

    expect(secondBody).toMatchObject({
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      uploadBlobSha256: UPLOAD_SHA,
    });
    expect(secondBody?.image).toBeInstanceOf(Blob);
  });

  test('does not loop forever after a second 202 response', async () => {
    const fetcher = fetchMock(async () =>
      jsonResponse(photoAiEstimateInFlightFixture, { status: 202 }),
    );
    const delay = vi.fn(async () => undefined);
    await expect(createPhotoAiClient(fetcher, delay).estimate(estimateInput())).resolves.toEqual(
      photoAiEstimateInFlightFixture,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['HTTP 200 with in-flight JSON', 200, photoAiEstimateInFlightFixture],
    ['HTTP 202 with complete JSON', 202, photoAiEstimateSuccessFixture],
  ])('fails closed on mismatched estimate transport: %s', async (_label, status, payload) => {
    const fetcher = fetchMock(async () => jsonResponse(payload, { status }));
    const delay = vi.fn(async (_ms: number) => undefined);

    await expect(createPhotoAiClient(fetcher, delay).estimate(estimateInput())).resolves.toEqual(
      failure('invalid-estimate'),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  test('aborts a timed-out request and returns provider-timeout', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetcher = fetchMock(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          capturedSignal = init?.signal ?? undefined;
          capturedSignal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const input = estimateInput();
    const request = createPhotoAiClient(fetcher).estimate(input);
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual(failure('provider-timeout'));
    expect(capturedSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(input.idempotencyKey).toBe(IDEMPOTENCY_KEY);
  });

  test('keeps the timeout active while the JSON response body is read', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const stalledResponse = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      redirected: false,
      type: 'basic',
      status: 200,
      json: vi.fn(async () => new Promise<never>(() => undefined)),
    } as unknown as Response;
    const fetcher = fetchMock(async (_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return stalledResponse;
    });

    const request = createPhotoAiClient(fetcher).session();
    await vi.runAllTimersAsync();
    const result = await Promise.race([request, Promise.resolve('still-pending' as const)]);

    expect(result).toEqual(failure('provider-timeout'));
    expect(capturedSignal?.aborted).toBe(true);
  });

  test('maps a network failure to offline without retrying under a new key', async () => {
    const fetcher = fetchMock(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(createPhotoAiClient(fetcher).estimate(estimateInput())).resolves.toEqual(
      failure('offline'),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('normalizes a synchronous fetch throw and clears its timeout', async () => {
    vi.useFakeTimers();
    const fetcher = (() => {
      throw new TypeError('synchronous network failure');
    }) as typeof fetch;

    await expect(createPhotoAiClient(fetcher).session()).resolves.toEqual(failure('offline'));
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    ['session', () => createPhotoAiClient(fetchMock(async () => jsonResponse(photoAiSessionSuccessFixture, { status: 500 }))).session()],
    ['estimate', () => createPhotoAiClient(fetchMock(async () => jsonResponse(photoAiEstimateSuccessFixture, { status: 500 }))).estimate(estimateInput())],
  ])('rejects a successful %s JSON body on an error HTTP status', async (_label, call) => {
    await expect(call()).resolves.toEqual(failure('invalid-estimate'));
  });

  test('accepts only the fixed logout response', async () => {
    const client = createPhotoAiClient(
      fetchMock(async () => jsonResponse({ logoutUrl: '/cdn-cgi/access/logout' })),
    );
    await expect(client.logout()).resolves.toEqual({ logoutUrl: '/cdn-cgi/access/logout' });
  });

  test('rejects a logout success body on an error HTTP status', async () => {
    const client = createPhotoAiClient(
      fetchMock(async () =>
        jsonResponse({ logoutUrl: '/cdn-cgi/access/logout' }, { status: 500 }),
      ),
    );
    await expect(client.logout()).rejects.toThrow('Photo AI logout failed');
  });
});
