import { describe, expect, expectTypeOf, test } from 'vitest';
import type { Food, Meal, MealItem, NutritionPlan } from './nutritionTypes';
import {
  buildNutritionPlan,
  impliedWeeklyLossKg,
  type NutritionPlanDraft,
} from './nutritionPlan';
import { assertNutritionPlanSemantics } from './nutritionPlanValidation';
import type {
  BackupFood,
  BackupMeal,
  BackupMealItem,
  BackupNutritionPlan,
  NutritionBackupSection,
} from './nutritionBackup';
import {
  EMPTY_NUTRITION_BACKUP,
  parseNutritionSection,
  serializeNutritionSection,
} from './nutritionBackup';
import {
  activePointNutritionPlanRow,
  activeRangeNutritionPlanRow,
  legacyBackupV0Fixture,
  legacyBackupV1Fixture,
  legacyBackupV2Fixture,
  nutritionBackupSectionFixture,
} from '../test/nutritionBackupFixtures';

const plan = {
  id: 'nutrition-plan:2026-08-14',
  effectiveFrom: '2026-08-14',
  goals: {
    muscleGain: true,
    fatLoss: false,
    privateGoalsField: 'must-not-leak',
  },
  safetyInputs: {
    basisWeightKg: 70,
    basisWeightDate: '2026-08-14',
    proteinWeightMethod: 'current-weight',
    ageYears: 30,
    heightCm: 175,
    targetWeightKg: null,
    targetLossKgPerWeek: null,
    targetDate: null,
    highBodyFatOrObesity: false,
    pregnantOrBreastfeeding: false,
    requiresTherapeuticDiet: false,
    kidneyDiseaseOrComplexCondition: false,
    eatingDisorderOrRedsRisk: false,
    athleteOrExtremeActivity: false,
    eligibilityStandard: 'WS/T 428—2013',
    eligibilityBlockers: ['automatic-targets-disabled'],
    privateSafetyField: 'must-not-leak',
  },
  standardVersion: 'nutrition-safety-v1',
  equationInputs: {
    equationName: 'not-calculated',
    equationBranch: 'unavailable',
    activityInputs: {
      assessmentStatus: 'not-provided',
      occupation: 'not-provided',
      activeCommuteMinutesPerDay: null,
      householdMinutesPerDay: null,
      stepsPerDay: null,
      trainingTypes: [],
      trainingSessionsPerWeek: null,
      trainingMinutesPerSession: null,
      trainingIntensity: 'not-provided',
      privateActivityField: 'must-not-leak',
    },
    activityCategoryLow: null,
    activityCategoryHigh: null,
    maintenanceEnergyLowKcal: null,
    maintenanceEnergyHighKcal: null,
    calculatedAt: null,
    privateEquationField: 'must-not-leak',
  },
  equationVersion: 'not-calculated-v1',
  targetRanges: {
    proteinLowG: null,
    proteinHighG: null,
    proteinReferenceG: null,
    proteinLowCoefficient: null,
    proteinHighCoefficient: null,
    proteinReferenceCoefficient: null,
    energyLowKcal: null,
    energyHighKcal: null,
    energyRawLowKcal: null,
    energyRawHighKcal: null,
    privateTargetRangesField: 'must-not-leak',
  },
  targetMode: {
    protein: 'disabled',
    energy: 'disabled',
    evaluationPolicy: 'neutral-intake-only',
    autoTargetsEnabled: false,
    reason: 'professional-review-pending',
    privateTargetModeField: 'must-not-leak',
  },
  sourceVersion: 'nutrition-policy-v1',
  proteinPolicySource: 'ISSN',
  proteinPolicyVersion: 'JISSN-2017-14-20',
  updatedAt: 99,
  deletedAt: null,
  privateFutureField: 'must-not-leak',
} as NutritionPlan & { privateFutureField: string };

const customFood = {
  id: 'food:custom:tofu-bowl',
  name: '豆腐饭',
  aliases: [],
  rawOrCooked: 'cooked',
  preparation: '清炒',
  originalEnergyValue: 130,
  originalEnergyUnit: 'kcal',
  originalProteinG: 8,
  originalBasisAmount: 100,
  originalBasisUnit: 'g',
  basisAmount: 100,
  basisUnit: 'g',
  energyKcal: 130,
  proteinG: 8,
  ediblePortionRatio: 1,
  densityGPerMl: null,
  conversionAssumptions: ['用户标签每 100 g'],
  fdcId: null,
  fdcDataType: null,
  sourceRetrievedAt: null,
  source: 'user-label',
  sourceVersion: '2026-08-14',
  license: 'user-provided',
  preset: false,
  updatedAt: 99,
  deletedAt: null,
  privateFutureField: 'must-not-leak',
} as Food & { privateFutureField: string };

const presetFood = {
  ...customFood,
  id: 'food:preset:rice-cooked',
  name: '熟米饭',
  preset: true,
} satisfies Food;

const meal = {
  id: 'meal:2026-08-14:lunch',
  date: '2026-08-14',
  slot: 'lunch',
  updatedAt: 99,
  deletedAt: null,
} satisfies Meal;

const item = {
  id: 'meal-item:one',
  mealId: meal.id,
  name: '豆腐饭',
  preparation: '清炒',
  amount: 250,
  unit: 'g',
  originalEnergyValue: 130,
  originalEnergyUnit: 'kcal',
  originalProteinG: 8,
  originalBasisAmount: 100,
  originalBasisUnit: 'g',
  energyKcal: 130,
  proteinG: 8,
  energyKcalLow: 300,
  energyKcalHigh: 360,
  proteinGLow: 18,
  proteinGHigh: 22,
  assumptions: ['少油'],
  uncertaintyModelVersion: 'portion-v1',
  basisAmount: 100,
  basisUnit: 'g',
  ediblePortionRatio: 1,
  densityGPerMl: null,
  conversionAssumptions: ['用户标签每 100 g'],
  fdcId: null,
  fdcDataType: null,
  sourceRetrievedAt: null,
  source: 'user-label',
  sourceVersion: '2026-08-14',
  license: 'user-provided',
  method: 'manual',
  quality: 'B',
  confirmedAt: 100,
  order: 0,
  updatedAt: 101,
  deletedAt: null,
  privateFutureField: 'must-not-leak',
} as MealItem & { privateFutureField: string };

describe('serializeNutritionSection', () => {
  test('只导出有效营养行、自定义食物和显式白名单字段', () => {
    const expectedSafetyInputs = {
      basisWeightKg: 70,
      basisWeightDate: '2026-08-14',
      proteinWeightMethod: 'current-weight',
      ageYears: 30,
      heightCm: 175,
      targetWeightKg: null,
      targetLossKgPerWeek: null,
      targetDate: null,
      highBodyFatOrObesity: false,
      pregnantOrBreastfeeding: false,
      requiresTherapeuticDiet: false,
      kidneyDiseaseOrComplexCondition: false,
      eatingDisorderOrRedsRisk: false,
      athleteOrExtremeActivity: false,
      eligibilityStandard: 'WS/T 428—2013',
      eligibilityBlockers: ['automatic-targets-disabled'],
    };
    const expectedGoals = {
      muscleGain: true,
      fatLoss: false,
    };
    const expectedActivityInputs = {
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
    const expectedEquationInputs = {
      equationName: 'not-calculated',
      equationBranch: 'unavailable',
      activityInputs: expectedActivityInputs,
      activityCategoryLow: null,
      activityCategoryHigh: null,
      maintenanceEnergyLowKcal: null,
      maintenanceEnergyHighKcal: null,
      calculatedAt: null,
    };
    const expectedTargetRanges = {
      proteinLowG: null,
      proteinHighG: null,
      proteinReferenceG: null,
      proteinLowCoefficient: null,
      proteinHighCoefficient: null,
      proteinReferenceCoefficient: null,
      energyLowKcal: null,
      energyHighKcal: null,
      energyRawLowKcal: null,
      energyRawHighKcal: null,
    };
    const expectedTargetMode = {
      protein: 'disabled',
      energy: 'disabled',
      evaluationPolicy: 'neutral-intake-only',
      autoTargetsEnabled: false,
      reason: 'professional-review-pending',
    };
    const result = serializeNutritionSection({
      nutritionPlans: [plan, { ...plan, id: 'deleted-plan', deletedAt: 1 }],
      foods: [customFood, presetFood],
      meals: [meal, { ...meal, id: 'deleted-meal', deletedAt: 1 }],
      mealItems: [
        item,
        { ...item, id: 'deleted-item', deletedAt: 1 },
        { ...item, id: 'orphan', mealId: 'deleted-meal' },
      ],
    });

    expect(result.nutritionPlans).toEqual([
      {
        id: plan.id,
        effectiveFrom: plan.effectiveFrom,
        goals: expectedGoals,
        safetyInputs: expectedSafetyInputs,
        standardVersion: plan.standardVersion,
        equationInputs: expectedEquationInputs,
        equationVersion: plan.equationVersion,
        targetRanges: expectedTargetRanges,
        targetMode: expectedTargetMode,
        sourceVersion: plan.sourceVersion,
        proteinPolicySource: plan.proteinPolicySource,
        proteinPolicyVersion: plan.proteinPolicyVersion,
      },
    ]);
    expect(result.nutritionPlans[0].goals).not.toHaveProperty('privateGoalsField');
    expect(result.nutritionPlans[0].safetyInputs).not.toHaveProperty('privateSafetyField');
    expect(result.nutritionPlans[0].equationInputs).not.toHaveProperty(
      'privateEquationField',
    );
    expect(result.nutritionPlans[0].equationInputs.activityInputs).not.toHaveProperty(
      'privateActivityField',
    );
    expect(result.nutritionPlans[0].targetRanges).not.toHaveProperty(
      'privateTargetRangesField',
    );
    expect(result.nutritionPlans[0].targetMode).not.toHaveProperty('privateTargetModeField');
    expect(result.foods).toEqual([
      {
        id: customFood.id,
        name: customFood.name,
        aliases: customFood.aliases,
        rawOrCooked: customFood.rawOrCooked,
        preparation: customFood.preparation,
        originalEnergyValue: customFood.originalEnergyValue,
        originalEnergyUnit: customFood.originalEnergyUnit,
        originalProteinG: customFood.originalProteinG,
        originalBasisAmount: customFood.originalBasisAmount,
        originalBasisUnit: customFood.originalBasisUnit,
        basisAmount: customFood.basisAmount,
        basisUnit: customFood.basisUnit,
        energyKcal: customFood.energyKcal,
        proteinG: customFood.proteinG,
        ediblePortionRatio: customFood.ediblePortionRatio,
        densityGPerMl: customFood.densityGPerMl,
        conversionAssumptions: customFood.conversionAssumptions,
        fdcId: customFood.fdcId,
        fdcDataType: customFood.fdcDataType,
        sourceRetrievedAt: customFood.sourceRetrievedAt,
        source: customFood.source,
        sourceVersion: customFood.sourceVersion,
        license: customFood.license,
      },
    ]);
    expect(result.meals).toEqual([{ id: meal.id, date: meal.date, slot: meal.slot }]);
    expect(result.mealItems).toEqual([
      {
        id: item.id,
        mealId: item.mealId,
        name: item.name,
        preparation: item.preparation,
        amount: item.amount,
        unit: item.unit,
        originalEnergyValue: item.originalEnergyValue,
        originalEnergyUnit: item.originalEnergyUnit,
        originalProteinG: item.originalProteinG,
        originalBasisAmount: item.originalBasisAmount,
        originalBasisUnit: item.originalBasisUnit,
        energyKcal: item.energyKcal,
        proteinG: item.proteinG,
        energyKcalLow: item.energyKcalLow,
        energyKcalHigh: item.energyKcalHigh,
        proteinGLow: item.proteinGLow,
        proteinGHigh: item.proteinGHigh,
        assumptions: item.assumptions,
        uncertaintyModelVersion: item.uncertaintyModelVersion,
        basisAmount: item.basisAmount,
        basisUnit: item.basisUnit,
        ediblePortionRatio: item.ediblePortionRatio,
        densityGPerMl: item.densityGPerMl,
        conversionAssumptions: item.conversionAssumptions,
        fdcId: item.fdcId,
        fdcDataType: item.fdcDataType,
        sourceRetrievedAt: item.sourceRetrievedAt,
        source: item.source,
        sourceVersion: item.sourceVersion,
        license: item.license,
        method: item.method,
        quality: item.quality,
        confirmedAt: item.confirmedAt,
        order: item.order,
      },
    ]);
  });

  test('保留 assessmentStatus 和 point 能量模式下的单点活动分类', () => {
    const pointEnergyPlan = structuredClone(plan);
    pointEnergyPlan.equationInputs = {
      equationName: 'NASEM-2023-adult-EER',
      equationBranch: 'male',
      activityInputs: {
        assessmentStatus: 'complete',
        occupation: 'mixed',
        activeCommuteMinutesPerDay: 20,
        householdMinutesPerDay: 30,
        stepsPerDay: 8_000,
        trainingTypes: ['resistance', 'cardio'],
        trainingSessionsPerWeek: 4,
        trainingMinutesPerSession: 60,
        trainingIntensity: 'mixed',
      },
      activityCategoryLow: 'active',
      activityCategoryHigh: null,
      maintenanceEnergyLowKcal: 2_500,
      maintenanceEnergyHighKcal: 2_500,
      calculatedAt: 123,
    };
    pointEnergyPlan.targetRanges = {
      ...pointEnergyPlan.targetRanges,
      energyLowKcal: 2_500,
      energyHighKcal: 2_500,
      energyRawLowKcal: 2_493,
      energyRawHighKcal: 2_493,
    };
    pointEnergyPlan.targetMode = {
      protein: 'disabled',
      energy: 'point',
      evaluationPolicy: 'energy-relative',
      autoTargetsEnabled: true,
      reason: 'active',
    };

    const result = serializeNutritionSection({
      nutritionPlans: [pointEnergyPlan],
      foods: [],
      meals: [],
      mealItems: [],
    });

    expect(result.nutritionPlans[0].equationInputs.activityInputs.assessmentStatus).toBe(
      'complete',
    );
    expect(result.nutritionPlans[0].equationInputs.activityCategoryLow).toBe('active');
    expect(result.nutritionPlans[0].equationInputs.activityCategoryHigh).toBeNull();
    expect(result.nutritionPlans[0].targetMode.energy).toBe('point');
  });

  test('深拷贝所有数组和嵌套对象，不泄漏数据库行的可变引用', () => {
    const sourcePlan = structuredClone(plan);
    const sourceFood = structuredClone(customFood);
    const sourceMeal = structuredClone(meal);
    const sourceItem = structuredClone(item);
    const result = serializeNutritionSection({
      nutritionPlans: [sourcePlan],
      foods: [sourceFood],
      meals: [sourceMeal],
      mealItems: [sourceItem],
    });
    const backupPlan = result.nutritionPlans[0];
    const backupFood = result.foods[0];
    const backupItem = result.mealItems[0];

    expect(backupPlan.goals).not.toBe(sourcePlan.goals);
    expect(backupPlan.safetyInputs).not.toBe(sourcePlan.safetyInputs);
    expect(backupPlan.safetyInputs.eligibilityBlockers).not.toBe(
      sourcePlan.safetyInputs.eligibilityBlockers,
    );
    expect(backupPlan.equationInputs).not.toBe(sourcePlan.equationInputs);
    expect(backupPlan.equationInputs.activityInputs).not.toBe(
      sourcePlan.equationInputs.activityInputs,
    );
    expect(backupPlan.equationInputs.activityInputs.trainingTypes).not.toBe(
      sourcePlan.equationInputs.activityInputs.trainingTypes,
    );
    expect(backupPlan.targetRanges).not.toBe(sourcePlan.targetRanges);
    expect(backupPlan.targetMode).not.toBe(sourcePlan.targetMode);
    expect(backupFood.aliases).not.toBe(sourceFood.aliases);
    expect(backupFood.conversionAssumptions).not.toBe(sourceFood.conversionAssumptions);
    expect(backupItem.assumptions).not.toBe(sourceItem.assumptions);
    expect(backupItem.conversionAssumptions).not.toBe(sourceItem.conversionAssumptions);

    sourcePlan.goals.muscleGain = false;
    sourcePlan.safetyInputs.eligibilityBlockers.push('missing-inputs');
    sourcePlan.equationInputs.activityInputs.trainingTypes.push('cardio');
    sourceFood.aliases.push('恶意别名');
    sourceItem.assumptions.push('恶意假设');

    expect(backupPlan.goals.muscleGain).toBe(true);
    expect(backupPlan.safetyInputs.eligibilityBlockers).toEqual([
      'automatic-targets-disabled',
    ]);
    expect(backupPlan.equationInputs.activityInputs.trainingTypes).toEqual([]);
    expect(backupFood.aliases).toEqual([]);
    expect(backupItem.assumptions).toEqual(['少油']);
  });

  test('对四类备份行执行确定性多键排序', () => {
    const earlierPlan = {
      ...structuredClone(plan),
      id: 'nutrition-plan:earlier',
      effectiveFrom: '2026-08-13',
    };
    const laterPlan = {
      ...structuredClone(plan),
      id: 'nutrition-plan:later',
      effectiveFrom: '2026-08-15',
    };
    const foodA = { ...structuredClone(customFood), id: 'food:custom:a' };
    const foodZ = { ...structuredClone(customFood), id: 'food:custom:z' };
    const mealA = { ...meal, id: 'meal:a' };
    const mealZ = { ...meal, id: 'meal:z' };
    const mealItemA = { ...item, id: 'meal-item:a-1', mealId: mealA.id, order: 1 };
    const mealItemZ1 = { ...item, id: 'meal-item:z-1', mealId: mealZ.id, order: 1 };
    const mealItemZ2a = { ...item, id: 'meal-item:z-2-a', mealId: mealZ.id, order: 2 };
    const mealItemZ2b = { ...item, id: 'meal-item:z-2-b', mealId: mealZ.id, order: 2 };

    const result = serializeNutritionSection({
      nutritionPlans: [laterPlan, earlierPlan],
      foods: [foodZ, foodA],
      meals: [mealZ, mealA],
      mealItems: [mealItemZ2b, mealItemA, mealItemZ2a, mealItemZ1],
    });

    expect(result.nutritionPlans.map(({ id }) => id)).toEqual([
      earlierPlan.id,
      laterPlan.id,
    ]);
    expect(result.foods.map(({ id }) => id)).toEqual([foodA.id, foodZ.id]);
    expect(result.meals.map(({ id }) => id)).toEqual([mealA.id, mealZ.id]);
    expect(result.mealItems.map(({ id }) => id)).toEqual([
      mealItemA.id,
      mealItemZ1.id,
      mealItemZ2a.id,
      mealItemZ2b.id,
    ]);
  });

  test('只返回计划定义的四类 DTO，不透传额外顶层资产', () => {
    const rowsWithExtraAssets = {
      nutritionPlans: [],
      foods: [],
      meals: [],
      mealItems: [],
      mealPhotos: [{ thumbnail: new Blob(['private-photo']) }],
      mealEstimates: [{ status: 'awaiting-consent', error: null }],
      privateFutureRows: [{ secret: true }],
    };

    const result = serializeNutritionSection(rowsWithExtraAssets);

    expect(result).toEqual(EMPTY_NUTRITION_BACKUP);
    expect(Object.keys(result).sort()).toEqual([
      'foods',
      'mealItems',
      'meals',
      'nutritionPlans',
    ]);
  });

  test('DTO 字段类型与当前营养领域合同同步', () => {
    expectTypeOf<BackupNutritionPlan['goals']>().toEqualTypeOf<NutritionPlan['goals']>();
    expectTypeOf<BackupNutritionPlan['safetyInputs']>().toEqualTypeOf<
      NutritionPlan['safetyInputs']
    >();
    expectTypeOf<BackupNutritionPlan['equationInputs']>().toEqualTypeOf<
      NutritionPlan['equationInputs']
    >();
    expectTypeOf<BackupNutritionPlan['targetRanges']>().toEqualTypeOf<
      NutritionPlan['targetRanges']
    >();
    expectTypeOf<BackupNutritionPlan['targetMode']>().toEqualTypeOf<
      NutritionPlan['targetMode']
    >();
    expectTypeOf<BackupNutritionPlan['proteinPolicySource']>().toEqualTypeOf<'ISSN'>();
    expectTypeOf<BackupNutritionPlan['proteinPolicyVersion']>().toEqualTypeOf<
      'JISSN-2017-14-20'
    >();
    expectTypeOf<BackupFood['fdcDataType']>().toEqualTypeOf<Food['fdcDataType']>();
    expectTypeOf<BackupMeal['slot']>().toEqualTypeOf<Meal['slot']>();
    expectTypeOf<BackupMealItem['method']>().toEqualTypeOf<MealItem['method']>();
    expectTypeOf<BackupMealItem['quality']>().toEqualTypeOf<MealItem['quality']>();
    expectTypeOf<NutritionBackupSection>().toEqualTypeOf<{
      nutritionPlans: BackupNutritionPlan[];
      foods: BackupFood[];
      meals: BackupMeal[];
      mealItems: BackupMealItem[];
    }>();
  });
});

function invalid(message: string): never {
  throw new Error(message);
}

function expectInvalidBackup(action: () => unknown): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) throw new Error('expected backup validation to fail');
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(TypeError);
}

function serializedPlan(plan: NutritionPlan): NutritionBackupSection {
  return serializeNutritionSection({
    nutritionPlans: [plan],
    foods: [],
    meals: [],
    mealItems: [],
  });
}

function rebuildPlan(
  plan: NutritionPlan,
  edit: (draft: NutritionPlanDraft) => void,
): NutritionPlan {
  const { eligibilityBlockers: _stored, ...safetyInputs } = plan.safetyInputs;
  void _stored;
  const draft: NutritionPlanDraft = {
    effectiveFrom: plan.effectiveFrom,
    goals: { ...plan.goals },
    safetyInputs: structuredClone(safetyInputs),
    equationInputs: {
      equationBranch: plan.equationInputs.equationBranch,
      activityInputs: structuredClone(plan.equationInputs.activityInputs),
      activityCategoryLow: plan.equationInputs.activityCategoryLow,
      activityCategoryHigh: plan.equationInputs.activityCategoryHigh,
    },
  };
  edit(draft);
  return buildNutritionPlan(draft, { autoTargetsEnabled: true, now: plan.updatedAt });
}

describe('parseNutritionSection', () => {
  test('拒绝断言 helper 不会吞掉自己的未抛错失败', () => {
    expect(() => expectInvalidBackup(() => undefined)).toThrow(
      'expected backup validation to fail',
    );
  });

  test.each([
    [0, legacyBackupV0Fixture],
    [1, legacyBackupV1Fixture],
    [2, legacyBackupV2Fixture],
  ] as const)('v%i 真实旧 schema 缺少营养字段时归一为空数组', (version, fixture) => {
    expect(parseNutritionSection(fixture(), version, invalid)).toEqual(
      EMPTY_NUTRITION_BACKUP,
    );
  });

  test.each([-1, 2.5, 4, Number.NaN])('拒绝不属于 v0-v3 的 schemaVersion %s', (version) => {
    expectInvalidBackup(() =>
      parseNutritionSection(nutritionBackupSectionFixture(), version, invalid),
    );
  });

  test('v3 从完整备份根解析白名单数据并保持引用完整', () => {
    const expected = nutritionBackupSectionFixture();
    const v3Root = {
      ...legacyBackupV2Fixture(),
      schemaVersion: 3,
      ...structuredClone(expected),
    };

    const parsed = parseNutritionSection(v3Root, 3, invalid);

    expect(parsed).toEqual(expected);
    expect(parsed).not.toBe(v3Root);
    expect(parsed.nutritionPlans[0]).not.toBe(v3Root.nutritionPlans[0]);
    expect(parsed.foods[0]).not.toBe(v3Root.foods[0]);
    expect(parsed.mealItems[0]).not.toBe(v3Root.mealItems[0]);
  });

  test('蛋白质政策来源和版本逐字段往返，未知值拒绝', () => {
    const valid = nutritionBackupSectionFixture();
    const parsed = parseNutritionSection(valid, 3, invalid);
    expect(parsed.nutritionPlans[0]).toMatchObject({
      proteinPolicySource: 'ISSN',
      proteinPolicyVersion: 'JISSN-2017-14-20',
    });

    for (const [field, value] of [
      ['proteinPolicySource', 'unknown-source'],
      ['proteinPolicyVersion', 'latest'],
    ] as const) {
      const forged = nutritionBackupSectionFixture();
      Object.assign(forged.nutritionPlans[0] as unknown as Record<string, unknown>, {
        [field]: value,
      });
      expect(() => parseNutritionSection(forged, 3, invalid)).toThrow('蛋白质政策');
    }
  });

  test('core 合法 point 计划保留 calculatedAt 基准并真实 serialize → parse 往返', () => {
    const plan = activePointNutritionPlanRow();
    const baseline = plan.equationInputs.calculatedAt;
    expect(baseline).toBe(plan.updatedAt);
    expect(() => assertNutritionPlanSemantics(plan)).not.toThrow();

    const serialized = serializedPlan(plan);

    expect(serialized.nutritionPlans[0].equationInputs.calculatedAt).toBe(baseline);
    expect(serialized.nutritionPlans[0].equationInputs.activityCategoryHigh).toBeNull();
    expect(serialized.nutritionPlans[0].targetMode.energy).toBe('point');
    expect(parseNutritionSection(serialized, 3, invalid)).toEqual(serialized);
  });

  test('core 合法的 18 岁仅增肌与超速已阻断计划都可往返', () => {
    const base = activeRangeNutritionPlanRow();
    const proteinOnly = rebuildPlan(base, (draft) => {
      draft.goals = { muscleGain: true, fatLoss: false };
      draft.safetyInputs.ageYears = 18;
      draft.safetyInputs.targetWeightKg = null;
      draft.safetyInputs.targetLossKgPerWeek = null;
      draft.safetyInputs.targetDate = null;
    });
    expect(proteinOnly.targetMode).toMatchObject({ protein: 'range', energy: 'disabled' });
    expect(proteinOnly.safetyInputs.eligibilityBlockers).not.toContain(
      'energy-age-under-19',
    );
    expect(() => parseNutritionSection(serializedPlan(proteinOnly), 3, invalid)).not.toThrow();

    const speedBlocked = rebuildPlan(base, (draft) => {
      draft.goals = { muscleGain: false, fatLoss: true };
      draft.safetyInputs.basisWeightKg = 80;
      draft.safetyInputs.basisWeightDate = '2026-08-14';
      draft.safetyInputs.targetWeightKg = 72;
      draft.safetyInputs.targetDate = '2026-11-13';
      draft.safetyInputs.targetLossKgPerWeek = impliedWeeklyLossKg(
        80,
        72,
        '2026-08-14',
        '2026-11-13',
      );
    });
    expect(speedBlocked.safetyInputs.targetLossKgPerWeek).toBeGreaterThan(0.5);
    expect(speedBlocked.safetyInputs.eligibilityBlockers).toContain(
      'speed-or-six-month-limit',
    );
    expect(speedBlocked.targetMode.energy).toBe('disabled');
    expect(() => parseNutritionSection(serializedPlan(speedBlocked), 3, invalid)).not.toThrow();
  });

  test('core 合法的小数活动问卷数值和关闭自动目标计划都可往返', () => {
    const base = activeRangeNutritionPlanRow();
    const fractionalActivity = rebuildPlan(base, (draft) => {
      draft.equationInputs.activityInputs.stepsPerDay = 8_000.5;
      draft.equationInputs.activityInputs.trainingSessionsPerWeek = 4.5;
    });
    expect(() => assertNutritionPlanSemantics(fractionalActivity)).not.toThrow();
    expect(() =>
      parseNutritionSection(serializedPlan(fractionalActivity), 3, invalid),
    ).not.toThrow();

    const { eligibilityBlockers: _stored, ...safetyInputs } = base.safetyInputs;
    void _stored;
    const disabled = buildNutritionPlan(
      {
        effectiveFrom: base.effectiveFrom,
        goals: structuredClone(base.goals),
        safetyInputs: structuredClone(safetyInputs),
        equationInputs: {
          equationBranch: base.equationInputs.equationBranch,
          activityInputs: structuredClone(base.equationInputs.activityInputs),
          activityCategoryLow: base.equationInputs.activityCategoryLow,
          activityCategoryHigh: base.equationInputs.activityCategoryHigh,
        },
      },
      { autoTargetsEnabled: false, now: base.updatedAt },
    );
    expect(disabled.equationInputs.calculatedAt).toBeNull();
    expect(disabled.targetMode.reason).toBe('professional-review-pending');
    expect(() => parseNutritionSection(serializedPlan(disabled), 3, invalid)).not.toThrow();
  });

  test('v3 拒绝反向、跨级活动范围和 point 端点/mode 不一致', () => {
    const reversed = serializedPlan(activeRangeNutritionPlanRow());
    reversed.nutritionPlans[0].equationInputs.activityCategoryLow = 'active';
    reversed.nutritionPlans[0].equationInputs.activityCategoryHigh = 'low-active';
    expect(() => parseNutritionSection(reversed, 3, invalid)).toThrow(
      'adjacent and ascending',
    );

    const nonAdjacent = serializedPlan(activeRangeNutritionPlanRow());
    nonAdjacent.nutritionPlans[0].equationInputs.activityCategoryLow = 'inactive';
    nonAdjacent.nutritionPlans[0].equationInputs.activityCategoryHigh = 'active';
    expect(() => parseNutritionSection(nonAdjacent, 3, invalid)).toThrow(
      'adjacent and ascending',
    );

    const unequalMaintenance = serializedPlan(activePointNutritionPlanRow());
    unequalMaintenance.nutritionPlans[0].equationInputs.maintenanceEnergyHighKcal! += 1;
    expectInvalidBackup(() => parseNutritionSection(unequalMaintenance, 3, invalid));

    const wrongMode = serializedPlan(activePointNutritionPlanRow());
    wrongMode.nutritionPlans[0].targetMode.energy = 'range';
    expect(() => parseNutritionSection(wrongMode, 3, invalid)).toThrow(
      'canonical policy',
    );

    const unequalTarget = serializedPlan(activePointNutritionPlanRow());
    unequalTarget.nutritionPlans[0].targetRanges.energyRawHighKcal! += 1;
    expect(() => parseNutritionSection(unequalTarget, 3, invalid)).toThrow(
      'canonical policy',
    );
  });

  test('v3 将 hostile 非规范减重速率交给唯一 core 语义门拒绝', () => {
    for (const value of [0.5001, 0.4999]) {
      const forged = serializedPlan(activeRangeNutritionPlanRow());
      forged.nutritionPlans[0].safetyInputs.targetLossKgPerWeek = value;
      expect(() => parseNutritionSection(forged, 3, invalid)).toThrow(
        'targetLossKgPerWeek disagrees',
      );
    }
  });

  test('v3 拒绝所有越界或门禁不一致的 active 计划', () => {
    const mutations: Array<(section: NutritionBackupSection) => void> = [
      (section) => {
        section.nutritionPlans[0].safetyInputs.ageYears = 121;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.ageYears = 30.5;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.heightCm = 99;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.basisWeightKg = 300.01;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.targetLossKgPerWeek = 20.01;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.basisWeightDate = '2026-08-15';
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.targetDate = '2026-08-14';
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.targetWeightKg =
          section.nutritionPlans[0].safetyInputs.basisWeightKg;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.basisWeightKg = 73.19;
        section.nutritionPlans[0].safetyInputs.heightCm = 175;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.targetWeightKg = 56.65;
        section.nutritionPlans[0].safetyInputs.heightCm = 175;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.targetWeightKg =
          section.nutritionPlans[0].safetyInputs.basisWeightKg! * 0.8999;
      },
      (section) => {
        section.nutritionPlans[0].equationInputs.activityInputs.stepsPerDay = 100_001;
      },
      (section) => {
        section.nutritionPlans[0].equationInputs.activityInputs.trainingSessionsPerWeek = 14.01;
      },
      (section) => {
        section.nutritionPlans[0].equationInputs.calculatedAt = Number.MAX_SAFE_INTEGER + 1;
      },
    ];

    for (const mutate of mutations) {
      const malicious = serializedPlan(activeRangeNutritionPlanRow());
      mutate(malicious);
      expectInvalidBackup(() => parseNutritionSection(malicious, 3, invalid));
    }
  });

  test('v3 逐字段拒绝计划未知字段、枚举、日期、非有限数值和版本漂移', () => {
    const mutations: Array<(section: NutritionBackupSection) => void> = [
      (section) => {
        Object.assign(section.nutritionPlans[0].goals as unknown as Record<string, unknown>, {
          maintenance: true,
        });
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.ageYears = Number.POSITIVE_INFINITY;
      },
      (section) => {
        section.nutritionPlans[0].safetyInputs.basisWeightDate = '2026/08/14';
      },
      (section) => {
        Object.assign(
          section.nutritionPlans[0].safetyInputs as unknown as Record<string, unknown>,
          { proteinWeightMethod: 'guessed-weight' },
        );
      },
      (section) => {
        Object.assign(
          section.nutritionPlans[0].equationInputs.activityInputs as unknown as Record<
            string,
            unknown
          >,
          { assessmentStatus: 'partial' },
        );
      },
      (section) => {
        Object.assign(
          section.nutritionPlans[0].equationInputs.activityInputs as unknown as Record<
            string,
            unknown
          >,
          { occupation: 'space-walk' },
        );
      },
      (section) => {
        Object.assign(
          section.nutritionPlans[0].equationInputs.activityInputs as unknown as Record<
            string,
            unknown
          >,
          { trainingIntensity: 'maximum' },
        );
      },
      (section) => {
        Object.assign(
          section.nutritionPlans[0].equationInputs as unknown as Record<string, unknown>,
          { equationBranch: 'other' },
        );
      },
      (section) => {
        Object.assign(
          section.nutritionPlans[0].equationInputs as unknown as Record<string, unknown>,
          { activityCategoryLow: 'sedentary' },
        );
      },
      (section) => {
        Object.assign(
          section.nutritionPlans[0].targetMode as unknown as Record<string, unknown>,
          { protein: 'point' },
        );
      },
      (section) => {
        section.nutritionPlans[0].standardVersion = 'latest';
      },
      (section) => {
        section.nutritionPlans[0].equationVersion = 'latest';
      },
      (section) => {
        section.nutritionPlans[0].sourceVersion = 'latest';
      },
    ];

    for (const mutate of mutations) {
      const forged = nutritionBackupSectionFixture();
      mutate(forged);
      expectInvalidBackup(() => parseNutritionSection(forged, 3, invalid));
    }
  });

  test('v3 拒绝未知字段、软删/时间戳实现字段和原型污染字段', () => {
    const rowMutations: Array<(section: NutritionBackupSection) => void> = [
      (section) => {
        Object.assign(section.nutritionPlans[0], { updatedAt: 1 });
      },
      (section) => {
        Object.assign(section.foods[0], { preset: false, deletedAt: null });
      },
      (section) => {
        Object.assign(section.meals[0], { privateFutureField: 'leak' });
      },
      (section) => {
        Object.assign(section.mealItems[0], { updatedAt: 1 });
      },
    ];
    for (const mutate of rowMutations) {
      const forged = nutritionBackupSectionFixture();
      mutate(forged);
      expect(() => parseNutritionSection(forged, 3, invalid)).toThrow('未知字段');
    }

    const ownPrototypeKey = nutritionBackupSectionFixture();
    Object.defineProperty(ownPrototypeKey.meals[0], '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });
    expect(() => parseNutritionSection(ownPrototypeKey, 3, invalid)).toThrow('未知字段');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const inherited = nutritionBackupSectionFixture();
    Object.setPrototypeOf(inherited.foods[0], { inheritedSecret: 'must-not-survive' });
    const parsed = parseNutritionSection(inherited, 3, invalid);
    expect(parsed.foods[0]).not.toHaveProperty('inheritedSecret');
    expect(Object.getPrototypeOf(parsed.foods[0])).toBe(Object.prototype);
  });

  test('v3 拒绝错误确定性 ID、保留 food/custom 与 meal-item 命名空间', () => {
    const mutations: Array<(section: NutritionBackupSection) => void> = [
      (section) => {
        section.nutritionPlans[0].id = 'nutrition-plan:2026-08-13';
      },
      (section) => {
        section.meals[0].id = 'meal:2026-08-13:lunch';
      },
      (section) => {
        section.foods[0].id = 'food:preset:rice-cooked';
      },
      (section) => {
        section.foods[0].id = 'food:custom:../preset';
      },
      (section) => {
        section.mealItems[0].id = 'meal-item:../one';
      },
    ];
    for (const mutate of mutations) {
      const forged = nutritionBackupSectionFixture();
      mutate(forged);
      expectInvalidBackup(() => parseNutritionSection(forged, 3, invalid));
    }
  });

  test('v3 拒绝四类重复业务键、日期餐次碰撞和孤儿条目', () => {
    const duplicateMutations: Array<(section: NutritionBackupSection) => void> = [
      (section) => {
        section.nutritionPlans.push(structuredClone(section.nutritionPlans[0]));
      },
      (section) => {
        section.foods.push(structuredClone(section.foods[0]));
      },
      (section) => {
        section.meals.push(structuredClone(section.meals[0]));
      },
      (section) => {
        section.mealItems.push(structuredClone(section.mealItems[0]));
      },
    ];
    for (const mutate of duplicateMutations) {
      const duplicate = nutritionBackupSectionFixture();
      mutate(duplicate);
      expect(() => parseNutritionSection(duplicate, 3, invalid)).toThrow('重复值');
    }

    const orphan = nutritionBackupSectionFixture();
    orphan.mealItems[0].mealId = 'meal:2026-08-14:dinner';
    expect(() => parseNutritionSection(orphan, 3, invalid)).toThrow(
      '引用了不存在的餐次',
    );
  });

  test('v3 拒绝食物/FDC、来源和归一化合同损坏', () => {
    const mutations: Array<(section: NutritionBackupSection) => void> = [
      (section) => {
        section.foods[0].originalEnergyValue = -1;
      },
      (section) => {
        section.foods[0].originalBasisAmount = 0;
      },
      (section) => {
        section.foods[0].ediblePortionRatio = 0;
      },
      (section) => {
        section.foods[0].densityGPerMl = 100.01;
      },
      (section) => {
        section.foods[0].energyKcal = 999;
      },
      (section) => {
        section.foods[0].fdcId = 168878;
      },
      (section) => {
        section.foods[0].fdcId = 168878;
        section.foods[0].fdcDataType = 'SR Legacy';
      },
      (section) => {
        Object.assign(section.foods[0] as unknown as Record<string, unknown>, {
          fdcDataType: 'Experimental',
        });
      },
      (section) => {
        section.foods[0].source = '';
      },
      (section) => {
        section.foods[0].license = 'x'.repeat(501);
      },
      (section) => {
        section.foods[0].aliases = new Array(31).fill('alias');
      },
      (section) => {
        section.foods[0].conversionAssumptions = ['x'.repeat(501)];
      },
    ];
    for (const mutate of mutations) {
      const forged = nutritionBackupSectionFixture();
      mutate(forged);
      expectInvalidBackup(() => parseNutritionSection(forged, 3, invalid));
    }
  });

  test('v3 接受成组且带真实日历日期的 FDC 元数据', () => {
    const validFdc = nutritionBackupSectionFixture();
    Object.assign(validFdc.foods[0], {
      fdcId: 168878,
      fdcDataType: 'SR Legacy' as const,
      sourceRetrievedAt: '2026-08-14',
    });
    Object.assign(validFdc.mealItems[0], {
      fdcId: 168878,
      fdcDataType: 'SR Legacy' as const,
      sourceRetrievedAt: '2026-08-14',
    });

    expect(parseNutritionSection(validFdc, 3, invalid)).toEqual(validFdc);
  });

  test('v3 接受非 FDC 来源独立记录真实获取日期', () => {
    const datedNonFdc = nutritionBackupSectionFixture();
    datedNonFdc.foods[0].sourceRetrievedAt = '2026-08-14';
    datedNonFdc.mealItems[0].sourceRetrievedAt = '2026-08-14';

    expect(parseNutritionSection(datedNonFdc, 3, invalid)).toEqual(datedNonFdc);
  });

  test('v3 拒绝 MealItem 数值、枚举、时间戳与点估计合同损坏', () => {
    const mutations: Array<(section: NutritionBackupSection) => void> = [
      (section) => {
        section.mealItems[0].amount = 0;
      },
      (section) => {
        section.mealItems[0].energyKcalHigh = Number.POSITIVE_INFINITY;
      },
      (section) => {
        section.mealItems[0].energyKcalLow = 361;
      },
      (section) => {
        section.mealItems[0].proteinGHigh = 17;
      },
      (section) => {
        section.mealItems[0].energyKcalLow = 0;
        section.mealItems[0].energyKcalHigh = 300;
      },
      (section) => {
        Object.assign(section.mealItems[0] as unknown as Record<string, unknown>, {
          unit: 'oz',
        });
      },
      (section) => {
        Object.assign(section.mealItems[0] as unknown as Record<string, unknown>, {
          method: 'imported',
        });
      },
      (section) => {
        Object.assign(section.mealItems[0] as unknown as Record<string, unknown>, {
          quality: 'C',
        });
      },
      (section) => {
        section.mealItems[0].confirmedAt = 1.5;
      },
      (section) => {
        section.mealItems[0].confirmedAt = Number.MAX_SAFE_INTEGER + 1;
      },
      (section) => {
        section.mealItems[0].order = 10_001;
      },
      (section) => {
        section.mealItems[0].order = 1.5;
      },
    ];
    for (const mutate of mutations) {
      const forged = nutritionBackupSectionFixture();
      mutate(forged);
      expectInvalidBackup(() => parseNutritionSection(forged, 3, invalid));
    }
  });

  test('v3 限制四类数组长度并拒绝缺失或非数组 section', () => {
    for (const [field, maximum] of [
      ['nutritionPlans', 3_660],
      ['foods', 5_000],
      ['meals', 36_600],
      ['mealItems', 200_000],
    ] as const) {
      const forged = nutritionBackupSectionFixture() as unknown as Record<string, unknown>;
      forged[field] = new Array(maximum + 1).fill(null);
      expect(() => parseNutritionSection(forged, 3, invalid)).toThrow('数量超出范围');
    }

    for (const value of [null, 'bad', [], { nutritionPlans: [] }]) {
      expectInvalidBackup(() => parseNutritionSection(value, 3, invalid));
    }
  });

  test.each([
    [
      '顶层稀疏数组',
      () => {
        const forged = nutritionBackupSectionFixture();
        forged.foods = new Array<BackupFood>(1);
        return forged;
      },
    ],
    [
      '嵌套稀疏数组',
      () => {
        const forged = nutritionBackupSectionFixture();
        forged.nutritionPlans[0].equationInputs.activityInputs.trainingTypes =
          new Array(1);
        return forged;
      },
    ],
    [
      '原型继承索引数组',
      () => {
        const forged = nutritionBackupSectionFixture();
        const inherited = new Array<BackupFood>(1);
        const prototype = Object.create(Array.prototype) as BackupFood[];
        Object.defineProperty(prototype, '0', {
          value: forged.foods[0],
          enumerable: true,
        });
        Object.setPrototypeOf(inherited, prototype);
        forged.foods = inherited;
        return forged;
      },
    ],
  ] as const)('v3 拒绝%s中的非 own 元素', (_label, fixture) => {
    expectInvalidBackup(() => parseNutritionSection(fixture(), 3, invalid));
  });
});
