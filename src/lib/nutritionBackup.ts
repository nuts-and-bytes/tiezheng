import type { Food, Meal, MealItem, NutritionPlan } from './nutritionTypes';

export interface BackupNutritionPlan {
  id: string;
  effectiveFrom: string;
  goals: NutritionPlan['goals'];
  safetyInputs: NutritionPlan['safetyInputs'];
  standardVersion: string;
  equationInputs: NutritionPlan['equationInputs'];
  equationVersion: string;
  targetRanges: NutritionPlan['targetRanges'];
  targetMode: NutritionPlan['targetMode'];
  sourceVersion: string;
  proteinPolicySource: NutritionPlan['proteinPolicySource'];
  proteinPolicyVersion: NutritionPlan['proteinPolicyVersion'];
}

export interface BackupFood {
  id: string;
  name: string;
  aliases: string[];
  rawOrCooked: 'raw' | 'cooked' | 'not-applicable';
  preparation: string;
  originalEnergyValue: number;
  originalEnergyUnit: 'kcal' | 'kJ';
  originalProteinG: number;
  originalBasisAmount: number;
  originalBasisUnit: 'g' | 'mL';
  basisAmount: number;
  basisUnit: 'g' | 'mL';
  energyKcal: number;
  proteinG: number;
  ediblePortionRatio: number;
  densityGPerMl: number | null;
  conversionAssumptions: string[];
  fdcId: number | null;
  fdcDataType: Food['fdcDataType'];
  sourceRetrievedAt: string | null;
  source: string;
  sourceVersion: string;
  license: string;
}

export interface BackupMeal {
  id: string;
  date: string;
  slot: Meal['slot'];
}

export interface BackupMealItem {
  id: string;
  mealId: string;
  name: string;
  preparation: string;
  amount: number;
  unit: 'g' | 'mL';
  originalEnergyValue: number;
  originalEnergyUnit: 'kcal' | 'kJ';
  originalProteinG: number;
  originalBasisAmount: number;
  originalBasisUnit: 'g' | 'mL';
  energyKcal: number;
  proteinG: number;
  energyKcalLow: number;
  energyKcalHigh: number;
  proteinGLow: number;
  proteinGHigh: number;
  assumptions: string[];
  uncertaintyModelVersion: string;
  basisAmount: number;
  basisUnit: 'g' | 'mL';
  ediblePortionRatio: number;
  densityGPerMl: number | null;
  conversionAssumptions: string[];
  fdcId: number | null;
  fdcDataType: MealItem['fdcDataType'];
  sourceRetrievedAt: string | null;
  source: string;
  sourceVersion: string;
  license: string;
  method: MealItem['method'];
  quality: MealItem['quality'];
  confirmedAt: number;
  order: number;
}

export interface NutritionBackupSection {
  nutritionPlans: BackupNutritionPlan[];
  foods: BackupFood[];
  meals: BackupMeal[];
  mealItems: BackupMealItem[];
}

export interface NutritionExportRows {
  nutritionPlans: NutritionPlan[];
  foods: Food[];
  meals: Meal[];
  mealItems: MealItem[];
}

export const EMPTY_NUTRITION_BACKUP: NutritionBackupSection = {
  nutritionPlans: [],
  foods: [],
  meals: [],
  mealItems: [],
};

export function serializeNutritionSection(rows: NutritionExportRows): NutritionBackupSection {
  const nutritionPlans = rows.nutritionPlans
    .filter((row) => row.deletedAt === null)
    .map((row): BackupNutritionPlan => ({
      id: row.id,
      effectiveFrom: row.effectiveFrom,
      goals: {
        muscleGain: row.goals.muscleGain,
        fatLoss: row.goals.fatLoss,
      },
      safetyInputs: {
        basisWeightKg: row.safetyInputs.basisWeightKg,
        basisWeightDate: row.safetyInputs.basisWeightDate,
        proteinWeightMethod: row.safetyInputs.proteinWeightMethod,
        ageYears: row.safetyInputs.ageYears,
        heightCm: row.safetyInputs.heightCm,
        targetWeightKg: row.safetyInputs.targetWeightKg,
        targetLossKgPerWeek: row.safetyInputs.targetLossKgPerWeek,
        targetDate: row.safetyInputs.targetDate,
        highBodyFatOrObesity: row.safetyInputs.highBodyFatOrObesity,
        pregnantOrBreastfeeding: row.safetyInputs.pregnantOrBreastfeeding,
        requiresTherapeuticDiet: row.safetyInputs.requiresTherapeuticDiet,
        kidneyDiseaseOrComplexCondition: row.safetyInputs.kidneyDiseaseOrComplexCondition,
        eatingDisorderOrRedsRisk: row.safetyInputs.eatingDisorderOrRedsRisk,
        athleteOrExtremeActivity: row.safetyInputs.athleteOrExtremeActivity,
        eligibilityStandard: row.safetyInputs.eligibilityStandard,
        eligibilityBlockers: [...row.safetyInputs.eligibilityBlockers],
      },
      standardVersion: row.standardVersion,
      equationInputs: {
        equationName: row.equationInputs.equationName,
        equationBranch: row.equationInputs.equationBranch,
        activityInputs: {
          assessmentStatus: row.equationInputs.activityInputs.assessmentStatus,
          occupation: row.equationInputs.activityInputs.occupation,
          activeCommuteMinutesPerDay:
            row.equationInputs.activityInputs.activeCommuteMinutesPerDay,
          householdMinutesPerDay: row.equationInputs.activityInputs.householdMinutesPerDay,
          stepsPerDay: row.equationInputs.activityInputs.stepsPerDay,
          trainingTypes: [...row.equationInputs.activityInputs.trainingTypes],
          trainingSessionsPerWeek: row.equationInputs.activityInputs.trainingSessionsPerWeek,
          trainingMinutesPerSession:
            row.equationInputs.activityInputs.trainingMinutesPerSession,
          trainingIntensity: row.equationInputs.activityInputs.trainingIntensity,
        },
        activityCategoryLow: row.equationInputs.activityCategoryLow,
        activityCategoryHigh: row.equationInputs.activityCategoryHigh,
        maintenanceEnergyLowKcal: row.equationInputs.maintenanceEnergyLowKcal,
        maintenanceEnergyHighKcal: row.equationInputs.maintenanceEnergyHighKcal,
        calculatedAt: row.equationInputs.calculatedAt,
      },
      equationVersion: row.equationVersion,
      targetRanges: {
        proteinLowG: row.targetRanges.proteinLowG,
        proteinHighG: row.targetRanges.proteinHighG,
        proteinReferenceG: row.targetRanges.proteinReferenceG,
        proteinLowCoefficient: row.targetRanges.proteinLowCoefficient,
        proteinHighCoefficient: row.targetRanges.proteinHighCoefficient,
        proteinReferenceCoefficient: row.targetRanges.proteinReferenceCoefficient,
        energyLowKcal: row.targetRanges.energyLowKcal,
        energyHighKcal: row.targetRanges.energyHighKcal,
        energyRawLowKcal: row.targetRanges.energyRawLowKcal,
        energyRawHighKcal: row.targetRanges.energyRawHighKcal,
      },
      targetMode: {
        protein: row.targetMode.protein,
        energy: row.targetMode.energy,
        evaluationPolicy: row.targetMode.evaluationPolicy,
        autoTargetsEnabled: row.targetMode.autoTargetsEnabled,
        reason: row.targetMode.reason,
      },
      sourceVersion: row.sourceVersion,
      proteinPolicySource: row.proteinPolicySource,
      proteinPolicyVersion: row.proteinPolicyVersion,
    }))
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  const foods = rows.foods
    .filter((row) => row.deletedAt === null && !row.preset)
    .map((row): BackupFood => ({
      id: row.id,
      name: row.name,
      aliases: [...row.aliases],
      rawOrCooked: row.rawOrCooked,
      preparation: row.preparation,
      originalEnergyValue: row.originalEnergyValue,
      originalEnergyUnit: row.originalEnergyUnit,
      originalProteinG: row.originalProteinG,
      originalBasisAmount: row.originalBasisAmount,
      originalBasisUnit: row.originalBasisUnit,
      basisAmount: row.basisAmount,
      basisUnit: row.basisUnit,
      energyKcal: row.energyKcal,
      proteinG: row.proteinG,
      ediblePortionRatio: row.ediblePortionRatio,
      densityGPerMl: row.densityGPerMl,
      conversionAssumptions: [...row.conversionAssumptions],
      fdcId: row.fdcId,
      fdcDataType: row.fdcDataType,
      sourceRetrievedAt: row.sourceRetrievedAt,
      source: row.source,
      sourceVersion: row.sourceVersion,
      license: row.license,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const meals = rows.meals
    .filter((row) => row.deletedAt === null)
    .map((row): BackupMeal => ({ id: row.id, date: row.date, slot: row.slot }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const activeMealIds = new Set(meals.map((row) => row.id));

  const mealItems = rows.mealItems
    .filter((row) => row.deletedAt === null && activeMealIds.has(row.mealId))
    .map((row): BackupMealItem => ({
      id: row.id,
      mealId: row.mealId,
      name: row.name,
      preparation: row.preparation,
      amount: row.amount,
      unit: row.unit,
      originalEnergyValue: row.originalEnergyValue,
      originalEnergyUnit: row.originalEnergyUnit,
      originalProteinG: row.originalProteinG,
      originalBasisAmount: row.originalBasisAmount,
      originalBasisUnit: row.originalBasisUnit,
      energyKcal: row.energyKcal,
      proteinG: row.proteinG,
      energyKcalLow: row.energyKcalLow,
      energyKcalHigh: row.energyKcalHigh,
      proteinGLow: row.proteinGLow,
      proteinGHigh: row.proteinGHigh,
      assumptions: [...row.assumptions],
      uncertaintyModelVersion: row.uncertaintyModelVersion,
      basisAmount: row.basisAmount,
      basisUnit: row.basisUnit,
      ediblePortionRatio: row.ediblePortionRatio,
      densityGPerMl: row.densityGPerMl,
      conversionAssumptions: [...row.conversionAssumptions],
      fdcId: row.fdcId,
      fdcDataType: row.fdcDataType,
      sourceRetrievedAt: row.sourceRetrievedAt,
      source: row.source,
      sourceVersion: row.sourceVersion,
      license: row.license,
      method: row.method,
      quality: row.quality,
      confirmedAt: row.confirmedAt,
      order: row.order,
    }))
    .sort(
      (a, b) =>
        a.mealId.localeCompare(b.mealId) || a.order - b.order || a.id.localeCompare(b.id),
    );

  return { nutritionPlans, foods, meals, mealItems };
}
