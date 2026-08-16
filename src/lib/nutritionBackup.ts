import { parseDate, toDateStr } from './dates';
import { normalizeFoodNutrients } from './foodNormalization';
import { assertNutritionPlanSemantics } from './nutritionPlanValidation';
import type {
  ActivityCategory,
  EquationBranch,
  Food,
  FoodDataType,
  Meal,
  MealItem,
  MealItemMethod,
  MealSlot,
  NutritionActivityInputs,
  NutritionEligibilityBlocker,
  NutritionEquationInputs,
  NutritionGoals,
  NutritionPlan,
  NutritionQuality,
  NutritionSafetyInputs,
  NutritionTargetMode,
  NutritionTargetRanges,
  TrainingType,
} from './nutritionTypes';

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

type InvalidBackup = (message: string) => never;
type UnknownObject = { [key: string]: unknown };

const SLOTS = new Set<MealSlot>(['breakfast', 'lunch', 'dinner', 'snack']);
const RAW_OR_COOKED = new Set<BackupFood['rawOrCooked']>([
  'raw',
  'cooked',
  'not-applicable',
]);
const BASIS_UNITS = new Set<BackupFood['basisUnit']>(['g', 'mL']);
const ENERGY_UNITS = new Set<BackupFood['originalEnergyUnit']>(['kcal', 'kJ']);
const FOOD_DATA_TYPES = new Set<FoodDataType>([
  'SR Legacy',
  'Foundation',
  'Survey (FNDDS)',
  'Branded',
]);
const METHODS = new Set<MealItemMethod>(['preset', 'manual', 'label', 'ai-confirmed']);
const QUALITIES = new Set<NutritionQuality>(['A', 'B']);
const EQUATION_BRANCHES = new Set<EquationBranch>(['female', 'male', 'unavailable']);
const ACTIVITY_CATEGORIES = new Set<ActivityCategory>([
  'inactive',
  'low-active',
  'active',
  'very-active',
]);
const ACTIVITY_ASSESSMENT_STATUSES = new Set<
  NutritionActivityInputs['assessmentStatus']
>(['not-provided', 'complete']);
const OCCUPATIONS = new Set<NutritionActivityInputs['occupation']>([
  'mostly-seated',
  'mixed',
  'mostly-standing',
  'manual-labor',
  'not-provided',
]);
const TRAINING_TYPES = new Set<TrainingType>([
  'resistance',
  'cardio',
  'sport',
  'mobility',
  'mixed',
  'none',
]);
const TRAINING_INTENSITIES = new Set<NutritionActivityInputs['trainingIntensity']>([
  'light',
  'moderate',
  'vigorous',
  'mixed',
  'none',
  'not-provided',
]);
const ELIGIBILITY_BLOCKERS = new Set<NutritionEligibilityBlocker>([
  'automatic-targets-disabled',
  'protein-age-under-18',
  'energy-age-under-19',
  'missing-inputs',
  'equation-branch-unavailable',
  'fat-loss-bmi-ineligible',
  'target-bmi-below-18.5',
  'pregnancy-or-breastfeeding',
  'therapeutic-diet-required',
  'kidney-or-complex-condition',
  'eating-disorder-or-reds-risk',
  'athlete-or-extreme-activity',
  'protein-weight-method-unverified',
  'energy-floor',
  'speed-or-six-month-limit',
]);
const PROTEIN_MODES = new Set<NutritionTargetMode['protein']>(['disabled', 'range']);
const ENERGY_MODES = new Set<NutritionTargetMode['energy']>([
  'disabled',
  'point',
  'range',
]);
const EVALUATION_POLICIES = new Set<NutritionTargetMode['evaluationPolicy']>([
  'neutral-intake-only',
  'protein-range',
  'energy-relative',
  'protein-range-and-energy-relative',
]);
const TARGET_REASONS = new Set<NutritionTargetMode['reason']>([
  'professional-review-pending',
  'eligibility-blocked',
  'active',
]);
const PROTEIN_WEIGHT_METHODS = new Set<
  NonNullable<NutritionSafetyInputs['proteinWeightMethod']>
>(['current-weight', 'professional-reference-weight', 'unverified']);
const ELIGIBILITY_STANDARDS = new Set<NutritionSafetyInputs['eligibilityStandard']>([
  'WS/T 428—2013',
]);
const EQUATION_NAMES = new Set<NutritionEquationInputs['equationName']>([
  'NASEM-2023-adult-EER',
  'not-calculated',
]);

const LIMITS = {
  plans: 3_660,
  foods: 5_000,
  meals: 36_600,
  items: 200_000,
  id: 200,
  label: 120,
  text: 500,
  assumptions: 30,
  aliases: 30,
} as const;

const CUSTOM_FOOD_ID = /^food:custom:[A-Za-z0-9_-]{1,128}$/;
const MEAL_ITEM_ID = /^meal-item:[A-Za-z0-9_-]{1,128}$/;

function hasOwn(row: UnknownObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function objectValue(value: unknown, label: string, invalid: InvalidBackup): UnknownObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${label}格式不正确`);
  }
  return value as UnknownObject;
}

function ownValue(
  row: UnknownObject,
  key: string,
  label: string,
  invalid: InvalidBackup,
): unknown {
  if (!hasOwn(row, key)) invalid(`${label}缺少字段 ${key}`);
  return row[key];
}

function arrayValue(
  value: unknown,
  label: string,
  maximum: number,
  invalid: InvalidBackup,
): unknown[] {
  if (!Array.isArray(value)) invalid(`${label}必须是数组`);
  if (value.length > maximum) invalid(`${label}数量超出范围`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      invalid(`${label}第 ${index + 1} 项必须是 own 元素`);
    }
  }
  return value;
}

function exactKeys(
  row: UnknownObject,
  allowed: readonly string[],
  label: string,
  invalid: InvalidBackup,
): void {
  const allowedSet = new Set(allowed);
  const ownKeys = Reflect.ownKeys(row);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !allowedSet.has(key))
  ) {
    invalid(`${label}包含未知字段`);
  }
  if (allowed.some((key) => !hasOwn(row, key))) invalid(`${label}缺少字段`);
}

function textValue(
  value: unknown,
  label: string,
  invalid: InvalidBackup,
  options: { empty?: boolean; max?: number } = {},
): string {
  if (typeof value !== 'string') invalid(`${label}必须是文字`);
  if (!options.empty && value.trim().length === 0) invalid(`${label}不能为空`);
  if (value.length > (options.max ?? LIMITS.text)) invalid(`${label}过长`);
  return value;
}

function dateValue(value: unknown, label: string, invalid: InvalidBackup): string {
  const date = textValue(value, label, invalid, { max: 10 });
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateStr(parseDate(date)) !== date) {
      invalid(`${label}不是有效日期`);
    }
  } catch {
    invalid(`${label}不是有效日期`);
  }
  return date;
}

function finiteValue(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  invalid: InvalidBackup,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(`${label}必须是有限数值`);
  }
  if (value < minimum || value > maximum) invalid(`${label}超出范围`);
  return value;
}

function integerValue(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  invalid: InvalidBackup,
): number {
  const number = finiteValue(value, label, minimum, maximum, invalid);
  if (!Number.isInteger(number)) invalid(`${label}必须是整数`);
  return number;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  label: string,
  invalid: InvalidBackup,
): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) invalid(`${label}不正确`);
  return value as T;
}

function stringArray(
  value: unknown,
  label: string,
  maximum: number,
  invalid: InvalidBackup,
): string[] {
  return arrayValue(value, label, maximum, invalid).map((entry, index) =>
    textValue(entry, `${label}第 ${index + 1} 项`, invalid, {
      empty: true,
      max: LIMITS.text,
    }),
  );
}

function booleanValue(value: unknown, label: string, invalid: InvalidBackup): boolean {
  if (typeof value !== 'boolean') invalid(`${label}必须是布尔值`);
  return value;
}

function nullableBooleanValue(
  value: unknown,
  label: string,
  invalid: InvalidBackup,
): boolean | null {
  return value === null ? null : booleanValue(value, label, invalid);
}

function nullableFiniteValue(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  invalid: InvalidBackup,
): number | null {
  return value === null ? null : finiteValue(value, label, minimum, maximum, invalid);
}

function nullableIntegerValue(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  invalid: InvalidBackup,
): number | null {
  return value === null ? null : integerValue(value, label, minimum, maximum, invalid);
}

function nullableDateValue(
  value: unknown,
  label: string,
  invalid: InvalidBackup,
): string | null {
  return value === null ? null : dateValue(value, label, invalid);
}

function nullableEnumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  label: string,
  invalid: InvalidBackup,
): T | null {
  return value === null ? null : enumValue(value, allowed, label, invalid);
}

function unique(values: string[], label: string, invalid: InvalidBackup): void {
  if (new Set(values).size !== values.length) invalid(`${label}存在重复值`);
}

function parseGoals(value: unknown, invalid: InvalidBackup): NutritionGoals {
  const row = objectValue(value, '营养目标', invalid);
  exactKeys(row, ['muscleGain', 'fatLoss'], '营养目标', invalid);
  return {
    muscleGain: booleanValue(row.muscleGain, '是否增肌', invalid),
    fatLoss: booleanValue(row.fatLoss, '是否减脂', invalid),
  };
}

function parseSafetyInputs(value: unknown, invalid: InvalidBackup): NutritionSafetyInputs {
  const row = objectValue(value, '安全筛查', invalid);
  exactKeys(
    row,
    [
      'basisWeightKg',
      'basisWeightDate',
      'proteinWeightMethod',
      'ageYears',
      'heightCm',
      'targetWeightKg',
      'targetLossKgPerWeek',
      'targetDate',
      'highBodyFatOrObesity',
      'pregnantOrBreastfeeding',
      'requiresTherapeuticDiet',
      'kidneyDiseaseOrComplexCondition',
      'eatingDisorderOrRedsRisk',
      'athleteOrExtremeActivity',
      'eligibilityStandard',
      'eligibilityBlockers',
    ],
    '安全筛查',
    invalid,
  );
  return {
    basisWeightKg: nullableFiniteValue(row.basisWeightKg, '计算体重', 20, 300, invalid),
    basisWeightDate: nullableDateValue(row.basisWeightDate, '体重日期', invalid),
    proteinWeightMethod: nullableEnumValue(
      row.proteinWeightMethod,
      PROTEIN_WEIGHT_METHODS,
      '蛋白质计算体重方法',
      invalid,
    ),
    ageYears: nullableIntegerValue(row.ageYears, '年龄', 1, 120, invalid),
    heightCm: nullableFiniteValue(row.heightCm, '身高', 100, 250, invalid),
    targetWeightKg: nullableFiniteValue(row.targetWeightKg, '目标体重', 20, 300, invalid),
    targetLossKgPerWeek: nullableFiniteValue(
      row.targetLossKgPerWeek,
      '每周减重目标',
      0.001,
      20,
      invalid,
    ),
    targetDate: nullableDateValue(row.targetDate, '目标日期', invalid),
    highBodyFatOrObesity: nullableBooleanValue(
      row.highBodyFatOrObesity,
      '是否高体脂或肥胖',
      invalid,
    ),
    pregnantOrBreastfeeding: nullableBooleanValue(
      row.pregnantOrBreastfeeding,
      '是否处于孕期或哺乳期',
      invalid,
    ),
    requiresTherapeuticDiet: nullableBooleanValue(
      row.requiresTherapeuticDiet,
      '是否需要治疗性饮食',
      invalid,
    ),
    kidneyDiseaseOrComplexCondition: nullableBooleanValue(
      row.kidneyDiseaseOrComplexCondition,
      '是否有肾病或复杂疾病',
      invalid,
    ),
    eatingDisorderOrRedsRisk: nullableBooleanValue(
      row.eatingDisorderOrRedsRisk,
      '是否有进食障碍或 RED-S 风险',
      invalid,
    ),
    athleteOrExtremeActivity: nullableBooleanValue(
      row.athleteOrExtremeActivity,
      '是否为运动员或极端活动量',
      invalid,
    ),
    eligibilityStandard: enumValue(
      row.eligibilityStandard,
      ELIGIBILITY_STANDARDS,
      '适用性标准',
      invalid,
    ),
    eligibilityBlockers: arrayValue(
      row.eligibilityBlockers,
      '安全阻断原因',
      ELIGIBILITY_BLOCKERS.size,
      invalid,
    ).map((entry) =>
      enumValue(entry, ELIGIBILITY_BLOCKERS, '安全阻断原因', invalid),
    ),
  };
}

function parseActivityInputs(value: unknown, invalid: InvalidBackup): NutritionActivityInputs {
  const row = objectValue(value, '活动输入', invalid);
  exactKeys(
    row,
    [
      'assessmentStatus',
      'occupation',
      'activeCommuteMinutesPerDay',
      'householdMinutesPerDay',
      'stepsPerDay',
      'trainingTypes',
      'trainingSessionsPerWeek',
      'trainingMinutesPerSession',
      'trainingIntensity',
    ],
    '活动输入',
    invalid,
  );
  return {
    assessmentStatus: enumValue(
      row.assessmentStatus,
      ACTIVITY_ASSESSMENT_STATUSES,
      '活动问卷状态',
      invalid,
    ),
    occupation: enumValue(row.occupation, OCCUPATIONS, '职业活动类型', invalid),
    activeCommuteMinutesPerDay: nullableFiniteValue(
      row.activeCommuteMinutesPerDay,
      '每日主动通勤分钟',
      0,
      1_440,
      invalid,
    ),
    householdMinutesPerDay: nullableFiniteValue(
      row.householdMinutesPerDay,
      '每日家务分钟',
      0,
      1_440,
      invalid,
    ),
    stepsPerDay: nullableFiniteValue(row.stepsPerDay, '每日步数', 0, 100_000, invalid),
    trainingTypes: arrayValue(
      row.trainingTypes,
      '训练类型',
      TRAINING_TYPES.size,
      invalid,
    ).map((entry) => enumValue(entry, TRAINING_TYPES, '训练类型', invalid)),
    trainingSessionsPerWeek: nullableFiniteValue(
      row.trainingSessionsPerWeek,
      '每周训练次数',
      0,
      14,
      invalid,
    ),
    trainingMinutesPerSession: nullableFiniteValue(
      row.trainingMinutesPerSession,
      '每次训练分钟',
      0,
      600,
      invalid,
    ),
    trainingIntensity: enumValue(
      row.trainingIntensity,
      TRAINING_INTENSITIES,
      '训练强度',
      invalid,
    ),
  };
}

function parseEquationInputs(value: unknown, invalid: InvalidBackup): NutritionEquationInputs {
  const row = objectValue(value, '方程输入', invalid);
  exactKeys(
    row,
    [
      'equationName',
      'equationBranch',
      'activityInputs',
      'activityCategoryLow',
      'activityCategoryHigh',
      'maintenanceEnergyLowKcal',
      'maintenanceEnergyHighKcal',
      'calculatedAt',
    ],
    '方程输入',
    invalid,
  );
  return {
    equationName: enumValue(row.equationName, EQUATION_NAMES, '方程名称', invalid),
    equationBranch: enumValue(row.equationBranch, EQUATION_BRANCHES, '方程分支', invalid),
    activityInputs: parseActivityInputs(row.activityInputs, invalid),
    activityCategoryLow: nullableEnumValue(
      row.activityCategoryLow,
      ACTIVITY_CATEGORIES,
      '活动分类下界',
      invalid,
    ),
    activityCategoryHigh: nullableEnumValue(
      row.activityCategoryHigh,
      ACTIVITY_CATEGORIES,
      '活动分类上界',
      invalid,
    ),
    maintenanceEnergyLowKcal: nullableFiniteValue(
      row.maintenanceEnergyLowKcal,
      '维持热量下界',
      0,
      100_000,
      invalid,
    ),
    maintenanceEnergyHighKcal: nullableFiniteValue(
      row.maintenanceEnergyHighKcal,
      '维持热量上界',
      0,
      100_000,
      invalid,
    ),
    calculatedAt: nullableIntegerValue(
      row.calculatedAt,
      '方程计算时间',
      0,
      Number.MAX_SAFE_INTEGER,
      invalid,
    ),
  };
}

function parseTargetRanges(value: unknown, invalid: InvalidBackup): NutritionTargetRanges {
  const row = objectValue(value, '目标范围', invalid);
  exactKeys(
    row,
    [
      'proteinLowG',
      'proteinHighG',
      'proteinReferenceG',
      'proteinLowCoefficient',
      'proteinHighCoefficient',
      'proteinReferenceCoefficient',
      'energyLowKcal',
      'energyHighKcal',
      'energyRawLowKcal',
      'energyRawHighKcal',
    ],
    '目标范围',
    invalid,
  );
  return {
    proteinLowG: nullableFiniteValue(row.proteinLowG, '蛋白质下界', 0, 10_000, invalid),
    proteinHighG: nullableFiniteValue(row.proteinHighG, '蛋白质上界', 0, 10_000, invalid),
    proteinReferenceG: nullableFiniteValue(
      row.proteinReferenceG,
      '蛋白质参考值',
      0,
      10_000,
      invalid,
    ),
    proteinLowCoefficient: nullableFiniteValue(
      row.proteinLowCoefficient,
      '蛋白质下界系数',
      0,
      100,
      invalid,
    ),
    proteinHighCoefficient: nullableFiniteValue(
      row.proteinHighCoefficient,
      '蛋白质上界系数',
      0,
      100,
      invalid,
    ),
    proteinReferenceCoefficient: nullableFiniteValue(
      row.proteinReferenceCoefficient,
      '蛋白质参考系数',
      0,
      100,
      invalid,
    ),
    energyLowKcal: nullableFiniteValue(row.energyLowKcal, '热量下界', 0, 100_000, invalid),
    energyHighKcal: nullableFiniteValue(row.energyHighKcal, '热量上界', 0, 100_000, invalid),
    energyRawLowKcal: nullableFiniteValue(
      row.energyRawLowKcal,
      '未取整热量下界',
      0,
      100_000,
      invalid,
    ),
    energyRawHighKcal: nullableFiniteValue(
      row.energyRawHighKcal,
      '未取整热量上界',
      0,
      100_000,
      invalid,
    ),
  };
}

function parseTargetMode(value: unknown, invalid: InvalidBackup): NutritionTargetMode {
  const row = objectValue(value, '目标模式', invalid);
  exactKeys(
    row,
    ['protein', 'energy', 'evaluationPolicy', 'autoTargetsEnabled', 'reason'],
    '目标模式',
    invalid,
  );
  return {
    protein: enumValue(row.protein, PROTEIN_MODES, '蛋白质目标模式', invalid),
    energy: enumValue(row.energy, ENERGY_MODES, '热量目标模式', invalid),
    evaluationPolicy: enumValue(
      row.evaluationPolicy,
      EVALUATION_POLICIES,
      '评价策略',
      invalid,
    ),
    autoTargetsEnabled: booleanValue(row.autoTargetsEnabled, '自动目标开关', invalid),
    reason: enumValue(row.reason, TARGET_REASONS, '目标模式原因', invalid),
  };
}

function parsePlan(value: unknown, index: number, invalid: InvalidBackup): BackupNutritionPlan {
  const label = `营养计划第 ${index + 1} 行`;
  const row = objectValue(value, label, invalid);
  exactKeys(
    row,
    [
      'id',
      'effectiveFrom',
      'goals',
      'safetyInputs',
      'standardVersion',
      'equationInputs',
      'equationVersion',
      'targetRanges',
      'targetMode',
      'sourceVersion',
      'proteinPolicySource',
      'proteinPolicyVersion',
    ],
    label,
    invalid,
  );
  const effectiveFrom = dateValue(row.effectiveFrom, '计划生效日期', invalid);
  const id = textValue(row.id, '营养计划 ID', invalid, { max: LIMITS.id });
  if (id !== `nutrition-plan:${effectiveFrom}`) {
    invalid('营养计划 ID 与生效日期不一致');
  }
  const proteinPolicySource = textValue(
    row.proteinPolicySource,
    '蛋白质政策来源',
    invalid,
  );
  if (proteinPolicySource !== 'ISSN') invalid('蛋白质政策来源不正确');
  const proteinPolicyVersion = textValue(
    row.proteinPolicyVersion,
    '蛋白质政策版本',
    invalid,
  );
  if (proteinPolicyVersion !== 'JISSN-2017-14-20') {
    invalid('蛋白质政策版本不正确');
  }
  const parsed: BackupNutritionPlan = {
    id,
    effectiveFrom,
    goals: parseGoals(row.goals, invalid),
    safetyInputs: parseSafetyInputs(row.safetyInputs, invalid),
    standardVersion: textValue(row.standardVersion, '筛查标准版本', invalid),
    equationInputs: parseEquationInputs(row.equationInputs, invalid),
    equationVersion: textValue(row.equationVersion, '方程版本', invalid),
    targetRanges: parseTargetRanges(row.targetRanges, invalid),
    targetMode: parseTargetMode(row.targetMode, invalid),
    sourceVersion: textValue(row.sourceVersion, '营养政策版本', invalid),
    proteinPolicySource,
    proteinPolicyVersion,
  };
  try {
    assertNutritionPlanSemantics({
      ...parsed,
      updatedAt: parsed.equationInputs.calculatedAt ?? 0,
      deletedAt: null,
    });
  } catch (error) {
    invalid(error instanceof Error ? error.message : '营养计划语义校验失败');
  }
  return parsed;
}

type BackupNutrientSnapshot = Pick<
  BackupFood,
  | 'originalEnergyValue'
  | 'originalEnergyUnit'
  | 'originalProteinG'
  | 'originalBasisAmount'
  | 'originalBasisUnit'
  | 'basisAmount'
  | 'basisUnit'
  | 'energyKcal'
  | 'proteinG'
  | 'ediblePortionRatio'
  | 'densityGPerMl'
  | 'conversionAssumptions'
  | 'fdcId'
  | 'fdcDataType'
  | 'sourceRetrievedAt'
>;

function parseNutrientSnapshot(
  row: UnknownObject,
  label: string,
  invalid: InvalidBackup,
): BackupNutrientSnapshot {
  const result: BackupNutrientSnapshot = {
    originalEnergyValue: finiteValue(
      row.originalEnergyValue,
      `${label}原始热量`,
      0,
      1_000_000,
      invalid,
    ),
    originalEnergyUnit: enumValue(
      row.originalEnergyUnit,
      ENERGY_UNITS,
      `${label}原始热量单位`,
      invalid,
    ),
    originalProteinG: finiteValue(
      row.originalProteinG,
      `${label}原始蛋白质`,
      0,
      100_000,
      invalid,
    ),
    originalBasisAmount: finiteValue(
      row.originalBasisAmount,
      `${label}原始基准量`,
      0.01,
      100_000,
      invalid,
    ),
    originalBasisUnit: enumValue(
      row.originalBasisUnit,
      BASIS_UNITS,
      `${label}原始基准单位`,
      invalid,
    ),
    basisAmount: finiteValue(
      row.basisAmount,
      `${label}归一化基准量`,
      0.01,
      100_000,
      invalid,
    ),
    basisUnit: enumValue(row.basisUnit, BASIS_UNITS, `${label}归一化基准单位`, invalid),
    energyKcal: finiteValue(row.energyKcal, `${label}归一化热量`, 0, 100_000, invalid),
    proteinG: finiteValue(row.proteinG, `${label}归一化蛋白质`, 0, 10_000, invalid),
    ediblePortionRatio: finiteValue(
      row.ediblePortionRatio,
      `${label}可食部比例`,
      Number.MIN_VALUE,
      1,
      invalid,
    ),
    densityGPerMl: nullableFiniteValue(
      row.densityGPerMl,
      `${label}密度`,
      Number.MIN_VALUE,
      100,
      invalid,
    ),
    conversionAssumptions: stringArray(
      row.conversionAssumptions,
      `${label}换算假设`,
      LIMITS.assumptions,
      invalid,
    ),
    fdcId: nullableIntegerValue(
      row.fdcId,
      `${label} FDC ID`,
      1,
      Number.MAX_SAFE_INTEGER,
      invalid,
    ),
    fdcDataType: nullableEnumValue(
      row.fdcDataType,
      FOOD_DATA_TYPES,
      `${label} FDC 数据类型`,
      invalid,
    ),
    sourceRetrievedAt: nullableDateValue(
      row.sourceRetrievedAt,
      `${label}数据获取日期`,
      invalid,
    ),
  };
  if ((result.fdcId === null) !== (result.fdcDataType === null)) {
    invalid(`${label} FDC ID 和数据类型必须同时有值或同时为空`);
  }
  if (result.fdcId !== null && result.sourceRetrievedAt === null) {
    invalid(`${label} FDC 数据必须记录获取日期`);
  }

  let normalized;
  try {
    normalized = normalizeFoodNutrients({
      originalEnergyValue: result.originalEnergyValue,
      originalEnergyUnit: result.originalEnergyUnit,
      originalProteinG: result.originalProteinG,
      originalBasisAmount: result.originalBasisAmount,
      originalBasisUnit: result.originalBasisUnit,
      normalizedBasisAmount: result.basisAmount,
      normalizedBasisUnit: result.basisUnit,
      ediblePortionRatio: result.ediblePortionRatio,
      densityGPerMl: result.densityGPerMl,
      conversionAssumptions: [],
    });
  } catch {
    invalid(`${label}营养密度换算不正确`);
  }
  if (
    Math.abs(result.energyKcal - normalized.energyKcal) > 1e-6 ||
    Math.abs(result.proteinG - normalized.proteinG) > 1e-6
  ) {
    invalid(`${label}归一化营养密度与原始值、基准量或密度不一致`);
  }
  return result;
}

function parseFood(value: unknown, index: number, invalid: InvalidBackup): BackupFood {
  const label = `自定义食物第 ${index + 1} 行`;
  const row = objectValue(value, label, invalid);
  exactKeys(
    row,
    [
      'id',
      'name',
      'aliases',
      'rawOrCooked',
      'preparation',
      'originalEnergyValue',
      'originalEnergyUnit',
      'originalProteinG',
      'originalBasisAmount',
      'originalBasisUnit',
      'basisAmount',
      'basisUnit',
      'energyKcal',
      'proteinG',
      'ediblePortionRatio',
      'densityGPerMl',
      'conversionAssumptions',
      'fdcId',
      'fdcDataType',
      'sourceRetrievedAt',
      'source',
      'sourceVersion',
      'license',
    ],
    label,
    invalid,
  );
  const id = textValue(row.id, '食物 ID', invalid, { max: LIMITS.id });
  if (!CUSTOM_FOOD_ID.test(id)) {
    invalid('自定义食物 ID 必须使用 food:custom: 命名空间和规范操作键');
  }
  return {
    id,
    name: textValue(row.name, '食物名称', invalid, { max: LIMITS.label }),
    aliases: stringArray(row.aliases, '食物别名', LIMITS.aliases, invalid),
    rawOrCooked: enumValue(row.rawOrCooked, RAW_OR_COOKED, '食物生熟状态', invalid),
    preparation: textValue(row.preparation, '食物做法', invalid, {
      empty: true,
      max: LIMITS.label,
    }),
    ...parseNutrientSnapshot(row, '食物', invalid),
    source: textValue(row.source, '食物数据源', invalid),
    sourceVersion: textValue(row.sourceVersion, '食物数据版本', invalid),
    license: textValue(row.license, '食物数据许可', invalid),
  };
}

function parseMeal(value: unknown, index: number, invalid: InvalidBackup): BackupMeal {
  const label = `餐次第 ${index + 1} 行`;
  const row = objectValue(value, label, invalid);
  exactKeys(row, ['id', 'date', 'slot'], label, invalid);
  const date = dateValue(row.date, '餐次日期', invalid);
  const slot = enumValue(row.slot, SLOTS, '餐次类型', invalid);
  const id = textValue(row.id, '餐次 ID', invalid, { max: LIMITS.id });
  if (id !== `meal:${date}:${slot}`) invalid('餐次 ID 与日期和餐次不一致');
  return { id, date, slot };
}

function parseMealItem(
  value: unknown,
  index: number,
  invalid: InvalidBackup,
): BackupMealItem {
  const label = `餐食条目第 ${index + 1} 行`;
  const row = objectValue(value, label, invalid);
  exactKeys(
    row,
    [
      'id',
      'mealId',
      'name',
      'preparation',
      'amount',
      'unit',
      'originalEnergyValue',
      'originalEnergyUnit',
      'originalProteinG',
      'originalBasisAmount',
      'originalBasisUnit',
      'energyKcal',
      'proteinG',
      'energyKcalLow',
      'energyKcalHigh',
      'proteinGLow',
      'proteinGHigh',
      'assumptions',
      'uncertaintyModelVersion',
      'basisAmount',
      'basisUnit',
      'ediblePortionRatio',
      'densityGPerMl',
      'conversionAssumptions',
      'fdcId',
      'fdcDataType',
      'sourceRetrievedAt',
      'source',
      'sourceVersion',
      'license',
      'method',
      'quality',
      'confirmedAt',
      'order',
    ],
    label,
    invalid,
  );
  const id = textValue(row.id, '餐食条目 ID', invalid, { max: LIMITS.id });
  if (!MEAL_ITEM_ID.test(id)) invalid('餐食条目 ID 命名空间或操作键不正确');
  const nutrientSnapshot = parseNutrientSnapshot(row, '餐食条目', invalid);
  const amount = finiteValue(row.amount, '条目份量', 0.01, 100_000, invalid);
  const unit = enumValue(row.unit, BASIS_UNITS, '条目单位', invalid);
  const energyKcalLow = finiteValue(row.energyKcalLow, '热量下界', 0, 100_000, invalid);
  const energyKcalHigh = finiteValue(row.energyKcalHigh, '热量上界', 0, 100_000, invalid);
  const proteinGLow = finiteValue(row.proteinGLow, '蛋白质下界', 0, 10_000, invalid);
  const proteinGHigh = finiteValue(row.proteinGHigh, '蛋白质上界', 0, 10_000, invalid);
  if (energyKcalLow > energyKcalHigh) invalid('热量上下界顺序不正确');
  if (proteinGLow > proteinGHigh) invalid('蛋白质上下界顺序不正确');

  let amountInBasisUnit = amount;
  if (unit !== nutrientSnapshot.basisUnit) {
    if (nutrientSnapshot.densityGPerMl === null) {
      invalid('餐食条目跨 g/mL 份量换算必须有正密度');
    }
    amountInBasisUnit =
      nutrientSnapshot.basisUnit === 'g'
        ? amount * nutrientSnapshot.densityGPerMl!
        : amount / nutrientSnapshot.densityGPerMl!;
  }
  const portionFactor = amountInBasisUnit / nutrientSnapshot.basisAmount;
  const pointEnergy = nutrientSnapshot.energyKcal * portionFactor;
  const pointProtein = nutrientSnapshot.proteinG * portionFactor;
  if (pointEnergy < energyKcalLow - 1e-6 || pointEnergy > energyKcalHigh + 1e-6) {
    invalid('餐食条目热量点估计不在已确认范围内');
  }
  if (pointProtein < proteinGLow - 1e-6 || pointProtein > proteinGHigh + 1e-6) {
    invalid('餐食条目蛋白质点估计不在已确认范围内');
  }

  return {
    id,
    mealId: textValue(row.mealId, '餐次 ID', invalid, { max: LIMITS.id }),
    name: textValue(row.name, '条目名称', invalid, { max: LIMITS.label }),
    preparation: textValue(row.preparation, '条目做法', invalid, {
      empty: true,
      max: LIMITS.label,
    }),
    amount,
    unit,
    ...nutrientSnapshot,
    energyKcalLow,
    energyKcalHigh,
    proteinGLow,
    proteinGHigh,
    assumptions: stringArray(row.assumptions, '条目假设', LIMITS.assumptions, invalid),
    uncertaintyModelVersion: textValue(
      row.uncertaintyModelVersion,
      '不确定性模型版本',
      invalid,
    ),
    source: textValue(row.source, '条目数据源', invalid),
    sourceVersion: textValue(row.sourceVersion, '条目数据版本', invalid),
    license: textValue(row.license, '条目数据许可', invalid),
    method: enumValue(row.method, METHODS, '记录方法', invalid),
    quality: enumValue(row.quality, QUALITIES, '数据质量', invalid),
    confirmedAt: integerValue(
      row.confirmedAt,
      '确认时间',
      0,
      Number.MAX_SAFE_INTEGER,
      invalid,
    ),
    order: integerValue(row.order, '条目顺序', 0, 10_000, invalid),
  };
}

export function parseNutritionSection(
  source: unknown,
  schemaVersion: number,
  invalid: InvalidBackup,
): NutritionBackupSection {
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 0 || schemaVersion > 3) {
    invalid('营养备份版本不受支持');
  }
  if (schemaVersion < 3) return EMPTY_NUTRITION_BACKUP;

  const root = objectValue(source, '营养备份', invalid);
  const nutritionPlans = arrayValue(
    ownValue(root, 'nutritionPlans', '营养备份', invalid),
    '营养计划',
    LIMITS.plans,
    invalid,
  ).map((row, index) => parsePlan(row, index, invalid));
  const foods = arrayValue(
    ownValue(root, 'foods', '营养备份', invalid),
    '自定义食物',
    LIMITS.foods,
    invalid,
  ).map((row, index) => parseFood(row, index, invalid));
  const meals = arrayValue(
    ownValue(root, 'meals', '营养备份', invalid),
    '餐次',
    LIMITS.meals,
    invalid,
  ).map((row, index) => parseMeal(row, index, invalid));
  const mealItems = arrayValue(
    ownValue(root, 'mealItems', '营养备份', invalid),
    '餐食条目',
    LIMITS.items,
    invalid,
  ).map((row, index) => parseMealItem(row, index, invalid));

  unique(
    nutritionPlans.map((row) => row.id),
    '营养计划 ID',
    invalid,
  );
  unique(
    nutritionPlans.map((row) => row.effectiveFrom),
    '营养计划生效日期',
    invalid,
  );
  unique(
    foods.map((row) => row.id),
    '自定义食物 ID',
    invalid,
  );
  unique(
    meals.map((row) => row.id),
    '餐次 ID',
    invalid,
  );
  unique(
    meals.map((row) => `${row.date}:${row.slot}`),
    '日期和餐次',
    invalid,
  );
  unique(
    mealItems.map((row) => row.id),
    '餐食条目 ID',
    invalid,
  );

  const mealIds = new Set(meals.map((row) => row.id));
  if (mealItems.some((row) => !mealIds.has(row.mealId))) {
    invalid('餐食条目引用了不存在的餐次');
  }

  return { nutritionPlans, foods, meals, mealItems };
}
