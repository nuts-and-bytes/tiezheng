import type {
  ActivityCategory,
  NutritionActivityInputs,
  NutritionEligibilityBlocker,
  NutritionEquationInputs,
  NutritionGoals,
  NutritionSafetyInputs,
  NutritionTargetMode,
  NutritionTargetRanges,
} from './nutritionTypes';

export interface NutritionPlanRawInputs {
  effectiveFrom: string;
  goals: NutritionGoals;
  safetyInputs: Omit<NutritionSafetyInputs, 'eligibilityBlockers'>;
  equationInputs: Pick<
    NutritionEquationInputs,
    | 'equationBranch'
    | 'activityInputs'
    | 'activityCategoryLow'
    | 'activityCategoryHigh'
  >;
  autoTargetsEnabled: boolean;
  now: number;
}

export interface DerivedNutritionPlanSemantics {
  safetyInputs: NutritionSafetyInputs;
  equationInputs: NutritionEquationInputs;
  targetRanges: NutritionTargetRanges;
  targetMode: NutritionTargetMode;
}

export interface FatLossEnergyRange {
  energyLowKcal: number;
  energyHighKcal: number;
  energyRawLowKcal: number;
  energyRawHighKcal: number;
}

const EMPTY_ACTIVITY: NutritionActivityInputs = {
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

const EMPTY_TARGETS: NutritionTargetRanges = {
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

const ACTIVITY_ORDER: ActivityCategory[] = [
  'inactive',
  'low-active',
  'active',
  'very-active',
];

const BLOCKER_ORDER: NutritionEligibilityBlocker[] = [
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
];

const NASEM_COEFFICIENTS = {
  male: {
    inactive: [753.07, -10.83, 6.5, 14.1],
    'low-active': [581.47, -10.83, 8.3, 14.94],
    active: [1004.82, -10.83, 6.52, 15.91],
    'very-active': [-517.88, -10.83, 15.61, 19.11],
  },
  female: {
    inactive: [584.9, -7.01, 5.72, 11.71],
    'low-active': [575.77, -7.01, 6.6, 12.14],
    active: [710.25, -7.01, 6.54, 12.34],
    'very-active': [511.83, -7.01, 9.07, 12.56],
  },
} as const;

function cloneActivity(input: NutritionActivityInputs): NutritionActivityInputs {
  return { ...input, trainingTypes: [...input.trainingTypes] };
}

function emptyEquationInputs(): NutritionEquationInputs {
  return {
    equationName: 'not-calculated',
    equationBranch: 'unavailable',
    activityInputs: cloneActivity(EMPTY_ACTIVITY),
    activityCategoryLow: null,
    activityCategoryHigh: null,
    maintenanceEnergyLowKcal: null,
    maintenanceEnergyHighKcal: null,
    calculatedAt: null,
  };
}

function emptyTargets(): NutritionTargetRanges {
  return { ...EMPTY_TARGETS };
}

function assertFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
}

function assertRange(
  value: number,
  field: string,
  low: number,
  high: number,
  integer = false,
): void {
  assertFinite(value, field);
  if (value < low || value > high || (integer && !Number.isInteger(value))) {
    throw new Error(`${field} must be${integer ? ' an integer' : ''} in [${low}, ${high}]`);
  }
}

function assertNullableRange(
  value: number | null,
  field: string,
  low: number,
  high: number,
  integer = false,
): void {
  if (value !== null) assertRange(value, field, low, high, integer);
}

function assertBooleanOrNull(value: boolean | null, field: string): void {
  if (value !== null && typeof value !== 'boolean') {
    throw new Error(`${field} must be boolean or null`);
  }
}

function assertRealDate(value: string, field: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${field} must use YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${field} must be a real calendar date`);
  }
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundToFive(value: number): number {
  return Math.round(value / 5) * 5;
}

function roundToFifty(value: number): number {
  return Math.round(value / 50) * 50;
}

export function bodyMassIndex(weightKg: number, heightCm: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error('weightKg must be finite and positive');
  }
  if (!Number.isFinite(heightCm) || heightCm <= 0) {
    throw new Error('heightCm must be finite and positive');
  }
  return weightKg / (heightCm / 100) ** 2;
}

export function proteinTargetRange(
  weightKg: number,
): Pick<
  NutritionTargetRanges,
  | 'proteinLowG'
  | 'proteinHighG'
  | 'proteinReferenceG'
  | 'proteinLowCoefficient'
  | 'proteinHighCoefficient'
  | 'proteinReferenceCoefficient'
> {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error('weightKg must be finite and positive');
  }
  return {
    proteinLowG: roundToFive(weightKg * 1.4),
    proteinHighG: roundToFive(weightKg * 2),
    proteinReferenceG: roundToFive(weightKg * 1.6),
    proteinLowCoefficient: 1.4,
    proteinHighCoefficient: 2,
    proteinReferenceCoefficient: 1.6,
  };
}

export function nasemAdultEer(input: {
  branch: 'male' | 'female';
  activity: ActivityCategory;
  ageYears: number;
  heightCm: number;
  weightKg: number;
}): number {
  if (input.ageYears < 19) throw new Error('NASEM adult EER requires age 19 or older');
  assertRange(input.ageYears, 'ageYears', 19, 120, true);
  assertRange(input.heightCm, 'heightCm', 100, 250);
  assertRange(input.weightKg, 'weightKg', 20, 300);
  const coefficients = NASEM_COEFFICIENTS[input.branch]?.[input.activity];
  if (!coefficients) throw new Error('unsupported NASEM equation branch or activity');
  const [constant, age, height, weight] = coefficients;
  return roundTo(
    constant + age * input.ageYears + height * input.heightCm + weight * input.weightKg,
    6,
  );
}

export function fatLossEnergyRange(
  maintenanceLowKcal: number,
  maintenanceHighKcal: number,
  branch: 'male' | 'female',
): FatLossEnergyRange {
  assertFinite(maintenanceLowKcal, 'maintenanceLowKcal');
  assertFinite(maintenanceHighKcal, 'maintenanceHighKcal');
  if (maintenanceLowKcal <= 0 || maintenanceHighKcal <= 0) {
    throw new Error('maintenance energy must be positive');
  }
  if (branch !== 'male' && branch !== 'female') {
    throw new Error('energy floor requires a male or female equation branch');
  }
  const raw = [maintenanceLowKcal, maintenanceHighKcal]
    .map((maintenance) => maintenance - Math.min(500, maintenance * 0.2))
    .sort((a, b) => a - b);
  const energyRawLowKcal = roundTo(raw[0], 6);
  const energyRawHighKcal = roundTo(raw[1], 6);
  return {
    energyLowKcal: roundToFifty(energyRawLowKcal),
    energyHighKcal: roundToFifty(energyRawHighKcal),
    energyRawLowKcal,
    energyRawHighKcal,
  };
}

export function validateActivityInputs(input: NutritionActivityInputs): void {
  if (input.assessmentStatus === 'not-provided') {
    if (
      input.occupation !== 'not-provided' ||
      input.activeCommuteMinutesPerDay !== null ||
      input.householdMinutesPerDay !== null ||
      input.stepsPerDay !== null ||
      !Array.isArray(input.trainingTypes) ||
      input.trainingTypes.length !== 0 ||
      input.trainingSessionsPerWeek !== null ||
      input.trainingMinutesPerSession !== null ||
      input.trainingIntensity !== 'not-provided'
    ) {
      throw new Error('not-provided activity must use the canonical empty questionnaire');
    }
    return;
  }
  if (input.assessmentStatus !== 'complete') {
    throw new Error('activity assessmentStatus must be complete or not-provided');
  }
  if (
    !['mostly-seated', 'mixed', 'mostly-standing', 'manual-labor'].includes(
      input.occupation,
    )
  ) {
    throw new Error('complete activity requires occupation');
  }
  if (
    input.activeCommuteMinutesPerDay === null ||
    input.householdMinutesPerDay === null ||
    input.stepsPerDay === null ||
    input.trainingSessionsPerWeek === null ||
    input.trainingMinutesPerSession === null
  ) {
    throw new Error('complete activity requires every numeric answer');
  }
  assertRange(input.activeCommuteMinutesPerDay, 'activeCommuteMinutesPerDay', 0, 1440);
  assertRange(input.householdMinutesPerDay, 'householdMinutesPerDay', 0, 1440);
  assertRange(input.stepsPerDay, 'stepsPerDay', 0, 100000);
  assertRange(input.trainingSessionsPerWeek, 'trainingSessionsPerWeek', 0, 14);
  assertRange(input.trainingMinutesPerSession, 'trainingMinutesPerSession', 0, 600);
  if (!Array.isArray(input.trainingTypes) || input.trainingTypes.length === 0) {
    throw new Error('complete activity requires at least one training type');
  }
  if (
    input.trainingTypes.some(
      (type) =>
        !['resistance', 'cardio', 'sport', 'mobility', 'mixed', 'none'].includes(type),
    )
  ) {
    throw new Error('invalid training type');
  }
  if (!['light', 'moderate', 'vigorous', 'mixed', 'none'].includes(input.trainingIntensity)) {
    throw new Error('invalid training intensity');
  }
  if (new Set(input.trainingTypes).size !== input.trainingTypes.length) {
    throw new Error('training types must be unique');
  }
  const none = input.trainingTypes.includes('none');
  if (none) {
    if (
      input.trainingTypes.length !== 1 ||
      input.trainingSessionsPerWeek !== 0 ||
      input.trainingMinutesPerSession !== 0 ||
      input.trainingIntensity !== 'none'
    ) {
      throw new Error('training type none must be the unique zero-training answer');
    }
    return;
  }
  if (
    input.trainingSessionsPerWeek <= 0 ||
    input.trainingMinutesPerSession <= 0 ||
    input.trainingIntensity === 'none' ||
    input.trainingIntensity === 'not-provided'
  ) {
    throw new Error('non-none training requires positive sessions, duration, and intensity');
  }
}

function validateActivityCategories(
  low: ActivityCategory | null,
  high: ActivityCategory | null,
): void {
  if (low === null && high !== null) {
    throw new Error('activity category high cannot exist without low');
  }
  if (low === null) return;
  const lowIndex = ACTIVITY_ORDER.indexOf(low);
  if (lowIndex < 0) throw new Error('invalid activity category low');
  if (high === null) return;
  const highIndex = ACTIVITY_ORDER.indexOf(high);
  if (highIndex !== lowIndex + 1) {
    throw new Error('activity category range must be adjacent and ascending');
  }
}

export function impliedWeeklyLossKg(
  basisWeightKg: number,
  targetWeightKg: number,
  basisWeightDate: string,
  targetDate: string,
): number {
  if (!Number.isFinite(basisWeightKg) || !Number.isFinite(targetWeightKg)) {
    throw new Error('weights must be finite');
  }
  if (basisWeightKg <= targetWeightKg) {
    throw new Error('target weight must be lower than basis weight');
  }
  assertRealDate(basisWeightDate, 'basisWeightDate');
  assertRealDate(targetDate, 'targetDate');
  const days = (utcDate(targetDate).getTime() - utcDate(basisWeightDate).getTime()) / 86_400_000;
  if (days <= 0) throw new Error('targetDate must be after basisWeightDate');
  return roundTo(((basisWeightKg - targetWeightKg) * 7) / days, 3);
}

function addCalendarMonths(dateString: string, months: number): Date {
  const source = utcDate(dateString);
  const targetYear = source.getUTCFullYear() + Math.floor((source.getUTCMonth() + months) / 12);
  const targetMonth = (source.getUTCMonth() + months) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(source.getUTCDate(), lastDay)));
}

function validateRaw(raw: NutritionPlanRawInputs): number | null {
  assertRealDate(raw.effectiveFrom, 'effectiveFrom');
  assertFinite(raw.now, 'now');
  if (typeof raw.goals?.muscleGain !== 'boolean' || typeof raw.goals?.fatLoss !== 'boolean') {
    throw new Error('goals must be booleans');
  }
  if (typeof raw.autoTargetsEnabled !== 'boolean') {
    throw new Error('autoTargetsEnabled must be boolean');
  }
  const safety = raw.safetyInputs;
  if (safety.eligibilityStandard !== 'WS/T 428—2013') {
    throw new Error('eligibilityStandard must be WS/T 428—2013');
  }
  assertNullableRange(safety.basisWeightKg, 'basisWeightKg', 20, 300);
  assertNullableRange(safety.ageYears, 'ageYears', 1, 120, true);
  assertNullableRange(safety.heightCm, 'heightCm', 100, 250);
  assertNullableRange(safety.targetWeightKg, 'targetWeightKg', 20, 300);
  assertNullableRange(safety.targetLossKgPerWeek, 'targetLossKgPerWeek', 0.001, 20);
  if (safety.basisWeightDate !== null) assertRealDate(safety.basisWeightDate, 'basisWeightDate');
  if (safety.targetDate !== null) assertRealDate(safety.targetDate, 'targetDate');
  if (
    safety.basisWeightDate !== null &&
    utcDate(safety.basisWeightDate) > utcDate(raw.effectiveFrom)
  ) {
    throw new Error('basisWeightDate must be on or before effectiveFrom');
  }
  if (
    safety.targetDate !== null &&
    utcDate(safety.targetDate) <= utcDate(raw.effectiveFrom)
  ) {
    throw new Error('targetDate must be after effectiveFrom');
  }
  if (
    safety.proteinWeightMethod !== null &&
    !['current-weight', 'professional-reference-weight', 'unverified'].includes(
      safety.proteinWeightMethod,
    )
  ) {
    throw new Error('invalid proteinWeightMethod');
  }
  for (const [field, value] of [
    ['highBodyFatOrObesity', safety.highBodyFatOrObesity],
    ['pregnantOrBreastfeeding', safety.pregnantOrBreastfeeding],
    ['requiresTherapeuticDiet', safety.requiresTherapeuticDiet],
    ['kidneyDiseaseOrComplexCondition', safety.kidneyDiseaseOrComplexCondition],
    ['eatingDisorderOrRedsRisk', safety.eatingDisorderOrRedsRisk],
    ['athleteOrExtremeActivity', safety.athleteOrExtremeActivity],
  ] as const) {
    assertBooleanOrNull(value, field);
  }
  if (
    safety.basisWeightKg !== null &&
    safety.targetWeightKg !== null &&
    safety.targetWeightKg >= safety.basisWeightKg
  ) {
    throw new Error('target weight direction must be lower than basis weight');
  }
  if (
    safety.basisWeightDate !== null &&
    safety.targetDate !== null &&
    utcDate(safety.targetDate) <= utcDate(safety.basisWeightDate)
  ) {
    throw new Error('targetDate must be after basisWeightDate');
  }

  let impliedWeeklyLoss: number | null = null;
  if (
    raw.goals.fatLoss &&
    safety.basisWeightKg !== null &&
    safety.targetWeightKg !== null &&
    safety.targetLossKgPerWeek !== null &&
    safety.basisWeightDate !== null &&
    safety.targetDate !== null
  ) {
    impliedWeeklyLoss = impliedWeeklyLossKg(
      safety.basisWeightKg,
      safety.targetWeightKg,
      safety.basisWeightDate,
      safety.targetDate,
    );
    if (safety.targetLossKgPerWeek !== impliedWeeklyLoss) {
      throw new Error(
        `targetLossKgPerWeek disagrees with weight and date inputs: expected ${impliedWeeklyLoss}`,
      );
    }
  }

  const equation = raw.equationInputs;
  if (!['female', 'male', 'unavailable'].includes(equation.equationBranch)) {
    throw new Error('invalid equationBranch');
  }
  validateActivityInputs(equation.activityInputs);
  validateActivityCategories(equation.activityCategoryLow, equation.activityCategoryHigh);
  if (
    equation.activityInputs.assessmentStatus === 'not-provided' &&
    (equation.activityCategoryLow !== null || equation.activityCategoryHigh !== null)
  ) {
    throw new Error('activity categories require a complete questionnaire');
  }
  return impliedWeeklyLoss;
}

function sharedSafetyBlockers(
  safety: NutritionPlanRawInputs['safetyInputs'],
): NutritionEligibilityBlocker[] {
  const blockers: NutritionEligibilityBlocker[] = [];
  const risks = [
    safety.pregnantOrBreastfeeding,
    safety.requiresTherapeuticDiet,
    safety.kidneyDiseaseOrComplexCondition,
    safety.eatingDisorderOrRedsRisk,
    safety.athleteOrExtremeActivity,
  ];
  if (risks.some((risk) => risk === null)) blockers.push('missing-inputs');
  if (safety.pregnantOrBreastfeeding) blockers.push('pregnancy-or-breastfeeding');
  if (safety.requiresTherapeuticDiet) blockers.push('therapeutic-diet-required');
  if (safety.kidneyDiseaseOrComplexCondition) blockers.push('kidney-or-complex-condition');
  if (safety.eatingDisorderOrRedsRisk) blockers.push('eating-disorder-or-reds-risk');
  if (safety.athleteOrExtremeActivity) blockers.push('athlete-or-extreme-activity');
  return blockers;
}

function canonicalBlockers(
  blockers: Iterable<NutritionEligibilityBlocker>,
): NutritionEligibilityBlocker[] {
  const unique = new Set(blockers);
  return BLOCKER_ORDER.filter((blocker) => unique.has(blocker));
}

function neutralSemantics(
  raw: NutritionPlanRawInputs,
  blockers: NutritionEligibilityBlocker[],
  autoTargetsEnabled: boolean,
  reason: NutritionTargetMode['reason'],
): DerivedNutritionPlanSemantics {
  return {
    safetyInputs: {
      ...raw.safetyInputs,
      eligibilityBlockers: canonicalBlockers(blockers),
    },
    equationInputs: emptyEquationInputs(),
    targetRanges: emptyTargets(),
    targetMode: {
      protein: 'disabled',
      energy: 'disabled',
      evaluationPolicy: 'neutral-intake-only',
      autoTargetsEnabled,
      reason,
    },
  };
}

function canCalculateEquation(
  raw: NutritionPlanRawInputs,
  sharedBlockers: readonly NutritionEligibilityBlocker[],
): boolean {
  const { safetyInputs: safety, equationInputs: equation } = raw;
  return (
    raw.goals.fatLoss &&
    sharedBlockers.length === 0 &&
    safety.ageYears !== null &&
    safety.ageYears >= 19 &&
    safety.heightCm !== null &&
    safety.basisWeightKg !== null &&
    equation.equationBranch !== 'unavailable' &&
    equation.activityInputs.assessmentStatus === 'complete' &&
    equation.activityCategoryLow !== null
  );
}

function deriveEquationInputs(raw: NutritionPlanRawInputs): NutritionEquationInputs {
  const equation = raw.equationInputs;
  const safety = raw.safetyInputs;
  const categories = [
    equation.activityCategoryLow,
    equation.activityCategoryHigh ?? equation.activityCategoryLow,
  ] as [ActivityCategory, ActivityCategory];
  const maintenance = categories
    .map((activity) =>
      nasemAdultEer({
        branch: equation.equationBranch as 'male' | 'female',
        activity,
        ageYears: safety.ageYears!,
        heightCm: safety.heightCm!,
        weightKg: safety.basisWeightKg!,
      }),
    )
    .sort((a, b) => a - b);
  return {
    equationName: 'NASEM-2023-adult-EER',
    equationBranch: equation.equationBranch,
    activityInputs: cloneActivity(equation.activityInputs),
    activityCategoryLow: equation.activityCategoryLow,
    activityCategoryHigh: equation.activityCategoryHigh,
    maintenanceEnergyLowKcal: maintenance[0],
    maintenanceEnergyHighKcal: maintenance[1],
    calculatedAt: raw.now,
  };
}

function uncalculatedEquationInputs(raw: NutritionPlanRawInputs): NutritionEquationInputs {
  return {
    equationName: 'not-calculated',
    equationBranch: raw.equationInputs.equationBranch,
    activityInputs: cloneActivity(raw.equationInputs.activityInputs),
    activityCategoryLow: raw.equationInputs.activityCategoryLow,
    activityCategoryHigh: raw.equationInputs.activityCategoryHigh,
    maintenanceEnergyLowKcal: null,
    maintenanceEnergyHighKcal: null,
    calculatedAt: null,
  };
}

function underageEquationInputs(raw: NutritionPlanRawInputs): NutritionEquationInputs {
  return {
    equationName: 'not-calculated',
    equationBranch: 'unavailable',
    activityInputs: cloneActivity(raw.equationInputs.activityInputs),
    activityCategoryLow: null,
    activityCategoryHigh: null,
    maintenanceEnergyLowKcal: null,
    maintenanceEnergyHighKcal: null,
    calculatedAt: null,
  };
}

export function deriveNutritionPlanSemantics(
  raw: NutritionPlanRawInputs,
): DerivedNutritionPlanSemantics {
  const impliedWeeklyLoss = validateRaw(raw);
  if (!raw.autoTargetsEnabled) {
    return neutralSemantics(
      raw,
      ['automatic-targets-disabled'],
      false,
      'professional-review-pending',
    );
  }
  if (!raw.goals.muscleGain && !raw.goals.fatLoss) {
    return neutralSemantics(raw, [], true, 'active');
  }

  const shared = sharedSafetyBlockers(raw.safetyInputs);
  const proteinBlockers: NutritionEligibilityBlocker[] = [...shared];
  const energyBlockers: NutritionEligibilityBlocker[] = [...shared];
  const safety = raw.safetyInputs;
  const equation = raw.equationInputs;

  if (raw.goals.muscleGain) {
    if (
      safety.basisWeightKg === null ||
      safety.basisWeightDate === null ||
      safety.ageYears === null ||
      safety.proteinWeightMethod === null ||
      safety.highBodyFatOrObesity === null
    ) {
      proteinBlockers.push('missing-inputs');
    }
    if (safety.ageYears !== null && safety.ageYears < 18) {
      proteinBlockers.push('protein-age-under-18');
    }
    if (
      safety.proteinWeightMethod !== null &&
      (safety.proteinWeightMethod !== 'current-weight' || safety.highBodyFatOrObesity === true)
    ) {
      proteinBlockers.push('protein-weight-method-unverified');
    }
  }

  if (raw.goals.fatLoss) {
    if (safety.ageYears !== null && safety.ageYears < 19) {
      energyBlockers.push('energy-age-under-19');
    } else {
      if (
        safety.basisWeightKg === null ||
        safety.ageYears === null ||
        safety.heightCm === null ||
        safety.targetWeightKg === null ||
        safety.targetLossKgPerWeek === null ||
        safety.basisWeightDate === null ||
        safety.targetDate === null ||
        equation.activityInputs.assessmentStatus !== 'complete' ||
        equation.activityCategoryLow === null
      ) {
        energyBlockers.push('missing-inputs');
      }
      if (equation.equationBranch === 'unavailable') {
        energyBlockers.push('equation-branch-unavailable');
      }
      if (
        safety.basisWeightKg !== null &&
        safety.heightCm !== null &&
        bodyMassIndex(safety.basisWeightKg, safety.heightCm) < 24
      ) {
        energyBlockers.push('fat-loss-bmi-ineligible');
      }
      if (
        safety.targetWeightKg !== null &&
        safety.heightCm !== null &&
        bodyMassIndex(safety.targetWeightKg, safety.heightCm) < 18.5
      ) {
        energyBlockers.push('target-bmi-below-18.5');
      }
      if (
        safety.basisWeightKg !== null &&
        safety.targetWeightKg !== null &&
        safety.targetLossKgPerWeek !== null &&
        safety.basisWeightDate !== null &&
        safety.targetDate !== null
      ) {
        const withinSixMonths =
          utcDate(safety.targetDate) <= addCalendarMonths(safety.basisWeightDate, 6);
        const lossFraction =
          (safety.basisWeightKg - safety.targetWeightKg) / safety.basisWeightKg;
        if (
          impliedWeeklyLoss !== null &&
          (impliedWeeklyLoss > 0.5 || (withinSixMonths && lossFraction > 0.1))
        ) {
          energyBlockers.push('speed-or-six-month-limit');
        }
      }
    }
  }

  let equationInputs: NutritionEquationInputs;
  if (canCalculateEquation(raw, shared)) {
    equationInputs = deriveEquationInputs(raw);
  } else if (raw.goals.fatLoss && safety.ageYears !== null && safety.ageYears < 19) {
    equationInputs = underageEquationInputs(raw);
  } else if (raw.goals.fatLoss) {
    equationInputs = uncalculatedEquationInputs(raw);
  } else {
    equationInputs = emptyEquationInputs();
  }
  let energyRange: ReturnType<typeof fatLossEnergyRange> | null = null;
  if (
    equationInputs.equationBranch !== 'unavailable' &&
    equationInputs.maintenanceEnergyLowKcal !== null &&
    equationInputs.maintenanceEnergyHighKcal !== null
  ) {
    energyRange = fatLossEnergyRange(
      equationInputs.maintenanceEnergyLowKcal,
      equationInputs.maintenanceEnergyHighKcal,
      equationInputs.equationBranch,
    );
    const floor = equationInputs.equationBranch === 'female' ? 1200 : 1500;
    if (energyRange.energyRawLowKcal < floor) {
      energyBlockers.push('energy-floor');
    }
  }

  const proteinEligible = raw.goals.muscleGain && proteinBlockers.length === 0;
  const energyEligible =
    raw.goals.fatLoss && energyBlockers.length === 0 && energyRange !== null;
  const targetRanges = emptyTargets();
  if (proteinEligible) {
    Object.assign(targetRanges, proteinTargetRange(safety.basisWeightKg!));
  }
  if (energyEligible) Object.assign(targetRanges, energyRange);

  const allBlockers = canonicalBlockers([...proteinBlockers, ...energyBlockers]);
  const protein = proteinEligible ? 'range' : 'disabled';
  const energy = energyEligible
    ? equation.activityCategoryHigh === null
      ? 'point'
      : 'range'
    : 'disabled';
  const evaluationPolicy: NutritionTargetMode['evaluationPolicy'] =
    protein !== 'disabled' && energy !== 'disabled'
      ? 'protein-range-and-energy-relative'
      : protein !== 'disabled'
        ? 'protein-range'
        : energy !== 'disabled'
          ? 'energy-relative'
          : 'neutral-intake-only';

  return {
    safetyInputs: {
      ...safety,
      eligibilityBlockers: allBlockers,
    },
    equationInputs,
    targetRanges,
    targetMode: {
      protein,
      energy,
      evaluationPolicy,
      autoTargetsEnabled: true,
      reason:
        protein !== 'disabled' || energy !== 'disabled'
          ? 'active'
          : 'eligibility-blocked',
    },
  };
}
