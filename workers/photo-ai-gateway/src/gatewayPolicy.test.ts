import { describe, expect, test } from 'vitest';

import {
  GATEWAY_CHANNEL_POLICY,
  GATEWAY_LIMITS,
  arkCostMicros,
  deepseekTextCostMicros,
} from './gatewayPolicy';

describe('photo AI gateway policy', () => {
  test('owns immutable photo and text channel quotas and provider reserves', () => {
    expect(Object.isFrozen(GATEWAY_CHANNEL_POLICY)).toBe(true);
    expect(Object.isFrozen(GATEWAY_CHANNEL_POLICY.photo)).toBe(true);
    expect(Object.isFrozen(GATEWAY_CHANNEL_POLICY.text)).toBe(true);
    expect(GATEWAY_CHANNEL_POLICY).toEqual({
      photo: {
        accountDaily: 10,
        globalDaily: 30,
        accountPerMinute: 2,
        initialAttemptReserveMicros: 2_000_000,
        retryAttemptReserveMicros: 2_000_000,
      },
      text: {
        accountDaily: 10,
        globalDaily: 30,
        accountPerMinute: 2,
        initialAttemptReserveMicros: 500_000,
        retryAttemptReserveMicros: 500_000,
      },
    });
    expect(GATEWAY_LIMITS.accountDaily).toBe(GATEWAY_CHANNEL_POLICY.photo.accountDaily);
    expect(GATEWAY_LIMITS.globalDaily).toBe(GATEWAY_CHANNEL_POLICY.photo.globalDaily);
    expect(GATEWAY_LIMITS.accountPerMinute).toBe(GATEWAY_CHANNEL_POLICY.photo.accountPerMinute);
    expect(GATEWAY_LIMITS.initialAttemptReserveMicros)
      .toBe(GATEWAY_CHANNEL_POLICY.photo.initialAttemptReserveMicros);
    expect(GATEWAY_LIMITS.retryAttemptReserveMicros)
      .toBe(GATEWAY_CHANNEL_POLICY.photo.retryAttemptReserveMicros);
  });

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

  test('charges DeepSeek V4 Flash peak cache-miss USD pricing under a 10 CNY/USD ceiling', () => {
    expect(deepseekTextCostMicros(100, 20)).toBe(704);
    expect(deepseekTextCostMicros(0, 1)).toBe(14);
    expect(deepseekTextCostMicros(1, 0)).toBe(5);
  });

  test.each([
    [-1, 0],
    [0, -1],
    [0.5, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 0],
  ])('rejects invalid token counts', (inputTokens, outputTokens) => {
    expect(() => arkCostMicros(inputTokens, outputTokens)).toThrow('Invalid coordinator input');
    expect(() => deepseekTextCostMicros(inputTokens, outputTokens))
      .toThrow('Invalid coordinator input');
  });

  test('rejects provider-specific unsafe cost results', () => {
    expect(() => arkCostMicros(Number.MAX_SAFE_INTEGER, 0))
      .toThrow('Invalid coordinator input');
    expect(() => deepseekTextCostMicros(0, Number.MAX_SAFE_INTEGER))
      .toThrow('Invalid coordinator input');
  });
});
