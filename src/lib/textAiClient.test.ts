import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import {
  TEXT_AI_LIMITS,
  TEXT_AI_VERSIONS,
  type TextAiEstimateResponse,
  type TextAiSessionResponse,
} from './textAiContract';
import {
  createTextAiClient,
  type TextAiClient,
  type TextAiEstimateInput,
} from './textAiClient';
import {
  textAiEstimateInFlightFixture,
  textAiEstimateSuccessFixture,
  textAiFailureFixture,
  textAiSessionSuccessFixture,
} from '../test/textAiFixtures';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = REQUEST_ID.replaceAll('-', '');
const OTHER_REQUEST_ID = '22222222-2222-4222-8222-222222222222';

function estimateInput(
  overrides: Partial<TextAiEstimateInput> = {},
): TextAiEstimateInput {
  return {
    requestId: REQUEST_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    description: '牛肉面一碗，少油',
    amount: { value: 500, unit: 'g' },
    ...overrides,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });
}

function fetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(implementation) as unknown as typeof fetch;
}

function failure(code: string) {
  return { ok: false, code, retryAt: null, resetAt: null };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('text AI same-origin client', () => {
  test('exports the exact public client types', () => {
    expectTypeOf<TextAiClient['session']>().returns.resolves.toMatchTypeOf<TextAiSessionResponse>();
    expectTypeOf<TextAiClient['estimate']>().returns.resolves.toMatchTypeOf<TextAiEstimateResponse>();
    expectTypeOf<TextAiClient['estimateWithOutcome']>()
      .returns.resolves.toMatchTypeOf<{ terminal: boolean; response: TextAiEstimateResponse }>();
  });

  test('session only reads the fixed same-origin JSON endpoint', async () => {
    const fetcher = fetchMock(async () => jsonResponse(textAiSessionSuccessFixture));

    await expect(createTextAiClient(fetcher).session()).resolves.toEqual(
      textAiSessionSuccessFixture,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/nutrition/text/session', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
  });

  test('estimate sends only a parsed detached request as strict JSON', async () => {
    const bodies: string[] = [];
    const fetcher = fetchMock(async (url, init) => {
      expect(url).toBe('/api/nutrition/text/estimate');
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
      });
      bodies.push(String(init?.body));
      return jsonResponse(textAiEstimateSuccessFixture);
    });
    const input = estimateInput({
      description: '  Cafe\u0301 牛肉面  ',
      amount: { value: 500, unit: 'g' },
    });

    await expect(createTextAiClient(fetcher).estimate(input)).resolves.toEqual(
      textAiEstimateSuccessFixture,
    );
    input.description = '篡改';
    if (input.amount !== null) input.amount.value = 999;

    expect(JSON.parse(bodies[0])).toEqual({
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      description: 'Café 牛肉面',
      amount: { value: 500, unit: 'g' },
      modelVersion: TEXT_AI_VERSIONS.model,
      promptVersion: TEXT_AI_VERSIONS.prompt,
      schemaVersion: TEXT_AI_VERSIONS.schema,
      catalogVersion: TEXT_AI_VERSIONS.catalog,
      uncertaintyVersion: TEXT_AI_VERSIONS.uncertainty,
      providerPolicyVersion: TEXT_AI_VERSIONS.providerPolicy,
      locale: 'zh-CN',
    });
  });

  test.each([
    estimateInput({ description: '   ' }),
    estimateInput({ description: '面'.repeat(501) }),
    estimateInput({ amount: { value: Number.POSITIVE_INFINITY, unit: 'g' } }),
    estimateInput({ amount: { value: 0, unit: 'g' } }),
    estimateInput({ idempotencyKey: 'ABC' }),
    estimateInput({ requestId: 'not-a-uuid' }),
    Object.assign(Object.create({ inherited: true }), estimateInput()),
    Object.assign(estimateInput(), { extra: true }),
  ])('rejects invalid input before fetch %#', async (input) => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(createTextAiClient(fetcher).estimate(input as TextAiEstimateInput))
      .rejects.toThrow('Invalid text AI request');
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('does not execute an input getter', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const getter = vi.fn(() => '牛肉面');
    const input = Object.defineProperty({}, 'description', {
      enumerable: true,
      get: getter,
    });

    await expect(createTextAiClient(fetcher).estimate(input as TextAiEstimateInput))
      .rejects.toThrow('Invalid text AI request');
    expect(getter).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('clamps a legal 60 second in-flight delay and retries once with identical JSON', async () => {
    const bodies: string[] = [];
    const fetcher = fetchMock(async (_url, init) => {
      bodies.push(String(init?.body));
      return bodies.length === 1
        ? jsonResponse(
            { ...textAiEstimateInFlightFixture, retryAfterMs: 60_000 },
            { status: 202 },
          )
        : jsonResponse(textAiEstimateSuccessFixture);
    });
    const delay = vi.fn(async () => undefined);

    await expect(createTextAiClient(fetcher, delay).estimate(estimateInput()))
      .resolves.toEqual(textAiEstimateSuccessFixture);
    expect(delay).toHaveBeenCalledOnce();
    expect(delay).toHaveBeenCalledWith(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[1]).requestId).toBe(REQUEST_ID);
    expect(JSON.parse(bodies[1]).idempotencyKey).toBe(IDEMPOTENCY_KEY);
  });

  test('returns a second in-flight response without waiting or requesting a third time', async () => {
    const fetcher = fetchMock(async () =>
      jsonResponse(textAiEstimateInFlightFixture, { status: 202 }),
    );
    const delay = vi.fn(async () => undefined);

    await expect(createTextAiClient(fetcher, delay).estimate(estimateInput()))
      .resolves.toEqual(textAiEstimateInFlightFixture);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  test('rejects a first complete response for a different request', async () => {
    const fetcher = fetchMock(async () => jsonResponse({
      ...textAiEstimateSuccessFixture,
      requestId: OTHER_REQUEST_ID,
    }));

    await expect(createTextAiClient(fetcher).estimate(estimateInput())).resolves.toEqual(
      failure('invalid-estimate'),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('rejects a first in-flight response for a different request without retrying', async () => {
    const fetcher = fetchMock(async () => jsonResponse({
      ...textAiEstimateInFlightFixture,
      requestId: OTHER_REQUEST_ID,
    }, { status: 202 }));
    const delay = vi.fn(async () => undefined);

    await expect(createTextAiClient(fetcher, delay).estimate(estimateInput())).resolves.toEqual(
      failure('invalid-estimate'),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  test('rejects a retried complete response for a different request', async () => {
    const fetcher = fetchMock(async () =>
      vi.mocked(fetcher).mock.calls.length === 1
        ? jsonResponse(textAiEstimateInFlightFixture, { status: 202 })
        : jsonResponse({
            ...textAiEstimateSuccessFixture,
            requestId: OTHER_REQUEST_ID,
          }),
    );
    const delay = vi.fn(async () => undefined);

    await expect(createTextAiClient(fetcher, delay).estimate(estimateInput())).resolves.toEqual(
      failure('invalid-estimate'),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledOnce();
  });

  test.each([
    ['session success on 500', 'session', 500, textAiSessionSuccessFixture],
    ['complete estimate on 202', 'estimate', 202, textAiEstimateSuccessFixture],
    ['in-flight estimate on 200', 'estimate', 200, textAiEstimateInFlightFixture],
    ['provider failure on 429', 'estimate', 429, textAiFailureFixture],
  ])('fails closed on mismatched HTTP status: %s', async (_label, route, status, body) => {
    const fetcher = fetchMock(async () => jsonResponse(body, { status }));
    const client = createTextAiClient(fetcher, async () => undefined);
    const result = route === 'session'
      ? await client.session()
      : await client.estimate(estimateInput());
    expect(result).toEqual(failure('invalid-estimate'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test.each([
    [401, { ok: false, code: 'auth-required', retryAt: null, resetAt: null }],
    [409, { ok: false, code: 'idempotency-conflict', retryAt: null, resetAt: null }],
    [422, { ok: false, code: 'uncertain-food', retryAt: null, resetAt: null }],
    [429, { ok: false, code: 'quota-exceeded', retryAt: null, resetAt: null }],
    [502, { ok: false, code: 'invalid-estimate', retryAt: null, resetAt: null }],
    [503, textAiFailureFixture],
    [504, { ok: false, code: 'provider-timeout', retryAt: null, resetAt: null }],
  ])('accepts a strict failure body only on its mapped status %i', async (status, body) => {
    const fetcher = fetchMock(async () => jsonResponse(body, { status }));
    await expect(createTextAiClient(fetcher).estimate(estimateInput())).resolves.toEqual(body);
  });

  test('cancels an unread response body with the wrong content type', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('cancel failed');
    });
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'content-type': 'text/plain' },
    });

    await expect(createTextAiClient(fetchMock(async () => response)).session())
      .resolves.toEqual(failure('invalid-estimate'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  test('cancels an unread response body with an oversized declared length', async () => {
    const cancel = vi.fn(async () => undefined);
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: {
        'content-type': 'application/json',
        'content-length': String(TEXT_AI_LIMITS.requestBytes + 1),
      },
    });

    await expect(createTextAiClient(fetchMock(async () => response)).session())
      .resolves.toEqual(failure('invalid-estimate'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  test('does not await a provider-controlled cancellation that never settles', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { 'content-type': 'text/plain' },
    });
    let settled: TextAiSessionResponse | undefined;
    const pending = createTextAiClient(fetchMock(async () => response)).session();
    void pending.then((value) => { settled = value; });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toEqual(failure('invalid-estimate'));
      expect(cancel).toHaveBeenCalledOnce();
      expect(response.body?.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await vi.advanceTimersByTimeAsync(TEXT_AI_LIMITS.timeoutMs);
      await pending;
    }
  });

  test.each<[
    string,
    () => unknown,
  ]>([
    ['throws synchronously', () => { throw new Error('cancel failed'); }],
    ['rejects', () => Promise.reject(new Error('cancel failed'))],
  ])('absorbs body cancellation that %s', async (_label, cancelImplementation) => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream<Uint8Array>(), {
      headers: { 'content-type': 'text/plain' },
    });
    const cancel = vi.fn(cancelImplementation);
    Object.defineProperty(response.body, 'cancel', {
      configurable: true,
      value: cancel,
    });

    const pending = createTextAiClient(fetchMock(async () => response)).session();
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toEqual(failure('invalid-estimate'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    ['wrong content type', jsonResponse(textAiSessionSuccessFixture, {
      headers: { 'content-type': 'text/plain' },
    })],
    ['invalid JSON', new Response('{bad-json', {
      headers: { 'content-type': 'application/json' },
    })],
    ['missing body', new Response(null, {
      headers: { 'content-type': 'application/json' },
    })],
    ['oversized declared body', jsonResponse(textAiSessionSuccessFixture, {
      headers: {
        'content-type': 'application/json',
        'content-length': String(TEXT_AI_LIMITS.requestBytes + 1),
      },
    })],
    ['non-canonical declared length', jsonResponse(textAiSessionSuccessFixture, {
      headers: {
        'content-type': 'application/json',
        'content-length': '0001',
      },
    })],
    ['oversized streamed body', new Response(
      `${JSON.stringify(textAiSessionSuccessFixture)}${' '.repeat(TEXT_AI_LIMITS.requestBytes)}`,
      { headers: { 'content-type': 'application/json' } },
    )],
  ])('rejects a bounded JSON violation: %s', async (_label, response) => {
    const fetcher = fetchMock(async () => response);
    await expect(createTextAiClient(fetcher).session()).resolves.toEqual(
      failure('invalid-estimate'),
    );
  });

  test('fails closed when the response stream errors', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('stream failed'));
      },
    }), { headers: { 'content-type': 'application/json' } });

    await expect(createTextAiClient(fetchMock(async () => response)).session())
      .resolves.toEqual(failure('invalid-estimate'));
  });

  test('uses the closed-world response parser', async () => {
    const response = { ...textAiSessionSuccessFixture, leaked: 'secret' };
    await expect(createTextAiClient(fetchMock(async () => jsonResponse(response))).session())
      .resolves.toEqual(failure('invalid-estimate'));
  });

  test('maps a network exception to offline without retrying', async () => {
    const fetcher = fetchMock(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(createTextAiClient(fetcher).estimate(estimateInput())).resolves.toEqual(
      failure('offline'),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('aborts a request after 20 seconds and maps it to provider-timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = fetchMock(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const pending = createTextAiClient(fetcher).estimate(estimateInput());
    await vi.advanceTimersByTimeAsync(TEXT_AI_LIMITS.timeoutMs);

    await expect(pending).resolves.toEqual(failure('provider-timeout'));
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('internally distinguishes local timeout ambiguity from a valid terminal gateway failure', async () => {
    vi.useFakeTimers();
    type OutcomeClient = TextAiClient & {
      estimateWithOutcome(input: TextAiEstimateInput): Promise<{
        terminal: boolean;
        response: TextAiEstimateResponse;
      }>;
    };
    const stalled = createTextAiClient(fetchMock((_url, init) => new Promise<Response>((
      _resolve,
      reject,
    ) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('local timeout', 'AbortError'));
      }, { once: true });
    }))) as OutcomeClient;
    const timeoutPending = stalled.estimateWithOutcome(estimateInput());
    await vi.advanceTimersByTimeAsync(TEXT_AI_LIMITS.timeoutMs);

    await expect(timeoutPending).resolves.toEqual({
      terminal: false,
      response: failure('provider-timeout'),
    });

    const terminal = createTextAiClient(fetchMock(async () => jsonResponse(
      failure('provider-unavailable'),
      { status: 503 },
    ))) as OutcomeClient;
    await expect(terminal.estimateWithOutcome(estimateInput())).resolves.toEqual({
      terminal: true,
      response: failure('provider-unavailable'),
    });

    const transport = createTextAiClient(fetchMock(async () => new Response(null, {
      status: 502,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }))) as OutcomeClient;
    await expect(transport.estimateWithOutcome(estimateInput())).resolves.toEqual({
      terminal: false,
      response: failure('invalid-estimate'),
    });
  });

  test('keeps the timeout active while a response body stalls', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const response = new Response(new ReadableStream<Uint8Array>({
      start() {
        // Intentionally never closes.
      },
    }), { headers: { 'content-type': 'application/json' } });
    const fetcher = fetchMock(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return response;
    });

    const pending = createTextAiClient(fetcher).session();
    await vi.advanceTimersByTimeAsync(TEXT_AI_LIMITS.timeoutMs);

    await expect(pending).resolves.toEqual(failure('provider-timeout'));
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('clears its timeout after a successful request', async () => {
    vi.useFakeTimers();
    const fetcher = fetchMock(async () => jsonResponse(textAiSessionSuccessFixture));

    await expect(createTextAiClient(fetcher).session()).resolves.toEqual(
      textAiSessionSuccessFixture,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
