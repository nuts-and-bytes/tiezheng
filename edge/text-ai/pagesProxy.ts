import {
  parseTextAiEstimateResponse,
  parseTextAiSessionResponse,
  type TextAiErrorCode,
  type TextAiEstimateResponse,
  type TextAiSessionResponse,
} from '../../src/lib/textAiContract';
import {
  isIndeterminateServiceResponse,
  proxyBoundedJson,
  type JsonProxyDefinition,
} from '../nutrition-ai/pagesProxyCore';
import {
  parseTextPagesRequestConfig,
  validateTextPagesRequest,
  type TextPagesRoute,
} from './pagesRequest';
import {
  parseTextAuthConfig,
  verifyTextSession,
  type TextAuthEnv,
} from './auth';

export interface TextAiPagesEnv extends TextAuthEnv {
  PHOTO_AI_ALLOWED_ORIGINS: string;
  TEXT_AI_ADMIN_SIGNING_KEY: string;
  PHOTO_AI_GATEWAY?: Fetcher;
}

export type TextAiProxyRoute = 'session' | 'estimate';

export interface AuthorizedTextAiPagesRequest {
  accountKey: string;
  origin: string;
  route: TextPagesRoute;
}

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

const TRANSPORT_FAILURE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
} as const;

const FAILURE_STATUS: Readonly<Record<TextAiErrorCode, number>> = Object.freeze({
  offline: 503,
  'auth-required': 401,
  'auth-expired': 401,
  'quota-exceeded': 429,
  'rate-limited': 429,
  'service-disabled': 503,
  'budget-exceeded': 429,
  'provider-timeout': 504,
  'provider-unavailable': 503,
  'invalid-estimate': 502,
  'uncertain-food': 422,
  'idempotency-conflict': 409,
});

export function textAiPagesJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

export function textAiPagesFailure(
  code: 'auth-required' | 'service-disabled' | 'provider-unavailable',
  status: 401 | 503,
): Response {
  return textAiPagesJson({ ok: false, code, retryAt: null, resetAt: null }, status);
}

export async function authorizeTextAiPagesRequest(
  request: Request,
  env: TextAiPagesEnv,
  allowedRoutes: readonly Exclude<TextPagesRoute, 'login'>[],
): Promise<AuthorizedTextAiPagesRequest> {
  const pagesConfig = parseTextPagesRequestConfig({
    PHOTO_AI_PAGES_ORIGIN: env.PHOTO_AI_ALLOWED_ORIGINS,
  });
  const { route } = validateTextPagesRequest(request, pagesConfig);
  if (route === 'login' || !allowedRoutes.some((candidate) => candidate === route)) {
    throw new TypeError('Invalid Pages route');
  }
  const identity = await verifyTextSession(request, parseTextAuthConfig(env));
  return { accountKey: identity.accountKey, origin: pagesConfig.origin, route };
}

function expectedStatus(
  route: TextAiProxyRoute,
  body: TextAiSessionResponse | TextAiEstimateResponse,
): number {
  if (!body.ok) return FAILURE_STATUS[body.code];
  if (route === 'session') {
    if ('status' in body) throw new TypeError('Invalid service response');
    return 200;
  }
  if (!('status' in body)) throw new TypeError('Invalid service response');
  return body.status === 'in-flight' ? 202 : 200;
}

const TEXT_SESSION_PROXY: JsonProxyDefinition<TextAiSessionResponse> = {
  downstreamPath: '/text/session',
  method: 'GET',
  parse: parseTextAiSessionResponse,
  expectedStatus: (body) => expectedStatus('session', body),
  requestBodyLimit: null,
};

const TEXT_ESTIMATE_PROXY: JsonProxyDefinition<TextAiEstimateResponse> = {
  downstreamPath: '/text/estimate',
  method: 'POST',
  parse: parseTextAiEstimateResponse,
  expectedStatus: (body) => expectedStatus('estimate', body),
  requestBodyLimit: 8_192,
};

export async function proxyTextAiRequest(
  request: Request,
  env: TextAiPagesEnv,
  accountKey: string,
  route: TextAiProxyRoute,
): Promise<Response> {
  if (
    typeof env.PHOTO_AI_GATEWAY !== 'object' ||
    env.PHOTO_AI_GATEWAY === null ||
    typeof env.PHOTO_AI_GATEWAY.fetch !== 'function'
  ) {
    return textAiPagesFailure('service-disabled', 503);
  }

  try {
    const result = route === 'session'
      ? await proxyBoundedJson(request, env.PHOTO_AI_GATEWAY, accountKey, TEXT_SESSION_PROXY)
      : await proxyBoundedJson(request, env.PHOTO_AI_GATEWAY, accountKey, TEXT_ESTIMATE_PROXY);
    return textAiPagesJson(result.body, result.status);
  } catch (error) {
    if (route === 'estimate' && isIndeterminateServiceResponse(error)) {
      return new Response(null, { status: 502, headers: TRANSPORT_FAILURE_HEADERS });
    }
    return textAiPagesFailure('provider-unavailable', 503);
  }
}
