export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealItemMethod = 'preset' | 'manual' | 'label' | 'ai-confirmed';
export type NutritionQuality = 'A' | 'B';
export type EquationBranch = 'female' | 'male' | 'unavailable';
export type ActivityCategory = 'inactive' | 'low-active' | 'active' | 'very-active';
export type TrainingType = 'resistance' | 'cardio' | 'sport' | 'mobility' | 'mixed' | 'none';
export type FoodDataType = 'SR Legacy' | 'Foundation' | 'Survey (FNDDS)' | 'Branded';

export type NutritionEligibilityBlocker =
  | 'automatic-targets-disabled'
  | 'protein-age-under-18'
  | 'energy-age-under-19'
  | 'missing-inputs'
  | 'equation-branch-unavailable'
  | 'fat-loss-bmi-ineligible'
  | 'target-bmi-below-18.5'
  | 'pregnancy-or-breastfeeding'
  | 'therapeutic-diet-required'
  | 'kidney-or-complex-condition'
  | 'eating-disorder-or-reds-risk'
  | 'athlete-or-extreme-activity'
  | 'protein-weight-method-unverified'
  | 'energy-floor'
  | 'speed-or-six-month-limit';

export interface NutritionGoals {
  muscleGain: boolean;
  fatLoss: boolean;
}

export interface NutritionActivityInputs {
  assessmentStatus: 'not-provided' | 'complete';
  occupation:
    | 'mostly-seated'
    | 'mixed'
    | 'mostly-standing'
    | 'manual-labor'
    | 'not-provided';
  activeCommuteMinutesPerDay: number | null;
  householdMinutesPerDay: number | null;
  stepsPerDay: number | null;
  trainingTypes: TrainingType[];
  trainingSessionsPerWeek: number | null;
  trainingMinutesPerSession: number | null;
  trainingIntensity: 'light' | 'moderate' | 'vigorous' | 'mixed' | 'none' | 'not-provided';
}

export interface NutritionSafetyInputs {
  basisWeightKg: number | null;
  basisWeightDate: string | null;
  proteinWeightMethod: 'current-weight' | 'professional-reference-weight' | 'unverified' | null;
  ageYears: number | null;
  heightCm: number | null;
  targetWeightKg: number | null;
  targetLossKgPerWeek: number | null;
  targetDate: string | null;
  highBodyFatOrObesity: boolean | null;
  pregnantOrBreastfeeding: boolean | null;
  requiresTherapeuticDiet: boolean | null;
  kidneyDiseaseOrComplexCondition: boolean | null;
  eatingDisorderOrRedsRisk: boolean | null;
  athleteOrExtremeActivity: boolean | null;
  eligibilityStandard: 'WS/T 428—2013';
  eligibilityBlockers: NutritionEligibilityBlocker[];
}

export interface NutritionEquationInputs {
  equationName: 'NASEM-2023-adult-EER' | 'not-calculated';
  equationBranch: EquationBranch;
  activityInputs: NutritionActivityInputs;
  activityCategoryLow: ActivityCategory | null;
  activityCategoryHigh: ActivityCategory | null;
  maintenanceEnergyLowKcal: number | null;
  maintenanceEnergyHighKcal: number | null;
  calculatedAt: number | null;
}

export interface NutritionTargetRanges {
  proteinLowG: number | null;
  proteinHighG: number | null;
  proteinReferenceG: number | null;
  proteinLowCoefficient: number | null;
  proteinHighCoefficient: number | null;
  proteinReferenceCoefficient: number | null;
  energyLowKcal: number | null;
  energyHighKcal: number | null;
  energyRawLowKcal: number | null;
  energyRawHighKcal: number | null;
}

export interface NutritionTargetMode {
  protein: 'disabled' | 'range';
  energy: 'disabled' | 'point' | 'range';
  evaluationPolicy:
    | 'neutral-intake-only'
    | 'protein-range'
    | 'energy-relative'
    | 'protein-range-and-energy-relative';
  autoTargetsEnabled: boolean;
  reason: 'professional-review-pending' | 'eligibility-blocked' | 'active';
}

export interface NutritionPlan {
  id: string;
  effectiveFrom: string;
  goals: NutritionGoals;
  safetyInputs: NutritionSafetyInputs;
  standardVersion: string;
  equationInputs: NutritionEquationInputs;
  equationVersion: string;
  targetRanges: NutritionTargetRanges;
  targetMode: NutritionTargetMode;
  sourceVersion: string;
  proteinPolicySource: 'ISSN';
  proteinPolicyVersion: 'JISSN-2017-14-20';
  updatedAt: number;
  deletedAt: number | null;
}

export interface Food {
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
  fdcDataType: FoodDataType | null;
  sourceRetrievedAt: string | null;
  source: string;
  sourceVersion: string;
  license: string;
  preset: boolean;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Meal {
  id: string;
  date: string;
  slot: MealSlot;
  updatedAt: number;
  deletedAt: number | null;
}

export interface MealItem {
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
  basisAmount: number;
  basisUnit: 'g' | 'mL';
  ediblePortionRatio: number;
  densityGPerMl: number | null;
  conversionAssumptions: string[];
  fdcId: number | null;
  fdcDataType: FoodDataType | null;
  sourceRetrievedAt: string | null;
  source: string;
  sourceVersion: string;
  license: string;
  energyKcal: number;
  proteinG: number;
  energyKcalLow: number;
  energyKcalHigh: number;
  proteinGLow: number;
  proteinGHigh: number;
  assumptions: string[];
  uncertaintyModelVersion: string;
  method: MealItemMethod;
  quality: NutritionQuality;
  confirmedAt: number;
  order: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface MealPhoto {
  id: string;
  mealId: string;
  thumbnail: Blob;
  size: number;
  width: number;
  height: number;
  mealSnapshotHash: string;
  updatedAt: number;
}

export type MealEstimateStatus =
  | 'preprocessing'
  | 'awaiting-consent'
  | 'uploading'
  | 'estimating'
  | 'needs-confirmation'
  | 'confirmed'
  | 'failed';

export type MealEstimateErrorCode =
  | 'unsupported-file'
  | 'image-too-large'
  | 'decode-failed'
  | 'offline'
  | 'auth-required'
  | 'auth-expired'
  | 'quota-exceeded'
  | 'rate-limited'
  | 'service-disabled'
  | 'budget-exceeded'
  | 'consent-expired'
  | 'provider-timeout'
  | 'provider-unavailable'
  | 'invalid-estimate'
  | 'uncertain-food';

export type EstimateNutrientSource = 'catalog' | 'model-range' | 'none';

export interface MealEstimateCandidate {
  id: string;
  name: string;
  preparation: string;
  amountLow: number;
  amountHigh: number;
  unit: 'g' | 'mL';
  catalogFoodId: string | null;
  nutrientSource: EstimateNutrientSource;
  energyKcalLow: number | null;
  energyKcalHigh: number | null;
  proteinGLow: number | null;
  proteinGHigh: number | null;
  assumptions: string[];
}

export interface MealEstimateConsentBinding {
  uploadBlobSha256: string;
  requestId: string;
  providerPolicyVersion: string;
  consentedAt: number;
  expiresAt: number;
}

export interface MealEstimate {
  id: string;
  mealId: string;
  status: MealEstimateStatus;
  requestId: string;
  requestFingerprint: string | null;
  candidates: MealEstimateCandidate[];
  consent: MealEstimateConsentBinding | null;
  error: MealEstimateErrorCode | null;
  updatedAt: number;
}
