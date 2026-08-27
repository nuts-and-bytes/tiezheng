import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  TEXT_AI_LIMITS,
  TEXT_AI_VERSIONS,
  parseTextAiEstimateRequest,
  parseTextAiEstimateResponse,
  parseTextAiLoginResponse,
  parseTextAiLogoutResponse,
  parseTextAiSessionResponse,
  textAiErrorCopy,
  type TextAiErrorCode,
  type TextAiEstimateCandidate,
  type TextAiEstimateInFlight,
  type TextAiEstimateRequest,
  type TextAiEstimateResponse,
  type TextAiEstimateSuccess,
  type TextAiFailure,
  type TextAiLoginResponse,
  type TextAiLoginSuccess,
  type TextAiLogoutResponse,
  type TextAiLogoutSuccess,
  type TextAiSessionResponse,
  type TextAiSessionSuccess,
  type TextMealDraft,
} from './textAiContract';
import type { MealEstimateCandidate } from './nutritionTypes';
import {
  textAiCandidateFixture,
  textAiEstimateInFlightFixture,
  textAiEstimateSuccessFixture,
  textAiFailureFixture,
  textAiRequestFixture,
  textAiSessionSuccessFixture,
} from '../test/textAiFixtures';

const REQUEST_ERROR = 'Invalid text AI request';
const RESPONSE_ERROR = 'Invalid text AI response';

const allErrorCodes = [
  'offline',
  'auth-required',
  'auth-expired',
  'quota-exceeded',
  'rate-limited',
  'service-disabled',
  'budget-exceeded',
  'provider-timeout',
  'provider-unavailable',
  'invalid-estimate',
  'uncertain-food',
  'idempotency-conflict',
] as const satisfies readonly TextAiErrorCode[];

const expectedErrorCopy = {
  offline: '当前离线，请联网后重试',
  'auth-required': '请先登录后再使用餐食估算',
  'auth-expired': '登录已过期，请重新登录',
  'quota-exceeded': '今日餐食估算次数已用完',
  'rate-limited': '请求过于频繁，请稍后重试',
  'service-disabled': '餐食估算服务当前未开启',
  'budget-exceeded': '餐食估算服务今日额度已用完',
  'provider-timeout': '餐食估算超时，请重试',
  'provider-unavailable': '餐食估算服务暂时不可用',
  'invalid-estimate': '估算结果无效，请重试',
  'uncertain-food': '无法可靠估算，请手动记录',
  'idempotency-conflict': '请求内容已变化，请重新估算',
} as const satisfies Record<TextAiErrorCode, string>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function candidate(
  overrides: Partial<MealEstimateCandidate> = {},
): MealEstimateCandidate {
  return {
    ...textAiCandidateFixture,
    assumptions: [...textAiCandidateFixture.assumptions],
    ...overrides,
  };
}

function responseWithCandidate(value: unknown): unknown {
  return {
    ...clone(textAiEstimateSuccessFixture),
    candidates: [value],
  };
}

function expectRequestRejected(value: unknown): void {
  expect(() => parseTextAiEstimateRequest(value)).toThrow(REQUEST_ERROR);
}

function expectResponseRejected(value: unknown): void {
  expect(() => parseTextAiEstimateResponse(value)).toThrow(RESPONSE_ERROR);
}

function sparseArray<T>(): T[] {
  return new Array<T>(1);
}

describe('fixed text AI contract', () => {
  test('固定文字模型、提示、schema、目录和策略版本', () => {
    expect(TEXT_AI_VERSIONS).toEqual({
      model: 'doubao-seed-2-1-pro-260628',
      prompt: 'tiezheng-food-text-zh-v1',
      schema: 'tiezheng-text-estimate-v1',
      catalog: 'tiezheng-food-catalog-v2',
      uncertainty: 'tiezheng-text-uncertainty-v1',
      providerPolicy: 'volcengine-ark-policy-2026-08-18',
    });
    expect(TEXT_AI_LIMITS).toEqual({
      descriptionChars: 500,
      amountMin: 0.01,
      amountMax: 100_000,
      candidates: 1,
      assumptions: 8,
      timeoutMs: 20_000,
      requestBytes: 8 * 1024,
    });
    expect(Object.isFrozen(TEXT_AI_VERSIONS)).toBe(true);
    expect(Object.isFrozen(TEXT_AI_LIMITS)).toBe(true);
  });

  test('exports the exact request and response shapes', () => {
    expectTypeOf<TextMealDraft>().toEqualTypeOf<{
      description: string;
      amount: { value: number; unit: 'g' | 'mL' } | null;
    }>();
    expectTypeOf<TextAiEstimateRequest>().toMatchTypeOf<TextMealDraft>();
    expectTypeOf<TextAiSessionResponse>().toEqualTypeOf<
      TextAiSessionSuccess | TextAiFailure
    >();
    expectTypeOf<TextAiEstimateResponse>().toEqualTypeOf<
      TextAiEstimateSuccess | TextAiEstimateInFlight | TextAiFailure
    >();
    expectTypeOf<TextAiEstimateCandidate>().toMatchTypeOf<MealEstimateCandidate>();
    expectTypeOf<TextAiEstimateSuccess['candidates']>().toEqualTypeOf<
      [TextAiEstimateCandidate]
    >();
  });

  test('uses text-specific fixed error copy for every code', () => {
    expect(Object.fromEntries(allErrorCodes.map((code) => [code, textAiErrorCopy(code)])))
      .toEqual(expectedErrorCopy);
  });

  test('rejects an unknown error code passed at runtime', () => {
    expect(() => textAiErrorCopy('other' as TextAiErrorCode)).toThrow(RESPONSE_ERROR);
  });
});

describe('parseTextAiEstimateRequest', () => {
  test('normalizes description with NFC then trim and returns detached amount', () => {
    const input = clone(textAiRequestFixture);
    input.description = '  Cafe\u0301 牛肉面  ';
    const parsed = parseTextAiEstimateRequest(input);

    expect(parsed.description).toBe('Café 牛肉面');
    expect(parsed).toEqual({ ...textAiRequestFixture, description: 'Café 牛肉面' });
    expect(parsed).not.toBe(input);
    expect(parsed.amount).not.toBe(input.amount);
    if (input.amount !== null) input.amount.value = 999;
    expect(parsed.amount).toEqual({ value: 500, unit: 'g' });
  });

  test.each([
    { ...textAiRequestFixture, extra: true },
    Object.assign(Object.create({ inherited: true }), textAiRequestFixture),
    { ...textAiRequestFixture, [Symbol('hidden')]: true },
    [],
    new Date(),
  ])('rejects non-plain or non-exact request objects %#', (value) => {
    expectRequestRejected(value);
  });

  test('rejects a request accessor without invoking it', () => {
    const value = clone(textAiRequestFixture) as object;
    let getterCalls = 0;
    Object.defineProperty(value, 'description', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return '不应读取';
      },
    });

    expectRequestRejected(value);
    expect(getterCalls).toBe(0);
  });

  test('rejects an accessor descriptor under Object.prototype.value pollution', () => {
    const value = clone(textAiRequestFixture) as object;
    let getterCalls = 0;
    Object.defineProperty(value, 'description', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return '不应读取';
      },
    });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    let caught: unknown;
    try {
      Object.defineProperty(Object.prototype, 'value', {
        configurable: true,
        value: textAiRequestFixture.description,
      });
      parseTextAiEstimateRequest(value);
    } catch (error) {
      caught = error;
    } finally {
      if (previous === undefined) delete (Object.prototype as { value?: unknown }).value;
      else Object.defineProperty(Object.prototype, 'value', previous);
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe(REQUEST_ERROR);
    expect(getterCalls).toBe(0);
  });

  test('normalizes throwing reflection traps to the request error', () => {
    const value = new Proxy(clone(textAiRequestFixture), {
      ownKeys() {
        throw new Error('reviewer-sensitive');
      },
    });

    expectRequestRejected(value);
  });

  test.each([
    '',
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-4111-7111-111111111111',
    '11111111-1111-4111-8111-11111111111A',
    '11111111111141118111111111111111',
  ])('rejects a non-canonical request UUID: %s', (requestId) => {
    expectRequestRejected({ ...textAiRequestFixture, requestId });
  });

  test.each([
    '',
    'a'.repeat(31),
    'a'.repeat(33),
    'A'.repeat(32),
    'g'.repeat(32),
    '11111111-1111-4111-8111-111111111111',
  ])('rejects an idempotency key that is not 32 lowercase hex: %s', (idempotencyKey) => {
    expectRequestRejected({ ...textAiRequestFixture, idempotencyKey });
  });

  test('accepts the normalized description boundary', () => {
    expect(parseTextAiEstimateRequest({
      ...textAiRequestFixture,
      description: `  ${'字'.repeat(TEXT_AI_LIMITS.descriptionChars)}  `,
    }).description).toHaveLength(TEXT_AI_LIMITS.descriptionChars);
  });

  test.each([
    '',
    ' \t ',
    '字'.repeat(TEXT_AI_LIMITS.descriptionChars + 1),
    '牛\n肉面',
    '牛\u0000肉面',
    '牛\u007f肉面',
    123,
  ])('rejects an invalid normalized description %#', (description) => {
    expectRequestRejected({ ...textAiRequestFixture, description });
  });

  test.each([
    null,
    { value: TEXT_AI_LIMITS.amountMin, unit: 'g' },
    { value: TEXT_AI_LIMITS.amountMax, unit: 'mL' },
  ])('accepts an exact amount boundary %#', (amount) => {
    expect(parseTextAiEstimateRequest({ ...textAiRequestFixture, amount }).amount)
      .toEqual(amount);
  });

  test.each([
    {},
    { value: 1 },
    { value: 1, unit: 'kg' },
    { value: 1, unit: 'g', extra: true },
    { value: 0, unit: 'g' },
    { value: 100_000.01, unit: 'mL' },
    { value: Number.NaN, unit: 'g' },
    { value: Number.POSITIVE_INFINITY, unit: 'g' },
  ])('rejects an invalid amount %#', (amount) => {
    expectRequestRejected({ ...textAiRequestFixture, amount });
  });

  test('rejects inherited and accessor amount fields without invoking getters', () => {
    const inherited = Object.assign(Object.create({ value: 500 }), { unit: 'g' });
    expectRequestRejected({ ...textAiRequestFixture, amount: inherited });

    let getterCalls = 0;
    const accessor = Object.defineProperty({ unit: 'g' }, 'value', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 500;
      },
    });
    expectRequestRejected({ ...textAiRequestFixture, amount: accessor });
    expect(getterCalls).toBe(0);
  });

  test.each(Object.keys(TEXT_AI_VERSIONS) as Array<keyof typeof TEXT_AI_VERSIONS>)(
    'rejects drift in the %s request version',
    (key) => {
      const requestField = `${key}Version`;
      expectRequestRejected({
        ...textAiRequestFixture,
        [requestField]: `${TEXT_AI_VERSIONS[key]}-stale`,
      });
    },
  );

  test.each(['en-US', 'zh-cn', '', null])('rejects an invalid locale: %s', (locale) => {
    expectRequestRejected({ ...textAiRequestFixture, locale });
  });
});

describe('parseTextAiSessionResponse', () => {
  test('accepts complete success and failure fixtures', () => {
    expect(parseTextAiSessionResponse(clone(textAiSessionSuccessFixture)))
      .toEqual(textAiSessionSuccessFixture);
    expect(parseTextAiSessionResponse(clone(textAiFailureFixture)))
      .toEqual(textAiFailureFixture);
  });

  test.each([
    { ...textAiSessionSuccessFixture, extra: true },
    { ...textAiFailureFixture, extra: true },
    { ...textAiSessionSuccessFixture, accountRemaining: -1 },
    { ...textAiSessionSuccessFixture, globalRemaining: 1.5 },
    { ...textAiSessionSuccessFixture, accountRemaining: Number.POSITIVE_INFINITY },
    { ...textAiSessionSuccessFixture, resetAt: '2026-08-22T00:00:00Z' },
  ])('rejects invalid session response %#', (value) => {
    expect(() => parseTextAiSessionResponse(value)).toThrow(RESPONSE_ERROR);
  });
});

describe('parseTextAiLoginResponse', () => {
  test('accepts only exact login success and the three public authentication failures', () => {
    expect(parseTextAiLoginResponse({ ok: true })).toEqual({ ok: true });
    for (const code of ['auth-required', 'rate-limited', 'service-disabled'] as const) {
      expect(parseTextAiLoginResponse({
        ok: false,
        code,
        retryAt: code === 'rate-limited' ? '2026-08-27T09:15:00.000Z' : null,
        resetAt: null,
      })).toEqual({
        ok: false,
        code,
        retryAt: code === 'rate-limited' ? '2026-08-27T09:15:00.000Z' : null,
        resetAt: null,
      });
    }
    expectTypeOf<TextAiLoginSuccess>().toEqualTypeOf<{ ok: true }>();
    expectTypeOf<TextAiLoginResponse>().toMatchTypeOf<TextAiLoginSuccess | TextAiFailure>();
  });

  test.each([
    { ok: true, extra: true },
    { ok: false, code: 'offline', retryAt: null, resetAt: null },
    { ok: false, code: 'auth-expired', retryAt: null, resetAt: null },
    { ok: false, code: 'auth-required', retryAt: '2026-08-27T09:15:00.000Z', resetAt: null },
    { ok: false, code: 'service-disabled', retryAt: null, resetAt: '2026-08-27T09:15:00.000Z' },
    { ok: false, code: 'rate-limited', retryAt: null, resetAt: null },
    { ok: false, code: 'rate-limited', retryAt: '2026-08-27T09:15:00.000Z', resetAt: '2026-08-28T00:00:00.000Z' },
    { ok: false, code: 'rate-limited', retryAt: 'not-an-instant', resetAt: null },
    Object.assign(Object.create({ inherited: true }), { ok: true }),
    [],
  ])('rejects an invalid login response %#', (value) => {
    expect(() => parseTextAiLoginResponse(value)).toThrow(RESPONSE_ERROR);
  });
});

describe('parseTextAiLogoutResponse', () => {
  test('accepts only exact logout success', () => {
    expect(parseTextAiLogoutResponse({ ok: true })).toEqual({ ok: true });
    expectTypeOf<TextAiLogoutSuccess>().toEqualTypeOf<{ ok: true }>();
    expectTypeOf<TextAiLogoutResponse>().toMatchTypeOf<TextAiLogoutSuccess | TextAiFailure>();
  });

  test.each([
    { ok: true, extra: true },
    { ok: false, code: 'auth-required', retryAt: null, resetAt: null },
    Object.assign(Object.create({ inherited: true }), { ok: true }),
    [],
  ])('rejects an invalid logout response %#', (value) => {
    expect(() => parseTextAiLogoutResponse(value)).toThrow(RESPONSE_ERROR);
  });
});

describe('parseTextAiEstimateResponse', () => {
  test('成功响应只接受一个完整 model-range 整餐候选', () => {
    const parsed = parseTextAiEstimateResponse(clone(textAiEstimateSuccessFixture));
    expect(parsed).toEqual(textAiEstimateSuccessFixture);
    if (!parsed.ok || parsed.status !== 'complete') throw new Error('expected complete');
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]).toMatchObject({
      catalogFoodId: null,
      nutrientSource: 'model-range',
    });
  });

  test('accepts complete in-flight and failure branches', () => {
    expect(parseTextAiEstimateResponse(clone(textAiEstimateInFlightFixture)))
      .toEqual(textAiEstimateInFlightFixture);
    expect(parseTextAiEstimateResponse(clone(textAiFailureFixture)))
      .toEqual(textAiFailureFixture);
  });

  test.each([0, 60_000])(
    'accepts an in-flight retry delay at the explicit boundary: %s',
    (retryAfterMs) => {
      expect(parseTextAiEstimateResponse({
        ...textAiEstimateInFlightFixture,
        retryAfterMs,
      })).toMatchObject({ retryAfterMs });
    },
  );

  test.each([
    { candidates: [] },
    { candidates: [candidate(), candidate({ id: 'second' })] },
    { candidates: [candidate({ catalogFoodId: 'food:preset:usda:168878' })] },
    { candidates: [candidate({ nutrientSource: 'catalog' })] },
    { candidates: [candidate({ energyKcalLow: 900, energyKcalHigh: 400 })] },
    { candidates: [candidate({ proteinGLow: null })] },
    { candidates: [candidate({ proteinGHigh: null })] },
    { candidates: [candidate({ energyKcalLow: null })] },
    { candidates: [candidate({ energyKcalHigh: null })] },
    { candidates: [candidate({ assumptions: [] })] },
  ])('拒绝非法候选 %#', (override) => {
    expectResponseRejected({ ...clone(textAiEstimateSuccessFixture), ...override });
  });

  test.each([
    Object.assign({}, textAiEstimateSuccessFixture, { extra: true }),
    Object.assign(Object.create({ inherited: true }), textAiEstimateSuccessFixture),
    { ...textAiEstimateSuccessFixture, [Symbol('hidden')]: true },
    [],
    new Date(),
  ])('响应解析不执行访问器且只接受普通精确对象 %#', (value) => {
    expectResponseRejected(value);
  });

  test('rejects response accessors without invoking them', () => {
    const value = clone(textAiEstimateSuccessFixture) as object;
    let getterCalls = 0;
    Object.defineProperty(value, 'ok', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    expectResponseRejected(value);
    expect(getterCalls).toBe(0);
  });

  test.each(Object.keys(TEXT_AI_VERSIONS) as Array<keyof typeof TEXT_AI_VERSIONS>)(
    'rejects drift in the %s response version',
    (key) => {
      expectResponseRejected({
        ...clone(textAiEstimateSuccessFixture),
        versions: {
          ...textAiEstimateSuccessFixture.versions,
          [key]: `${TEXT_AI_VERSIONS[key]}-stale`,
        },
      });
    },
  );

  test('rejects unknown or inherited version keys', () => {
    expectResponseRejected({
      ...clone(textAiEstimateSuccessFixture),
      versions: { ...TEXT_AI_VERSIONS, extra: true },
    });

    const versions = clone(TEXT_AI_VERSIONS) as Record<string, unknown>;
    const model = versions.model;
    delete versions.model;
    expectResponseRejected({
      ...clone(textAiEstimateSuccessFixture),
      versions: Object.assign(Object.create({ model }), versions),
    });
  });

  test.each([
    ['id', ''],
    ['id', 'x'.repeat(121)],
    ['name', ''],
    ['name', 'x'.repeat(121)],
    ['preparation', ''],
    ['preparation', 'x'.repeat(121)],
    ['amountLow', 0],
    ['amountHigh', 100_000.01],
    ['amountLow', Number.NaN],
    ['amountHigh', Number.POSITIVE_INFINITY],
    ['energyKcalLow', -1],
    ['energyKcalHigh', 100_000.01],
    ['proteinGLow', -1],
    ['proteinGHigh', 10_000.01],
    ['unit', 'kg'],
  ] as const)('rejects invalid candidate %s=%s', (field, value) => {
    expectResponseRejected(responseWithCandidate(candidate({ [field]: value })));
  });

  test.each([
    ['name', '   '],
    ['name', '牛\u0000肉面'],
    ['name', '牛\u007f肉面'],
    ['name', '牛\u202e肉面'],
    ['name', '牛\u200b肉面'],
    ['name', '牛\ufeff肉面'],
    ['name', '牛\u0085肉面'],
    ['name', '牛\u2028肉面'],
    ['name', '牛\u00ad肉面'],
    ['name', '牛\ufff9肉面'],
    ['name', '牛\ud800肉面'],
    ['preparation', '\t'],
    ['preparation', '整餐\u202e估算'],
    ['preparation', '整餐\u200b估算'],
  ] as const)('rejects unsafe display candidate %s=%j', (field, value) => {
    expectResponseRejected(responseWithCandidate(candidate({ [field]: value })));
  });

  test.each([
    ['all whitespace', ['   ']],
    ['C0', ['按一碗\n面估算']],
    ['DEL', ['按一碗\u007f面估算']],
    ['bidi', ['按一碗\u202e面估算']],
    ['zero-width', ['按一碗\u200b面估算']],
    ['BOM', ['按一碗\ufeff面估算']],
  ])('rejects unsafe %s assumptions', (_label, assumptions) => {
    expectResponseRejected(responseWithCandidate(candidate({ assumptions })));
  });

  test('keeps normal Chinese punctuation in display strings', () => {
    expect(parseTextAiEstimateResponse(responseWithCandidate(candidate({
      name: '牛肉面\u3000（少油），大碗。',
      preparation: '整餐估算：清汤、少油。',
      assumptions: ['按“一碗”熟面估算；不含饮料。'],
    })))).toMatchObject({ ok: true, status: 'complete' });
  });

  test.each([
    ['energyKcalLow', candidate({ energyKcalLow: -0 })],
    ['energyKcalHigh', candidate({ energyKcalLow: 0, energyKcalHigh: -0 })],
    ['proteinGLow', candidate({ proteinGLow: -0 })],
    ['proteinGHigh', candidate({ proteinGLow: 0, proteinGHigh: -0 })],
  ])('rejects negative zero in candidate %s', (_field, value) => {
    expectResponseRejected(responseWithCandidate(value));
  });

  test('accepts exact candidate numeric and assumption boundaries', () => {
    const parsed = parseTextAiEstimateResponse(responseWithCandidate(candidate({
      amountLow: 0.01,
      amountHigh: 100_000,
      energyKcalLow: 0,
      energyKcalHigh: 100_000,
      proteinGLow: 0,
      proteinGHigh: 10_000,
      assumptions: Array.from({ length: 8 }, () => 'x'.repeat(240)),
    })));
    expect(parsed).toMatchObject({ ok: true, status: 'complete' });
  });

  test.each([
    ['amount', candidate({ amountLow: 600, amountHigh: 500 })],
    ['protein', candidate({ proteinGLow: 43, proteinGHigh: 42 })],
    ['too many assumptions', candidate({ assumptions: Array.from({ length: 9 }, () => 'x') })],
    ['empty assumption', candidate({ assumptions: [''] })],
    ['long assumption', candidate({ assumptions: ['x'.repeat(241)] })],
  ])('rejects invalid candidate range %s', (_label, value) => {
    expectResponseRejected(responseWithCandidate(value));
  });

  test('rejects sparse, decorated, accessor and custom-prototype candidate arrays', () => {
    const decorated = [candidate()] as Array<MealEstimateCandidate> & { extra?: boolean };
    decorated.extra = true;
    const customPrototype = [candidate()];
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
    const accessor = new Array<MealEstimateCandidate>(1);
    let getterCalls = 0;
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return candidate();
      },
    });

    for (const candidates of [sparseArray(), decorated, customPrototype, accessor]) {
      expectResponseRejected({ ...clone(textAiEstimateSuccessFixture), candidates });
    }
    expect(getterCalls).toBe(0);
  });

  test('rejects an array accessor descriptor under Object.prototype.value pollution', () => {
    const candidates = new Array<MealEstimateCandidate>(1);
    let getterCalls = 0;
    Object.defineProperty(candidates, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return candidate();
      },
    });
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    let caught: unknown;
    try {
      Object.defineProperty(Object.prototype, 'value', {
        configurable: true,
        value: candidate(),
      });
      parseTextAiEstimateResponse({
        ...clone(textAiEstimateSuccessFixture),
        candidates,
      });
    } catch (error) {
      caught = error;
    } finally {
      if (previous === undefined) delete (Object.prototype as { value?: unknown }).value;
      else Object.defineProperty(Object.prototype, 'value', previous);
    }

    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe(RESPONSE_ERROR);
    expect(getterCalls).toBe(0);
  });

  test('rejects sparse and decorated assumption arrays', () => {
    const decorated = ['有效假设'] as string[] & { extra?: boolean };
    decorated.extra = true;
    for (const assumptions of [sparseArray<string>(), decorated]) {
      expectResponseRejected(responseWithCandidate(candidate({ assumptions })));
    }
  });

  test('rejects unknown, symbol, inherited and accessor candidate fields', () => {
    expectResponseRejected(responseWithCandidate({ ...candidate(), extra: true }));
    expectResponseRejected(responseWithCandidate({
      ...candidate(),
      [Symbol('hidden')]: true,
    }));

    const inherited = clone(candidate()) as unknown as Record<string, unknown>;
    const id = inherited.id;
    delete inherited.id;
    expectResponseRejected(responseWithCandidate(
      Object.assign(Object.create({ id }), inherited),
    ));

    const accessor = clone(candidate()) as object;
    let getterCalls = 0;
    Object.defineProperty(accessor, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return '不应读取';
      },
    });
    expectResponseRejected(responseWithCandidate(accessor));
    expect(getterCalls).toBe(0);
  });

  test.each([
    { ...textAiEstimateInFlightFixture, retryAfterMs: -1 },
    { ...textAiEstimateInFlightFixture, retryAfterMs: -0 },
    { ...textAiEstimateInFlightFixture, retryAfterMs: 1.5 },
    { ...textAiEstimateInFlightFixture, retryAfterMs: 60_001 },
    { ...textAiEstimateInFlightFixture, retryAfterMs: Number.MAX_SAFE_INTEGER },
    { ...textAiEstimateInFlightFixture, retryAfterMs: Number.POSITIVE_INFINITY },
    { ...textAiEstimateInFlightFixture, extra: true },
    { ...textAiFailureFixture, retryAt: '2026-08-21T12:01:00Z' },
    { ...textAiFailureFixture, resetAt: 'not-a-date' },
    { ...textAiFailureFixture, code: 'unsupported-file' },
  ])('rejects invalid in-flight or failure branch %#', (value) => {
    expectResponseRejected(value);
  });

  test.each([
    { accountRemaining: -0 },
    { globalRemaining: -0 },
  ])('rejects negative zero session quota %#', (override) => {
    expect(() => parseTextAiSessionResponse({
      ...textAiSessionSuccessFixture,
      ...override,
    })).toThrow(RESPONSE_ERROR);
  });

  test.each([
    '',
    'a'.repeat(63),
    'A'.repeat(64),
    'g'.repeat(64),
  ])('rejects invalid request fingerprint %s', (requestFingerprint) => {
    expectResponseRejected({
      ...clone(textAiEstimateSuccessFixture),
      requestFingerprint,
    });
  });

  test('returns a detached complete response snapshot', () => {
    const input = clone(textAiEstimateSuccessFixture) as unknown as {
      versions: { model: string };
      candidates: Array<{ name: string; assumptions: string[] }>;
    };
    const parsed = parseTextAiEstimateResponse(input);
    if (!parsed.ok || parsed.status !== 'complete') throw new Error('expected complete');

    input.versions.model = 'mutated';
    input.candidates[0]!.name = '被修改';
    input.candidates[0]!.assumptions.push('被修改');
    expect(parsed.versions.model).toBe(TEXT_AI_VERSIONS.model);
    expect(parsed.candidates[0]?.name).toBe(textAiCandidateFixture.name);
    expect(parsed.candidates[0]?.assumptions).toEqual(textAiCandidateFixture.assumptions);
  });
});
