# Tiezheng Nutrition Backup v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the JSON backup contract from schema v2 to v3 so local nutrition plans, meals, confirmed meal items, and custom foods round-trip safely while photos, estimates, credentials, and preset assets remain local-only.

**Architecture:** Keep `exportData.ts` and `importData.ts` as the top-level snapshot and transaction coordinators. Put nutrition-only transport DTOs, whitelist serialization, and untrusted-input parsing in `nutritionBackup.ts`; put mode-specific photo/draft cleanup planning in `nutritionRestore.ts`. All destructive restore decisions are previewed, fingerprinted, reconfirmed inside the final Dexie transaction, and rejected if another tab changes the previewed state.

**Tech Stack:** TypeScript 5.8, Dexie 4, React 19, Vitest 3, Testing Library, fake-indexeddb, Vite PWA.

---

## Scope and prerequisite contract

This plan starts only after every task in `docs/superpowers/plans/2026-08-14-tiezheng-local-nutrition-core.md` has been implemented, its final verification has passed, and its final implementation commit is the current `HEAD`. The executor must record that immutable commit before making any backup change; this plan never relies on an uncommitted or partly implemented nutrition-core working tree. The following persistence tables must already exist on `db`: `nutritionPlans`, `foods`, `meals`, `mealItems`, `mealPhotos`, and `mealEstimates`. This plan does not build nutrition screens, food recognition, authentication, or an AI gateway.

The nutrition core must export these exact persistence fields from `src/lib/nutritionTypes.ts`:

```ts
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
  occupation: 'mostly-seated' | 'mixed' | 'mostly-standing' | 'manual-labor' | 'not-provided';
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
  fdcDataType: FoodDataType | null;
  sourceRetrievedAt: string | null;
  source: string;
  sourceVersion: string;
  license: string;
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
  | 'preprocessing' | 'awaiting-consent' | 'uploading' | 'estimating'
  | 'needs-confirmation' | 'confirmed' | 'failed';
export type MealEstimateErrorCode =
  | 'unsupported-file' | 'image-too-large' | 'decode-failed' | 'offline'
  | 'auth-required' | 'auth-expired' | 'quota-exceeded' | 'rate-limited'
  | 'provider-timeout' | 'provider-unavailable' | 'invalid-estimate' | 'uncertain-food';
export interface MealEstimateCandidate {
  id: string;
  name: string;
  preparation: string;
  amountLow: number;
  amountHigh: number;
  unit: 'g' | 'mL';
  catalogFoodId: string | null;
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
  requestFingerprint: string;
  candidates: MealEstimateCandidate[];
  consent: MealEstimateConsentBinding | null;
  error: MealEstimateErrorCode | null;
  updatedAt: number;
}
```

The core must also export `buildMealSnapshotHash(meal, items): Promise<string>` from `src/lib/mealSnapshot.ts` and `assertNutritionPlanSemantics(plan: NutritionPlan): void` from `src/lib/nutritionPlanValidation.ts`. The backup parser performs structural whitelist parsing first, reconstructs a complete transient `NutritionPlan` with stable `updatedAt: 0` and `deletedAt: null`, then invokes that shared semantic authority before accepting a row. For an active calculation the shared validator uses the preserved `equationInputs.calculatedAt` as the derivation timestamp; `updatedAt` is row metadata and may be re-stamped during restore without rewriting the historical calculation time. The contracts below are copied verbatim from that prerequisite plan. If the prerequisite implementation does not expose them exactly, stop this plan and repair the prerequisite in its own commit; do not add a synonym, mirror validator, or coordinate a field rename inside this backup change.

### Task 0: Pin the prerequisite commit and establish a clean baseline

**Files:**
- Verify: `docs/superpowers/plans/2026-08-14-tiezheng-local-nutrition-core.md`
- Verify: `src/lib/nutritionTypes.ts`
- Verify: `src/lib/mealSnapshot.ts`
- Verify: `src/lib/nutritionPlanValidation.ts`

- [ ] **Step 1: Install the lockfile-pinned dependencies**

Run:

```bash
npm ci
```

Expected: exit 0 with `package-lock.json` unchanged.

- [ ] **Step 2: Bind this execution to the completed core commit**

Run:

```bash
test -f docs/superpowers/plans/2026-08-14-tiezheng-local-nutrition-core.md
test -f src/lib/nutritionTypes.ts
test -f src/lib/mealSnapshot.ts
test -f src/lib/nutritionPlanValidation.ts
git status --short
git rev-parse HEAD
git log -1 --format='%H %s'
test "$(git log -1 --format='%s')" = "feat: show live nutrition summary on today"
```

Expected: the working tree is clean; the hash output identifies the final implementation commit produced by the local nutrition-core plan; its exact subject is `feat: show live nutrition summary on today`; and the final `test` exits 0. Copy the printed full hash into the execution notes before continuing. That recorded full hash is this execution's immutable nutrition-core prerequisite. If `HEAD` is not that final core commit, stop here.

- [ ] **Step 3: Run the repository baseline before changing the backup contract**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all three commands exit 0. A baseline failure belongs to the prerequisite and must be fixed in a separate commit before Task 1 begins.

## File structure

- Create `src/lib/nutritionBackup.ts` — backup DTOs, whitelist serializer, v0-v3 parser, reference validation.
- Create `src/lib/nutritionBackup.test.ts` — pure transport contract tests.
- Create `src/lib/nutritionRestore.ts` — mode-specific photo/draft cleanup plan, stable preview fingerprint, nutrition apply helpers.
- Create `src/lib/nutritionRestore.test.ts` — restore-plan and nutrition-apply tests.
- Modify `src/lib/exportData.ts` — schema version 3 and one-transaction nine-table export.
- Modify `src/lib/exportData.test.ts` — atomic snapshot and exclusion tests.
- Modify `src/lib/importData.ts` — v0-v3 candidate, preview, collision checks, full restore transaction.
- Modify `src/lib/importData.test.ts` — compatibility, merge/replace, rollback, idempotency tests.
- Modify `src/screens/profile/DataRestorePanel.tsx` — mode preview, draft/photo confirmations, stale-preview recovery.
- Modify `src/screens/profile/DataRestorePanel.test.tsx` — destructive preview interaction tests.
- Modify `src/screens/profile/ProfileScreen.tsx` — unencrypted health-data export disclosure.
- Modify `src/screens/profile/ProfileScreen.test.tsx` — disclosure test.
- Create `src/lib/dbVersionRace.test.ts` — v3/v4 open-connection and rollback safety tests.

### Task 1: Add the nutrition backup DTO and whitelist serializer

**Files:**
- Create: `src/lib/nutritionBackup.ts`
- Create: `src/lib/nutritionBackup.test.ts`

- [ ] **Step 1: Write the failing serializer test**

Create `src/lib/nutritionBackup.test.ts` with this content:

```ts
import { describe, expect, test } from 'vitest';
import type { Food, Meal, MealItem, NutritionPlan } from './nutritionTypes';
import { serializeNutritionSection } from './nutritionBackup';

const plan = {
  id: 'nutrition-plan:2026-08-14',
  effectiveFrom: '2026-08-14',
  goals: { muscleGain: true, fatLoss: false },
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
    },
    activityCategoryLow: null,
    activityCategoryHigh: null,
    maintenanceEnergyLowKcal: null,
    maintenanceEnergyHighKcal: null,
    calculatedAt: null,
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
  },
  targetMode: {
    protein: 'disabled',
    energy: 'disabled',
    evaluationPolicy: 'neutral-intake-only',
    autoTargetsEnabled: false,
    reason: 'professional-review-pending',
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
    const result = serializeNutritionSection({
      nutritionPlans: [plan, { ...plan, id: 'deleted-plan', deletedAt: 1 }],
      foods: [customFood, presetFood],
      meals: [meal, { ...meal, id: 'deleted-meal', deletedAt: 1 }],
      mealItems: [item, { ...item, id: 'orphan', mealId: 'deleted-meal' }],
    });

    expect(result.nutritionPlans).toEqual([
      {
        id: plan.id,
        effectiveFrom: plan.effectiveFrom,
        goals: plan.goals,
        safetyInputs: expectedSafetyInputs,
        standardVersion: plan.standardVersion,
        equationInputs: plan.equationInputs,
        equationVersion: plan.equationVersion,
        targetRanges: plan.targetRanges,
        targetMode: plan.targetMode,
        sourceVersion: plan.sourceVersion,
        proteinPolicySource: plan.proteinPolicySource,
        proteinPolicyVersion: plan.proteinPolicyVersion,
      },
    ]);
    expect(result.nutritionPlans[0].safetyInputs).not.toHaveProperty('privateSafetyField');
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
    expect(result.mealItems).toHaveLength(1);
    expect(result.mealItems[0]).not.toHaveProperty('updatedAt');
    expect(result.mealItems[0]).not.toHaveProperty('deletedAt');
    expect(result.mealItems[0]).not.toHaveProperty('privateFutureField');
  });
});
```

- [ ] **Step 2: Run the serializer test to verify RED**

Run:

```bash
npm test -- --run src/lib/nutritionBackup.test.ts
```

Expected: FAIL with `Failed to resolve import "./nutritionBackup"`.

- [ ] **Step 3: Implement the DTOs and whitelist serializer**

Create `src/lib/nutritionBackup.ts` with this content:

```ts
import type {
  Food,
  Meal,
  MealItem,
  NutritionPlan,
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
    .sort((a, b) => a.mealId.localeCompare(b.mealId) || a.order - b.order || a.id.localeCompare(b.id));

  return { nutritionPlans, foods, meals, mealItems };
}
```

- [ ] **Step 4: Run the serializer test to verify GREEN**

Run:

```bash
npm test -- --run src/lib/nutritionBackup.test.ts
npm run typecheck
```

Expected: PASS, 1 test; strict typecheck exits 0 with no unused imports.

- [ ] **Step 5: Commit the serializer contract**

```bash
npm run typecheck
git add src/lib/nutritionBackup.ts src/lib/nutritionBackup.test.ts
git commit -m "feat: define nutrition backup v3 payload"
```

### Task 2: Parse and validate nutrition backup data for v0-v3

**Files:**
- Modify: `src/lib/nutritionBackup.ts`
- Modify: `src/lib/nutritionBackup.test.ts`
- Create: `src/test/nutritionBackupFixtures.ts`

- [ ] **Step 1: Create named fixtures shared by all later tests**

Create `src/test/nutritionBackupFixtures.ts`:

```ts
import type { NutritionBackupSection } from '../lib/nutritionBackup';
import { nutritionPlanRow as coreNutritionPlanRow } from './nutritionFixtures';
import type {
  Food,
  Meal,
  MealEstimate,
  MealItem,
  MealPhoto,
  NutritionPlan,
} from '../lib/nutritionTypes';

export const nutritionPlanRow = (): NutritionPlan => ({
  id: 'nutrition-plan:2026-08-14', effectiveFrom: '2026-08-14',
  goals: { muscleGain: true, fatLoss: false },
  safetyInputs: {
    basisWeightKg: 70, basisWeightDate: '2026-08-14', proteinWeightMethod: 'current-weight',
    ageYears: 30, heightCm: 175,
    targetWeightKg: null, targetLossKgPerWeek: null, targetDate: null,
    highBodyFatOrObesity: false, pregnantOrBreastfeeding: false,
    requiresTherapeuticDiet: false, kidneyDiseaseOrComplexCondition: false,
    eatingDisorderOrRedsRisk: false, athleteOrExtremeActivity: false,
    eligibilityStandard: 'WS/T 428—2013',
    eligibilityBlockers: ['automatic-targets-disabled'],
  },
  standardVersion: 'nutrition-safety-v1',
  equationInputs: {
    equationName: 'not-calculated', equationBranch: 'unavailable',
    activityInputs: {
      assessmentStatus: 'not-provided',
      occupation: 'not-provided', activeCommuteMinutesPerDay: null,
      householdMinutesPerDay: null, stepsPerDay: null, trainingTypes: [],
      trainingSessionsPerWeek: null, trainingMinutesPerSession: null,
      trainingIntensity: 'not-provided',
    },
    activityCategoryLow: null, activityCategoryHigh: null,
    maintenanceEnergyLowKcal: null, maintenanceEnergyHighKcal: null, calculatedAt: null,
  },
  equationVersion: 'not-calculated-v1',
  targetRanges: {
    proteinLowG: null, proteinHighG: null, proteinReferenceG: null,
    proteinLowCoefficient: null, proteinHighCoefficient: null, proteinReferenceCoefficient: null,
    energyLowKcal: null, energyHighKcal: null,
    energyRawLowKcal: null, energyRawHighKcal: null,
  },
  targetMode: {
    protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only',
    autoTargetsEnabled: false, reason: 'professional-review-pending',
  }, sourceVersion: 'nutrition-policy-v1',
  proteinPolicySource: 'ISSN', proteinPolicyVersion: 'JISSN-2017-14-20',
  updatedAt: 99, deletedAt: null,
});

export const activePointNutritionPlanRow = (): NutritionPlan => {
  const plan = structuredClone(coreNutritionPlanRow());
  plan.equationInputs.activityCategoryHigh = null;
  plan.equationInputs.maintenanceEnergyHighKcal = plan.equationInputs.maintenanceEnergyLowKcal;
  plan.targetRanges.energyHighKcal = plan.targetRanges.energyLowKcal;
  plan.targetRanges.energyRawHighKcal = plan.targetRanges.energyRawLowKcal;
  plan.targetMode.energy = 'point';
  return plan;
};

export const activeRangeNutritionPlanRow = (): NutritionPlan => structuredClone(coreNutritionPlanRow());

export const customFoodRow = (): Food => ({
  id: 'food:custom:tofu-bowl', name: '豆腐饭', aliases: [], rawOrCooked: 'cooked',
  preparation: '清炒', originalEnergyValue: 130, originalEnergyUnit: 'kcal',
  originalProteinG: 8, originalBasisAmount: 100, originalBasisUnit: 'g',
  basisAmount: 100, basisUnit: 'g', energyKcal: 130, proteinG: 8,
  ediblePortionRatio: 1, densityGPerMl: null, conversionAssumptions: ['用户标签每 100 g'],
  fdcId: null, fdcDataType: null, sourceRetrievedAt: null,
  source: 'user-label', sourceVersion: '2026-08-14', license: 'user-provided',
  preset: false, updatedAt: 99, deletedAt: null,
});

export const presetFoodRow = (): Food => ({
  ...customFoodRow(), id: 'food:preset:rice-cooked', name: '熟米饭', preset: true,
});

export const mealRow = (): Meal => ({
  id: 'meal:2026-08-14:lunch', date: '2026-08-14', slot: 'lunch',
  updatedAt: 99, deletedAt: null,
});

export const mealItemRow = (): MealItem => ({
  id: 'meal-item:one', mealId: mealRow().id, name: '豆腐饭', preparation: '清炒',
  amount: 250, unit: 'g', originalEnergyValue: 130, originalEnergyUnit: 'kcal',
  originalProteinG: 8, originalBasisAmount: 100, originalBasisUnit: 'g',
  energyKcal: 130, proteinG: 8, energyKcalLow: 300, energyKcalHigh: 360,
  proteinGLow: 18, proteinGHigh: 22, assumptions: ['少油'],
  uncertaintyModelVersion: 'portion-v1', basisAmount: 100, basisUnit: 'g',
  ediblePortionRatio: 1, densityGPerMl: null, conversionAssumptions: ['用户标签每 100 g'],
  fdcId: null, fdcDataType: null, sourceRetrievedAt: null,
  source: 'user-label', sourceVersion: '2026-08-14', license: 'user-provided',
  method: 'manual', quality: 'B', confirmedAt: 100, order: 0,
  updatedAt: 101, deletedAt: null,
});

export const mealPhotoRow = (
  thumbnail: Blob = new Blob(['private']),
  mealSnapshotHash = 'different-hash',
): MealPhoto => ({
  id: `meal-photo:${mealRow().id}`, mealId: mealRow().id, thumbnail,
  size: thumbnail.size, width: 100, height: 100, mealSnapshotHash, updatedAt: 10,
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
    nutritionPlans: [{
      id: plan.id, effectiveFrom: plan.effectiveFrom, goals: plan.goals,
      safetyInputs: plan.safetyInputs, standardVersion: plan.standardVersion,
      equationInputs: plan.equationInputs, equationVersion: plan.equationVersion,
      targetRanges: plan.targetRanges, targetMode: plan.targetMode, sourceVersion: plan.sourceVersion,
      proteinPolicySource: plan.proteinPolicySource, proteinPolicyVersion: plan.proteinPolicyVersion,
    }],
    foods: [{
      id: food.id, name: food.name, aliases: food.aliases, rawOrCooked: food.rawOrCooked,
      preparation: food.preparation, originalEnergyValue: food.originalEnergyValue,
      originalEnergyUnit: food.originalEnergyUnit, originalProteinG: food.originalProteinG,
      originalBasisAmount: food.originalBasisAmount, originalBasisUnit: food.originalBasisUnit,
      basisAmount: food.basisAmount, basisUnit: food.basisUnit,
      energyKcal: food.energyKcal, proteinG: food.proteinG, source: food.source,
      ediblePortionRatio: food.ediblePortionRatio, densityGPerMl: food.densityGPerMl,
      conversionAssumptions: food.conversionAssumptions, fdcId: food.fdcId,
      fdcDataType: food.fdcDataType, sourceRetrievedAt: food.sourceRetrievedAt,
      sourceVersion: food.sourceVersion, license: food.license,
    }],
    meals: [{ id: meal.id, date: meal.date, slot: meal.slot }],
    mealItems: [{
      id: item.id, mealId: item.mealId, name: item.name, preparation: item.preparation,
      amount: item.amount, unit: item.unit, originalEnergyValue: item.originalEnergyValue,
      originalEnergyUnit: item.originalEnergyUnit, originalProteinG: item.originalProteinG,
      originalBasisAmount: item.originalBasisAmount, originalBasisUnit: item.originalBasisUnit,
      energyKcal: item.energyKcal, proteinG: item.proteinG, energyKcalLow: item.energyKcalLow,
      energyKcalHigh: item.energyKcalHigh, proteinGLow: item.proteinGLow,
      proteinGHigh: item.proteinGHigh, assumptions: item.assumptions,
      uncertaintyModelVersion: item.uncertaintyModelVersion, basisAmount: item.basisAmount,
      basisUnit: item.basisUnit, ediblePortionRatio: item.ediblePortionRatio,
      densityGPerMl: item.densityGPerMl, conversionAssumptions: item.conversionAssumptions,
      fdcId: item.fdcId, fdcDataType: item.fdcDataType,
      sourceRetrievedAt: item.sourceRetrievedAt, source: item.source, sourceVersion: item.sourceVersion,
      license: item.license, method: item.method, quality: item.quality,
      confirmedAt: item.confirmedAt, order: item.order,
    }],
  };
};
```

- [ ] **Step 2: Add failing compatibility and validation tests**

Append these imports and tests to `src/lib/nutritionBackup.test.ts`:

```ts
import { EMPTY_NUTRITION_BACKUP, parseNutritionSection } from './nutritionBackup';
import { buildNutritionPlan, impliedWeeklyLossKg, type NutritionPlanDraft } from './nutritionPlan';
import { assertNutritionPlanSemantics } from './nutritionPlanValidation';
import {
  activePointNutritionPlanRow,
  activeRangeNutritionPlanRow,
  nutritionBackupSectionFixture,
} from '../test/nutritionBackupFixtures';

function invalid(message: string): never {
  throw new Error(message);
}

const validV3 = nutritionBackupSectionFixture();

function serializedPlan(plan: NutritionPlan) {
  return serializeNutritionSection({ nutritionPlans: [plan], foods: [], meals: [], mealItems: [] });
}

function rebuildPlan(plan: NutritionPlan, edit: (draft: NutritionPlanDraft) => void): NutritionPlan {
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
  test.each([0, 1, 2])('v%i 缺少营养字段时归一为空数组', (version) => {
    expect(parseNutritionSection({}, version, invalid)).toEqual(EMPTY_NUTRITION_BACKUP);
  });

  test('v3 解析白名单数据并保持引用完整', () => {
    expect(parseNutritionSection(validV3, 3, invalid)).toEqual(validV3);
  });

  test('蛋白质政策来源和版本逐字段往返，未知值拒绝', () => {
    const parsed = parseNutritionSection(validV3, 3, invalid);
    expect(parsed.nutritionPlans[0]).toMatchObject({
      proteinPolicySource: 'ISSN',
      proteinPolicyVersion: 'JISSN-2017-14-20',
    });
    for (const [field, value] of [
      ['proteinPolicySource', 'unknown-source'],
      ['proteinPolicyVersion', 'latest'],
    ] as const) {
      const forged = structuredClone(validV3);
      Object.assign(forged.nutritionPlans[0] as unknown as Record<string, unknown>, { [field]: value });
      expect(() => parseNutritionSection(forged, 3, invalid)).toThrow('蛋白质政策');
    }
  });

  test('core 合法 point 计划真实 serialize → parse 往返', () => {
    const plan = activePointNutritionPlanRow();
    expect(() => assertNutritionPlanSemantics(plan)).not.toThrow();
    const serialized = serializedPlan(plan);

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
    expect(() => parseNutritionSection(serializedPlan(proteinOnly), 3, invalid)).not.toThrow();

    const speedBlocked = rebuildPlan(base, (draft) => {
      draft.goals = { muscleGain: false, fatLoss: true };
      draft.safetyInputs.basisWeightKg = 80;
      draft.safetyInputs.basisWeightDate = '2026-08-14';
      draft.safetyInputs.targetWeightKg = 72;
      draft.safetyInputs.targetDate = '2026-11-13';
      draft.safetyInputs.targetLossKgPerWeek = impliedWeeklyLossKg(80, 72, '2026-08-14', '2026-11-13');
    });
    expect(speedBlocked.safetyInputs.eligibilityBlockers).toContain('speed-or-six-month-limit');
    expect(speedBlocked.targetMode.energy).toBe('disabled');
    expect(() => parseNutritionSection(serializedPlan(speedBlocked), 3, invalid)).not.toThrow();
  });

  test('v3 拒绝反向、跨级活动范围和 point 端点/mode 不一致', () => {
    const reversed = serializedPlan(activeRangeNutritionPlanRow());
    reversed.nutritionPlans[0].equationInputs.activityCategoryLow = 'active';
    reversed.nutritionPlans[0].equationInputs.activityCategoryHigh = 'low-active';
    expect(() => parseNutritionSection(reversed, 3, invalid))
      .toThrow('activity categories must be an adjacent ascending range');

    const nonAdjacent = serializedPlan(activeRangeNutritionPlanRow());
    nonAdjacent.nutritionPlans[0].equationInputs.activityCategoryLow = 'inactive';
    nonAdjacent.nutritionPlans[0].equationInputs.activityCategoryHigh = 'active';
    expect(() => parseNutritionSection(nonAdjacent, 3, invalid))
      .toThrow('activity categories must be an adjacent ascending range');

    const unequalMaintenance = serializedPlan(activePointNutritionPlanRow());
    unequalMaintenance.nutritionPlans[0].equationInputs.maintenanceEnergyHighKcal! += 1;
    expect(() => parseNutritionSection(unequalMaintenance, 3, invalid))
      .toThrow('point 维持热量上下端点必须相同');

    const wrongMode = serializedPlan(activePointNutritionPlanRow());
    wrongMode.nutritionPlans[0].targetMode.energy = 'range';
    expect(() => parseNutritionSection(wrongMode, 3, invalid)).toThrow('energy range');

    const unequalTarget = serializedPlan(activePointNutritionPlanRow());
    unequalTarget.nutritionPlans[0].targetRanges.energyRawHighKcal! += 1;
    expect(() => parseNutritionSection(unequalTarget, 3, invalid)).toThrow('energy point');
  });

  test('v3 拒绝所有越界或门禁不一致的 active 计划', () => {
    const mutations: Array<(section: ReturnType<typeof serializedPlan>) => void> = [
      (section) => { section.nutritionPlans[0].safetyInputs.ageYears = 121; },
      (section) => { section.nutritionPlans[0].safetyInputs.heightCm = 99; },
      (section) => { section.nutritionPlans[0].safetyInputs.basisWeightKg = 300.01; },
      (section) => { section.nutritionPlans[0].safetyInputs.targetLossKgPerWeek = 0.5001; },
      (section) => { section.nutritionPlans[0].safetyInputs.targetLossKgPerWeek = 0.4999; },
      (section) => { section.nutritionPlans[0].safetyInputs.basisWeightDate = '2026-08-15'; },
      (section) => { section.nutritionPlans[0].safetyInputs.targetDate = '2026-08-14'; },
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
      (section) => { section.nutritionPlans[0].equationInputs.activityInputs.stepsPerDay = 100_001; },
    ];

    for (const mutate of mutations) {
      const malicious = serializedPlan(activeRangeNutritionPlanRow());
      mutate(malicious);
      expect(() => parseNutritionSection(malicious, 3, invalid)).toThrow();
    }
  });

  test('v3 拒绝未知字段、非有限数值和错误确定性 ID', () => {
    const unknown = structuredClone(validV3);
    Object.assign(unknown.meals[0], { privateFutureField: 'leak' });
    expect(() => parseNutritionSection(unknown, 3, invalid)).toThrow('餐次第 1 行包含未知字段');

    const infinite = structuredClone(validV3);
    infinite.mealItems[0].energyKcalHigh = Number.POSITIVE_INFINITY;
    expect(() => parseNutritionSection(infinite, 3, invalid)).toThrow('热量上界必须是有限数值');

    const wrongId = structuredClone(validV3);
    wrongId.meals[0].id = 'meal:2026-08-13:lunch';
    expect(() => parseNutritionSection(wrongId, 3, invalid)).toThrow('餐次 ID 与日期和餐次不一致');

    const presetNamespace = structuredClone(validV3);
    presetNamespace.foods[0].id = 'food:preset:rice-cooked';
    expect(() => parseNutritionSection(presetNamespace, 3, invalid))
      .toThrow('自定义食物 ID 必须使用 food:custom: 命名空间');
  });

  test('v3 拒绝重复业务键和孤儿条目', () => {
    const duplicate = structuredClone(validV3);
    duplicate.meals.push({ ...duplicate.meals[0] });
    expect(() => parseNutritionSection(duplicate, 3, invalid)).toThrow('餐次 ID 存在重复值');

    const orphan = structuredClone(validV3);
    orphan.mealItems[0].mealId = 'meal:2026-08-14:dinner';
    expect(() => parseNutritionSection(orphan, 3, invalid)).toThrow('餐食条目引用了不存在的餐次');
  });

  test('v3 逐字段校验计划枚举、有限数值、日期和跨字段关系', () => {
    const unknownNested = structuredClone(validV3);
    Object.assign(unknownNested.nutritionPlans[0].goals, { maintenance: true });
    expect(() => parseNutritionSection(unknownNested, 3, invalid))
      .toThrow('营养目标包含未知字段');

    const infiniteAge = structuredClone(validV3);
    infiniteAge.nutritionPlans[0].safetyInputs.ageYears = Number.POSITIVE_INFINITY;
    expect(() => parseNutritionSection(infiniteAge, 3, invalid)).toThrow('年龄必须是有限数值');

    const invalidDate = structuredClone(validV3);
    invalidDate.nutritionPlans[0].safetyInputs.basisWeightDate = '2026/08/14';
    expect(() => parseNutritionSection(invalidDate, 3, invalid)).toThrow('体重日期不是有效日期');

    const invalidEnum = structuredClone(validV3);
    Object.assign(invalidEnum.nutritionPlans[0].targetMode, { protein: 'point' });
    expect(() => parseNutritionSection(invalidEnum, 3, invalid)).toThrow('蛋白质目标模式不正确');

    const invalidWeightMethod = structuredClone(validV3);
    Object.assign(invalidWeightMethod.nutritionPlans[0].safetyInputs, {
      proteinWeightMethod: 'guessed-weight',
    });
    expect(() => parseNutritionSection(invalidWeightMethod, 3, invalid))
      .toThrow('蛋白质计算体重方法不正确');

    const invalidDisabledRanges = structuredClone(validV3);
    invalidDisabledRanges.nutritionPlans[0].targetRanges.proteinLowG = 100;
    expect(() => parseNutritionSection(invalidDisabledRanges, 3, invalid))
      .toThrow('protein mode/ranges');

    const invalidEquation = structuredClone(validV3);
    Object.assign(invalidEquation.nutritionPlans[0].equationInputs, {
      equationName: 'NASEM-2023-adult-EER',
    });
    expect(() => parseNutritionSection(invalidEquation, 3, invalid))
      .toThrow('NASEM 方程必须携带可用分支');

    const invalidActivity = structuredClone(validV3);
    invalidActivity.nutritionPlans[0].equationInputs.activityInputs.trainingTypes = [
      'none',
      'resistance',
    ];
    expect(() => parseNutritionSection(invalidActivity, 3, invalid))
      .toThrow('none 训练类型不得与其他类型并存');

    const invalidNormalization = structuredClone(validV3);
    invalidNormalization.foods[0].energyKcal = 999;
    expect(() => parseNutritionSection(invalidNormalization, 3, invalid))
      .toThrow('归一化营养密度与原始值');

    const incompleteFdc = structuredClone(validV3);
    incompleteFdc.foods[0].fdcId = 168878;
    expect(() => parseNutritionSection(incompleteFdc, 3, invalid))
      .toThrow('FDC ID 和数据类型必须同时有值');
  });
});
```

- [ ] **Step 3: Run the parser tests to verify RED**

Run:

```bash
npm test -- --run src/lib/nutritionBackup.test.ts
```

Expected: FAIL because `parseNutritionSection` is not exported.

- [ ] **Step 4: Add strict parser primitives and `parseNutritionSection`**

Replace the Task 1 `nutritionTypes` import with this parser-complete import, then add the shared core gate and date imports. This expansion happens only in Task 2, so the Task 1 commit remains clean under `noUnusedLocals`:

```ts
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
  NutritionEquationInputs,
  NutritionEligibilityBlocker,
  NutritionGoals,
  NutritionPlan,
  NutritionQuality,
  NutritionSafetyInputs,
  NutritionTargetMode,
  NutritionTargetRanges,
  TrainingType,
} from './nutritionTypes';
import { parseDate, toDateStr } from './dates';
import { assertNutritionPlanSemantics } from './nutritionPlanValidation';
```

Append this implementation to `src/lib/nutritionBackup.ts`:

```ts
type InvalidBackup = (message: string) => never;
type UnknownObject = { [key: string]: unknown };

const SLOTS = new Set<MealSlot>(['breakfast', 'lunch', 'dinner', 'snack']);
const RAW_OR_COOKED = new Set<BackupFood['rawOrCooked']>(['raw', 'cooked', 'not-applicable']);
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
const ACTIVITY_ASSESSMENT_STATUSES = new Set<NutritionActivityInputs['assessmentStatus']>([
  'not-provided',
  'complete',
]);
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
const ENERGY_MODES = new Set<NutritionTargetMode['energy']>(['disabled', 'point', 'range']);
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

const LIMITS = {
  plans: 3_660,
  foods: 5_000,
  meals: 36_600,
  items: 200_000,
  text: 500,
  assumptions: 30,
  aliases: 30,
} as const;

function objectValue(value: unknown, label: string, invalid: InvalidBackup): UnknownObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${label}格式不正确`);
  }
  return value as UnknownObject;
}

function arrayValue(
  value: unknown,
  label: string,
  max: number,
  invalid: InvalidBackup,
): Array<unknown> {
  if (!Array.isArray(value)) invalid(`${label}必须是数组`);
  if (value.length > max) invalid(`${label}数量超出范围`);
  return value;
}

function exactKeys(
  row: UnknownObject,
  allowed: readonly string[],
  label: string,
  invalid: InvalidBackup,
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(row).some((key) => !allowedSet.has(key))) invalid(`${label}包含未知字段`);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateStr(parseDate(date)) !== date) {
    invalid(`${label}不是有效日期`);
  }
  return date;
}

function finiteValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
  invalid: InvalidBackup,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${label}必须是有限数值`);
  if (value < min || value > max) invalid(`${label}超出范围`);
  return value;
}

function integerValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
  invalid: InvalidBackup,
): number {
  const number = finiteValue(value, label, min, max, invalid);
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
  max: number,
  invalid: InvalidBackup,
): string[] {
  return arrayValue(value, label, max, invalid).map((entry, index) =>
    textValue(entry, `${label}第 ${index + 1} 项`, invalid, { empty: true, max: LIMITS.text }),
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
  min: number,
  max: number,
  invalid: InvalidBackup,
): number | null {
  return value === null ? null : finiteValue(value, label, min, max, invalid);
}

function nullableIntegerValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
  invalid: InvalidBackup,
): number | null {
  return value === null ? null : integerValue(value, label, min, max, invalid);
}

function nullableDateValue(value: unknown, label: string, invalid: InvalidBackup): string | null {
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
  const eligibilityBlockers = arrayValue(
    row.eligibilityBlockers,
    '安全阻断原因',
    ELIGIBILITY_BLOCKERS.size,
    invalid,
  ).map((entry) => enumValue(entry, ELIGIBILITY_BLOCKERS, '安全阻断原因', invalid));
  unique(eligibilityBlockers, '安全阻断原因', invalid);
  const result: NutritionSafetyInputs = {
    basisWeightKg: nullableFiniteValue(row.basisWeightKg, '计算体重', 20, 300, invalid),
    basisWeightDate: nullableDateValue(row.basisWeightDate, '体重日期', invalid),
    proteinWeightMethod: nullableEnumValue(
      row.proteinWeightMethod,
      new Set<NonNullable<NutritionSafetyInputs['proteinWeightMethod']>>([
        'current-weight',
        'professional-reference-weight',
        'unverified',
      ]),
      '蛋白质计算体重方法',
      invalid,
    ),
    ageYears: nullableIntegerValue(row.ageYears, '年龄', 1, 120, invalid),
    heightCm: nullableFiniteValue(row.heightCm, '身高', 100, 250, invalid),
    targetWeightKg: nullableFiniteValue(row.targetWeightKg, '目标体重', 20, 300, invalid),
    targetLossKgPerWeek: nullableFiniteValue(
      row.targetLossKgPerWeek,
      '每周减重目标',
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
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
      new Set<NutritionSafetyInputs['eligibilityStandard']>(['WS/T 428—2013']),
      '适用性标准',
      invalid,
    ),
    eligibilityBlockers,
  };
  if ((result.basisWeightKg === null) !== (result.basisWeightDate === null)) {
    invalid('计算体重和体重日期必须同时有值或同时为空');
  }
  // Blocker semantics depend on goals and target mode. `parsePlan` delegates that
  // cross-field authority to `assertNutritionPlanSemantics` after all fields exist.
  return result;
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
  const trainingTypes = arrayValue(
    row.trainingTypes,
    '训练类型',
    TRAINING_TYPES.size,
    invalid,
  ).map((entry) => enumValue(entry, TRAINING_TYPES, '训练类型', invalid));
  unique(trainingTypes, '训练类型', invalid);
  if (trainingTypes.includes('none') && trainingTypes.length !== 1) {
    invalid('none 训练类型不得与其他类型并存');
  }
  const result: NutritionActivityInputs = {
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
    stepsPerDay: nullableIntegerValue(row.stepsPerDay, '每日步数', 0, 100_000, invalid),
    trainingTypes,
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
  if (result.assessmentStatus === 'not-provided') {
    if (result.occupation !== 'not-provided'
      || result.activeCommuteMinutesPerDay !== null
      || result.householdMinutesPerDay !== null
      || result.stepsPerDay !== null
      || result.trainingTypes.length !== 0
      || result.trainingSessionsPerWeek !== null
      || result.trainingMinutesPerSession !== null
      || result.trainingIntensity !== 'not-provided') {
      invalid('未提供活动问卷时必须使用规范的空值形态');
    }
  } else {
    if (result.occupation === 'not-provided'
      || result.trainingIntensity === 'not-provided'
      || result.activeCommuteMinutesPerDay === null
      || result.householdMinutesPerDay === null
      || result.stepsPerDay === null
      || result.trainingSessionsPerWeek === null
      || result.trainingMinutesPerSession === null
      || result.trainingTypes.length === 0) {
      invalid('完整活动问卷不得缺少任何字段');
    }
    const canonicalNone = result.trainingTypes.length === 1
      && result.trainingTypes[0] === 'none'
      && result.trainingSessionsPerWeek === 0
      && result.trainingMinutesPerSession === 0
      && result.trainingIntensity === 'none';
    if (result.trainingTypes.includes('none') !== canonicalNone) {
      invalid('无训练状态必须使用规范的 none/0 组合');
    }
  }
  return result;
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
  const result: NutritionEquationInputs = {
    equationName: enumValue(
      row.equationName,
      new Set<NutritionEquationInputs['equationName']>(['NASEM-2023-adult-EER', 'not-calculated']),
      '方程名称',
      invalid,
    ),
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
    calculatedAt: nullableIntegerValue(row.calculatedAt, '方程计算时间', 0, Number.MAX_SAFE_INTEGER, invalid),
  };
  const allCalculationFields = [
    result.activityCategoryLow,
    result.activityCategoryHigh,
    result.maintenanceEnergyLowKcal,
    result.maintenanceEnergyHighKcal,
    result.calculatedAt,
  ];
  if (result.equationName === 'not-calculated') {
    if (result.equationBranch !== 'unavailable'
      || allCalculationFields.some((entry) => entry !== null)) {
      invalid('未计算方程不得携带分支、活动分类、热量或计算时间');
    }
  } else {
    const requiredCalculationFields = [
      result.activityCategoryLow,
      result.maintenanceEnergyLowKcal,
      result.maintenanceEnergyHighKcal,
      result.calculatedAt,
    ];
    if (result.equationBranch === 'unavailable'
      || requiredCalculationFields.some((entry) => entry === null)) {
      invalid('NASEM 方程必须携带可用分支、活动分类下界、热量和计算时间');
    }
    if (result.maintenanceEnergyLowKcal! > result.maintenanceEnergyHighKcal!) {
      invalid('维持热量下界不得大于上界');
    }
    if (result.activityCategoryHigh === null
      && result.maintenanceEnergyLowKcal !== result.maintenanceEnergyHighKcal) {
      invalid('point 维持热量上下端点必须相同');
    }
  }
  return result;
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
    proteinReferenceG: nullableFiniteValue(row.proteinReferenceG, '蛋白质参考值', 0, 10_000, invalid),
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

function unique(values: string[], label: string, invalid: InvalidBackup): void {
  if (new Set(values).size !== values.length) invalid(`${label}存在重复值`);
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
  const id = textValue(row.id, '营养计划 ID', invalid, { max: 200 });
  if (id !== `nutrition-plan:${effectiveFrom}`) invalid('营养计划 ID 与生效日期不一致');
  const goals = parseGoals(row.goals, invalid);
  const safetyInputs = parseSafetyInputs(row.safetyInputs, invalid);
  const equationInputs = parseEquationInputs(row.equationInputs, invalid);
  const targetRanges = parseTargetRanges(row.targetRanges, invalid);
  const targetMode = parseTargetMode(row.targetMode, invalid);
  const proteinPolicySource = textValue(row.proteinPolicySource, '蛋白质政策来源', invalid);
  if (proteinPolicySource !== 'ISSN') invalid('蛋白质政策来源不正确');
  const proteinPolicyVersion = textValue(row.proteinPolicyVersion, '蛋白质政策版本', invalid);
  if (proteinPolicyVersion !== 'JISSN-2017-14-20') invalid('蛋白质政策版本不正确');
  const parsed: BackupNutritionPlan = {
    id,
    effectiveFrom,
    goals,
    safetyInputs,
    standardVersion: textValue(row.standardVersion, '筛查标准版本', invalid),
    equationInputs,
    equationVersion: textValue(row.equationVersion, '方程版本', invalid),
    targetRanges,
    targetMode,
    sourceVersion: textValue(row.sourceVersion, '营养政策版本', invalid),
    proteinPolicySource,
    proteinPolicyVersion,
  };
  try {
    assertNutritionPlanSemantics({ ...parsed, updatedAt: 0, deletedAt: null });
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
    originalEnergyValue: finiteValue(row.originalEnergyValue, `${label}原始热量`, 0, 1_000_000, invalid),
    originalEnergyUnit: enumValue(row.originalEnergyUnit, ENERGY_UNITS, `${label}原始热量单位`, invalid),
    originalProteinG: finiteValue(row.originalProteinG, `${label}原始蛋白质`, 0, 100_000, invalid),
    originalBasisAmount: finiteValue(row.originalBasisAmount, `${label}原始基准量`, 0.01, 100_000, invalid),
    originalBasisUnit: enumValue(row.originalBasisUnit, BASIS_UNITS, `${label}原始基准单位`, invalid),
    basisAmount: finiteValue(row.basisAmount, `${label}归一化基准量`, 0.01, 100_000, invalid),
    basisUnit: enumValue(row.basisUnit, BASIS_UNITS, `${label}归一化基准单位`, invalid),
    energyKcal: finiteValue(row.energyKcal, `${label}归一化热量`, 0, 100_000, invalid),
    proteinG: finiteValue(row.proteinG, `${label}归一化蛋白质`, 0, 10_000, invalid),
    ediblePortionRatio: finiteValue(row.ediblePortionRatio, `${label}可食部比例`, Number.MIN_VALUE, 1, invalid),
    densityGPerMl: nullableFiniteValue(row.densityGPerMl, `${label}密度`, Number.MIN_VALUE, 100, invalid),
    conversionAssumptions: stringArray(row.conversionAssumptions, `${label}换算假设`, LIMITS.assumptions, invalid),
    fdcId: nullableIntegerValue(row.fdcId, `${label} FDC ID`, 1, Number.MAX_SAFE_INTEGER, invalid),
    fdcDataType: nullableEnumValue(row.fdcDataType, FOOD_DATA_TYPES, `${label} FDC 数据类型`, invalid),
    sourceRetrievedAt: nullableDateValue(row.sourceRetrievedAt, `${label}数据获取日期`, invalid),
  };
  if ((result.fdcId === null) !== (result.fdcDataType === null)) {
    invalid(`${label} FDC ID 和数据类型必须同时有值或同时为空`);
  }
  if (result.fdcId !== null && result.sourceRetrievedAt === null) {
    invalid(`${label} FDC 数据必须记录获取日期`);
  }
  let normalizedAmountInOriginalUnit = result.basisAmount;
  if (result.originalBasisUnit !== result.basisUnit) {
    if (result.densityGPerMl === null) invalid(`${label}跨 g/mL 换算必须有正密度`);
    normalizedAmountInOriginalUnit = result.originalBasisUnit === 'g'
      ? result.basisAmount * result.densityGPerMl!
      : result.basisAmount / result.densityGPerMl!;
  }
  const factor = normalizedAmountInOriginalUnit / result.originalBasisAmount;
  const expectedEnergy = (result.originalEnergyUnit === 'kJ'
    ? result.originalEnergyValue / 4.184
    : result.originalEnergyValue) * factor;
  const expectedProtein = result.originalProteinG * factor;
  if (Math.abs(result.energyKcal - expectedEnergy) > 1e-6
    || Math.abs(result.proteinG - expectedProtein) > 1e-6) {
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
  const id = textValue(row.id, '食物 ID', invalid, { max: 200 });
  if (!id.startsWith('food:custom:') || id.length === 'food:custom:'.length) {
    invalid('自定义食物 ID 必须使用 food:custom: 命名空间');
  }
  const nutrientSnapshot = parseNutrientSnapshot(row, '食物', invalid);
  return {
    id,
    name: textValue(row.name, '食物名称', invalid, { max: 120 }),
    aliases: stringArray(row.aliases, '食物别名', LIMITS.aliases, invalid),
    rawOrCooked: enumValue(row.rawOrCooked, RAW_OR_COOKED, '食物生熟状态', invalid),
    preparation: textValue(row.preparation, '食物做法', invalid, { empty: true, max: 120 }),
    ...nutrientSnapshot,
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
  const id = textValue(row.id, '餐次 ID', invalid, { max: 200 });
  if (id !== `meal:${date}:${slot}`) invalid('餐次 ID 与日期和餐次不一致');
  return { id, date, slot };
}

function parseMealItem(value: unknown, index: number, invalid: InvalidBackup): BackupMealItem {
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
  const energyKcalLow = finiteValue(row.energyKcalLow, '热量下界', 0, 100_000, invalid);
  const energyKcalHigh = finiteValue(row.energyKcalHigh, '热量上界', 0, 100_000, invalid);
  const proteinGLow = finiteValue(row.proteinGLow, '蛋白质下界', 0, 10_000, invalid);
  const proteinGHigh = finiteValue(row.proteinGHigh, '蛋白质上界', 0, 10_000, invalid);
  if (energyKcalLow > energyKcalHigh) invalid('热量上下界顺序不正确');
  if (proteinGLow > proteinGHigh) invalid('蛋白质上下界顺序不正确');
  const nutrientSnapshot = parseNutrientSnapshot(row, '餐食条目', invalid);
  const amount = finiteValue(row.amount, '条目份量', 0.01, 100_000, invalid);
  const unit = enumValue(row.unit, BASIS_UNITS, '条目单位', invalid);
  let amountInBasisUnit = amount;
  if (unit !== nutrientSnapshot.basisUnit) {
    if (nutrientSnapshot.densityGPerMl === null) invalid('餐食条目跨 g/mL 份量换算必须有正密度');
    amountInBasisUnit = nutrientSnapshot.basisUnit === 'g'
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
    id: textValue(row.id, '餐食条目 ID', invalid, { max: 200 }),
    mealId: textValue(row.mealId, '餐次 ID', invalid, { max: 200 }),
    name: textValue(row.name, '条目名称', invalid, { max: 120 }),
    preparation: textValue(row.preparation, '条目做法', invalid, { empty: true, max: 120 }),
    amount,
    unit,
    ...nutrientSnapshot,
    energyKcalLow,
    energyKcalHigh,
    proteinGLow,
    proteinGHigh,
    assumptions: stringArray(row.assumptions, '条目假设', LIMITS.assumptions, invalid),
    uncertaintyModelVersion: textValue(row.uncertaintyModelVersion, '不确定性模型版本', invalid),
    source: textValue(row.source, '条目数据源', invalid),
    sourceVersion: textValue(row.sourceVersion, '条目数据版本', invalid),
    license: textValue(row.license, '条目数据许可', invalid),
    method: enumValue(row.method, METHODS, '记录方法', invalid),
    quality: enumValue(row.quality, QUALITIES, '数据质量', invalid),
    confirmedAt: integerValue(row.confirmedAt, '确认时间', 0, Number.MAX_SAFE_INTEGER, invalid),
    order: integerValue(row.order, '条目顺序', 0, 10_000, invalid),
  };
}

export function parseNutritionSection(
  source: unknown,
  schemaVersion: number,
  invalid: InvalidBackup,
): NutritionBackupSection {
  if (schemaVersion < 3) return EMPTY_NUTRITION_BACKUP;
  const root = objectValue(source, '营养备份', invalid);

  const nutritionPlans = arrayValue(root.nutritionPlans, '营养计划', LIMITS.plans, invalid)
    .map((row, index) => parsePlan(row, index, invalid));
  const foods = arrayValue(root.foods, '自定义食物', LIMITS.foods, invalid)
    .map((row, index) => parseFood(row, index, invalid));
  const meals = arrayValue(root.meals, '餐次', LIMITS.meals, invalid)
    .map((row, index) => parseMeal(row, index, invalid));
  const mealItems = arrayValue(root.mealItems, '餐食条目', LIMITS.items, invalid)
    .map((row, index) => parseMealItem(row, index, invalid));

  unique(nutritionPlans.map((row) => row.id), '营养计划 ID', invalid);
  unique(nutritionPlans.map((row) => row.effectiveFrom), '营养计划生效日期', invalid);
  unique(foods.map((row) => row.id), '自定义食物 ID', invalid);
  unique(meals.map((row) => row.id), '餐次 ID', invalid);
  unique(meals.map((row) => `${row.date}:${row.slot}`), '日期和餐次', invalid);
  unique(mealItems.map((row) => row.id), '餐食条目 ID', invalid);

  const mealIds = new Set(meals.map((row) => row.id));
  if (mealItems.some((row) => !mealIds.has(row.mealId))) {
    invalid('餐食条目引用了不存在的餐次');
  }

  return { nutritionPlans, foods, meals, mealItems };
}
```

- [ ] **Step 5: Run the parser tests to verify GREEN**

Run:

```bash
npm test -- --run src/lib/nutritionBackup.test.ts
npm run typecheck
```

Expected: PASS, including the three parameterized legacy cases, real point serialize→parse round-trip, hostile active-plan boundaries, and the shared core semantic gate; strict typecheck exits 0.

- [ ] **Step 6: Commit the parser and fixtures**

```bash
npm run typecheck
git add src/lib/nutritionBackup.ts src/lib/nutritionBackup.test.ts src/test/nutritionBackupFixtures.ts
git commit -m "feat: validate nutrition backup v3 input"
```

### Task 3: Upgrade exportData to schema v3 in one read transaction

**Files:**
- Modify: `src/lib/exportData.ts:1-120`
- Modify: `src/lib/exportData.test.ts:49-160`

- [ ] **Step 1: Write the failing v3 and atomic-snapshot tests**

Replace the schema-version assertion and the transaction-table assertion in `src/lib/exportData.test.ts`, then add the exclusion test:

```ts
import {
  customFoodRow,
  mealEstimateRow,
  mealItemRow,
  mealPhotoRow,
  mealRow,
  nutritionPlanRow,
  presetFoodRow,
} from '../test/nutritionBackupFixtures';

test('buildJsonExport：顶层声明备份格式 v3', async () => {
  const json = JSON.parse(await buildJsonExport());
  expect(json.schemaVersion).toBe(3);
});

test('buildJsonExport：一个只读事务读取全部九张可恢复表', async () => {
  const transaction = vi.spyOn(db, 'transaction');
  await buildJsonExport();
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(transaction.mock.calls[0]?.[0]).toBe('r');
  expect(transaction.mock.calls[0]?.[1]).toEqual([
    db.workouts,
    db.workoutItems,
    db.exercises,
    db.weightLogs,
    db.profile,
    db.nutritionPlans,
    db.foods,
    db.meals,
    db.mealItems,
  ]);
});

test('buildJsonExport：含营养白名单但排除图片、候选和内置目录', async () => {
  await db.nutritionPlans.add(nutritionPlanRow());
  await db.foods.bulkAdd([customFoodRow(), presetFoodRow()]);
  await db.meals.add(mealRow());
  await db.mealItems.add(mealItemRow());
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private-image'])));
  await db.mealEstimates.add(mealEstimateRow());

  const json = JSON.parse(await buildJsonExport());

  expect(json.nutritionPlans).toHaveLength(1);
  expect(json.foods.map((row: { id: string }) => row.id)).toEqual(['food:custom:tofu-bowl']);
  expect(json.meals).toHaveLength(1);
  expect(json.mealItems).toHaveLength(1);
  expect(json).not.toHaveProperty('photos');
  expect(json).not.toHaveProperty('mealPhotos');
  expect(json).not.toHaveProperty('mealEstimates');
});
```

- [ ] **Step 2: Run export tests to verify RED**

Run:

```bash
npm test -- --run src/lib/exportData.test.ts
```

Expected: FAIL because the exported version remains `2` and the transaction omits four nutrition tables.

- [ ] **Step 3: Wire the serializer into the existing atomic export**

Add this import and update the version in `src/lib/exportData.ts`:

```ts
import { serializeNutritionSection } from './nutritionBackup';

export const BACKUP_SCHEMA_VERSION = 3;
```

Replace the read transaction at `src/lib/exportData.ts:66-78` with:

```ts
  const [
    allWorkouts,
    allItems,
    allExercises,
    allWeightLogs,
    profileRows,
    allNutritionPlans,
    allFoods,
    allMeals,
    allMealItems,
  ] = await db.transaction(
    'r',
    [
      db.workouts,
      db.workoutItems,
      db.exercises,
      db.weightLogs,
      db.profile,
      db.nutritionPlans,
      db.foods,
      db.meals,
      db.mealItems,
    ],
    () => Promise.all([
      db.workouts.toArray(),
      db.workoutItems.toArray(),
      db.exercises.toArray(),
      db.weightLogs.toArray(),
      db.profile.toArray(),
      db.nutritionPlans.toArray(),
      db.foods.toArray(),
      db.meals.toArray(),
      db.mealItems.toArray(),
    ]),
  );

  const nutrition = serializeNutritionSection({
    nutritionPlans: allNutritionPlans,
    foods: allFoods,
    meals: allMeals,
    mealItems: allMealItems,
  });
```

Insert `...nutrition` immediately after `exportedAt` in the JSON object. Keep all existing training mappings unchanged:

```ts
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      ...nutrition,
```

- [ ] **Step 4: Run export tests to verify GREEN**

Run:

```bash
npm test -- --run src/lib/nutritionBackup.test.ts src/lib/exportData.test.ts
```

Expected: PASS for both files.

- [ ] **Step 5: Keep the v3 export change uncommitted until import, restore, and UI are compatible**

```bash
git status --short
git diff -- src/lib/exportData.ts src/lib/exportData.test.ts
```

Expected: the export changes are visible only in the working tree. Do not run `git add` or `git commit`: publishing a commit that writes schema v3 before the same commit can parse and restore it creates an unusable intermediate revision.

### Task 4: Extend import parsing and previews from v0 through v3

**Files:**
- Modify: `src/lib/importData.ts:1-334`
- Modify: `src/lib/importData.test.ts:16-229`

- [ ] **Step 1: Write failing v0-v3 candidate tests**

Add this fixture import and helper beside the existing `legacyBackup()` in `src/lib/importData.test.ts`:

```ts
import { nutritionBackupSectionFixture } from '../test/nutritionBackupFixtures';

function legacyBackupForVersion(schemaVersion: 0 | 1 | 2) {
  const legacy = structuredClone(legacyBackup());
  if (schemaVersion === 0) return legacy;
  const exercises = legacy.exercises.map((exercise) => ({
    ...exercise,
    loadMode: 'assistance' as const,
    ...(schemaVersion === 2 ? { archived: false } : {}),
  }));
  return { ...legacy, schemaVersion, exercises };
}

function v3Backup() {
  return {
    ...legacyBackupForVersion(2),
    schemaVersion: 3 as const,
    ...nutritionBackupSectionFixture(),
  };
}
```

Then add these tests under `describe('parseBackupFile')`:

First update the existing legacy preview's exact `toEqual` assertion so the four new counters are present rather than making every pre-v3 test fail:

```ts
expect(candidate.preview).toEqual({
  exportedAt: backup.exportedAt,
  workoutDays: 1,
  exercises: 1,
  sets: 2,
  weightLogs: 1,
  nutritionPlans: 0,
  nutritionDays: 0,
  meals: 0,
  mealItems: 0,
});
```

```ts
test.each([0, 1, 2] as const)('v%i 旧备份恢复为空营养段', async (schemaVersion) => {
  const backup = legacyBackupForVersion(schemaVersion);
  const candidate = await parseBackupFile(fileOf(backup));
  expect(candidate.data.nutritionPlans).toEqual([]);
  expect(candidate.data.foods).toEqual([]);
  expect(candidate.data.meals).toEqual([]);
  expect(candidate.data.mealItems).toEqual([]);
});

test('v3 解析营养数据并生成营养预览', async () => {
  const candidate = await parseBackupFile(fileOf(v3Backup()));
  expect(candidate.schemaVersion).toBe(3);
  expect(candidate.preview).toMatchObject({
    nutritionPlans: 1,
    nutritionDays: 1,
    meals: 1,
    mealItems: 1,
  });
  expect(candidate.data.meals[0].id).toBe('meal:2026-08-14:lunch');
});

test('v3 营养字段校验失败时整份文件拒绝', async () => {
  const backup = v3Backup();
  backup.mealItems[0].mealId = 'meal:2026-08-14:dinner';
  await expect(parseBackupFile(fileOf(backup))).rejects.toMatchObject({
    code: 'invalid-content',
  });
});

test('v4 备份仍按未来版本拒绝', async () => {
  await expect(parseBackupFile(fileOf({ ...v3Backup(), schemaVersion: 4 })))
    .rejects.toMatchObject({ code: 'future-version' });
});
```

- [ ] **Step 2: Run import parser tests to verify RED**

Run:

```bash
npm test -- --run src/lib/importData.test.ts
```

Expected: FAIL because schema `3` is unsupported and `RestoreCandidate` has no nutrition arrays.

- [ ] **Step 3: Expand the candidate and parser contract**

Add this import to `src/lib/importData.ts`:

```ts
import {
  parseNutritionSection,
  type NutritionBackupSection,
} from './nutritionBackup';
```

Change the affected declarations to:

```ts
export interface BackupPreview {
  exportedAt: string;
  workoutDays: number;
  exercises: number;
  sets: number;
  weightLogs: number;
  nutritionPlans: number;
  nutritionDays: number;
  meals: number;
  mealItems: number;
}

export interface RestoreCandidate {
  schemaVersion: 0 | 1 | 2 | 3;
  preview: BackupPreview;
  data: {
    workouts: BackupWorkout[];
    workoutItems: BackupWorkoutItem[];
    exercises: BackupExercise[];
    weightLogs: BackupWeightLog[];
    profile: BackupProfile[];
  } & NutritionBackupSection;
}
```

Change `schemaVersionOf` to return `0 | 1 | 2 | 3` and include `source.schemaVersion !== 3` in its rejection condition.

Immediately before the return in `parseBackupValue`, parse the nutrition section and derive its counts:

```ts
  const nutrition = parseNutritionSection(source, schemaVersion, invalid);
  const nutritionDays = new Set(nutrition.meals.map((meal) => meal.date)).size;
```

Then extend the return value:

```ts
    preview: {
      exportedAt,
      workoutDays: workouts.length,
      exercises: exercises.length,
      sets: workoutItems.reduce((sum, item) => sum + item.sets.length, 0),
      weightLogs: weightLogs.length,
      nutritionPlans: nutrition.nutritionPlans.length,
      nutritionDays,
      meals: nutrition.meals.length,
      mealItems: nutrition.mealItems.length,
    },
    data: { workouts, workoutItems, exercises, weightLogs, profile, ...nutrition },
```

- [ ] **Step 4: Run parser tests to verify GREEN**

Run:

```bash
npm test -- --run src/lib/nutritionBackup.test.ts src/lib/importData.test.ts
```

Expected: PASS for parsing tests; existing restore tests may still fail type-checking until Tasks 5 and 6 update their preview/approval calls.

- [ ] **Step 5: Keep parser integration in the same pending atomic change**

```bash
git status --short
git diff -- src/lib/importData.ts src/lib/importData.test.ts
```

Expected: `exportData` and `importData` changes both remain uncommitted. Do not commit while restore still ignores the parsed nutrition arrays.

### Task 5: Build mode-specific cleanup previews and nutrition restore helpers

**Files:**
- Create: `src/lib/nutritionRestore.ts`
- Create: `src/lib/nutritionRestore.test.ts`

- [ ] **Step 1: Write failing cleanup-plan tests**

Create `src/lib/nutritionRestore.test.ts` with these exact imports, `beforeEach(resetDb)`, and the five tests below:

```ts
import { resetDb } from '../test/dbTestUtils';
import {
  customFoodRow,
  mealEstimateRow,
  mealItemRow,
  mealPhotoRow,
  nutritionBackupSectionFixture,
  nutritionPlanRow,
  presetFoodRow,
} from '../test/nutritionBackupFixtures';
import { db } from './db';
import {
  applyNutritionRestore,
  assertNutritionMergeIdSafety,
  buildIncomingMealHashes,
  previewNutritionRestore,
} from './nutritionRestore';

beforeEach(resetDb);
```

```ts
test('merge 删除冲突照片和该餐候选', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  await db.mealPhotos.add({
    id: 'meal-photo:meal:2026-08-14:lunch',
    mealId: 'meal:2026-08-14:lunch',
    thumbnail: new Blob(['private']),
    size: 7,
    width: 100,
    height: 100,
    mealSnapshotHash: 'different-hash',
    updatedAt: 10,
  });
  await db.mealEstimates.add(mealEstimateRow());

  const preview = await previewNutritionRestore(section, 'merge', hashes);

  expect(preview.photoIdsToDelete).toEqual(['meal-photo:meal:2026-08-14:lunch']);
  expect(preview.estimateIdsToDelete).toEqual([mealEstimateRow().id]);
  expect(preview.fingerprint).toEqual(expect.any(String));
});

test('merge 对相同快照 hash 的本机照片保留且删除计数为零', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  const snapshotHash = hashes.get(section.meals[0].id)!;
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), snapshotHash));

  const preview = await previewNutritionRestore(section, 'merge', hashes);

  expect(preview.photoIdsToDelete).toEqual([]);
  expect(await db.mealPhotos.count()).toBe(1);
});

test('replace 删除备份中消失餐次的照片，merge 保留它', async () => {
  const empty = { nutritionPlans: [], foods: [], meals: [], mealItems: [] };
  await db.mealPhotos.add({
    id: 'meal-photo:meal:2026-08-13:dinner',
    mealId: 'meal:2026-08-13:dinner',
    thumbnail: new Blob(['private']),
    size: 7,
    width: 100,
    height: 100,
    mealSnapshotHash: 'local-hash',
    updatedAt: 10,
  });

  expect((await previewNutritionRestore(empty, 'merge', new Map())).photoIdsToDelete).toEqual([]);
  expect((await previewNutritionRestore(empty, 'replace', new Map())).photoIdsToDelete)
    .toEqual(['meal-photo:meal:2026-08-13:dinner']);
});

test('同一预览状态产生稳定指纹，本机候选状态变化后指纹变化', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  const first = await previewNutritionRestore(section, 'merge', hashes);
  const second = await previewNutritionRestore(section, 'merge', hashes);
  expect(second.fingerprint).toBe(first.fingerprint);

  await db.mealEstimates.add({
    ...mealEstimateRow(),
    candidates: [{
      id: 'candidate:one',
      name: '米饭',
      preparation: '熟',
      amountLow: 120,
      amountHigh: 180,
      unit: 'g',
      catalogFoodId: 'food:preset:rice-cooked',
    }],
  });
  const changed = await previewNutritionRestore(section, 'merge', hashes);
  expect(changed.fingerprint).not.toBe(first.fingerprint);
});

test('同一 meal ID 改变份量会改变候选摘要和预览指纹', async () => {
  const firstSection = nutritionBackupSectionFixture();
  const firstHashes = await buildIncomingMealHashes(firstSection);
  const first = await previewNutritionRestore(firstSection, 'merge', firstHashes);

  const changedSection = structuredClone(firstSection);
  changedSection.mealItems[0].amount += 25;
  const changedHashes = await buildIncomingMealHashes(changedSection);
  const changed = await previewNutritionRestore(changedSection, 'merge', changedHashes);

  expect(changedSection.meals[0].id).toBe(firstSection.meals[0].id);
  expect(changed.fingerprint).not.toBe(first.fingerprint);
});
```

- [ ] **Step 2: Run restore-helper tests to verify RED**

Run:

```bash
npm test -- --run src/lib/nutritionRestore.test.ts
```

Expected: FAIL with `Failed to resolve import "./nutritionRestore"`.

- [ ] **Step 3: Implement cleanup planning, collision safety, and application**

Create `src/lib/nutritionRestore.ts`:

```ts
import { db } from './db';
import { buildMealSnapshotHash } from './mealSnapshot';
import type { Food, Meal, MealEstimate, MealItem, NutritionPlan } from './nutritionTypes';
import type { NutritionBackupSection } from './nutritionBackup';

export type NutritionRestoreMode = 'merge' | 'replace';

export interface NutritionRestorePlan {
  fingerprint: string;
  photoIdsToDelete: string[];
  estimateIdsToDelete: string[];
}

type InvalidBackup = (message: string) => never;

export async function buildIncomingMealHashes(
  section: NutritionBackupSection,
): Promise<Map<string, string>> {
  const itemsByMeal = new Map<string, typeof section.mealItems>();
  for (const item of section.mealItems) {
    const rows = itemsByMeal.get(item.mealId) ?? [];
    rows.push(item);
    itemsByMeal.set(item.mealId, rows);
  }
  const hashes = new Map<string, string>();
  for (const meal of section.meals) {
    const completeMeal: Meal = { ...meal, updatedAt: 0, deletedAt: null };
    const completeItems: MealItem[] = [...(itemsByMeal.get(meal.id) ?? [])]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((item) => ({ ...item, updatedAt: 0, deletedAt: null }));
    hashes.set(meal.id, await buildMealSnapshotHash(completeMeal, completeItems));
  }
  return hashes;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as { [key: string]: unknown })
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function stableFingerprint(
  mode: NutritionRestoreMode,
  section: NutritionBackupSection,
  incomingHashes: Map<string, string>,
  photoIdsToDelete: string[],
  estimateIdsToDelete: string[],
  photos: Array<{ id: string; mealId: string; mealSnapshotHash: string; updatedAt: number }>,
  estimates: MealEstimate[],
): string {
  return JSON.stringify({
    mode,
    candidate: canonicalize({
      nutritionPlans: [...section.nutritionPlans].sort((a, b) => a.id.localeCompare(b.id)),
      foods: [...section.foods].sort((a, b) => a.id.localeCompare(b.id)),
      meals: [...section.meals].sort((a, b) => a.id.localeCompare(b.id)),
      mealItems: [...section.mealItems].sort((a, b) => a.id.localeCompare(b.id)),
    }),
    incomingHashes: [...incomingHashes.entries()].sort(([left], [right]) => left.localeCompare(right)),
    photoIdsToDelete: [...photoIdsToDelete].sort(),
    estimateIdsToDelete: [...estimateIdsToDelete].sort(),
    photos: photos
      .map((photo) => [photo.id, photo.mealId, photo.mealSnapshotHash, photo.updatedAt])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    estimates: estimates
      .map((estimate) => canonicalize({
        id: estimate.id,
        mealId: estimate.mealId,
        status: estimate.status,
        requestId: estimate.requestId,
        requestFingerprint: estimate.requestFingerprint,
        candidates: estimate.candidates,
        consent: estimate.consent,
        error: estimate.error,
        updatedAt: estimate.updatedAt,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

export async function calculateNutritionRestorePlan(
  section: NutritionBackupSection,
  mode: NutritionRestoreMode,
  incomingHashes: Map<string, string>,
): Promise<NutritionRestorePlan> {
  const [photos, estimates] = await Promise.all([
    db.mealPhotos.toArray(),
    db.mealEstimates.toArray(),
  ]);
  const incomingMealIds = new Set(section.meals.map((meal) => meal.id));
  const photoIdsToDelete = photos
    .filter((photo) => {
      const incomingHash = incomingHashes.get(photo.mealId);
      if (incomingHash !== undefined) return incomingHash !== photo.mealSnapshotHash;
      return mode === 'replace';
    })
    .map((photo) => photo.id)
    .sort();
  const estimateIdsToDelete = estimates
    .filter((estimate) => mode === 'replace' || incomingMealIds.has(estimate.mealId))
    .map((estimate) => estimate.id)
    .sort();
  return {
    fingerprint: stableFingerprint(
      mode,
      section,
      incomingHashes,
      photoIdsToDelete,
      estimateIdsToDelete,
      photos,
      estimates,
    ),
    photoIdsToDelete,
    estimateIdsToDelete,
  };
}

export async function previewNutritionRestore(
  section: NutritionBackupSection,
  mode: NutritionRestoreMode,
  incomingHashes: Map<string, string>,
): Promise<NutritionRestorePlan> {
  return db.transaction(
    'r',
    db.mealPhotos,
    db.mealEstimates,
    () => calculateNutritionRestorePlan(section, mode, incomingHashes),
  );
}

export async function assertNutritionMergeIdSafety(
  section: NutritionBackupSection,
  mode: NutritionRestoreMode,
  invalid: InvalidBackup,
): Promise<void> {
  const [currentFoods, currentPlans] = await Promise.all([
    db.foods.bulkGet(section.foods.map((food) => food.id)),
    db.nutritionPlans.toArray(),
  ]);

  for (const [index, current] of currentFoods.entries()) {
    if (!current) continue;
    if (current.preset) invalid('备份自定义食物 ID 与本机预设食物冲突');
    if (mode === 'merge') {
      const incoming = section.foods[index];
      const currentIdentity = canonicalize({
        id: current.id,
        name: current.name,
        aliases: current.aliases,
        rawOrCooked: current.rawOrCooked,
        preparation: current.preparation,
        originalEnergyValue: current.originalEnergyValue,
        originalEnergyUnit: current.originalEnergyUnit,
        originalProteinG: current.originalProteinG,
        originalBasisAmount: current.originalBasisAmount,
        originalBasisUnit: current.originalBasisUnit,
        basisAmount: current.basisAmount,
        basisUnit: current.basisUnit,
        energyKcal: current.energyKcal,
        proteinG: current.proteinG,
        ediblePortionRatio: current.ediblePortionRatio,
        densityGPerMl: current.densityGPerMl,
        conversionAssumptions: current.conversionAssumptions,
        fdcId: current.fdcId,
        fdcDataType: current.fdcDataType,
        sourceRetrievedAt: current.sourceRetrievedAt,
        source: current.source,
        sourceVersion: current.sourceVersion,
        license: current.license,
      });
      if (JSON.stringify(currentIdentity) !== JSON.stringify(canonicalize(incoming))) {
        invalid('备份自定义食物 ID 与本机不同食物业务身份冲突');
      }
    }
  }

  if (mode === 'merge') {
    for (const incoming of section.nutritionPlans) {
      const conflicts = currentPlans.some((current) =>
        (current.id === incoming.id && current.effectiveFrom !== incoming.effectiveFrom)
        || (current.effectiveFrom === incoming.effectiveFrom && current.id !== incoming.id));
      if (conflicts) {
        invalid('备份营养计划 ID 与本机不同计划业务身份冲突');
      }
    }

    const replaceableMealIds = new Set(section.meals.map((meal) => meal.id));
    const currentItems = await db.mealItems.bulkGet(section.mealItems.map((item) => item.id));
    if (currentItems.some(
      (item) => item && item.deletedAt === null && !replaceableMealIds.has(item.mealId),
    )) {
      invalid('备份餐食条目 ID 与本机非目标餐次冲突');
    }
  }
}

export async function applyNutritionRestore(
  section: NutritionBackupSection,
  mode: NutritionRestoreMode,
  plan: NutritionRestorePlan,
  now: number,
): Promise<void> {
  const incomingMealIds = section.meals.map((meal) => meal.id);

  if (plan.photoIdsToDelete.length > 0) await db.mealPhotos.bulkDelete(plan.photoIdsToDelete);
  if (plan.estimateIdsToDelete.length > 0) await db.mealEstimates.bulkDelete(plan.estimateIdsToDelete);

  if (mode === 'replace') {
    await db.mealItems.clear();
    await db.meals.clear();
    await db.nutritionPlans.clear();
    const customFoodIds = (await db.foods.toArray())
      .filter((food) => !food.preset)
      .map((food) => food.id);
    if (customFoodIds.length > 0) await db.foods.bulkDelete(customFoodIds);
  } else if (incomingMealIds.length > 0) {
    await db.mealItems.where('mealId').anyOf(incomingMealIds).delete();
    await db.meals.bulkDelete(incomingMealIds);
  }

  const nutritionPlans: NutritionPlan[] = section.nutritionPlans.map((row) => ({
    ...row,
    updatedAt: now,
    deletedAt: null,
  }));
  const meals: Meal[] = section.meals.map((row) => ({ ...row, updatedAt: now, deletedAt: null }));
  const mealItems: MealItem[] = section.mealItems.map((row) => ({
    ...row,
    updatedAt: now,
    deletedAt: null,
  }));

  const foods: Food[] = section.foods.map((row) => ({
    ...row,
    preset: false,
    updatedAt: now,
    deletedAt: null,
  }));

  if (nutritionPlans.length > 0) await db.nutritionPlans.bulkPut(nutritionPlans);
  if (foods.length > 0) await db.foods.bulkPut(foods);
  if (meals.length > 0) await db.meals.bulkPut(meals);
  if (mealItems.length > 0) await db.mealItems.bulkPut(mealItems);
}
```

- [ ] **Step 4: Add collision and physical-deletion tests**

Append to `src/lib/nutritionRestore.test.ts`:

```ts
test('merge 在写入前拒绝非目标餐次的 mealItem ID 碰撞', async () => {
  const section = nutritionBackupSectionFixture();
  await db.mealItems.add({
    ...mealItemRow(),
    id: section.mealItems[0].id,
    mealId: 'meal:2026-08-13:dinner',
  });
  expect.assertions(1);
  await expect(assertNutritionMergeIdSafety(section, 'merge', (message) => {
    throw new Error(message);
  })).rejects.toThrow('备份餐食条目 ID 与本机非目标餐次冲突');
});

test('任何模式都在写入前拒绝自定义食物 ID 碰撞本机预设', async () => {
  const section = nutritionBackupSectionFixture();
  await db.foods.add({ ...presetFoodRow(), id: section.foods[0].id });

  for (const mode of ['merge', 'replace'] as const) {
    await expect(assertNutritionMergeIdSafety(section, mode, (message) => {
      throw new Error(message);
    })).rejects.toThrow('备份自定义食物 ID 与本机预设食物冲突');
  }
});

test('merge 在写入前拒绝同 ID 但业务身份不同的自定义食物', async () => {
  const section = nutritionBackupSectionFixture();
  await db.foods.add({ ...customFoodRow(), name: '另一种食物' });

  await expect(assertNutritionMergeIdSafety(section, 'merge', (message) => {
    throw new Error(message);
  })).rejects.toThrow('备份自定义食物 ID 与本机不同食物业务身份冲突');
});

test('merge 允许同生效日营养计划由备份整体替换', async () => {
  const section = nutritionBackupSectionFixture();
  await db.nutritionPlans.add({
    ...nutritionPlanRow(),
    goals: { muscleGain: false, fatLoss: true },
  });

  await expect(assertNutritionMergeIdSafety(section, 'merge', (message) => {
    throw new Error(message);
  })).resolves.toBeUndefined();
});

test('applyNutritionRestore 物理删除预览指定的照片和候选', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
  await db.mealEstimates.add(mealEstimateRow());
  const plan = await previewNutritionRestore(section, 'merge', hashes);

  await db.transaction(
    'rw',
    [
      db.nutritionPlans,
      db.foods,
      db.meals,
      db.mealItems,
      db.mealPhotos,
      db.mealEstimates,
    ],
    () => applyNutritionRestore(section, 'merge', plan, 100),
  );

  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);
  expect(await db.meals.get(section.meals[0].id)).toBeDefined();
});
```

- [ ] **Step 5: Run restore-helper tests to verify GREEN**

Run:

```bash
npm test -- --run src/lib/nutritionRestore.test.ts
```

Expected: PASS, 10 tests, including the true same-snapshot photo-retention case.

- [ ] **Step 6: Keep restore helpers pending with the atomic v3 integration**

```bash
git status --short
git diff -- src/lib/nutritionRestore.ts src/lib/nutritionRestore.test.ts
```

Expected: helper files are present and tests pass, but no commit is created while the top-level restore coordinator still lacks approval integration.

### Task 6: Integrate preview approval and all-table rollback into importData

**Files:**
- Modify: `src/lib/importData.ts:17-492`
- Modify: `src/lib/importData.test.ts:231-434`

- [ ] **Step 1: Add failing preview, stale-state, collision, and rollback tests**

Replace the `./importData` import and add the fixture import near the top of `src/lib/importData.test.ts`:

```ts
import {
  MAX_BACKUP_BYTES,
  parseBackupFile,
  previewRestore,
  restoreBackup,
  type RestoreCandidate,
  type RestoreMode,
} from './importData';
import {
  activePointNutritionPlanRow,
  customFoodRow,
  mealEstimateRow,
  mealItemRow,
  mealPhotoRow,
  nutritionPlanRow,
} from '../test/nutritionBackupFixtures';
import { serializeNutritionSection } from './nutritionBackup';
```

Add this helper beside `tableSnapshot()`:

```ts
async function restoreWithCurrentPreview(candidate: RestoreCandidate, mode: RestoreMode) {
  const preview = await previewRestore(candidate, mode);
  return restoreBackup(candidate, mode, {
    previewFingerprint: preview.fingerprint,
    allowPhotoDeletion: preview.mealPhotosToDelete > 0,
    allowEstimateDiscard: preview.mealEstimatesToDiscard > 0,
  });
}
```

Replace **every one** of the twelve pre-existing two-argument restore calls in `src/lib/importData.test.ts` with `restoreWithCurrentPreview(...)`: merge success, both idempotent merges, all three merge-collision rejections, preset-preservation merge, deleted-exercise replace, full replace, profile-less replace, optional-profile merge, and transaction-rollback replace. Collision tests must also obtain a current approval first so they reach the intended collision guard instead of failing at the new API boundary. Parser-only rejection tests do not call `restoreBackup` and remain unchanged.

After the mechanical replacement, run:

```bash
rg -n "restoreBackup\([^,]+,\s*'(merge|replace)'\s*\)" src/lib/importData.test.ts
```

Expected: no output. The only direct `restoreBackup` calls left in this test file are the new deliberate three-argument stale-preview and confirmation cases shown below.

Then add:

```ts
test('越界 active 营养计划在解析阶段拒绝且数据库逐表不变', async () => {
  const malicious = v3Backup();
  malicious.nutritionPlans = serializeNutritionSection({
    nutritionPlans: [activePointNutritionPlanRow()],
    foods: [],
    meals: [],
    mealItems: [],
  }).nutritionPlans;
  malicious.nutritionPlans[0].safetyInputs.ageYears = 121;
  await db.nutritionPlans.add(nutritionPlanRow());
  const before = await tableSnapshot();

  await expect(parseBackupFile(fileOf(malicious))).rejects.toThrow('年龄超出范围');
  expect(await tableSnapshot()).toEqual(before);
});

test('预览分别报告将删除的餐食缩略图和未保存候选', async () => {
  const candidate = await parseBackupFile(fileOf(v3Backup()));
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
  await db.mealEstimates.add(mealEstimateRow());

  const preview = await previewRestore(candidate, 'merge');

  expect(preview.mealPhotosToDelete).toBe(1);
  expect(preview.mealEstimatesToDiscard).toBe(1);
  expect(preview.fingerprint).toEqual(expect.any(String));
});

test('预览后照片状态变化会拒绝恢复且不改数据库', async () => {
  const candidate = await parseBackupFile(fileOf(v3Backup()));
  const preview = await previewRestore(candidate, 'merge');
  await db.mealPhotos.add(mealPhotoRow(new Blob(['new-private']), 'new-hash'));
  const before = await tableSnapshot();

  await expect(restoreBackup(candidate, 'merge', {
    previewFingerprint: preview.fingerprint,
    allowPhotoDeletion: true,
    allowEstimateDiscard: true,
  })).rejects.toMatchObject({ code: 'restore-preview-stale' });
  expect(await tableSnapshot()).toEqual(before);
});

test.each([
  ['训练', async () => {
    await db.workouts.add({
      id: 'workout:after-replace-preview',
      date: '2026-08-13',
      updatedAt: 20,
      deletedAt: null,
    });
  }],
  ['营养', async () => {
    await db.foods.add({
      ...customFoodRow(),
      id: 'food:custom:after-replace-preview',
      name: '预览后新增食物',
      updatedAt: 20,
    });
  }],
] as const)('replace 预览后新增%s行会拒绝恢复且完整保留数据库', async (_label, mutate) => {
  const candidate = await parseBackupFile(fileOf(v3Backup()));
  const preview = await previewRestore(candidate, 'replace');
  await mutate();
  const before = await tableSnapshot();

  await expect(restoreBackup(candidate, 'replace', {
    previewFingerprint: preview.fingerprint,
    allowPhotoDeletion: true,
    allowEstimateDiscard: true,
  })).rejects.toMatchObject({ code: 'restore-preview-stale' });
  expect(await tableSnapshot()).toEqual(before);
});

test.each([
  ['同餐 mealItem', async (candidate: RestoreCandidate) => {
    await db.mealItems.add({
      ...mealItemRow(),
      id: 'meal-item:after-merge-preview',
      mealId: candidate.data.meals[0].id,
      order: 99,
      updatedAt: 21,
    });
  }],
  ['同日训练', async (candidate: RestoreCandidate) => {
    await db.workouts.add({
      id: 'workout:after-merge-preview',
      date: candidate.data.workouts[0].date,
      updatedAt: 21,
      deletedAt: null,
    });
  }],
] as const)('merge 预览后新增%s会 stale 且完整保留数据库', async (_label, mutate) => {
  const candidate = await parseBackupFile(fileOf(v3Backup()));
  const preview = await previewRestore(candidate, 'merge');
  await mutate(candidate);
  const before = await tableSnapshot();

  await expect(restoreBackup(candidate, 'merge', {
    previewFingerprint: preview.fingerprint,
    allowPhotoDeletion: true,
    allowEstimateDiscard: true,
  })).rejects.toMatchObject({ code: 'restore-preview-stale' });
  expect(await tableSnapshot()).toEqual(before);
});

test('同一 meal ID 改变份量后旧批准指纹失效且不改数据库', async () => {
  const original = await parseBackupFile(fileOf(v3Backup()));
  const approved = await previewRestore(original, 'merge');
  const changedBackup = v3Backup();
  changedBackup.mealItems[0].amount += 25;
  const changedCandidate = await parseBackupFile(fileOf(changedBackup));
  const before = await tableSnapshot();

  await expect(restoreBackup(changedCandidate, 'merge', {
    previewFingerprint: approved.fingerprint,
    allowPhotoDeletion: true,
    allowEstimateDiscard: true,
  })).rejects.toMatchObject({ code: 'restore-preview-stale' });
  expect(await tableSnapshot()).toEqual(before);
});

test('未独立确认时不得删除缩略图或候选', async () => {
  const candidate = await parseBackupFile(fileOf(v3Backup()));
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
  const preview = await previewRestore(candidate, 'merge');

  await expect(restoreBackup(candidate, 'merge', {
    previewFingerprint: preview.fingerprint,
    allowPhotoDeletion: false,
    allowEstimateDiscard: true,
  })).rejects.toMatchObject({ code: 'photo-confirmation-required' });
  expect(await db.mealPhotos.count()).toBe(1);
});

test.each(['custom-food', 'nutrition-plan'] as const)(
  '%s 业务身份碰撞在首次写入前拒绝并完整保留数据库',
  async (collision) => {
    const candidate = await parseBackupFile(fileOf(v3Backup()));
    if (collision === 'custom-food') {
      await db.foods.add({ ...customFoodRow(), name: '本机另一种食物' });
    } else {
      await db.nutritionPlans.add({
        ...nutritionPlanRow(),
        goals: { muscleGain: false, fatLoss: true },
      });
    }
    const preview = await previewRestore(candidate, 'merge');
    const before = await tableSnapshot();

    await expect(restoreBackup(candidate, 'merge', {
      previewFingerprint: preview.fingerprint,
      allowPhotoDeletion: true,
      allowEstimateDiscard: true,
    })).rejects.toMatchObject({ code: 'invalid-content' });
    expect(await tableSnapshot()).toEqual(before);
  },
);

test('非空 v3 营养备份重复 merge 幂等，第二次预览的删除计数归零', async () => {
  const candidate = await parseBackupFile(fileOf(v3Backup()));
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'conflicting-hash'));
  await db.mealEstimates.add(mealEstimateRow());

  const firstPreview = await previewRestore(candidate, 'merge');
  expect(firstPreview.mealPhotosToDelete).toBe(1);
  expect(firstPreview.mealEstimatesToDiscard).toBe(1);
  await restoreBackup(candidate, 'merge', {
    previewFingerprint: firstPreview.fingerprint,
    allowPhotoDeletion: true,
    allowEstimateDiscard: true,
  });

  const secondPreview = await previewRestore(candidate, 'merge');
  expect(secondPreview.mealPhotosToDelete).toBe(0);
  expect(secondPreview.mealEstimatesToDiscard).toBe(0);
  await restoreBackup(candidate, 'merge', {
    previewFingerprint: secondPreview.fingerprint,
    allowPhotoDeletion: false,
    allowEstimateDiscard: false,
  });

  expect(await db.nutritionPlans.count()).toBe(1);
  expect((await db.foods.toArray()).filter((food) => !food.preset)).toHaveLength(1);
  expect(await db.meals.count()).toBe(1);
  expect(await db.mealItems.count()).toBe(1);
});

test.each(['merge', 'replace'] as const)('%s 中途失败回滚训练、营养、候选和照片', async (mode) => {
  const candidate = await parseBackupFile(fileOf(v3Backup()));
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
  await db.mealEstimates.add(mealEstimateRow());
  const preview = await previewRestore(candidate, mode);
  const before = await tableSnapshot();
  vi.spyOn(db.mealItems, 'bulkPut').mockRejectedValueOnce(new Error('boom'));

  await expect(restoreBackup(candidate, mode, {
    previewFingerprint: preview.fingerprint,
    allowPhotoDeletion: true,
    allowEstimateDiscard: true,
  })).rejects.toMatchObject({ code: 'restore-failed' });
  expect(await tableSnapshot()).toEqual(before);
});
```

Replace `tableSnapshot()` with this single-transaction snapshot. It excludes Blob bytes while retaining every persisted non-byte field needed to prove rollback:

```ts
function byId<T extends { id: string }>(rows: T[]): T[] {
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

async function tableSnapshot() {
  return db.transaction(
    'r',
    [
      db.workouts,
      db.workoutItems,
      db.exercises,
      db.weightLogs,
      db.photos,
      db.profile,
      db.nutritionPlans,
      db.foods,
      db.meals,
      db.mealItems,
      db.mealPhotos,
      db.mealEstimates,
    ],
    async () => ({
      workouts: byId(await db.workouts.toArray()),
      workoutItems: byId(await db.workoutItems.toArray()),
      exercises: byId(await db.exercises.toArray()),
      weightLogs: byId(await db.weightLogs.toArray()),
      photos: byId((await db.photos.toArray()).map(
        ({ id, date, size, updatedAt, deletedAt }) => ({ id, date, size, updatedAt, deletedAt }),
      )),
      profile: byId(await db.profile.toArray()),
      nutritionPlans: byId(await db.nutritionPlans.toArray()),
      foods: byId(await db.foods.toArray()),
      meals: byId(await db.meals.toArray()),
      mealItems: byId(await db.mealItems.toArray()),
      mealPhotos: byId((await db.mealPhotos.toArray()).map(
        ({ id, mealId, size, width, height, mealSnapshotHash, updatedAt }) => ({
          id,
          mealId,
          size,
          width,
          height,
          mealSnapshotHash,
          updatedAt,
        }),
      )),
      mealEstimates: byId(await db.mealEstimates.toArray()),
    }),
  );
}
```

- [ ] **Step 2: Run restore tests to verify RED**

Run:

```bash
npm test -- --run src/lib/importData.test.ts
```

Expected: FAIL because `previewRestore`, approval types, and destructive confirmation error codes do not exist.

- [ ] **Step 3: Add preview and approval contracts**

Add these imports to `src/lib/importData.ts`:

```ts
import Dexie from 'dexie';
import {
  applyNutritionRestore,
  assertNutritionMergeIdSafety,
  buildIncomingMealHashes,
  calculateNutritionRestorePlan,
  type NutritionRestorePlan,
} from './nutritionRestore';
import { stableJson } from './stableJson';
```

Extend `BackupErrorCode`:

```ts
  | 'restore-preview-stale'
  | 'photo-confirmation-required'
  | 'draft-confirmation-required'
```

Add these exported interfaces after `RestoreCandidate`:

```ts
export interface ModeRestorePreview extends BackupPreview {
  fingerprint: string;
  mealPhotosToDelete: number;
  mealEstimatesToDiscard: number;
}

export interface RestoreApproval {
  previewFingerprint: string;
  allowPhotoDeletion: boolean;
  allowEstimateDiscard: boolean;
}
```

Add these helpers and `previewRestore` before `restoreBackup`. The approval fingerprint for both merge and replace must bind the complete current rows of all 11 tables in the restore transaction. This is intentionally conservative: a concurrent change that would be preserved also invalidates approval, while no change that could be overwritten or deleted can slip through. The only Blob in those 11 tables is `mealPhotos.thumbnail`; bind its MIME type, byte size, and SHA-256 rather than dropping its bytes. `Dexie.waitFor` keeps the IndexedDB transaction alive while the native digest promises settle:

```ts
interface CalculatedRestoreApprovalPlan {
  fingerprint: string;
  nutritionPlan: NutritionRestorePlan;
}

const restoreTables = () => [
  db.workouts,
  db.workoutItems,
  db.exercises,
  db.weightLogs,
  db.profile,
  db.nutritionPlans,
  db.foods,
  db.meals,
  db.mealItems,
  db.mealPhotos,
  db.mealEstimates,
] as const;

function sortedById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function thumbnailFingerprint(thumbnail: Blob) {
  const sha256 = await Dexie.waitFor((async () => {
    const bytes = await thumbnail.arrayBuffer();
    return hex(await crypto.subtle.digest('SHA-256', bytes));
  })());
  return { type: thumbnail.type, size: thumbnail.size, sha256 };
}

async function snapshotRestoreLocalState() {
  const [
    workouts,
    workoutItems,
    exercises,
    weightLogs,
    profile,
    nutritionPlans,
    foods,
    meals,
    mealItems,
    mealPhotos,
    mealEstimates,
  ] = await Promise.all([
    db.workouts.toArray(),
    db.workoutItems.toArray(),
    db.exercises.toArray(),
    db.weightLogs.toArray(),
    db.profile.toArray(),
    db.nutritionPlans.toArray(),
    db.foods.toArray(),
    db.meals.toArray(),
    db.mealItems.toArray(),
    db.mealPhotos.toArray(),
    db.mealEstimates.toArray(),
  ]);
  const mealPhotoRows = await Promise.all(mealPhotos.map(async ({ thumbnail, ...row }) => ({
    ...row,
    thumbnail: await thumbnailFingerprint(thumbnail),
  })));
  return {
    workouts: sortedById(workouts),
    workoutItems: sortedById(workoutItems),
    exercises: sortedById(exercises),
    weightLogs: sortedById(weightLogs),
    profile: sortedById(profile),
    nutritionPlans: sortedById(nutritionPlans),
    foods: sortedById(foods),
    meals: sortedById(meals),
    mealItems: sortedById(mealItems),
    mealPhotos: sortedById(mealPhotoRows),
    mealEstimates: sortedById(mealEstimates),
  };
}

async function calculateRestoreApprovalPlan(
  candidate: RestoreCandidate,
  mode: RestoreMode,
  hashes: Map<string, string>,
): Promise<CalculatedRestoreApprovalPlan> {
  const nutritionPlan = await calculateNutritionRestorePlan(candidate.data, mode, hashes);
  const localState = await snapshotRestoreLocalState();
  return {
    fingerprint: stableJson({
      version: 'restore-preview-v2',
      mode,
      candidate: candidate.data,
      nutritionFingerprint: nutritionPlan.fingerprint,
      localState,
    }),
    nutritionPlan,
  };
}

export async function previewRestore(
  candidate: RestoreCandidate,
  mode: RestoreMode,
): Promise<ModeRestorePreview> {
  const hashes = await buildIncomingMealHashes(candidate.data);
  return db.transaction('r', restoreTables(), async () => {
    const plan = await calculateRestoreApprovalPlan(candidate, mode, hashes);
    return {
      ...candidate.preview,
      fingerprint: plan.fingerprint,
      mealPhotosToDelete: plan.nutritionPlan.photoIdsToDelete.length,
      mealEstimatesToDiscard: plan.nutritionPlan.estimateIdsToDelete.length,
    };
  });
}
```

`snapshotRestoreLocalState()` is called only from an ambient transaction containing all 11 tables. Thus both modes derive approval from one read-only IndexedDB snapshot, not eleven independent reads. Binding the same full state in merge prevents a same-meal `mealItem` or same-day workout inserted after preview from being silently deleted or replaced.

- [ ] **Step 4: Replace restoreBackup with the approved full transaction**

Replace `restoreBackup` at `src/lib/importData.ts:470-492` with:

```ts
export async function restoreBackup(
  candidate: RestoreCandidate,
  mode: RestoreMode,
  approval: RestoreApproval,
): Promise<{ workoutDays: number; nutritionDays: number }> {
  const hashes = await buildIncomingMealHashes(candidate.data);
  try {
    await db.transaction(
      'rw',
      [
        db.workouts,
        db.workoutItems,
        db.exercises,
        db.weightLogs,
        db.profile,
        db.nutritionPlans,
        db.foods,
        db.meals,
        db.mealItems,
        db.mealPhotos,
        db.mealEstimates,
      ],
      async () => {
        const restorePlan = await calculateRestoreApprovalPlan(candidate, mode, hashes);
        const { nutritionPlan } = restorePlan;
        if (restorePlan.fingerprint !== approval.previewFingerprint) {
          throw new BackupImportError(
            'restore-preview-stale',
            '本机数据在预览后发生变化，请重新确认恢复影响',
          );
        }
        if (nutritionPlan.photoIdsToDelete.length > 0 && !approval.allowPhotoDeletion) {
          throw new BackupImportError(
            'photo-confirmation-required',
            '需要先确认删除冲突的本机餐食缩略图',
          );
        }
        if (nutritionPlan.estimateIdsToDelete.length > 0 && !approval.allowEstimateDiscard) {
          throw new BackupImportError(
            'draft-confirmation-required',
            '需要先确认丢弃未保存的食物识别候选',
          );
        }

        if (mode === 'merge') {
          await assertMergeIdSafety(candidate);
        }
        await assertNutritionMergeIdSafety(candidate.data, mode, invalid);
        if (mode === 'replace') await clearRestorableTables();
        await applyCandidate(candidate, mode);
        await applyNutritionRestore(candidate.data, mode, nutritionPlan, Date.now());
      },
    );
    return {
      workoutDays: candidate.preview.workoutDays,
      nutritionDays: candidate.preview.nutritionDays,
    };
  } catch (error) {
    if (error instanceof BackupImportError) throw error;
    throw new BackupImportError('restore-failed', '恢复失败，原数据未发生变化');
  }
}
```

The call to `calculateRestoreApprovalPlan()` is the first operation in the final 11-table write transaction. In both modes it recomputes the same full local-state snapshot and thumbnail digests before any collision check, clear, delete, or put. A row added to any of those 11 tables after preview therefore changes the fingerprint, raises `restore-preview-stale`, and lets Dexie abort with no mutation.

Remove `if (mode === 'merge') await assertMergeIdSafety(candidate);` from `applyCandidate`; the new outer transaction now performs both training and nutrition safety checks before the first mutation.

Do not add nutrition tables to `clearRestorableTables()`: `applyNutritionRestore()` owns nutrition clearing so it can preserve preset foods and execute photo/estimate cleanup from the approved plan.

Only now, after the new return contract exists, replace the existing merge-success result assertion in `src/lib/importData.test.ts`:

```ts
expect(result).toEqual({ workoutDays: 2, nutritionDays: 0 });
```

Do not move this assertion update into Task 4: before this step the baseline importer still returns only `{ workoutDays }`.

- [ ] **Step 5: Run restore tests to verify GREEN**

Run:

```bash
npm test -- --run src/lib/nutritionRestore.test.ts src/lib/importData.test.ts
```

Expected: PASS, including both parameterized rollback cases.

- [ ] **Step 6: Keep the restore API change uncommitted until the profile UI is updated**

```bash
git status --short
git diff -- src/lib/importData.ts src/lib/importData.test.ts
```

Expected: no commit is created. `restoreBackup` now requires approvals, so committing before Task 7 updates every UI caller would leave `HEAD` type-invalid.

### Task 7: Add destructive preview confirmation and privacy copy to the profile UI

**Files:**
- Modify: `src/screens/profile/DataRestorePanel.tsx:1-330`
- Modify: `src/screens/profile/DataRestorePanel.test.tsx`
- Modify: `src/screens/profile/ProfileScreen.tsx:274-299`
- Modify: `src/screens/profile/ProfileScreen.test.tsx:204-220`

- [ ] **Step 1: Write failing component tests**

In `src/screens/profile/DataRestorePanel.test.tsx`, add `waitFor` to the Testing Library import, replace the `./importData` import and mock with:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import {
  BackupImportError,
  parseBackupFile,
  previewRestore,
  restoreBackup,
  type ModeRestorePreview,
  type RestoreCandidate,
} from '../../lib/importData';

vi.mock('../../lib/importData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/importData')>();
  return {
    ...actual,
    parseBackupFile: vi.fn(),
    previewRestore: vi.fn(),
    restoreBackup: vi.fn(),
  };
});
```

Extend the existing `candidate` with these required v3 fields:

```tsx
const candidate: RestoreCandidate = {
  schemaVersion: 3,
  preview: {
    exportedAt: '2026-08-04T08:30:00.000Z',
    workoutDays: 12,
    exercises: 8,
    sets: 86,
    weightLogs: 4,
    nutritionPlans: 0,
    nutritionDays: 0,
    meals: 0,
    mealItems: 0,
  },
  data: {
    workouts: [],
    workoutItems: [],
    exercises: [],
    weightLogs: [],
    profile: [],
    nutritionPlans: [],
    foods: [],
    meals: [],
    mealItems: [],
  },
};

const defaultModePreview: ModeRestorePreview = {
  ...candidate.preview,
  fingerprint: 'preview-default',
  mealPhotosToDelete: 0,
  mealEstimatesToDiscard: 0,
};
```

Replace `beforeEach` with:

```tsx
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseBackupFile).mockResolvedValue(candidate);
  vi.mocked(previewRestore).mockResolvedValue(defaultModePreview);
  vi.mocked(restoreBackup).mockResolvedValue({ workoutDays: 12, nutritionDays: 0 });
  vi.mocked(buildJsonExport).mockResolvedValue('{"schemaVersion":3}');
});
```

Because that mock now returns schema v3, update the existing replace-mode download assertion in the same test file to expect the identical payload:

```tsx
expect(downloadText).toHaveBeenCalledWith(
  expect.stringMatching(/^tiezheng-before-restore-\d{4}-\d{2}-\d{2}\.json$/),
  '{"schemaVersion":3}',
  'application/json',
);
```

Delete the stale pre-v3 payload expectation from that assertion.

In the existing merge success test, replace its submit/assertion block with:

```tsx
const submit = await screen.findByRole('button', { name: '开始安全合并' });
await waitFor(() => expect(submit).toBeEnabled());
await user.click(submit);

expect(restoreBackup).toHaveBeenCalledWith(candidate, 'merge', {
  previewFingerprint: 'preview-default',
  allowPhotoDeletion: false,
  allowEstimateDiscard: false,
});
expect(await screen.findByText('已恢复 12 天训练、0 天饮食记录')).toBeInTheDocument();
```

In the existing replace success test, use `await waitFor(() => expect(confirmButton).toBeEnabled())` after checking the backup checkbox, and replace its restore assertion with:

```tsx
expect(restoreBackup).toHaveBeenCalledWith(candidate, 'replace', {
  previewFingerprint: 'preview-default',
  allowPhotoDeletion: false,
  allowEstimateDiscard: false,
});
```

In the existing preview test, delete the obsolete photo-only assertion at current `DataRestorePanel.test.tsx:73` and assert both new distinctions:

```tsx
expect(within(dialog).getByText(/体型照不参与恢复，也不会被改动/)).toBeInTheDocument();
expect(within(dialog).getByText(/餐食缩略图不在备份中/)).toBeInTheDocument();
```

In that same preview test, replace the old replace-mode description assertion with:

```tsx
expect(within(dialog).getByText(
  /用备份替换当前训练、动作、体重、个人设置、营养计划、餐次、食物条目和自定义食物/,
)).toBeInTheDocument();
```

Also add a non-zero nutrition-preview rendering test:

```tsx
test('预览显示营养计划、饮食天数、餐次和食物条目计数', async () => {
  vi.mocked(parseBackupFile).mockResolvedValueOnce({
    ...candidate,
    preview: {
      ...candidate.preview,
      nutritionPlans: 2,
      nutritionDays: 3,
      meals: 7,
      mealItems: 12,
    },
  });
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());

  const nutritionPreview = await screen.findByLabelText('饮食备份预览');
  expect(within(nutritionPreview).getByText('2 份')).toBeInTheDocument();
  expect(within(nutritionPreview).getByText('3 天')).toBeInTheDocument();
  expect(within(nutritionPreview).getByText('7 餐')).toBeInTheDocument();
  expect(within(nutritionPreview).getByText('12 项')).toBeInTheDocument();
});
```

Add these two tests to `DataRestorePanel.test.tsx`:

```tsx
test('冲突照片和未保存候选分别确认后才能恢复', async () => {
  vi.mocked(previewRestore).mockResolvedValue({
    ...candidate.preview,
    fingerprint: 'preview-one',
    mealPhotosToDelete: 2,
    mealEstimatesToDiscard: 1,
  });
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());

  const submit = await screen.findByRole('button', { name: '开始安全合并' });
  expect(submit).toBeDisabled();
  expect(await screen.findByText('将删除 2 张仅存本机的餐食缩略图')).toBeInTheDocument();
  expect(screen.getByText('将丢弃 1 份未保存的识别候选')).toBeInTheDocument();

  await user.click(screen.getByRole('checkbox', { name: '我确认删除上述餐食缩略图' }));
  await user.click(screen.getByRole('checkbox', { name: '我确认丢弃上述未保存候选' }));
  await user.click(submit);

  expect(restoreBackup).toHaveBeenCalledWith(candidate, 'merge', {
    previewFingerprint: 'preview-one',
    allowPhotoDeletion: true,
    allowEstimateDiscard: true,
  });
});

test('预览过期后刷新影响范围并要求重新确认', async () => {
  vi.mocked(previewRestore)
    .mockResolvedValueOnce({
      ...candidate.preview,
      fingerprint: 'preview-one',
      mealPhotosToDelete: 1,
      mealEstimatesToDiscard: 0,
    })
    .mockResolvedValueOnce({
      ...candidate.preview,
      fingerprint: 'preview-two',
      mealPhotosToDelete: 2,
      mealEstimatesToDiscard: 0,
    });
  vi.mocked(restoreBackup).mockRejectedValueOnce(
    new BackupImportError('restore-preview-stale', '本机数据在预览后发生变化，请重新确认恢复影响'),
  );
  const user = userEvent.setup();
  const { input } = renderPanel();
  await user.upload(input, backupFile());
  await user.click(await screen.findByRole('checkbox', { name: '我确认删除上述餐食缩略图' }));
  await user.click(screen.getByRole('button', { name: '开始安全合并' }));

  expect(await screen.findByText('将删除 2 张仅存本机的餐食缩略图')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: '我确认删除上述餐食缩略图' })).not.toBeChecked();
});
```

Add this test to `src/screens/profile/ProfileScreen.test.tsx`, using its existing router-aware `renderProfile()` helper:

```tsx
test('数据导出说明披露未加密健康资料', async () => {
  renderProfile();
  expect(await screen.findByText(/JSON 含个人健康资料且未加密/)).toBeInTheDocument();
  expect(screen.getByText(/体型照和餐食缩略图不含在导出文件中/)).toBeInTheDocument();
});
```

This test replaces the obsolete exact assertion at current `ProfileScreen.test.tsx:216`. The test suite must not retain either legacy photo-only sentence.

- [ ] **Step 2: Run component tests to verify RED**

Run:

```bash
npm test -- --run src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.test.tsx
```

Expected: FAIL because the panel does not call `previewRestore`, has no independent confirmations, and still says restore never changes local photos.

- [ ] **Step 3: Add mode-preview state and stale-preview refresh**

Add `previewRestore` and `type ModeRestorePreview` to the existing import from `../../lib/importData`. Add these states inside `DataRestorePanel`:

```tsx
const [modePreview, setModePreview] = useState<ModeRestorePreview | null>(null);
const [previewNonce, setPreviewNonce] = useState(0);
const [photoDeleteConfirmed, setPhotoDeleteConfirmed] = useState(false);
const [estimateDiscardConfirmed, setEstimateDiscardConfirmed] = useState(false);
```

Add this effect after the existing focus effect:

```tsx
useEffect(() => {
  if (!candidate) {
    setModePreview(null);
    return;
  }
  let cancelled = false;
  setModePreview(null);
  setPhotoDeleteConfirmed(false);
  setEstimateDiscardConfirmed(false);
  previewRestore(candidate, mode)
    .then((preview) => {
      if (!cancelled) setModePreview(preview);
    })
    .catch((cause) => {
      if (!cancelled) setError(errorMessage(cause));
    });
  return () => {
    cancelled = true;
  };
}, [candidate, mode, previewNonce]);
```

Replace the restore call in `submitRestore` with:

```tsx
if (!modePreview) return;
try {
  const result = await restoreBackup(candidate, mode, {
    previewFingerprint: modePreview.fingerprint,
    allowPhotoDeletion: photoDeleteConfirmed,
    allowEstimateDiscard: estimateDiscardConfirmed,
  });
  setCandidate(null);
  setSuccess(`已恢复 ${result.workoutDays} 天训练、${result.nutritionDays} 天饮食记录`);
  (onRestored ?? reloadAfterResult)();
} catch (cause) {
  if (cause instanceof BackupImportError && cause.code === 'restore-preview-stale') {
    setPhotoDeleteConfirmed(false);
    setEstimateDiscardConfirmed(false);
    setPreviewNonce((value) => value + 1);
  }
  setError(errorMessage(cause));
}
```

Keep the existing replace-mode automatic backup step before this block.

- [ ] **Step 4: Render confirmations and update the submit gate**

Replace the complete-overwrite option's description with this explicit scope disclosure:

```tsx
用备份替换当前训练、动作、体重、个人设置、营养计划、餐次、食物条目和自定义食物。覆盖前会自动下载当前数据备份。
```

Immediately after the existing four training preview stats, render the four nutrition counts already present in `candidate.preview`:

```tsx
<div
  aria-label="饮食备份预览"
  className="mt-3 grid grid-cols-4 border-b border-line pb-3 text-center"
>
  <PreviewStat value={`${candidate.preview.nutritionPlans} 份`} label="营养计划" />
  <PreviewStat value={`${candidate.preview.nutritionDays} 天`} label="饮食" />
  <PreviewStat value={`${candidate.preview.meals} 餐`} label="餐次" />
  <PreviewStat value={`${candidate.preview.mealItems} 项`} label="食物" />
</div>
```

Replace the old absolute photo disclaimer at `DataRestorePanel.tsx:289-291` with:

```tsx
<div className="mt-4 space-y-3 border-l-2 border-amber pl-3 text-xs leading-relaxed text-mute">
  <p>体型照不参与恢复，也不会被改动。餐食缩略图不在备份中。</p>
  {modePreview && modePreview.mealPhotosToDelete > 0 && (
    <label className="flex min-h-11 items-center gap-2">
      <input
        type="checkbox"
        aria-label="我确认删除上述餐食缩略图"
        checked={photoDeleteConfirmed}
        onChange={(event) => setPhotoDeleteConfirmed(event.currentTarget.checked)}
      />
      <span>
        将删除 {modePreview.mealPhotosToDelete} 张仅存本机的餐食缩略图
        <span className="block">我确认删除上述餐食缩略图</span>
      </span>
    </label>
  )}
  {modePreview && modePreview.mealEstimatesToDiscard > 0 && (
    <label className="flex min-h-11 items-center gap-2">
      <input
        type="checkbox"
        aria-label="我确认丢弃上述未保存候选"
        checked={estimateDiscardConfirmed}
        onChange={(event) => setEstimateDiscardConfirmed(event.currentTarget.checked)}
      />
      <span>
        将丢弃 {modePreview.mealEstimatesToDiscard} 份未保存的识别候选
        <span className="block">我确认丢弃上述未保存候选</span>
      </span>
    </label>
  )}
</div>
```

Compute and use the complete disabled gate:

```tsx
const destructiveConfirmationMissing =
  !modePreview ||
  (modePreview.mealPhotosToDelete > 0 && !photoDeleteConfirmed) ||
  (modePreview.mealEstimatesToDiscard > 0 && !estimateDiscardConfirmed);

disabled={busy || destructiveConfirmationMissing || (confirmReplace && !backupConfirmed)}
```

- [ ] **Step 5: Update profile export copy**

Replace `ProfileScreen.tsx:276` with:

```tsx
JSON 含个人健康资料且未加密，请妥善保管 · 体型照和餐食缩略图不含在导出文件中
```

- [ ] **Step 6: Run component tests to verify GREEN**

Run:

```bash
npm test -- --run src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.test.tsx
```

Expected: PASS, including keyboard/focus tests that already cover the restore sheet.

- [ ] **Step 7: Commit the complete usable v3 vertical slice atomically**

```bash
git add src/lib/exportData.ts src/lib/exportData.test.ts src/lib/importData.ts src/lib/importData.test.ts src/lib/nutritionRestore.ts src/lib/nutritionRestore.test.ts src/screens/profile/DataRestorePanel.tsx src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.tsx src/screens/profile/ProfileScreen.test.tsx
npm test -- --run src/lib/nutritionBackup.test.ts src/lib/nutritionRestore.test.ts src/lib/exportData.test.ts src/lib/importData.test.ts src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.test.tsx
npm run typecheck
git diff --cached --check
git commit -m "feat: add atomic nutrition backup v3 restore"
```

Expected: the focused suite and typecheck pass, the staged diff has no whitespace errors, and the single commit simultaneously makes schema v3 exportable, parseable, restorable, approved by the UI, and compatible with every caller.

### Task 8: Pin PWA database races, rollback behavior, and final verification

**Files:**
- Create: `src/lib/dbVersionRace.test.ts`

- [ ] **Step 1: Write the v3-open-tab and rollback tests**

Create `src/lib/dbVersionRace.test.ts` with this complete preamble:

```ts
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const V3_STORES = {
  workouts: 'id, date, updatedAt',
  workoutItems: 'id, workoutId, exerciseId, updatedAt',
  exercises: 'id, bodyPart, updatedAt',
  weightLogs: 'id, date, updatedAt',
  photos: 'id, date, updatedAt',
  profile: 'id',
};

const opened = new Set<Dexie>();

function track<T extends Dexie>(database: T): T {
  opened.add(database);
  return database;
}

async function wipe() {
  for (const database of opened) database.close();
  opened.clear();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('tiezheng');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await wipe();
  vi.resetModules();
});

afterEach(wipe);
```

Append these tests:

```ts
test('v3 标签页打开时 v4 升级完成且旧六表数据不变', async () => {
  const old = track(new Dexie('tiezheng'));
  old.version(3).stores(V3_STORES);
  await old.open();
  old.on('versionchange', () => old.close());
  const workout = {
    id: 'w-before-upgrade',
    date: '2026-08-13',
    note: '升级前训练',
    updatedAt: 1,
    deletedAt: null,
  };
  const workoutItem = {
    id: 'wi-before-upgrade',
    workoutId: workout.id,
    exerciseId: 'e-before-upgrade',
    order: 0,
    sets: [{ weight: 80, reps: 8 }],
    updatedAt: 2,
    deletedAt: null,
  };
  const exercise = {
    id: 'e-before-upgrade',
    name: '升级前划船',
    bodyPart: 'back',
    loadMode: 'external',
    preset: false,
    updatedAt: 3,
    deletedAt: null,
  };
  const weightLog = {
    id: 'weight-before-upgrade',
    date: '2026-08-13',
    weightKg: 72.5,
    updatedAt: 4,
    deletedAt: null,
  };
  const photo = {
    id: 'photo-before-upgrade',
    date: '2026-08-13',
    blob: new Blob(['body-photo'], { type: 'image/jpeg' }),
    size: 10,
    updatedAt: 5,
    deletedAt: null,
  };
  const profile = {
    id: 'me',
    weeklyGoal: 5,
    nickname: '升级前',
    onboarded: true,
    updatedAt: 6,
  };
  await old.transaction('rw', old.tables, async () => {
    await old.table('workouts').put(workout);
    await old.table('workoutItems').put(workoutItem);
    await old.table('exercises').put(exercise);
    await old.table('weightLogs').put(weightLog);
    await old.table('photos').put(photo);
    await old.table('profile').put(profile);
  });

  const db = track((await import('./db')).db);
  await db.open();

  expect(await db.workouts.get(workout.id)).toEqual(workout);
  expect(await db.workoutItems.get(workoutItem.id)).toEqual(workoutItem);
  expect(await db.exercises.get(exercise.id)).toEqual(exercise);
  expect(await db.weightLogs.get(weightLog.id)).toEqual(weightLog);
  const upgradedPhoto = await db.photos.get(photo.id);
  expect(upgradedPhoto).toMatchObject({
    id: photo.id,
    date: photo.date,
    size: photo.size,
    updatedAt: photo.updatedAt,
    deletedAt: photo.deletedAt,
  });
  expect(await upgradedPhoto!.blob.text()).toBe('body-photo');
  expect(await db.profile.get(profile.id)).toEqual(profile);
  expect(db.tables.map((table) => table.name).sort()).toEqual([
    'exercises',
    'foods',
    'mealEstimates',
    'mealItems',
    'mealPhotos',
    'meals',
    'nutritionPlans',
    'photos',
    'profile',
    'weightLogs',
    'workoutItems',
    'workouts',
  ]);
});

test('数据库已升到 v4 后旧 v3 前端不能降级打开且数据仍在', async () => {
  const db = track((await import('./db')).db);
  await db.open();
  await db.meals.put({
    id: 'meal:2026-08-14:lunch',
    date: '2026-08-14',
    slot: 'lunch',
    updatedAt: 1,
    deletedAt: null,
  });
  db.close();

  const rolledBack = track(new Dexie('tiezheng'));
  rolledBack.version(3).stores(V3_STORES);
  await expect(rolledBack.open()).rejects.toMatchObject({ name: 'VersionError' });

  vi.resetModules();
  const current = track((await import('./db')).db);
  await current.open();
  expect(await current.meals.get('meal:2026-08-14:lunch')).toBeDefined();
});
```

- [ ] **Step 2: Run race tests to verify behavior**

Run:

```bash
npm test -- --run src/lib/dbVersionRace.test.ts
```

Expected: PASS. The explicit old-tab `versionchange` handler closes only the stale connection; neither test deletes or recreates the database while an application connection is open.

- [ ] **Step 3: Verify the pre-v3 importer rejects a v3 backup before rollback**

Run:

```bash
git show d18245d:src/lib/importData.ts | rg -n "source.schemaVersion > BACKUP_SCHEMA_VERSION|future-version"
```

Expected: both the version comparison and `future-version` error are present, proving the published v2 importer rejects schema v3 instead of misreading it.

- [ ] **Step 4: Run the complete backup-focused suite**

Run:

```bash
npm test -- --run src/lib/nutritionBackup.test.ts src/lib/nutritionRestore.test.ts src/lib/exportData.test.ts src/lib/importData.test.ts src/lib/dbVersionRace.test.ts src/screens/profile/DataRestorePanel.test.tsx src/screens/profile/ProfileScreen.test.tsx
```

Expected: PASS with zero failed tests and zero unhandled rejections.

- [ ] **Step 5: Run repository-wide verification**

Run:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all tests pass, TypeScript exits 0, Vite production build exits 0, and `git diff --check` prints no output.

- [ ] **Step 6: Commit race coverage and verification evidence**

```bash
npm run typecheck
git add src/lib/dbVersionRace.test.ts
git commit -m "test: guard nutrition backup rollback paths"
```

## Self-review checklist

- Schema v3 exports exactly `nutritionPlans`, custom `foods`, `meals`, and confirmed `mealItems`.
- `photos`, `mealPhotos`, `mealEstimates`, preset foods, credentials, and rate-limit data never enter JSON.
- Backup parsing preserves the core's activity questionnaire, weight/age/disease gates, original and normalized nutrient snapshots, conversion/FDC provenance, coefficients, raw-energy endpoints, independent evaluation policy, and typed local estimates without generic nested fields.
- v0, v1, and v2 parse without nutrition fields; v3 validates every top-level nutrition row and reference; v4 rejects as future.
- Export reads all nine recoverable tables inside one Dexie read transaction.
- Merge and replace declare all 11 mutated/restored tables inside one Dexie write transaction.
- Meal-item, custom-food business identity, nutrition-plan business identity, and preset-ID collisions are rejected before the first mutation.
- Photo and draft cleanup is mode-specific, previewed, independently confirmed, and recalculated inside the final transaction; the approval fingerprint binds the normalized candidate, sorted incoming hashes, actual deletion-ID sets, and every current row in all 11 restore tables for both merge and replace. Meal-thumbnail bytes are represented by SHA-256; preview uses one read snapshot and the final 11-table write transaction recomputes the same state before any mutation.
- A stale preview causes a recoverable error and no mutation.
- Both merge and replace rollback tests include training, nutrition, estimates, and thumbnail metadata.
- UI discloses unencrypted health data and distinguishes unchanged body photos from conditionally deleted meal thumbnails.
- PWA upgrade proves representative rows in all six legacy tables remain byte/field-equivalent, and the old-frontend rollback path preserves v4 data.
- No commit can expose schema v3 export before import/restore is complete or expose the three-argument restore API before every UI caller is compatible.
- No nutrition screen or AI implementation is included in this plan.
