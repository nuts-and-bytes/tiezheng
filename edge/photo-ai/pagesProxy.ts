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
import {
  proxyBoundedJson,
  type JsonProxyDefinition,
} from '../nutrition-ai/pagesProxyCore';

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

const PHOTO_SESSION_PROXY: JsonProxyDefinition<PhotoAiSessionResponse> = {
  downstreamPath: '/session',
  method: 'GET',
  parse: parsePhotoAiSessionResponse,
  expectedStatus: (body) => expectedStatus('session', body),
  requestBodyLimit: null,
};

const PHOTO_ESTIMATE_PROXY: JsonProxyDefinition<PhotoAiEstimateResponse> = {
  downstreamPath: '/estimate',
  method: 'POST',
  parse: parsePhotoAiEstimateResponse,
  expectedStatus: (body) => expectedStatus('estimate', body),
  requestBodyLimit: 1_100_000,
};

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
  try {
    const result = route === 'session'
      ? await proxyBoundedJson(request, env.PHOTO_AI_GATEWAY, accountKey, PHOTO_SESSION_PROXY)
      : await proxyBoundedJson(request, env.PHOTO_AI_GATEWAY, accountKey, PHOTO_ESTIMATE_PROXY);
    return photoAiPagesJson(result.body, result.status);
  } catch {
    return photoAiPagesFailure('provider-unavailable', 503);
  }
}
