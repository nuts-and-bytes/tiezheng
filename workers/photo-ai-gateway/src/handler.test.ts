import { describe, expect, test, vi } from 'vitest';

import { PHOTO_AI_VERSIONS } from '../../../src/lib/photoAiContract';
import { stableJson } from '../../../src/lib/stableJson';
import { PhotoModelAdapterError } from './doubaoAdapter';
import type { ReserveResult } from './coordinator';
import type { GatewayEnv } from './env';
import type { BoundedPhotoUpload, SanitizedImage } from './imageFirewall';
import {
  handlePhotoAiRequest as handlePhotoAiRequestImpl,
  type HandlerDependencies,
} from './handler';

const ACCOUNT_KEY = 'a'.repeat(64);
const NOW = Date.UTC(2026, 7, 18, 4);
const LEASE_MS = 60_000;
const MONTHLY_BUDGET_MICROS = 50_000_000;
const upload: BoundedPhotoUpload = {
  bytes: Uint8Array.of(1, 2, 3),
  mime: 'image/webp',
  width: 100,
  height: 80,
  metadata: {
    requestId: 'request-1',
    idempotencyKey: 'b'.repeat(32),
    uploadBlobSha256: 'c'.repeat(64),
    modelVersion: PHOTO_AI_VERSIONS.model,
    promptVersion: PHOTO_AI_VERSIONS.prompt,
    schemaVersion: PHOTO_AI_VERSIONS.schema,
    catalogVersion: PHOTO_AI_VERSIONS.catalog,
    transformVersion: PHOTO_AI_VERSIONS.transform,
    uncertaintyVersion: PHOTO_AI_VERSIONS.uncertainty,
    providerPolicyVersion: PHOTO_AI_VERSIONS.providerPolicy,
    locale: 'zh-CN',
  },
};
const sanitized: SanitizedImage = {
  bytes: Uint8Array.of(4, 5, 6),
  mime: 'image/webp',
  width: 100,
  height: 80,
  sha256: 'd'.repeat(64),
};
const candidates = [{
  id: 'candidate-1',
  name: '无法确定',
  preparation: '无法确定做法',
  amountLow: 1,
  amountHigh: 2,
  unit: 'g' as const,
  catalogFoodId: null,
  nutrientSource: 'none' as const,
  energyKcalLow: null,
  energyKcalHigh: null,
  proteinGLow: null,
  proteinGHigh: null,
  assumptions: [],
}];

function request(headers: HeadersInit = {}): Request {
  return new Request('https://gateway.invalid/', {
    method: 'POST',
    headers: { 'x-tiezheng-account-key': ACCOUNT_KEY, ...headers },
    body: 'secret image',
  });
}

function withSignal(candidate: Request, signal: AbortSignal): Request {
  Object.defineProperty(candidate, 'signal', { configurable: true, value: signal });
  return candidate;
}

function coordinatorStub(reserveResult: ReserveResult = { kind: 'reserved', leaseId: '11111111-1111-4111-8111-111111111111' }) {
  return {
    reserve: vi.fn().mockResolvedValue(reserveResult),
    markInvoked: vi.fn().mockResolvedValue(undefined),
    abortAfterMarkBeforeProvider: vi.fn().mockResolvedValue(undefined),
    reserveRetryCost: vi.fn().mockResolvedValue(undefined),
    abortBeforeInvoke: vi.fn().mockResolvedValue(undefined),
    settleSuccess: vi.fn().mockResolvedValue(undefined),
    settleFailure: vi.fn().mockResolvedValue(undefined),
  };
}

function configuredEnv(coordinator = coordinatorStub()): GatewayEnv {
  return {
    PHOTO_AI_GATEWAY_ENABLED: 'true',
    PHOTO_AI_MODEL: 'doubao-seed-2-1-pro-260628',
    PHOTO_AI_ALLOWED_ORIGINS: 'https://photo-ai-stage2.tiezheng.pages.dev',
    PHOTO_AI_MONTHLY_BUDGET_MICROS: '50000000',
    ARK_API_KEY: 'test-ark-key',
    PHOTO_AI_CACHE_AES_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    IMAGES: {} as ImagesBinding,
    PHOTO_AI_COORDINATOR: {
      getByName: vi.fn().mockReturnValue(coordinator),
    } as unknown as GatewayEnv['PHOTO_AI_COORDINATOR'],
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function handlePhotoAiRequest(
  incoming: Request,
  env: GatewayEnv,
  overrides: Partial<HandlerDependencies> = {},
): Promise<Response> {
  return handlePhotoAiRequestImpl(incoming, env, {
    monthlyBudgetMicros: MONTHLY_BUDGET_MICROS,
    ...overrides,
  } as Partial<HandlerDependencies>);
}

async function expectedFingerprint(): Promise<string> {
  const serialized = stableJson({
    accountKey: ACCOUNT_KEY,
    uploadBlobSha256: upload.metadata.uploadBlobSha256,
    transformVersion: PHOTO_AI_VERSIONS.transform,
    modelVersion: PHOTO_AI_VERSIONS.model,
    promptVersion: PHOTO_AI_VERSIONS.prompt,
    schemaVersion: PHOTO_AI_VERSIONS.schema,
    catalogVersion: PHOTO_AI_VERSIONS.catalog,
    uncertaintyVersion: PHOTO_AI_VERSIONS.uncertainty,
    providerPolicyVersion: PHOTO_AI_VERSIONS.providerPolicy,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('private photo AI handler', () => {
  test('fails closed before reading the body when the gateway is disabled', async () => {
    const readPhotoUpload = vi.fn();
    const response = await handlePhotoAiRequest(
      new Request('https://gateway.invalid/', { method: 'POST', body: 'secret image' }),
      { PHOTO_AI_GATEWAY_ENABLED: 'false' } as GatewayEnv,
      { readPhotoUpload },
    );

    expect(response.status).toBe(503);
    expect(readPhotoUpload).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(JSON.stringify(await body(response))).not.toMatch(/stack|secret image/i);
  });

  test.each([
    'IMAGES',
    'PHOTO_AI_COORDINATOR',
    'PHOTO_AI_MODEL',
    'PHOTO_AI_MONTHLY_BUDGET_MICROS',
    'ARK_API_KEY',
    'PHOTO_AI_CACHE_AES_KEY',
  ] as const)('fails closed before reading the body when %s is missing', async (field) => {
    const readPhotoUpload = vi.fn();
    const env = configuredEnv();
    delete (env as unknown as Record<string, unknown>)[field];

    const response = await handlePhotoAiRequest(request(), env, { readPhotoUpload });

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expect(readPhotoUpload).not.toHaveBeenCalled();
  });

  test('rejects a missing or malformed account key before reading the body', async () => {
    const readPhotoUpload = vi.fn();
    const env = configuredEnv();

    for (const accountKey of [null, 'not-a-key', 'A'.repeat(64)]) {
      const invalidRequest = accountKey === null
        ? new Request('https://gateway.invalid/', { method: 'POST', body: 'secret image' })
        : request({ 'x-tiezheng-account-key': accountKey });
      const response = await handlePhotoAiRequest(invalidRequest, env, { readPhotoUpload });
      expect(response.status).toBe(503);
      expect(await body(response)).toMatchObject({ ok: false, code: 'service-disabled' });
    }
    expect(readPhotoUpload).not.toHaveBeenCalled();
  });

  test.each([
    'not-base64',
    btoa(String.fromCharCode(...new Uint8Array(31))),
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB=',
  ])('rejects a non-canonical cache encryption key before reading the body', async (key) => {
    const coordinator = coordinatorStub();
    const env = configuredEnv(coordinator);
    env.PHOTO_AI_CACHE_AES_KEY = key;
    const readPhotoUpload = vi.fn().mockRejectedValue(new Error('body was read'));

    const response = await handlePhotoAiRequest(request(), env, { readPhotoUpload });

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expect(readPhotoUpload).not.toHaveBeenCalled();
    expect(coordinator.reserve).not.toHaveBeenCalled();
  });

  test.each([
    ['zero', '0', MONTHLY_BUDGET_MICROS],
    ['above the authoritative maximum', String(MONTHLY_BUDGET_MICROS + 1), MONTHLY_BUDGET_MICROS],
    ['an unsafe integer string', String(Number.MAX_SAFE_INTEGER + 1), MONTHLY_BUDGET_MICROS],
    ['above an injected lower maximum', '11', 10],
  ])('rejects a %s monthly budget before reading the body', async (_case, budget, maximum) => {
    const coordinator = coordinatorStub();
    const env = configuredEnv(coordinator);
    env.PHOTO_AI_MONTHLY_BUDGET_MICROS = budget;
    const readPhotoUpload = vi.fn().mockRejectedValue(new Error('body was read'));

    const response = await handlePhotoAiRequest(request(), env, {
      readPhotoUpload,
      monthlyBudgetMicros: maximum,
    } as Partial<HandlerDependencies>);

    expect(response.status).toBe(503);
    expect(await body(response)).toEqual({
      ok: false,
      code: 'service-disabled',
      retryAt: null,
      resetAt: null,
    });
    expect(readPhotoUpload).not.toHaveBeenCalled();
    expect(coordinator.reserve).not.toHaveBeenCalled();
  });

  test('a fully configured request reaches bounded upload validation exactly once', async () => {
    const readPhotoUpload = vi.fn().mockRejectedValue(new TypeError('Invalid photo upload'));

    const response = await handlePhotoAiRequest(request(), configuredEnv(), { readPhotoUpload });

    expect(readPhotoUpload).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      ok: false,
      code: 'unsupported-file',
      retryAt: null,
      resetAt: null,
    });
  });

  test('reserves the exact fingerprint before Images and aborts a pre-invoke sanitation failure', async () => {
    const order: string[] = [];
    const coordinator = coordinatorStub();
    coordinator.reserve.mockImplementation(async () => {
      order.push('reserve');
      return { kind: 'reserved', leaseId: '11111111-1111-4111-8111-111111111111' };
    });
    coordinator.abortBeforeInvoke.mockImplementation(async () => { order.push('abort'); });
    const sanitizeImage = vi.fn(async () => {
      order.push('sanitize');
      throw new TypeError('private image bytes');
    });
    const estimate = vi.fn();

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage,
      createModelAdapter: vi.fn(() => ({ estimate })),
      initialAttemptReserveMicros: 2_000_000,
      now: () => NOW,
    });

    const fingerprint = await expectedFingerprint();
    expect(coordinator.reserve).toHaveBeenCalledWith({
      accountKey: ACCOUNT_KEY,
      idempotencyKey: upload.metadata.idempotencyKey,
      fingerprint,
      now: NOW,
      reserveMicros: 2_000_000,
    });
    expect(sanitizeImage).toHaveBeenCalledWith(upload, expect.anything());
    expect(order).toEqual(['reserve', 'sanitize', 'abort']);
    expect(coordinator.abortBeforeInvoke).toHaveBeenCalledWith(expect.objectContaining({
      accountKey: ACCOUNT_KEY,
      fingerprint,
      leaseId: '11111111-1111-4111-8111-111111111111',
      now: NOW,
    }));
    expect(coordinator.markInvoked).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ ok: false, code: 'decode-failed' });
  });

  test('uses a fresh clock for markInvoked so an expired lease fails closed before model work', async () => {
    const coordinator = coordinatorStub();
    let reservedAt = -1;
    coordinator.reserve.mockImplementation(async (input) => {
      reservedAt = input.now;
      return { kind: 'reserved', leaseId: '11111111-1111-4111-8111-111111111111' };
    });
    coordinator.markInvoked.mockImplementation(async (input) => {
      if (input.now > reservedAt + LEASE_MS) throw new TypeError('expired lease');
    });
    const estimate = vi.fn().mockRejectedValue(new PhotoModelAdapterError('provider-unavailable', false));
    const now = vi.fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW + LEASE_MS + 1);

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage: vi.fn().mockResolvedValue(sanitized),
      createModelAdapter: vi.fn(() => ({ estimate })),
      initialAttemptReserveMicros: 2_000_000,
      arkCostMicros: vi.fn(),
      now,
    });

    expect(coordinator.reserve).toHaveBeenCalledWith(expect.objectContaining({ now: NOW }));
    expect(coordinator.markInvoked).toHaveBeenCalledWith(expect.objectContaining({
      now: NOW + LEASE_MS + 1,
    }));
    expect(estimate).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
  });

  test('returns in-flight without touching Images or the model', async () => {
    const coordinator = coordinatorStub({ kind: 'in-flight', retryAfterMs: 750 });
    const sanitizeImage = vi.fn();
    const createModelAdapter = vi.fn();

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage,
      createModelAdapter,
      initialAttemptReserveMicros: 2_000_000,
      now: () => NOW,
    });

    expect(response.status).toBe(202);
    expect(await body(response)).toEqual({
      ok: true,
      status: 'in-flight',
      requestId: upload.metadata.requestId,
      retryAfterMs: 750,
    });
    expect(sanitizeImage).not.toHaveBeenCalled();
    expect(createModelAdapter).not.toHaveBeenCalled();
  });

  test('returns an idempotency conflict without touching Images or the model', async () => {
    const coordinator = coordinatorStub({
      kind: 'rejected',
      code: 'idempotency-conflict',
      retryAt: null,
      resetAt: null,
    });
    const sanitizeImage = vi.fn();
    const createModelAdapter = vi.fn();

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage,
      createModelAdapter,
      initialAttemptReserveMicros: 2_000_000,
      now: () => NOW,
    });

    expect(response.status).toBe(409);
    expect(await body(response)).toEqual({
      ok: false,
      code: 'idempotency-conflict',
      retryAt: null,
      resetAt: null,
    });
    expect(sanitizeImage).not.toHaveBeenCalled();
    expect(createModelAdapter).not.toHaveBeenCalled();
  });

  test.each([
    ['service-disabled', 503],
    ['quota-exceeded', 429],
    ['rate-limited', 429],
    ['budget-exceeded', 429],
  ] as const)('maps coordinator rejection %s to its closed response', async (code, status) => {
    const coordinator = coordinatorStub({ kind: 'rejected', code, retryAt: null, resetAt: null });
    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      initialAttemptReserveMicros: 2_000_000,
      now: () => NOW,
    });

    expect(response.status).toBe(status);
    expect(await body(response)).toEqual({ ok: false, code, retryAt: null, resetAt: null });
  });

  test.each([
    ['provider-timeout', 504],
    ['provider-unavailable', 503],
    ['invalid-estimate', 502],
  ] as const)('replays settled failure %s without Images or model work', async (code, status) => {
    const coordinator = coordinatorStub({ kind: 'failed', code });
    const sanitizeImage = vi.fn();
    const createModelAdapter = vi.fn();
    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage,
      createModelAdapter,
      initialAttemptReserveMicros: 2_000_000,
      now: () => NOW,
    });

    expect(response.status).toBe(status);
    expect(await body(response)).toEqual({ ok: false, code, retryAt: null, resetAt: null });
    expect(sanitizeImage).not.toHaveBeenCalled();
    expect(createModelAdapter).not.toHaveBeenCalled();
  });

  test('decrypts and validates a cached success without touching Images or the model', async () => {
    const cache = { ivBase64: 'AAAA', ciphertextBase64: 'BBBB', expiresAt: NOW + 60_000 };
    const coordinator = coordinatorStub({ kind: 'cached', cache });
    const sanitizeImage = vi.fn();
    const createModelAdapter = vi.fn();
    const fingerprint = await expectedFingerprint();
    const cachedSuccess = {
      ok: true,
      status: 'complete',
      requestId: upload.metadata.requestId,
      requestFingerprint: fingerprint,
      versions: { ...PHOTO_AI_VERSIONS },
      candidates,
    } as const;
    const decryptCandidateCache = vi.fn().mockResolvedValue(cachedSuccess);

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage,
      createModelAdapter,
      decryptCandidateCache,
      initialAttemptReserveMicros: 2_000_000,
      now: () => NOW,
    });

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual(cachedSuccess);
    expect(decryptCandidateCache).toHaveBeenCalledWith(
      cache,
      fingerprint,
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      NOW,
    );
    expect(sanitizeImage).not.toHaveBeenCalled();
    expect(createModelAdapter).not.toHaveBeenCalled();
  });

  test('marks immediately before model fetch, stores only ciphertext, and settles actual usage', async () => {
    const order: string[] = [];
    const coordinator = coordinatorStub();
    coordinator.reserve.mockImplementation(async () => {
      order.push('reserve');
      return { kind: 'reserved', leaseId: '11111111-1111-4111-8111-111111111111' };
    });
    coordinator.markInvoked.mockImplementation(async () => { order.push('mark'); });
    coordinator.settleSuccess.mockImplementation(async () => { order.push('settle'); });
    const sanitizeImage = vi.fn(async () => {
      order.push('sanitize');
      return sanitized;
    });
    const raw = { provider: 'validate-only-root' };
    const incoming = request();
    const estimate = vi.fn(async (_image: SanitizedImage, signal: AbortSignal) => {
      expect(signal).toBe(incoming.signal);
      order.push('model');
      return { raw, usage: { inputTokens: 10, outputTokens: 2 } };
    });
    const parseDoubaoEstimate = vi.fn(() => {
      order.push('parse');
      return candidates;
    });
    const fingerprint = await expectedFingerprint();
    const success = {
      ok: true,
      status: 'complete',
      requestId: upload.metadata.requestId,
      requestFingerprint: fingerprint,
      versions: { ...PHOTO_AI_VERSIONS },
      candidates,
    } as const;
    const cache = { ivBase64: 'random-iv', ciphertextBase64: 'ciphertext-only', expiresAt: NOW + 600_000 };
    const encryptCandidateCache = vi.fn(async (value: unknown) => {
      expect(value).toEqual(success);
      order.push('encrypt');
      return cache;
    });
    const arkCostMicros = vi.fn().mockReturnValue(1_234);

    const response = await handlePhotoAiRequest(incoming, configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage,
      createModelAdapter: vi.fn(() => ({ estimate })),
      parseDoubaoEstimate,
      encryptCandidateCache,
      initialAttemptReserveMicros: 2_000_000,
      resultCacheMs: 600_000,
      arkCostMicros,
      now: () => NOW,
    });

    expect(order).toEqual(['reserve', 'sanitize', 'mark', 'model', 'parse', 'encrypt', 'settle']);
    expect(coordinator.markInvoked).toHaveBeenCalledWith(expect.objectContaining({
      accountKey: ACCOUNT_KEY,
      fingerprint,
      leaseId: '11111111-1111-4111-8111-111111111111',
      now: NOW,
    }));
    expect(parseDoubaoEstimate).toHaveBeenCalledWith(raw);
    expect(arkCostMicros).toHaveBeenCalledWith(10, 2);
    expect(encryptCandidateCache).toHaveBeenCalledWith(
      success,
      fingerprint,
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      NOW + 600_000,
    );
    expect(coordinator.settleSuccess).toHaveBeenCalledWith(expect.objectContaining({
      cache,
      actualCostMicros: 1_234,
    }));
    expect(JSON.stringify(coordinator.settleSuccess.mock.calls)).not.toContain('无法确定');
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual(success);
  });

  test.each([
    ['429/5xx', 'provider-unavailable'],
    ['timeout', 'provider-timeout'],
  ] as const)('retries %s exactly once and only after reserving retry cost', async (_case, code) => {
    const order: string[] = [];
    const coordinator = coordinatorStub();
    coordinator.reserveRetryCost.mockImplementation(async () => { order.push('retry-reserve'); });
    coordinator.settleSuccess.mockImplementation(async () => { order.push('settle'); });
    const estimate = vi.fn()
      .mockImplementationOnce(async () => {
        order.push('model-1');
        throw new PhotoModelAdapterError(code, true);
      })
      .mockImplementationOnce(async () => {
        order.push('model-2');
        return { raw: { second: true }, usage: { inputTokens: 10, outputTokens: 2 } };
      });
    const parseDoubaoEstimate = vi.fn().mockReturnValue(candidates);
    const cache = { ivBase64: 'random-iv', ciphertextBase64: 'ciphertext-only', expiresAt: NOW + 600_000 };

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage: vi.fn().mockResolvedValue(sanitized),
      createModelAdapter: vi.fn(() => ({ estimate })),
      parseDoubaoEstimate,
      encryptCandidateCache: vi.fn().mockResolvedValue(cache),
      initialAttemptReserveMicros: 2_000_000,
      retryAttemptReserveMicros: 2_000_000,
      resultCacheMs: 600_000,
      arkCostMicros: vi.fn().mockReturnValue(1_234),
      now: () => NOW,
    });

    expect(estimate).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['model-1', 'retry-reserve', 'model-2', 'settle']);
    expect(coordinator.reserveRetryCost).toHaveBeenCalledWith(expect.objectContaining({
      accountKey: ACCOUNT_KEY,
      leaseId: '11111111-1111-4111-8111-111111111111',
      now: NOW,
    }));
    expect(coordinator.settleSuccess).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros: 2_001_234,
    }));
    expect(response.status).toBe(200);
  });

  test('stops after the second retryable timeout and spends the unknown worst case', async () => {
    const coordinator = coordinatorStub();
    const estimate = vi.fn().mockRejectedValue(new PhotoModelAdapterError('provider-timeout', true));

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage: vi.fn().mockResolvedValue(sanitized),
      createModelAdapter: vi.fn(() => ({ estimate })),
      initialAttemptReserveMicros: 2_000_000,
      retryAttemptReserveMicros: 2_000_000,
      resultCacheMs: 600_000,
      arkCostMicros: vi.fn(),
      now: () => NOW,
    });

    expect(estimate).toHaveBeenCalledTimes(2);
    expect(coordinator.reserveRetryCost).toHaveBeenCalledTimes(1);
    expect(coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros: null,
      errorCode: 'provider-timeout',
    }));
    expect(response.status).toBe(504);
    expect(await body(response)).toEqual({
      ok: false,
      code: 'provider-timeout',
      retryAt: null,
      resetAt: null,
    });
  });

  test('does not retry a caller-abort timeout', async () => {
    const coordinator = coordinatorStub();
    const estimate = vi.fn().mockRejectedValue(new PhotoModelAdapterError('provider-timeout', false));

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage: vi.fn().mockResolvedValue(sanitized),
      createModelAdapter: vi.fn(() => ({ estimate })),
      initialAttemptReserveMicros: 2_000_000,
      arkCostMicros: vi.fn(),
      now: () => NOW,
    });

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(coordinator.reserveRetryCost).not.toHaveBeenCalled();
    expect(coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros: null,
      errorCode: 'provider-timeout',
    }));
    expect(response.status).toBe(504);
  });

  test('compensates without model work when the caller aborts while markInvoked is pending', async () => {
    const order: string[] = [];
    const coordinator = coordinatorStub();
    const controller = new AbortController();
    coordinator.markInvoked.mockImplementation(async () => {
      order.push('mark');
      controller.abort();
    });
    coordinator.abortAfterMarkBeforeProvider.mockImplementation(async () => {
      order.push('compensate');
    });
    const estimate = vi.fn();
    const now = vi.fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW + 1)
      .mockReturnValueOnce(NOW + 2);

    const response = await handlePhotoAiRequest(
      withSignal(request(), controller.signal),
      configuredEnv(coordinator),
      {
        readPhotoUpload: vi.fn().mockResolvedValue(upload),
        sanitizeImage: vi.fn().mockResolvedValue(sanitized),
        createModelAdapter: vi.fn(() => ({ estimate })),
        initialAttemptReserveMicros: 2_000_000,
        arkCostMicros: vi.fn(),
        now,
      },
    );

    expect(order).toEqual(['mark', 'compensate']);
    expect(coordinator.markInvoked).toHaveBeenCalledWith(expect.objectContaining({ now: NOW + 1 }));
    expect(coordinator.abortAfterMarkBeforeProvider).toHaveBeenCalledWith(expect.objectContaining({
      now: NOW + 2,
    }));
    expect(estimate).not.toHaveBeenCalled();
    expect(coordinator.abortBeforeInvoke).not.toHaveBeenCalled();
    expect(coordinator.settleFailure).not.toHaveBeenCalled();
    expect(response.status).toBe(504);
  });

  test('does not reserve retry cost when attempt one aborts the caller while returning a retryable error', async () => {
    const coordinator = coordinatorStub();
    const controller = new AbortController();
    const estimate = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new PhotoModelAdapterError('provider-timeout', true);
    });

    const response = await handlePhotoAiRequest(withSignal(request(), controller.signal), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage: vi.fn().mockResolvedValue(sanitized),
      createModelAdapter: vi.fn(() => ({ estimate })),
      initialAttemptReserveMicros: 2_000_000,
      retryAttemptReserveMicros: 2_000_000,
      arkCostMicros: vi.fn(),
      now: () => NOW,
    });

    expect(estimate).toHaveBeenCalledTimes(1);
    expect(coordinator.reserveRetryCost).not.toHaveBeenCalled();
    expect(coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros: null,
      errorCode: 'provider-timeout',
    }));
    expect(response.status).toBe(504);
  });

  test('does not run attempt two when the caller aborts during retry reservation and releases the retry reserve', async () => {
    const coordinator = coordinatorStub();
    const controller = new AbortController();
    coordinator.reserveRetryCost.mockImplementation(async () => {
      controller.abort();
    });
    const estimate = vi.fn().mockRejectedValue(new PhotoModelAdapterError('provider-timeout', true));

    const response = await handlePhotoAiRequest(withSignal(request(), controller.signal), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage: vi.fn().mockResolvedValue(sanitized),
      createModelAdapter: vi.fn(() => ({ estimate })),
      initialAttemptReserveMicros: 2_000_000,
      retryAttemptReserveMicros: 2_000_000,
      arkCostMicros: vi.fn(),
      now: () => NOW,
    });

    expect(coordinator.reserveRetryCost).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros: 2_000_000,
      errorCode: 'provider-timeout',
    }));
    expect(response.status).toBe(504);
  });

  test('aborts the reservation without Images or model work when the request is already aborted before markInvoked', async () => {
    const coordinator = coordinatorStub();
    const controller = new AbortController();
    controller.abort();
    const sanitizeImage = vi.fn();
    const estimate = vi.fn();

    const response = await handlePhotoAiRequest(withSignal(request(), controller.signal), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage,
      createModelAdapter: vi.fn(() => ({ estimate })),
      initialAttemptReserveMicros: 2_000_000,
      arkCostMicros: vi.fn(),
      now: () => NOW,
    });

    expect(coordinator.abortBeforeInvoke).toHaveBeenCalledTimes(1);
    expect(sanitizeImage).not.toHaveBeenCalled();
    expect(coordinator.markInvoked).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
    expect(response.status).toBe(504);
  });

  test('invalid model output consumes the lease and returns only a fixed invalid-estimate error', async () => {
    const coordinator = coordinatorStub();
    const providerSecret = 'provider-body-private';

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage: vi.fn().mockResolvedValue(sanitized),
      createModelAdapter: vi.fn(() => ({
        estimate: vi.fn().mockResolvedValue({
          raw: { private: providerSecret },
          usage: { inputTokens: 10, outputTokens: 2 },
        }),
      })),
      parseDoubaoEstimate: vi.fn(() => { throw new TypeError(providerSecret); }),
      initialAttemptReserveMicros: 2_000_000,
      arkCostMicros: vi.fn().mockReturnValue(1_234),
      now: () => NOW,
    });

    expect(coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros: 1_234,
      errorCode: 'invalid-estimate',
    }));
    expect(response.status).toBe(502);
    const serialized = await response.text();
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      code: 'invalid-estimate',
      retryAt: null,
      resetAt: null,
    });
    expect(serialized).not.toContain(providerSecret);
  });

  test('settles an overflowing safe-integer usage as invalid without leaking the thrown cost error', async () => {
    const coordinator = coordinatorStub();
    const privateError = 'private-cost-overflow';
    const arkCostMicros = vi.fn(() => { throw new TypeError(privateError); });

    const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
      readPhotoUpload: vi.fn().mockResolvedValue(upload),
      sanitizeImage: vi.fn().mockResolvedValue(sanitized),
      createModelAdapter: vi.fn(() => ({
        estimate: vi.fn().mockResolvedValue({
          raw: { provider: 'unused' },
          usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER },
        }),
      })),
      initialAttemptReserveMicros: 2_000_000,
      arkCostMicros,
      now: () => NOW,
    });

    expect(arkCostMicros).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    expect(coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
      actualCostMicros: null,
      errorCode: 'invalid-estimate',
    }));
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const serialized = await response.text();
    expect(JSON.parse(serialized)).toEqual({
      ok: false,
      code: 'invalid-estimate',
      retryAt: null,
      resetAt: null,
    });
    expect(serialized).not.toContain(privateError);
  });

  test('encryption and settle errors return fixed JSON without leaking image, provider, or candidate data', async () => {
    const secrets = ['private-image-bytes', 'provider-private-body', '私密候选名'];
    for (const failurePoint of ['encrypt', 'settle'] as const) {
      const coordinator = coordinatorStub();
      if (failurePoint === 'settle') {
        coordinator.settleSuccess.mockRejectedValue(new Error(secrets.join('|')));
      }
      const encryptCandidateCache = failurePoint === 'encrypt'
        ? vi.fn().mockRejectedValue(new Error(secrets.join('|')))
        : vi.fn().mockResolvedValue({
            ivBase64: 'random-iv',
            ciphertextBase64: 'ciphertext-only',
            expiresAt: NOW + 600_000,
          });

      const response = await handlePhotoAiRequest(request(), configuredEnv(coordinator), {
        readPhotoUpload: vi.fn().mockResolvedValue(upload),
        sanitizeImage: vi.fn().mockResolvedValue(sanitized),
        createModelAdapter: vi.fn(() => ({
          estimate: vi.fn().mockResolvedValue({
            raw: { private: secrets[1] },
            usage: { inputTokens: 10, outputTokens: 2 },
          }),
        })),
        parseDoubaoEstimate: vi.fn().mockReturnValue([{ ...candidates[0], name: secrets[2] }]),
        encryptCandidateCache,
        initialAttemptReserveMicros: 2_000_000,
        resultCacheMs: 600_000,
        arkCostMicros: vi.fn().mockReturnValue(1_234),
        now: () => NOW,
      });

      const serialized = await response.text();
      expect(response.status).toBe(failurePoint === 'encrypt' ? 502 : 503);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(serialized).not.toMatch(/private-image-bytes|provider-private-body|私密候选名|stack/i);
      if (failurePoint === 'encrypt') {
        expect(coordinator.settleFailure).toHaveBeenCalledWith(expect.objectContaining({
          errorCode: 'invalid-estimate',
          actualCostMicros: 1_234,
        }));
      }
    }
  });
});
