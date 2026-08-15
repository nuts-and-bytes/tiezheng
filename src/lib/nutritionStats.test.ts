import { describe, expect, test } from 'vitest';
import { foodRow, mealItemRow, mealRow, nutritionPlanRow } from '../test/nutritionFixtures';
import type { NutritionDaySummary } from './nutritionStats';
import {
  evaluateNutritionDay,
  formatNutritionIntake,
  scaleFood,
  summarizeNutritionDay,
} from './nutritionStats';

describe('scaleFood', () => {
  test('scales normalized nutrients by the requested amount', () => {
    expect(scaleFood(foodRow(), 150)).toEqual({
      energyKcal: 195,
      proteinG: 4.035,
    });
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid amount %s',
    (amount) => expect(() => scaleFood(foodRow(), amount)).toThrow(),
  );

  test('fails closed when scaling would overflow', () => {
    expect(() =>
      scaleFood(foodRow({ basisAmount: 1, energyKcal: Number.MAX_VALUE }), 2),
    ).toThrow(/finite/i);
  });
});

describe('summarizeNutritionDay', () => {
  test('uses active meals and active items, orders slots, and keeps dimensions independent', () => {
    const meals = [
      mealRow({ id: 'meal:2026-08-14:dinner', slot: 'dinner' }),
      mealRow({ id: 'meal:2026-08-14:breakfast', slot: 'breakfast' }),
      mealRow({ id: 'meal:deleted', slot: 'lunch', deletedAt: 1 }),
    ];
    const items = [
      mealItemRow({
        id: 'dinner-a',
        mealId: meals[0].id,
        energyKcalLow: 300,
        energyKcalHigh: 340,
        proteinGLow: 20,
        proteinGHigh: 22,
        quality: 'B',
      }),
      mealItemRow({
        id: 'breakfast-a',
        mealId: meals[1].id,
        energyKcalLow: 100,
        energyKcalHigh: 100,
        proteinGLow: 10,
        proteinGHigh: 10,
      }),
      mealItemRow({ id: 'deleted-meal-item', mealId: meals[2].id }),
      mealItemRow({ id: 'deleted-item', mealId: meals[1].id, deletedAt: 2 }),
    ];

    expect(summarizeNutritionDay(meals, items)).toEqual({
      energyKcalLow: 400,
      energyKcalHigh: 440,
      proteinGLow: 30,
      proteinGHigh: 32,
      recordedMeals: 2,
      recordedSlots: ['breakfast', 'dinner'],
      hasRange: true,
    });
  });

  test('quality B marks a range even when all numeric endpoints match', () => {
    const meal = mealRow();
    const item = mealItemRow({ quality: 'B' });
    expect(summarizeNutritionDay([meal], [item]).hasRange).toBe(true);
  });

  test('counts distinct active meal slots instead of meal ids', () => {
    const firstLunch = mealRow({ id: 'meal:first-lunch' });
    const secondLunch = mealRow({ id: 'meal:second-lunch' });
    const summary = summarizeNutritionDay(
      [firstLunch, secondLunch],
      [
        mealItemRow({ id: 'item:first-lunch', mealId: firstLunch.id }),
        mealItemRow({ id: 'item:second-lunch', mealId: secondLunch.id }),
      ],
    );

    expect(summary.recordedMeals).toBe(1);
    expect(summary.recordedSlots).toEqual(['lunch']);
  });

  test('returns a zero summary when nothing is recorded', () => {
    expect(summarizeNutritionDay([], [])).toEqual({
      energyKcalLow: 0,
      energyKcalHigh: 0,
      proteinGLow: 0,
      proteinGHigh: 0,
      recordedMeals: 0,
      recordedSlots: [],
      hasRange: false,
    });
  });

  test('fails closed when finite item ranges overflow the daily total', () => {
    const meal = mealRow();
    const huge = mealItemRow({
      energyKcalLow: Number.MAX_VALUE,
      energyKcalHigh: Number.MAX_VALUE,
    });
    expect(() =>
      summarizeNutritionDay([meal], [huge, { ...huge, id: 'second-huge-item' }]),
    ).toThrow(/finite/i);
  });
});

describe('evaluateNutritionDay', () => {
  const summary = (overrides: Partial<NutritionDaySummary> = {}): NutritionDaySummary => ({
    energyKcalLow: 2000,
    energyKcalHigh: 2100,
    proteinGLow: 120,
    proteinGHigh: 140,
    recordedMeals: 2,
    recordedSlots: ['breakfast', 'lunch'],
    hasRange: true,
    ...overrides,
  });

  test('evaluates protein and energy independently against an active plan', () => {
    const result = evaluateNutritionDay(summary(), nutritionPlanRow());
    expect(result.protein).toMatchObject({
      mode: 'protein-range',
      relation: 'overlap',
      message: '可能与建议范围重叠',
      differenceLow: null,
      differenceHigh: null,
    });
    expect(result.energy).toMatchObject({
      mode: 'energy-relative',
      relation: 'overlap',
      message: '热量相对当前估算重叠',
    });
  });

  test('reports separated deficits and excesses with bounded differences', () => {
    const below = evaluateNutritionDay(
      summary({ energyKcalLow: 1600, energyKcalHigh: 1700, proteinGLow: 80, proteinGHigh: 90 }),
      nutritionPlanRow(),
    );
    expect(below.protein).toMatchObject({
      relation: 'below',
      message: '蛋白质相对建议范围偏低',
      differenceLow: 20,
      differenceHigh: 80,
    });
    expect(below.energy).toMatchObject({
      relation: 'below',
      message: '热量相对当前估算可能偏低',
      differenceLow: 300,
      differenceHigh: 550,
    });

    const above = evaluateNutritionDay(
      summary({ energyKcalLow: 2200, energyKcalHigh: 2300, proteinGLow: 170, proteinGHigh: 180 }),
      nutritionPlanRow(),
    );
    expect(above.protein).toMatchObject({ relation: 'above', differenceLow: 10, differenceHigh: 70 });
    expect(above.energy).toMatchObject({ relation: 'above', differenceLow: 50, differenceHigh: 300 });
  });

  test('marks an exact protein point inside the range as within with zero difference', () => {
    expect(
      evaluateNutritionDay(
        summary({ proteinGLow: 130, proteinGHigh: 130, hasRange: false }),
        nutritionPlanRow(),
      ).protein,
    ).toMatchObject({
      relation: 'within',
      message: '已进入建议范围',
      differenceLow: 0,
      differenceHigh: 0,
    });
  });

  test('keeps an equal-endpoint B-grade protein range as overlap', () => {
    expect(
      evaluateNutritionDay(
        summary({ proteinGLow: 130, proteinGHigh: 130, hasRange: true }),
        nutritionPlanRow(),
      ).protein,
    ).toMatchObject({
      relation: 'overlap',
      message: '可能与建议范围重叠',
      differenceLow: null,
      differenceHigh: null,
    });
  });

  test('uses neutral messages for zero meals and disabled dimensions', () => {
    const empty = summary({ recordedMeals: 0, recordedSlots: [] });
    const active = evaluateNutritionDay(empty, nutritionPlanRow());
    expect(active.protein.message).toBe('尚无已确认食物，暂不评价蛋白质');
    expect(active.energy.message).toBe('尚无已确认食物，暂不评价热量');

    const disabled = evaluateNutritionDay(summary(), undefined);
    expect(disabled.protein).toMatchObject({
      mode: 'disabled',
      relation: 'neutral',
      message: '蛋白质建议范围未启用',
    });
    expect(disabled.energy).toMatchObject({
      mode: 'disabled',
      relation: 'neutral',
      message: '热量当前估算未启用',
    });
  });

  test('disables both dimensions for a soft-deleted plan', () => {
    const result = evaluateNutritionDay(
      summary(),
      nutritionPlanRow({ deletedAt: 1723568400001 }),
    );
    expect(result.protein).toMatchObject({
      mode: 'disabled',
      relation: 'neutral',
      message: '蛋白质建议范围未启用',
    });
    expect(result.energy).toMatchObject({
      mode: 'disabled',
      relation: 'neutral',
      message: '热量当前估算未启用',
    });
  });
});

describe('formatNutritionIntake', () => {
  test('formats empty, exact, and ranged summaries', () => {
    expect(formatNutritionIntake(summarizeNutritionDay([], []))).toBe('今天还没有已确认食物');
    expect(
      formatNutritionIntake({
        energyKcalLow: 100,
        energyKcalHigh: 100,
        proteinGLow: 10,
        proteinGHigh: 10,
        recordedMeals: 1,
        recordedSlots: ['lunch'],
        hasRange: false,
      }),
    ).toBe('100 kcal · 10 g 蛋白质');
    expect(
      formatNutritionIntake({
        energyKcalLow: 100.4,
        energyKcalHigh: 119.6,
        proteinGLow: 10.14,
        proteinGHigh: 11.86,
        recordedMeals: 1,
        recordedSlots: ['lunch'],
        hasRange: true,
      }),
    ).toBe('约 100–120 kcal / 10.1–11.9 g 蛋白质');

    expect(
      formatNutritionIntake({
        energyKcalLow: 100.4,
        energyKcalHigh: 100.4,
        proteinGLow: 10.44,
        proteinGHigh: 10.44,
        recordedMeals: 1,
        recordedSlots: ['lunch'],
        hasRange: false,
      }),
    ).toBe('100 kcal · 10.4 g 蛋白质');

    expect(
      formatNutritionIntake({
        energyKcalLow: 100.4,
        energyKcalHigh: 100.4,
        proteinGLow: 10.14,
        proteinGHigh: 10.14,
        recordedMeals: 1,
        recordedSlots: ['lunch'],
        hasRange: true,
      }),
    ).toBe('约 100 kcal / 10.1 g 蛋白质');
  });
});
