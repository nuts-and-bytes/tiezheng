export const GATEWAY_LIMITS = Object.freeze({
  accountDaily: 10,
  accountPerMinute: 2,
  accountConcurrent: 1,
  betaAccounts: 3,
  globalDaily: 30,
  globalConcurrent: 2,
  monthlyBudgetMicros: 50_000_000,
  initialAttemptReserveMicros: 2_000_000,
  retryAttemptReserveMicros: 2_000_000,
  leaseMs: 60_000,
  resultCacheMs: 10 * 60_000,
  idempotencyMs: 24 * 60 * 60_000,
  providerTimeoutMs: 12_000,
  maxInputTokens: 256_000,
  maxOutputTokens: 1_500,
  maxMultipartBytes: 1_100_000,
  maxDecodedPixels: 40_000_000,
  maxDimension: 12_000,
  maxAspectRatio: 20,
} as const);

function invalid(): never {
  throw new TypeError('Invalid coordinator input');
}

export function arkCostMicros(inputTokens: number, outputTokens: number): number {
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0
    || !Number.isSafeInteger(outputTokens) || outputTokens < 0) return invalid();
  const result = inputTokens * 6 + outputTokens * 30;
  if (!Number.isSafeInteger(result)) return invalid();
  return result;
}
