import { describe, expect, test } from 'vitest';
import { nutritionPlanRow } from '../test/nutritionFixtures';
import type { NutritionActivityInputs, NutritionEligibilityBlocker } from './nutritionTypes';
import {
  bodyMassIndex,
  buildNutritionPlan,
  fatLossEnergyRange,
  impliedWeeklyLossKg,
  nasemAdultEer,
  proteinTargetRange,
  validateActivityInputs,
  type NutritionPlanDraft,
} from './nutritionPlan';

const FIXED_TIME = 1723568400000;

function canonicalDraft(overrides: Partial<NutritionPlanDraft> = {}): NutritionPlanDraft {
  const fixture = nutritionPlanRow();
  const { eligibilityBlockers: _ignored, ...safetyInputs } = fixture.safetyInputs;
  return {
    effectiveFrom: fixture.effectiveFrom,
    goals: { ...fixture.goals },
    safetyInputs: { ...safetyInputs },
    equationInputs: {
      equationBranch: fixture.equationInputs.equationBranch,
      activityInputs: {
        ...fixture.equationInputs.activityInputs,
        trainingTypes: [...fixture.equationInputs.activityInputs.trainingTypes],
      },
      activityCategoryLow: fixture.equationInputs.activityCategoryLow,
      activityCategoryHigh: fixture.equationInputs.activityCategoryHigh,
    },
    ...overrides,
  };
}

function build(
  overrides: Partial<NutritionPlanDraft> = {},
  options = { autoTargetsEnabled: true, now: FIXED_TIME },
) {
  return buildNutritionPlan(canonicalDraft(overrides), options);
}

function blockers(plan = build()): NutritionEligibilityBlocker[] {
  return plan.safetyInputs.eligibilityBlockers;
}

describe('nutrition policy helpers', () => {
  test('calculates BMI and ISSN protein targets', () => {
    expect(bodyMassIndex(80, 175)).toBeCloseTo(26.1224, 4);
    expect(proteinTargetRange(80)).toEqual({
      proteinLowG: 110,
      proteinHighG: 160,
      proteinReferenceG: 130,
      proteinLowCoefficient: 1.4,
      proteinHighCoefficient: 2,
      proteinReferenceCoefficient: 1.6,
    });
  });

  test('implements the canonical eight NASEM adult equations', () => {
    const expected = {
      male: { inactive: 2693.67, 'low-active': 2904.27, active: 3093.72, 'very-active': 3417.77 },
      female: { inactive: 2312.4, 'low-active': 2491.67, active: 2631.65, 'very-active': 2893.58 },
    } as const;
    for (const branch of ['male', 'female'] as const) {
      for (const activity of ['inactive', 'low-active', 'active', 'very-active'] as const) {
        expect(nasemAdultEer({ branch, activity, ageYears: 30, heightCm: 175, weightKg: 80 }))
          .toBeCloseTo(expected[branch][activity], 8);
      }
    }
    expect(() =>
      nasemAdultEer({ branch: 'female', activity: 'active', ageYears: 18, heightCm: 175, weightKg: 80 }),
    ).toThrow(/19/);
  });

  test('derives raw and rounded fat-loss energy ranges from numeric min/max', () => {
    expect(fatLossEnergyRange(2491.67, 2631.65, 'female')).toEqual({
      energyLowKcal: 2000,
      energyHighKcal: 2150,
      energyRawLowKcal: 1993.336,
      energyRawHighKcal: 2131.65,
    });
    expect(impliedWeeklyLossKg(80, 72, '2026-08-14', '2026-12-04')).toBe(0.5);
  });
});

describe('validateActivityInputs', () => {
  const complete = canonicalDraft().equationInputs.activityInputs;
  const empty: NutritionActivityInputs = {
    assessmentStatus: 'not-provided',
    occupation: 'not-provided',
    activeCommuteMinutesPerDay: null,
    householdMinutesPerDay: null,
    stepsPerDay: null,
    trainingTypes: [],
    trainingSessionsPerWeek: null,
    trainingMinutesPerSession: null,
    trainingIntensity: 'not-provided',
  };

  test('accepts complete and unique empty canonical questionnaires', () => {
    expect(() => validateActivityInputs(complete)).not.toThrow();
    expect(() => validateActivityInputs(empty)).not.toThrow();
  });

  test.each([
    { ...empty, stepsPerDay: 0 },
    { ...complete, activeCommuteMinutesPerDay: 1441 },
    { ...complete, householdMinutesPerDay: -1 },
    { ...complete, stepsPerDay: 100001 },
    { ...complete, trainingSessionsPerWeek: 15 },
    { ...complete, trainingMinutesPerSession: 601 },
    { ...complete, trainingTypes: ['none', 'cardio'] },
    { ...complete, trainingTypes: ['none'], trainingSessionsPerWeek: 1 },
    { ...complete, trainingTypes: ['cardio'], trainingSessionsPerWeek: 0 },
    { ...complete, trainingTypes: ['cardio'], trainingIntensity: 'none' },
    { ...complete, occupation: 'desk-job' as never },
    { ...complete, trainingTypes: ['powerlifting' as never] },
    { ...complete, trainingIntensity: 'maximum' as never },
  ] as NutritionActivityInputs[])('rejects non-canonical activity input %#', (value) => {
    expect(() => validateActivityInputs(value)).toThrow();
  });
});

describe('buildNutritionPlan', () => {
  test('rebuilds the canonical fixture without mutating the draft', () => {
    const draft = canonicalDraft();
    const snapshot = structuredClone(draft);
    expect(buildNutritionPlan(draft, { autoTargetsEnabled: true, now: FIXED_TIME }))
      .toEqual(nutritionPlanRow());
    expect(draft).toEqual(snapshot);
  });

  test('feature flag off produces the one neutral snapshot while retaining safety audit input', () => {
    const plan = build({}, { autoTargetsEnabled: false, now: FIXED_TIME });
    expect(plan.safetyInputs.basisWeightKg).toBe(80);
    expect(plan.safetyInputs.eligibilityBlockers).toEqual(['automatic-targets-disabled']);
    expect(plan.equationInputs).toEqual({
      equationName: 'not-calculated',
      equationBranch: 'unavailable',
      activityInputs: {
        assessmentStatus: 'not-provided', occupation: 'not-provided',
        activeCommuteMinutesPerDay: null, householdMinutesPerDay: null, stepsPerDay: null,
        trainingTypes: [], trainingSessionsPerWeek: null, trainingMinutesPerSession: null,
        trainingIntensity: 'not-provided',
      },
      activityCategoryLow: null,
      activityCategoryHigh: null,
      maintenanceEnergyLowKcal: null,
      maintenanceEnergyHighKcal: null,
      calculatedAt: null,
    });
    expect(Object.values(plan.targetRanges).every((value) => value === null)).toBe(true);
    expect(plan.targetMode).toEqual({
      protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only',
      autoTargetsEnabled: false, reason: 'professional-review-pending',
    });
  });

  test('no selected goals is active but neutral and blocker-free', () => {
    const plan = build({ goals: { muscleGain: false, fatLoss: false } });
    expect(blockers(plan)).toEqual([]);
    expect(plan.targetMode).toMatchObject({
      protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only',
      autoTargetsEnabled: true, reason: 'active',
    });
  });

  test('age gates protein at 18 and energy at 19 without cross-disabling eligible dimensions', () => {
    const at17 = build({ safetyInputs: { ...canonicalDraft().safetyInputs, ageYears: 17 } });
    expect(blockers(at17)).toEqual(['protein-age-under-18', 'energy-age-under-19']);
    expect(at17.targetMode).toMatchObject({ protein: 'disabled', energy: 'disabled' });
    expect(at17.equationInputs).toMatchObject({
      equationName: 'not-calculated',
      equationBranch: 'unavailable',
      activityInputs: canonicalDraft().equationInputs.activityInputs,
      activityCategoryLow: null,
      activityCategoryHigh: null,
      maintenanceEnergyLowKcal: null,
      maintenanceEnergyHighKcal: null,
      calculatedAt: null,
    });

    const at18 = build({
      goals: { muscleGain: true, fatLoss: false },
      safetyInputs: { ...canonicalDraft().safetyInputs, ageYears: 18 },
    });
    expect(at18.targetMode.protein).toBe('range');
    expect(blockers(at18)).toEqual([]);

    const bothAt18 = build({ safetyInputs: { ...canonicalDraft().safetyInputs, ageYears: 18 } });
    expect(bothAt18.targetMode).toMatchObject({ protein: 'range', energy: 'disabled' });
    expect(blockers(bothAt18)).toEqual(['energy-age-under-19']);
    expect(bothAt18.equationInputs).toMatchObject({
      equationName: 'not-calculated',
      equationBranch: 'unavailable',
      activityCategoryLow: null,
      activityCategoryHigh: null,
      maintenanceEnergyLowKcal: null,
      maintenanceEnergyHighKcal: null,
      calculatedAt: null,
    });

    expect(build({ safetyInputs: { ...canonicalDraft().safetyInputs, ageYears: 19 } }).targetMode.energy)
      .toBe('range');

    expect(() =>
      build({
        safetyInputs: {
          ...canonicalDraft().safetyInputs,
          ageYears: 17,
          targetLossKgPerWeek: 0.4,
        },
      }),
    ).toThrow(/disagrees/i);
  });

  test('dimension-only missing inputs do not disable the other dimension', () => {
    const proteinMissing = build({
      safetyInputs: { ...canonicalDraft().safetyInputs, proteinWeightMethod: null },
    });
    expect(proteinMissing.targetMode).toMatchObject({ protein: 'disabled', energy: 'range' });
    expect(proteinMissing.targetMode.reason).toBe('active');

    const energyMissing = build({
      safetyInputs: { ...canonicalDraft().safetyInputs, heightCm: null },
    });
    expect(energyMissing.targetMode).toMatchObject({ protein: 'range', energy: 'disabled' });
    expect(energyMissing.targetMode.reason).toBe('active');

    const sharedMissing = build({
      safetyInputs: { ...canonicalDraft().safetyInputs, pregnantOrBreastfeeding: null },
    });
    expect(sharedMissing.targetMode).toMatchObject({ protein: 'disabled', energy: 'disabled' });
    expect(sharedMissing.targetMode.reason).toBe('eligibility-blocked');
    expect(blockers(sharedMissing)).toContain('missing-inputs');
  });

  test('requires a dated basis weight before enabling protein targets', () => {
    const plan = build({
      goals: { muscleGain: true, fatLoss: false },
      safetyInputs: {
        ...canonicalDraft().safetyInputs,
        basisWeightDate: null,
      },
    });

    expect(plan.targetMode.protein).toBe('disabled');
    expect(blockers(plan)).toContain('missing-inputs');
  });

  test.each([
    ['pregnantOrBreastfeeding', 'pregnancy-or-breastfeeding'],
    ['requiresTherapeuticDiet', 'therapeutic-diet-required'],
    ['kidneyDiseaseOrComplexCondition', 'kidney-or-complex-condition'],
    ['eatingDisorderOrRedsRisk', 'eating-disorder-or-reds-risk'],
    ['athleteOrExtremeActivity', 'athlete-or-extreme-activity'],
  ] as const)('blocks both dimensions for shared risk %s', (field, expected) => {
    const plan = build({ safetyInputs: { ...canonicalDraft().safetyInputs, [field]: true } });
    expect(plan.targetMode).toMatchObject({ protein: 'disabled', energy: 'disabled' });
    expect(blockers(plan)).toContain(expected);
  });

  test.each([
    { proteinWeightMethod: 'professional-reference-weight' as const },
    { proteinWeightMethod: 'unverified' as const },
    { highBodyFatOrObesity: true },
  ])('fails closed on unverified protein weight semantics %#', (override) => {
    const plan = build({ safetyInputs: { ...canonicalDraft().safetyInputs, ...override } });
    expect(plan.targetMode).toMatchObject({ protein: 'disabled', energy: 'range' });
    expect(blockers(plan)).toContain('protein-weight-method-unverified');
  });

  test('accepts only canonical point or adjacent ascending activity categories', () => {
    const point = build({
      equationInputs: {
        ...canonicalDraft().equationInputs,
        activityCategoryLow: 'active',
        activityCategoryHigh: null,
      },
    });
    expect(point.equationInputs.maintenanceEnergyLowKcal)
      .toBe(point.equationInputs.maintenanceEnergyHighKcal);

    for (const equationInputs of [
      { ...canonicalDraft().equationInputs, activityCategoryLow: null, activityCategoryHigh: 'inactive' as const },
      { ...canonicalDraft().equationInputs, activityCategoryLow: 'active' as const, activityCategoryHigh: 'active' as const },
      { ...canonicalDraft().equationInputs, activityCategoryLow: 'active' as const, activityCategoryHigh: 'low-active' as const },
      { ...canonicalDraft().equationInputs, activityCategoryLow: 'inactive' as const, activityCategoryHigh: 'active' as const },
    ]) {
      expect(() => build({ equationInputs })).toThrow(/activity category/i);
    }
  });

  test('builder rejects a mixed none training answer', () => {
    expect(() =>
      build({
        equationInputs: {
          ...canonicalDraft().equationInputs,
          activityInputs: {
            ...canonicalDraft().equationInputs.activityInputs,
            trainingTypes: ['none', 'cardio'],
          },
        },
      }),
    ).toThrow(/none/i);
  });

  test('sorts crossing NASEM endpoints numerically before applying the male floor', () => {
    const plan = build({
      goals: { muscleGain: false, fatLoss: true },
      safetyInputs: {
        ...canonicalDraft().safetyInputs,
        basisWeightKg: 27,
        heightCm: 100,
        ageYears: 19,
        targetWeightKg: 24,
        targetLossKgPerWeek: 0.188,
        basisWeightDate: '2026-08-14',
        targetDate: '2026-12-04',
      },
      equationInputs: {
        ...canonicalDraft().equationInputs,
        equationBranch: 'male',
        activityCategoryLow: 'active',
        activityCategoryHigh: 'very-active',
      },
    });
    expect(plan.equationInputs.maintenanceEnergyLowKcal)
      .toBeLessThanOrEqual(plan.equationInputs.maintenanceEnergyHighKcal!);
    expect(blockers(plan)).toContain('energy-floor');
    expect(plan.targetMode.energy).toBe('disabled');
  });

  test('keeps range mode when distinct raw female endpoints round to the same display value', () => {
    const plan = build({
      goals: { muscleGain: false, fatLoss: true },
      safetyInputs: {
        ...canonicalDraft().safetyInputs,
        basisWeightKg: 25,
        heightCm: 100,
        ageYears: 20,
        targetWeightKg: 24,
        targetLossKgPerWeek: 0.063,
      },
      equationInputs: {
        ...canonicalDraft().equationInputs,
        equationBranch: 'female',
        activityCategoryLow: 'active',
        activityCategoryHigh: 'very-active',
      },
    });
    expect(plan.targetRanges.energyRawLowKcal).not.toBe(plan.targetRanges.energyRawHighKcal);
    expect(plan.targetRanges.energyLowKcal).toBe(1250);
    expect(plan.targetRanges.energyHighKcal).toBe(1250);
    expect(plan.targetMode.energy).toBe('range');
  });

  test('applies current and target BMI boundaries exactly', () => {
    const withBmi = (currentBmi: number, targetBmi: number) => build({
      safetyInputs: {
        ...canonicalDraft().safetyInputs,
        heightCm: 175,
        basisWeightKg: currentBmi * 1.75 ** 2,
        targetWeightKg: targetBmi * 1.75 ** 2,
        targetLossKgPerWeek: Number(
          (((currentBmi - targetBmi) * 1.75 ** 2) / 16).toFixed(3),
        ),
      },
    });
    expect(blockers(withBmi(23.9, 20))).toContain('fat-loss-bmi-ineligible');
    expect(blockers(withBmi(24, 18.5))).not.toContain('fat-loss-bmi-ineligible');
    expect(blockers(withBmi(27.99, 20))).not.toContain('fat-loss-bmi-ineligible');
    expect(blockers(withBmi(28, 18.49))).toContain('target-bmi-below-18.5');
    expect(blockers(withBmi(28, 18.5))).not.toContain('target-bmi-below-18.5');
  });

  test('enforces exact declared rate, 0.5 kg/week, and the six-month ten-percent phase gate', () => {
    expect(blockers(build())).not.toContain('speed-or-six-month-limit');
    expect(() => build({
      safetyInputs: { ...canonicalDraft().safetyInputs, targetLossKgPerWeek: 0.4999 },
    })).toThrow(/disagrees/i);
    expect(() => build({
      safetyInputs: { ...canonicalDraft().safetyInputs, targetLossKgPerWeek: 0.4 },
    })).toThrow(/disagrees/i);

    const fast = build({
      safetyInputs: {
        ...canonicalDraft().safetyInputs,
        targetWeightKg: 70,
        targetLossKgPerWeek: 0.625,
      },
    });
    expect(blockers(fast)).toContain('speed-or-six-month-limit');

    const fiveMonthOverTenPercent = build({
      safetyInputs: {
        ...canonicalDraft().safetyInputs,
        basisWeightKg: 100,
        targetWeightKg: 89.99,
        targetDate: '2027-01-14',
        targetLossKgPerWeek: 0.458,
      },
    });
    expect(blockers(fiveMonthOverTenPercent)).toContain('speed-or-six-month-limit');

    const sevenMonth = build({
      safetyInputs: {
        ...canonicalDraft().safetyInputs,
        basisWeightKg: 100,
        targetWeightKg: 89,
        targetDate: '2027-03-14',
        targetLossKgPerWeek: 0.363,
      },
    });
    expect(blockers(sevenMonth)).not.toContain('speed-or-six-month-limit');
  });

  test('anchors basis and target dates to the plan effective date', () => {
    expect(() =>
      build({
        safetyInputs: {
          ...canonicalDraft().safetyInputs,
          basisWeightDate: '2026-08-15',
        },
      }),
    ).toThrow(/basisWeightDate.*effectiveFrom/i);

    expect(() =>
      build({
        safetyInputs: {
          ...canonicalDraft().safetyInputs,
          basisWeightDate: '2026-08-13',
          targetDate: '2026-08-14',
        },
      }),
    ).toThrow(/targetDate.*effectiveFrom/i);
  });

  test.each([
    { safetyInputs: { ...canonicalDraft().safetyInputs, basisWeightKg: Number.NaN } },
    { safetyInputs: { ...canonicalDraft().safetyInputs, ageYears: 30.5 } },
    { safetyInputs: { ...canonicalDraft().safetyInputs, basisWeightDate: '2026-02-30' } },
    { safetyInputs: { ...canonicalDraft().safetyInputs, targetWeightKg: 81 } },
    { effectiveFrom: '2026-13-01' },
  ])('rejects invalid raw draft %#', (overrides) => {
    expect(() => build(overrides as Partial<NutritionPlanDraft>)).toThrow();
  });
});
