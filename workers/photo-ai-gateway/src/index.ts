import {
  GATEWAY_LIMITS,
  PhotoAiCoordinator,
  arkCostMicros,
} from './coordinator';
import type { GatewayEnv } from './env';
import { handlePhotoAiRequest } from './handler';

export { PhotoAiCoordinator };

export default {
  fetch(request: Request, env: GatewayEnv): Promise<Response> {
    return handlePhotoAiRequest(request, env, {
      monthlyBudgetMicros: GATEWAY_LIMITS.monthlyBudgetMicros,
      initialAttemptReserveMicros: GATEWAY_LIMITS.initialAttemptReserveMicros,
      retryAttemptReserveMicros: GATEWAY_LIMITS.retryAttemptReserveMicros,
      resultCacheMs: GATEWAY_LIMITS.resultCacheMs,
      arkCostMicros,
    });
  },
};
