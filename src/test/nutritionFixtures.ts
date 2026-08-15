import type {
  Food,
  Meal,
  MealEstimate,
  MealItem,
  MealPhoto,
  NutritionPlan,
} from '../lib/nutritionTypes';

const FIXED_TIME = 1723568400000;

export function nutritionPlanRow(overrides: Partial<NutritionPlan> = {}): NutritionPlan {
  return {
    id: 'nutrition-plan:2026-08-14',
    effectiveFrom: '2026-08-14',
    goals: { muscleGain: true, fatLoss: true },
    safetyInputs: {
      basisWeightKg: 80,
      basisWeightDate: '2026-08-14',
      proteinWeightMethod: 'current-weight',
      ageYears: 30,
      heightCm: 175,
      targetWeightKg: 72,
      targetLossKgPerWeek: 0.5,
      targetDate: '2026-12-04',
      highBodyFatOrObesity: false,
      pregnantOrBreastfeeding: false,
      requiresTherapeuticDiet: false,
      kidneyDiseaseOrComplexCondition: false,
      eatingDisorderOrRedsRisk: false,
      athleteOrExtremeActivity: false,
      eligibilityStandard: 'WS/T 428—2013',
      eligibilityBlockers: [],
    },
    standardVersion: 'WS/T-428-2013',
    equationInputs: {
      equationName: 'NASEM-2023-adult-EER',
      equationBranch: 'female',
      activityInputs: {
        assessmentStatus: 'complete',
        occupation: 'mixed',
        activeCommuteMinutesPerDay: 30,
        householdMinutesPerDay: 30,
        stepsPerDay: 8000,
        trainingTypes: ['resistance', 'cardio'],
        trainingSessionsPerWeek: 4,
        trainingMinutesPerSession: 60,
        trainingIntensity: 'moderate',
      },
      activityCategoryLow: 'low-active',
      activityCategoryHigh: 'active',
      maintenanceEnergyLowKcal: 2491.67,
      maintenanceEnergyHighKcal: 2631.65,
      calculatedAt: FIXED_TIME,
    },
    equationVersion: 'NASEM-2023-adult-EER',
    targetRanges: {
      proteinLowG: 110,
      proteinHighG: 160,
      proteinReferenceG: 130,
      proteinLowCoefficient: 1.4,
      proteinHighCoefficient: 2,
      proteinReferenceCoefficient: 1.6,
      energyLowKcal: 2000,
      energyHighKcal: 2150,
      energyRawLowKcal: 1993.336,
      energyRawHighKcal: 2131.65,
    },
    targetMode: {
      protein: 'range',
      energy: 'range',
      evaluationPolicy: 'protein-range-and-energy-relative',
      autoTargetsEnabled: true,
      reason: 'active',
    },
    sourceVersion: 'tiezheng-local-nutrition-v1',
    proteinPolicySource: 'ISSN',
    proteinPolicyVersion: 'JISSN-2017-14-20',
    updatedAt: FIXED_TIME,
    deletedAt: null,
    ...overrides,
  };
}

export function foodRow(overrides: Partial<Food> = {}): Food {
  return {
    id: 'food:preset:usda:168878',
    name: '熟米饭',
    aliases: ['米饭'],
    rawOrCooked: 'cooked',
    preparation: '蒸煮',
    originalEnergyValue: 130,
    originalEnergyUnit: 'kcal',
    originalProteinG: 2.69,
    originalBasisAmount: 100,
    originalBasisUnit: 'g',
    basisAmount: 100,
    basisUnit: 'g',
    energyKcal: 130,
    proteinG: 2.69,
    ediblePortionRatio: 1,
    densityGPerMl: null,
    conversionAssumptions: ['USDA cooked edible portion already reported per 100 g'],
    fdcId: 168878,
    fdcDataType: 'SR Legacy',
    sourceRetrievedAt: '2026-08-14',
    source: 'USDA FoodData Central FDC 168878',
    sourceVersion: 'USDA-FDC-SR-Legacy-2019-04-01',
    license: 'CC0 1.0',
    preset: true,
    updatedAt: FIXED_TIME,
    deletedAt: null,
    ...overrides,
  };
}

export function mealRow(overrides: Partial<Meal> = {}): Meal {
  return {
    id: 'meal:2026-08-14:lunch',
    date: '2026-08-14',
    slot: 'lunch',
    updatedAt: FIXED_TIME,
    deletedAt: null,
    ...overrides,
  };
}

export function mealItemRow(overrides: Partial<MealItem> = {}): MealItem {
  return {
    id: 'meal-item:fixture-1',
    mealId: 'meal:2026-08-14:lunch',
    name: '熟米饭',
    preparation: '蒸煮',
    amount: 150,
    unit: 'g',
    originalEnergyValue: 130,
    originalEnergyUnit: 'kcal',
    originalProteinG: 2.69,
    originalBasisAmount: 100,
    originalBasisUnit: 'g',
    basisAmount: 100,
    basisUnit: 'g',
    ediblePortionRatio: 1,
    densityGPerMl: null,
    conversionAssumptions: ['USDA cooked edible portion already reported per 100 g'],
    fdcId: 168878,
    fdcDataType: 'SR Legacy',
    sourceRetrievedAt: '2026-08-14',
    source: 'USDA FoodData Central FDC 168878',
    sourceVersion: 'USDA-FDC-SR-Legacy-2019-04-01',
    license: 'CC0 1.0',
    energyKcal: 130,
    proteinG: 2.69,
    energyKcalLow: 195,
    energyKcalHigh: 195,
    proteinGLow: 4.035,
    proteinGHigh: 4.035,
    assumptions: ['用户确认可食部 g'],
    uncertaintyModelVersion: 'exact-measured-v1',
    method: 'preset',
    quality: 'A',
    confirmedAt: FIXED_TIME,
    order: 0,
    updatedAt: FIXED_TIME,
    deletedAt: null,
    ...overrides,
  };
}

export function mealPhotoRow(overrides: Partial<MealPhoto> = {}): MealPhoto {
  const thumbnail = new Blob(
    [new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])],
    { type: 'image/webp' },
  );
  return {
    id: 'meal-photo:meal:2026-08-14:lunch',
    mealId: 'meal:2026-08-14:lunch',
    thumbnail,
    size: thumbnail.size,
    width: 1,
    height: 1,
    mealSnapshotHash: 'a'.repeat(64),
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

export function mealEstimateRow(overrides: Partial<MealEstimate> = {}): MealEstimate {
  return {
    id: 'meal-estimate:meal:2026-08-14:lunch',
    mealId: 'meal:2026-08-14:lunch',
    status: 'needs-confirmation',
    requestId: 'request-fixture-1',
    requestFingerprint: 'b'.repeat(64),
    candidates: [
      {
        id: 'candidate-fixture-1',
        name: '熟米饭',
        preparation: '蒸煮',
        amountLow: 120,
        amountHigh: 180,
        unit: 'g',
        catalogFoodId: 'food:preset:usda:168878',
      },
    ],
    consent: {
      uploadBlobSha256: 'c'.repeat(64),
      requestId: 'request-fixture-1',
      providerPolicyVersion: 'photo-estimate-consent-v1',
      consentedAt: FIXED_TIME,
      expiresAt: FIXED_TIME + 15 * 60 * 1000,
    },
    error: null,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}
