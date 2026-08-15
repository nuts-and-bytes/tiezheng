import { describe, expect, test } from 'vitest';
import { nutritionPlanRow } from '../test/nutritionFixtures';
import { assertNutritionPlanSemantics } from './nutritionPlanValidation';

describe('assertNutritionPlanSemantics', () => {
  test('accepts the canonical fixture, property reordering, and restore timestamps', () => {
    expect(() => assertNutritionPlanSemantics(nutritionPlanRow())).not.toThrow();

    const reordered = Object.fromEntries(
      Object.entries(nutritionPlanRow()).reverse(),
    ) as ReturnType<typeof nutritionPlanRow>;
    expect(() => assertNutritionPlanSemantics(reordered)).not.toThrow();

    expect(() =>
      assertNutritionPlanSemantics(nutritionPlanRow({ updatedAt: 1723568499999 })),
    ).not.toThrow();
  });

  test('accepts a soft-deleted plan with safe integer persistence timestamps', () => {
    expect(() =>
      assertNutritionPlanSemantics(
        nutritionPlanRow({
          updatedAt: 1723568499999,
          deletedAt: 1723568500000,
        }),
      ),
    ).not.toThrow();
  });

  test.each([
    ['updatedAt', { updatedAt: -1 }],
    ['updatedAt', { updatedAt: 1.5 }],
    ['updatedAt', { updatedAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['deletedAt', { deletedAt: -1 }],
    ['deletedAt', { deletedAt: 1.5 }],
    ['deletedAt', { deletedAt: Number.MAX_SAFE_INTEGER + 1 }],
  ] as const)('rejects unsafe persistence timestamp %s %#', (_field, overrides) => {
    expect(() => assertNutritionPlanSemantics(nutritionPlanRow(overrides))).toThrow(
      /safe integer/i,
    );
  });

  test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe calculatedAt timestamp %s',
    (calculatedAt) => {
      expect(() =>
        assertNutritionPlanSemantics(
          nutritionPlanRow({
            equationInputs: {
              ...nutritionPlanRow().equationInputs,
              calculatedAt,
            },
          }),
        ),
      ).toThrow(/safe integer/i);
    },
  );

  test.each([
    ['protein source', { proteinPolicySource: 'WHO' }],
    ['protein version', { proteinPolicyVersion: 'made-up' }],
    ['protein result', { targetRanges: { ...nutritionPlanRow().targetRanges, proteinLowG: 105 } }],
    ['energy raw result', { targetRanges: { ...nutritionPlanRow().targetRanges, energyRawLowKcal: 1900 } }],
    ['energy display result', { targetRanges: { ...nutritionPlanRow().targetRanges, energyLowKcal: 1950 } }],
    ['equation result', { equationInputs: { ...nutritionPlanRow().equationInputs, maintenanceEnergyLowKcal: 2400 } }],
    ['risk blocker result', { safetyInputs: { ...nutritionPlanRow().safetyInputs, eligibilityBlockers: ['kidney-or-complex-condition'] } }],
    ['risk input result', { safetyInputs: { ...nutritionPlanRow().safetyInputs, kidneyDiseaseOrComplexCondition: true } }],
    ['evaluation policy', { targetMode: { ...nutritionPlanRow().targetMode, evaluationPolicy: 'protein-range' } }],
  ] as const)('rejects forged derived semantics: %s', (_label, overrides) => {
    expect(() =>
      assertNutritionPlanSemantics(nutritionPlanRow(overrides as never)),
    ).toThrow();
  });

  test('rejects non-finite calculatedAt before stable JSON can coerce it', () => {
    expect(() =>
      assertNutritionPlanSemantics(
        nutritionPlanRow({
          equationInputs: {
            ...nutritionPlanRow().equationInputs,
            calculatedAt: Number.NaN,
          },
        }),
      ),
    ).toThrow(/calculatedAt/i);
  });

  test('validator rejects a stored mixed none training answer', () => {
    const fixture = nutritionPlanRow();
    expect(() =>
      assertNutritionPlanSemantics(
        nutritionPlanRow({
          equationInputs: {
            ...fixture.equationInputs,
            activityInputs: {
              ...fixture.equationInputs.activityInputs,
              trainingTypes: ['none', 'cardio'],
            },
          },
        }),
      ),
    ).toThrow(/none/i);
  });

  test.each([
    { effectiveFrom: '2026-02-30' },
    { updatedAt: Number.POSITIVE_INFINITY },
    { safetyInputs: { ...nutritionPlanRow().safetyInputs, ageYears: 30.5 } },
    { safetyInputs: { ...nutritionPlanRow().safetyInputs, heightCm: 99 } },
    { safetyInputs: { ...nutritionPlanRow().safetyInputs, basisWeightKg: 301 } },
  ])('rejects invalid stored raw input %#', (overrides) => {
    expect(() => assertNutritionPlanSemantics(nutritionPlanRow(overrides as never))).toThrow();
  });
});
