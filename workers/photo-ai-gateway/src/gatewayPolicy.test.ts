import { describe, expect, test } from 'vitest';

import { GATEWAY_LIMITS, arkCostMicros } from './gatewayPolicy';

describe('photo AI gateway policy', () => {
  test('owns the exact immutable limits and canonical Ark pricing', () => {
    expect(Object.isFrozen(GATEWAY_LIMITS)).toBe(true);
    expect(GATEWAY_LIMITS).toMatchObject({
      monthlyBudgetMicros: 50_000_000,
      initialAttemptReserveMicros: 2_000_000,
      retryAttemptReserveMicros: 2_000_000,
      resultCacheMs: 600_000,
      maxInputTokens: 256_000,
      maxOutputTokens: 1_500,
    });
    expect(arkCostMicros(100, 20)).toBe(1_200);
    expect(arkCostMicros(
      GATEWAY_LIMITS.maxInputTokens,
      GATEWAY_LIMITS.maxOutputTokens,
    )).toBe(1_581_000);
  });

  test.each([
    [-1, 0],
    [0, -1],
    [0.5, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
    [Number.MAX_SAFE_INTEGER, 0],
  ])('rejects unsafe token counts or an unsafe result', (inputTokens, outputTokens) => {
    expect(() => arkCostMicros(inputTokens, outputTokens)).toThrow('Invalid coordinator input');
  });
});
