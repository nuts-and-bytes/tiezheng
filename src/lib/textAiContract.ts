import type {
  EstimateNutrientSource,
  MealEstimateCandidate,
} from './nutritionTypes';

export const TEXT_AI_VERSIONS = Object.freeze({
  model: 'doubao-seed-2-1-pro-260628',
  prompt: 'tiezheng-food-text-zh-v1',
  schema: 'tiezheng-text-estimate-v1',
  catalog: 'tiezheng-food-catalog-v2',
  uncertainty: 'tiezheng-text-uncertainty-v1',
  providerPolicy: 'volcengine-ark-policy-2026-08-18',
} as const);

export const TEXT_AI_LIMITS = Object.freeze({
  descriptionChars: 500,
  amountMin: 0.01,
  amountMax: 100_000,
  candidates: 1,
  assumptions: 8,
  timeoutMs: 20_000,
  requestBytes: 8 * 1024,
} as const);

const TEXT_AI_MAX_IN_FLIGHT_RETRY_AFTER_MS = 60_000;

export interface TextMealDraft {
  description: string;
  amount: { value: number; unit: 'g' | 'mL' } | null;
}

export interface TextAiEstimateRequest extends TextMealDraft {
  requestId: string;
  idempotencyKey: string;
  modelVersion: typeof TEXT_AI_VERSIONS.model;
  promptVersion: typeof TEXT_AI_VERSIONS.prompt;
  schemaVersion: typeof TEXT_AI_VERSIONS.schema;
  catalogVersion: typeof TEXT_AI_VERSIONS.catalog;
  uncertaintyVersion: typeof TEXT_AI_VERSIONS.uncertainty;
  providerPolicyVersion: typeof TEXT_AI_VERSIONS.providerPolicy;
  locale: 'zh-CN';
}

export type TextAiErrorCode =
  | 'offline'
  | 'auth-required'
  | 'auth-expired'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'service-disabled'
  | 'budget-exceeded'
  | 'provider-timeout'
  | 'provider-unavailable'
  | 'invalid-estimate'
  | 'uncertain-food'
  | 'idempotency-conflict';

export interface TextAiSessionSuccess {
  ok: true;
  enabled: boolean;
  accountRemaining: number;
  globalRemaining: number;
  resetAt: string;
}

export interface TextAiLoginSuccess {
  ok: true;
}

export interface TextAiLogoutSuccess {
  ok: true;
}

export interface TextAiEstimateCandidate extends MealEstimateCandidate {
  catalogFoodId: null;
  nutrientSource: 'model-range';
  energyKcalLow: number;
  energyKcalHigh: number;
  proteinGLow: number;
  proteinGHigh: number;
}

export interface TextAiEstimateSuccess {
  ok: true;
  status: 'complete';
  requestId: string;
  requestFingerprint: string;
  versions: typeof TEXT_AI_VERSIONS;
  candidates: [TextAiEstimateCandidate];
}

export interface TextAiEstimateInFlight {
  ok: true;
  status: 'in-flight';
  requestId: string;
  retryAfterMs: number;
}

export interface TextAiFailure {
  ok: false;
  code: TextAiErrorCode;
  retryAt: string | null;
  resetAt: string | null;
}

export type TextAiSessionResponse = TextAiSessionSuccess | TextAiFailure;

export type TextAiLoginResponse = TextAiLoginSuccess | TextAiFailure;

export type TextAiLogoutResponse = TextAiLogoutSuccess | TextAiFailure;

export type TextAiEstimateResponse =
  | TextAiEstimateSuccess
  | TextAiEstimateInFlight
  | TextAiFailure;

const ERROR_COPY = {
  offline: '当前离线，请联网后重试',
  'auth-required': '请先登录后再使用餐食估算',
  'auth-expired': '登录已过期，请重新登录',
  'quota-exceeded': '今日餐食估算次数已用完',
  'rate-limited': '请求过于频繁，请稍后重试',
  'service-disabled': '餐食估算服务当前未开启',
  'budget-exceeded': '餐食估算服务今日额度已用完',
  'provider-timeout': '餐食估算超时，请重试',
  'provider-unavailable': '餐食估算服务暂时不可用',
  'invalid-estimate': '估算结果无效，请重试',
  'uncertain-food': '无法可靠估算，请手动记录',
  'idempotency-conflict': '请求内容已变化，请重新估算',
} as const satisfies Record<TextAiErrorCode, string>;

type Invalid = () => never;
type PropertySnapshot = ReadonlyMap<string, unknown>;

function invalidRequest(): never {
  throw new TypeError('Invalid text AI request');
}

function invalidResponse(): never {
  throw new TypeError('Invalid text AI response');
}

function snapshotObject(value: unknown, invalid: Invalid): PropertySnapshot {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalid();
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid();

    const keys = Reflect.ownKeys(value);
    const snapshot = new Map<string, unknown>();
    for (const key of keys) {
      if (typeof key !== 'string') return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return invalid();
      }
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return invalid();
  }
}

function snapshotArray(
  value: unknown,
  maximumLength: number,
  invalid: Invalid,
): unknown[] {
  try {
    if (!Array.isArray(value)) return invalid();
    if (Object.getPrototypeOf(value) !== Array.prototype) return invalid();

    const keys = Reflect.ownKeys(value);
    const properties = new Map<string, unknown>();
    for (const key of keys) {
      if (typeof key !== 'string') return invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return invalid();
      }
      properties.set(key, descriptor.value);
    }

    const length = properties.get('length');
    if (
      !isNonNegativeSafeInteger(length) ||
      length > maximumLength ||
      properties.size !== length + 1
    ) {
      return invalid();
    }

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (!properties.has(key)) return invalid();
      snapshot.push(properties.get(key));
    }
    return snapshot;
  } catch {
    return invalid();
  }
}

function hasExactSnapshotKeys(
  snapshot: PropertySnapshot,
  expectedKeys: readonly string[],
): boolean {
  return (
    snapshot.size === expectedKeys.length &&
    expectedKeys.every((key) => snapshot.has(key))
  );
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

const UNSAFE_DISPLAY_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

function isSafeDisplayString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    isBoundedString(value, maximumLength) &&
    value.trim().length > 0 &&
    !UNSAFE_DISPLAY_CHARACTERS.test(value)
  );
}

function isFiniteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    !Object.is(value, -0) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNullableFiniteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number | null {
  return value === null || isFiniteInRange(value, minimum, maximum);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    !Object.is(value, -0) &&
    value >= 0
  );
}

function isCanonicalUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}

function isIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function isRequestFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (!isBoundedString(value, 120)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isNullableCanonicalIsoInstant(value: unknown): value is string | null {
  return value === null || isCanonicalIsoInstant(value);
}

function isTextAiErrorCode(value: unknown): value is TextAiErrorCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ERROR_COPY, value)
  );
}

function parseAmount(
  value: unknown,
): TextMealDraft['amount'] {
  if (value === null) return null;
  const snapshot = snapshotObject(value, invalidRequest);
  if (!hasExactSnapshotKeys(snapshot, ['value', 'unit'])) return invalidRequest();

  const amountValue = snapshot.get('value');
  const unit = snapshot.get('unit');
  if (
    !isFiniteInRange(
      amountValue,
      TEXT_AI_LIMITS.amountMin,
      TEXT_AI_LIMITS.amountMax,
    ) ||
    (unit !== 'g' && unit !== 'mL')
  ) {
    return invalidRequest();
  }
  return { value: amountValue, unit };
}

export function parseTextAiEstimateRequest(
  value: unknown,
): TextAiEstimateRequest {
  const keys = [
    'requestId',
    'idempotencyKey',
    'description',
    'amount',
    'modelVersion',
    'promptVersion',
    'schemaVersion',
    'catalogVersion',
    'uncertaintyVersion',
    'providerPolicyVersion',
    'locale',
  ] as const;
  const snapshot = snapshotObject(value, invalidRequest);
  if (!hasExactSnapshotKeys(snapshot, keys)) return invalidRequest();

  const requestId = snapshot.get('requestId');
  const idempotencyKey = snapshot.get('idempotencyKey');
  const rawDescription = snapshot.get('description');
  if (
    !isCanonicalUuid(requestId) ||
    !isIdempotencyKey(idempotencyKey) ||
    typeof rawDescription !== 'string'
  ) {
    return invalidRequest();
  }

  const description = rawDescription.normalize('NFC').trim();
  if (
    description.length < 1 ||
    description.length > TEXT_AI_LIMITS.descriptionChars ||
    /[\u0000-\u001f\u007f]/.test(description) ||
    snapshot.get('modelVersion') !== TEXT_AI_VERSIONS.model ||
    snapshot.get('promptVersion') !== TEXT_AI_VERSIONS.prompt ||
    snapshot.get('schemaVersion') !== TEXT_AI_VERSIONS.schema ||
    snapshot.get('catalogVersion') !== TEXT_AI_VERSIONS.catalog ||
    snapshot.get('uncertaintyVersion') !== TEXT_AI_VERSIONS.uncertainty ||
    snapshot.get('providerPolicyVersion') !== TEXT_AI_VERSIONS.providerPolicy ||
    snapshot.get('locale') !== 'zh-CN'
  ) {
    return invalidRequest();
  }

  return {
    requestId,
    idempotencyKey,
    description,
    amount: parseAmount(snapshot.get('amount')),
    modelVersion: TEXT_AI_VERSIONS.model,
    promptVersion: TEXT_AI_VERSIONS.prompt,
    schemaVersion: TEXT_AI_VERSIONS.schema,
    catalogVersion: TEXT_AI_VERSIONS.catalog,
    uncertaintyVersion: TEXT_AI_VERSIONS.uncertainty,
    providerPolicyVersion: TEXT_AI_VERSIONS.providerPolicy,
    locale: 'zh-CN',
  };
}

function parseFailure(snapshot: PropertySnapshot): TextAiFailure {
  if (!hasExactSnapshotKeys(snapshot, ['ok', 'code', 'retryAt', 'resetAt'])) {
    return invalidResponse();
  }

  const ok = snapshot.get('ok');
  const code = snapshot.get('code');
  const retryAt = snapshot.get('retryAt');
  const resetAt = snapshot.get('resetAt');
  if (
    ok !== false ||
    !isTextAiErrorCode(code) ||
    !isNullableCanonicalIsoInstant(retryAt) ||
    !isNullableCanonicalIsoInstant(resetAt)
  ) {
    return invalidResponse();
  }
  return { ok, code, retryAt, resetAt };
}

function parseVersions(value: unknown): typeof TEXT_AI_VERSIONS {
  const keys = [
    'model',
    'prompt',
    'schema',
    'catalog',
    'uncertainty',
    'providerPolicy',
  ] as const;
  const snapshot = snapshotObject(value, invalidResponse);
  if (!hasExactSnapshotKeys(snapshot, keys)) return invalidResponse();

  for (const key of keys) {
    if (snapshot.get(key) !== TEXT_AI_VERSIONS[key]) return invalidResponse();
  }
  return { ...TEXT_AI_VERSIONS };
}

interface CandidateBounds {
  maximumAssumptions: number;
  maximumAmount: number;
  maximumEnergy: number;
  maximumProtein: number;
}

function parseAssumptions(value: unknown, maximumLength: number): string[] {
  const values = snapshotArray(value, maximumLength, invalidResponse);
  const assumptions: string[] = [];
  for (const assumption of values) {
    if (!isSafeDisplayString(assumption, 240)) return invalidResponse();
    assumptions.push(assumption);
  }
  return assumptions;
}

function parseCandidateFields(
  value: unknown,
  bounds: CandidateBounds,
): MealEstimateCandidate {
  const keys = [
    'id',
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
  const snapshot = snapshotObject(value, invalidResponse);
  if (!hasExactSnapshotKeys(snapshot, keys)) return invalidResponse();

  const id = snapshot.get('id');
  const name = snapshot.get('name');
  const preparation = snapshot.get('preparation');
  const amountLow = snapshot.get('amountLow');
  const amountHigh = snapshot.get('amountHigh');
  const unit = snapshot.get('unit');
  const catalogFoodId = snapshot.get('catalogFoodId');
  const nutrientSource = snapshot.get('nutrientSource');
  const energyKcalLow = snapshot.get('energyKcalLow');
  const energyKcalHigh = snapshot.get('energyKcalHigh');
  const proteinGLow = snapshot.get('proteinGLow');
  const proteinGHigh = snapshot.get('proteinGHigh');
  const assumptions = parseAssumptions(
    snapshot.get('assumptions'),
    bounds.maximumAssumptions,
  );

  if (
    !isBoundedString(id, 120) ||
    !isSafeDisplayString(name, 120) ||
    !isSafeDisplayString(preparation, 120) ||
    !isFiniteInRange(amountLow, TEXT_AI_LIMITS.amountMin, bounds.maximumAmount) ||
    !isFiniteInRange(amountHigh, TEXT_AI_LIMITS.amountMin, bounds.maximumAmount) ||
    amountLow > amountHigh ||
    (unit !== 'g' && unit !== 'mL') ||
    (catalogFoodId !== null && !isBoundedString(catalogFoodId, 120)) ||
    (nutrientSource !== 'catalog' &&
      nutrientSource !== 'model-range' &&
      nutrientSource !== 'none') ||
    !isNullableFiniteInRange(energyKcalLow, 0, bounds.maximumEnergy) ||
    !isNullableFiniteInRange(energyKcalHigh, 0, bounds.maximumEnergy) ||
    !isNullableFiniteInRange(proteinGLow, 0, bounds.maximumProtein) ||
    !isNullableFiniteInRange(proteinGHigh, 0, bounds.maximumProtein)
  ) {
    return invalidResponse();
  }

  return {
    id,
    name,
    preparation,
    amountLow,
    amountHigh,
    unit,
    catalogFoodId,
    nutrientSource: nutrientSource as EstimateNutrientSource,
    energyKcalLow,
    energyKcalHigh,
    proteinGLow,
    proteinGHigh,
    assumptions,
  };
}

function parseTextCandidate(value: unknown): TextAiEstimateCandidate {
  const candidate = parseCandidateFields(value, {
    maximumAssumptions: TEXT_AI_LIMITS.assumptions,
    maximumAmount: TEXT_AI_LIMITS.amountMax,
    maximumEnergy: 100_000,
    maximumProtein: 10_000,
  });
  if (
    candidate.catalogFoodId !== null ||
    candidate.nutrientSource !== 'model-range' ||
    candidate.energyKcalLow === null ||
    candidate.energyKcalHigh === null ||
    candidate.proteinGLow === null ||
    candidate.proteinGHigh === null ||
    candidate.energyKcalLow > candidate.energyKcalHigh ||
    candidate.proteinGLow > candidate.proteinGHigh ||
    candidate.assumptions.length < 1
  ) {
    return invalidResponse();
  }
  return {
    ...candidate,
    catalogFoodId: null,
    nutrientSource: 'model-range',
    energyKcalLow: candidate.energyKcalLow,
    energyKcalHigh: candidate.energyKcalHigh,
    proteinGLow: candidate.proteinGLow,
    proteinGHigh: candidate.proteinGHigh,
  };
}

export function parseTextAiSessionResponse(
  value: unknown,
): TextAiSessionResponse {
  const snapshot = snapshotObject(value, invalidResponse);
  if (snapshot.get('ok') === false) return parseFailure(snapshot);
  if (
    !hasExactSnapshotKeys(snapshot, [
      'ok',
      'enabled',
      'accountRemaining',
      'globalRemaining',
      'resetAt',
    ])
  ) {
    return invalidResponse();
  }

  const ok = snapshot.get('ok');
  const enabled = snapshot.get('enabled');
  const accountRemaining = snapshot.get('accountRemaining');
  const globalRemaining = snapshot.get('globalRemaining');
  const resetAt = snapshot.get('resetAt');
  if (
    ok !== true ||
    typeof enabled !== 'boolean' ||
    !isNonNegativeSafeInteger(accountRemaining) ||
    !isNonNegativeSafeInteger(globalRemaining) ||
    !isCanonicalIsoInstant(resetAt)
  ) {
    return invalidResponse();
  }
  return { ok, enabled, accountRemaining, globalRemaining, resetAt };
}

export function parseTextAiLoginResponse(
  value: unknown,
): TextAiLoginResponse {
  const snapshot = snapshotObject(value, invalidResponse);
  if (snapshot.get('ok') === true) {
    if (!hasExactSnapshotKeys(snapshot, ['ok'])) return invalidResponse();
    return { ok: true };
  }
  const failure = parseFailure(snapshot);
  if (
    failure.code !== 'auth-required' &&
    failure.code !== 'rate-limited' &&
    failure.code !== 'service-disabled'
  ) {
    return invalidResponse();
  }
  if (failure.resetAt !== null) return invalidResponse();
  if (failure.code === 'rate-limited') {
    if (failure.retryAt === null) return invalidResponse();
  } else if (failure.retryAt !== null) {
    return invalidResponse();
  }
  return failure;
}

export function parseTextAiLogoutResponse(
  value: unknown,
): TextAiLogoutResponse {
  const snapshot = snapshotObject(value, invalidResponse);
  if (!hasExactSnapshotKeys(snapshot, ['ok']) || snapshot.get('ok') !== true) {
    return invalidResponse();
  }
  return { ok: true };
}

export function parseTextAiEstimateResponse(
  value: unknown,
): TextAiEstimateResponse {
  const snapshot = snapshotObject(value, invalidResponse);
  if (snapshot.get('ok') === false) return parseFailure(snapshot);

  const status = snapshot.get('status');
  if (status === 'in-flight') {
    if (
      !hasExactSnapshotKeys(snapshot, [
        'ok',
        'status',
        'requestId',
        'retryAfterMs',
      ])
    ) {
      return invalidResponse();
    }
    const ok = snapshot.get('ok');
    const requestId = snapshot.get('requestId');
    const retryAfterMs = snapshot.get('retryAfterMs');
    if (
      ok !== true ||
      !isCanonicalUuid(requestId) ||
      !isNonNegativeSafeInteger(retryAfterMs) ||
      retryAfterMs > TEXT_AI_MAX_IN_FLIGHT_RETRY_AFTER_MS
    ) {
      return invalidResponse();
    }
    return { ok, status, requestId, retryAfterMs };
  }

  if (status === 'complete') {
    if (
      !hasExactSnapshotKeys(snapshot, [
        'ok',
        'status',
        'requestId',
        'requestFingerprint',
        'versions',
        'candidates',
      ])
    ) {
      return invalidResponse();
    }
    const ok = snapshot.get('ok');
    const requestId = snapshot.get('requestId');
    const requestFingerprint = snapshot.get('requestFingerprint');
    if (
      ok !== true ||
      !isCanonicalUuid(requestId) ||
      !isRequestFingerprint(requestFingerprint)
    ) {
      return invalidResponse();
    }

    const candidates = snapshotArray(
      snapshot.get('candidates'),
      TEXT_AI_LIMITS.candidates,
      invalidResponse,
    );
    if (candidates.length !== TEXT_AI_LIMITS.candidates) return invalidResponse();
    return {
      ok,
      status,
      requestId,
      requestFingerprint,
      versions: parseVersions(snapshot.get('versions')),
      candidates: [parseTextCandidate(candidates[0])],
    };
  }

  return invalidResponse();
}

export function textAiErrorCopy(code: TextAiErrorCode): string {
  if (!isTextAiErrorCode(code)) return invalidResponse();
  return ERROR_COPY[code];
}
