import type { NutritionBackupSection } from '../lib/nutritionBackup';
import type {
  Food,
  Meal,
  MealEstimate,
  MealItem,
  MealPhoto,
  NutritionPlan,
} from '../lib/nutritionTypes';
import { nutritionPlanRow as coreNutritionPlanRow } from './nutritionFixtures';

const LEGACY_BASE = {
  exportedAt: '2026-07-20T08:00:00.000Z',
  workouts: [{ id: 'w-1', date: '2026-07-18', note: '背部日' }],
  workoutItems: [
    {
      id: 'wi-1',
      workoutId: 'w-1',
      exerciseId: 'custom-row',
      order: 0,
      sets: [{ weight: 40, reps: 12 }, { reps: 10 }],
    },
  ],
  weightLogs: [{ id: 'weight-1', date: '2026-07-18', weightKg: 72.5 }],
  profile: [{ id: 'me', weeklyGoal: 4, nickname: '铁人', onboarded: true }],
} as const;

/** Unversioned production backup: loadMode and archived did not exist yet. */
export function legacyBackupV0Fixture() {
  return {
    ...structuredClone(LEGACY_BASE),
    exercises: [
      {
        id: 'custom-row',
        name: '自创划船',
        bodyPart: 'back',
        preset: false,
      },
    ],
  };
}

/** Published v1 backup: loadMode is required; archived is still optional. */
export function legacyBackupV1Fixture() {
  return {
    ...structuredClone(LEGACY_BASE),
    schemaVersion: 1 as const,
    exercises: [
      {
        id: 'custom-row',
        name: '自创划船',
        bodyPart: 'back',
        loadMode: 'assistance',
        preset: false,
      },
    ],
  };
}

/** Current pre-nutrition v2 backup: loadMode and archived are both required. */
export function legacyBackupV2Fixture() {
  return {
    ...structuredClone(LEGACY_BASE),
    schemaVersion: 2 as const,
    exercises: [
      {
        id: 'custom-row',
        name: '自创划船',
        bodyPart: 'back',
        loadMode: 'assistance',
        preset: false,
        archived: false,
      },
    ],
  };
}

export const nutritionPlanRow = (): NutritionPlan => structuredClone(coreNutritionPlanRow());

export const activePointNutritionPlanRow = (): NutritionPlan => {
  const plan = nutritionPlanRow();
  plan.equationInputs.activityCategoryHigh = null;
  plan.equationInputs.maintenanceEnergyHighKcal =
    plan.equationInputs.maintenanceEnergyLowKcal;
  plan.targetRanges.energyHighKcal = plan.targetRanges.energyLowKcal;
  plan.targetRanges.energyRawHighKcal = plan.targetRanges.energyRawLowKcal;
  plan.targetMode.energy = 'point';
  return plan;
};

export const activeRangeNutritionPlanRow = (): NutritionPlan => nutritionPlanRow();

export const customFoodRow = (): Food => ({
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
});

export const presetFoodRow = (): Food => ({
  ...customFoodRow(),
  id: 'food:preset:rice-cooked',
  name: '熟米饭',
  preset: true,
});

export const mealRow = (): Meal => ({
  id: 'meal:2026-08-14:lunch',
  date: '2026-08-14',
  slot: 'lunch',
  updatedAt: 99,
  deletedAt: null,
});

export const mealItemRow = (): MealItem => ({
  id: 'meal-item:one',
  mealId: mealRow().id,
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
});

export const mealPhotoRow = (
  thumbnail: Blob = new Blob(['private']),
  mealSnapshotHash = 'different-hash',
): MealPhoto => ({
  id: `meal-photo:${mealRow().id}`,
  mealId: mealRow().id,
  thumbnail,
  size: thumbnail.size,
  width: 100,
  height: 100,
  mealSnapshotHash,
  updatedAt: 10,
});

export const mealEstimateRow = (): MealEstimate => ({
  id: `meal-estimate:${mealRow().id}`,
  mealId: mealRow().id,
  status: 'needs-confirmation',
  requestId: 'request:one',
  requestFingerprint: 'request-fingerprint-one',
  candidates: [],
  consent: null,
  error: null,
  updatedAt: 11,
});

export const nutritionBackupSectionFixture = (): NutritionBackupSection => {
  const plan = nutritionPlanRow();
  const food = customFoodRow();
  const meal = mealRow();
  const item = mealItemRow();
  return {
    nutritionPlans: [
      {
        id: plan.id,
        effectiveFrom: plan.effectiveFrom,
        goals: structuredClone(plan.goals),
        safetyInputs: structuredClone(plan.safetyInputs),
        standardVersion: plan.standardVersion,
        equationInputs: structuredClone(plan.equationInputs),
        equationVersion: plan.equationVersion,
        targetRanges: structuredClone(plan.targetRanges),
        targetMode: structuredClone(plan.targetMode),
        sourceVersion: plan.sourceVersion,
        proteinPolicySource: plan.proteinPolicySource,
        proteinPolicyVersion: plan.proteinPolicyVersion,
      },
    ],
    foods: [
      {
        id: food.id,
        name: food.name,
        aliases: [...food.aliases],
        rawOrCooked: food.rawOrCooked,
        preparation: food.preparation,
        originalEnergyValue: food.originalEnergyValue,
        originalEnergyUnit: food.originalEnergyUnit,
        originalProteinG: food.originalProteinG,
        originalBasisAmount: food.originalBasisAmount,
        originalBasisUnit: food.originalBasisUnit,
        basisAmount: food.basisAmount,
        basisUnit: food.basisUnit,
        energyKcal: food.energyKcal,
        proteinG: food.proteinG,
        ediblePortionRatio: food.ediblePortionRatio,
        densityGPerMl: food.densityGPerMl,
        conversionAssumptions: [...food.conversionAssumptions],
        fdcId: food.fdcId,
        fdcDataType: food.fdcDataType,
        sourceRetrievedAt: food.sourceRetrievedAt,
        source: food.source,
        sourceVersion: food.sourceVersion,
        license: food.license,
      },
    ],
    meals: [{ id: meal.id, date: meal.date, slot: meal.slot }],
    mealItems: [
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
        assumptions: [...item.assumptions],
        uncertaintyModelVersion: item.uncertaintyModelVersion,
        basisAmount: item.basisAmount,
        basisUnit: item.basisUnit,
        ediblePortionRatio: item.ediblePortionRatio,
        densityGPerMl: item.densityGPerMl,
        conversionAssumptions: [...item.conversionAssumptions],
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
    ],
  };
};
