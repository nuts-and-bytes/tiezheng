import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  PHOTO_AI_LIMITS,
  PHOTO_AI_PROVIDER_POLICY_URL,
  PHOTO_AI_VERSIONS,
  parsePhotoAiEstimateResponse,
  parsePhotoAiSessionResponse,
  photoAiErrorCopy,
  photoAiErrorToMealEstimateError,
  type PhotoAiErrorCode,
  type PhotoAiEstimateInFlight,
  type PhotoAiEstimateResponse,
  type PhotoAiEstimateSuccess,
  type PhotoAiFailure,
  type PhotoAiRequestMetadata,
  type PhotoAiSessionResponse,
  type PhotoAiSessionSuccess,
} from './photoAiContract';
import type {
  EstimateNutrientSource,
  MealEstimate,
  MealEstimateCandidate,
  MealEstimateErrorCode,
} from './nutritionTypes';
import {
  photoAiCatalogCandidateFixture,
  photoAiEstimateInFlightFixture,
  photoAiEstimateSuccessFixture,
  photoAiFailureFixture,
  photoAiModelRangeCandidateFixture,
  photoAiNoNutrientCandidateFixture,
  photoAiSessionSuccessFixture,
} from '../test/photoAiFixtures';

const persistedErrorCodes = [
  'unsupported-file',
  'image-too-large',
  'decode-failed',
  'offline',
  'auth-required',
  'auth-expired',
  'quota-exceeded',
  'rate-limited',
  'service-disabled',
  'budget-exceeded',
  'consent-expired',
  'provider-timeout',
  'provider-unavailable',
  'invalid-estimate',
  'uncertain-food',
] as const satisfies readonly MealEstimateErrorCode[];

const allErrorCodes = [
  ...persistedErrorCodes,
  'idempotency-conflict',
] as const satisfies readonly PhotoAiErrorCode[];

const expectedErrorCopy = {
  'unsupported-file': '不支持这种图片格式',
  'image-too-large': '图片太大，请选择更小的图片',
  'decode-failed': '无法读取图片，请换一张重试',
  offline: '当前离线，请联网后重试',
  'auth-required': '请先登录后再使用图片识别',
  'auth-expired': '登录已过期，请重新登录',
  'quota-exceeded': '本月图片识别次数已用完',
  'rate-limited': '请求过于频繁，请稍后重试',
  'service-disabled': '图片识别服务当前未开启',
  'budget-exceeded': '图片识别服务今日额度已用完',
  'consent-expired': '授权已过期，请重新确认上传',
  'provider-timeout': '图片识别超时，请重试',
  'provider-unavailable': '图片识别服务暂时不可用',
  'invalid-estimate': '识别结果无效，请重试',
  'uncertain-food': '无法确定食物，请手动记录',
  'idempotency-conflict': '请求内容已变化，请重新选择图片',
} as const satisfies Record<PhotoAiErrorCode, string>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function estimateWithCandidate(candidate: unknown): unknown {
  return {
    ...clone(photoAiEstimateSuccessFixture),
    candidates: [candidate],
  };
}

function expectEstimateRejected(value: unknown): void {
  expect(() => parsePhotoAiEstimateResponse(value)).toThrow(TypeError);
}

function expectGenericPhotoAiError(action: () => unknown): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(TypeError);
  if (caught instanceof Error) {
    expect(caught.message).toBe('Invalid photo AI response');
    expect(caught.message).not.toContain('reviewer-sensitive');
  }
}

function ownIndexArray<T>(value: T, inherited: boolean): T[] {
  const result = new Array<T>(1);
  if (!inherited) return result;

  const prototype = Object.create(Array.prototype) as Record<number, T>;
  Object.defineProperty(prototype, '0', {
    configurable: true,
    enumerable: true,
    value,
  });
  Object.setPrototypeOf(result, prototype);
  return result;
}

describe('photo AI public contract', () => {
  test('freezes the authoritative versions, provider policy, and limits', () => {
    expect(PHOTO_AI_VERSIONS).toEqual({
      model: 'doubao-seed-2-1-pro-260628',
      prompt: 'tiezheng-food-photo-zh-v1',
      schema: 'tiezheng-photo-estimate-v1',
      catalog: 'tiezheng-food-catalog-v2',
      transform: 'tiezheng-photo-webp-v1',
      uncertainty: 'tiezheng-photo-uncertainty-v1',
      providerPolicy: 'volcengine-ark-policy-2026-08-18',
    });
    expect(PHOTO_AI_PROVIDER_POLICY_URL).toBe(
      'https://docs.volcengine.com/docs/82379/1142195',
    );
    expect(PHOTO_AI_LIMITS).toEqual({
      rawBytes: 15 * 1024 * 1024,
      decodedPixels: 40_000_000,
      uploadBytes: 1_000_000,
      uploadLongEdge: 1600,
      thumbnailBytes: 100 * 1024,
      thumbnailLongEdge: 320,
      consentMs: 10 * 60 * 1000,
      intentMs: 15 * 60 * 1000,
      candidates: 6,
    });
  });

  test('runtime authority objects are frozen', () => {
    expect(Object.isFrozen(PHOTO_AI_VERSIONS)).toBe(true);
    expect(Object.isFrozen(PHOTO_AI_LIMITS)).toBe(true);
  });

  test('runtime authority fields reject writes', () => {
    const mutableVersions = PHOTO_AI_VERSIONS as unknown as { model: string };
    const mutableLimits = PHOTO_AI_LIMITS as unknown as { candidates: number };
    const originalModel = PHOTO_AI_VERSIONS.model;
    const originalCandidates = PHOTO_AI_LIMITS.candidates;

    try {
      expect(() => {
        mutableVersions.model = 'attacker-model';
      }).toThrow(TypeError);
      expect(() => {
        mutableLimits.candidates = 7;
      }).toThrow(TypeError);
    } finally {
      if (!Object.isFrozen(PHOTO_AI_VERSIONS)) {
        mutableVersions.model = originalModel;
      }
      if (!Object.isFrozen(PHOTO_AI_LIMITS)) {
        mutableLimits.candidates = originalCandidates;
      }
    }
  });

  test('mutation attempts cannot authorize an attacker version', () => {
    const mutableVersions = PHOTO_AI_VERSIONS as unknown as { model: string };
    const originalModel = PHOTO_AI_VERSIONS.model;

    try {
      try {
        mutableVersions.model = 'attacker-model';
      } catch {
        // A frozen authority object is the expected path.
      }
      expectEstimateRejected({
        ...photoAiEstimateSuccessFixture,
        versions: {
          ...photoAiEstimateSuccessFixture.versions,
          model: 'attacker-model',
        },
      });
    } finally {
      if (!Object.isFrozen(PHOTO_AI_VERSIONS)) {
        mutableVersions.model = originalModel;
      }
    }
  });

  test('mutation attempts cannot authorize a seventh candidate', () => {
    const mutableLimits = PHOTO_AI_LIMITS as unknown as { candidates: number };
    const originalCandidates = PHOTO_AI_LIMITS.candidates;

    try {
      try {
        mutableLimits.candidates = 7;
      } catch {
        // A frozen authority object is the expected path.
      }
      expectEstimateRejected({
        ...photoAiEstimateSuccessFixture,
        candidates: Array.from({ length: 7 }, (_, index) => ({
          ...photoAiCatalogCandidateFixture,
          id: `candidate-${index}`,
        })),
      });
    } finally {
      if (!Object.isFrozen(PHOTO_AI_LIMITS)) {
        mutableLimits.candidates = originalCandidates;
      }
    }
  });

  test('exports the exact request and response type shapes', () => {
    expectTypeOf<PhotoAiRequestMetadata>().toEqualTypeOf<{
      requestId: string;
      idempotencyKey: string;
      uploadBlobSha256: string;
      modelVersion: 'doubao-seed-2-1-pro-260628';
      promptVersion: 'tiezheng-food-photo-zh-v1';
      schemaVersion: 'tiezheng-photo-estimate-v1';
      catalogVersion: 'tiezheng-food-catalog-v2';
      transformVersion: 'tiezheng-photo-webp-v1';
      uncertaintyVersion: 'tiezheng-photo-uncertainty-v1';
      providerPolicyVersion: 'volcengine-ark-policy-2026-08-18';
      locale: 'zh-CN';
    }>();
    expectTypeOf<PhotoAiSessionSuccess>().toEqualTypeOf<{
      ok: true;
      enabled: boolean;
      accountRemaining: number;
      globalRemaining: number;
      resetAt: string;
    }>();
    expectTypeOf<PhotoAiEstimateSuccess>().toEqualTypeOf<{
      ok: true;
      status: 'complete';
      requestId: string;
      requestFingerprint: string;
      versions: typeof PHOTO_AI_VERSIONS;
      candidates: MealEstimateCandidate[];
    }>();
    expectTypeOf<PhotoAiEstimateInFlight>().toEqualTypeOf<{
      ok: true;
      status: 'in-flight';
      requestId: string;
      retryAfterMs: number;
    }>();
    expectTypeOf<PhotoAiFailure>().toEqualTypeOf<{
      ok: false;
      code: PhotoAiErrorCode;
      retryAt: string | null;
      resetAt: string | null;
    }>();
    expectTypeOf<PhotoAiSessionResponse>().toEqualTypeOf<
      PhotoAiSessionSuccess | PhotoAiFailure
    >();
    expectTypeOf<PhotoAiEstimateResponse>().toEqualTypeOf<
      PhotoAiEstimateSuccess | PhotoAiEstimateInFlight | PhotoAiFailure
    >();
  });

  test('extends persisted nutrition estimate types without widening them', () => {
    expectTypeOf<EstimateNutrientSource>().toEqualTypeOf<
      'catalog' | 'model-range' | 'none'
    >();
    expectTypeOf<MealEstimateErrorCode>().toEqualTypeOf<
      (typeof persistedErrorCodes)[number]
    >();
    expectTypeOf<MealEstimateCandidate>().toEqualTypeOf<{
      id: string;
      name: string;
      preparation: string;
      amountLow: number;
      amountHigh: number;
      unit: 'g' | 'mL';
      catalogFoodId: string | null;
      nutrientSource: EstimateNutrientSource;
      energyKcalLow: number | null;
      energyKcalHigh: number | null;
      proteinGLow: number | null;
      proteinGHigh: number | null;
      assumptions: string[];
    }>();
    expectTypeOf<MealEstimate['requestFingerprint']>().toEqualTypeOf<
      string | null
    >();
  });
});

describe('parsePhotoAiSessionResponse', () => {
  test('parses the complete session success fixture', () => {
    expect(parsePhotoAiSessionResponse(clone(photoAiSessionSuccessFixture))).toEqual(
      photoAiSessionSuccessFixture,
    );
  });

  test('parses the complete failure fixture', () => {
    expect(parsePhotoAiSessionResponse(clone(photoAiFailureFixture))).toEqual(
      photoAiFailureFixture,
    );
  });

  test.each([
    { ...photoAiSessionSuccessFixture, unexpected: true },
    { ...photoAiFailureFixture, unexpected: true },
  ])('rejects unknown top-level keys', (value) => {
    expect(() => parsePhotoAiSessionResponse(value)).toThrow(TypeError);
  });

  test('rejects an inherited required property', () => {
    const value = Object.assign(Object.create({ ok: true }), {
      enabled: true,
      accountRemaining: 12,
      globalRemaining: 2_400,
      resetAt: '2026-09-01T00:00:00.000Z',
    });

    expect(() => parsePhotoAiSessionResponse(value)).toThrow(TypeError);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite remaining quota %s',
    (accountRemaining) => {
      expect(() =>
        parsePhotoAiSessionResponse({
          ...photoAiSessionSuccessFixture,
          accountRemaining,
        }),
      ).toThrow(TypeError);
    },
  );

  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects a remaining quota that is not a non-negative safe integer: %s',
    (globalRemaining) => {
      expect(() =>
        parsePhotoAiSessionResponse({
          ...photoAiSessionSuccessFixture,
          globalRemaining,
        }),
      ).toThrow(TypeError);
    },
  );

  test.each([
    'not-a-date',
    '2026-09-01',
    '2026-09-01T00:00:00Z',
    '2026-09-01T08:00:00.000+08:00',
  ])('rejects a resetAt that is not a canonical ISO instant: %s', (resetAt) => {
    expect(() =>
      parsePhotoAiSessionResponse({ ...photoAiSessionSuccessFixture, resetAt }),
    ).toThrow(TypeError);
  });
});

describe('parsePhotoAiEstimateResponse variants', () => {
  test('parses the complete success fixture', () => {
    expect(parsePhotoAiEstimateResponse(clone(photoAiEstimateSuccessFixture))).toEqual(
      photoAiEstimateSuccessFixture,
    );
  });

  test('parses the complete in-flight fixture', () => {
    expect(parsePhotoAiEstimateResponse(clone(photoAiEstimateInFlightFixture))).toEqual(
      photoAiEstimateInFlightFixture,
    );
  });

  test('parses the complete failure fixture', () => {
    expect(parsePhotoAiEstimateResponse(clone(photoAiFailureFixture))).toEqual(
      photoAiFailureFixture,
    );
  });

  test.each([
    { ...photoAiEstimateSuccessFixture, unexpected: true },
    { ...photoAiEstimateInFlightFixture, unexpected: true },
    { ...photoAiFailureFixture, unexpected: true },
  ])('rejects unknown top-level keys for every response variant', (value) => {
    expectEstimateRejected(value);
  });

  test.each(['complete', 'in-flight', 'failure'] as const)(
    'rejects an inherited required property on %s',
    (variant) => {
      const fixture =
        variant === 'complete'
          ? photoAiEstimateSuccessFixture
          : variant === 'in-flight'
            ? photoAiEstimateInFlightFixture
            : photoAiFailureFixture;
      const cloned = clone(fixture) as Record<string, unknown>;
      const inheritedOk = cloned.ok;
      delete cloned.ok;
      const value = Object.assign(Object.create({ ok: inheritedOk }), cloned);

      expectEstimateRejected(value);
    },
  );

  test('rejects a session object at the estimate endpoint', () => {
    expectEstimateRejected(photoAiSessionSuccessFixture);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite in-flight retry delay: %s',
    (retryAfterMs) => {
      expectEstimateRejected({
        ...photoAiEstimateInFlightFixture,
        retryAfterMs,
      });
    },
  );

  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid in-flight retry delay: %s',
    (retryAfterMs) => {
      expectEstimateRejected({
        ...photoAiEstimateInFlightFixture,
        retryAfterMs,
      });
    },
  );
});

describe('complete estimate closed-world parsing', () => {
  test('rejects the previous catalog version in an otherwise valid success fixture', () => {
    expectGenericPhotoAiError(() =>
      parsePhotoAiEstimateResponse({
        ...photoAiEstimateSuccessFixture,
        versions: {
          ...photoAiEstimateSuccessFixture.versions,
          catalog: 'tiezheng-food-catalog-v1',
        },
      }),
    );
  });

  test.each(Object.keys(PHOTO_AI_VERSIONS) as Array<keyof typeof PHOTO_AI_VERSIONS>)(
    'rejects a mismatched %s version',
    (key) => {
      expectEstimateRejected({
        ...photoAiEstimateSuccessFixture,
        versions: {
          ...photoAiEstimateSuccessFixture.versions,
          [key]: `${PHOTO_AI_VERSIONS[key]}-stale`,
        },
      });
    },
  );

  test('rejects unknown version keys', () => {
    expectEstimateRejected({
      ...photoAiEstimateSuccessFixture,
      versions: {
        ...photoAiEstimateSuccessFixture.versions,
        unexpected: 'v1',
      },
    });
  });

  test('rejects a missing version key even when it is inherited', () => {
    const versions = clone(photoAiEstimateSuccessFixture.versions) as Record<
      string,
      unknown
    >;
    const inheritedModel = versions.model;
    delete versions.model;
    const inherited = Object.assign(Object.create({ model: inheritedModel }), versions);

    expectEstimateRejected({
      ...photoAiEstimateSuccessFixture,
      versions: inherited,
    });
  });

  test.each([
    null,
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    'g'.repeat(64),
  ])('rejects a requestFingerprint that is not lowercase 64-hex: %j', (value) => {
    expectEstimateRejected({
      ...photoAiEstimateSuccessFixture,
      requestFingerprint: value,
    });
  });

  test('parses only the candidate array descriptor snapshot under Proxy TOCTOU', () => {
    const target = Array.from({ length: 7 }, (_, index) => ({
      ...photoAiCatalogCandidateFixture,
      id: `proxy-candidate-${index}`,
    }));
    let lengthReads = 0;
    const candidates = new Proxy(target, {
      get(array, key, receiver) {
        if (key === 'length') {
          lengthReads += 1;
          return lengthReads <= 4 ? 1 : 7;
        }
        return Reflect.get(array, key, receiver);
      },
      getOwnPropertyDescriptor(array, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(array, key);
        if (key === 'length' && descriptor !== undefined) {
          return { ...descriptor, value: 1 };
        }
        return descriptor;
      },
      ownKeys() {
        return ['0', 'length'];
      },
    });

    const parsed = parsePhotoAiEstimateResponse({
      ...photoAiEstimateSuccessFixture,
      candidates,
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.status === 'complete') {
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]?.id).toBe('proxy-candidate-0');
    }
  });

  test.each([
    [
      'getPrototypeOf',
      (target: object, sensitive: Error) =>
        new Proxy(target, {
          getPrototypeOf() {
            throw sensitive;
          },
        }),
    ],
    [
      'ownKeys',
      (target: object, sensitive: Error) =>
        new Proxy(target, {
          ownKeys() {
            throw sensitive;
          },
        }),
    ],
    [
      'getOwnPropertyDescriptor',
      (target: object, sensitive: Error) =>
        new Proxy(target, {
          getOwnPropertyDescriptor() {
            throw sensitive;
          },
        }),
    ],
  ] as const)(
    'normalizes a throwing %s reflection trap',
    (_trap, wrap) => {
      const sensitive = new Error(`reviewer-sensitive-${_trap}`);
      const value = wrap(clone(photoAiEstimateSuccessFixture), sensitive);

      expectGenericPhotoAiError(() => parsePhotoAiEstimateResponse(value));
    },
  );

  test('rejects an accessor without invoking its getter', () => {
    const value = clone(photoAiEstimateSuccessFixture) as object;
    let getterCalls = 0;
    Object.defineProperty(value, 'status', {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'complete';
      },
    });

    expectEstimateRejected(value);
    expect(getterCalls).toBe(0);
  });

  test('returns detached output that later input mutation cannot pollute', () => {
    const input = clone(photoAiEstimateSuccessFixture) as unknown as {
      requestId: string;
      versions: { model: string };
      candidates: Array<{
        id: string;
        name: string;
        assumptions: string[];
      }>;
    };
    const parsed = parsePhotoAiEstimateResponse(input);

    expect(parsed).not.toBe(input);
    if (!parsed.ok || parsed.status !== 'complete') {
      throw new Error('expected a complete estimate');
    }
    expect(parsed.versions).not.toBe(input.versions);
    expect(parsed.candidates).not.toBe(input.candidates);
    expect(parsed.candidates[0]).not.toBe(input.candidates[0]);
    expect(parsed.candidates[1]?.assumptions).not.toBe(
      input.candidates[1]?.assumptions,
    );

    input.requestId = 'mutated-request';
    input.versions.model = 'mutated-model';
    input.candidates[0]!.name = '被篡改的候选';
    input.candidates[1]!.assumptions.push('被篡改的假设');
    input.candidates.push({ id: 'extra', name: 'extra', assumptions: [] });

    expect(parsed.requestId).toBe(photoAiEstimateSuccessFixture.requestId);
    expect(parsed.versions.model).toBe(PHOTO_AI_VERSIONS.model);
    expect(parsed.candidates).toHaveLength(
      photoAiEstimateSuccessFixture.candidates.length,
    );
    expect(parsed.candidates[0]?.name).toBe(
      photoAiCatalogCandidateFixture.name,
    );
    expect(parsed.candidates[1]?.assumptions).toEqual(
      photoAiModelRangeCandidateFixture.assumptions,
    );
  });

  test('rejects more than six candidates', () => {
    expectEstimateRejected({
      ...photoAiEstimateSuccessFixture,
      candidates: Array.from({ length: 7 }, (_, index) => ({
        ...photoAiCatalogCandidateFixture,
        id: `candidate-${index}`,
      })),
    });
  });

  test.each([
    ['sparse', false],
    ['inherited', true],
  ] as const)(
    'rejects %s candidate array indices',
    (_kind, inherited) => {
      expectEstimateRejected({
        ...photoAiEstimateSuccessFixture,
        candidates: ownIndexArray(photoAiCatalogCandidateFixture, inherited),
      });
    },
  );

  test('rejects unknown candidate keys', () => {
    expectEstimateRejected(
      estimateWithCandidate({
        ...photoAiCatalogCandidateFixture,
        unexpected: true,
      }),
    );
  });

  test('rejects a candidate with an inherited required property', () => {
    const candidate = clone(photoAiCatalogCandidateFixture) as Record<string, unknown>;
    const inheritedId = candidate.id;
    delete candidate.id;

    expectEstimateRejected(
      estimateWithCandidate(Object.assign(Object.create({ id: inheritedId }), candidate)),
    );
  });

  test.each([
    ['id', photoAiCatalogCandidateFixture],
    ['name', photoAiCatalogCandidateFixture],
    ['preparation', photoAiCatalogCandidateFixture],
    ['catalogFoodId', photoAiCatalogCandidateFixture],
  ] as const)('rejects %s strings longer than 120 characters', (field, fixture) => {
    expectEstimateRejected(
      estimateWithCandidate({ ...fixture, [field]: 'x'.repeat(121) }),
    );
  });

  test('rejects a requestId longer than 120 characters', () => {
    expectEstimateRejected({
      ...photoAiEstimateSuccessFixture,
      requestId: 'x'.repeat(121),
    });
  });

  test('rejects more than twelve assumptions', () => {
    expectEstimateRejected(
      estimateWithCandidate({
        ...photoAiModelRangeCandidateFixture,
        assumptions: Array.from({ length: 13 }, (_, index) => `假设 ${index}`),
      }),
    );
  });

  test('rejects an assumption longer than 240 characters', () => {
    expectEstimateRejected(
      estimateWithCandidate({
        ...photoAiModelRangeCandidateFixture,
        assumptions: ['x'.repeat(241)],
      }),
    );
  });

  test.each([
    ['sparse', false],
    ['inherited', true],
  ] as const)(
    'rejects %s assumption array indices',
    (_kind, inherited) => {
      expectEstimateRejected(
        estimateWithCandidate({
          ...photoAiModelRangeCandidateFixture,
          assumptions: ownIndexArray('按去皮鸡胸肉估算', inherited),
        }),
      );
    },
  );

  test.each([
    ['amountLow', Number.NaN],
    ['amountHigh', Number.POSITIVE_INFINITY],
    ['energyKcalLow', Number.NEGATIVE_INFINITY],
    ['energyKcalHigh', Number.NaN],
    ['proteinGLow', Number.POSITIVE_INFINITY],
    ['proteinGHigh', Number.NEGATIVE_INFINITY],
  ] as const)('rejects a non-finite %s', (field, value) => {
    expectEstimateRejected(
      estimateWithCandidate({
        ...photoAiModelRangeCandidateFixture,
        [field]: value,
      }),
    );
  });

  test('accepts the exact candidate numeric boundaries', () => {
    expect(
      parsePhotoAiEstimateResponse(
        estimateWithCandidate({
          ...photoAiModelRangeCandidateFixture,
          amountLow: 0.01,
          amountHigh: 100_000,
          energyKcalLow: 0,
          energyKcalHigh: 100_000,
          proteinGLow: 0,
          proteinGHigh: 10_000,
        }),
      ),
    ).toMatchObject({ status: 'complete' });
  });

  test.each([
    ['zero amount', 'amountLow', 0],
    ['amount above maximum', 'amountHigh', 100_000.01],
    ['amount above safe integer', 'amountHigh', Number.MAX_SAFE_INTEGER + 1],
    ['extreme finite amount', 'amountHigh', Number.MAX_VALUE],
    ['energy above maximum', 'energyKcalHigh', 100_000.01],
    [
      'energy above safe integer',
      'energyKcalHigh',
      Number.MAX_SAFE_INTEGER + 1,
    ],
    ['extreme finite energy', 'energyKcalHigh', Number.MAX_VALUE],
    ['protein above maximum', 'proteinGHigh', 10_000.01],
    [
      'protein above safe integer',
      'proteinGHigh',
      Number.MAX_SAFE_INTEGER + 1,
    ],
    ['extreme finite protein', 'proteinGHigh', Number.MAX_VALUE],
  ] as const)('rejects %s', (_label, field, value) => {
    expectEstimateRejected(
      estimateWithCandidate({
        ...photoAiModelRangeCandidateFixture,
        [field]: value,
      }),
    );
  });

  test.each([
    ['amountLow', 131, 'amountHigh', 130],
    ['energyKcalLow', 231, 'energyKcalHigh', 230],
    ['proteinGLow', 37, 'proteinGHigh', 36],
  ] as const)(
    'rejects an inverted %s/%s range',
    (lowField, lowValue, highField, highValue) => {
      expectEstimateRejected(
        estimateWithCandidate({
          ...photoAiModelRangeCandidateFixture,
          [lowField]: lowValue,
          [highField]: highValue,
        }),
      );
    },
  );

  test.each([
    ['energyKcalLow', null],
    ['energyKcalHigh', null],
    ['proteinGLow', null],
    ['proteinGHigh', null],
  ] as const)('rejects a partial model nutrient range at %s', (field, value) => {
    expectEstimateRejected(
      estimateWithCandidate({
        ...photoAiModelRangeCandidateFixture,
        [field]: value,
      }),
    );
  });
});

describe('candidate nutrient-source invariants', () => {
  test.each([
    {
      ...photoAiCatalogCandidateFixture,
      catalogFoodId: null,
    },
    {
      ...photoAiCatalogCandidateFixture,
      energyKcalLow: 100,
      energyKcalHigh: 120,
    },
    {
      ...photoAiModelRangeCandidateFixture,
      catalogFoodId: 'food-chicken',
    },
    {
      ...photoAiModelRangeCandidateFixture,
      assumptions: [],
    },
    {
      ...photoAiNoNutrientCandidateFixture,
      catalogFoodId: 'food-sauce',
    },
    {
      ...photoAiNoNutrientCandidateFixture,
      proteinGLow: 0,
      proteinGHigh: 1,
    },
    {
      ...photoAiNoNutrientCandidateFixture,
      nutrientSource: 'remote-catalog',
    },
  ])('rejects an invalid source combination', (candidate) => {
    expectEstimateRejected(estimateWithCandidate(candidate));
  });
});

describe('photo AI error contract', () => {
  test.each(['__proto__', 'unknown-error'])(
    'rejects forged copy code %s with a generic error',
    (code) => {
      expectGenericPhotoAiError(() =>
        photoAiErrorCopy(code as PhotoAiErrorCode),
      );
    },
  );

  test.each(['__proto__', 'unknown-error'])(
    'rejects forged persisted mapping code %s with a generic error',
    (code) => {
      expectGenericPhotoAiError(() =>
        photoAiErrorToMealEstimateError(code as PhotoAiErrorCode),
      );
    },
  );

  test.each(allErrorCodes)('provides stable Chinese copy for %s', (code) => {
    expect(photoAiErrorCopy(code)).toBe(expectedErrorCopy[code]);
    expect(photoAiErrorCopy(code)).toMatch(/[\u3400-\u9fff]/u);
  });

  test.each(persistedErrorCodes)('keeps persisted error code %s unchanged', (code) => {
    expect(photoAiErrorToMealEstimateError(code)).toBe(code);
  });

  test('maps idempotency conflicts to invalid-estimate', () => {
    expect(photoAiErrorToMealEstimateError('idempotency-conflict')).toBe(
      'invalid-estimate',
    );
  });

  test.each(allErrorCodes)('accepts failure code %s', (code) => {
    expect(
      parsePhotoAiEstimateResponse({
        ...photoAiFailureFixture,
        code,
      }),
    ).toEqual({ ...photoAiFailureFixture, code });
  });

  test('rejects an unknown failure code', () => {
    expectEstimateRejected({
      ...photoAiFailureFixture,
      code: 'unknown-error',
    });
  });
});
