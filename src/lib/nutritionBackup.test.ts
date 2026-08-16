import { describe, expect, expectTypeOf, test } from 'vitest';
import type { Food, Meal, MealItem, NutritionPlan } from './nutritionTypes';
import type {
  BackupFood,
  BackupMeal,
  BackupMealItem,
  BackupNutritionPlan,
  NutritionBackupSection,
} from './nutritionBackup';
import { EMPTY_NUTRITION_BACKUP, serializeNutritionSection } from './nutritionBackup';

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
