import {
  PHOTO_AI_LIMITS,
  PHOTO_AI_VERSIONS,
  parsePhotoAiEstimateResponse,
  parsePhotoAiSessionResponse,
  type PhotoAiErrorCode,
  type PhotoAiEstimateResponse,
  type PhotoAiFailure,
  type PhotoAiSessionResponse,
} from './photoAiContract';

export interface PhotoAiClient {
  session(): Promise<PhotoAiSessionResponse>;
  estimate(input: PhotoAiEstimateInput): Promise<PhotoAiEstimateResponse>;
  logout(): Promise<{ logoutUrl: '/cdn-cgi/access/logout' }>;
}

export interface PhotoAiEstimateInput {
  requestId: string;
  idempotencyKey: string;
  uploadBlobSha256: string;
  uploadBlob: Blob;
}

const API_PREFIX = '/api/nutrition/photo/';
const SESSION_URL = `${API_PREFIX}session`;
const ESTIMATE_URL = `${API_PREFIX}estimate`;
const LOGOUT_URL = `${API_PREFIX}logout`;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRY_DELAY_MS = 2_000;
const ESTIMATE_KEYS = [
  'requestId',
  'idempotencyKey',
  'uploadBlobSha256',
  'uploadBlob',
] as const;

type FetchResult =
  | {
      response: Response;
      authentication: boolean;
      jsonOk: boolean;
      value: unknown;
    }
  | { failure: PhotoAiFailure };

function failure(code: PhotoAiErrorCode): PhotoAiFailure {
  return { ok: false, code, retryAt: null, resetAt: null };
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function snapshotEstimateInput(value: PhotoAiEstimateInput): PhotoAiEstimateInput | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== ESTIMATE_KEYS.length ||
      keys.some((key) => typeof key !== 'string' || !ESTIMATE_KEYS.includes(key as never))
    ) {
      return undefined;
    }
    const fields = new Map<string, unknown>();
    for (const key of ESTIMATE_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) return undefined;
      fields.set(key, descriptor.value);
    }
    const requestId = fields.get('requestId');
    const idempotencyKey = fields.get('idempotencyKey');
    const uploadBlobSha256 = fields.get('uploadBlobSha256');
    const uploadBlob = fields.get('uploadBlob');
    if (
      !isBoundedText(requestId, 120) ||
      typeof idempotencyKey !== 'string' ||
      !/^[a-f0-9]{32}$/.test(idempotencyKey) ||
      typeof uploadBlobSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(uploadBlobSha256) ||
      !(uploadBlob instanceof Blob) ||
      uploadBlob.type !== 'image/webp' ||
      uploadBlob.size <= 0 ||
      uploadBlob.size > PHOTO_AI_LIMITS.uploadBytes
    ) {
      return undefined;
    }
    return { requestId, idempotencyKey, uploadBlobSha256, uploadBlob };
  } catch {
    return undefined;
  }
}

function requestInit(method: 'GET' | 'POST', body?: BodyInit): RequestInit {
  return {
    method,
    body,
    credentials: 'include',
    cache: 'no-store',
    redirect: 'manual',
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function boundedFetch(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timedOut = Symbol('photo-ai-timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(timedOut);
    }, REQUEST_TIMEOUT_MS);
  });
  const request = Promise.resolve()
    .then(async () => {
      const response = await fetcher(url, { ...init, signal: controller.signal });
      const authentication = isAuthenticationResponse(response);
      if (authentication) {
        return { response, authentication, jsonOk: false, value: undefined };
      }
      try {
        const value = (await response.json()) as unknown;
        return { response, authentication, jsonOk: true, value };
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) throw error;
        return { response, authentication, jsonOk: false, value: undefined };
      }
    })
    .then(
      (response) => ({ response } as const),
      (error: unknown) => ({ error } as const),
    );

  const result = await Promise.race([request, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (result === timedOut) return { failure: failure('provider-timeout') };
  if ('error' in result) {
    if (controller.signal.aborted || isAbortError(result.error)) {
      return { failure: failure('provider-timeout') };
    }
    return {
      failure: failure(result.error instanceof TypeError ? 'offline' : 'provider-unavailable'),
    };
  }
  return result.response;
}

function isAuthenticationResponse(response: Response): boolean {
  const contentType = response.headers.get('Content-Type')?.toLowerCase() ?? '';
  return (
    response.redirected ||
    response.type === 'opaqueredirect' ||
    response.status === 401 ||
    contentType.includes('text/html')
  );
}

function parseSession(value: unknown): PhotoAiSessionResponse {
  try {
    return parsePhotoAiSessionResponse(value);
  } catch {
    return failure('invalid-estimate');
  }
}

function parseEstimate(value: unknown): PhotoAiEstimateResponse {
  try {
    return parsePhotoAiEstimateResponse(value);
  } catch {
    return failure('invalid-estimate');
  }
}

function buildEstimateBody(input: PhotoAiEstimateInput): FormData {
  const body = new FormData();
  body.append('image', input.uploadBlob, 'food.webp');
  body.append('requestId', input.requestId);
  body.append('idempotencyKey', input.idempotencyKey);
  body.append('uploadBlobSha256', input.uploadBlobSha256);
  body.append('modelVersion', PHOTO_AI_VERSIONS.model);
  body.append('promptVersion', PHOTO_AI_VERSIONS.prompt);
  body.append('schemaVersion', PHOTO_AI_VERSIONS.schema);
  body.append('catalogVersion', PHOTO_AI_VERSIONS.catalog);
  body.append('transformVersion', PHOTO_AI_VERSIONS.transform);
  body.append('uncertaintyVersion', PHOTO_AI_VERSIONS.uncertainty);
  body.append('providerPolicyVersion', PHOTO_AI_VERSIONS.providerPolicy);
  body.append('locale', 'zh-CN');
  return body;
}

export function createPhotoAiClient(
  fetcher: typeof fetch = fetch,
  delay: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): PhotoAiClient {
  return {
    async session(): Promise<PhotoAiSessionResponse> {
      const result = await boundedFetch(fetcher, SESSION_URL, requestInit('GET'));
      if ('failure' in result) return result.failure;
      if (result.authentication) return failure('auth-required');
      if (!result.jsonOk) return failure('invalid-estimate');
      const parsed = parseSession(result.value);
      if (parsed.ok && result.response.status !== 200) return failure('invalid-estimate');
      return parsed;
    },

    async estimate(rawInput): Promise<PhotoAiEstimateResponse> {
      const input = snapshotEstimateInput(rawInput);
      if (input === undefined) return failure('invalid-estimate');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const body = buildEstimateBody(input);
        const result = await boundedFetch(fetcher, ESTIMATE_URL, requestInit('POST', body));
        if ('failure' in result) return result.failure;
        if (result.authentication) return failure('auth-required');
        if (!result.jsonOk) return failure('invalid-estimate');
        const parsed = parseEstimate(result.value);
        const isInFlight = parsed.ok && parsed.status === 'in-flight';
        if ((result.response.status === 202) !== isInFlight) {
          return failure('invalid-estimate');
        }
        if (parsed.ok && parsed.status === 'complete' && result.response.status !== 200) {
          return failure('invalid-estimate');
        }
        if (isInFlight && attempt === 0) {
          const waitMs = Math.min(parsed.retryAfterMs, MAX_RETRY_DELAY_MS);
          try {
            await delay(waitMs);
          } catch {
            return failure('provider-unavailable');
          }
          continue;
        }
        return parsed;
      }
      return failure('provider-unavailable');
    },

    async logout(): Promise<{ logoutUrl: '/cdn-cgi/access/logout' }> {
      const result = await boundedFetch(fetcher, LOGOUT_URL, requestInit('POST'));
      if (
        'failure' in result ||
        result.authentication ||
        result.response.status !== 200
      ) {
        throw new Error('Photo AI logout failed');
      }
      if (!result.jsonOk) throw new Error('Photo AI logout failed');
      const value = result.value;
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Reflect.ownKeys(value).length !== 1 ||
        Object.getOwnPropertyDescriptor(value, 'logoutUrl')?.value !== '/cdn-cgi/access/logout'
      ) {
        throw new Error('Photo AI logout failed');
      }
      return { logoutUrl: '/cdn-cgi/access/logout' };
    },
  };
}
