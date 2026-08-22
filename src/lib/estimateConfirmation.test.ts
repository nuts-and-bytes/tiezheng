import { describe, expect, expectTypeOf, test } from 'vitest';
import { PHOTO_AI_VERSIONS } from './photoAiContract';
import { TEXT_AI_VERSIONS } from './textAiContract';
import {
  buildModelRangeMealItem,
  TEXT_MODEL_POLICY,
  type ConfirmedModelRangeCandidate,
  type ModelRangeSourcePolicy,
} from './estimateConfirmation';
import type { MealEstimateCandidate, MealItem } from './nutritionTypes';
import { photoAiModelRangeCandidateFixture } from '../test/photoAiFixtures';
import { textAiCandidateFixture } from '../test/textAiFixtures';

const IDS = {
  id: 'meal-item:11111111-1111-4111-8111-111111111111',
  mealId: 'meal:2026-08-21:dinner',
  order: 0,
  now: Date.parse('2026-08-21T12:00:00.000Z'),
};

const PHOTO_MODEL_POLICY = Object.freeze({
  source: 'photo-ai-user-confirmed',
  sourceVersion: [
    PHOTO_AI_VERSIONS.model,
    PHOTO_AI_VERSIONS.prompt,
    PHOTO_AI_VERSIONS.schema,
    PHOTO_AI_VERSIONS.uncertainty,
  ].join('/'),
  uncertaintyModelVersion: PHOTO_AI_VERSIONS.uncertainty,
  allowEditedNutrients: false,
  rangePolicy: 'scale-by-confirmed-amount',
} satisfies ModelRangeSourcePolicy);

function textCandidate(
  overrides: Partial<MealEstimateCandidate> = {},
): MealEstimateCandidate {
  return {
    ...textAiCandidateFixture,
    assumptions: [...textAiCandidateFixture.assumptions],
    ...overrides,
  };
}

function confirmedText(
  overrides: Partial<ConfirmedModelRangeCandidate> = {},
): ConfirmedModelRangeCandidate {
  return {
    candidate: textCandidate(),
    confirmedAmount: 500,
    confirmedUnit: 'g',
    confirmedName: '少油牛肉面',
    confirmedPreparation: '整餐文字估算',
    confirmedAssumptions: [...textAiCandidateFixture.assumptions],
    ...overrides,
  };
}

function confirmedPhoto(
  overrides: Partial<ConfirmedModelRangeCandidate> = {},
): ConfirmedModelRangeCandidate {
  return {
    candidate: {
      ...photoAiModelRangeCandidateFixture,
      amountLow: 100,
      amountHigh: 200,
      energyKcalLow: 80,
      energyKcalHigh: 240,
      proteinGLow: 8,
      proteinGHigh: 24,
      assumptions: [...photoAiModelRangeCandidateFixture.assumptions],
    },
    confirmedAmount: 150,
    confirmedUnit: 'g',
    confirmedName: '鸡胸肉（确认）',
    confirmedPreparation: '水煮',
    confirmedAssumptions: ['按去皮鸡胸肉确认'],
    ...overrides,
  };
}

function withCustomPrototype<T extends object>(value: T): T {
  return Object.assign(Object.create({ inherited: true }), value) as T;
}

describe('buildModelRangeMealItem', () => {
  test('exports the shared public shapes', () => {
    expectTypeOf<Parameters<typeof buildModelRangeMealItem>[0]>()
      .toEqualTypeOf<ConfirmedModelRangeCandidate>();
    expectTypeOf<Parameters<typeof buildModelRangeMealItem>[2]>()
      .toEqualTypeOf<ModelRangeSourcePolicy>();
    expectTypeOf<ReturnType<typeof buildModelRangeMealItem>>()
      .toEqualTypeOf<MealItem>();
  });

  test('文字确认保留模型整餐范围并取其中点', () => {
    const item = buildModelRangeMealItem(confirmedText(), IDS, TEXT_MODEL_POLICY);

    expect(item).toMatchObject({
      amount: 500,
      unit: 'g',
      energyKcal: 670,
      proteinG: 35,
      energyKcalLow: 560,
      energyKcalHigh: 780,
      proteinGLow: 28,
      proteinGHigh: 42,
      source: 'text-ai-user-confirmed',
      sourceVersion: [
        TEXT_AI_VERSIONS.model,
        TEXT_AI_VERSIONS.prompt,
        TEXT_AI_VERSIONS.schema,
        TEXT_AI_VERSIONS.uncertainty,
      ].join('/'),
      license: 'model-estimate-user-confirmed',
      method: 'ai-confirmed',
      quality: 'B',
      uncertaintyModelVersion: TEXT_AI_VERSIONS.uncertainty,
      assumptions: [
        '估算不确定性较高',
        ...textAiCandidateFixture.assumptions,
      ],
    });
  });

  test('文字默认点值使用真实区间中点且始终落在极小合法范围内', () => {
    const item = buildModelRangeMealItem(
      confirmedText({
        candidate: textCandidate({
          energyKcalLow: 0.1,
          energyKcalHigh: 0.2,
          proteinGLow: 0.01,
          proteinGHigh: 0.02,
        }),
      }),
      IDS,
      TEXT_MODEL_POLICY,
    );

    expect(item.energyKcal).toBeGreaterThanOrEqual(item.energyKcalLow);
    expect(item.energyKcal).toBeLessThanOrEqual(item.energyKcalHigh);
    expect(item.proteinG).toBeGreaterThanOrEqual(item.proteinGLow);
    expect(item.proteinG).toBeLessThanOrEqual(item.proteinGHigh);
    expect(item.energyKcal).toBeCloseTo(0.15, 12);
    expect(item.proteinG).toBeCloseTo(0.015, 12);
  });

  test('没有人工点值时会删除调用方伪造的系统覆盖标记', () => {
    const item = buildModelRangeMealItem(
      confirmedText({
        confirmedAssumptions: [
          ...textAiCandidateFixture.assumptions,
          '用户修改了 AI 中点估算 ',
          '　用户修改了 AI 中点估算　',
        ],
      }),
      IDS,
      TEXT_MODEL_POLICY,
    );

    expect(item.assumptions).not.toContain('用户修改了 AI 中点估算');
    expect(item.assumptions).not.toContain('用户修改了 AI 中点估算 ');
    expect(item.assumptions).not.toContain('　用户修改了 AI 中点估算　');
  });

  test('调用方预置的规范等价不确定性标记全部删除后由构造器重建一次', () => {
    const item = buildModelRangeMealItem(
      confirmedText({
        confirmedAssumptions: [
          '估算不确定性较高',
          ' 估算不确定性较高 ',
          '　估算不确定性较高　',
          '保留原文依据 ',
        ],
      }),
      IDS,
      TEXT_MODEL_POLICY,
    );

    expect(item.assumptions).toEqual(['估算不确定性较高', '保留原文依据 ']);
  });

  test('区间内人工点值保持原范围且不增加覆盖痕迹', () => {
    const item = buildModelRangeMealItem(
      confirmedText({
        confirmedEnergyKcal: 600,
        confirmedProteinG: 30,
        confirmedAssumptions: [
          ...textAiCandidateFixture.assumptions,
          ' 用户修改了 AI 中点估算 ',
          '　用户修改了 AI 中点估算　',
        ],
      }),
      IDS,
      TEXT_MODEL_POLICY,
    );

    expect(item).toMatchObject({
      energyKcal: 600,
      proteinG: 30,
      originalEnergyValue: 600,
      originalProteinG: 30,
      energyKcalLow: 560,
      energyKcalHigh: 780,
      proteinGLow: 28,
      proteinGHigh: 42,
    });
    expect(item.assumptions).not.toContain('用户修改了 AI 中点估算');
    expect(item.assumptions).not.toContain(' 用户修改了 AI 中点估算 ');
    expect(item.assumptions).not.toContain('　用户修改了 AI 中点估算　');
  });

  test('区间外人工值只扩展对应边界并留下单一覆盖痕迹', () => {
    const item = buildModelRangeMealItem(
      confirmedText({
        confirmedEnergyKcal: 900,
        confirmedProteinG: 20,
        confirmedAssumptions: [
          ...textAiCandidateFixture.assumptions,
          '用户修改了 AI 中点估算',
          ' 用户修改了 AI 中点估算 ',
          '　用户修改了 AI 中点估算　',
          '估算不确定性较高',
          '　估算不确定性较高　',
        ],
      }),
      IDS,
      TEXT_MODEL_POLICY,
    );

    expect(item).toMatchObject({
      energyKcal: 900,
      proteinG: 20,
      energyKcalLow: 560,
      energyKcalHigh: 900,
      proteinGLow: 20,
      proteinGHigh: 42,
    });
    expect(item.assumptions.filter((value) => value === '用户修改了 AI 中点估算'))
      .toHaveLength(1);
    expect(item.assumptions.filter((value) => value === '估算不确定性较高'))
      .toHaveLength(1);
    expect(item.assumptions).not.toContain(' 用户修改了 AI 中点估算 ');
    expect(item.assumptions).not.toContain('　用户修改了 AI 中点估算　');
  });

  test('范围外点值不能让最终依据超过 MealItem 的 30 项上限', () => {
    expect(() => buildModelRangeMealItem(
      confirmedText({
        confirmedEnergyKcal: 900,
        confirmedAssumptions: Array.from({ length: 29 }, (_, index) => `依据 ${index}`),
      }),
      IDS,
      TEXT_MODEL_POLICY,
    )).toThrow();
  });

  test('照片策略维持既有保守缩放、向外舍入、来源和完整产物语义', () => {
    const item = buildModelRangeMealItem(confirmedPhoto(), IDS, PHOTO_MODEL_POLICY);

    expect(item).toEqual({
      id: IDS.id,
      mealId: IDS.mealId,
      order: IDS.order,
      confirmedAt: IDS.now,
      updatedAt: IDS.now,
      deletedAt: null,
      name: '鸡胸肉（确认）',
      preparation: '水煮',
      amount: 150,
      unit: 'g',
      method: 'ai-confirmed',
      quality: 'B',
      originalEnergyValue: 210,
      originalEnergyUnit: 'kcal',
      originalProteinG: 21,
      originalBasisAmount: 150,
      originalBasisUnit: 'g',
      basisAmount: 150,
      basisUnit: 'g',
      ediblePortionRatio: 1,
      densityGPerMl: null,
      conversionAssumptions: [],
      fdcId: null,
      fdcDataType: null,
      sourceRetrievedAt: null,
      source: 'photo-ai-user-confirmed',
      sourceVersion: PHOTO_MODEL_POLICY.sourceVersion,
      license: 'model-estimate-user-confirmed',
      energyKcal: 210,
      proteinG: 21,
      energyKcalLow: 60,
      energyKcalHigh: 360,
      proteinGLow: 6,
      proteinGHigh: 36,
      assumptions: ['估算不确定性较高', '按去皮鸡胸肉确认'],
      uncertaintyModelVersion: PHOTO_AI_VERSIONS.uncertainty,
    });
  });

  test('照片正上界缩放下溢时仍向外得到最小整数和一位小数上界', () => {
    const item = buildModelRangeMealItem(
      confirmedPhoto({
        candidate: {
          ...photoAiModelRangeCandidateFixture,
          amountLow: 100_000,
          amountHigh: 100_000,
          energyKcalLow: Number.MIN_VALUE,
          energyKcalHigh: Number.MIN_VALUE,
          proteinGLow: Number.MIN_VALUE,
          proteinGHigh: Number.MIN_VALUE,
          assumptions: [...photoAiModelRangeCandidateFixture.assumptions],
        },
        confirmedAmount: 0.01,
      }),
      IDS,
      PHOTO_MODEL_POLICY,
    );

    expect(item).toMatchObject({
      energyKcalLow: 0,
      energyKcalHigh: 1,
      proteinGLow: 0,
      proteinGHigh: 0.1,
    });
  });

  test('照片缩放结果超出持久化上限时拒绝而不是产出溢出快照', () => {
    expect(() => buildModelRangeMealItem(
      confirmedPhoto({
        candidate: {
          ...photoAiModelRangeCandidateFixture,
          amountLow: 0.01,
          amountHigh: 0.01,
          energyKcalLow: 100_000,
          energyKcalHigh: 100_000,
          proteinGLow: 10_000,
          proteinGHigh: 10_000,
          assumptions: [...photoAiModelRangeCandidateFixture.assumptions],
        },
        confirmedAmount: 100_000,
      }),
      IDS,
      PHOTO_MODEL_POLICY,
    )).toThrow();
  });

  test('照片策略同样移除调用方伪造的系统覆盖标记', () => {
    const confirmedAssumptions = [
      '用户修改了 AI 中点估算',
      '用户修改了 AI 中点估算',
    ];
    const item = buildModelRangeMealItem(
      confirmedPhoto({ confirmedAssumptions }),
      IDS,
      PHOTO_MODEL_POLICY,
    );

    expect(item.assumptions).toEqual(['估算不确定性较高']);
  });

  test('允许完整、有限、非负且有序的零营养范围', () => {
    const item = buildModelRangeMealItem(
      confirmedText({
        candidate: textCandidate({
          energyKcalLow: 0,
          energyKcalHigh: 0,
          proteinGLow: 0,
          proteinGHigh: 0,
        }),
      }),
      IDS,
      TEXT_MODEL_POLICY,
    );
    expect(item).toMatchObject({
      energyKcal: 0,
      proteinG: 0,
      energyKcalLow: 0,
      energyKcalHigh: 0,
      proteinGLow: 0,
      proteinGHigh: 0,
    });
  });

  test.each([
    ['catalog nutrient source', { nutrientSource: 'catalog' }],
    ['catalog id', { catalogFoodId: 'food:rice' }],
    ['partial range', { proteinGHigh: null }],
    ['NaN range', { energyKcalLow: Number.NaN }],
    ['infinite range', { energyKcalHigh: Number.POSITIVE_INFINITY }],
    ['negative range', { proteinGLow: -1 }],
    ['negative zero range', { proteinGLow: -0 }],
    ['inverted energy range', { energyKcalLow: 781 }],
    ['inverted protein range', { proteinGLow: 43 }],
    ['zero amount', { amountLow: 0 }],
    ['inverted amount', { amountLow: 551 }],
    ['blank candidate name', { name: ' ' }],
    ['long preparation', { preparation: 'x'.repeat(121) }],
    ['missing candidate assumptions', { assumptions: [] }],
    ['too many candidate assumptions', { assumptions: Array(13).fill('x') }],
    ['blank candidate assumption', { assumptions: [''] }],
  ])('拒绝无效 model-range candidate：%s', (_label, override) => {
    expect(() => buildModelRangeMealItem(
      confirmedText({ candidate: textCandidate(override as Partial<MealEstimateCandidate>) }),
      IDS,
      TEXT_MODEL_POLICY,
    )).toThrow();
  });

  test.each([
    ['small amount', { confirmedAmount: 0 }],
    ['large amount', { confirmedAmount: 100_000.01 }],
    ['non-finite amount', { confirmedAmount: Number.POSITIVE_INFINITY }],
    ['unit mismatch', { confirmedUnit: 'mL' }],
    ['blank name', { confirmedName: ' ' }],
    ['long name', { confirmedName: 'x'.repeat(121) }],
    ['long preparation', { confirmedPreparation: 'x'.repeat(121) }],
    ['too many assumptions', { confirmedAssumptions: Array(30).fill('x') }],
    ['blank assumption', { confirmedAssumptions: [''] }],
  ])('拒绝无效确认值：%s', (_label, override) => {
    expect(() => buildModelRangeMealItem(
      confirmedText(overridesAsConfirmation(override)),
      IDS,
      TEXT_MODEL_POLICY,
    )).toThrow();
  });

  test.each([
    ['energy negative', { confirmedEnergyKcal: -1 }],
    ['energy negative zero', { confirmedEnergyKcal: -0 }],
    ['energy NaN', { confirmedEnergyKcal: Number.NaN }],
    ['energy infinite', { confirmedEnergyKcal: Number.POSITIVE_INFINITY }],
    ['protein negative', { confirmedProteinG: -1 }],
    ['protein infinite', { confirmedProteinG: Number.POSITIVE_INFINITY }],
  ])('文字策略拒绝无效人工营养点值：%s', (_label, override) => {
    expect(() => buildModelRangeMealItem(
      confirmedText(overridesAsConfirmation(override)),
      IDS,
      TEXT_MODEL_POLICY,
    )).toThrow();
  });

  test.each([
    ['id', { id: '' }],
    ['mealId', { mealId: '' }],
    ['negative order', { order: -1 }],
    ['fractional order', { order: 1.5 }],
    ['large order', { order: 10_001 }],
    ['unsafe now', { now: Number.MAX_SAFE_INTEGER + 1 }],
  ])('拒绝无效 IDs：%s', (_label, override) => {
    expect(() => buildModelRangeMealItem(
      confirmedText(),
      { ...IDS, ...override },
      TEXT_MODEL_POLICY,
    )).toThrow();
  });

  test('只接受两种版本和值完全一致的策略组合', () => {
    expect(() => buildModelRangeMealItem(confirmedText(), IDS, TEXT_MODEL_POLICY))
      .not.toThrow();
    expect(() => buildModelRangeMealItem(confirmedPhoto(), IDS, PHOTO_MODEL_POLICY))
      .not.toThrow();

    const invalidPolicies: ModelRangeSourcePolicy[] = [
      { ...TEXT_MODEL_POLICY, source: 'photo-ai-user-confirmed' },
      { ...TEXT_MODEL_POLICY, allowEditedNutrients: false },
      { ...TEXT_MODEL_POLICY, rangePolicy: 'scale-by-confirmed-amount' },
      { ...TEXT_MODEL_POLICY, sourceVersion: 'forged' },
      { ...TEXT_MODEL_POLICY, uncertaintyModelVersion: 'forged' },
      { ...PHOTO_MODEL_POLICY, source: 'text-ai-user-confirmed' },
      { ...PHOTO_MODEL_POLICY, allowEditedNutrients: true },
      { ...PHOTO_MODEL_POLICY, rangePolicy: 'preserve-returned-range' },
      { ...PHOTO_MODEL_POLICY, sourceVersion: 'forged' },
      { ...PHOTO_MODEL_POLICY, uncertaintyModelVersion: 'forged' },
    ];
    for (const policy of invalidPolicies) {
      expect(() => buildModelRangeMealItem(confirmedText(), IDS, policy)).toThrow();
    }
  });

  test('照片策略拒绝任何人工点值字段，包括 undefined', () => {
    for (const input of [
      confirmedPhoto({ confirmedEnergyKcal: 210 }),
      confirmedPhoto({ confirmedProteinG: 21 }),
      { ...confirmedPhoto(), confirmedEnergyKcal: undefined },
    ]) {
      expect(() => buildModelRangeMealItem(
        input as ConfirmedModelRangeCandidate,
        IDS,
        PHOTO_MODEL_POLICY,
      )).toThrow();
    }
  });

  test('输入、candidate、assumptions、IDs 和 policy 都拒绝未知键、symbol 与自定义原型', () => {
    const decoratedAssumptions = ['有效依据'] as string[] & { extra?: boolean };
    decoratedAssumptions.extra = true;
    const customAssumptions = ['有效依据'];
    Object.setPrototypeOf(customAssumptions, Object.create(Array.prototype));

    const cases: Array<[
      ConfirmedModelRangeCandidate,
      typeof IDS,
      ModelRangeSourcePolicy,
    ]> = [
      [{ ...confirmedText(), extra: true } as unknown as ConfirmedModelRangeCandidate, IDS, TEXT_MODEL_POLICY],
      [{ ...confirmedText(), [Symbol('hidden')]: true } as unknown as ConfirmedModelRangeCandidate, IDS, TEXT_MODEL_POLICY],
      [withCustomPrototype(confirmedText()), IDS, TEXT_MODEL_POLICY],
      [confirmedText({ candidate: { ...textCandidate(), extra: true } as unknown as MealEstimateCandidate }), IDS, TEXT_MODEL_POLICY],
      [confirmedText({ candidate: { ...textCandidate(), [Symbol('hidden')]: true } as unknown as MealEstimateCandidate }), IDS, TEXT_MODEL_POLICY],
      [confirmedText({ candidate: withCustomPrototype(textCandidate()) }), IDS, TEXT_MODEL_POLICY],
      [confirmedText({ confirmedAssumptions: decoratedAssumptions }), IDS, TEXT_MODEL_POLICY],
      [confirmedText({ confirmedAssumptions: customAssumptions }), IDS, TEXT_MODEL_POLICY],
      [confirmedText(), { ...IDS, extra: true } as unknown as typeof IDS, TEXT_MODEL_POLICY],
      [confirmedText(), { ...IDS, [Symbol('hidden')]: true } as unknown as typeof IDS, TEXT_MODEL_POLICY],
      [confirmedText(), withCustomPrototype(IDS), TEXT_MODEL_POLICY],
      [confirmedText(), IDS, { ...TEXT_MODEL_POLICY, extra: true } as unknown as ModelRangeSourcePolicy],
      [confirmedText(), IDS, { ...TEXT_MODEL_POLICY, [Symbol('hidden')]: true } as unknown as ModelRangeSourcePolicy],
      [confirmedText(), IDS, withCustomPrototype({ ...TEXT_MODEL_POLICY })],
    ];

    for (const [input, ids, policy] of cases) {
      expect(() => buildModelRangeMealItem(input, ids, policy)).toThrow();
    }
  });

  test('拒绝所有层级的 accessor 且不执行 getter', () => {
    let getterCalls = 0;
    const accessor = (value: object, key: PropertyKey): object => {
      Object.defineProperty(value, key, {
        configurable: true,
        enumerable: true,
        get() {
          getterCalls += 1;
          return '不应读取';
        },
      });
      return value;
    };

    const candidate = accessor(textCandidate(), 'name') as MealEstimateCandidate;
    const candidateAssumptions = new Array<string>(1);
    accessor(candidateAssumptions, '0');
    const confirmedAssumptions = new Array<string>(1);
    accessor(confirmedAssumptions, '0');

    const cases: Array<[
      ConfirmedModelRangeCandidate,
      typeof IDS,
      ModelRangeSourcePolicy,
    ]> = [
      [accessor(confirmedText(), 'confirmedName') as ConfirmedModelRangeCandidate, IDS, TEXT_MODEL_POLICY],
      [confirmedText({ candidate }), IDS, TEXT_MODEL_POLICY],
      [confirmedText({ candidate: textCandidate({ assumptions: candidateAssumptions }) }), IDS, TEXT_MODEL_POLICY],
      [confirmedText({ confirmedAssumptions }), IDS, TEXT_MODEL_POLICY],
      [confirmedText(), accessor({ ...IDS }, 'id') as typeof IDS, TEXT_MODEL_POLICY],
      [confirmedText(), IDS, accessor({ ...TEXT_MODEL_POLICY }, 'source') as ModelRangeSourcePolicy],
    ];

    for (const [input, ids, policy] of cases) {
      expect(() => buildModelRangeMealItem(input, ids, policy)).toThrow();
    }
    expect(getterCalls).toBe(0);
  });

  test('返回值不保留调用方 assumptions 数组', () => {
    const assumptions = ['用户确认少油'];
    const item = buildModelRangeMealItem(
      confirmedText({ confirmedAssumptions: assumptions }),
      IDS,
      TEXT_MODEL_POLICY,
    );
    assumptions[0] = 'mutated';
    expect(item.assumptions).toEqual(['估算不确定性较高', '用户确认少油']);
  });
});

function overridesAsConfirmation(
  value: object,
): Partial<ConfirmedModelRangeCandidate> {
  return value as Partial<ConfirmedModelRangeCandidate>;
}
