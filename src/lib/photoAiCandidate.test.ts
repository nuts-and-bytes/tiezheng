import { describe, expect, expectTypeOf, test } from 'vitest';
import { PHOTO_AI_VERSIONS } from './photoAiContract';
import {
  applyPhotoUncertaintyV1,
  buildPhotoMealItem,
  type ConfirmedPhotoCandidate,
  type RawModelNutrientRange,
} from './photoAiCandidate';
import type { Food, MealEstimateCandidate, MealItem } from './nutritionTypes';
import { foodRow } from '../test/nutritionFixtures';
import {
  photoAiCatalogCandidateFixture,
  photoAiModelRangeCandidateFixture,
  photoAiNoNutrientCandidateFixture,
} from '../test/photoAiFixtures';

const IDS = {
  id: 'meal-item:photo-ai-confirmed-001',
  mealId: 'meal:2026-08-19:lunch',
  order: 2,
  now: 1_787_112_000_000,
};

function catalogCandidate(
  overrides: Partial<MealEstimateCandidate> = {},
): MealEstimateCandidate {
  return {
    ...photoAiCatalogCandidateFixture,
    assumptions: [...photoAiCatalogCandidateFixture.assumptions],
    ...overrides,
  };
}

function modelCandidate(
  overrides: Partial<MealEstimateCandidate> = {},
): MealEstimateCandidate {
  return {
    ...photoAiModelRangeCandidateFixture,
    assumptions: [...photoAiModelRangeCandidateFixture.assumptions],
    ...overrides,
  };
}

function noneCandidate(): MealEstimateCandidate {
  return {
    ...photoAiNoNutrientCandidateFixture,
    assumptions: [...photoAiNoNutrientCandidateFixture.assumptions],
  };
}

function confirmed(
  candidate: MealEstimateCandidate,
  overrides: Partial<ConfirmedPhotoCandidate> = {},
): ConfirmedPhotoCandidate {
  return {
    candidate,
    confirmedAmount: 150,
    confirmedUnit: candidate.unit,
    confirmedName: candidate.name,
    confirmedPreparation: candidate.preparation,
    confirmedAssumptions: ['用户确认去皮熟制'],
    ...overrides,
  };
}

describe('photo AI uncertainty', () => {
  test('exports the exact public shapes', () => {
    expectTypeOf<Parameters<typeof applyPhotoUncertaintyV1>[0]>().toEqualTypeOf<RawModelNutrientRange>();
    expectTypeOf<ReturnType<typeof buildPhotoMealItem>>().toEqualTypeOf<MealItem>();
  });

  test('widens once and rounds every endpoint outward', () => {
    expect(
      applyPhotoUncertaintyV1({
        energyKcalLow: 100.9,
        energyKcalHigh: 200.1,
        proteinGLow: 10.09,
        proteinGHigh: 20.01,
      }),
    ).toEqual({
      energyKcalLow: 80,
      energyKcalHigh: 241,
      proteinGLow: 8,
      proteinGHigh: 24.1,
    });
  });

  test.each([
    ['zero', { energyKcalLow: 0 }],
    ['negative', { proteinGLow: -1 }],
    ['NaN', { energyKcalHigh: Number.NaN }],
    ['Infinity', { proteinGHigh: Number.POSITIVE_INFINITY }],
    ['energy inverted', { energyKcalLow: 201, energyKcalHigh: 200 }],
    ['protein inverted', { proteinGLow: 21, proteinGHigh: 20 }],
  ])('rejects an invalid raw range: %s', (_label, override) => {
    const raw = {
      energyKcalLow: 100,
      energyKcalHigh: 200,
      proteinGLow: 10,
      proteinGHigh: 20,
      ...override,
    };
    expect(() => applyPhotoUncertaintyV1(raw)).toThrow();
  });
});

describe('photo candidate confirmation', () => {
  test('catalog nutrition ignores model numbers and uses the active local Food snapshot', () => {
    const food = foodRow();
    const candidate = catalogCandidate({
      catalogFoodId: food.id,
      energyKcalLow: 9_999,
      energyKcalHigh: 10_000,
      proteinGLow: 999,
      proteinGHigh: 1_000,
    });
    const item = buildPhotoMealItem(confirmed(candidate), food, IDS);

    expect(item).toMatchObject({
      amount: 150,
      unit: 'g',
      energyKcal: food.energyKcal,
      proteinG: food.proteinG,
      energyKcalLow: 195,
      energyKcalHigh: 195,
      proteinGLow: 4.035,
      proteinGHigh: 4.035,
      source: food.source,
      sourceVersion: food.sourceVersion,
      license: food.license,
      method: 'ai-confirmed',
      quality: 'B',
    });
    expect(item.energyKcalLow).not.toBe(9_999);
    expect(item.assumptions).toEqual([
      `食物目录快照 ${food.id}`,
      '用户确认去皮熟制',
    ]);
  });

  test.each([
    ['missing', undefined, catalogCandidate()],
    ['deleted', foodRow({ deletedAt: IDS.now }), catalogCandidate()],
    ['mismatched', foodRow({ id: 'food:other' }), catalogCandidate()],
  ] as const)('fails closed for a %s catalog food', (_label, food, candidate) => {
    expect(() => buildPhotoMealItem(confirmed(candidate), food, IDS)).toThrow();
  });

  test('uses the versioned catalog density for a confirmed g/mL unit change', () => {
    const food = foodRow({ densityGPerMl: 1.2 });
    const item = buildPhotoMealItem(
      confirmed(catalogCandidate({ catalogFoodId: food.id }), {
        confirmedAmount: 100,
        confirmedUnit: 'mL',
      }),
      food,
      IDS,
    );

    expect(item).toMatchObject({
      amount: 100,
      unit: 'mL',
      basisUnit: 'g',
      densityGPerMl: 1.2,
      energyKcalLow: 156,
      energyKcalHigh: 156,
      sourceVersion: food.sourceVersion,
    });
  });

  test('requires manual entry for catalog conversion without density', () => {
    const food = foodRow({ densityGPerMl: null });
    expect(() =>
      buildPhotoMealItem(
        confirmed(catalogCandidate({ catalogFoodId: food.id }), {
          confirmedUnit: 'mL',
        }),
        food,
        IDS,
      ),
    ).toThrow('manual-entry-required');
  });

  test('rescales the already-widened model range without widening it twice', () => {
    const candidate = modelCandidate({
      amountLow: 100,
      amountHigh: 200,
      energyKcalLow: 80,
      energyKcalHigh: 240,
      proteinGLow: 8,
      proteinGHigh: 24,
    });
    const item = buildPhotoMealItem(
      confirmed(candidate, {
        confirmedAmount: 150,
        confirmedName: '鸡胸肉（确认）',
        confirmedPreparation: '水煮',
        confirmedAssumptions: ['按去皮鸡胸肉确认'],
      }),
      undefined,
      IDS,
    );

    expect(item).toMatchObject({
      name: '鸡胸肉（确认）',
      preparation: '水煮',
      amount: 150,
      unit: 'g',
      energyKcalLow: 60,
      energyKcalHigh: 360,
      proteinGLow: 6,
      proteinGHigh: 36,
      energyKcal: 210,
      proteinG: 21,
      source: 'photo-ai-user-confirmed',
      sourceVersion: [
        PHOTO_AI_VERSIONS.model,
        PHOTO_AI_VERSIONS.prompt,
        PHOTO_AI_VERSIONS.schema,
        PHOTO_AI_VERSIONS.uncertainty,
      ].join('/'),
      license: 'model-estimate-user-confirmed',
      method: 'ai-confirmed',
      quality: 'B',
      uncertaintyModelVersion: PHOTO_AI_VERSIONS.uncertainty,
      assumptions: ['估算不确定性较高', '按去皮鸡胸肉确认'],
    });
    expect(item.assumptions).not.toContain(photoAiModelRangeCandidateFixture.assumptions[0]);
  });

  test('requires manual entry for every model-range unit change', () => {
    expect(() =>
      buildPhotoMealItem(
        confirmed(modelCandidate(), { confirmedUnit: 'mL' }),
        undefined,
        IDS,
      ),
    ).toThrow('manual-entry-required');
  });

  test('does not create an item from a none candidate', () => {
    expect(() => buildPhotoMealItem(confirmed(noneCandidate()), undefined, IDS)).toThrow();
  });

  test.each([
    ['partial nutrients', modelCandidate({ proteinGHigh: null })],
    ['zero amount', modelCandidate({ amountLow: 0 })],
    ['negative amount', modelCandidate({ amountLow: -1 })],
    ['NaN amount', modelCandidate({ amountHigh: Number.NaN })],
    ['inverted amount', modelCandidate({ amountLow: 200, amountHigh: 100 })],
    ['negative nutrient', modelCandidate({ energyKcalLow: -1 })],
  ])('rejects invalid model candidate data: %s', (_label, candidate) => {
    expect(() => buildPhotoMealItem(confirmed(candidate), undefined, IDS)).toThrow();
  });

  test.each([
    ['confirmed amount', { input: { confirmedAmount: Number.POSITIVE_INFINITY } }],
    ['confirmed name', { input: { confirmedName: ' '.repeat(2) } }],
    ['confirmed assumptions', { input: { confirmedAssumptions: Array(30).fill('x') } }],
    ['id', { ids: { id: '' } }],
    ['mealId', { ids: { mealId: '' } }],
    ['order', { ids: { order: 10_001 } }],
    ['timestamp', { ids: { now: 1.5 } }],
  ])('rejects invalid confirmed metadata: %s', (_label, override) => {
    const parts = override as {
      input?: Partial<ConfirmedPhotoCandidate>;
      ids?: Partial<typeof IDS>;
    };
    const input = confirmed(modelCandidate(), parts.input);
    expect(() => buildPhotoMealItem(input, undefined, { ...IDS, ...parts.ids })).toThrow();
  });

  test('does not retain caller-owned assumption arrays', () => {
    const assumptions = ['用户确认少油'];
    const item = buildPhotoMealItem(
      confirmed(modelCandidate(), { confirmedAssumptions: assumptions }),
      undefined,
      IDS,
    );
    assumptions[0] = 'mutated';
    expect(item.assumptions).toEqual(['估算不确定性较高', '用户确认少油']);
  });

  test('rejects manual nutrient point fields without invoking accessors', () => {
    const direct = {
      ...confirmed(modelCandidate()),
      confirmedEnergyKcal: 200,
    } as unknown as ConfirmedPhotoCandidate;
    const accessor = confirmed(modelCandidate()) as ConfirmedPhotoCandidate & {
      confirmedProteinG?: number;
    };
    let getterCalls = 0;
    Object.defineProperty(accessor, 'confirmedProteinG', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 30;
      },
    });

    expect(() => buildPhotoMealItem(direct, undefined, IDS)).toThrow();
    expect(() => buildPhotoMealItem(accessor, undefined, IDS)).toThrow();
    expect(getterCalls).toBe(0);
  });

  test('rejects a corrupt local catalog snapshot before using it', () => {
    const food = foodRow({ energyKcal: 999 }) as Food;
    expect(() =>
      buildPhotoMealItem(
        confirmed(catalogCandidate({ catalogFoodId: food.id })),
        food,
        IDS,
      ),
    ).toThrow('inconsistent');
  });

  test('rejects a catalog accessor without reading changing values', () => {
    const food = foodRow();
    let sourceReads = 0;
    Object.defineProperty(food, 'source', {
      configurable: true,
      enumerable: true,
      get() {
        sourceReads += 1;
        return sourceReads === 1 ? 'valid' : 'x'.repeat(501);
      },
    });

    expect(() =>
      buildPhotoMealItem(
        confirmed(catalogCandidate({ catalogFoodId: food.id })),
        food,
        IDS,
      ),
    ).toThrow();
    expect(sourceReads).toBe(0);
  });
});
