import type { GatewayEnv } from './env';
import {
  createDoubaoAdapter,
  PhotoModelAdapterError,
  type PhotoModelAdapter,
} from './doubaoAdapter';
import { parseDoubaoEstimate } from './doubaoSchema';
import type { CoordinatorFailureCode, LeaseInput } from './coordinator';
import {
  decryptCandidateCache,
  encryptCandidateCache,
  isValidCacheEncryptionKey,
} from './cryptoCache';
import { readPhotoUpload, sanitizeImage } from './imageFirewall';
import {
  parsePhotoAiEstimateResponse,
  PHOTO_AI_VERSIONS,
} from '../../../src/lib/photoAiContract';
import { stableJson } from '../../../src/lib/stableJson';

export interface HandlerDependencies {
  readPhotoUpload: typeof readPhotoUpload;
  sanitizeImage: typeof sanitizeImage;
  createModelAdapter: (apiKey: string) => PhotoModelAdapter;
  parseDoubaoEstimate: typeof parseDoubaoEstimate;
  encryptCandidateCache: typeof encryptCandidateCache;
  decryptCandidateCache: typeof decryptCandidateCache;
  monthlyBudgetMicros: number;
  initialAttemptReserveMicros: number;
  retryAttemptReserveMicros: number;
  resultCacheMs: number;
  arkCostMicros: (inputTokens: number, outputTokens: number) => number;
  now: () => number;
}

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

function failure(
  code: 'service-disabled' | 'unsupported-file' | 'decode-failed' | 'provider-timeout',
  status: number,
): Response {
  return jsonResponse({ ok: false, code, retryAt: null, resetAt: null }, status);
}

function coordinatorFailureStatus(code: CoordinatorFailureCode): number {
  if (code === 'provider-timeout') return 504;
  if (code === 'invalid-estimate') return 502;
  return 503;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function requestFingerprint(accountKey: string, uploadBlobSha256: string): Promise<string> {
  return sha256(stableJson({
    accountKey,
    uploadBlobSha256,
    transformVersion: PHOTO_AI_VERSIONS.transform,
    modelVersion: PHOTO_AI_VERSIONS.model,
    promptVersion: PHOTO_AI_VERSIONS.prompt,
    schemaVersion: PHOTO_AI_VERSIONS.schema,
    catalogVersion: PHOTO_AI_VERSIONS.catalog,
    uncertaintyVersion: PHOTO_AI_VERSIONS.uncertainty,
    providerPolicyVersion: PHOTO_AI_VERSIONS.providerPolicy,
  }));
}

function configured(env: GatewayEnv, monthlyBudgetMicros: number): boolean {
  const configuredMonthlyBudgetMicros = Number(env.PHOTO_AI_MONTHLY_BUDGET_MICROS);
  return env.PHOTO_AI_GATEWAY_ENABLED === 'true'
    && env.PHOTO_AI_MODEL === PHOTO_AI_VERSIONS.model
    && typeof env.PHOTO_AI_MONTHLY_BUDGET_MICROS === 'string'
    && /^\d+$/.test(env.PHOTO_AI_MONTHLY_BUDGET_MICROS)
    && Number.isSafeInteger(monthlyBudgetMicros)
    && monthlyBudgetMicros > 0
    && Number.isSafeInteger(configuredMonthlyBudgetMicros)
    && configuredMonthlyBudgetMicros > 0
    && configuredMonthlyBudgetMicros <= monthlyBudgetMicros
    && typeof env.ARK_API_KEY === 'string'
    && env.ARK_API_KEY.length > 0
    && isValidCacheEncryptionKey(env.PHOTO_AI_CACHE_AES_KEY)
    && typeof env.IMAGES === 'object'
    && env.IMAGES !== null
    && typeof env.PHOTO_AI_COORDINATOR === 'object'
    && env.PHOTO_AI_COORDINATOR !== null;
}

export async function handlePhotoAiRequest(
  request: Request,
  env: GatewayEnv,
  overrides: Partial<HandlerDependencies> = {},
): Promise<Response> {
  const dependencies: HandlerDependencies = {
    readPhotoUpload,
    sanitizeImage,
    createModelAdapter: createDoubaoAdapter,
    parseDoubaoEstimate,
    encryptCandidateCache,
    decryptCandidateCache,
    monthlyBudgetMicros: Number.NaN,
    initialAttemptReserveMicros: Number.NaN,
    retryAttemptReserveMicros: Number.NaN,
    resultCacheMs: Number.NaN,
    arkCostMicros: () => { throw new TypeError('Missing gateway cost configuration'); },
    now: Date.now,
    ...overrides,
  };
  if (!configured(env, dependencies.monthlyBudgetMicros)) return failure('service-disabled', 503);
  const accountKey = request.headers.get('x-tiezheng-account-key');
  if (accountKey === null || !/^[a-f0-9]{64}$/.test(accountKey)) {
    return failure('service-disabled', 503);
  }
  let upload;
  try {
    upload = await dependencies.readPhotoUpload(request);
  } catch {
    return failure('unsupported-file', 400);
  }

  const fingerprint = await requestFingerprint(accountKey, upload.metadata.uploadBlobSha256);
  const reserveNow = dependencies.now();
  let reservation;
  try {
    reservation = await env.PHOTO_AI_COORDINATOR.getByName('stage2').reserve({
      accountKey,
      idempotencyKey: upload.metadata.idempotencyKey,
      fingerprint,
      now: reserveNow,
      reserveMicros: dependencies.initialAttemptReserveMicros,
    });
  } catch {
    return failure('service-disabled', 503);
  }
  if (reservation.kind === 'in-flight') {
    return jsonResponse({
      ok: true,
      status: 'in-flight',
      requestId: upload.metadata.requestId,
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
    return jsonResponse(
      { ok: false, code: reservation.code, retryAt: null, resetAt: null },
      coordinatorFailureStatus(reservation.code),
    );
  }
  if (reservation.kind === 'cached') {
    try {
      const cached = parsePhotoAiEstimateResponse(await dependencies.decryptCandidateCache(
        reservation.cache,
        fingerprint,
        env.PHOTO_AI_CACHE_AES_KEY,
        dependencies.now(),
      ));
      if (cached.ok !== true
        || cached.status !== 'complete'
        || cached.requestFingerprint !== fingerprint
        || cached.requestId !== upload.metadata.requestId) {
        return failure('service-disabled', 503);
      }
      return jsonResponse(cached, 200);
    } catch {
      return failure('service-disabled', 503);
    }
  }

  const lease: Omit<LeaseInput, 'now'> = {
    accountKey,
    idempotencyKey: upload.metadata.idempotencyKey,
    fingerprint,
    leaseId: reservation.leaseId,
  };
  const leaseAtNow = (): LeaseInput => ({ ...lease, now: dependencies.now() });
  const coordinator = env.PHOTO_AI_COORDINATOR.getByName('stage2');
  const abortBeforeInvoke = async (
    code: 'decode-failed' | 'provider-timeout' | 'service-disabled',
    status: number,
  ): Promise<Response> => {
    try {
      await coordinator.abortBeforeInvoke(leaseAtNow());
    } catch {
      // The response remains generic even if rollback itself fails.
    }
    return failure(code, status);
  };
  if (request.signal.aborted) {
    return abortBeforeInvoke('provider-timeout', 504);
  }
  let image;
  try {
    image = await dependencies.sanitizeImage(upload, env.IMAGES);
  } catch {
    return abortBeforeInvoke('decode-failed', 400);
  }

  let adapter: PhotoModelAdapter;
  try {
    adapter = dependencies.createModelAdapter(env.ARK_API_KEY);
  } catch {
    return abortBeforeInvoke('service-disabled', 503);
  }
  if (request.signal.aborted) {
    return abortBeforeInvoke('provider-timeout', 504);
  }

  const settleFailure = async (
    errorCode: CoordinatorFailureCode,
    actualCostMicros: number | null,
  ): Promise<Response> => {
    try {
      await coordinator.settleFailure({ ...leaseAtNow(), errorCode, actualCostMicros });
    } catch {
      // The fixed failure response does not expose coordinator details.
    }
    return jsonResponse(
      { ok: false, code: errorCode, retryAt: null, resetAt: null },
      coordinatorFailureStatus(errorCode),
    );
  };

  try {
    await coordinator.markInvoked(leaseAtNow());
  } catch {
    return failure('service-disabled', 503);
  }
  if (request.signal.aborted) {
    try {
      await coordinator.abortAfterMarkBeforeProvider(leaseAtNow());
    } catch {
      // The fixed timeout response does not expose coordinator details.
    }
    return failure('provider-timeout', 504);
  }

  let retried = false;
  let estimate;
  try {
    estimate = await adapter.estimate(image, request.signal);
  } catch (error) {
    if (request.signal.aborted) {
      return settleFailure('provider-timeout', null);
    }
    if (!(error instanceof PhotoModelAdapterError) || !error.retryable) {
      const code = error instanceof PhotoModelAdapterError ? error.code : 'provider-unavailable';
      return settleFailure(code, null);
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
      estimate = await adapter.estimate(image, request.signal);
    } catch (retryError) {
      const code = retryError instanceof PhotoModelAdapterError
        ? retryError.code
        : 'provider-unavailable';
      return settleFailure(code, null);
    }
  }

  let knownAttemptCost: number | null = null;
  if (estimate.usage !== null) {
    try {
      knownAttemptCost = dependencies.arkCostMicros(
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

  let candidates;
  try {
    candidates = dependencies.parseDoubaoEstimate(estimate.raw);
  } catch {
    return settleFailure('invalid-estimate', knownAttemptCost === null ? null : actualCostMicros);
  }

  const success = {
    ok: true as const,
    status: 'complete' as const,
    requestId: upload.metadata.requestId,
    requestFingerprint: fingerprint,
    versions: PHOTO_AI_VERSIONS,
    candidates,
  };
  let cache;
  try {
    cache = await dependencies.encryptCandidateCache(
      success,
      fingerprint,
      env.PHOTO_AI_CACHE_AES_KEY,
      dependencies.now() + dependencies.resultCacheMs,
    );
  } catch {
    return settleFailure('invalid-estimate', knownAttemptCost === null ? null : actualCostMicros);
  }
  try {
    await coordinator.settleSuccess({
      ...leaseAtNow(),
      cache,
      actualCostMicros,
    });
    return jsonResponse(success, 200);
  } catch {
    return failure('service-disabled', 503);
  }
}
