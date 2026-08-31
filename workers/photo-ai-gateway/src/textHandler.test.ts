import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  TEXT_AI_LIMITS,
  TEXT_AI_VERSIONS,
  type TextAiEstimateSuccess,
} from '../../../src/lib/textAiContract';
import {
  textAiCandidateFixture,
  textAiRequestFixture,
} from '../../../src/test/textAiFixtures';
import { stableJson } from '../../../src/lib/stableJson';
import { TextModelAdapterError } from './doubaoTextAdapter';
import type { DoubaoTextOutput } from './doubaoTextSchema';
import type { TextDiagnosticRecord } from './textDiagnostics';
import type { ReserveResult } from './coordinator';
import type { GatewayEnv } from './env';
import {
  GATEWAY_CHANNEL_POLICY,
  GATEWAY_LIMITS,
  TEXT_SUCCESS_COMMIT_WINDOW_MS,
  arkCostMicros,
} from './gatewayPolicy';
import {
  TEXT_GATEWAY_RUNTIME,
  handleTextAiRequest,
  handleTextSessionRequest,
  isTextAiGatewayConfigured,
} from './textHandler';

const ACCOUNT_KEY = 'a'.repeat(64);
const NOW = Date.parse('2026-08-21T12:00:00.000Z');
const LEASE_ID = '11111111-1111-4111-8111-111111111111';
const CACHE = {
  ivBase64: 'AAAAAAAAAAAAAAAA',
  ciphertextBase64: 'BBBBBBBBBBBBBBBB',
  expiresAt: NOW + GATEWAY_LIMITS.resultCacheMs,
};

function coordinatorStub(
  reserveResult: ReserveResult = { kind: 'reserved', leaseId: LEASE_ID },
) {
  return {
    reserve: vi.fn().mockResolvedValue(reserveResult),
    markInvoked: vi.fn().mockResolvedValue(undefined),
    reserveRetryCost: vi.fn().mockResolvedValue(undefined),
    abortBeforeInvoke: vi.fn().mockResolvedValue(undefined),
    abortAfterMarkBeforeProvider: vi.fn().mockResolvedValue(undefined),
    settleSuccess: vi.fn().mockResolvedValue(undefined),
    settleFailure: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({
      enabled: true,
      accountEnabled: true,
      accountRemaining: 10,
      globalRemaining: 30,
      accountConcurrent: 0,
      globalConcurrent: 0,
      budgetSpentMicros: 0,
      budgetReservedMicros: 0,
      resetAt: '2026-08-22T04:00:00.000Z',
    }),
  };
}

function configuredEnv(overrides: Partial<GatewayEnv> = {}): GatewayEnv {
  return {
    TEXT_AI_ADMIN_ENABLED: 'false',
    TEXT_AI_GATEWAY_ENABLED: 'true',
    TEXT_AI_MAX_PROVIDER_ATTEMPTS: '1',
    TEXT_AI_MODEL: TEXT_AI_VERSIONS.model,
    PHOTO_AI_GATEWAY_ENABLED: 'true',
    PHOTO_AI_MODEL: 'doubao-seed-2-1-pro-260628',
    PHOTO_AI_ALLOWED_ORIGINS: 'https://app.example.test',
    PHOTO_AI_MONTHLY_BUDGET_MICROS: '50000000',
    ARK_API_KEY: 'test-ark-key',
    PHOTO_AI_CACHE_AES_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    PHOTO_AI_COORDINATOR: {
      getByName: vi.fn(),
    } as unknown as GatewayEnv['PHOTO_AI_COORDINATOR'],
    IMAGES: {
      info: vi.fn(),
      input: vi.fn(),
    } as unknown as ImagesBinding,
    ...overrides,
  };
}

function workerRequest(
  body: unknown = textAiRequestFixture,
  contentType = 'application/json',
  headers: HeadersInit = {},
  signal?: AbortSignal,
): Request {
  const request = new Request('https://photo-ai-gateway.internal/text/estimate', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-tiezheng-account-key': ACCOUNT_KEY,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  if (signal !== undefined) {
    Object.defineProperty(request, 'signal', { configurable: true, value: signal });
  }
  return request;
}

function rawWorkerRequest(
  body: BodyInit | null,
  headers: HeadersInit = {},
): Request {
  return new Request('https://photo-ai-gateway.internal/text/estimate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tiezheng-account-key': ACCOUNT_KEY,
      ...headers,
    },
    body,
  });
}

function trackedAbortSignal() {
  let aborted = false;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'abort') listeners.add(listener);
  });
  const removeEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'abort') listeners.delete(listener);
  });
  const signal = {
    get aborted() { return aborted; },
    addEventListener,
    removeEventListener,
  } as unknown as AbortSignal;
  return {
    signal,
    addEventListener,
    removeEventListener,
    abort() {
      if (aborted) return;
      aborted = true;
      for (const listener of [...listeners]) {
        if (typeof listener === 'function') listener.call(signal, new Event('abort'));
        else listener.handleEvent(new Event('abort'));
      }
    },
  };
}

function stalledBodyRequest(
  signal: AbortSignal,
  cancel: () => Promise<void>,
): Request {
  const stream = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
    cancel,
  });
  return {
    headers: new Headers({
      'content-type': 'application/json',
      'x-tiezheng-account-key': ACCOUNT_KEY,
    }),
    body: stream,
    signal,
  } as Request;
}

function providerCandidate() {
  const { id: _id, ...candidate } = textAiCandidateFixture;
  return { ...candidate, assumptions: [...candidate.assumptions] };
}

type ModelResult = {
  raw: DoubaoTextOutput;
  usage: { inputTokens: number; outputTokens: number } | null;
};

interface TextHandlerHarnessOptions {
  reserveResult?: ReserveResult;
  modelResults?: Array<ModelResult | TextModelAdapterError>;
  cachedSuccess?: TextAiEstimateSuccess;
  decryptError?: Error;
  maxProviderAttempts?: 1 | 2;
}

function textHandlerHarness(options: TextHandlerHarnessOptions = {}) {
  const coordinator = coordinatorStub(options.reserveResult);
  const modelResults = [...(options.modelResults ?? [{
    raw: { status: 'complete', candidate: providerCandidate() },
    usage: null,
  }])];
  const adapter = {
    estimate: vi.fn(async () => {
      const result = modelResults.shift();
      if (result === undefined) throw new Error('unexpected model call');
      if (result instanceof TextModelAdapterError) throw result;
      return result;
    }),
  };
  const encryptCandidateCache = vi.fn().mockResolvedValue(CACHE);
  const decryptCandidateCache = options.decryptError === undefined
    ? vi.fn().mockResolvedValue(options.cachedSuccess)
    : vi.fn().mockRejectedValue(options.decryptError);
  const getByName = vi.fn(() => coordinator);
  const env = configuredEnv({
    TEXT_AI_MAX_PROVIDER_ATTEMPTS: String(options.maxProviderAttempts ?? 1),
    PHOTO_AI_COORDINATOR: { getByName } as unknown as GatewayEnv['PHOTO_AI_COORDINATOR'],
  });
  const createModelAdapter = vi.fn(() => adapter);
  const parseTextEstimate = vi.fn(TEXT_GATEWAY_RUNTIME.parseDoubaoTextEstimate);

  return {
    coordinator,
    adapter,
    createModelAdapter,
    parseTextEstimate,
    encryptCandidateCache,
    decryptCandidateCache,
    getByName,
    env,
    run: (request: Request = workerRequest()) => handleTextAiRequest(request, env, {
      ...TEXT_GATEWAY_RUNTIME,
      createModelAdapter,
      parseDoubaoTextEstimate: parseTextEstimate,
      encryptCandidateCache,
      decryptCandidateCache,
      maxProviderAttempts: options.maxProviderAttempts ?? 1,
      now: () => NOW,
    }),
  };
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function expectedFingerprint(): Promise<string> {
  const serialized = stableJson({
    channel: 'text',
    accountKey: ACCOUNT_KEY,
    description: textAiRequestFixture.description,
    amount: textAiRequestFixture.amount,
    modelVersion: textAiRequestFixture.modelVersion,
    promptVersion: textAiRequestFixture.promptVersion,
    schemaVersion: textAiRequestFixture.schemaVersion,
    catalogVersion: textAiRequestFixture.catalogVersion,
    uncertaintyVersion: textAiRequestFixture.uncertaintyVersion,
    providerPolicyVersion: textAiRequestFixture.providerPolicyVersion,
    locale: textAiRequestFixture.locale,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('text gateway configuration and JSON firewall', () => {
  test.each([
    ['missing flag', (env: GatewayEnv) => { delete (env as unknown as Record<string, unknown>).TEXT_AI_GATEWAY_ENABLED; }, {}],
    ['non-exact flag', (env: GatewayEnv) => { env.TEXT_AI_GATEWAY_ENABLED = 'TRUE'; }, {}],
    ['missing model', (env: GatewayEnv) => { delete (env as unknown as Record<string, unknown>).TEXT_AI_MODEL; }, {}],
    ['model alias', (env: GatewayEnv) => { env.TEXT_AI_MODEL = 'doubao-seed-2-1-pro'; }, {}],
    ['non-canonical monthly budget', (env: GatewayEnv) => { env.PHOTO_AI_MONTHLY_BUDGET_MICROS = '050000000'; }, {}],
    ['blank API key', (env: GatewayEnv) => { env.ARK_API_KEY = '   '; }, {}],
    ['newline API key', (env: GatewayEnv) => { env.ARK_API_KEY = 'key\nleak'; }, {}],
    ['invalid cache key', (env: GatewayEnv) => { env.PHOTO_AI_CACHE_AES_KEY = 'not-a-key'; }, {}],
    ['missing coordinator', (env: GatewayEnv) => { delete (env as unknown as Record<string, unknown>).PHOTO_AI_COORDINATOR; }, {}],
    ['wrong authoritative budget', undefined, { monthlyBudgetMicros: GATEWAY_LIMITS.monthlyBudgetMicros - 1 }],
    ['wrong initial reserve', undefined, { initialAttemptReserveMicros: GATEWAY_CHANNEL_POLICY.text.initialAttemptReserveMicros - 1 }],
    ['wrong retry reserve', undefined, { retryAttemptReserveMicros: GATEWAY_CHANNEL_POLICY.text.retryAttemptReserveMicros - 1 }],
    ['wrong cache TTL', undefined, { resultCacheMs: GATEWAY_LIMITS.resultCacheMs - 1 }],
  ] as const)('fails closed before body, coordinator or model for %s', async (_label, mutate, override) => {
    const env = configuredEnv();
    const getByName = env.PHOTO_AI_COORDINATOR.getByName;
    mutate?.(env);
    const createModelAdapter = vi.fn();
    const response = await handleTextAiRequest(workerRequest(), env, {
      ...TEXT_GATEWAY_RUNTIME,
      createModelAdapter,
      ...override,
    });

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expect(getByName).not.toHaveBeenCalled();
    expect(createModelAdapter).not.toHaveBeenCalled();
  });

  test.each(['2', '01', '1 ', '1.0', ''])
    ('fails closed with zero provider or coordinator side effects for attempts env %#', async (attempts) => {
      expect(TEXT_GATEWAY_RUNTIME.maxProviderAttempts).toBe(1);
      const env = configuredEnv({ TEXT_AI_MAX_PROVIDER_ATTEMPTS: attempts });
      const getByName = env.PHOTO_AI_COORDINATOR.getByName;
      const createModelAdapter = vi.fn();

      const response = await handleTextAiRequest(workerRequest(), env, {
        ...TEXT_GATEWAY_RUNTIME,
        createModelAdapter,
      });

      expect(response.status).toBe(503);
      expect(await responseBody(response)).toEqual({
        ok: false,
        code: 'service-disabled',
        retryAt: null,
        resetAt: null,
      });
      expect(getByName).not.toHaveBeenCalled();
      expect(createModelAdapter).not.toHaveBeenCalled();
    });

  test('text configuration is independent of the photo flag, Images binding and Pages origin', () => {
    const env = configuredEnv({
      PHOTO_AI_GATEWAY_ENABLED: 'false',
      PHOTO_AI_MODEL: 'unused-for-text',
      IMAGES: null as unknown as ImagesBinding,
      PHOTO_AI_ALLOWED_ORIGINS: '' as string,
    });
    expect(isTextAiGatewayConfigured(env, TEXT_GATEWAY_RUNTIME)).toBe(true);
  });

  test.each([
    ['non-JSON content type', () => workerRequest(textAiRequestFixture, 'text/plain')],
    ['content type parameter', () => workerRequest(textAiRequestFixture, 'application/json; charset=utf-8')],
    ['extra request property', () => workerRequest({ ...textAiRequestFixture, extra: true })],
    ['description above 500 chars', () => workerRequest({ ...textAiRequestFixture, description: '面'.repeat(501) })],
    ['empty description', () => workerRequest({ ...textAiRequestFixture, description: '   ' })],
    ['model version drift', () => workerRequest({ ...textAiRequestFixture, modelVersion: 'other' })],
    ['prompt version drift', () => workerRequest({ ...textAiRequestFixture, promptVersion: 'other' })],
    ['schema version drift', () => workerRequest({ ...textAiRequestFixture, schemaVersion: 'other' })],
    ['catalog version drift', () => workerRequest({ ...textAiRequestFixture, catalogVersion: 'other' })],
    ['uncertainty version drift', () => workerRequest({ ...textAiRequestFixture, uncertaintyVersion: 'other' })],
    ['provider policy drift', () => workerRequest({ ...textAiRequestFixture, providerPolicyVersion: 'other' })],
    ['locale drift', () => workerRequest({ ...textAiRequestFixture, locale: 'en-US' })],
    ['transfer encoding metadata', () => workerRequest(textAiRequestFixture, 'application/json', { 'transfer-encoding': 'chunked' })],
    ['content encoding metadata', () => workerRequest(textAiRequestFixture, 'application/json', { 'content-encoding': 'gzip' })],
  ])('rejects invalid input before coordinator or model: %s', async (_label, makeRequest) => {
    const env = configuredEnv();
    const createModelAdapter = vi.fn();
    const response = await handleTextAiRequest(makeRequest(), env, {
      ...TEXT_GATEWAY_RUNTIME,
      createModelAdapter,
    });

    expect(response.status).toBe(502);
    expect(await responseBody(response)).toEqual({
      ok: false,
      code: 'invalid-estimate',
      retryAt: null,
      resetAt: null,
    });
    expect(env.PHOTO_AI_COORDINATOR.getByName).not.toHaveBeenCalled();
    expect(createModelAdapter).not.toHaveBeenCalled();
  });

  test.each([
    ['invalid metadata', 'text/plain', new ReadableStream<Uint8Array>({
      cancel: () => new Promise<void>(() => undefined),
    })],
    ['over-limit stream', 'application/json', new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8_193));
      },
      cancel: () => new Promise<void>(() => undefined),
    })],
  ])('does not wait for a stalled body cancellation after %s', async (_label, contentType, stream) => {
    const env = configuredEnv();
    const request = {
      headers: new Headers({
        'content-type': contentType,
        'x-tiezheng-account-key': ACCOUNT_KEY,
      }),
      body: stream,
      signal: new AbortController().signal,
    } as Request;

    const result = await Promise.race([
      handleTextAiRequest(request, env, TEXT_GATEWAY_RUNTIME),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 0)),
    ]);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(502);
    expect(env.PHOTO_AI_COORDINATOR.getByName).not.toHaveBeenCalled();
  });

  test.each(['0', '8193', '01', '+1', '-1', '1.0', '1e3', '1, 1', '9007199254740993'])
    ('rejects non-canonical or over-limit Content-Length %s', async (contentLength) => {
      const env = configuredEnv();
      const createModelAdapter = vi.fn();
      const response = await handleTextAiRequest(
        workerRequest(textAiRequestFixture, 'application/json', { 'content-length': contentLength }),
        env,
        { ...TEXT_GATEWAY_RUNTIME, createModelAdapter },
      );

      expect(response.status).toBe(502);
      expect(await responseBody(response)).toMatchObject({ ok: false, code: 'invalid-estimate' });
      expect(env.PHOTO_AI_COORDINATOR.getByName).not.toHaveBeenCalled();
      expect(createModelAdapter).not.toHaveBeenCalled();
    });

  test.each([
    ['actual body above 8192 bytes', () => rawWorkerRequest(new Uint8Array(8_193).fill(97))],
    ['empty body', () => rawWorkerRequest('')],
    ['missing body', () => rawWorkerRequest(null)],
    ['fatal UTF-8 failure', () => rawWorkerRequest(Uint8Array.of(0xc3, 0x28))],
  ])('rejects bounded stream failure before coordinator or model: %s', async (_label, makeRequest) => {
    const env = configuredEnv();
    const createModelAdapter = vi.fn();
    const response = await handleTextAiRequest(makeRequest(), env, {
      ...TEXT_GATEWAY_RUNTIME,
      createModelAdapter,
    });

    expect(response.status).toBe(502);
    expect(await responseBody(response)).toMatchObject({ ok: false, code: 'invalid-estimate' });
    expect(env.PHOTO_AI_COORDINATOR.getByName).not.toHaveBeenCalled();
    expect(createModelAdapter).not.toHaveBeenCalled();
  });

  test.each([null, 'short', 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(63)}\n`])
    ('rejects invalid account header %# as invalid input before body or coordinator', async (accountKey) => {
      const headers = new Headers({ 'content-type': 'application/json' });
      if (accountKey !== null) headers.set('x-tiezheng-account-key', accountKey);
      const env = configuredEnv();
      const response = await handleTextAiRequest(new Request(
        'https://photo-ai-gateway.internal/text/estimate',
        { method: 'POST', headers, body: JSON.stringify(textAiRequestFixture) },
      ), env, TEXT_GATEWAY_RUNTIME);

      expect(response.status).toBe(502);
      expect(await responseBody(response)).toMatchObject({ ok: false, code: 'invalid-estimate' });
      expect(env.PHOTO_AI_COORDINATOR.getByName).not.toHaveBeenCalled();
    });

  test('allows a missing Content-Length when the actual JSON stream is bounded', async () => {
    const harness = textHandlerHarness({
      reserveResult: { kind: 'in-flight', retryAfterMs: 750 },
    });
    const request = workerRequest();
    expect(request.headers.get('content-length')).toBeNull();

    const response = await harness.run(request);

    expect(response.status).toBe(202);
    expect(harness.coordinator.reserve).toHaveBeenCalledTimes(1);
  });

  test('caller abort wins a stalled body read without waiting for cancellation or the timeout', async () => {
    vi.useFakeTimers();
    const tracked = trackedAbortSignal();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const harness = textHandlerHarness();
    const request = stalledBodyRequest(tracked.signal, cancel);
    const pending = harness.run(request);
    await Promise.resolve();

    tracked.abort();
    await vi.advanceTimersByTimeAsync(1);
    const result = await Promise.race([pending, Promise.resolve(null)]);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(502);
    expect(await responseBody(result as Response)).toMatchObject({
      ok: false,
      code: 'invalid-estimate',
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(tracked.addEventListener).toHaveBeenCalledTimes(1);
    expect(tracked.removeEventListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(request.body?.locked).toBe(false);
    expect(harness.getByName).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TEXT_AI_LIMITS.timeoutMs);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('the 16 second lifecycle deadline wins a stalled body read and removes the caller listener', async () => {
    vi.useFakeTimers();
    const tracked = trackedAbortSignal();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const harness = textHandlerHarness();
    const request = stalledBodyRequest(tracked.signal, cancel);
    const pending = harness.run(request);
    await Promise.resolve();

    try {
      await vi.advanceTimersByTimeAsync(TEXT_SUCCESS_COMMIT_WINDOW_MS - 1);
      expect(await Promise.race([pending, Promise.resolve(null)])).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      const result = await Promise.race([pending, Promise.resolve(null)]);

      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(502);
      expect(await responseBody(result as Response)).toMatchObject({
        ok: false,
        code: 'invalid-estimate',
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(tracked.addEventListener).toHaveBeenCalledTimes(1);
      expect(tracked.removeEventListener).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(request.body?.locked).toBe(false);
      expect(harness.getByName).not.toHaveBeenCalled();

      tracked.abort();
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      await vi.advanceTimersByTimeAsync(TEXT_AI_LIMITS.timeoutMs);
      await pending;
    }
  });

  test('bounded request success clears its lifecycle timeout and caller listener', async () => {
    vi.useFakeTimers();
    const tracked = trackedAbortSignal();
    const harness = textHandlerHarness({
      reserveResult: { kind: 'in-flight', retryAfterMs: 750 },
    });

    const response = await harness.run(workerRequest(
      textAiRequestFixture,
      'application/json',
      {},
      tracked.signal,
    ));

    expect(response.status).toBe(202);
    expect(tracked.addEventListener).toHaveBeenCalledTimes(1);
    expect(tracked.removeEventListener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('text estimate coordination', () => {
  test('shares one 16 second budget across a delayed body and provider work', async () => {
    vi.useFakeTimers();
    const tracked = trackedAbortSignal();
    const harness = textHandlerHarness();
    const serialized = new TextEncoder().encode(JSON.stringify(textAiRequestFixture));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(serialized);
          controller.close();
        }, 5_000);
      },
    });
    const request = {
      headers: new Headers({
        'content-type': 'application/json',
        'x-tiezheng-account-key': ACCOUNT_KEY,
      }),
      body,
      signal: tracked.signal,
    } as Request;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    harness.adapter.estimate.mockImplementation(() => {
      providerStarted();
      return new Promise(() => undefined);
    });
    let response: Response | undefined;
    const pending = harness.run(request);
    void pending.then((value) => { response = value; });

    try {
      await vi.advanceTimersByTimeAsync(5_000);
      await started;
      await vi.advanceTimersByTimeAsync(10_999);
      expect(response).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);

      expect(response?.status).toBe(504);
      expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
      expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
      expect(tracked.removeEventListener).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await pending;
    } finally {
      await vi.advanceTimersByTimeAsync(TEXT_SUCCESS_COMMIT_WINDOW_MS);
      await pending;
    }
  });

  test('ends at 16 seconds when fingerprinting stalls before any coordinator side effect', async () => {
    vi.useFakeTimers();
    const tracked = trackedAbortSignal();
    const harness = textHandlerHarness();
    let rejectDigest!: (reason: Error) => void;
    let digestStarted!: () => void;
    const started = new Promise<void>((resolve) => { digestStarted = resolve; });
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(() => {
      digestStarted();
      return new Promise((_resolve, reject) => { rejectDigest = reject; });
    });
    let response: Response | undefined;
    const pending = harness.run(workerRequest(
      textAiRequestFixture,
      'application/json',
      {},
      tracked.signal,
    ));
    void pending.then((value) => { response = value; });

    try {
      await started;
      await vi.advanceTimersByTimeAsync(TEXT_SUCCESS_COMMIT_WINDOW_MS - 1);
      expect(response).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);

      expect(response?.status).toBe(504);
      expect(await response?.json()).toEqual({
        ok: false,
        code: 'provider-timeout',
        retryAt: null,
        resetAt: null,
      });
      expect(harness.getByName).not.toHaveBeenCalled();
      expect(harness.coordinator.reserve).not.toHaveBeenCalled();
      expect(tracked.removeEventListener).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      rejectDigest(new Error('fingerprint completed too late'));
      await Promise.resolve();
      await Promise.resolve();
      expect(response?.status).toBe(504);
      await pending;
    } finally {
      rejectDigest?.(new Error('test cleanup'));
      await vi.advanceTimersByTimeAsync(0);
      await pending;
    }
  });

  test('returns the original request in-flight when reserve acknowledgement is unknown at 16 seconds', async () => {
    vi.useFakeTimers();
    const tracked = trackedAbortSignal();
    const harness = textHandlerHarness();
    let resolveReserve!: (value: ReserveResult) => void;
    let reserveStarted!: () => void;
    const started = new Promise<void>((resolve) => { reserveStarted = resolve; });
    harness.coordinator.reserve.mockImplementation(() => {
      reserveStarted();
      return new Promise((resolve) => { resolveReserve = resolve; });
    });
    let response: Response | undefined;
    const pending = harness.run(workerRequest(
      textAiRequestFixture,
      'application/json',
      {},
      tracked.signal,
    ));
    void pending.then((value) => { response = value; });

    try {
      await started;
      await vi.advanceTimersByTimeAsync(TEXT_SUCCESS_COMMIT_WINDOW_MS - 1);
      expect(response).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);

      expect(response?.status).toBe(202);
      expect(await response?.json()).toEqual({
        ok: true,
        status: 'in-flight',
        requestId: textAiRequestFixture.requestId,
        retryAfterMs: 0,
      });
      expect(harness.coordinator.reserve).toHaveBeenCalledWith(expect.objectContaining({
        idempotencyKey: textAiRequestFixture.idempotencyKey,
        now: NOW,
      }));
      expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
      expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
      expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
      expect(tracked.removeEventListener).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      resolveReserve({ kind: 'reserved', leaseId: LEASE_ID });
      await Promise.resolve();
      await Promise.resolve();
      expect(response?.status).toBe(202);
      await pending;
    } finally {
      resolveReserve?.({ kind: 'reserved', leaseId: LEASE_ID });
      await vi.advanceTimersByTimeAsync(0);
      await pending;
    }
  });

  test('returns the original request in-flight when mark acknowledgement is unknown at 16 seconds', async () => {
    vi.useFakeTimers();
    const tracked = trackedAbortSignal();
    const harness = textHandlerHarness();
    let rejectMark!: (reason: Error) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    harness.coordinator.markInvoked.mockImplementation(() => {
      markStarted();
      return new Promise((_resolve, reject) => { rejectMark = reject; });
    });
    let response: Response | undefined;
    const pending = harness.run(workerRequest(
      textAiRequestFixture,
      'application/json',
      {},
      tracked.signal,
    ));
    void pending.then((value) => { response = value; });

    try {
      await started;
      await vi.advanceTimersByTimeAsync(TEXT_SUCCESS_COMMIT_WINDOW_MS - 1);
      expect(response).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);

      expect(response?.status).toBe(202);
      expect(await response?.json()).toEqual({
        ok: true,
        status: 'in-flight',
        requestId: textAiRequestFixture.requestId,
        retryAfterMs: 0,
      });
      expect(harness.coordinator.reserve).toHaveBeenCalledWith(expect.objectContaining({
        idempotencyKey: textAiRequestFixture.idempotencyKey,
        now: NOW,
      }));
      expect(harness.coordinator.markInvoked).toHaveBeenCalledWith(expect.objectContaining({
        idempotencyKey: textAiRequestFixture.idempotencyKey,
        now: NOW,
      }));
      expect(harness.coordinator.abortBeforeInvoke).not.toHaveBeenCalled();
      expect(harness.coordinator.abortAfterMarkBeforeProvider).not.toHaveBeenCalled();
      expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
      expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
      expect(tracked.removeEventListener).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      rejectMark(new Error('mark acknowledgement lost'));
      await Promise.resolve();
      await Promise.resolve();
      expect(response?.status).toBe(202);
      await pending;
    } finally {
      rejectMark?.(new Error('test cleanup'));
      await vi.advanceTimersByTimeAsync(0);
      await pending;
    }
  });

  test('complete invokes once, fingerprints private input, encrypts once and settles once', async () => {
    const harness = textHandlerHarness({
      modelResults: [{
        raw: { status: 'complete', candidate: providerCandidate() },
        usage: { inputTokens: 100, outputTokens: 20 },
      }],
    });

    const response = await harness.run();
    const result = await responseBody(response);
    const fingerprint = await expectedFingerprint();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      ok: true,
      status: 'complete',
      requestId: textAiRequestFixture.requestId,
      requestFingerprint: fingerprint,
      versions: TEXT_AI_VERSIONS,
      candidates: [{ id: 'text-candidate-1' }],
    });
    expect(JSON.stringify(result)).not.toContain(textAiRequestFixture.description);
    expect(harness.coordinator.reserve).toHaveBeenCalledWith({
      channel: 'text',
      accountKey: ACCOUNT_KEY,
      idempotencyKey: textAiRequestFixture.idempotencyKey,
      fingerprint,
      now: NOW,
      reserveMicros: GATEWAY_CHANNEL_POLICY.text.initialAttemptReserveMicros,
    });
    expect(JSON.stringify(harness.coordinator.reserve.mock.calls))
      .not.toContain(textAiRequestFixture.description);
    expect(harness.adapter.estimate).toHaveBeenCalledTimes(1);
    expect(harness.encryptCandidateCache).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
    expect(harness.coordinator.settleSuccess).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'text',
      accountKey: ACCOUNT_KEY,
      idempotencyKey: textAiRequestFixture.idempotencyKey,
      fingerprint,
      leaseId: LEASE_ID,
      cache: CACHE,
      actualCostMicros: arkCostMicros(100, 20),
    }));
  });

  test.each([
    ['null reservation', () => ({ value: null })],
    ['unknown reservation kind', () => ({ value: { kind: 'private-kind' } })],
    ['reserved extra field', () => ({
      value: { kind: 'reserved', leaseId: LEASE_ID, privateLeaseState: 'secret' },
    })],
    ['reserved invalid lease', () => ({
      value: { kind: 'reserved', leaseId: 'private-lease' },
    })],
    ['reserved non-canonical 36-character lease', () => ({
      value: { kind: 'reserved', leaseId: 'a'.repeat(36) },
    })],
    ['cached extra envelope field', () => ({
      value: { kind: 'cached', cache: { ...CACHE, privateCipherState: 'secret' } },
    })],
    ['cached accessor envelope field', () => {
      const accessor = vi.fn(() => CACHE.ivBase64);
      const cache = Object.defineProperties({}, {
        ivBase64: { enumerable: true, get: accessor },
        ciphertextBase64: { enumerable: true, value: CACHE.ciphertextBase64 },
        expiresAt: { enumerable: true, value: CACHE.expiresAt },
      });
      return { value: { kind: 'cached', cache }, accessor };
    }],
    ['in-flight extra field', () => ({
      value: { kind: 'in-flight', retryAfterMs: 750, privateQueueState: 'secret' },
    })],
    ['rejected extra field', () => ({
      value: {
        kind: 'rejected',
        code: 'quota-exceeded',
        retryAt: null,
        resetAt: null,
        privateQuotaState: 'secret',
      },
    })],
    ['rejected unknown code', () => ({
      value: {
        kind: 'rejected',
        code: 'private-quota-code',
        retryAt: null,
        resetAt: null,
      },
    })],
    ['failed unknown code', () => ({
      value: { kind: 'failed', code: 'private-provider-code' },
    })],
    ['failed extra field', () => ({
      value: { kind: 'failed', code: 'provider-unavailable', privateFailureState: 'secret' },
    })],
    ['accessor reservation kind', () => {
      const accessor = vi.fn(() => 'reserved');
      const value = Object.defineProperty({}, 'kind', { enumerable: true, get: accessor });
      return { value, accessor };
    }],
    ['unknown reservation symbol', () => ({
      value: Object.defineProperty(
        { kind: 'reserved', leaseId: LEASE_ID },
        Symbol('private-rpc-field'),
        { value: vi.fn() },
      ),
    })],
    ['non-function RPC disposer', () => ({
      value: Object.defineProperty(
        { kind: 'reserved', leaseId: LEASE_ID },
        Symbol.dispose,
        { value: 'private' },
      ),
    })],
    ['accessor RPC disposer', () => {
      const accessor = vi.fn(() => vi.fn());
      const value = Object.defineProperty(
        { kind: 'reserved', leaseId: LEASE_ID },
        Symbol.dispose,
        { get: accessor },
      );
      return { value, accessor };
    }],
    ['multiple reservation symbols', () => ({
      value: Object.defineProperties(
        { kind: 'reserved', leaseId: LEASE_ID },
        {
          [Symbol.dispose]: { value: vi.fn() },
          [Symbol('private-rpc-field')]: { value: vi.fn() },
        },
      ),
    })],
  ])('keeps the original request recoverable on %s without trusting coordinator data', async (_label, makeFixture) => {
    const fixture = makeFixture();
    const harness = textHandlerHarness({
      reserveResult: fixture.value as ReserveResult,
    });

    const response = await harness.run();
    const serialized = await response.text();

    expect(response.status).toBe(202);
    expect(JSON.parse(serialized)).toEqual({
      ok: true,
      status: 'in-flight',
      requestId: textAiRequestFixture.requestId,
      retryAfterMs: 0,
    });
    expect(serialized).not.toMatch(/private|secret/);
    if ('accessor' in fixture) expect(fixture.accessor).not.toHaveBeenCalled();
    expect(harness.coordinator.reserve).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: textAiRequestFixture.idempotencyKey,
    }));
    expect(harness.createModelAdapter).not.toHaveBeenCalled();
    expect(harness.decryptCandidateCache).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
  });

  test('accepts the Cloudflare RPC disposer on an otherwise exact reservation', async () => {
    const reservation = Object.defineProperty(
      { kind: 'reserved', leaseId: LEASE_ID },
      Symbol.dispose,
      { value: vi.fn() },
    );
    const harness = textHandlerHarness({
      reserveResult: reservation as unknown as ReserveResult,
    });

    const response = await harness.run();

    expect(response.status).toBe(200);
    expect(harness.adapter.estimate).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.markInvoked).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).toHaveBeenCalledTimes(1);
  });

  test('accepts an exact own-data reservation with a cross-realm-like plain prototype', async () => {
    const foreignObjectPrototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(foreignObjectPrototype, 'constructor', {
      configurable: true,
      value: Object,
      writable: true,
    });
    const reservation = Object.create(foreignObjectPrototype) as Record<string, unknown>;
    Object.defineProperties(reservation, {
      kind: { enumerable: true, value: 'in-flight' },
      retryAfterMs: { enumerable: true, value: 750 },
    });
    const harness = textHandlerHarness({
      reserveResult: reservation as unknown as ReserveResult,
    });

    const response = await harness.run();

    expect(response.status).toBe(202);
    expect(await responseBody(response)).toMatchObject({ status: 'in-flight', retryAfterMs: 750 });
  });

  test('returns a strictly revalidated cached success without model or settlement work', async () => {
    const fingerprint = await expectedFingerprint();
    const cachedSuccess: TextAiEstimateSuccess = {
      ok: true,
      status: 'complete',
      requestId: textAiRequestFixture.requestId,
      requestFingerprint: fingerprint,
      versions: { ...TEXT_AI_VERSIONS },
      candidates: [{
        ...textAiCandidateFixture,
        assumptions: [...textAiCandidateFixture.assumptions],
      }],
    };
    const harness = textHandlerHarness({
      reserveResult: { kind: 'cached', cache: CACHE },
      cachedSuccess,
    });

    const response = await harness.run();

    expect(response.status).toBe(200);
    expect(await responseBody(response)).toEqual(cachedSuccess);
    expect(harness.decryptCandidateCache).toHaveBeenCalledWith(
      CACHE,
      fingerprint,
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      NOW,
    );
    expect(harness.adapter.estimate).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
    expect(harness.encryptCandidateCache).not.toHaveBeenCalled();
  });

  test.each([
    ['decrypt failure', new Error('private ciphertext'), undefined],
    ['cached fingerprint mismatch', undefined, { requestFingerprint: 'b'.repeat(64) }],
    ['cached request mismatch', undefined, { requestId: '22222222-2222-4222-8222-222222222222' }],
  ] as const)('maps %s to a generic unavailable response without model work', async (_label, decryptError, override) => {
    const fingerprint = await expectedFingerprint();
    const cachedSuccess = {
      ok: true,
      status: 'complete',
      requestId: textAiRequestFixture.requestId,
      requestFingerprint: fingerprint,
      versions: { ...TEXT_AI_VERSIONS },
      candidates: [{ ...textAiCandidateFixture, assumptions: [...textAiCandidateFixture.assumptions] }],
      ...override,
    } as TextAiEstimateSuccess;
    const harness = textHandlerHarness({
      reserveResult: { kind: 'cached', cache: CACHE },
      cachedSuccess,
      decryptError,
    });

    const response = await harness.run();
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      code: 'provider-unavailable',
      retryAt: null,
      resetAt: null,
    });
    expect(serialized).not.toMatch(/ciphertext|BBBB/);
    expect(harness.decryptCandidateCache).toHaveBeenCalledTimes(1);
    expect(harness.adapter.estimate).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
  });

  test('maps an idempotency conflict without decrypt, model or settlement work', async () => {
    const harness = textHandlerHarness({
      reserveResult: {
        kind: 'rejected',
        code: 'idempotency-conflict',
        retryAt: null,
        resetAt: null,
      },
    });
    const response = await harness.run();

    expect(response.status).toBe(409);
    expect(await responseBody(response)).toMatchObject({ ok: false, code: 'idempotency-conflict' });
    expect(harness.decryptCandidateCache).not.toHaveBeenCalled();
    expect(harness.adapter.estimate).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
  });

  test('returns the exact in-flight delay without decrypt, model or settlement work', async () => {
    const harness = textHandlerHarness({
      reserveResult: { kind: 'in-flight', retryAfterMs: 750 },
    });
    const response = await harness.run();

    expect(response.status).toBe(202);
    expect(await responseBody(response)).toEqual({
      ok: true,
      status: 'in-flight',
      requestId: textAiRequestFixture.requestId,
      retryAfterMs: 750,
    });
    expect(harness.decryptCandidateCache).not.toHaveBeenCalled();
    expect(harness.adapter.estimate).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
  });

  test.each([
    ['text daily quota', 'quota-exceeded'],
    ['shared monthly budget', 'budget-exceeded'],
  ] as const)('maps %s exhaustion without model or settlement work', async (_label, code) => {
    const harness = textHandlerHarness({
      reserveResult: { kind: 'rejected', code, retryAt: null, resetAt: null },
    });
    const response = await harness.run();

    expect(response.status).toBe(429);
    expect(await responseBody(response)).toMatchObject({ ok: false, code });
    expect(harness.coordinator.reserve).toHaveBeenCalledWith(expect.objectContaining({ channel: 'text' }));
    expect(harness.adapter.estimate).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
  });

  test.each([
    ['provider-timeout', 504],
    ['provider-unavailable', 503],
    ['invalid-estimate', 502],
    ['uncertain-food', 422],
  ] as const)('maps an exact cached failure %s without starting a new lease', async (code, status) => {
    const harness = textHandlerHarness({ reserveResult: { kind: 'failed', code } });

    const response = await harness.run();

    expect(response.status).toBe(status);
    expect(await responseBody(response)).toMatchObject({ ok: false, code });
    expect(harness.createModelAdapter).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
  });

  test('retries one retryable failure only after reserving retry cost, then succeeds', async () => {
    const harness = textHandlerHarness({
      maxProviderAttempts: 2,
      modelResults: [
        new TextModelAdapterError('provider-unavailable', true),
        {
          raw: { status: 'complete', candidate: providerCandidate() },
          usage: { inputTokens: 100, outputTokens: 20 },
        },
      ],
    });
    const order: string[] = [];
    harness.adapter.estimate.mockImplementationOnce(async () => {
      order.push('model-1');
      throw new TextModelAdapterError('provider-unavailable', true);
    }).mockImplementationOnce(async () => {
      order.push('model-2');
      return {
        raw: { status: 'complete', candidate: providerCandidate() },
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    });
    harness.coordinator.reserveRetryCost.mockImplementation(async () => { order.push('retry-reserve'); });
    harness.coordinator.settleSuccess.mockImplementation(async () => { order.push('settle'); });

    const response = await harness.run();

    expect(response.status).toBe(200);
    expect(order).toEqual(['model-1', 'retry-reserve', 'model-2', 'settle']);
    expect(harness.adapter.estimate).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.reserveRetryCost).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.reserveRetryCost).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'text',
      accountKey: ACCOUNT_KEY,
      idempotencyKey: textAiRequestFixture.idempotencyKey,
      fingerprint: await expectedFingerprint(),
      leaseId: LEASE_ID,
    }));
    expect(harness.coordinator.markInvoked).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros:
        GATEWAY_CHANNEL_POLICY.text.initialAttemptReserveMicros + arkCostMicros(100, 20),
    }));
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
    expect(harness.encryptCandidateCache).toHaveBeenCalledTimes(1);
  });

  test('bounds both provider attempts to 16 seconds and settles the original lease only once', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const harness = textHandlerHarness({ maxProviderAttempts: 2 });
    const providerSignals: AbortSignal[] = [];
    let attempt = 0;
    let lateSuccess = false;
    let resolveFirstAttemptStarted!: () => void;
    const firstAttemptStarted = new Promise<void>((resolve) => {
      resolveFirstAttemptStarted = resolve;
    });
    harness.adapter.estimate.mockImplementation((...args: unknown[]) => {
      attempt += 1;
      const currentAttempt = attempt;
      if (currentAttempt === 1) resolveFirstAttemptStarted();
      const signal = args[1] as AbortSignal;
      providerSignals.push(signal);
      return new Promise<ModelResult>((resolve, reject) => {
        const delayMs = currentAttempt === 1 ? 12_000 : 8_000;
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(new TextModelAdapterError('provider-timeout', false));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          if (currentAttempt === 1) {
            reject(new TextModelAdapterError('provider-timeout', true));
            return;
          }
          lateSuccess = true;
          resolve({
            raw: { status: 'complete', candidate: providerCandidate() },
            usage: null,
          });
        }, delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    });
    let response: Response | undefined;
    const pending = harness.run(workerRequest(
      textAiRequestFixture,
      'application/json',
      {},
      caller.signal,
    ));
    void pending.then((value) => { response = value; });

    try {
      await firstAttemptStarted;
      await vi.advanceTimersByTimeAsync(12_000);
      expect(harness.coordinator.reserveRetryCost).toHaveBeenCalledOnce();
      expect(harness.adapter.estimate).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3_999);
      expect(response).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);

      expect(response?.status).toBe(504);
      expect(providerSignals).toHaveLength(2);
      expect(providerSignals[0]).not.toBe(caller.signal);
      expect(providerSignals[0]).toBe(providerSignals[1]);
      expect(providerSignals[0]?.aborted).toBe(true);
      expect(caller.signal.aborted).toBe(false);
      expect(lateSuccess).toBe(false);
      expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
      expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(lateSuccess).toBe(false);
      expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
      expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await vi.advanceTimersByTimeAsync(20_000);
      await pending;
    }
  });

  test('propagates caller abort through the provider deadline signal and clears its timer', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const harness = textHandlerHarness();
    let providerSignal: AbortSignal | undefined;
    let resolveProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      resolveProviderStarted = resolve;
    });
    harness.adapter.estimate.mockImplementation((...args: unknown[]) => {
      providerSignal = args[1] as AbortSignal;
      resolveProviderStarted();
      return new Promise<ModelResult>((_resolve, reject) => {
        const onAbort = () => reject(
          new TextModelAdapterError('provider-timeout', false),
        );
        providerSignal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    const pending = harness.run(workerRequest(
      textAiRequestFixture,
      'application/json',
      {},
      caller.signal,
    ));
    await providerStarted;

    expect(providerSignal).not.toBe(caller.signal);
    caller.abort();
    const response = await pending;
    expect(response.status).toBe(504);
    expect(providerSignal?.aborted).toBe(true);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('keeps the 16 second cutoff active when near-deadline provider success stalls in encryption', async () => {
    vi.useFakeTimers();
    const harness = textHandlerHarness();
    let resolveProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      resolveProviderStarted = resolve;
    });
    harness.adapter.estimate.mockImplementation(() => {
      resolveProviderStarted();
      return new Promise<ModelResult>((resolve) => {
        setTimeout(() => resolve({
          raw: { status: 'complete', candidate: providerCandidate() },
          usage: null,
        }), 15_999);
      });
    });
    harness.encryptCandidateCache.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(CACHE), 2);
    }));
    let response: Response | undefined;
    const pending = harness.run();
    void pending.then((value) => { response = value; });

    try {
      await providerStarted;
      await vi.advanceTimersByTimeAsync(15_999);
      expect(harness.encryptCandidateCache).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);

      expect(response?.status).toBe(504);
      expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
      expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
      expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await vi.advanceTimersByTimeAsync(100);
      await pending;
    }
  });

  test('bounds an unresponsive success settlement and closes the lease as one terminal failure', async () => {
    vi.useFakeTimers();
    const harness = textHandlerHarness();
    let resolveSettlement!: () => void;
    let resolveSettlementStarted!: () => void;
    const settlementStarted = new Promise<void>((resolve) => {
      resolveSettlementStarted = resolve;
    });
    harness.coordinator.settleSuccess.mockImplementation(() => {
      resolveSettlementStarted();
      return new Promise<void>((resolve) => { resolveSettlement = resolve; });
    });
    let response: Response | undefined;
    const pending = harness.run();
    void pending.then((value) => { response = value; });

    try {
      await settlementStarted;
      await vi.advanceTimersByTimeAsync(16_000);

      expect(response?.status).toBe(504);
      expect(harness.coordinator.settleSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ commitDeadlineAt: NOW + 16_000 }),
      );
      expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      resolveSettlement();
      await vi.advanceTimersByTimeAsync(0);
      await pending;
    }
  });

  test('returns in-flight when success may have committed but both RPC acknowledgements are lost', async () => {
    const harness = textHandlerHarness();
    harness.coordinator.settleSuccess.mockRejectedValue(new Error('success response lost'));
    harness.coordinator.settleFailure.mockRejectedValue(new Error('lease already committed'));

    const response = await harness.run();

    expect(response.status).toBe(202);
    expect(await responseBody(response)).toEqual({
      ok: true,
      status: 'in-flight',
      requestId: textAiRequestFixture.requestId,
      retryAfterMs: 0,
    });
    expect(harness.coordinator.settleSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ commitDeadlineAt: NOW + 16_000 }),
    );
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
  });

  test('does not retry a non-retryable provider failure and settles once', async () => {
    const harness = textHandlerHarness({
      maxProviderAttempts: 2,
      modelResults: [new TextModelAdapterError('provider-unavailable', false)],
    });
    const response = await harness.run();

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ ok: false, code: 'provider-unavailable' });
    expect(harness.adapter.estimate).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.reserveRetryCost).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.encryptCandidateCache).not.toHaveBeenCalled();
  });

  test('maxProviderAttempts=1 settles a retryable provider failure after one attempt', async () => {
    const harness = textHandlerHarness({
      maxProviderAttempts: 1,
      modelResults: [new TextModelAdapterError('provider-unavailable', true)],
    });

    const response = await harness.run();

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({
      ok: false,
      code: 'provider-unavailable',
    });
    expect(harness.adapter.estimate).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.reserveRetryCost).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'provider-unavailable',
      actualCostMicros: null,
    }));
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
  });

  test.each([
    ['unknown provider code', () => {
      const error = new TextModelAdapterError('provider-unavailable', true);
      Object.defineProperty(error, 'code', { configurable: true, value: 'private-code' });
      return { error };
    }],
    ['accessor provider code', () => {
      const error = new TextModelAdapterError('provider-unavailable', true);
      const accessor = vi.fn(() => 'private-code');
      Object.defineProperty(error, 'code', { configurable: true, get: accessor });
      return { error, accessor };
    }],
    ['extra provider error field', () => {
      const error = new TextModelAdapterError('provider-unavailable', true);
      Object.defineProperty(error, 'privateProviderState', { value: 'secret' });
      return { error };
    }],
    ['mutated provider error message', () => {
      const error = new TextModelAdapterError('provider-unavailable', true);
      Object.defineProperty(error, 'message', { configurable: true, value: 'private message' });
      return { error };
    }],
    ['plain runtime error with provider-like fields', () => ({
      error: { code: 'private-code', retryable: true, privateRuntimeState: 'secret' },
    })],
  ])('normalizes %s to one fixed non-retryable settlement', async (_label, makeFixture) => {
    const fixture = makeFixture();
    const harness = textHandlerHarness({ maxProviderAttempts: 2 });
    harness.adapter.estimate.mockRejectedValueOnce(fixture.error);

    const response = await harness.run();
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toMatchObject({ ok: false, code: 'provider-unavailable' });
    expect(serialized).not.toMatch(/private|secret/);
    if ('accessor' in fixture) expect(fixture.accessor).not.toHaveBeenCalled();
    expect(harness.adapter.estimate).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.reserveRetryCost).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'provider-unavailable',
    }));
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
  });

  test.each([
    ['null adapter result', () => ({ value: null })],
    ['extra adapter result field', () => ({
      value: {
        raw: { status: 'complete', candidate: providerCandidate() },
        usage: null,
        privateAdapterState: 'secret',
      },
    })],
    ['accessor adapter usage', () => {
      const accessor = vi.fn(() => null);
      const value = Object.defineProperties({}, {
        raw: { enumerable: true, value: { status: 'complete', candidate: providerCandidate() } },
        usage: { enumerable: true, get: accessor },
      });
      return { value, accessor };
    }],
    ['extra usage field', () => ({
      value: {
        raw: { status: 'complete', candidate: providerCandidate() },
        usage: { inputTokens: 100, outputTokens: 20, privateUsageState: 'secret' },
      },
    })],
  ])('rejects %s after mark with exactly one invalid-estimate settlement', async (_label, makeFixture) => {
    const fixture = makeFixture();
    const harness = textHandlerHarness();
    harness.adapter.estimate.mockResolvedValueOnce(fixture.value as never);

    const response = await harness.run();
    const serialized = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(serialized)).toMatchObject({ ok: false, code: 'invalid-estimate' });
    expect(serialized).not.toMatch(/private|secret/);
    if ('accessor' in fixture) expect(fixture.accessor).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'invalid-estimate',
    }));
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.encryptCandidateCache).not.toHaveBeenCalled();
  });

  test('does not retry or double-settle when the failure settlement itself rejects', async () => {
    const harness = textHandlerHarness();
    harness.adapter.estimate.mockResolvedValueOnce(null as never);
    harness.coordinator.settleFailure.mockRejectedValue(new Error('private coordinator state'));

    const response = await harness.run();
    const serialized = await response.text();

    expect(response.status).toBe(202);
    expect(JSON.parse(serialized)).toEqual({
      ok: true,
      status: 'in-flight',
      requestId: textAiRequestFixture.requestId,
      retryAfterMs: 0,
    });
    expect(serialized).not.toContain('private coordinator state');
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
  });

  test('bounds an unresponsive failure settlement and keeps the original request recoverable', async () => {
    vi.useFakeTimers();
    const harness = textHandlerHarness();
    harness.adapter.estimate.mockResolvedValueOnce(null as never);
    let resolveSettlementStarted!: () => void;
    const settlementStarted = new Promise<void>((resolve) => {
      resolveSettlementStarted = resolve;
    });
    harness.coordinator.settleFailure.mockImplementation(() => {
      resolveSettlementStarted();
      return new Promise<void>(() => undefined);
    });
    let response: Response | undefined;

    try {
      const pending = harness.run().then((value) => { response = value; });
      await settlementStarted;
      await vi.advanceTimersByTimeAsync(16_000);

      expect(response?.status).toBe(202);
      expect(await response?.json()).toEqual({
        ok: true,
        status: 'in-flight',
        requestId: textAiRequestFixture.requestId,
        retryAfterMs: 0,
      });
      expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
      expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    ['null parser result', () => ({ value: null })],
    ['extra parser result field', () => ({
      value: {
        status: 'complete',
        candidate: providerCandidate(),
        privateParserState: 'secret',
      },
    })],
    ['accessor parser status', () => {
      const accessor = vi.fn(() => 'complete');
      const value = Object.defineProperties({}, {
        status: { enumerable: true, get: accessor },
        candidate: { enumerable: true, value: providerCandidate() },
      });
      return { value, accessor };
    }],
    ['extra parser candidate field', () => ({
      value: {
        status: 'complete',
        candidate: { ...providerCandidate(), privateCandidateState: 'secret' },
      },
    })],
  ])('strictly revalidates %s before response and cache construction', async (_label, makeFixture) => {
    const fixture = makeFixture();
    const harness = textHandlerHarness();
    harness.parseTextEstimate.mockReturnValueOnce(fixture.value as never);

    const response = await harness.run();
    const serialized = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(serialized)).toMatchObject({ ok: false, code: 'invalid-estimate' });
    expect(serialized).not.toMatch(/private|secret/);
    if ('accessor' in fixture) expect(fixture.accessor).not.toHaveBeenCalled();
    expect(harness.coordinator.markInvoked).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'invalid-estimate',
    }));
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.encryptCandidateCache).not.toHaveBeenCalled();
  });

  test('stops after two retryable failures and settles once', async () => {
    const harness = textHandlerHarness({
      maxProviderAttempts: 2,
      modelResults: [
        new TextModelAdapterError('provider-unavailable', true),
        new TextModelAdapterError('provider-unavailable', true),
      ],
    });
    const response = await harness.run();

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ ok: false, code: 'provider-unavailable' });
    expect(harness.adapter.estimate).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.reserveRetryCost).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
    expect(harness.encryptCandidateCache).not.toHaveBeenCalled();
  });

  test('settles uncertain output with its fixed failure and creates no success cache', async () => {
    const harness = textHandlerHarness({
      modelResults: [{
        raw: { status: 'uncertain', candidate: null },
        usage: null,
      }],
    });
    const response = await harness.run();

    expect(response.status).toBe(422);
    expect(await responseBody(response)).toEqual({
      ok: false,
      code: 'uncertain-food',
      retryAt: null,
      resetAt: null,
    });
    expect(harness.coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'text',
      accountKey: ACCOUNT_KEY,
      idempotencyKey: textAiRequestFixture.idempotencyKey,
      fingerprint: await expectedFingerprint(),
      leaseId: LEASE_ID,
      errorCode: 'uncertain-food',
    }));
    expect(harness.encryptCandidateCache).not.toHaveBeenCalled();
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
  });

  test('uses Ark usage cost in exactly one success settlement', async () => {
    const harness = textHandlerHarness({
      modelResults: [{
        raw: { status: 'complete', candidate: providerCandidate() },
        usage: { inputTokens: 100, outputTokens: 20 },
      }],
    });
    await harness.run();

    expect(harness.coordinator.settleSuccess).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros: arkCostMicros(100, 20),
    }));
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
  });

  test('settleSuccess rejection attempts one fixed failure settlement without leaking state', async () => {
    const harness = textHandlerHarness();
    harness.coordinator.settleSuccess.mockRejectedValue(new Error('private settlement state'));

    const response = await harness.run();
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(serialized)).toMatchObject({ ok: false, code: 'provider-unavailable' });
    expect(serialized).not.toContain('private settlement state');
    expect(harness.coordinator.settleSuccess).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'provider-unavailable',
    }));
  });
});

describe('text estimate privacy-safe diagnostics', () => {
  test('stops a replayed failure trace before adapter or provider stages', async () => {
    const harness = textHandlerHarness({
      reserveResult: { kind: 'failed', code: 'provider-timeout' },
    });
    (harness.env as GatewayEnv & { TEXT_AI_DIAGNOSTICS_ENABLED: string })
      .TEXT_AI_DIAGNOSTICS_ENABLED = 'true';
    const records: TextDiagnosticRecord[] = [];
    vi.spyOn(console, 'log').mockImplementation((record: unknown) => {
      records.push(structuredClone(record as TextDiagnosticRecord));
    });

    const response = await harness.run();

    expect(response.status).toBe(504);
    expect(records.map(({ stage }) => stage)).toEqual([
      'request-received',
      'gateway-ready',
      'body-parsed',
      'fingerprint-ready',
      'reservation-pending',
      'reservation-failed',
    ]);
    expect(records.at(-1)).toMatchObject({
      code: 'provider-timeout',
      reservationKind: 'failed',
    });
    expect(records.some(({ stage }) => stage === 'provider-started')).toBe(false);
    expect(JSON.stringify(records)).not.toMatch(
      /私密|description|account|email|access|api.?key|model.?response/i,
    );
  });

  test('marks the provider boundary and successful response without request content', async () => {
    const harness = textHandlerHarness();
    (harness.env as GatewayEnv & { TEXT_AI_DIAGNOSTICS_ENABLED: string })
      .TEXT_AI_DIAGNOSTICS_ENABLED = 'true';
    const records: TextDiagnosticRecord[] = [];
    vi.spyOn(console, 'log').mockImplementation((record: unknown) => {
      records.push(structuredClone(record as TextDiagnosticRecord));
    });

    const response = await harness.run(workerRequest({
      ...textAiRequestFixture,
      description: '私密餐食描述',
    }));

    expect(response.status).toBe(200);
    expect(records.map(({ stage }) => stage)).toEqual([
      'request-received',
      'gateway-ready',
      'body-parsed',
      'fingerprint-ready',
      'reservation-pending',
      'reservation-reserved',
      'adapter-ready',
      'provider-mark-pending',
      'provider-marked',
      'provider-started',
      'provider-succeeded',
      'response-succeeded',
    ]);
    expect(new Set(records.map(({ traceId }) => traceId)).size).toBe(1);
    expect(JSON.stringify(records)).not.toMatch(
      /私密餐食描述|description|account|email|access|api.?key|model.?response/i,
    );
  });

  test('finishes a cached success trace without provider stages or request content', async () => {
    const fingerprint = await expectedFingerprint();
    const cachedSuccess: TextAiEstimateSuccess = {
      ok: true,
      status: 'complete',
      requestId: textAiRequestFixture.requestId,
      requestFingerprint: fingerprint,
      versions: { ...TEXT_AI_VERSIONS },
      candidates: [{
        ...textAiCandidateFixture,
        assumptions: [...textAiCandidateFixture.assumptions],
      }],
    };
    const harness = textHandlerHarness({
      reserveResult: { kind: 'cached', cache: CACHE },
      cachedSuccess,
    });
    (harness.env as GatewayEnv & { TEXT_AI_DIAGNOSTICS_ENABLED: string })
      .TEXT_AI_DIAGNOSTICS_ENABLED = 'true';
    const records: TextDiagnosticRecord[] = [];
    vi.spyOn(console, 'log').mockImplementation((record: unknown) => {
      records.push(structuredClone(record as TextDiagnosticRecord));
    });

    const response = await harness.run();

    expect(response.status).toBe(200);
    expect(records.map(({ stage }) => stage)).toEqual([
      'request-received',
      'gateway-ready',
      'body-parsed',
      'fingerprint-ready',
      'reservation-pending',
      'reservation-cached',
      'response-succeeded',
    ]);
    expect(records.some(({ stage }) => stage.startsWith('provider-'))).toBe(false);
    expect(JSON.stringify(records)).not.toMatch(
      /牛肉面一碗，少油|description|account|email|access|api.?key|model.?response/i,
    );
  });
});

describe('text estimate failure cleanup', () => {
  test('aborts a reserved lease before invocation when the caller aborts during reserve', async () => {
    const controller = new AbortController();
    const harness = textHandlerHarness();
    harness.coordinator.reserve.mockImplementation(async () => {
      controller.abort();
      return { kind: 'reserved', leaseId: LEASE_ID };
    });

    const response = await harness.run(workerRequest(
      textAiRequestFixture,
      'application/json',
      {},
      controller.signal,
    ));

    expect(response.status).toBe(504);
    expect(harness.coordinator.abortBeforeInvoke).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'text',
      accountKey: ACCOUNT_KEY,
      idempotencyKey: textAiRequestFixture.idempotencyKey,
      fingerprint: await expectedFingerprint(),
      leaseId: LEASE_ID,
    }));
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.adapter.estimate).not.toHaveBeenCalled();
  });

  test('compensates after mark when the caller aborts before provider work', async () => {
    const controller = new AbortController();
    const harness = textHandlerHarness();
    harness.coordinator.markInvoked.mockImplementation(async () => { controller.abort(); });

    const response = await harness.run(workerRequest(
      textAiRequestFixture,
      'application/json',
      {},
      controller.signal,
    ));

    expect(response.status).toBe(504);
    expect(harness.coordinator.abortAfterMarkBeforeProvider).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'text',
      accountKey: ACCOUNT_KEY,
      idempotencyKey: textAiRequestFixture.idempotencyKey,
      fingerprint: await expectedFingerprint(),
      leaseId: LEASE_ID,
    }));
    expect(harness.adapter.estimate).not.toHaveBeenCalled();
  });

  test('aborts before invocation when adapter construction fails', async () => {
    const harness = textHandlerHarness();
    harness.createModelAdapter.mockImplementation(() => { throw new Error('private secret'); });

    const response = await harness.run();

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ ok: false, code: 'service-disabled' });
    expect(harness.coordinator.abortBeforeInvoke).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
  });

  test('aborts before invocation when adapter construction returns null', async () => {
    const harness = textHandlerHarness();
    harness.createModelAdapter.mockReturnValue(null as never);

    const response = await harness.run();

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ ok: false, code: 'service-disabled' });
    expect(harness.coordinator.abortBeforeInvoke).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.markInvoked).not.toHaveBeenCalled();
    expect(harness.coordinator.settleFailure).not.toHaveBeenCalled();
  });

  test('settles parser rejection as invalid-estimate without leaking provider output', async () => {
    const harness = textHandlerHarness({
      modelResults: [{
        raw: { private: 'provider-output' } as unknown as DoubaoTextOutput,
        usage: null,
      }],
    });
    const response = await harness.run();
    const serialized = await response.text();

    expect(response.status).toBe(502);
    expect(serialized).not.toContain('provider-output');
    expect(harness.coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'text',
      errorCode: 'invalid-estimate',
    }));
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
  });

  test('settles encryption failure once and never exposes description, keys or crypto errors', async () => {
    const privateDescription = '私密餐食描述';
    const privateRequest = { ...textAiRequestFixture, description: privateDescription };
    const harness = textHandlerHarness();
    harness.env.ARK_API_KEY = 'private-ark-key';
    harness.encryptCandidateCache.mockRejectedValue(new Error('private crypto details'));

    const response = await harness.run(workerRequest(privateRequest));
    const serialized = await response.text();

    expect(response.status).toBe(502);
    expect(serialized).not.toMatch(/私密餐食描述|private-ark-key|crypto details/);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'text',
      errorCode: 'invalid-estimate',
    }));
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
  });

  test('fails closed when retry reservation fails and settles the invoked lease once', async () => {
    const harness = textHandlerHarness({
      maxProviderAttempts: 2,
      modelResults: [new TextModelAdapterError('provider-unavailable', true)],
    });
    harness.coordinator.reserveRetryCost.mockRejectedValue(new Error('private budget state'));

    const response = await harness.run();

    expect(response.status).toBe(503);
    expect(harness.adapter.estimate).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.reserveRetryCost).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleFailure).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.settleSuccess).not.toHaveBeenCalled();
  });
});

describe('private text routes', () => {
  test('serves text session from text configuration and text coordinator status', async () => {
    const coordinator = coordinatorStub();
    const getByName = vi.fn(() => coordinator);
    const env = configuredEnv({
      PHOTO_AI_COORDINATOR: { getByName } as unknown as GatewayEnv['PHOTO_AI_COORDINATOR'],
    });
    const response = await handleTextSessionRequest(new Request(
      'https://photo-ai-gateway.internal/text/session',
      { headers: { 'x-tiezheng-account-key': ACCOUNT_KEY } },
    ), env);

    expect(response.status).toBe(200);
    expect(await responseBody(response)).toEqual({
      ok: true,
      enabled: true,
      accountRemaining: 10,
      globalRemaining: 30,
      resetAt: '2026-08-22T04:00:00.000Z',
    });
    expect(coordinator.status).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'text',
      accountKey: ACCOUNT_KEY,
    }));
  });

  test('fails text session closed before coordinator access when text is disabled', async () => {
    const coordinator = coordinatorStub();
    const getByName = vi.fn(() => coordinator);
    const env = configuredEnv({
      TEXT_AI_GATEWAY_ENABLED: 'false',
      PHOTO_AI_COORDINATOR: { getByName } as unknown as GatewayEnv['PHOTO_AI_COORDINATOR'],
    });

    const response = await handleTextSessionRequest(new Request(
      'https://photo-ai-gateway.internal/text/session',
      { headers: { 'x-tiezheng-account-key': ACCOUNT_KEY } },
    ), env);

    expect(response.status).toBe(503);
    expect(await responseBody(response)).toMatchObject({ ok: false, code: 'service-disabled' });
    expect(getByName).not.toHaveBeenCalled();
  });
});
