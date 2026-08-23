import {
  TEXT_AI_LIMITS,
  TEXT_AI_VERSIONS,
  parseTextAiEstimateRequest,
  parseTextAiEstimateResponse,
  parseTextAiSessionResponse,
  type TextAiErrorCode,
  type TextAiEstimateSuccess,
} from '../../../src/lib/textAiContract';
import { stableJson } from '../../../src/lib/stableJson';
import type {
  CoordinatorFailureCode,
  EncryptedCandidateCache,
  LeaseInput,
  ReserveResult,
} from './coordinator';
import {
  decryptCandidateCache,
  encryptCandidateCache,
  isValidCacheEncryptionKey,
} from './cryptoCache';
import {
  createDoubaoTextAdapter,
  TextModelAdapterError,
  type TextModelAdapter,
} from './doubaoTextAdapter';
import { parseDoubaoTextEstimate } from './doubaoTextSchema';
import type { GatewayEnv } from './env';
import {
  GATEWAY_CHANNEL_POLICY,
  GATEWAY_LIMITS,
  arkCostMicros,
} from './gatewayPolicy';

export interface TextHandlerDependencies {
  createModelAdapter(apiKey: string): TextModelAdapter;
  parseDoubaoTextEstimate: typeof parseDoubaoTextEstimate;
  encryptCandidateCache: typeof encryptCandidateCache;
  decryptCandidateCache: typeof decryptCandidateCache;
  monthlyBudgetMicros: number;
  initialAttemptReserveMicros: number;
  retryAttemptReserveMicros: number;
  resultCacheMs: number;
  now(): number;
}

export const TEXT_GATEWAY_RUNTIME: TextHandlerDependencies = Object.freeze({
  createModelAdapter: createDoubaoTextAdapter,
  parseDoubaoTextEstimate,
  encryptCandidateCache,
  decryptCandidateCache,
  monthlyBudgetMicros: GATEWAY_LIMITS.monthlyBudgetMicros,
  initialAttemptReserveMicros: GATEWAY_CHANNEL_POLICY.text.initialAttemptReserveMicros,
  retryAttemptReserveMicros: GATEWAY_CHANNEL_POLICY.text.retryAttemptReserveMicros,
  resultCacheMs: GATEWAY_LIMITS.resultCacheMs,
  now: Date.now,
});

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;
const CANONICAL_POSITIVE_LENGTH = /^[1-9]\d*$/;
const ACCOUNT_KEY = /^[a-f0-9]{64}$/;
const LEASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_IN_FLIGHT_RETRY_AFTER_MS = 60_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const BODY_READ_TIMEOUT_MS = TEXT_AI_LIMITS.timeoutMs;
const PARSED_CANDIDATE_FIELDS = [
  'name',
  'preparation',
  'amountLow',
  'amountHigh',
  'unit',
  'catalogFoodId',
  'nutrientSource',
  'energyKcalLow',
  'energyKcalHigh',
  'proteinGLow',
  'proteinGHigh',
  'assumptions',
] as const;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BYTE_LENGTH = typedArrayGetter('byteLength');
const TYPED_ARRAY_LENGTH = typedArrayGetter('length');
const TYPED_ARRAY_TAG = typedArrayGetter(Symbol.toStringTag);
const UINT8_ARRAY_SET = Uint8Array.prototype.set;

type OwnDataSnapshot = ReadonlyMap<string, unknown>;
type AdapterEstimate = Awaited<ReturnType<TextModelAdapter['estimate']>>;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

function failure(code: TextAiErrorCode, status: number): Response {
  return jsonResponse({ ok: false, code, retryAt: null, resetAt: null }, status);
}

function coordinatorFailureStatus(code: CoordinatorFailureCode): number {
  if (code === 'provider-timeout') return 504;
  if (code === 'invalid-estimate') return 502;
  if (code === 'uncertain-food') return 422;
  return 503;
}

function cancelSilently(stream: ReadableStream<Uint8Array> | null): void {
  if (stream === null) return;
  try {
    void stream.cancel().catch(() => undefined);
  } catch {
    // Input errors always return the same closed response.
  }
}

function invalidBody(stream: ReadableStream<Uint8Array> | null): never {
  cancelSilently(stream);
  throw new TypeError('Invalid text request body');
}

function typedArrayGetter(property: PropertyKey): (this: unknown) => unknown {
  const getter = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, property)?.get;
  if (typeof getter !== 'function') throw new TypeError('Missing typed array intrinsic');
  return getter;
}

function uint8ArrayLength(value: unknown): number {
  let byteLength: unknown;
  let length: unknown;
  let tag: unknown;
  try {
    byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, value, []);
    length = Reflect.apply(TYPED_ARRAY_LENGTH, value, []);
    tag = Reflect.apply(TYPED_ARRAY_TAG, value, []);
  } catch {
    throw new TypeError('Invalid text request body');
  }
  if (
    tag !== 'Uint8Array'
    || !Number.isSafeInteger(byteLength)
    || !Number.isSafeInteger(length)
    || byteLength !== length
  ) {
    throw new TypeError('Invalid text request body');
  }
  return length as number;
}

function invalidRuntimeValue(): never {
  throw new TypeError('Invalid text gateway runtime value');
}

function isPlainRecordPrototype(prototype: object | null): boolean {
  if (prototype === null) return true;
  try {
    if (Object.getPrototypeOf(prototype) !== null) return false;
    const constructorDescriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    if (
      constructorDescriptor === undefined
      || !Object.hasOwn(constructorDescriptor, 'value')
      || typeof constructorDescriptor.value !== 'function'
    ) {
      return false;
    }
    const nameDescriptor = Object.getOwnPropertyDescriptor(
      constructorDescriptor.value,
      'name',
    );
    return nameDescriptor !== undefined
      && Object.hasOwn(nameDescriptor, 'value')
      && nameDescriptor.value === 'Object';
  } catch {
    return false;
  }
}

function ownDataSnapshot(value: unknown): OwnDataSnapshot {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalidRuntimeValue();
    }
    if (!isPlainRecordPrototype(Object.getPrototypeOf(value))) return invalidRuntimeValue();

    const snapshot = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return invalidRuntimeValue();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return invalidRuntimeValue();
      }
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return invalidRuntimeValue();
  }
}

function exactOwnDataSnapshot(
  value: unknown,
  expectedKeys: readonly string[],
): OwnDataSnapshot {
  const snapshot = ownDataSnapshot(value);
  if (
    snapshot.size !== expectedKeys.length
    || expectedKeys.some((key) => !snapshot.has(key))
  ) {
    return invalidRuntimeValue();
  }
  return snapshot;
}

function nonNegativeSafeInteger(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || Object.is(value, -0)
    || value < 0
  ) {
    return invalidRuntimeValue();
  }
  return value;
}

function safeRuntimeNow(value: unknown): number {
  const now = nonNegativeSafeInteger(value);
  if (now > MAX_DATE_MS) return invalidRuntimeValue();
  return now;
}

function nullableCanonicalInstant(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 120) {
    return invalidRuntimeValue();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    return invalidRuntimeValue();
  }
  return value;
}

function normalizedCache(value: unknown): EncryptedCandidateCache {
  const snapshot = exactOwnDataSnapshot(value, [
    'ivBase64',
    'ciphertextBase64',
    'expiresAt',
  ]);
  const ivBase64 = snapshot.get('ivBase64');
  const ciphertextBase64 = snapshot.get('ciphertextBase64');
  const expiresAt = nonNegativeSafeInteger(snapshot.get('expiresAt'));
  if (
    typeof ivBase64 !== 'string'
    || ivBase64.length < 4
    || ivBase64.length > 256
    || !BASE64.test(ivBase64)
    || typeof ciphertextBase64 !== 'string'
    || ciphertextBase64.length < 4
    || ciphertextBase64.length > 400_000
    || !BASE64.test(ciphertextBase64)
    || expiresAt < 1
    || expiresAt > MAX_DATE_MS
  ) {
    return invalidRuntimeValue();
  }
  return { ivBase64, ciphertextBase64, expiresAt };
}

function coordinatorFailureCode(value: unknown): CoordinatorFailureCode {
  if (
    value !== 'provider-timeout'
    && value !== 'provider-unavailable'
    && value !== 'invalid-estimate'
    && value !== 'uncertain-food'
  ) {
    return invalidRuntimeValue();
  }
  return value;
}

function normalizedReservation(value: unknown): ReserveResult {
  const snapshot = ownDataSnapshot(value);
  const kind = snapshot.get('kind');
  if (kind === 'reserved') {
    if (snapshot.size !== 2 || !snapshot.has('leaseId')) return invalidRuntimeValue();
    const leaseId = snapshot.get('leaseId');
    if (typeof leaseId !== 'string' || !LEASE_ID.test(leaseId)) return invalidRuntimeValue();
    return { kind, leaseId };
  }
  if (kind === 'cached') {
    if (snapshot.size !== 2 || !snapshot.has('cache')) return invalidRuntimeValue();
    return { kind, cache: normalizedCache(snapshot.get('cache')) };
  }
  if (kind === 'in-flight') {
    if (snapshot.size !== 2 || !snapshot.has('retryAfterMs')) return invalidRuntimeValue();
    const retryAfterMs = nonNegativeSafeInteger(snapshot.get('retryAfterMs'));
    if (retryAfterMs > MAX_IN_FLIGHT_RETRY_AFTER_MS) return invalidRuntimeValue();
    return { kind, retryAfterMs };
  }
  if (kind === 'failed') {
    if (snapshot.size !== 2 || !snapshot.has('code')) return invalidRuntimeValue();
    return { kind, code: coordinatorFailureCode(snapshot.get('code')) };
  }
  if (kind === 'rejected') {
    if (
      snapshot.size !== 4
      || !snapshot.has('code')
      || !snapshot.has('retryAt')
      || !snapshot.has('resetAt')
    ) {
      return invalidRuntimeValue();
    }
    const code = snapshot.get('code');
    if (
      code !== 'service-disabled'
      && code !== 'quota-exceeded'
      && code !== 'rate-limited'
      && code !== 'budget-exceeded'
      && code !== 'idempotency-conflict'
    ) {
      return invalidRuntimeValue();
    }
    return {
      kind,
      code,
      retryAt: nullableCanonicalInstant(snapshot.get('retryAt')),
      resetAt: nullableCanonicalInstant(snapshot.get('resetAt')),
    };
  }
  return invalidRuntimeValue();
}

function normalizedAdapter(value: unknown): TextModelAdapter {
  const snapshot = exactOwnDataSnapshot(value, ['estimate']);
  const estimate = snapshot.get('estimate');
  if (typeof estimate !== 'function') return invalidRuntimeValue();
  return {
    estimate: (request, signal) => Reflect.apply(estimate, value, [request, signal]) as ReturnType<
      TextModelAdapter['estimate']
    >,
  };
}

function normalizedAdapterError(
  value: unknown,
): { code: CoordinatorFailureCode; retryable: boolean } | null {
  try {
    if (
      !(value instanceof TextModelAdapterError)
      || Object.getPrototypeOf(value) !== TextModelAdapterError.prototype
    ) {
      return null;
    }
    const allowedKeys = new Set(['stack', 'message', 'name', 'code', 'retryable']);
    const snapshot = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowedKeys.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) return null;
      if (key === 'stack' && !Object.hasOwn(descriptor, 'value')) {
        if (typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function') return null;
        continue;
      }
      if (!Object.hasOwn(descriptor, 'value')) return null;
      snapshot.set(key, descriptor.value);
    }
    if (
      !snapshot.has('message')
      || !snapshot.has('name')
      || !snapshot.has('code')
      || !snapshot.has('retryable')
      || snapshot.get('name') !== 'TextModelAdapterError'
      || snapshot.get('message') !== 'Text model request failed'
      || typeof snapshot.get('retryable') !== 'boolean'
    ) {
      return null;
    }
    const code = coordinatorFailureCode(snapshot.get('code'));
    if (code === 'uncertain-food') return null;
    const retryable = snapshot.get('retryable') as boolean;
    if (code === 'invalid-estimate' && retryable) return null;
    return { code, retryable };
  } catch {
    return null;
  }
}

function normalizedAdapterEstimate(value: unknown): AdapterEstimate {
  const snapshot = exactOwnDataSnapshot(value, ['raw', 'usage']);
  const usageValue = snapshot.get('usage');
  let usage: AdapterEstimate['usage'] = null;
  if (usageValue !== null) {
    const usageSnapshot = exactOwnDataSnapshot(usageValue, ['inputTokens', 'outputTokens']);
    usage = {
      inputTokens: nonNegativeSafeInteger(usageSnapshot.get('inputTokens')),
      outputTokens: nonNegativeSafeInteger(usageSnapshot.get('outputTokens')),
    };
  }
  return { raw: snapshot.get('raw') as AdapterEstimate['raw'], usage };
}

function exactArrayValues(value: unknown, minimum: number, maximum: number): unknown[] {
  try {
    if (!Array.isArray(value)) return invalidRuntimeValue();
    const prototype = Object.getPrototypeOf(value);
    const constructorDescriptor = prototype === null
      ? undefined
      : Object.getOwnPropertyDescriptor(prototype, 'constructor');
    const constructorNameDescriptor = constructorDescriptor !== undefined
      && Object.hasOwn(constructorDescriptor, 'value')
      && typeof constructorDescriptor.value === 'function'
      ? Object.getOwnPropertyDescriptor(constructorDescriptor.value, 'name')
      : undefined;
    if (
      prototype === null
      || constructorDescriptor === undefined
      || !Object.hasOwn(constructorDescriptor, 'value')
      || typeof constructorDescriptor.value !== 'function'
      || constructorNameDescriptor === undefined
      || !Object.hasOwn(constructorNameDescriptor, 'value')
      || constructorNameDescriptor.value !== 'Array'
      || !isPlainRecordPrototype(Object.getPrototypeOf(prototype))
    ) {
      return invalidRuntimeValue();
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      lengthDescriptor === undefined
      || !Object.hasOwn(lengthDescriptor, 'value')
      || !Number.isSafeInteger(lengthDescriptor.value)
      || Object.is(lengthDescriptor.value, -0)
      || lengthDescriptor.value < minimum
      || lengthDescriptor.value > maximum
    ) {
      return invalidRuntimeValue();
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== lengthDescriptor.value + 1) return invalidRuntimeValue();
    const result: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return invalidRuntimeValue();
      }
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return invalidRuntimeValue();
  }
}

function normalizedParsedEstimate(value: unknown): ReturnType<typeof parseDoubaoTextEstimate> {
  const root = exactOwnDataSnapshot(value, ['status', 'candidate']);
  const status = root.get('status');
  if (status === 'uncertain') {
    if (root.get('candidate') !== null) return invalidRuntimeValue();
    return { status, candidate: null };
  }
  if (status !== 'complete') return invalidRuntimeValue();
  const candidate = exactOwnDataSnapshot(root.get('candidate'), PARSED_CANDIDATE_FIELDS);
  const assumptions = exactArrayValues(
    candidate.get('assumptions'),
    1,
    TEXT_AI_LIMITS.assumptions,
  );
  return parseDoubaoTextEstimate({
    status,
    candidate: {
      name: candidate.get('name'),
      preparation: candidate.get('preparation'),
      amountLow: candidate.get('amountLow'),
      amountHigh: candidate.get('amountHigh'),
      unit: candidate.get('unit'),
      catalogFoodId: candidate.get('catalogFoodId'),
      nutrientSource: candidate.get('nutrientSource'),
      energyKcalLow: candidate.get('energyKcalLow'),
      energyKcalHigh: candidate.get('energyKcalHigh'),
      proteinGLow: candidate.get('proteinGLow'),
      proteinGHigh: candidate.get('proteinGHigh'),
      assumptions,
    },
  });
}

async function readBoundedRequestJson(request: Request): Promise<unknown> {
  const body = request.body;
  if (
    request.headers.get('content-type') !== 'application/json' ||
    request.headers.has('transfer-encoding') ||
    request.headers.has('content-encoding')
  ) {
    return invalidBody(body);
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!CANONICAL_POSITIVE_LENGTH.test(declaredLength)) return invalidBody(body);
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length > TEXT_AI_LIMITS.requestBytes) {
      return invalidBody(body);
    }
  }
  if (body === null) return invalidBody(body);

  const signal = request.signal;
  if (signal.aborted) return invalidBody(body);

  const reader = body.getReader();
  const buffer = new Uint8Array(TEXT_AI_LIMITS.requestBytes);
  let byteLength = 0;
  let cancellationStarted = false;
  let stopReason: 'caller' | 'timeout' | null = null;
  let listenerAttached = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveStopped!: (value: { kind: 'stopped' }) => void;
  const stopped = new Promise<{ kind: 'stopped' }>((resolve) => {
    resolveStopped = resolve;
  });
  const cancelReaderOnce = () => {
    if (cancellationStarted) return;
    cancellationStarted = true;
    try {
      const cancellation = reader.cancel();
      void Promise.resolve(cancellation).catch(() => undefined);
    } catch {
      // Cancellation is best-effort and never changes the fixed public error.
    }
  };
  const stop = (reason: 'caller' | 'timeout') => {
    if (stopReason !== null) return;
    stopReason = reason;
    cancelReaderOnce();
    resolveStopped({ kind: 'stopped' });
  };
  const abortFromCaller = () => stop('caller');
  try {
    signal.addEventListener('abort', abortFromCaller, { once: true });
    listenerAttached = true;
    timer = setTimeout(() => stop('timeout'), BODY_READ_TIMEOUT_MS);
    if (signal.aborted) stop('caller');

    while (true) {
      const read = reader.read().then(
        (result) => ({ kind: 'read' as const, result }),
        () => ({ kind: 'read-error' as const }),
      );
      const outcome = await Promise.race([read, stopped]);
      if (outcome.kind === 'stopped' || outcome.kind === 'read-error') {
        throw new TypeError('Invalid text request body');
      }
      const { done, value } = outcome.result;
      if (done) break;
      const chunkLength = uint8ArrayLength(value);
      if (
        chunkLength < 1 ||
        chunkLength > TEXT_AI_LIMITS.requestBytes - byteLength
      ) {
        throw new TypeError('Invalid text request body');
      }
      Reflect.apply(UINT8_ARRAY_SET, buffer, [value, byteLength]);
      byteLength += chunkLength;
    }
    if (byteLength < 1) throw new TypeError('Invalid text request body');
  } catch {
    cancelReaderOnce();
    throw new TypeError('Invalid text request body');
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (listenerAttached) {
      try {
        signal.removeEventListener('abort', abortFromCaller);
      } catch {
        // A hostile signal cannot change the fixed public error.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // Releasing a hostile stream cannot change the public response.
    }
  }

  const bytes = buffer.slice(0, byteLength);
  const serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(serialized) as unknown;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function requestFingerprint(
  accountKey: string,
  request: ReturnType<typeof parseTextAiEstimateRequest>,
): Promise<string> {
  return sha256(stableJson({
    channel: 'text',
    accountKey,
    description: request.description,
    amount: request.amount,
    modelVersion: request.modelVersion,
    promptVersion: request.promptVersion,
    schemaVersion: request.schemaVersion,
    catalogVersion: request.catalogVersion,
    uncertaintyVersion: request.uncertaintyVersion,
    providerPolicyVersion: request.providerPolicyVersion,
    locale: request.locale,
  }));
}

export function isTextAiGatewayConfigured(
  env: GatewayEnv,
  runtime: TextHandlerDependencies,
): boolean {
  try {
    return env.TEXT_AI_GATEWAY_ENABLED === 'true'
      && env.TEXT_AI_MODEL === TEXT_AI_VERSIONS.model
      && env.PHOTO_AI_MONTHLY_BUDGET_MICROS === String(GATEWAY_LIMITS.monthlyBudgetMicros)
      && runtime.monthlyBudgetMicros === GATEWAY_LIMITS.monthlyBudgetMicros
      && runtime.initialAttemptReserveMicros
        === GATEWAY_CHANNEL_POLICY.text.initialAttemptReserveMicros
      && runtime.retryAttemptReserveMicros
        === GATEWAY_CHANNEL_POLICY.text.retryAttemptReserveMicros
      && runtime.resultCacheMs === GATEWAY_LIMITS.resultCacheMs
      && typeof env.ARK_API_KEY === 'string'
      && env.ARK_API_KEY.length >= 1
      && env.ARK_API_KEY.length <= 4096
      && env.ARK_API_KEY.trim() === env.ARK_API_KEY
      && !/[\r\n]/.test(env.ARK_API_KEY)
      && isValidCacheEncryptionKey(env.PHOTO_AI_CACHE_AES_KEY)
      && typeof env.PHOTO_AI_COORDINATOR === 'object'
      && env.PHOTO_AI_COORDINATOR !== null
      && typeof env.PHOTO_AI_COORDINATOR.getByName === 'function';
  } catch {
    return false;
  }
}

export async function handleTextAiRequest(
  request: Request,
  env: GatewayEnv,
  dependencies: TextHandlerDependencies = TEXT_GATEWAY_RUNTIME,
): Promise<Response> {
  if (!isTextAiGatewayConfigured(env, dependencies)) {
    return failure('service-disabled', 503);
  }

  const accountKey = request.headers.get('x-tiezheng-account-key');
  if (accountKey === null || !ACCOUNT_KEY.test(accountKey)) {
    cancelSilently(request.body);
    return failure('invalid-estimate', 502);
  }

  let textRequest;
  try {
    textRequest = parseTextAiEstimateRequest(await readBoundedRequestJson(request));
  } catch {
    return failure('invalid-estimate', 502);
  }

  let fingerprint: string;
  try {
    fingerprint = await requestFingerprint(accountKey, textRequest);
  } catch {
    return failure('service-disabled', 503);
  }
  let coordinator;
  let reservation: ReserveResult;
  let reserveNow: number;
  try {
    reserveNow = safeRuntimeNow(dependencies.now());
    coordinator = env.PHOTO_AI_COORDINATOR.getByName('stage2');
    reservation = normalizedReservation(await coordinator.reserve({
      channel: 'text',
      accountKey,
      idempotencyKey: textRequest.idempotencyKey,
      fingerprint,
      now: reserveNow,
      reserveMicros: dependencies.initialAttemptReserveMicros,
    }));
  } catch {
    return failure('service-disabled', 503);
  }

  if (reservation.kind === 'in-flight') {
    return jsonResponse({
      ok: true,
      status: 'in-flight',
      requestId: textRequest.requestId,
      retryAfterMs: reservation.retryAfterMs,
    }, 202);
  }
  if (reservation.kind === 'rejected') {
    const status = reservation.code === 'idempotency-conflict'
      ? 409
      : reservation.code === 'service-disabled' ? 503 : 429;
    return jsonResponse({
      ok: false,
      code: reservation.code,
      retryAt: reservation.retryAt,
      resetAt: reservation.resetAt,
    }, status);
  }
  if (reservation.kind === 'failed') {
    return failure(reservation.code, coordinatorFailureStatus(reservation.code));
  }
  if (reservation.kind === 'cached') {
    try {
      const cached = parseTextAiEstimateResponse(await dependencies.decryptCandidateCache(
        reservation.cache,
        fingerprint,
        env.PHOTO_AI_CACHE_AES_KEY,
        safeRuntimeNow(dependencies.now()),
      ));
      if (
        cached.ok !== true ||
        cached.status !== 'complete' ||
        cached.requestFingerprint !== fingerprint ||
        cached.requestId !== textRequest.requestId
      ) {
        return failure('provider-unavailable', 503);
      }
      return jsonResponse(cached, 200);
    } catch {
      return failure('provider-unavailable', 503);
    }
  }
  if (reservation.kind !== 'reserved') return failure('service-disabled', 503);

  const lease: Omit<LeaseInput, 'now'> = {
    channel: 'text',
    accountKey,
    idempotencyKey: textRequest.idempotencyKey,
    fingerprint,
    leaseId: reservation.leaseId,
  };
  const leaseAtNow = (): LeaseInput => {
    let now = reserveNow;
    try {
      now = safeRuntimeNow(dependencies.now());
    } catch {
      // A captured valid reserve timestamp still lets cleanup reach the coordinator.
    }
    return { ...lease, now };
  };
  let failureSettlementAttempted = false;
  const settleFailure = async (
    errorCode: CoordinatorFailureCode,
    actualCostMicros: number | null,
  ): Promise<Response> => {
    const safeCode = (() => {
      try {
        return coordinatorFailureCode(errorCode);
      } catch {
        return 'provider-unavailable' as const;
      }
    })();
    if (!failureSettlementAttempted) {
      failureSettlementAttempted = true;
      try {
        await coordinator.settleFailure({
          ...leaseAtNow(),
          errorCode: safeCode,
          actualCostMicros,
        });
      } catch {
        // Never expose coordinator state or attempt the failure settlement twice.
      }
    }
    return failure(safeCode, coordinatorFailureStatus(safeCode));
  };
  const abortBeforeInvoke = async (
    code: 'provider-timeout' | 'service-disabled',
    status: number,
  ): Promise<Response> => {
    try {
      await coordinator.abortBeforeInvoke(leaseAtNow());
    } catch {
      // If mark crossed the RPC boundary, a failure settlement can still close the lease.
      await settleFailure('provider-unavailable', null);
    }
    return failure(code, status);
  };

  if (request.signal.aborted) return abortBeforeInvoke('provider-timeout', 504);

  let adapter: TextModelAdapter;
  try {
    adapter = normalizedAdapter(dependencies.createModelAdapter(env.ARK_API_KEY));
  } catch {
    return abortBeforeInvoke('service-disabled', 503);
  }
  if (request.signal.aborted) return abortBeforeInvoke('provider-timeout', 504);

  try {
    await coordinator.markInvoked(leaseAtNow());
  } catch {
    return abortBeforeInvoke('service-disabled', 503);
  }
  if (request.signal.aborted) {
    try {
      await coordinator.abortAfterMarkBeforeProvider(leaseAtNow());
    } catch {
      return settleFailure('provider-timeout', null);
    }
    return failure('provider-timeout', 504);
  }

  let retried = false;
  let estimateValue: unknown;
  try {
    estimateValue = await adapter.estimate(textRequest, request.signal);
  } catch (error) {
    if (request.signal.aborted) return settleFailure('provider-timeout', null);
    const adapterError = normalizedAdapterError(error);
    if (adapterError === null || !adapterError.retryable) {
      return settleFailure(adapterError?.code ?? 'provider-unavailable', null);
    }
    try {
      await coordinator.reserveRetryCost(leaseAtNow());
    } catch {
      return settleFailure('provider-unavailable', null);
    }
    if (request.signal.aborted) {
      return settleFailure('provider-timeout', dependencies.initialAttemptReserveMicros);
    }
    retried = true;
    try {
      estimateValue = await adapter.estimate(textRequest, request.signal);
    } catch (retryError) {
      const adapterError = normalizedAdapterError(retryError);
      const code = request.signal.aborted
        ? 'provider-timeout'
        : adapterError?.code ?? 'provider-unavailable';
      return settleFailure(code, null);
    }
  }

  let estimate: AdapterEstimate;
  try {
    estimate = normalizedAdapterEstimate(estimateValue);
  } catch {
    return settleFailure('invalid-estimate', null);
  }

  let knownAttemptCost: number | null = null;
  if (estimate.usage !== null) {
    try {
      knownAttemptCost = arkCostMicros(
        estimate.usage.inputTokens,
        estimate.usage.outputTokens,
      );
    } catch {
      return settleFailure('invalid-estimate', null);
    }
  }
  const actualCostMicros = knownAttemptCost === null
    ? (retried
        ? dependencies.initialAttemptReserveMicros + dependencies.retryAttemptReserveMicros
        : dependencies.initialAttemptReserveMicros)
    : (retried ? dependencies.initialAttemptReserveMicros : 0) + knownAttemptCost;
  const totalReservedMicros = dependencies.initialAttemptReserveMicros
    + (retried ? dependencies.retryAttemptReserveMicros : 0);
  if (!Number.isSafeInteger(actualCostMicros) || actualCostMicros > totalReservedMicros) {
    return settleFailure('invalid-estimate', null);
  }

  let parsedEstimate;
  try {
    parsedEstimate = normalizedParsedEstimate(
      dependencies.parseDoubaoTextEstimate(estimate.raw),
    );
  } catch {
    return settleFailure(
      'invalid-estimate',
      knownAttemptCost === null ? null : actualCostMicros,
    );
  }
  if (parsedEstimate.status === 'uncertain') {
    return settleFailure('uncertain-food', actualCostMicros);
  }
  const candidate = parsedEstimate.candidate;
  if (
    candidate.catalogFoodId !== null ||
    candidate.nutrientSource !== 'model-range' ||
    candidate.energyKcalLow === null ||
    candidate.energyKcalHigh === null ||
    candidate.proteinGLow === null ||
    candidate.proteinGHigh === null
  ) {
    return settleFailure('invalid-estimate', actualCostMicros);
  }

  const success: TextAiEstimateSuccess = {
    ok: true,
    status: 'complete',
    requestId: textRequest.requestId,
    requestFingerprint: fingerprint,
    versions: { ...TEXT_AI_VERSIONS },
    candidates: [{
      id: 'text-candidate-1',
      name: candidate.name,
      preparation: candidate.preparation,
      amountLow: candidate.amountLow,
      amountHigh: candidate.amountHigh,
      unit: candidate.unit,
      catalogFoodId: null,
      nutrientSource: 'model-range',
      energyKcalLow: candidate.energyKcalLow,
      energyKcalHigh: candidate.energyKcalHigh,
      proteinGLow: candidate.proteinGLow,
      proteinGHigh: candidate.proteinGHigh,
      assumptions: [...candidate.assumptions],
    }],
  };
  let cache: EncryptedCandidateCache;
  try {
    cache = normalizedCache(await dependencies.encryptCandidateCache(
      success,
      fingerprint,
      env.PHOTO_AI_CACHE_AES_KEY,
      safeRuntimeNow(dependencies.now()) + dependencies.resultCacheMs,
    ));
  } catch {
    return settleFailure(
      'invalid-estimate',
      knownAttemptCost === null ? null : actualCostMicros,
    );
  }
  try {
    await coordinator.settleSuccess({ ...leaseAtNow(), cache, actualCostMicros });
  } catch {
    return settleFailure('provider-unavailable', actualCostMicros);
  }
  return jsonResponse(success, 200);
}

export async function handleTextSessionRequest(
  request: Request,
  env: GatewayEnv,
): Promise<Response> {
  if (!isTextAiGatewayConfigured(env, TEXT_GATEWAY_RUNTIME)) {
    return failure('service-disabled', 503);
  }
  const accountKey = request.headers.get('x-tiezheng-account-key');
  if (accountKey === null || !ACCOUNT_KEY.test(accountKey)) {
    return failure('service-disabled', 503);
  }
  try {
    const status = await env.PHOTO_AI_COORDINATOR.getByName('stage2').status({
      channel: 'text',
      accountKey,
      now: Date.now(),
    });
    const response = parseTextAiSessionResponse({
      ok: true,
      enabled: status.enabled && status.accountEnabled,
      accountRemaining: status.accountRemaining,
      globalRemaining: status.globalRemaining,
      resetAt: status.resetAt,
    });
    return jsonResponse(response, 200);
  } catch {
    return failure('service-disabled', 503);
  }
}
