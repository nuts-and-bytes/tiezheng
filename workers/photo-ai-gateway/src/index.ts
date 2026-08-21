import {
  GATEWAY_LIMITS,
  PhotoAiCoordinator,
} from './coordinator';
import type { GatewayEnv } from './env';
import {
  handlePhotoAiRequest,
  isPhotoAiGatewayConfigured,
} from './handler';
import type { PhotoAiSessionSuccess } from '../../../src/lib/photoAiContract';

export { PhotoAiCoordinator };

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
} as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: SECURITY_HEADERS });
}

function serviceDisabled(): Response {
  return jsonResponse({
    ok: false,
    code: 'service-disabled',
    retryAt: null,
    resetAt: null,
  }, 503);
}

async function handleSessionRequest(request: Request, env: GatewayEnv): Promise<Response> {
  const accountKey = request.headers.get('x-tiezheng-account-key');
  if (accountKey === null || !/^[a-f0-9]{64}$/.test(accountKey)) return serviceDisabled();
  if (!isPhotoAiGatewayConfigured(env, {
    monthlyBudgetMicros: GATEWAY_LIMITS.monthlyBudgetMicros,
    initialAttemptReserveMicros: GATEWAY_LIMITS.initialAttemptReserveMicros,
    retryAttemptReserveMicros: GATEWAY_LIMITS.retryAttemptReserveMicros,
    resultCacheMs: GATEWAY_LIMITS.resultCacheMs,
  })) {
    return serviceDisabled();
  }

  try {
    const status = await env.PHOTO_AI_COORDINATOR.getByName('stage2').status({
      accountKey,
      now: Date.now(),
    });
    const body: PhotoAiSessionSuccess = {
      ok: true,
      enabled: status.enabled && status.accountEnabled,
      accountRemaining: status.accountRemaining,
      globalRemaining: status.globalRemaining,
      resetAt: status.resetAt,
    };
    return jsonResponse(body, 200);
  } catch {
    return serviceDisabled();
  }
}

export default {
  fetch(request: Request, env: GatewayEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/session' && url.search === '') {
      return handleSessionRequest(request, env);
    }
    if (request.method !== 'POST' || url.pathname !== '/estimate' || url.search !== '') {
      return Promise.resolve(serviceDisabled());
    }
    return handlePhotoAiRequest(request, env, {
      monthlyBudgetMicros: GATEWAY_LIMITS.monthlyBudgetMicros,
      initialAttemptReserveMicros: GATEWAY_LIMITS.initialAttemptReserveMicros,
      retryAttemptReserveMicros: GATEWAY_LIMITS.retryAttemptReserveMicros,
      resultCacheMs: GATEWAY_LIMITS.resultCacheMs,
    });
  },
};
