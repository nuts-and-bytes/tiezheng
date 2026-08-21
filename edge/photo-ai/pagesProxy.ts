import {
  parsePhotoAiEstimateResponse,
  parsePhotoAiSessionResponse,
  type PhotoAiErrorCode,
  type PhotoAiEstimateResponse,
  type PhotoAiSessionResponse,
} from '../../src/lib/photoAiContract';
import {
  parseAccessConfig,
  verifyAccess,
  type AccessEnv,
} from './access';
import {
  parsePagesRequestConfig,
  validatePagesRequest,
  type PagesRoute,
} from './pagesRequest';

export interface PhotoAiPagesEnv extends AccessEnv {
  PHOTO_AI_ALLOWED_ORIGINS: string;
  PHOTO_AI_GATEWAY?: Fetcher;
}

export type PhotoAiProxyRoute = 'session' | 'estimate';

export interface AuthorizedPhotoAiPagesRequest {
  accountKey: string;
  origin: string;
  route: PagesRoute;
}

const INTERNAL_ORIGIN = 'https://photo-ai-gateway.internal';
const MAX_RESPONSE_BYTES = 256_000;
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

const FAILURE_STATUS: Readonly<Record<PhotoAiErrorCode, number>> = Object.freeze({
  'unsupported-file': 400,
  'image-too-large': 400,
  'decode-failed': 400,
  offline: 503,
  'auth-required': 401,
  'auth-expired': 401,
  'quota-exceeded': 429,
  'rate-limited': 429,
  'service-disabled': 503,
  'budget-exceeded': 429,
  'consent-expired': 400,
  'provider-timeout': 504,
  'provider-unavailable': 503,
  'invalid-estimate': 502,
  'uncertain-food': 422,
  'idempotency-conflict': 409,
});

export function photoAiPagesJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

export function photoAiPagesFailure(
  code: 'auth-required' | 'service-disabled' | 'provider-unavailable',
  status: 401 | 503,
): Response {
  return photoAiPagesJson({ ok: false, code, retryAt: null, resetAt: null }, status);
}

export function photoAiPagesResumeRedirect(origin: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...SECURITY_HEADERS,
      location: `${origin}/health?photoAi=resume`,
    },
  });
}

export async function authorizePhotoAiPagesRequest(
  request: Request,
  env: PhotoAiPagesEnv,
  allowedRoutes: readonly PagesRoute[],
): Promise<AuthorizedPhotoAiPagesRequest> {
  const pagesConfig = parsePagesRequestConfig({
    PHOTO_AI_PAGES_ORIGIN: env.PHOTO_AI_ALLOWED_ORIGINS,
  });
  const { route } = validatePagesRequest(request, pagesConfig);
  if (!allowedRoutes.includes(route)) throw new TypeError('Invalid Pages route');
  const identity = await verifyAccess(request, parseAccessConfig(env));
  return { accountKey: identity.accountKey, origin: pagesConfig.origin, route };
}

function expectedStatus(
  route: PhotoAiProxyRoute,
  body: PhotoAiSessionResponse | PhotoAiEstimateResponse,
): number {
  if (!body.ok) return FAILURE_STATUS[body.code];
  if (route === 'session') {
    if ('status' in body) throw new TypeError('Invalid service response');
    return 200;
  }
  if (!('status' in body)) throw new TypeError('Invalid service response');
  return body.status === 'in-flight' ? 202 : 200;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !/^application\/json(?:;|$)/i.test(contentType)) {
    throw new TypeError('Invalid service response');
  }

  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(0|[1-9]\d*)$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new TypeError('Invalid service response');
  }

  if (response.body === null) throw new TypeError('Invalid service response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new TypeError('Invalid service response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function proxyPhotoAiRequest(
  request: Request,
  env: PhotoAiPagesEnv,
  accountKey: string,
  route: PhotoAiProxyRoute,
): Promise<Response> {
  if (typeof env.PHOTO_AI_GATEWAY !== 'object'
    || env.PHOTO_AI_GATEWAY === null
    || typeof env.PHOTO_AI_GATEWAY.fetch !== 'function') {
    return photoAiPagesFailure('service-disabled', 503);
  }
  if (!/^[a-f0-9]{64}$/.test(accountKey)) {
    return photoAiPagesFailure('provider-unavailable', 503);
  }

  const headers = new Headers({ 'x-tiezheng-account-key': accountKey });
  const init: RequestInit = {
    method: route === 'estimate' ? 'POST' : 'GET',
    headers,
  };
  if (route === 'estimate') {
    const contentType = request.headers.get('content-type');
    const contentLength = request.headers.get('content-length');
    if (contentType === null || contentLength === null || request.body === null) {
      return photoAiPagesFailure('provider-unavailable', 503);
    }
    headers.set('content-type', contentType);
    headers.set('content-length', contentLength);
    init.body = request.body;
  }

  try {
    const downstream = await env.PHOTO_AI_GATEWAY.fetch(
      `${INTERNAL_ORIGIN}/${route}`,
      init,
    );
    const raw = await readBoundedJson(downstream);
    const parsed = route === 'session'
      ? parsePhotoAiSessionResponse(raw)
      : parsePhotoAiEstimateResponse(raw);
    const status = expectedStatus(route, parsed);
    if (downstream.status !== status) throw new TypeError('Invalid service response');
    return photoAiPagesJson(parsed, status);
  } catch {
    return photoAiPagesFailure('provider-unavailable', 503);
  }
}
