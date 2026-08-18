import type {
  MealEstimateCandidate,
  MealEstimateErrorCode,
} from './nutritionTypes';

export const PHOTO_AI_VERSIONS = Object.freeze({
  model: 'doubao-seed-2-1-pro-260628',
  prompt: 'tiezheng-food-photo-zh-v1',
  schema: 'tiezheng-photo-estimate-v1',
  catalog: 'tiezheng-food-catalog-v1',
  transform: 'tiezheng-photo-webp-v1',
  uncertainty: 'tiezheng-photo-uncertainty-v1',
  providerPolicy: 'volcengine-ark-policy-2026-08-18',
} as const);

export const PHOTO_AI_PROVIDER_POLICY_URL =
  'https://docs.volcengine.com/docs/82379/1142195';

export const PHOTO_AI_LIMITS = Object.freeze({
  rawBytes: 15 * 1024 * 1024,
  decodedPixels: 40_000_000,
  uploadBytes: 1_000_000,
  uploadLongEdge: 1600,
  thumbnailBytes: 100 * 1024,
  thumbnailLongEdge: 320,
  consentMs: 10 * 60 * 1000,
  intentMs: 15 * 60 * 1000,
  candidates: 6,
} as const);

const CANDIDATE_BOUNDS = Object.freeze({
  amountMin: 0.01,
  amountMax: 100_000,
  energyMin: 0,
  energyMax: 100_000,
  proteinMin: 0,
  proteinMax: 10_000,
} as const);

export type PhotoAiErrorCode =
  | MealEstimateErrorCode
  | 'idempotency-conflict';

export interface PhotoAiRequestMetadata {
  requestId: string;
  idempotencyKey: string;
  uploadBlobSha256: string;
  modelVersion: typeof PHOTO_AI_VERSIONS.model;
  promptVersion: typeof PHOTO_AI_VERSIONS.prompt;
  schemaVersion: typeof PHOTO_AI_VERSIONS.schema;
  catalogVersion: typeof PHOTO_AI_VERSIONS.catalog;
  transformVersion: typeof PHOTO_AI_VERSIONS.transform;
  uncertaintyVersion: typeof PHOTO_AI_VERSIONS.uncertainty;
  providerPolicyVersion: typeof PHOTO_AI_VERSIONS.providerPolicy;
  locale: 'zh-CN';
}

export interface PhotoAiSessionSuccess {
  ok: true;
  enabled: boolean;
  accountRemaining: number;
  globalRemaining: number;
  resetAt: string;
}

export interface PhotoAiEstimateSuccess {
  ok: true;
  status: 'complete';
  requestId: string;
  requestFingerprint: string;
  versions: typeof PHOTO_AI_VERSIONS;
  candidates: MealEstimateCandidate[];
}

export interface PhotoAiEstimateInFlight {
  ok: true;
  status: 'in-flight';
  requestId: string;
  retryAfterMs: number;
}

export interface PhotoAiFailure {
  ok: false;
  code: PhotoAiErrorCode;
  retryAt: string | null;
  resetAt: string | null;
}

export type PhotoAiSessionResponse = PhotoAiSessionSuccess | PhotoAiFailure;

export type PhotoAiEstimateResponse =
  | PhotoAiEstimateSuccess
  | PhotoAiEstimateInFlight
  | PhotoAiFailure;

const ERROR_COPY = {
  'unsupported-file': '不支持这种图片格式',
  'image-too-large': '图片太大，请选择更小的图片',
  'decode-failed': '无法读取图片，请换一张重试',
  offline: '当前离线，请联网后重试',
  'auth-required': '请先登录后再使用图片识别',
  'auth-expired': '登录已过期，请重新登录',
  'quota-exceeded': '本月图片识别次数已用完',
  'rate-limited': '请求过于频繁，请稍后重试',
  'service-disabled': '图片识别服务当前未开启',
  'budget-exceeded': '图片识别服务今日额度已用完',
  'consent-expired': '授权已过期，请重新确认上传',
  'provider-timeout': '图片识别超时，请重试',
  'provider-unavailable': '图片识别服务暂时不可用',
  'invalid-estimate': '识别结果无效，请重试',
  'uncertain-food': '无法确定食物，请手动记录',
  'idempotency-conflict': '请求内容已变化，请重新选择图片',
} as const satisfies Record<PhotoAiErrorCode, string>;

function invalidResponse(): never {
  throw new TypeError('Invalid photo AI response');
}

type PropertySnapshot = ReadonlyMap<string, unknown>;

function snapshotObject(value: unknown): PropertySnapshot {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return invalidResponse();
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidResponse();
    }

    const keys = Reflect.ownKeys(value);
    const snapshot = new Map<string, unknown>();
    for (const key of keys) {
      if (typeof key !== 'string') return invalidResponse();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        return invalidResponse();
      }
      snapshot.set(key, descriptor.value);
    }
    return snapshot;
  } catch {
    return invalidResponse();
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

function snapshotArray(value: unknown, maximumLength: number): unknown[] {
  try {
    if (!Array.isArray(value)) return invalidResponse();

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Array.prototype) return invalidResponse();

    const keys = Reflect.ownKeys(value);
    const properties = new Map<string, unknown>();
    for (const key of keys) {
      if (typeof key !== 'string') return invalidResponse();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        return invalidResponse();
      }
      properties.set(key, descriptor.value);
    }

    const length = properties.get('length');
    if (
      !isNonNegativeSafeInteger(length) ||
      length > maximumLength ||
      properties.size !== length + 1
    ) {
      return invalidResponse();
    }

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      if (!properties.has(key)) return invalidResponse();
      snapshot.push(properties.get(key));
    }
    return snapshot;
  } catch {
    return invalidResponse();
  }
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength
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
    value >= minimum &&
    value <= maximum
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  );
}

function isNullableFiniteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number | null {
  return value === null || isFiniteInRange(value, minimum, maximum);
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (!isBoundedString(value, 120)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isNullableCanonicalIsoInstant(value: unknown): value is string | null {
  return value === null || isCanonicalIsoInstant(value);
}

function isRequestFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isPhotoAiErrorCode(value: unknown): value is PhotoAiErrorCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ERROR_COPY, value)
  );
}

function parseFailure(snapshot: PropertySnapshot): PhotoAiFailure {
  if (!hasExactSnapshotKeys(snapshot, ['ok', 'code', 'retryAt', 'resetAt'])) {
    return invalidResponse();
  }

  const ok = snapshot.get('ok');
  const code = snapshot.get('code');
  const retryAt = snapshot.get('retryAt');
  const resetAt = snapshot.get('resetAt');
  if (
    ok !== false ||
    !isPhotoAiErrorCode(code) ||
    !isNullableCanonicalIsoInstant(retryAt) ||
    !isNullableCanonicalIsoInstant(resetAt)
  ) {
    return invalidResponse();
  }

  return { ok, code, retryAt, resetAt };
}

function parseVersions(value: unknown): typeof PHOTO_AI_VERSIONS {
  const keys = [
    'model',
    'prompt',
    'schema',
    'catalog',
    'transform',
    'uncertainty',
    'providerPolicy',
  ] as const;
  const snapshot = snapshotObject(value);
  if (!hasExactSnapshotKeys(snapshot, keys)) return invalidResponse();

  for (const key of keys) {
    if (snapshot.get(key) !== PHOTO_AI_VERSIONS[key]) {
      return invalidResponse();
    }
  }
  return { ...PHOTO_AI_VERSIONS };
}

function parseAssumptions(value: unknown): string[] {
  const snapshot = snapshotArray(value, 12);

  const assumptions: string[] = [];
  for (const assumption of snapshot) {
    if (!isBoundedString(assumption, 240)) return invalidResponse();
    assumptions.push(assumption);
  }
  return assumptions;
}

function parseCandidate(value: unknown): MealEstimateCandidate {
  const snapshot = snapshotObject(value);
  if (
    !hasExactSnapshotKeys(snapshot, [
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
    ])
  ) {
    return invalidResponse();
  }

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
  const assumptions = parseAssumptions(snapshot.get('assumptions'));

  if (
    !isBoundedString(id, 120) ||
    !isBoundedString(name, 120) ||
    !isBoundedString(preparation, 120) ||
    !isFiniteInRange(
      amountLow,
      CANDIDATE_BOUNDS.amountMin,
      CANDIDATE_BOUNDS.amountMax,
    ) ||
    !isFiniteInRange(
      amountHigh,
      CANDIDATE_BOUNDS.amountMin,
      CANDIDATE_BOUNDS.amountMax,
    ) ||
    amountLow > amountHigh ||
    (unit !== 'g' && unit !== 'mL') ||
    (catalogFoodId !== null && !isBoundedString(catalogFoodId, 120)) ||
    !isNullableFiniteInRange(
      energyKcalLow,
      CANDIDATE_BOUNDS.energyMin,
      CANDIDATE_BOUNDS.energyMax,
    ) ||
    !isNullableFiniteInRange(
      energyKcalHigh,
      CANDIDATE_BOUNDS.energyMin,
      CANDIDATE_BOUNDS.energyMax,
    ) ||
    !isNullableFiniteInRange(
      proteinGLow,
      CANDIDATE_BOUNDS.proteinMin,
      CANDIDATE_BOUNDS.proteinMax,
    ) ||
    !isNullableFiniteInRange(
      proteinGHigh,
      CANDIDATE_BOUNDS.proteinMin,
      CANDIDATE_BOUNDS.proteinMax,
    ) ||
    (nutrientSource !== 'catalog' &&
      nutrientSource !== 'model-range' &&
      nutrientSource !== 'none')
  ) {
    return invalidResponse();
  }

  const nutrients = [energyKcalLow, energyKcalHigh, proteinGLow, proteinGHigh];
  if (nutrientSource === 'catalog') {
    if (
      catalogFoodId === null ||
      nutrients.some((nutrient) => nutrient !== null)
    ) {
      return invalidResponse();
    }
  } else if (nutrientSource === 'model-range') {
    if (
      catalogFoodId !== null ||
      assumptions.length === 0 ||
      energyKcalLow === null ||
      energyKcalHigh === null ||
      proteinGLow === null ||
      proteinGHigh === null ||
      energyKcalLow > energyKcalHigh ||
      proteinGLow > proteinGHigh
    ) {
      return invalidResponse();
    }
  } else if (nutrientSource === 'none') {
    if (
      catalogFoodId !== null ||
      nutrients.some((nutrient) => nutrient !== null)
    ) {
      return invalidResponse();
    }
  }

  return {
    id,
    name,
    preparation,
    amountLow,
    amountHigh,
    unit,
    catalogFoodId,
    nutrientSource,
    energyKcalLow,
    energyKcalHigh,
    proteinGLow,
    proteinGHigh,
    assumptions,
  };
}

function parseCandidates(value: unknown): MealEstimateCandidate[] {
  const snapshot = snapshotArray(value, PHOTO_AI_LIMITS.candidates);

  const candidates: MealEstimateCandidate[] = [];
  for (const candidate of snapshot) {
    candidates.push(parseCandidate(candidate));
  }
  return candidates;
}

export function parsePhotoAiSessionResponse(
  value: unknown,
): PhotoAiSessionResponse {
  const snapshot = snapshotObject(value);
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

export function parsePhotoAiEstimateResponse(
  value: unknown,
): PhotoAiEstimateResponse {
  const snapshot = snapshotObject(value);
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
      !isBoundedString(requestId, 120) ||
      !isNonNegativeSafeInteger(retryAfterMs)
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
      !isBoundedString(requestId, 120) ||
      !isRequestFingerprint(requestFingerprint)
    ) {
      return invalidResponse();
    }
    return {
      ok,
      status,
      requestId,
      requestFingerprint,
      versions: parseVersions(snapshot.get('versions')),
      candidates: parseCandidates(snapshot.get('candidates')),
    };
  }

  return invalidResponse();
}

export function photoAiErrorCopy(code: PhotoAiErrorCode): string {
  if (!isPhotoAiErrorCode(code)) return invalidResponse();
  return ERROR_COPY[code];
}

export function photoAiErrorToMealEstimateError(
  code: PhotoAiErrorCode,
): MealEstimateErrorCode {
  if (!isPhotoAiErrorCode(code)) return invalidResponse();
  return code === 'idempotency-conflict' ? 'invalid-estimate' : code;
}
