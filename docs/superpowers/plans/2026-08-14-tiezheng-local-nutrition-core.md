# 铁证本地营养核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在无账号、无网络、无 AI 的条件下，交付可追溯的三项 USDA 预设食物、四餐本地记录、健康计划设置、热量/蛋白质日汇总和今日页真实摘要，同时让所有自动目标保持默认关闭。

**Architecture:** 先固定备份层依赖的六种持久化类型与快照 hash，再用 Dexie v4 增量增加六张营养表。目录、纯计算和仓储保持 UI 无关；`HealthScreen` 只通过 repo 和纯函数读写，`TodayNutritionSummary` 成对读取派生日汇总与当日生效计划并复用同一评价函数。自动目标由单一 fail-closed feature flag 控制，关闭时仍可完整记录食物，但不显示完成度或“达标”判断。

**Tech Stack:** React 19、React Router 7、TypeScript 5.8 strict、Dexie 4、dexie-react-hooks、Vitest 3、Testing Library、fake-indexeddb、Tailwind CSS 4、Vite PWA、OpenAI imagegen。

---

## Execution order and hard scope guard

This plan starts after `docs/superpowers/plans/2026-08-14-tiezheng-onboarding-and-health-entry.md` has landed. At that point `src/screens/health/HealthScreen.tsx`, its test, `src/screens/today/TodayNutritionSummary.tsx`, its test, and the top-level `/health` route outside `TabLayout` must already exist.

Before Task 1, run:

```bash
npm ci
test -f src/screens/health/HealthScreen.tsx
test -f src/screens/today/TodayNutritionSummary.tsx
npm test -- src/screens/health/HealthScreen.test.tsx src/screens/today/TodayNutritionSummary.test.tsx src/App.test.tsx
```

Expected: dependency installation exits 0; all three tests pass. If either source file is missing, execute the entry plan first rather than recreating its route or empty-state work here.

This plan must not modify the backup-v3 plan; `exportData.ts`, `importData.ts`, or `DataRestorePanel.tsx`; onboarding privacy copy; `TabBar.tsx`; or any authentication, upload, AI gateway, photo recognition, quota, or network code.

`MealPhoto` and `MealEstimate` exist now because DB v4 and the backup prerequisite require their exact persistence contract. This plan only gives them local repository lifecycle operations; it does not expose photo capture or estimation UI.

The three food nutrient rows use USDA FoodData Central data under CC0. Their images are separate, independently generated production assets; a nutrient-data license must never be reused as an image license.

## Authoritative persistence contract

Tasks 1–9 use one vocabulary only. `NutritionPlan`, `Food`, `Meal`, `MealItem`, `MealPhoto`, and `MealEstimate` keep the backup contract's top-level names. Its nested objects are explicit `NutritionGoals`, `NutritionSafetyInputs`, `NutritionActivityInputs`, `NutritionEquationInputs`, `NutritionTargetRanges`, and `NutritionTargetMode` interfaces, never generic records.

The complete definitions land in Task 1. If the backup plan still shows generic records when implementation starts, update that later plan to parse these explicit fields; do not weaken the core types or add synonyms.

### Task 1: Land exact nutrition types, deterministic IDs, shared fixtures, and meal snapshot hashing

**Files:** Create `src/lib/nutritionTypes.ts`, `src/lib/nutritionIds.ts`, `src/lib/nutritionIds.test.ts`, `src/lib/stableJson.ts`, `src/lib/stableJson.test.ts`, `src/lib/mealSnapshot.ts`, `src/lib/mealSnapshot.test.ts`, and `src/test/nutritionFixtures.ts`.

- [ ] **Step 1: Write RED tests for IDs and semantic snapshot stability**

Create `src/lib/nutritionIds.test.ts`:

```ts
import { expect, test } from 'vitest';
import { mealEstimateId, mealId, mealItemId, mealPhotoId, nutritionPlanId } from './nutritionIds';

test('营养计划和餐次使用确定性业务主键', () => {
  expect(nutritionPlanId('2026-08-14')).toBe('nutrition-plan:2026-08-14');
  expect(mealId('2026-08-14', 'lunch')).toBe('meal:2026-08-14:lunch');
  expect(mealPhotoId('meal:2026-08-14:lunch')).toBe('meal-photo:meal:2026-08-14:lunch');
  expect(mealEstimateId('meal:2026-08-14:lunch')).toBe('meal-estimate:meal:2026-08-14:lunch');
  expect(mealItemId('operation-1')).toBe('meal-item:operation-1');
});

test('非法日期不能生成业务主键', () => {
  expect(() => mealId('2026/08/14', 'lunch')).toThrow('YYYY-MM-DD');
  expect(() => mealId('2026-02-30', 'lunch')).toThrow('calendar date');
});

test('操作 ID 必须非空、限长且只含安全字符', () => {
  expect(() => mealItemId('')).toThrow('operation id');
  expect(() => mealItemId('a'.repeat(129))).toThrow('operation id');
  expect(() => mealItemId('bad/id')).toThrow('operation id');
});
```

Create `src/lib/mealSnapshot.test.ts`:

```ts
import { expect, test } from 'vitest';
import { mealItemRow, mealRow } from '../test/nutritionFixtures';
import { buildMealSnapshotHash } from './mealSnapshot';

test('顺序相同的餐食语义生成稳定 SHA-256，updatedAt 不影响 hash', async () => {
  const meal = mealRow();
  const first = mealItemRow({ id: 'meal-item:a', order: 0 });
  const second = mealItemRow({ id: 'meal-item:b', order: 1 });

  const a = await buildMealSnapshotHash(meal, [second, first]);
  const b = await buildMealSnapshotHash(
    { ...meal, updatedAt: 999 },
    [{ ...first, updatedAt: 998 }, { ...second, updatedAt: 997 }],
  );

  expect(a).toMatch(/^[a-f0-9]{64}$/);
  expect(b).toBe(a);
  const reordered = Object.fromEntries(Object.entries(first).reverse()) as typeof first;
  expect(await buildMealSnapshotHash(meal, [reordered, second])).toBe(a);
  expect(await buildMealSnapshotHash(meal, [{ ...first, amount: 151 }, second])).not.toBe(a);
  expect(await buildMealSnapshotHash(meal, [{ ...first, conversionAssumptions: ['density changed'] }, second])).not.toBe(a);
});
```

- [ ] **Step 2: Run tests to verify RED**

```bash
npm test -- src/lib/nutritionIds.test.ts src/lib/stableJson.test.ts src/lib/mealSnapshot.test.ts
```

Expected: FAIL because the modules and shared fixtures do not exist.

- [ ] **Step 3: Create the authoritative explicit persistence types**

Create `src/lib/nutritionTypes.ts` exactly with these exported fields:

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
  activeCommuteMinutesPerDay: number | null; householdMinutesPerDay: number | null;
  stepsPerDay: number | null; trainingTypes: TrainingType[];
  trainingSessionsPerWeek: number | null; trainingMinutesPerSession: number | null;
  trainingIntensity: 'light' | 'moderate' | 'vigorous' | 'mixed' | 'none' | 'not-provided';
}

export interface NutritionSafetyInputs {
  basisWeightKg: number | null; basisWeightDate: string | null;
  proteinWeightMethod: 'current-weight' | 'professional-reference-weight' | 'unverified' | null;
  ageYears: number | null; heightCm: number | null;
  targetWeightKg: number | null; targetLossKgPerWeek: number | null;
  targetDate: string | null;
  highBodyFatOrObesity: boolean | null;
  pregnantOrBreastfeeding: boolean | null; requiresTherapeuticDiet: boolean | null;
  kidneyDiseaseOrComplexCondition: boolean | null; eatingDisorderOrRedsRisk: boolean | null;
  athleteOrExtremeActivity: boolean | null;
  eligibilityStandard: 'WS/T 428—2013';
  eligibilityBlockers: NutritionEligibilityBlocker[];
}

export interface NutritionEquationInputs {
  equationName: 'NASEM-2023-adult-EER' | 'not-calculated';
  equationBranch: EquationBranch;
  activityInputs: NutritionActivityInputs;
  activityCategoryLow: ActivityCategory | null; activityCategoryHigh: ActivityCategory | null;
  maintenanceEnergyLowKcal: number | null; maintenanceEnergyHighKcal: number | null;
  calculatedAt: number | null;
}

export interface NutritionTargetRanges {
  proteinLowG: number | null; proteinHighG: number | null;
  proteinReferenceG: number | null;
  proteinLowCoefficient: number | null; proteinHighCoefficient: number | null;
  proteinReferenceCoefficient: number | null;
  energyLowKcal: number | null; energyHighKcal: number | null;
  energyRawLowKcal: number | null; energyRawHighKcal: number | null;
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
  id: string; effectiveFrom: string;
  goals: NutritionGoals; safetyInputs: NutritionSafetyInputs; standardVersion: string;
  equationInputs: NutritionEquationInputs; equationVersion: string;
  targetRanges: NutritionTargetRanges; targetMode: NutritionTargetMode; sourceVersion: string;
  proteinPolicySource: 'ISSN'; proteinPolicyVersion: 'JISSN-2017-14-20';
  updatedAt: number;
  deletedAt: number | null;
}

export interface Food {
  id: string; name: string; aliases: string[];
  rawOrCooked: 'raw' | 'cooked' | 'not-applicable'; preparation: string;
  originalEnergyValue: number; originalEnergyUnit: 'kcal' | 'kJ';
  originalProteinG: number; originalBasisAmount: number; originalBasisUnit: 'g' | 'mL';
  basisAmount: number; basisUnit: 'g' | 'mL';
  energyKcal: number; proteinG: number;
  ediblePortionRatio: number; densityGPerMl: number | null; conversionAssumptions: string[];
  fdcId: number | null; fdcDataType: FoodDataType | null; sourceRetrievedAt: string | null;
  source: string; sourceVersion: string; license: string;
  preset: boolean; updatedAt: number;
  deletedAt: number | null;
}

export interface Meal {
  id: string; date: string; slot: MealSlot; updatedAt: number;
  deletedAt: number | null;
}

export interface MealItem {
  id: string; mealId: string; name: string; preparation: string;
  amount: number; unit: 'g' | 'mL';
  originalEnergyValue: number; originalEnergyUnit: 'kcal' | 'kJ';
  originalProteinG: number; originalBasisAmount: number; originalBasisUnit: 'g' | 'mL';
  energyKcal: number; proteinG: number;
  energyKcalLow: number; energyKcalHigh: number;
  proteinGLow: number; proteinGHigh: number;
  assumptions: string[]; uncertaintyModelVersion: string;
  basisAmount: number; basisUnit: 'g' | 'mL';
  ediblePortionRatio: number; densityGPerMl: number | null; conversionAssumptions: string[];
  fdcId: number | null; fdcDataType: FoodDataType | null; sourceRetrievedAt: string | null;
  source: string; sourceVersion: string; license: string;
  method: MealItemMethod; quality: NutritionQuality;
  confirmedAt: number; order: number; updatedAt: number;
  deletedAt: number | null;
}

export interface MealPhoto {
  id: string; mealId: string; thumbnail: Blob; size: number;
  width: number; height: number; mealSnapshotHash: string; updatedAt: number;
}

export type MealEstimateStatus =
  | 'preprocessing' | 'awaiting-consent' | 'uploading' | 'estimating'
  | 'needs-confirmation' | 'confirmed' | 'failed';
export type MealEstimateErrorCode =
  | 'unsupported-file' | 'image-too-large' | 'decode-failed' | 'offline'
  | 'auth-required' | 'auth-expired' | 'quota-exceeded' | 'rate-limited'
  | 'provider-timeout' | 'provider-unavailable' | 'invalid-estimate' | 'uncertain-food';
export interface MealEstimateCandidate {
  id: string; name: string; preparation: string;
  amountLow: number; amountHigh: number; unit: 'g' | 'mL';
  catalogFoodId: string | null;
}
export interface MealEstimateConsentBinding {
  uploadBlobSha256: string; requestId: string; providerPolicyVersion: string;
  consentedAt: number; expiresAt: number;
}
export interface MealEstimate {
  id: string; mealId: string; status: MealEstimateStatus;
  requestId: string; requestFingerprint: string;
  candidates: MealEstimateCandidate[];
  consent: MealEstimateConsentBinding | null;
  error: MealEstimateErrorCode | null;
  updatedAt: number;
}
```

Do not add aliases such as `weightKg`, `calorieTarget`, `foodId`, `photoBlob`, or `estimateState` to these persisted interfaces.

- [ ] **Step 4: Implement deterministic ID helpers**

Create `src/lib/nutritionIds.ts`:

```ts
import type { MealSlot } from './nutritionTypes';

function dateKey(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('date must be YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('date must be a real calendar date');
  }
  return value;
}

export const nutritionPlanId = (date: string) => `nutrition-plan:${dateKey(date)}`;
export const mealId = (date: string, slot: MealSlot) => `meal:${dateKey(date)}:${slot}`;
export function operationKey(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('invalid operation id');
  return value;
}
export const mealItemId = (operationId: string) => `meal-item:${operationKey(operationId)}`;
export const mealPhotoId = (id: string) => `meal-photo:${id}`;
export const mealEstimateId = (id: string) => `meal-estimate:${id}`;
```

- [ ] **Step 5: Create all six deterministic reusable fixtures**

Create `src/test/nutritionFixtures.ts` exactly as follows. The active-plan numbers are the literal output of Task 4's one shared derivation kernel for a 30-year-old female, 175 cm, 80 kg, adjacent `low-active→active` categories, and an 80→72 kg loss over exactly 112 days. Task 4's semantic-gate tests recompute these literals and reject any drift.

```ts
import type {
  Food,
  Meal,
  MealEstimate,
  MealItem,
  MealPhoto,
  NutritionPlan,
} from '../lib/nutritionTypes';

const FIXED_TIME = 1_723_568_400_000;

export function nutritionPlanRow(overrides: Partial<NutritionPlan> = {}): NutritionPlan {
  const row: NutritionPlan = {
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
        stepsPerDay: 8_000,
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
  };
  return { ...row, ...overrides };
}

export function foodRow(overrides: Partial<Food> = {}): Food {
  const row: Food = {
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
  };
  return { ...row, ...overrides };
}

export function mealRow(overrides: Partial<Meal> = {}): Meal {
  const row: Meal = {
    id: 'meal:2026-08-14:lunch',
    date: '2026-08-14',
    slot: 'lunch',
    updatedAt: FIXED_TIME,
    deletedAt: null,
  };
  return { ...row, ...overrides };
}

export function mealItemRow(overrides: Partial<MealItem> = {}): MealItem {
  const row: MealItem = {
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
    energyKcal: 130,
    proteinG: 2.69,
    energyKcalLow: 195,
    energyKcalHigh: 195,
    proteinGLow: 4.035,
    proteinGHigh: 4.035,
    assumptions: ['用户确认可食部 g'],
    uncertaintyModelVersion: 'exact-measured-v1',
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
    method: 'preset',
    quality: 'A',
    confirmedAt: FIXED_TIME,
    order: 0,
    updatedAt: FIXED_TIME,
    deletedAt: null,
  };
  return { ...row, ...overrides };
}

export function mealPhotoRow(overrides: Partial<MealPhoto> = {}): MealPhoto {
  const thumbnail = new Blob(
    [new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])],
    { type: 'image/webp' },
  );
  const row: MealPhoto = {
    id: 'meal-photo:meal:2026-08-14:lunch',
    mealId: 'meal:2026-08-14:lunch',
    thumbnail,
    size: thumbnail.size,
    width: 1,
    height: 1,
    mealSnapshotHash: 'a'.repeat(64),
    updatedAt: FIXED_TIME,
  };
  return { ...row, ...overrides };
}

export function mealEstimateRow(overrides: Partial<MealEstimate> = {}): MealEstimate {
  const row: MealEstimate = {
    id: 'meal-estimate:meal:2026-08-14:lunch',
    mealId: 'meal:2026-08-14:lunch',
    status: 'needs-confirmation',
    requestId: 'request-fixture-1',
    requestFingerprint: 'b'.repeat(64),
    candidates: [{
      id: 'candidate-fixture-1',
      name: '熟米饭',
      preparation: '蒸煮',
      amountLow: 120,
      amountHigh: 180,
      unit: 'g',
      catalogFoodId: 'food:preset:usda:168878',
    }],
    consent: {
      uploadBlobSha256: 'c'.repeat(64),
      requestId: 'request-fixture-1',
      providerPolicyVersion: 'photo-estimate-consent-v1',
      consentedAt: FIXED_TIME,
      expiresAt: FIXED_TIME + 15 * 60 * 1000,
    },
    error: null,
    updatedAt: FIXED_TIME,
  };
  return { ...row, ...overrides };
}
```

- [ ] **Step 6: Implement stable JSON and canonical meal snapshot hashing**

Create `src/lib/stableJson.test.ts`:

```ts
import { expect, test } from 'vitest';
import { stableJson } from './stableJson';

test('object key insertion order does not change stable JSON', () => {
  expect(stableJson({ b: 2, nested: { z: 1, a: 3 }, a: 1 }))
    .toBe(stableJson({ a: 1, nested: { a: 3, z: 1 }, b: 2 }));
  expect(stableJson({ keep: 1, omitted: undefined })).toBe('{"keep":1}');
  expect(() => stableJson(undefined)).toThrow('JSON value');
});
```

Create `src/lib/stableJson.ts`:

```ts
function normalizeStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => entry === undefined ? null : normalizeStable(entry));
  }
  if (value !== null && typeof value === 'object') {
    const sorted: { [key: string]: unknown } = {};
    for (const key of Object.keys(value).sort()) {
      const entry = Reflect.get(value, key) as unknown;
      if (entry !== undefined) sorted[key] = normalizeStable(entry);
    }
    return sorted;
  }
  return value;
}

export function stableJson(value: unknown): string {
  const serialized = JSON.stringify(normalizeStable(value));
  if (serialized === undefined) throw new Error('stableJson requires a JSON value');
  return serialized;
}
```

Create `src/lib/mealSnapshot.ts`:

```ts
import type { Meal, MealItem } from './nutritionTypes';
import { stableJson } from './stableJson';

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function buildMealSnapshotHash(meal: Meal, items: MealItem[]): Promise<string> {
  const payload = {
    version: 'meal-snapshot-v1',
    meal: { id: meal.id, date: meal.date, slot: meal.slot, deletedAt: meal.deletedAt },
    items: items
      .filter((item) => item.deletedAt === null)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((item) => ({ ...item, updatedAt: undefined })),
  };
  const data = new TextEncoder().encode(stableJson(payload));
  return hex(await crypto.subtle.digest('SHA-256', data));
}
```

`stableJson` recursively sorts object keys and omits the `undefined` timestamp. Hashes include confirmed snapshot semantics, ignore property insertion order, and exclude only mutable transport time `updatedAt`.

- [ ] **Step 7: Run GREEN verification and commit**

```bash
npm test -- src/lib/nutritionIds.test.ts src/lib/stableJson.test.ts src/lib/mealSnapshot.test.ts
npm run typecheck
git add src/lib/nutritionTypes.ts src/lib/nutritionIds.ts src/lib/nutritionIds.test.ts src/lib/stableJson.ts src/lib/stableJson.test.ts src/lib/mealSnapshot.ts src/lib/mealSnapshot.test.ts src/test/nutritionFixtures.ts
git commit -m "feat: define local nutrition contracts"
```

Expected: tests and typecheck PASS; one commit is created.

### Task 2: Upgrade IndexedDB to v4 without changing existing rows

**Files:** Modify `src/lib/db.ts` and `src/lib/db.test.ts`; create `src/lib/dbMigrationV4.test.ts`.

- [ ] **Step 1: Write RED schema and v3-to-v4 migration tests**

Update `src/lib/db.test.ts` to expect exactly twelve tables:

```ts
expect(db.tables.map((table) => table.name).sort()).toEqual([
  'exercises', 'foods', 'mealEstimates', 'mealItems', 'mealPhotos', 'meals',
  'nutritionPlans', 'photos', 'profile', 'weightLogs', 'workoutItems', 'workouts',
]);
expect(db.meals.schema.indexes.map((index) => index.name)).toContain('[date+slot]');
expect(db.mealItems.schema.indexes.map((index) => index.name)).toContain('[mealId+order]');
expect(db.foods.schema.indexes.map((index) => index.name)).not.toContain('preset');
```

Create `src/lib/dbMigrationV4.test.ts` using the dynamic-import pattern from `dbMigrationV3.test.ts`. Build a legacy database with current v1 stores, no-op v2, and the existing v3 onboarding upgrade. Seed one row in each existing table, capture `old.tables` contents, close it, then import current `db` and assert:

```ts
expect(await current.workouts.toArray()).toEqual(before.workouts);
expect(await current.workoutItems.toArray()).toEqual(before.workoutItems);
expect(await current.exercises.toArray()).toEqual(before.exercises);
expect(await current.weightLogs.toArray()).toEqual(before.weightLogs);
expect(await current.photos.toArray()).toEqual(before.photos);
expect(await current.profile.toArray()).toEqual(before.profile);
expect(await current.nutritionPlans.count()).toBe(0);
await current.foods.put(foodRow());
await current.meals.put(mealRow());
expect(await current.foods.count()).toBe(1);
expect(await current.meals.count()).toBe(1);
```

Add a second test that deletes the database and opens current code directly; all twelve tables must exist and `getProfile().onboarded` must remain `false`.

- [ ] **Step 2: Run migration tests to verify RED**

```bash
npm test -- src/lib/db.test.ts src/lib/dbMigrationV3.test.ts src/lib/dbMigrationV4.test.ts
```

Expected: FAIL because six nutrition tables are not present.

- [ ] **Step 3: Type the six tables and declare the complete v4 schema**

In `src/lib/db.ts`, replace the anonymous Dexie intersection with an exported connection type so cross-tab tests use the exact schema:

```ts
import type { Food, Meal, MealEstimate, MealItem, MealPhoto, NutritionPlan } from './nutritionTypes';
export type NutritionDb = Dexie & {
  workouts: EntityTable<Workout, 'id'>; workoutItems: EntityTable<WorkoutItem, 'id'>;
  exercises: EntityTable<Exercise, 'id'>; weightLogs: EntityTable<WeightLog, 'id'>;
  photos: EntityTable<Photo, 'id'>; profile: EntityTable<Profile, 'id'>;
  nutritionPlans: EntityTable<NutritionPlan, 'id'>; foods: EntityTable<Food, 'id'>;
  meals: EntityTable<Meal, 'id'>; mealItems: EntityTable<MealItem, 'id'>;
  mealPhotos: EntityTable<MealPhoto, 'id'>; mealEstimates: EntityTable<MealEstimate, 'id'>;
};
export const db = new Dexie('tiezheng') as NutritionDb;
```

After the v3 upgrade, add one stores-only migration:

```ts
export const DB_V4_STORES = {
  workouts: 'id, date, updatedAt',
  workoutItems: 'id, workoutId, exerciseId, updatedAt',
  exercises: 'id, bodyPart, updatedAt',
  weightLogs: 'id, date, updatedAt',
  photos: 'id, date, updatedAt',
  profile: 'id',
  nutritionPlans: 'id, effectiveFrom, updatedAt, deletedAt',
  foods: 'id, name, updatedAt, deletedAt',
  meals: 'id, date, slot, [date+slot], updatedAt, deletedAt',
  mealItems: 'id, mealId, [mealId+order], updatedAt, deletedAt',
  mealPhotos: 'id, mealId, updatedAt',
  mealEstimates: 'id, mealId, status, updatedAt',
} as const;
db.version(4).stores(DB_V4_STORES);
```

Do not add an `upgrade()` callback: v4 is additive and must not seed, normalize, or rewrite old rows during schema migration.

- [ ] **Step 4: Run GREEN verification and commit**

```bash
npm test -- src/lib/db.test.ts src/lib/dbMigrationV3.test.ts src/lib/dbMigrationV4.test.ts
npm run typecheck
git add src/lib/db.ts src/lib/db.test.ts src/lib/dbMigrationV4.test.ts
git commit -m "feat: add nutrition tables in db v4"
```

Expected: all DB tests PASS; existing v3 behavior remains locked.

### Task 3: Add the three CC0 USDA presets and three independently generated real-food assets

**Files:** Create `src/data/presetFoods.ts`, `src/data/presetFoods.test.ts`, `scripts/prepare-preset-food-images.mjs`, `scripts/preset-food-image-provenance.mjs`, `scripts/build-preset-food-image-manifest.mjs`, `public/food-presets/rice.webp`, `public/food-presets/chicken-breast.webp`, `public/food-presets/lean-beef.webp`, and generated `src/data/presetFoodImageManifest.generated.ts`; modify `package.json` and `package-lock.json` for exact `sharp@0.33.5`.

- [ ] **Step 1: Write RED tests for nutrient provenance and asset-manifest integrity**

Create `src/data/presetFoods.test.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { PRESET_FOODS } from './presetFoods';
import { PRESET_FOOD_IMAGE_MANIFEST } from './presetFoodImageManifest.generated';

test('首批目录锁定官方 USDA 身份、快照和标准化值', () => {
  expect(PRESET_FOODS.map(({ fdcId, fdcDataType, sourceVersion, energyKcal, proteinG, license }) => ({
    fdcId, fdcDataType, sourceVersion, energyKcal, proteinG, license,
  }))).toEqual([
    { fdcId: 168878, fdcDataType: 'SR Legacy', sourceVersion: 'USDA-FDC-SR-Legacy-2019-04-01', energyKcal: 130, proteinG: 2.69, license: 'CC0 1.0' },
    { fdcId: 171477, fdcDataType: 'SR Legacy', sourceVersion: 'USDA-FDC-SR-Legacy-2019-04-01', energyKcal: 165, proteinG: 31, license: 'CC0 1.0' },
    { fdcId: 170236, fdcDataType: 'SR Legacy', sourceVersion: 'USDA-FDC-SR-Legacy-2019-04-01', energyKcal: 190, proteinG: 36.1, license: 'CC0 1.0' },
  ]);
  expect(PRESET_FOODS.every((food) => food.originalBasisAmount === 100 && food.basisAmount === 100 && food.sourceRetrievedAt === '2026-08-14')).toBe(true);
});

test('每个食物使用独立真实 WebP，manifest hash 与文件一致', async () => {
  expect(new Set(PRESET_FOOD_IMAGE_MANIFEST.map((row) => row.path)).size).toBe(3);
  expect(new Set(PRESET_FOOD_IMAGE_MANIFEST.map((row) => row.sha256)).size).toBe(3);
  for (const row of PRESET_FOOD_IMAGE_MANIFEST) {
    const file = resolve(process.cwd(), 'public', row.path.replace(/^\//, ''));
    const bytes = await readFile(file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.sha256);
    expect((await stat(file)).size).toBeLessThanOrEqual(35 * 1024);
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 256, height: 256, format: 'webp' });
    expect(row.reviewed).toBe(true);
    expect(row.generator).toBe('OpenAI imagegen');
  }
});
```

- [ ] **Step 2: Run the catalog test to verify RED**

```bash
npm test -- src/data/presetFoods.test.ts
```

Expected: FAIL because catalog, assets, and generated manifest do not exist.

- [ ] **Step 3: Implement the exact USDA catalog**

Create `src/data/presetFoods.ts`:

```ts
import type { Food } from '../lib/nutritionTypes';

const VERSION = 'USDA-FDC-SR-Legacy-2019-04-01';
const base = { originalEnergyUnit: 'kcal', originalBasisAmount: 100, originalBasisUnit: 'g', basisAmount: 100, basisUnit: 'g', ediblePortionRatio: 1, densityGPerMl: null, conversionAssumptions: ['USDA cooked edible portion already reported per 100 g'], fdcDataType: 'SR Legacy', sourceRetrievedAt: '2026-08-14', sourceVersion: VERSION, license: 'CC0 1.0', preset: true, updatedAt: 0, deletedAt: null } as const;

export const PRESET_FOODS: Food[] = [
  { ...base, id: 'food:preset:usda:168878', fdcId: 168878, name: '熟米饭', aliases: ['米饭'], rawOrCooked: 'cooked', preparation: '蒸煮', originalEnergyValue: 130, originalProteinG: 2.69, energyKcal: 130, proteinG: 2.69, source: 'USDA FoodData Central FDC 168878' },
  { ...base, id: 'food:preset:usda:171477', fdcId: 171477, name: '熟鸡胸肉', aliases: ['鸡胸肉'], rawOrCooked: 'cooked', preparation: '去皮熟制', originalEnergyValue: 165, originalProteinG: 31, energyKcal: 165, proteinG: 31, source: 'USDA FoodData Central FDC 171477' },
  { ...base, id: 'food:preset:usda:170236', fdcId: 170236, name: '熟瘦牛肉', aliases: ['牛肉'], rawOrCooked: 'cooked', preparation: '瘦肉熟制', originalEnergyValue: 190, originalProteinG: 36.1, energyKcal: 190, proteinG: 36.1, source: 'USDA FoodData Central FDC 170236' },
];
```

Do not represent these values as Chinese food-composition data. The display names explicitly say cooked; the source string preserves each FDC ID.

- [ ] **Step 4: Install the deterministic converter and create the image-preparation script**

Install the pinned direct converter dependency first:

```bash
npm install --save-dev --save-exact sharp@0.33.5
```

Create `scripts/prepare-preset-food-images.mjs`:

```js
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const SOURCE_PATHS = process.argv.slice(2).map((value) => resolve(value));
const OUTPUT_NAMES = ['rice.webp', 'chicken-breast.webp', 'lean-beef.webp'];
const QUALITIES = [82, 78, 74, 70, 66, 62, 58];
const MAX_BYTES = 35 * 1024;
const OUTPUT_DIRECTORY = resolve(process.cwd(), 'public/food-presets');

if (SOURCE_PATHS.length !== OUTPUT_NAMES.length) {
  throw new Error('usage: npm run food-assets:prepare -- <rice-source> <chicken-source> <beef-source>');
}
if (new Set(SOURCE_PATHS).size !== SOURCE_PATHS.length) {
  throw new Error('each preset requires an independently generated source file');
}

for (const sourcePath of SOURCE_PATHS) {
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size === 0) throw new Error(`invalid source file: ${sourcePath}`);
}

const sourceHashes = await Promise.all(SOURCE_PATHS.map(async (sourcePath) =>
  createHash('sha256').update(await readFile(sourcePath)).digest('hex')));
if (new Set(sourceHashes).size !== SOURCE_PATHS.length) {
  throw new Error('each preset requires different source image bytes');
}

await mkdir(OUTPUT_DIRECTORY, { recursive: true });

for (const [index, sourcePath] of SOURCE_PATHS.entries()) {
  let encoded;
  for (const quality of QUALITIES) {
    const candidate = await sharp(sourcePath, { failOn: 'error' })
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'centre' })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    if (candidate.length <= MAX_BYTES) {
      encoded = candidate;
      break;
    }
  }
  if (encoded === undefined) {
    throw new Error(`${sourcePath} cannot fit the ${MAX_BYTES}-byte WebP budget`);
  }
  await writeFile(resolve(OUTPUT_DIRECTORY, OUTPUT_NAMES[index]), encoded);
}
```

Sharp strips input metadata unless metadata-retention methods are called; this script deliberately calls none. Exact dependency, resize, encoder effort, quality order, and output names are fixed, so rerunning on the same three source bytes produces the same committed WebPs.

- [ ] **Step 5: Lock the three independent prompts and review provenance**

Create `scripts/preset-food-image-provenance.mjs`:

```js
const PROMPT_PREFIX = 'Single isolated realistic food photograph for a mobile nutrition catalog:';
const PROMPT_SUFFIX = 'Cooked edible form matching the label, top-down to 45-degree camera, shallow white ceramic dish, soft neutral light-gray background, natural texture, no garnish that changes nutrition, no text, no logo, no packaging, no hands, one food only, centered, square composition, production catalog photography.';

export const PRESET_FOOD_IMAGE_PROVENANCE = Object.freeze([
  {
    foodId: 'food:preset:usda:168878',
    path: '/food-presets/rice.webp',
    name: '熟米饭',
    preparation: '蒸煮',
    width: 256,
    height: 256,
    cropVersion: 'center-cover-256-v1',
    generator: 'OpenAI imagegen',
    generationDate: '2026-08-14',
    prompt: `${PROMPT_PREFIX} steamed cooked white rice, distinct moist grains. ${PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview: '单碗熟白米饭，米粒和蒸煮形态可识别，无文字、包装、手部或额外食物',
  },
  {
    foodId: 'food:preset:usda:171477',
    path: '/food-presets/chicken-breast.webp',
    name: '熟鸡胸肉',
    preparation: '去皮熟制',
    width: 256,
    height: 256,
    cropVersion: 'center-cover-256-v1',
    generator: 'OpenAI imagegen',
    generationDate: '2026-08-14',
    prompt: `${PROMPT_PREFIX} skinless cooked chicken breast, plainly sliced, not fried. ${PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview: '单盘去皮熟鸡胸肉，切片和熟制形态可识别，非油炸，无文字、包装、手部或额外食物',
  },
  {
    foodId: 'food:preset:usda:170236',
    path: '/food-presets/lean-beef.webp',
    name: '熟瘦牛肉',
    preparation: '瘦肉熟制',
    width: 256,
    height: 256,
    cropVersion: 'center-cover-256-v1',
    generator: 'OpenAI imagegen',
    generationDate: '2026-08-14',
    prompt: `${PROMPT_PREFIX} cooked lean beef, plainly sliced, no visible sauce. ${PROMPT_SUFFIX}`,
    conversionRecipe: 'sharp@0.33.5/webp-effort6-quality-loop-v1',
    contentReview: '单盘熟瘦牛肉，切片和熟制形态可识别，无可见酱汁，无文字、包装、手部或额外食物',
  },
]);
```

- [ ] **Step 6: Create the validating manifest builder and package commands**

Create `scripts/build-preset-food-image-manifest.mjs`:

```js
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { PRESET_FOOD_IMAGE_PROVENANCE } from './preset-food-image-provenance.mjs';

const MAX_BYTES = 35 * 1024;
const OUTPUT = resolve(process.cwd(), 'src/data/presetFoodImageManifest.generated.ts');

if (PRESET_FOOD_IMAGE_PROVENANCE.length !== 3) {
  throw new Error('preset provenance must contain exactly three rows');
}
if (new Set(PRESET_FOOD_IMAGE_PROVENANCE.map((row) => row.foodId)).size !== 3 ||
    new Set(PRESET_FOOD_IMAGE_PROVENANCE.map((row) => row.path)).size !== 3) {
  throw new Error('preset food IDs and asset paths must be unique');
}

const rows = [];
for (const provenance of PRESET_FOOD_IMAGE_PROVENANCE) {
  const relativePath = provenance.path.replace(/^\//, '');
  if (!relativePath.startsWith('food-presets/') || relativePath.includes('..')) {
    throw new Error(`unsafe preset path: ${provenance.path}`);
  }
  const bytes = await readFile(resolve(process.cwd(), 'public', relativePath));
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    throw new Error(`${provenance.path} must be 1..${MAX_BYTES} bytes`);
  }
  if (bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      bytes.subarray(8, 12).toString('ascii') !== 'WEBP') {
    throw new Error(`${provenance.path} is not a RIFF/WEBP file`);
  }
  const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
  if (metadata.format !== 'webp' || metadata.width !== provenance.width || metadata.height !== provenance.height) {
    throw new Error(`${provenance.path} must be ${provenance.width}x${provenance.height} WebP`);
  }
  rows.push({
    ...provenance,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    reviewed: true,
  });
}

if (new Set(rows.map((row) => row.sha256)).size !== rows.length) {
  throw new Error('each preset requires different encoded image bytes');
}

const moduleSource = `// Generated by npm run food-assets:manifest. Do not edit by hand.\n` +
  `export const PRESET_FOOD_IMAGE_MANIFEST = ${JSON.stringify(rows, null, 2)} as const;\n\n` +
  `export type PresetFoodImageManifestRow = (typeof PRESET_FOOD_IMAGE_MANIFEST)[number];\n`;

await writeFile(OUTPUT, moduleSource, 'utf8');
```

The builder consumes only the three fixed provenance rows, validates the encoded files before hashing, and serializes every provenance field plus the real SHA-256 and `reviewed: true`; therefore the generated TypeScript contains no dummy digest or hand-edited review state.

Add both package scripts:

```json
"food-assets:prepare": "node scripts/prepare-preset-food-images.mjs",
"food-assets:manifest": "node scripts/build-preset-food-image-manifest.mjs"
```

- [ ] **Step 7: Generate each production asset separately with imagegen**

Use the imagegen tool three separate times, never a collage or a crop from one canvas. Use these exact prompts, adding only the food name where indicated:

```text
Single isolated realistic food photograph for a mobile nutrition catalog: [FOOD]. Cooked edible form matching the label, top-down to 45-degree camera, shallow white ceramic dish, soft neutral light-gray background, natural texture, no garnish that changes nutrition, no text, no logo, no packaging, no hands, one food only, centered, square composition, production catalog photography.
```

The three `[FOOD]` values are:

1. `steamed cooked white rice, distinct moist grains`
2. `skinless cooked chicken breast, plainly sliced, not fried`
3. `cooked lean beef, plainly sliced, no visible sauce`

Save the three independent imagegen outputs in `/private/tmp/tiezheng-food-sources/` without assuming PNG/JPEG/WebP. Visually inspect each source separately against its food-specific prompt, then inspect each converted WebP again; the three `contentReview` strings in `preset-food-image-provenance.mjs` are the required per-file evidence, not a shared batch approval. Regenerate any semantically wrong or duplicated image before conversion. The prepare and manifest scripts reject duplicate source bytes and duplicate encoded hashes, then convert with the pinned script:

```bash
npm run food-assets:prepare -- /private/tmp/tiezheng-food-sources/rice /private/tmp/tiezheng-food-sources/chicken /private/tmp/tiezheng-food-sources/beef
npm run food-assets:manifest
```

Expected: `src/data/presetFoodImageManifest.generated.ts` contains three distinct paths, three distinct actual 64-character hashes, full prompts, generation date, crop version, and three food-specific content-review statements.

- [ ] **Step 8: Run GREEN verification and commit data and assets together**

```bash
npm test -- src/data/presetFoods.test.ts
npm run typecheck
git add package.json package-lock.json scripts/prepare-preset-food-images.mjs scripts/preset-food-image-provenance.mjs scripts/build-preset-food-image-manifest.mjs src/data/presetFoods.ts src/data/presetFoods.test.ts src/data/presetFoodImageManifest.generated.ts public/food-presets
git commit -m "feat: add licensed nutrition presets and food assets"
```

Expected: catalog and manifest tests PASS; the commit contains all three independent WebPs and provenance.

### Task 4: Implement pure scaling, daily totals, plan construction, and the fail-closed target flag

**Files:** Create `src/lib/nutritionFeatureFlags.ts`, `src/lib/foodNormalization.ts`, `src/lib/nutritionStats.ts`, `src/lib/nutritionPlanPolicy.ts`, `src/lib/nutritionPlanValidation.ts`, and `src/lib/nutritionPlan.ts`; keep tests colocated with the public flag, normalization, stats, validation, and plan APIs.

- [ ] **Step 1: Write RED tests for flag default, nutrient math, and independent goals**

Create `src/lib/nutritionFeatureFlags.test.ts`:

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { autoNutritionTargetsEnabled } from './nutritionFeatureFlags';

afterEach(() => vi.unstubAllEnvs());

test('自动目标默认关闭且只接受精确 true', () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  expect(autoNutritionTargetsEnabled()).toBe(false);
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'TRUE');
  expect(autoNutritionTargetsEnabled()).toBe(false);
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  expect(autoNutritionTargetsEnabled()).toBe(true);
});
```

Create `src/lib/foodNormalization.test.ts`:

```ts
import { expect, test } from 'vitest';
import { normalizeFoodNutrients, type FoodNormalizationInput } from './foodNormalization';

const base: FoodNormalizationInput = {
  originalEnergyValue: 418.4,
  originalEnergyUnit: 'kJ',
  originalProteinG: 3.2,
  originalBasisAmount: 100,
  originalBasisUnit: 'g',
  normalizedBasisAmount: 100,
  normalizedBasisUnit: 'g',
  ediblePortionRatio: 1,
  densityGPerMl: null,
  conversionAssumptions: ['source edible portion'],
};

test('kJ 和同单位 basis 只由纯函数标准化', () => {
  const input = structuredClone(base);
  expect(normalizeFoodNutrients(input)).toEqual({
    basisAmount: 100,
    basisUnit: 'g',
    energyKcal: 100,
    proteinG: 3.2,
    conversionAssumptions: ['source edible portion', 'energy converted from kJ using 1 kcal = 4.184 kJ'],
  });
  expect(input).toEqual(base);
});

test('mL 标签在相同单位下不需密度', () => {
  expect(normalizeFoodNutrients({
    ...base,
    originalEnergyValue: 45,
    originalEnergyUnit: 'kcal',
    originalProteinG: 3.2,
    originalBasisUnit: 'mL',
    normalizedBasisUnit: 'mL',
    conversionAssumptions: ['label per 100 mL'],
  })).toEqual({
    basisAmount: 100,
    basisUnit: 'mL',
    energyKcal: 45,
    proteinG: 3.2,
    conversionAssumptions: ['label per 100 mL'],
  });
});

test('g 与 mL 跨单位换算显式记录密度', () => {
  expect(normalizeFoodNutrients({
    ...base,
    originalEnergyValue: 50,
    originalEnergyUnit: 'kcal',
    originalProteinG: 5,
    normalizedBasisUnit: 'mL',
    densityGPerMl: 1.2,
  })).toEqual({
    basisAmount: 100,
    basisUnit: 'mL',
    energyKcal: 60,
    proteinG: 6,
    conversionAssumptions: ['source edible portion', '100 mL converted to 120 g using density 1.2 g/mL'],
  });
  expect(() => normalizeFoodNutrients({ ...base, normalizedBasisUnit: 'mL' })).toThrow('density');
});

test.each([
  ['NaN energy', { originalEnergyValue: Number.NaN }],
  ['negative protein', { originalProteinG: -1 }],
  ['zero source basis', { originalBasisAmount: 0 }],
  ['zero normalized basis', { normalizedBasisAmount: 0 }],
  ['zero edible ratio', { ediblePortionRatio: 0 }],
  ['edible ratio above one', { ediblePortionRatio: 1.01 }],
  ['nonpositive density', { densityGPerMl: 0 }],
] as const)('%s fail closed', (_label, overrides) => {
  expect(() => normalizeFoodNutrients({ ...base, ...overrides })).toThrow();
});
```

Create `src/lib/nutritionStats.test.ts`:

```ts
import { expect, test } from 'vitest';
import { foodRow, mealItemRow, mealRow, nutritionPlanRow } from '../test/nutritionFixtures';
import type { NutritionDaySummary, NutritionDimensionEvaluation } from './nutritionStats';
import {
  evaluateNutritionDay,
  formatNutritionIntake,
  scaleFood,
  summarizeNutritionDay,
} from './nutritionStats';

function summary(overrides: Partial<NutritionDaySummary> = {}): NutritionDaySummary {
  return {
    energyKcalLow: 2_075,
    energyKcalHigh: 2_075,
    proteinGLow: 130,
    proteinGHigh: 130,
    recordedMeals: 1,
    recordedSlots: ['lunch'],
    hasRange: false,
    ...overrides,
  };
}

test('按标准化 basis 缩放，只汇总有效已确认项', () => {
  expect(scaleFood(foodRow({ energyKcal: 130, proteinG: 2.69 }), 150)).toEqual({
    energyKcal: 195,
    proteinG: 4.035,
  });
  const totals = summarizeNutritionDay(
    [
      mealRow({ id: 'meal:a', slot: 'breakfast' }),
      mealRow({ id: 'meal:b', slot: 'lunch' }),
      mealRow({ id: 'meal:deleted', slot: 'snack', deletedAt: 1 }),
    ],
    [
      mealItemRow({ mealId: 'meal:a', energyKcalLow: 100, energyKcalHigh: 100, proteinGLow: 10, proteinGHigh: 10, quality: 'A' }),
      mealItemRow({ id: 'meal-item:b', mealId: 'meal:b', energyKcalLow: 180, energyKcalHigh: 240, proteinGLow: 20, proteinGHigh: 25, quality: 'B' }),
      mealItemRow({ id: 'meal-item:deleted', mealId: 'meal:deleted', energyKcalLow: 999, energyKcalHigh: 999 }),
    ],
  );
  expect(totals).toEqual({ energyKcalLow: 280, energyKcalHigh: 340, proteinGLow: 30, proteinGHigh: 35, recordedMeals: 2, recordedSlots: ['breakfast', 'lunch'], hasRange: true });
});

test.each([
  ['below', summary({ proteinGLow: 90, proteinGHigh: 90 }), { relation: 'below', message: '蛋白质相对建议范围偏低', differenceLow: 20, differenceHigh: 70 }],
  ['within', summary(), { relation: 'within', message: '已进入建议范围', differenceLow: 0, differenceHigh: 0 }],
  ['above', summary({ proteinGLow: 180, proteinGHigh: 180 }), { relation: 'above', message: '蛋白质相对建议范围偏高', differenceLow: 20, differenceHigh: 70 }],
  ['uncertain overlap', summary({ proteinGLow: 100, proteinGHigh: 120, hasRange: true }), { relation: 'overlap', message: '可能与建议范围重叠', differenceLow: null, differenceHigh: null }],
] as const)('蛋白质区间 %s 不使用中点', (_name, input, expected) => {
  expect(evaluateNutritionDay(input, nutritionPlanRow()).protein).toMatchObject(expected);
});

test.each([
  [summary({ energyKcalLow: 1_800, energyKcalHigh: 1_800 }), { relation: 'below', message: '热量相对当前估算可能偏低', differenceLow: 200, differenceHigh: 350 }],
  [summary(), { relation: 'overlap', message: '热量相对当前估算重叠', differenceLow: null, differenceHigh: null }],
  [summary({ energyKcalLow: 2_300, energyKcalHigh: 2_400, hasRange: true }), { relation: 'above', message: '热量相对当前估算可能偏高', differenceLow: 150, differenceHigh: 400 }],
] as const)('热量只做相对估算而不宣称达标', (input, expected) => {
  const result = evaluateNutritionDay(input, nutritionPlanRow()).energy;
  expect(result).toMatchObject(expected);
  expect(result.message).not.toContain('达标');
});

test('蛋白质和热量可独立关闭', () => {
  const plan = nutritionPlanRow({
    targetMode: { ...nutritionPlanRow().targetMode, protein: 'disabled', energy: 'range', evaluationPolicy: 'energy-relative' },
  });
  const result = evaluateNutritionDay(summary(), plan);
  const disabledProtein: NutritionDimensionEvaluation = { mode: 'disabled', relation: 'neutral', message: '蛋白质建议范围未启用', differenceLow: null, differenceHigh: null };
  expect(result.protein).toEqual(disabledProtein);
  expect(result.energy.mode).toBe('energy-relative');
  const noPlan = evaluateNutritionDay(summary(), undefined);
  expect(noPlan.protein.mode).toBe('disabled');
  expect(noPlan.energy.mode).toBe('disabled');
  const proteinOnly = nutritionPlanRow({
    targetMode: { ...nutritionPlanRow().targetMode, protein: 'range', energy: 'disabled', evaluationPolicy: 'protein-range' },
  });
  expect(evaluateNutritionDay(summary(), proteinOnly)).toMatchObject({
    protein: { mode: 'protein-range' },
    energy: { mode: 'disabled', relation: 'neutral' },
  });
});

test('显示文案保留精确值或区间，不改写存储小数', () => {
  expect(formatNutritionIntake(summary({ recordedMeals: 0 }))).toBe('今天还没有已确认食物');
  expect(formatNutritionIntake(summary({ energyKcalLow: 100.4, energyKcalHigh: 100.4, proteinGLow: 10.04, proteinGHigh: 10.04 }))).toBe('100 kcal · 10 g 蛋白质');
  const ranged = summary({ energyKcalLow: 100.4, energyKcalHigh: 120.4, proteinGLow: 10.04, proteinGHigh: 12.04, hasRange: true });
  const before = structuredClone(ranged);
  expect(formatNutritionIntake(ranged)).toBe('约 100–120 kcal / 10–12 g 蛋白质');
  expect(ranged).toEqual(before);
});

test('尚无已确认食物时保持中性，不把零当作偏低', () => {
  const result = evaluateNutritionDay(summary({
    energyKcalLow: 0, energyKcalHigh: 0, proteinGLow: 0, proteinGHigh: 0,
    recordedMeals: 0, recordedSlots: [],
  }), nutritionPlanRow());
  expect(result).toMatchObject({
    protein: { mode: 'protein-range', relation: 'neutral', differenceLow: null, differenceHigh: null },
    energy: { mode: 'energy-relative', relation: 'neutral', differenceLow: null, differenceHigh: null },
  });
});
```

Create `src/lib/nutritionPlanValidation.test.ts` with this complete boundary suite. `nutritionPlanRow()` must return a valid, complete, both-goals fixture before overrides:

```ts
import { expect, test } from 'vitest';
import type { NutritionPlan } from './nutritionTypes';
import { nutritionPlanRow } from '../test/nutritionFixtures';
import { buildNutritionPlan, impliedWeeklyLossKg, nasemAdultEer, type NutritionPlanDraft } from './nutritionPlan';
import { assertNutritionPlanSemantics } from './nutritionPlanValidation';

function changed(edit: (plan: NutritionPlan) => void): NutritionPlan {
  const plan = structuredClone(nutritionPlanRow());
  edit(plan);
  return plan;
}

function rebuilt(edit: (draft: NutritionPlanDraft) => void = () => undefined, autoTargetsEnabled = true): NutritionPlan {
  const source = structuredClone(nutritionPlanRow());
  const { eligibilityBlockers: _ignored, ...safetyInputs } = source.safetyInputs; void _ignored;
  const draft: NutritionPlanDraft = {
    effectiveFrom: source.effectiveFrom, goals: { ...source.goals }, safetyInputs,
    equationInputs: {
      equationBranch: source.equationInputs.equationBranch,
      activityInputs: structuredClone(source.equationInputs.activityInputs),
      activityCategoryLow: source.equationInputs.activityCategoryLow,
      activityCategoryHigh: source.equationInputs.activityCategoryHigh,
    },
  };
  edit(draft);
  return buildNutritionPlan(draft, { autoTargetsEnabled, now: source.updatedAt });
}

test('完整计划通过；数值与日期边界 fail closed', () => {
  expect(nutritionPlanRow()).toMatchObject({
    proteinPolicySource: 'ISSN',
    proteinPolicyVersion: 'JISSN-2017-14-20',
  });
  expect(rebuilt()).toMatchObject({
    proteinPolicySource: 'ISSN',
    proteinPolicyVersion: 'JISSN-2017-14-20',
  });
  expect(() => assertNutritionPlanSemantics(nutritionPlanRow())).not.toThrow();
  for (const plan of [
    changed((p) => { p.safetyInputs.ageYears = 0; }),
    changed((p) => { p.safetyInputs.ageYears = 121; }),
    changed((p) => { p.safetyInputs.heightCm = 99.99; }),
    changed((p) => { p.safetyInputs.basisWeightKg = 300.01; }),
    changed((p) => { p.safetyInputs.targetLossKgPerWeek = 0; }),
    changed((p) => { p.safetyInputs.basisWeightDate = '2026-08-15'; }),
    changed((p) => { p.safetyInputs.targetDate = '2026-08-14'; }),
    changed((p) => { p.safetyInputs.targetWeightKg = p.safetyInputs.basisWeightKg; }),
  ]) expect(() => assertNutritionPlanSemantics(plan)).toThrow();
});

test('蛋白质政策来源与版本是持久化 literal，伪造值 fail closed', () => {
  for (const [field, value] of [
    ['proteinPolicySource', 'unknown-source'],
    ['proteinPolicyVersion', 'latest'],
  ] as const) {
    const forged = structuredClone(nutritionPlanRow()) as unknown as Record<string, unknown>;
    forged[field] = value;
    expect(() => assertNutritionPlanSemantics(forged as unknown as NutritionPlan)).toThrow('protein policy provenance');
  }
});

test('年龄小于 18 只能是带年龄 blocker 的中性计划', () => {
  const plan = rebuilt((draft) => { draft.safetyInputs.ageYears = 17; });
  expect(plan.safetyInputs.eligibilityBlockers).toEqual(['protein-age-under-18', 'energy-age-under-19']);
  expect(plan.targetMode).toMatchObject({ protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only' });
  expect(plan.equationInputs).toMatchObject({ equationName: 'not-calculated', equationBranch: 'unavailable', activityCategoryLow: null, activityCategoryHigh: null, maintenanceEnergyLowKcal: null, maintenanceEnergyHighKcal: null, calculatedAt: null });
  expect(() => assertNutritionPlanSemantics(plan)).not.toThrow();
  expect(() => assertNutritionPlanSemantics({ ...plan, equationInputs: nutritionPlanRow().equationInputs })).toThrow();
});

test('18 岁仅可启用蛋白，19 岁才可计算 EER；年龄缺失不能激活蛋白', () => {
  const proteinOnly = rebuilt((draft) => {
    draft.goals = { muscleGain: true, fatLoss: false };
    draft.safetyInputs.ageYears = 18;
  });
  expect(proteinOnly.targetMode).toMatchObject({ protein: 'range', energy: 'disabled' });
  expect(proteinOnly.safetyInputs.eligibilityBlockers).not.toContain('energy-age-under-19');
  expect(() => assertNutritionPlanSemantics(proteinOnly)).not.toThrow();
  const age18 = rebuilt((draft) => { draft.safetyInputs.ageYears = 18; });
  expect(age18.targetMode).toMatchObject({ protein: 'range', energy: 'disabled' });
  expect(age18.safetyInputs.eligibilityBlockers).toContain('energy-age-under-19');
  expect(age18.equationInputs.equationName).toBe('not-calculated');
  const age19 = rebuilt((draft) => { draft.safetyInputs.ageYears = 19; });
  expect(age19.equationInputs.equationName).toBe('NASEM-2023-adult-EER');
  expect(() => assertNutritionPlanSemantics(changed((p) => { p.safetyInputs.eligibilityBlockers.push('energy-age-under-19'); }))).toThrow();
  const missingAge = rebuilt((draft) => { draft.safetyInputs.ageYears = null; });
  expect(missingAge.targetMode).toMatchObject({ protein: 'disabled', energy: 'disabled' });
  expect(missingAge.safetyInputs.eligibilityBlockers).toContain('missing-inputs');
});

test('双目标的缺失输入按维度关闭，不误伤另一个完整维度', () => {
  const missingProtein = rebuilt((draft) => { draft.safetyInputs.proteinWeightMethod = null; });
  expect(missingProtein.safetyInputs.eligibilityBlockers).toContain('missing-inputs');
  expect(missingProtein.targetMode).toMatchObject({ protein: 'disabled', evaluationPolicy: 'energy-relative' });
  expect(missingProtein.targetMode.energy).not.toBe('disabled');
  expect(() => assertNutritionPlanSemantics(missingProtein)).not.toThrow();

  const missingEnergy = rebuilt((draft) => { draft.safetyInputs.targetWeightKg = null; });
  expect(missingEnergy.safetyInputs.eligibilityBlockers).toContain('missing-inputs');
  expect(missingEnergy.targetMode).toMatchObject({ protein: 'range', energy: 'disabled', evaluationPolicy: 'protein-range' });
  expect(() => assertNutritionPlanSemantics(missingEnergy)).not.toThrow();

  const missingShared = rebuilt((draft) => { draft.safetyInputs.pregnantOrBreastfeeding = null; });
  expect(missingShared.safetyInputs.eligibilityBlockers).toContain('missing-inputs');
  expect(missingShared.targetMode).toMatchObject({ protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only' });
  expect(() => assertNutritionPlanSemantics(missingShared)).not.toThrow();
});

test('flag off 的 equation/target/blocker/mode 唯一，safety raw 只留档不参与目标', () => {
  const neutral = rebuilt(() => undefined, false);
  expect(neutral.safetyInputs.eligibilityBlockers).toEqual(['automatic-targets-disabled']);
  expect(neutral.safetyInputs.ageYears).toBe(nutritionPlanRow().safetyInputs.ageYears);
  expect(neutral.targetRanges).toEqual({ proteinLowG: null, proteinHighG: null, proteinReferenceG: null, proteinLowCoefficient: null, proteinHighCoefficient: null, proteinReferenceCoefficient: null, energyLowKcal: null, energyHighKcal: null, energyRawLowKcal: null, energyRawHighKcal: null });
  expect(neutral.targetMode).toEqual({ protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only', autoTargetsEnabled: false, reason: 'professional-review-pending' });
  expect(neutral.equationInputs).toMatchObject({ equationName: 'not-calculated', equationBranch: 'unavailable', activityInputs: { assessmentStatus: 'not-provided' }, activityCategoryLow: null, activityCategoryHigh: null, maintenanceEnergyLowKcal: null, maintenanceEnergyHighKcal: null, calculatedAt: null });
  const retainedRaw = rebuilt((draft) => {
    draft.safetyInputs.proteinWeightMethod = null;
    draft.safetyInputs.targetWeightKg = null;
  }, false);
  expect(retainedRaw.safetyInputs).toMatchObject({ proteinWeightMethod: null, targetWeightKg: null, eligibilityBlockers: ['automatic-targets-disabled'] });
  expect(retainedRaw.targetRanges).toEqual(neutral.targetRanges);
  expect(retainedRaw.targetMode).toEqual(neutral.targetMode);
  expect(retainedRaw.equationInputs).toEqual(neutral.equationInputs);
  const retainedIneligibleRaw = rebuilt((draft) => {
    Object.assign(draft.safetyInputs, {
      ageYears: 17, heightCm: 175, basisWeightKg: 70, targetWeightKg: 65,
      targetLossKgPerWeek: impliedWeeklyLossKg(70, 65, draft.safetyInputs.basisWeightDate!, draft.safetyInputs.targetDate!),
      pregnantOrBreastfeeding: true,
    });
  }, false);
  expect(retainedIneligibleRaw.safetyInputs).toMatchObject({ ageYears: 17, pregnantOrBreastfeeding: true, eligibilityBlockers: ['automatic-targets-disabled'] });
  expect(retainedIneligibleRaw.targetRanges).toEqual(neutral.targetRanges);
  expect(retainedIneligibleRaw.targetMode).toEqual(neutral.targetMode);
  expect(retainedIneligibleRaw.equationInputs).toEqual(neutral.equationInputs);
  expect(() => assertNutritionPlanSemantics(neutral)).not.toThrow();
  expect(() => assertNutritionPlanSemantics(retainedRaw)).not.toThrow();
  expect(() => assertNutritionPlanSemantics(retainedIneligibleRaw)).not.toThrow();
  expect(() => assertNutritionPlanSemantics({ ...neutral, equationInputs: nutritionPlanRow().equationInputs })).toThrow();
  expect(() => assertNutritionPlanSemantics(changed((p) => { p.targetMode.autoTargetsEnabled = false; p.safetyInputs.eligibilityBlockers = ['automatic-targets-disabled']; }))).toThrow();
  expect(() => assertNutritionPlanSemantics({ ...neutral, safetyInputs: { ...neutral.safetyInputs, eligibilityBlockers: ['automatic-targets-disabled', 'missing-inputs'] } })).toThrow();
});

test('活动问卷只有明确未提供或完整两种规范状态', () => {
  expect(() => assertNutritionPlanSemantics(changed((p) => { p.equationInputs.activityInputs.assessmentStatus = 'not-provided'; }))).toThrow();
  expect(() => assertNutritionPlanSemantics(changed((p) => { p.equationInputs.activityInputs.stepsPerDay = 100001; }))).toThrow();
  const mixNone = (activity: NutritionPlan['equationInputs']['activityInputs']) => {
    activity.trainingTypes = ['none', 'cardio'];
    activity.trainingSessionsPerWeek = 2;
    activity.trainingMinutesPerSession = 30;
    activity.trainingIntensity = 'moderate';
  };
  expect(() => rebuilt((draft) => { mixNone(draft.equationInputs.activityInputs); })).toThrow('invalid training state');
  expect(() => assertNutritionPlanSemantics(changed((plan) => { mixNone(plan.equationInputs.activityInputs); }))).toThrow();
});

test('活动类别只允许 point 或相邻递增 range，并和 energy mode 对齐', () => {
  expect(() => assertNutritionPlanSemantics(changed((p) => {
    p.equationInputs.activityCategoryHigh = p.equationInputs.activityCategoryLow;
  }))).toThrow();
  expect(() => assertNutritionPlanSemantics(changed((p) => {
    p.equationInputs.activityCategoryLow = 'inactive';
    p.equationInputs.activityCategoryHigh = 'active';
  }))).toThrow();
  expect(() => assertNutritionPlanSemantics(changed((p) => {
    p.equationInputs.activityCategoryHigh = null;
    p.equationInputs.maintenanceEnergyHighKcal = p.equationInputs.maintenanceEnergyLowKcal;
    p.targetRanges.energyHighKcal = p.targetRanges.energyLowKcal;
    p.targetRanges.energyRawHighKcal = p.targetRanges.energyRawLowKcal;
    p.targetMode.energy = 'point';
  }))).not.toThrow();
});

test('EER 相邻类别以数值 min/max 持久化，floor 检查最低 raw 端点', () => {
  const active = nasemAdultEer({ branch: 'male', activity: 'active', ageYears: 19, heightCm: 100, weightKg: 27 });
  const veryActive = nasemAdultEer({ branch: 'male', activity: 'very-active', ageYears: 19, heightCm: 100, weightKg: 27 });
  expect(active).toBeGreaterThan(veryActive);
  const plan = rebuilt((draft) => {
    Object.assign(draft.safetyInputs, {
      ageYears: 19, heightCm: 100, basisWeightKg: 27, targetWeightKg: 24.3,
      targetLossKgPerWeek: impliedWeeklyLossKg(27, 24.3, draft.safetyInputs.basisWeightDate!, draft.safetyInputs.targetDate!),
    });
    Object.assign(draft.equationInputs, { equationBranch: 'male', activityCategoryLow: 'active', activityCategoryHigh: 'very-active' });
  });
  expect(plan.equationInputs).toMatchObject({ maintenanceEnergyLowKcal: veryActive, maintenanceEnergyHighKcal: active });
  expect(plan.safetyInputs.eligibilityBlockers).toContain('energy-floor');
  expect(plan.targetMode.energy).toBe('disabled');
  expect(() => assertNutritionPlanSemantics(plan)).not.toThrow();
});

test('raw energy range 不同但 nearest-50 展示相同时仍是合法 range', () => {
  const plan = rebuilt((draft) => {
    Object.assign(draft.safetyInputs, {
      ageYears: 20, heightCm: 100, basisWeightKg: 25, targetWeightKg: 22.5,
      targetLossKgPerWeek: impliedWeeklyLossKg(25, 22.5, draft.safetyInputs.basisWeightDate!, draft.safetyInputs.targetDate!),
    });
    Object.assign(draft.equationInputs, { equationBranch: 'female', activityCategoryLow: 'active', activityCategoryHigh: 'very-active' });
  });
  expect(plan.targetRanges.energyRawLowKcal!).toBeLessThan(plan.targetRanges.energyRawHighKcal!);
  expect(plan.targetRanges).toMatchObject({ energyLowKcal: 1250, energyHighKcal: 1250 });
  expect(plan.targetMode.energy).toBe('range');
  expect(() => assertNutritionPlanSemantics(plan)).not.toThrow();
});

test('BMI、首阶段 10% 和 mode/range/blocker 必须语义一致', () => {
  for (const plan of [
    changed((p) => { p.safetyInputs.basisWeightKg = 73.19; p.safetyInputs.heightCm = 175; }),
    changed((p) => { p.safetyInputs.targetWeightKg = 56.65; p.safetyInputs.heightCm = 175; }),
    changed((p) => { p.safetyInputs.targetWeightKg = (p.safetyInputs.basisWeightKg ?? 0) * 0.8999; }),
    changed((p) => { p.targetMode.protein = 'disabled'; }),
    changed((p) => { p.targetMode.evaluationPolicy = 'neutral-intake-only'; }),
    changed((p) => { p.safetyInputs.eligibilityBlockers = ['fat-loss-bmi-ineligible']; }),
  ]) expect(() => assertNutritionPlanSemantics(plan)).toThrow();
});

test.each([24, 27.99, 28])('BMI %s 的首阶段边界计划通过', (value) => {
  const plan = rebuilt((draft) => {
    const safety = draft.safetyInputs; safety.heightCm = 175;
    safety.basisWeightKg = value * (1.75 ** 2); safety.targetWeightKg = safety.basisWeightKg * 0.9;
    safety.targetLossKgPerWeek = impliedWeeklyLossKg(safety.basisWeightKg, safety.targetWeightKg, safety.basisWeightDate!, safety.targetDate!);
  });
  expect(() => assertNutritionPlanSemantics(plan)).not.toThrow();
});

test('BMI 23.9 只有显式 blocker、空热量区间时才通过', () => {
  const plan = rebuilt((draft) => {
    const safety = draft.safetyInputs; safety.heightCm = 175; safety.basisWeightKg = 23.9 * (1.75 ** 2);
    safety.targetWeightKg = safety.basisWeightKg * 0.9;
    safety.targetLossKgPerWeek = impliedWeeklyLossKg(safety.basisWeightKg, safety.targetWeightKg, safety.basisWeightDate!, safety.targetDate!);
  });
  expect(plan.safetyInputs.eligibilityBlockers).toContain('fat-loss-bmi-ineligible');
  expect(plan.targetMode.energy).toBe('disabled');
  expect(() => assertNutritionPlanSemantics(plan)).not.toThrow();
});

test.each([
  ['pregnantOrBreastfeeding', (plan: NutritionPlan) => { plan.safetyInputs.pregnantOrBreastfeeding = true; }],
  ['requiresTherapeuticDiet', (plan: NutritionPlan) => { plan.safetyInputs.requiresTherapeuticDiet = true; }],
  ['kidneyDiseaseOrComplexCondition', (plan: NutritionPlan) => { plan.safetyInputs.kidneyDiseaseOrComplexCondition = true; }],
  ['eatingDisorderOrRedsRisk', (plan: NutritionPlan) => { plan.safetyInputs.eatingDisorderOrRedsRisk = true; }],
  ['athleteOrExtremeActivity', (plan: NutritionPlan) => { plan.safetyInputs.athleteOrExtremeActivity = true; }],
  ['ageYears', (plan: NutritionPlan) => { plan.safetyInputs.ageYears = null; }],
] as const)('raw safety %s 改变但 blocker/mode 未重建时拒绝', (_field, mutate) => {
  expect(() => assertNutritionPlanSemantics(changed(mutate))).toThrow('derived');
});

test('伪造 blocker 与不可用于自动蛋白的体重方法都 fail closed', () => {
  expect(() => assertNutritionPlanSemantics(changed((plan) => { plan.safetyInputs.eligibilityBlockers.push('missing-inputs'); }))).toThrow();
  const highBody = rebuilt((draft) => { draft.safetyInputs.highBodyFatOrObesity = true; });
  expect(highBody.targetMode.protein).toBe('disabled');
  expect(highBody.safetyInputs.eligibilityBlockers).toContain('protein-weight-method-unverified');
  const professional = rebuilt((draft) => { draft.safetyInputs.proteinWeightMethod = 'professional-reference-weight'; });
  expect(professional.targetMode.protein).toBe('disabled');
});

test.each([
  (plan: NutritionPlan) => { plan.targetRanges.proteinReferenceG = plan.targetRanges.proteinReferenceG! + 5; },
  (plan: NutritionPlan) => { plan.equationInputs.maintenanceEnergyLowKcal = plan.equationInputs.maintenanceEnergyLowKcal! + 1; },
  (plan: NutritionPlan) => { plan.targetRanges.energyRawLowKcal = plan.targetRanges.energyRawLowKcal! + 1; },
  (plan: NutritionPlan) => { plan.targetRanges.energyLowKcal = plan.targetRanges.energyLowKcal! + 50; },
])('蛋白、EER 与 raw/display energy 均必须由 raw 重算', (forge) => {
  expect(() => assertNutritionPlanSemantics(changed(forge))).toThrow('derived');
});

test('calculatedAt 必须是有限时间戳', () => {
  expect(() => assertNutritionPlanSemantics(changed((plan) => {
    plan.equationInputs.calculatedAt = Number.NaN;
  }))).toThrow('calculatedAt');
});

test('恢复可重打行 updatedAt，但保留原 calculatedAt 与目标语义', () => {
  const restored = structuredClone(nutritionPlanRow());
  const calculatedAt = restored.equationInputs.calculatedAt;
  restored.updatedAt += 10_000;
  expect(restored.equationInputs.calculatedAt).toBe(calculatedAt);
  expect(() => assertNutritionPlanSemantics(restored)).not.toThrow();
});

test('对象属性插入顺序不是营养语义', () => {
  const reordered = structuredClone(nutritionPlanRow());
  reordered.safetyInputs = Object.fromEntries(
    Object.entries(reordered.safetyInputs).reverse(),
  ) as NutritionPlan['safetyInputs'];
  reordered.equationInputs.activityInputs = Object.fromEntries(
    Object.entries(reordered.equationInputs.activityInputs).reverse(),
  ) as NutritionPlan['equationInputs']['activityInputs'];
  expect(() => assertNutritionPlanSemantics(reordered)).not.toThrow();
});

test('速度由重量和日期重算；0.5 通过，超速生成 blocker 而不是结构异常', () => {
  const exact = rebuilt((draft) => {
    Object.assign(draft.safetyInputs, { basisWeightKg: 80, basisWeightDate: '2026-08-14', targetWeightKg: 76, targetDate: '2026-10-09', targetLossKgPerWeek: 0.5 });
  });
  expect(exact.safetyInputs.eligibilityBlockers).not.toContain('speed-or-six-month-limit');
  const tooFast = rebuilt((draft) => {
    Object.assign(draft.safetyInputs, { basisWeightKg: 80, basisWeightDate: '2026-08-14', targetWeightKg: 75, targetDate: '2026-10-09', targetLossKgPerWeek: 0.625 });
  });
  expect(tooFast.safetyInputs.eligibilityBlockers).toContain('speed-or-six-month-limit');
  expect(tooFast.targetMode.energy).toBe('disabled');
  expect(() => assertNutritionPlanSemantics(tooFast)).not.toThrow();
  expect(() => rebuilt((draft) => {
    Object.assign(draft.safetyInputs, { basisWeightKg: 80, basisWeightDate: '2026-08-14', targetWeightKg: 76, targetDate: '2026-10-09', targetLossKgPerWeek: 0.4999 });
  })).toThrow('disagrees');
  expect(() => rebuilt((draft) => {
    Object.assign(draft.safetyInputs, { basisWeightKg: 80, basisWeightDate: '2026-08-14', targetWeightKg: 75.2, targetDate: '2026-10-09', targetLossKgPerWeek: 0.4 });
  })).toThrow('disagrees');
});

test('10% 首阶段只约束六个月内；七个月且周速合格可通过', () => {
  const target = 80 * 0.8999;
  const fiveMonths = rebuilt((draft) => {
    Object.assign(draft.safetyInputs, { basisWeightKg: 80, basisWeightDate: '2026-08-14', targetWeightKg: target, targetDate: '2027-01-14', targetLossKgPerWeek: impliedWeeklyLossKg(80, target, '2026-08-14', '2027-01-14') });
  });
  expect(fiveMonths.safetyInputs.eligibilityBlockers).toContain('speed-or-six-month-limit');
  const sevenMonths = rebuilt((draft) => {
    Object.assign(draft.safetyInputs, { basisWeightKg: 80, basisWeightDate: '2026-08-14', targetWeightKg: target, targetDate: '2027-03-14', targetLossKgPerWeek: impliedWeeklyLossKg(80, target, '2026-08-14', '2027-03-14') });
  });
  expect(sevenMonths.safetyInputs.eligibilityBlockers).not.toContain('speed-or-six-month-limit');
  expect(sevenMonths.targetMode.energy).not.toBe('disabled');
});
```

Create `src/lib/nutritionPlan.test.ts` and cover:

- muscle gain and fat loss remain independent booleans and may both be true;
- a disabled flag canonicalizes all derived equation/target/blocker/mode fields, uses `neutral-intake-only`, and adds only `automatic-targets-disabled`; valid raw safety answers remain as an audit snapshot but never participate in target derivation while the flag is off;
- all eight NASEM 2023 adult equations match the published coefficients below, and every branch rejects age under 19;
- complete activity inputs persist into `equationInputs`; two users with the same training frequency but different occupation/commute/housework/steps may explicitly confirm different NASEM categories and get different endpoints;
- no API derives a category from training days alone; missing or out-of-range activity dimensions reject automatic energy construction;
- activity category canonicalization uses `high=null` for a point and exactly one adjacent higher category for a range; reversed, duplicate-high, or non-adjacent pairs throw before calculation, and tests lock `energy:'point'` versus `energy:'range'`;
- age 18 may receive an otherwise eligible protein range but receives `energy-age-under-19` and no energy output; age 17 receives both age blockers;
- enabled muscle gain at 80 kg produces rounded `110–160 g`, reference `130 g`, and persists coefficients `1.4/2.0/1.6`;
- active protein requires `proteinWeightMethod:'current-weight'` and `highBodyFatOrObesity:false`; `unverified`, `professional-reference-weight`, high body fat/obesity, kidney/complex disease, therapeutic diet, pregnancy, or a missing protein input blocks only that dimension;
- with both goals selected, a missing protein-only input leaves eligible energy active, a missing energy-only input leaves eligible protein active, and a missing shared safety answer blocks both dimensions;
- adjacent NASEM categories are labels, not a monotonic numeric promise: maintenance and energy intervals canonicalize their endpoints with numeric `min/max`, including the male age-19/100-cm/27-kg `active→very-active` crossing case;
- the energy policy applies `min(500, maintenance × 20%)` to both maintenance endpoints and checks the lowest canonical raw endpoint against the branch floor;
- rounded energy output also preserves both unrounded raw endpoints; an endpoint below the branch floor blocks instead of clamping, while a nonzero raw range whose two nearest-50 display endpoints are equal remains a valid `range`;
- missing branch, age under 19, safety flags, ineligible BMI, target BMI below 18.5, or speed over 0.5 kg/week blocks fat-loss output;
- BMI is exactly `kg / (heightM ** 2)`: Chinese-boundary table tests cover 23.9 blocked, 24.0 allowed, 27.99 allowed, and 28.0 allowed for energy; target BMI 18.49 blocks and 18.5 passes;
- persisted weekly speed must equal the weight/date-derived value rounded to three decimals; `0.5 kg/week` passes and any larger value blocks without throwing; exactly 10% passes within six calendar months, 10.01% blocks within five months, and the same loss over seven months may pass when rate-safe;
- NaN/Infinity, age/height/weight/activity outside declared ranges, impossible/misordered dates, and invalid target direction throw before a plan is persisted;
- fat-loss-only uses `energy-relative`, muscle-only uses `protein-range`, and both valid dimensions use `protein-range-and-energy-relative`;
- no function mutates its input.

Use one table-driven test with `A=30`, `H=175`, `W=75` and these exact expected expressions:

```ts
expect(nasemAdultEer({ branch: 'male', activity: 'inactive', ageYears: A, heightCm: H, weightKg: W })).toBeCloseTo(753.07 - 10.83*A + 6.50*H + 14.10*W);
expect(nasemAdultEer({ branch: 'male', activity: 'low-active', ageYears: A, heightCm: H, weightKg: W })).toBeCloseTo(581.47 - 10.83*A + 8.30*H + 14.94*W);
expect(nasemAdultEer({ branch: 'male', activity: 'active', ageYears: A, heightCm: H, weightKg: W })).toBeCloseTo(1004.82 - 10.83*A + 6.52*H + 15.91*W);
expect(nasemAdultEer({ branch: 'male', activity: 'very-active', ageYears: A, heightCm: H, weightKg: W })).toBeCloseTo(-517.88 - 10.83*A + 15.61*H + 19.11*W);
expect(nasemAdultEer({ branch: 'female', activity: 'inactive', ageYears: A, heightCm: H, weightKg: W })).toBeCloseTo(584.90 - 7.01*A + 5.72*H + 11.71*W);
expect(nasemAdultEer({ branch: 'female', activity: 'low-active', ageYears: A, heightCm: H, weightKg: W })).toBeCloseTo(575.77 - 7.01*A + 6.60*H + 12.14*W);
expect(nasemAdultEer({ branch: 'female', activity: 'active', ageYears: A, heightCm: H, weightKg: W })).toBeCloseTo(710.25 - 7.01*A + 6.54*H + 12.34*W);
expect(nasemAdultEer({ branch: 'female', activity: 'very-active', ageYears: A, heightCm: H, weightKg: W })).toBeCloseTo(511.83 - 7.01*A + 9.07*H + 12.56*W);
```

- [ ] **Step 2: Run tests to verify RED**

```bash
npm test -- src/lib/nutritionFeatureFlags.test.ts src/lib/foodNormalization.test.ts src/lib/nutritionStats.test.ts src/lib/nutritionPlanValidation.test.ts src/lib/nutritionPlan.test.ts
```

Expected: FAIL because the six pure implementation modules do not exist.

- [ ] **Step 3: Implement the flag and nutrition-stat APIs**

Create `src/lib/nutritionFeatureFlags.ts`:

```ts
export function autoNutritionTargetsEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_AUTO_NUTRITION_TARGETS === 'true';
}
```

Create `src/lib/foodNormalization.ts`:

```ts
import type { Food } from './nutritionTypes';

export interface FoodNormalizationInput {
  originalEnergyValue: number;
  originalEnergyUnit: 'kcal' | 'kJ';
  originalProteinG: number;
  originalBasisAmount: number;
  originalBasisUnit: 'g' | 'mL';
  normalizedBasisAmount: number;
  normalizedBasisUnit: 'g' | 'mL';
  ediblePortionRatio: number;
  densityGPerMl: number | null;
  conversionAssumptions: string[];
}

type NormalizedFoodNutrients = Pick<
  Food,
  'basisAmount' | 'basisUnit' | 'energyKcal' | 'proteinG' | 'conversionAssumptions'
>;

function requireFiniteNonnegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be finite and nonnegative`);
}

function requireFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be finite and positive`);
}

const stableDecimal = (value: number): number => Number(value.toFixed(12));

export function normalizeFoodNutrients(input: FoodNormalizationInput): NormalizedFoodNutrients {
  requireFiniteNonnegative(input.originalEnergyValue, 'originalEnergyValue');
  requireFiniteNonnegative(input.originalProteinG, 'originalProteinG');
  requireFinitePositive(input.originalBasisAmount, 'originalBasisAmount');
  requireFinitePositive(input.normalizedBasisAmount, 'normalizedBasisAmount');
  if (!Number.isFinite(input.ediblePortionRatio) || input.ediblePortionRatio <= 0 || input.ediblePortionRatio > 1) {
    throw new Error('ediblePortionRatio must be in (0, 1]');
  }
  if (input.densityGPerMl !== null) requireFinitePositive(input.densityGPerMl, 'densityGPerMl');
  if (input.conversionAssumptions.length === 0 || input.conversionAssumptions.some((value) => value.trim().length === 0)) {
    throw new Error('conversionAssumptions must contain nonblank provenance');
  }

  const assumptions = [...input.conversionAssumptions];
  const energyPerOriginalBasis = input.originalEnergyUnit === 'kJ'
    ? input.originalEnergyValue / 4.184
    : input.originalEnergyValue;
  if (input.originalEnergyUnit === 'kJ') {
    assumptions.push('energy converted from kJ using 1 kcal = 4.184 kJ');
  }

  let normalizedAmountInOriginalUnit = input.normalizedBasisAmount;
  if (input.originalBasisUnit !== input.normalizedBasisUnit) {
    const density = input.densityGPerMl;
    if (density === null) throw new Error('positive densityGPerMl is required for g/mL conversion');
    if (input.originalBasisUnit === 'g') {
      normalizedAmountInOriginalUnit = input.normalizedBasisAmount * density;
      assumptions.push(`${input.normalizedBasisAmount} mL converted to ${normalizedAmountInOriginalUnit} g using density ${density} g/mL`);
    } else {
      normalizedAmountInOriginalUnit = input.normalizedBasisAmount / density;
      assumptions.push(`${input.normalizedBasisAmount} g converted to ${normalizedAmountInOriginalUnit} mL using density ${density} g/mL`);
    }
  }

  const factor = normalizedAmountInOriginalUnit / input.originalBasisAmount;
  return {
    basisAmount: input.normalizedBasisAmount,
    basisUnit: input.normalizedBasisUnit,
    energyKcal: stableDecimal(energyPerOriginalBasis * factor),
    proteinG: stableDecimal(input.originalProteinG * factor),
    conversionAssumptions: assumptions,
  };
}
```

The edible ratio is validated and retained as provenance by the repository; it is not multiplied again because the source nutrient values already refer to their declared edible basis.

Create `src/lib/nutritionStats.ts`:

```ts
import type { Food, Meal, MealItem, MealSlot, NutritionPlan } from './nutritionTypes';

export interface NutritionDaySummary {
  energyKcalLow: number; energyKcalHigh: number;
  proteinGLow: number; proteinGHigh: number;
  recordedMeals: number; recordedSlots: MealSlot[];
  hasRange: boolean;
}

export interface NutritionDimensionEvaluation {
  mode: 'disabled' | 'protein-range' | 'energy-relative';
  relation: 'neutral' | 'below' | 'within' | 'above' | 'overlap';
  message: string; differenceLow: number | null; differenceHigh: number | null;
}
export interface NutritionDayEvaluation {
  protein: NutritionDimensionEvaluation; energy: NutritionDimensionEvaluation;
}

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function requireFiniteInterval(low: number, high: number, field: string): void {
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < low) {
    throw new Error(`${field} must be a finite nonnegative ordered interval`);
  }
}

export function scaleFood(food: Food, amount: number): { energyKcal: number; proteinG: number } {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount must be positive');
  if (!Number.isFinite(food.basisAmount) || food.basisAmount <= 0) throw new Error('food basis must be positive');
  if (!Number.isFinite(food.energyKcal) || food.energyKcal < 0 || !Number.isFinite(food.proteinG) || food.proteinG < 0) {
    throw new Error('food nutrients must be finite and nonnegative');
  }
  const factor = amount / food.basisAmount;
  return { energyKcal: food.energyKcal * factor, proteinG: food.proteinG * factor };
}

export function summarizeNutritionDay(meals: Meal[], items: MealItem[]): NutritionDaySummary {
  const activeMeals = new Map(meals.filter((meal) => meal.deletedAt === null).map((meal) => [meal.id, meal]));
  const activeItems = items.filter((item) => item.deletedAt === null && activeMeals.has(item.mealId));
  for (const item of activeItems) {
    requireFiniteInterval(item.energyKcalLow, item.energyKcalHigh, 'energy');
    requireFiniteInterval(item.proteinGLow, item.proteinGHigh, 'protein');
  }
  const recordedSet = new Set(activeItems.map((item) => activeMeals.get(item.mealId)!.slot));
  const recordedSlots = SLOT_ORDER.filter((slot) => recordedSet.has(slot));
  return {
    energyKcalLow: activeItems.reduce((sum, item) => sum + item.energyKcalLow, 0),
    energyKcalHigh: activeItems.reduce((sum, item) => sum + item.energyKcalHigh, 0),
    proteinGLow: activeItems.reduce((sum, item) => sum + item.proteinGLow, 0),
    proteinGHigh: activeItems.reduce((sum, item) => sum + item.proteinGHigh, 0),
    recordedMeals: recordedSlots.length,
    recordedSlots,
    hasRange: activeItems.some((item) => item.quality === 'B' || item.energyKcalLow !== item.energyKcalHigh || item.proteinGLow !== item.proteinGHigh),
  };
}

function disabled(message: string): NutritionDimensionEvaluation {
  return { mode: 'disabled', relation: 'neutral', message, differenceLow: null, differenceHigh: null };
}

function separatedRelation(
  intakeLow: number,
  intakeHigh: number,
  targetLow: number,
  targetHigh: number,
): Pick<NutritionDimensionEvaluation, 'relation' | 'differenceLow' | 'differenceHigh'> | undefined {
  if (intakeHigh < targetLow) {
    return { relation: 'below', differenceLow: targetLow - intakeHigh, differenceHigh: targetHigh - intakeLow };
  }
  if (intakeLow > targetHigh) {
    return { relation: 'above', differenceLow: intakeLow - targetHigh, differenceHigh: intakeHigh - targetLow };
  }
  return undefined;
}

function evaluateProtein(summary: NutritionDaySummary, plan: NutritionPlan | undefined): NutritionDimensionEvaluation {
  if (plan === undefined || plan.deletedAt !== null || plan.targetMode.protein !== 'range') {
    return disabled('蛋白质建议范围未启用');
  }
  const low = plan.targetRanges.proteinLowG;
  const high = plan.targetRanges.proteinHighG;
  if (low === null || high === null) return disabled('蛋白质建议范围未启用');
  if (summary.recordedMeals === 0) {
    return { mode: 'protein-range', relation: 'neutral', message: '尚无已确认食物，暂不评价蛋白质', differenceLow: null, differenceHigh: null };
  }
  requireFiniteInterval(summary.proteinGLow, summary.proteinGHigh, 'protein intake');
  requireFiniteInterval(low, high, 'protein target');
  const separated = separatedRelation(summary.proteinGLow, summary.proteinGHigh, low, high);
  if (separated) {
    return {
      mode: 'protein-range',
      ...separated,
      message: separated.relation === 'below' ? '蛋白质相对建议范围偏低' : '蛋白质相对建议范围偏高',
    };
  }
  if (!summary.hasRange && summary.proteinGLow === summary.proteinGHigh) {
    return { mode: 'protein-range', relation: 'within', message: '已进入建议范围', differenceLow: 0, differenceHigh: 0 };
  }
  return { mode: 'protein-range', relation: 'overlap', message: '可能与建议范围重叠', differenceLow: null, differenceHigh: null };
}

function evaluateEnergy(summary: NutritionDaySummary, plan: NutritionPlan | undefined): NutritionDimensionEvaluation {
  if (plan === undefined || plan.deletedAt !== null || plan.targetMode.energy === 'disabled') {
    return disabled('热量当前估算未启用');
  }
  const low = plan.targetRanges.energyLowKcal;
  const high = plan.targetRanges.energyHighKcal;
  if (low === null || high === null) return disabled('热量当前估算未启用');
  if (summary.recordedMeals === 0) {
    return { mode: 'energy-relative', relation: 'neutral', message: '尚无已确认食物，暂不评价热量', differenceLow: null, differenceHigh: null };
  }
  requireFiniteInterval(summary.energyKcalLow, summary.energyKcalHigh, 'energy intake');
  requireFiniteInterval(low, high, 'energy target');
  const separated = separatedRelation(summary.energyKcalLow, summary.energyKcalHigh, low, high);
  if (separated) {
    return {
      mode: 'energy-relative',
      ...separated,
      message: separated.relation === 'below' ? '热量相对当前估算可能偏低' : '热量相对当前估算可能偏高',
    };
  }
  return { mode: 'energy-relative', relation: 'overlap', message: '热量相对当前估算重叠', differenceLow: null, differenceHigh: null };
}

export function evaluateNutritionDay(
  summary: NutritionDaySummary,
  plan: NutritionPlan | undefined,
): NutritionDayEvaluation {
  return { protein: evaluateProtein(summary, plan), energy: evaluateEnergy(summary, plan) };
}

const displayedProtein = (value: number): string => String(Math.round(value * 10) / 10);

export function formatNutritionIntake(summary: NutritionDaySummary): string {
  if (summary.recordedMeals === 0) return '今天还没有已确认食物';
  requireFiniteInterval(summary.energyKcalLow, summary.energyKcalHigh, 'energy intake');
  requireFiniteInterval(summary.proteinGLow, summary.proteinGHigh, 'protein intake');
  const energy = summary.energyKcalLow === summary.energyKcalHigh
    ? String(Math.round(summary.energyKcalLow))
    : `${Math.round(summary.energyKcalLow)}–${Math.round(summary.energyKcalHigh)}`;
  const protein = summary.proteinGLow === summary.proteinGHigh
    ? displayedProtein(summary.proteinGLow)
    : `${displayedProtein(summary.proteinGLow)}–${displayedProtein(summary.proteinGHigh)}`;
  return summary.hasRange
    ? `约 ${energy} kcal / ${protein} g 蛋白质`
    : `${energy} kcal · ${protein} g 蛋白质`;
}
```

- [ ] **Step 4: Implement one shared derivation kernel and persisted-plan semantic gate**

Create `src/lib/nutritionPlanPolicy.ts`. Both the builder and validator consume this module; neither may carry a second coefficient table or target policy:

```ts
import type {
  ActivityCategory, EquationBranch, NutritionActivityInputs, NutritionEligibilityBlocker,
  NutritionEquationInputs, NutritionGoals, NutritionSafetyInputs,
  NutritionTargetMode, NutritionTargetRanges,
} from './nutritionTypes';
import { stableJson } from './stableJson';

export interface NutritionPlanRawInputs {
  effectiveFrom: string; goals: NutritionGoals;
  safetyInputs: Omit<NutritionSafetyInputs, 'eligibilityBlockers'>;
  equationInputs: Pick<NutritionEquationInputs, 'equationBranch' | 'activityInputs' | 'activityCategoryLow' | 'activityCategoryHigh'>;
  autoTargetsEnabled: boolean; now: number;
}
export interface DerivedNutritionPlanSemantics {
  safetyInputs: NutritionSafetyInputs; equationInputs: NutritionEquationInputs;
  targetRanges: NutritionTargetRanges; targetMode: NutritionTargetMode;
}

const ACTIVITY: ActivityCategory[] = ['inactive', 'low-active', 'active', 'very-active'];
const BLOCKER_ORDER: NutritionEligibilityBlocker[] = [
  'automatic-targets-disabled', 'protein-age-under-18', 'energy-age-under-19', 'missing-inputs',
  'equation-branch-unavailable', 'fat-loss-bmi-ineligible', 'target-bmi-below-18.5',
  'pregnancy-or-breastfeeding', 'therapeutic-diet-required', 'kidney-or-complex-condition',
  'eating-disorder-or-reds-risk', 'athlete-or-extreme-activity',
  'protein-weight-method-unverified', 'energy-floor', 'speed-or-six-month-limit',
];
const EER = {
  male: {
    inactive: [753.07, -10.83, 6.50, 14.10], 'low-active': [581.47, -10.83, 8.30, 14.94],
    active: [1004.82, -10.83, 6.52, 15.91], 'very-active': [-517.88, -10.83, 15.61, 19.11],
  },
  female: {
    inactive: [584.90, -7.01, 5.72, 11.71], 'low-active': [575.77, -7.01, 6.60, 12.14],
    active: [710.25, -7.01, 6.54, 12.34], 'very-active': [511.83, -7.01, 9.07, 12.56],
  },
} as const;
const EMPTY_ACTIVITY: NutritionActivityInputs = {
  assessmentStatus: 'not-provided', occupation: 'not-provided',
  activeCommuteMinutesPerDay: null, householdMinutesPerDay: null, stepsPerDay: null,
  trainingTypes: [], trainingSessionsPerWeek: null, trainingMinutesPerSession: null,
  trainingIntensity: 'not-provided',
};
const EMPTY_TARGETS: NutritionTargetRanges = {
  proteinLowG: null, proteinHighG: null, proteinReferenceG: null,
  proteinLowCoefficient: null, proteinHighCoefficient: null, proteinReferenceCoefficient: null,
  energyLowKcal: null, energyHighKcal: null, energyRawLowKcal: null, energyRawHighKcal: null,
};
const PROTEIN_BLOCKERS: NutritionEligibilityBlocker[] = [
  'protein-age-under-18', 'pregnancy-or-breastfeeding',
  'therapeutic-diet-required', 'kidney-or-complex-condition', 'eating-disorder-or-reds-risk',
  'athlete-or-extreme-activity', 'protein-weight-method-unverified',
];
const ENERGY_BLOCKERS: NutritionEligibilityBlocker[] = [
  'energy-age-under-19', 'equation-branch-unavailable',
  'fat-loss-bmi-ineligible', 'target-bmi-below-18.5', 'pregnancy-or-breastfeeding',
  'therapeutic-diet-required', 'kidney-or-complex-condition', 'eating-disorder-or-reds-risk',
  'athlete-or-extreme-activity', 'energy-floor', 'speed-or-six-month-limit',
];

const round5 = (value: number) => Math.round(value / 5) * 5;
const round50 = (value: number) => Math.round(value / 50) * 50;
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
const addCalendarMonths = (date: string, months: number) => {
  const [year, month, day] = date.split('-').map(Number); const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
};
export const impliedWeeklyLossKg = (basisWeightKg: number, targetWeightKg: number, basisDate: string, targetDate: string) =>
  Number((((basisWeightKg - targetWeightKg) * 7) / daysBetween(basisDate, targetDate)).toFixed(3));
const copyActivity = (value: NutritionActivityInputs): NutritionActivityInputs => ({ ...value, trainingTypes: [...value.trainingTypes] });
const realDate = (value: string, name: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  const [y, m, d] = value.split('-').map(Number); const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) throw new Error(`${name} must be a calendar date`);
};
const bounded = (value: number | null, name: string, low: number, high: number) => {
  if (value !== null && (!Number.isFinite(value) || value < low || value > high)) throw new Error(`${name} out of range`);
};
const add = (rows: NutritionEligibilityBlocker[], value: NutritionEligibilityBlocker) => { if (!rows.includes(value)) rows.push(value); };
const hasAny = (rows: NutritionEligibilityBlocker[], values: NutritionEligibilityBlocker[]) => values.some((value) => rows.includes(value));

export function bodyMassIndex(weightKg: number, heightCm: number): number {
  return weightKg / ((heightCm / 100) ** 2);
}
export function proteinTargetRange(weightKg: number) {
  return {
    proteinLowG: round5(weightKg * 1.4), proteinHighG: round5(weightKg * 2),
    proteinReferenceG: round5(weightKg * 1.6), proteinLowCoefficient: 1.4,
    proteinHighCoefficient: 2, proteinReferenceCoefficient: 1.6,
  };
}
export function nasemAdultEer(input: { branch: Exclude<EquationBranch, 'unavailable'>; activity: ActivityCategory; ageYears: number; heightCm: number; weightKg: number }): number {
  if (input.ageYears < 19) throw new Error('NASEM adult EER requires age 19+');
  const [base, age, height, weight] = EER[input.branch][input.activity];
  return base + age * input.ageYears + height * input.heightCm + weight * input.weightKg;
}
export function fatLossEnergyRange(maintenanceLowKcal: number, maintenanceHighKcal: number, branch: Exclude<EquationBranch, 'unavailable'>) {
  const rawCandidates = [maintenanceLowKcal, maintenanceHighKcal]
    .map((maintenance) => maintenance - Math.min(500, maintenance * 0.2));
  const energyRawLowKcal = Math.min(...rawCandidates);
  const energyRawHighKcal = Math.max(...rawCandidates);
  const floor = branch === 'female' ? 1200 : 1500;
  if (energyRawLowKcal < floor) return null;
  return { energyLowKcal: round50(energyRawLowKcal), energyHighKcal: round50(energyRawHighKcal), energyRawLowKcal, energyRawHighKcal };
}
export function validateActivityInputs(input: NutritionActivityInputs): void {
  if (input.assessmentStatus === 'not-provided') {
    if (stableJson(input) !== stableJson(EMPTY_ACTIVITY)) throw new Error('noncanonical not-provided activity');
    return;
  }
  if (input.occupation === 'not-provided' || input.trainingIntensity === 'not-provided') throw new Error('incomplete activity');
  bounded(input.activeCommuteMinutesPerDay, 'commute', 0, 1440); bounded(input.householdMinutesPerDay, 'housework', 0, 1440);
  bounded(input.stepsPerDay, 'steps', 0, 100000); bounded(input.trainingSessionsPerWeek, 'sessions', 0, 14); bounded(input.trainingMinutesPerSession, 'duration', 0, 600);
  if ([input.activeCommuteMinutesPerDay, input.householdMinutesPerDay, input.stepsPerDay, input.trainingSessionsPerWeek, input.trainingMinutesPerSession].some((value) => value === null)) throw new Error('complete activity requires every field');
  const hasNone = input.trainingTypes.includes('none');
  if (hasNone && input.trainingTypes.length !== 1) throw new Error('invalid training state: none cannot be combined with training types');
  const none = hasNone;
  if (input.trainingTypes.length === 0 || new Set(input.trainingTypes).size !== input.trainingTypes.length ||
    none !== (input.trainingSessionsPerWeek === 0 && input.trainingMinutesPerSession === 0 && input.trainingIntensity === 'none') ||
    (!none && (input.trainingSessionsPerWeek === 0 || input.trainingMinutesPerSession === 0 || input.trainingIntensity === 'none'))) throw new Error('invalid training state');
}

function validateRaw(raw: NutritionPlanRawInputs): void {
  realDate(raw.effectiveFrom, 'effectiveFrom'); const safety = raw.safetyInputs;
  bounded(safety.ageYears, 'age', 1, 120); if (safety.ageYears !== null && !Number.isInteger(safety.ageYears)) throw new Error('age must be integer');
  bounded(safety.heightCm, 'height', 100, 250); bounded(safety.basisWeightKg, 'basis weight', 20, 300); bounded(safety.targetWeightKg, 'target weight', 20, 300);
  if (safety.targetLossKgPerWeek !== null && (!Number.isFinite(safety.targetLossKgPerWeek) || safety.targetLossKgPerWeek <= 0)) throw new Error('loss speed must be positive');
  if (safety.basisWeightDate !== null) { realDate(safety.basisWeightDate, 'basisWeightDate'); if (safety.basisWeightDate > raw.effectiveFrom) throw new Error('future basis weight'); }
  if (safety.targetDate !== null) { realDate(safety.targetDate, 'targetDate'); if (safety.targetDate <= raw.effectiveFrom) throw new Error('target date order'); }
  validateActivityInputs(raw.equationInputs.activityInputs);
}

export function deriveNutritionPlanSemantics(raw: NutritionPlanRawInputs): DerivedNutritionPlanSemantics {
  validateRaw(raw); const safety = raw.safetyInputs; const requestedGoal = raw.goals.muscleGain || raw.goals.fatLoss;
  const blockers: NutritionEligibilityBlocker[] = []; let targets = { ...EMPTY_TARGETS };
  const canonicalRecording = !raw.autoTargetsEnabled || !requestedGoal;
  let activity = canonicalRecording ? copyActivity(EMPTY_ACTIVITY) : copyActivity(raw.equationInputs.activityInputs);
  let equation: NutritionEquationInputs = {
    equationName: 'not-calculated', equationBranch: 'unavailable', activityInputs: activity,
    activityCategoryLow: null, activityCategoryHigh: null,
    maintenanceEnergyLowKcal: null, maintenanceEnergyHighKcal: null, calculatedAt: null,
  };
  if (!raw.autoTargetsEnabled) {
    add(blockers, 'automatic-targets-disabled');
    return { safetyInputs: { ...safety, eligibilityBlockers: blockers }, equationInputs: equation, targetRanges: targets,
      targetMode: { protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only', autoTargetsEnabled: false, reason: 'professional-review-pending' } };
  }
  if (!requestedGoal) {
    return { safetyInputs: { ...safety, eligibilityBlockers: [] }, equationInputs: equation, targetRanges: targets,
      targetMode: { protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only', autoTargetsEnabled: true, reason: 'active' } };
  }

  const sharedAnswers = [safety.pregnantOrBreastfeeding, safety.requiresTherapeuticDiet, safety.kidneyDiseaseOrComplexCondition, safety.eatingDisorderOrRedsRisk, safety.athleteOrExtremeActivity];
  const sharedInputsMissing = sharedAnswers.some((value) => value === null);
  if (sharedInputsMissing) add(blockers, 'missing-inputs');
  if (safety.pregnantOrBreastfeeding) add(blockers, 'pregnancy-or-breastfeeding');
  if (safety.requiresTherapeuticDiet) add(blockers, 'therapeutic-diet-required');
  if (safety.kidneyDiseaseOrComplexCondition) add(blockers, 'kidney-or-complex-condition');
  if (safety.eatingDisorderOrRedsRisk) add(blockers, 'eating-disorder-or-reds-risk');
  if (safety.athleteOrExtremeActivity) add(blockers, 'athlete-or-extreme-activity');

  let proteinInputsMissing = false;
  if (raw.goals.muscleGain) {
    proteinInputsMissing = safety.ageYears === null || safety.basisWeightKg === null || safety.basisWeightDate === null || safety.proteinWeightMethod === null || safety.highBodyFatOrObesity === null;
    if (proteinInputsMissing) add(blockers, 'missing-inputs');
    if (safety.ageYears !== null && safety.ageYears < 18) add(blockers, 'protein-age-under-18');
    if (safety.proteinWeightMethod !== 'current-weight' || safety.highBodyFatOrObesity !== false) add(blockers, 'protein-weight-method-unverified');
    if (!sharedInputsMissing && !proteinInputsMissing && !hasAny(blockers, PROTEIN_BLOCKERS) && safety.basisWeightKg !== null) targets = { ...targets, ...proteinTargetRange(safety.basisWeightKg) };
  }

  let energyMode: NutritionTargetMode['energy'] = 'disabled';
  let energyInputsMissing = false;
  if (raw.goals.fatLoss) {
    energyInputsMissing = safety.ageYears === null || safety.heightCm === null || safety.basisWeightKg === null || safety.basisWeightDate === null || safety.targetWeightKg === null || safety.targetLossKgPerWeek === null || safety.targetDate === null;
    if (energyInputsMissing) add(blockers, 'missing-inputs');
    if (safety.ageYears !== null && safety.ageYears < 19) add(blockers, 'energy-age-under-19');
    const adult = safety.ageYears !== null && safety.ageYears >= 19;
    if (adult && raw.equationInputs.equationBranch === 'unavailable') add(blockers, 'equation-branch-unavailable');
    if (adult && activity.assessmentStatus !== 'complete') { energyInputsMissing = true; add(blockers, 'missing-inputs'); }
    const lowIndex = raw.equationInputs.activityCategoryLow === null ? -1 : ACTIVITY.indexOf(raw.equationInputs.activityCategoryLow);
    const highIndex = raw.equationInputs.activityCategoryHigh === null ? -1 : ACTIVITY.indexOf(raw.equationInputs.activityCategoryHigh);
    if (adult && activity.assessmentStatus === 'complete' && lowIndex === -1) { energyInputsMissing = true; add(blockers, 'missing-inputs'); }
    if (highIndex !== -1 && highIndex !== lowIndex + 1) throw new Error('activity categories must be adjacent');

    if (safety.basisWeightKg !== null && safety.heightCm !== null && safety.targetWeightKg !== null) {
      if (safety.targetWeightKg >= safety.basisWeightKg) throw new Error('target direction');
      if (bodyMassIndex(safety.basisWeightKg, safety.heightCm) < 24) add(blockers, 'fat-loss-bmi-ineligible');
      if (bodyMassIndex(safety.targetWeightKg, safety.heightCm) < 18.5) add(blockers, 'target-bmi-below-18.5');
      const impliedRate = safety.targetLossKgPerWeek !== null && safety.basisWeightDate !== null && safety.targetDate !== null
        ? impliedWeeklyLossKg(safety.basisWeightKg, safety.targetWeightKg, safety.basisWeightDate, safety.targetDate) : null;
      if (impliedRate !== null && safety.targetLossKgPerWeek !== impliedRate) throw new Error('stored loss speed disagrees with weight/date');
      const speedInvalid = impliedRate !== null && impliedRate > 0.5;
      const phaseInvalid = safety.basisWeightDate !== null && safety.targetDate !== null &&
        safety.targetDate <= addCalendarMonths(safety.basisWeightDate, 6) && safety.targetWeightKg < safety.basisWeightKg * 0.9;
      if (speedInvalid || phaseInvalid) add(blockers, 'speed-or-six-month-limit');
    }

    if (adult && safety.heightCm !== null && safety.basisWeightKg !== null && raw.equationInputs.equationBranch !== 'unavailable' && activity.assessmentStatus === 'complete' && lowIndex !== -1) {
      const branch = raw.equationInputs.equationBranch; const lowCategory = raw.equationInputs.activityCategoryLow!;
      const highCategory = raw.equationInputs.activityCategoryHigh;
      const firstMaintenance = nasemAdultEer({ branch, activity: lowCategory, ageYears: safety.ageYears!, heightCm: safety.heightCm, weightKg: safety.basisWeightKg });
      const secondMaintenance = highCategory === null ? firstMaintenance : nasemAdultEer({ branch, activity: highCategory, ageYears: safety.ageYears!, heightCm: safety.heightCm, weightKg: safety.basisWeightKg });
      const maintenanceLow = Math.min(firstMaintenance, secondMaintenance);
      const maintenanceHigh = Math.max(firstMaintenance, secondMaintenance);
      equation = { equationName: 'NASEM-2023-adult-EER', equationBranch: branch, activityInputs: activity,
        activityCategoryLow: lowCategory, activityCategoryHigh: highCategory,
        maintenanceEnergyLowKcal: maintenanceLow, maintenanceEnergyHighKcal: maintenanceHigh, calculatedAt: raw.now };
      if (!sharedInputsMissing && !energyInputsMissing && !hasAny(blockers, ENERGY_BLOCKERS)) {
        const energy = fatLossEnergyRange(maintenanceLow, maintenanceHigh, branch);
        if (energy === null) add(blockers, 'energy-floor');
        else {
          targets = { ...targets, ...energy };
          energyMode = highCategory === null ? 'point' : 'range';
        }
      }
    }
  }

  const ordered = BLOCKER_ORDER.filter((value) => blockers.includes(value));
  const proteinMode: NutritionTargetMode['protein'] = targets.proteinLowG === null ? 'disabled' : 'range';
  if (energyMode !== 'disabled' && (sharedInputsMissing || energyInputsMissing || hasAny(ordered, ENERGY_BLOCKERS))) { targets = { ...targets, energyLowKcal: null, energyHighKcal: null, energyRawLowKcal: null, energyRawHighKcal: null }; energyMode = 'disabled'; }
  const evaluationPolicy = proteinMode === 'range' && energyMode !== 'disabled' ? 'protein-range-and-energy-relative'
    : proteinMode === 'range' ? 'protein-range' : energyMode !== 'disabled' ? 'energy-relative' : 'neutral-intake-only';
  return {
    safetyInputs: { ...safety, eligibilityBlockers: ordered }, equationInputs: equation, targetRanges: targets,
    targetMode: { protein: proteinMode, energy: energyMode, evaluationPolicy, autoTargetsEnabled: true,
      reason: proteinMode === 'range' || energyMode !== 'disabled' ? 'active' : 'eligibility-blocked' },
  };
}
```

Create `src/lib/nutritionPlanValidation.ts` exactly as the one post-parse authority used by both this plan and the later backup parser:

```ts
import type {
  ActivityCategory, NutritionActivityInputs, NutritionEligibilityBlocker, NutritionPlan,
} from './nutritionTypes';
import { deriveNutritionPlanSemantics } from './nutritionPlanPolicy';
import { stableJson } from './stableJson';

const ACTIVITY_ORDER: ActivityCategory[] = ['inactive', 'low-active', 'active', 'very-active'];
const PROTEIN_FIELDS = [
  'proteinLowG', 'proteinHighG', 'proteinReferenceG',
  'proteinLowCoefficient', 'proteinHighCoefficient', 'proteinReferenceCoefficient',
] as const;
const ENERGY_FIELDS = ['energyLowKcal', 'energyHighKcal', 'energyRawLowKcal', 'energyRawHighKcal'] as const;
const PROTEIN_BLOCKERS: NutritionEligibilityBlocker[] = [
  'automatic-targets-disabled', 'protein-age-under-18',
  'pregnancy-or-breastfeeding', 'therapeutic-diet-required', 'kidney-or-complex-condition',
  'eating-disorder-or-reds-risk', 'athlete-or-extreme-activity', 'protein-weight-method-unverified',
];
const ENERGY_BLOCKERS: NutritionEligibilityBlocker[] = [
  'automatic-targets-disabled', 'energy-age-under-19',
  'equation-branch-unavailable', 'fat-loss-bmi-ineligible', 'target-bmi-below-18.5',
  'pregnancy-or-breastfeeding', 'therapeutic-diet-required', 'kidney-or-complex-condition',
  'eating-disorder-or-reds-risk', 'athlete-or-extreme-activity', 'energy-floor',
  'speed-or-six-month-limit',
];

function fail(message: string): never { throw new Error(`invalid nutrition plan: ${message}`); }
function finite(value: number | null, name: string, min: number, max: number): void {
  if (value !== null && (!Number.isFinite(value) || value < min || value > max)) fail(name);
}
function realDate(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(name);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) fail(name);
}
function allNull(plan: NutritionPlan, fields: readonly (keyof NutritionPlan['targetRanges'])[]): boolean {
  return fields.every((field) => plan.targetRanges[field] === null);
}
function allFinite(plan: NutritionPlan, fields: readonly (keyof NutritionPlan['targetRanges'])[]): boolean {
  return fields.every((field) => {
    const value = plan.targetRanges[field];
    return typeof value === 'number' && Number.isFinite(value);
  });
}
function hasAny(blockers: NutritionEligibilityBlocker[], candidates: NutritionEligibilityBlocker[]): boolean {
  return candidates.some((candidate) => blockers.includes(candidate));
}
function bmi(weightKg: number, heightCm: number): number {
  return weightKg / ((heightCm / 100) ** 2);
}
function sharedInputsMissing(plan: NutritionPlan): boolean {
  const safety = plan.safetyInputs;
  return [safety.pregnantOrBreastfeeding, safety.requiresTherapeuticDiet,
    safety.kidneyDiseaseOrComplexCondition, safety.eatingDisorderOrRedsRisk,
    safety.athleteOrExtremeActivity].some((value) => value === null);
}
function proteinInputsMissing(plan: NutritionPlan): boolean {
  const safety = plan.safetyInputs;
  return safety.ageYears === null || safety.basisWeightKg === null || safety.basisWeightDate === null ||
    safety.proteinWeightMethod === null || safety.highBodyFatOrObesity === null;
}
function energyInputsMissing(plan: NutritionPlan): boolean {
  const safety = plan.safetyInputs;
  const requiredSafetyMissing = safety.ageYears === null || safety.heightCm === null ||
    safety.basisWeightKg === null || safety.basisWeightDate === null || safety.targetWeightKg === null ||
    safety.targetLossKgPerWeek === null || safety.targetDate === null;
  const adultActivityMissing = safety.ageYears !== null && safety.ageYears >= 19 &&
    (plan.equationInputs.activityInputs.assessmentStatus !== 'complete' || plan.equationInputs.activityCategoryLow === null);
  return requiredSafetyMissing || adultActivityMissing;
}

function assertActivity(input: NutritionActivityInputs): void {
  if (input.assessmentStatus === 'not-provided') {
    if (input.occupation !== 'not-provided' || input.activeCommuteMinutesPerDay !== null ||
      input.householdMinutesPerDay !== null || input.stepsPerDay !== null ||
      input.trainingTypes.length !== 0 || input.trainingSessionsPerWeek !== null ||
      input.trainingMinutesPerSession !== null || input.trainingIntensity !== 'not-provided') {
      fail('not-provided activity must use canonical null/empty values');
    }
    return;
  }
  if (input.occupation === 'not-provided' || input.trainingIntensity === 'not-provided') fail('complete activity');
  finite(input.activeCommuteMinutesPerDay, 'active commute', 0, 1440);
  finite(input.householdMinutesPerDay, 'household minutes', 0, 1440);
  finite(input.stepsPerDay, 'steps', 0, 100000);
  finite(input.trainingSessionsPerWeek, 'training sessions', 0, 14);
  finite(input.trainingMinutesPerSession, 'training duration', 0, 600);
  if ([input.activeCommuteMinutesPerDay, input.householdMinutesPerDay, input.stepsPerDay,
    input.trainingSessionsPerWeek, input.trainingMinutesPerSession].some((value) => value === null)) fail('complete activity fields');
  if (input.trainingTypes.length === 0 || new Set(input.trainingTypes).size !== input.trainingTypes.length) fail('training types');
  const none = input.trainingTypes.includes('none');
  if (none !== (input.trainingTypes.length === 1 && input.trainingSessionsPerWeek === 0 &&
    input.trainingMinutesPerSession === 0 && input.trainingIntensity === 'none')) fail('canonical no-training state');
  if (!none && (input.trainingSessionsPerWeek === 0 || input.trainingMinutesPerSession === 0 || input.trainingIntensity === 'none')) fail('incomplete training state');
}

export function assertNutritionPlanSemantics(plan: NutritionPlan): void {
  const policy = plan as NutritionPlan & { proteinPolicySource: string; proteinPolicyVersion: string };
  if (policy.proteinPolicySource !== 'ISSN' || policy.proteinPolicyVersion !== 'JISSN-2017-14-20') {
    fail('protein policy provenance');
  }
  const { eligibilityBlockers: _storedBlockers, ...rawSafetyInputs } = plan.safetyInputs;
  void _storedBlockers;
  const expected = deriveNutritionPlanSemantics({
    effectiveFrom: plan.effectiveFrom, goals: plan.goals, safetyInputs: rawSafetyInputs,
    equationInputs: {
      equationBranch: plan.equationInputs.equationBranch,
      activityInputs: plan.equationInputs.activityInputs,
      activityCategoryLow: plan.equationInputs.activityCategoryLow,
      activityCategoryHigh: plan.equationInputs.activityCategoryHigh,
    },
    autoTargetsEnabled: plan.targetMode.autoTargetsEnabled,
    now: plan.equationInputs.calculatedAt ?? plan.updatedAt,
  });
  const actual = {
    safetyInputs: plan.safetyInputs, equationInputs: plan.equationInputs,
    targetRanges: plan.targetRanges, targetMode: plan.targetMode,
  };
  if (stableJson(actual) !== stableJson(expected)) fail('derived blockers, equation, targets, or mode mismatch');
  finite(plan.updatedAt, 'updatedAt', 0, Number.MAX_SAFE_INTEGER);
  realDate(plan.effectiveFrom, 'effectiveFrom');
  const safety = plan.safetyInputs;
  finite(safety.ageYears, 'age', 1, 120);
  if (safety.ageYears !== null && !Number.isInteger(safety.ageYears)) fail('age must be an integer');
  finite(safety.heightCm, 'height', 100, 250);
  finite(safety.basisWeightKg, 'basis weight', 20, 300);
  finite(safety.targetWeightKg, 'target weight', 20, 300);
  finite(safety.targetLossKgPerWeek, 'loss speed', Number.MIN_VALUE, Number.MAX_SAFE_INTEGER);
  if (safety.basisWeightDate !== null) {
    realDate(safety.basisWeightDate, 'basisWeightDate');
    if (safety.basisWeightDate > plan.effectiveFrom) fail('basis weight after effective date');
  }
  if (safety.targetDate !== null) {
    realDate(safety.targetDate, 'targetDate');
    if (safety.targetDate <= plan.effectiveFrom) fail('target date order');
  }

  assertActivity(plan.equationInputs.activityInputs);
  const equation = plan.equationInputs;
  const lowIndex = equation.activityCategoryLow === null ? -1 : ACTIVITY_ORDER.indexOf(equation.activityCategoryLow);
  const highIndex = equation.activityCategoryHigh === null ? -1 : ACTIVITY_ORDER.indexOf(equation.activityCategoryHigh);
  if (highIndex !== -1 && highIndex !== lowIndex + 1) fail('activity categories must be an adjacent ascending range');
  if (lowIndex === -1 && highIndex !== -1) fail('activity high without low');
  if (equation.activityInputs.assessmentStatus === 'not-provided' &&
    (lowIndex !== -1 || equation.maintenanceEnergyLowKcal !== null || equation.maintenanceEnergyHighKcal !== null)) fail('unassessed activity has EER');
  finite(equation.maintenanceEnergyLowKcal, 'maintenance low', 1, 10000);
  finite(equation.maintenanceEnergyHighKcal, 'maintenance high', 1, 10000);
  finite(equation.calculatedAt, 'calculatedAt', 0, Number.MAX_SAFE_INTEGER);
  if ((equation.maintenanceEnergyLowKcal === null) !== (equation.maintenanceEnergyHighKcal === null)) fail('partial EER interval');
  if (equation.maintenanceEnergyLowKcal !== null && equation.maintenanceEnergyHighKcal! < equation.maintenanceEnergyLowKcal) fail('reversed EER interval');
  if (equation.equationName === 'not-calculated') {
    if (equation.equationBranch !== 'unavailable' || lowIndex !== -1 || equation.maintenanceEnergyLowKcal !== null || equation.calculatedAt !== null) fail('not-calculated equation shape');
  } else {
    if (equation.equationBranch === 'unavailable' || equation.activityInputs.assessmentStatus !== 'complete' || lowIndex === -1 || equation.maintenanceEnergyLowKcal === null || equation.calculatedAt === null) fail('calculated equation shape');
    if (highIndex === -1 && equation.maintenanceEnergyLowKcal !== equation.maintenanceEnergyHighKcal) fail('point EER shape');
    if (highIndex !== -1 && equation.maintenanceEnergyHighKcal! < equation.maintenanceEnergyLowKcal) fail('range EER shape');
  }

  const blockers = safety.eligibilityBlockers;
  if (new Set(blockers).size !== blockers.length) fail('duplicate blockers');
  const proteinOn = plan.targetMode.protein === 'range';
  const energyOn = plan.targetMode.energy !== 'disabled';
  const proteinBlocked = sharedInputsMissing(plan) || proteinInputsMissing(plan) || hasAny(blockers, PROTEIN_BLOCKERS);
  const energyBlocked = sharedInputsMissing(plan) || energyInputsMissing(plan) || hasAny(blockers, ENERGY_BLOCKERS);
  if (proteinOn ? !allFinite(plan, PROTEIN_FIELDS) : !allNull(plan, PROTEIN_FIELDS)) fail('protein mode/ranges');
  if (energyOn ? !allFinite(plan, ENERGY_FIELDS) : !allNull(plan, ENERGY_FIELDS)) fail('energy mode/ranges');

  if (proteinOn) {
    const r = plan.targetRanges;
    if (!plan.goals.muscleGain || proteinBlocked ||
      r.proteinLowG! <= 0 || r.proteinLowG! > r.proteinReferenceG! || r.proteinReferenceG! > r.proteinHighG! ||
      r.proteinLowCoefficient !== 1.4 || r.proteinHighCoefficient !== 2 || r.proteinReferenceCoefficient !== 1.6) fail('active protein semantics');
  }
  if (!plan.goals.muscleGain && !allNull(plan, PROTEIN_FIELDS)) fail('protein without goal');

  if (energyOn) {
    const r = plan.targetRanges;
    if (!plan.goals.fatLoss || energyBlocked || safety.ageYears === null || safety.ageYears < 19 ||
      safety.basisWeightKg === null || safety.heightCm === null || safety.targetWeightKg === null ||
      safety.targetLossKgPerWeek === null || equation.activityInputs.assessmentStatus !== 'complete' ||
      equation.equationName !== 'NASEM-2023-adult-EER' || equation.equationBranch === 'unavailable' || lowIndex === -1) fail('active energy prerequisites');
    if (!(r.energyRawLowKcal! > 0 && r.energyLowKcal! > 0 && r.energyRawLowKcal! <= r.energyRawHighKcal! && r.energyLowKcal! <= r.energyHighKcal!)) fail('energy interval order');
    if (plan.targetMode.energy === 'point' && (highIndex !== -1 || r.energyLowKcal !== r.energyHighKcal || r.energyRawLowKcal !== r.energyRawHighKcal)) fail('energy point');
    if (plan.targetMode.energy === 'range' && highIndex === -1) fail('energy range');
  }
  if (!plan.goals.fatLoss && !allNull(plan, ENERGY_FIELDS)) fail('energy without goal');

  if (plan.targetMode.autoTargetsEnabled && safety.ageYears !== null && safety.ageYears < 18) {
    if (proteinOn || energyOn ||
      blockers.includes('protein-age-under-18') !== plan.goals.muscleGain ||
      blockers.includes('energy-age-under-19') !== plan.goals.fatLoss) fail('under-18 neutral policy');
  }
  if (plan.targetMode.autoTargetsEnabled && safety.ageYears === 18 &&
    (energyOn || blockers.includes('energy-age-under-19') !== plan.goals.fatLoss)) fail('age-18 energy policy');
  if (safety.ageYears !== null && safety.ageYears < 19 &&
    (equation.equationName !== 'not-calculated' || equation.equationBranch !== 'unavailable' ||
      equation.activityCategoryLow !== null || equation.activityCategoryHigh !== null ||
      equation.maintenanceEnergyLowKcal !== null || equation.maintenanceEnergyHighKcal !== null || equation.calculatedAt !== null)) fail('under-19 canonical equation');

  if (plan.targetMode.autoTargetsEnabled && plan.goals.fatLoss && safety.basisWeightKg !== null && safety.heightCm !== null && safety.targetWeightKg !== null) {
    if (safety.targetWeightKg >= safety.basisWeightKg) fail('target direction');
    const basisEligible = bmi(safety.basisWeightKg, safety.heightCm) >= 24;
    const targetEligible = bmi(safety.targetWeightKg, safety.heightCm) >= 18.5;
    const sixMonthLimit = safety.basisWeightDate !== null && safety.targetDate !== null && safety.targetDate <= (() => {
      const [year, month, day] = safety.basisWeightDate!.split('-').map(Number); const target = new Date(Date.UTC(year, month - 1 + 6, 1));
      const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
    })();
    const phaseInvalid = sixMonthLimit && safety.targetWeightKg < safety.basisWeightKg * 0.9;
    const speedInvalid = safety.targetLossKgPerWeek !== null && safety.targetLossKgPerWeek > 0.5;
    if (basisEligible === blockers.includes('fat-loss-bmi-ineligible')) fail('basis BMI/blocker');
    if (targetEligible === blockers.includes('target-bmi-below-18.5')) fail('target BMI/blocker');
    if ((speedInvalid || phaseInvalid) !== blockers.includes('speed-or-six-month-limit')) fail('speed/phase blocker');
    if ((!basisEligible || !targetEligible || speedInvalid || phaseInvalid) && energyOn) fail('blocked energy active');
  }

  const expectedPolicy = proteinOn && energyOn ? 'protein-range-and-energy-relative'
    : proteinOn ? 'protein-range' : energyOn ? 'energy-relative' : 'neutral-intake-only';
  if (plan.targetMode.evaluationPolicy !== expectedPolicy) fail('evaluation policy');
  if (!plan.targetMode.autoTargetsEnabled) {
    if (proteinOn || energyOn || !blockers.includes('automatic-targets-disabled') || plan.targetMode.reason !== 'professional-review-pending') fail('disabled flag snapshot');
    if (blockers.length !== 1 || equation.equationName !== 'not-calculated' || equation.equationBranch !== 'unavailable' ||
      equation.activityInputs.assessmentStatus !== 'not-provided' || equation.activityCategoryLow !== null ||
      equation.activityCategoryHigh !== null || equation.maintenanceEnergyLowKcal !== null ||
      equation.maintenanceEnergyHighKcal !== null || equation.calculatedAt !== null) fail('flag-off canonical snapshot');
  } else if (blockers.includes('automatic-targets-disabled') ||
    plan.targetMode.reason !== (!plan.goals.muscleGain && !plan.goals.fatLoss ? 'active' : proteinOn || energyOn ? 'active' : 'eligibility-blocked')) fail('enabled flag snapshot');
  if (plan.targetMode.autoTargetsEnabled && plan.goals.muscleGain && !proteinOn && !proteinBlocked) fail('missing protein blocker');
  if (plan.targetMode.autoTargetsEnabled && plan.goals.fatLoss && !energyOn && !energyBlocked) fail('missing energy blocker');
}
```

The seemingly redundant mode checks are intentional parse-time guards: a later JSON restore cannot retain stale target numbers while claiming a disabled mode.

- [ ] **Step 5: Implement plan construction and gated target policies**

Create `src/lib/nutritionPlan.ts` as a thin builder over that kernel:

```ts
import type { NutritionEquationInputs, NutritionGoals, NutritionPlan, NutritionSafetyInputs } from './nutritionTypes';
import { nutritionPlanId } from './nutritionIds';
import { deriveNutritionPlanSemantics } from './nutritionPlanPolicy';
import { assertNutritionPlanSemantics } from './nutritionPlanValidation';

export { bodyMassIndex, fatLossEnergyRange, impliedWeeklyLossKg, nasemAdultEer, proteinTargetRange, validateActivityInputs } from './nutritionPlanPolicy';

export interface NutritionPlanDraft {
  effectiveFrom: string; goals: NutritionGoals;
  safetyInputs: Omit<NutritionSafetyInputs, 'eligibilityBlockers'>;
  equationInputs: Pick<NutritionEquationInputs, 'equationBranch' | 'activityInputs' | 'activityCategoryLow' | 'activityCategoryHigh'>;
}
export interface BuildNutritionPlanOptions { autoTargetsEnabled: boolean; now: number; }

export function buildNutritionPlan(draft: NutritionPlanDraft, options: BuildNutritionPlanOptions): NutritionPlan {
  const derived = deriveNutritionPlanSemantics({
    ...draft, autoTargetsEnabled: options.autoTargetsEnabled, now: options.now,
  });
  const plan: NutritionPlan = {
    id: nutritionPlanId(draft.effectiveFrom), effectiveFrom: draft.effectiveFrom,
    goals: { ...draft.goals }, safetyInputs: derived.safetyInputs,
    standardVersion: 'WS/T-428-2013', equationInputs: derived.equationInputs,
    equationVersion: 'NASEM-2023-adult-EER', targetRanges: derived.targetRanges,
    targetMode: derived.targetMode, sourceVersion: 'tiezheng-local-nutrition-v1',
    proteinPolicySource: 'ISSN', proteinPolicyVersion: 'JISSN-2017-14-20',
    updatedAt: options.now, deletedAt: null,
  };
  assertNutritionPlanSemantics(plan);
  return plan;
}
```

This is the only plan constructor. Automatic protein is active only for `proteinWeightMethod:'current-weight'` with `highBodyFatOrObesity:false`; `professional-reference-weight` remains parseable for compatibility but always yields `protein-weight-method-unverified` and a neutral protein dimension in v1. A missing dimension-specific answer disables only that goal; `missing-inputs` remains the user-facing aggregate blocker, while the kernel recomputes protein and energy eligibility from their own required fields. When the feature flag is off, valid raw safety answers remain an audit snapshot, but equation, target, blocker, and mode fields have one canonical neutral result and none of those answers participate in target derivation. Loss speed is recomputed from basis/target weights and dates, and the persisted speed must equal that value rounded to three decimals. The 10% first-stage blocker applies only when `targetDate <= basisWeightDate + 6 calendar months`; a longer target window may pass if its derived weekly rate is `<=0.5 kg`.

- [ ] **Step 6: Run GREEN verification and commit**

```bash
npm test -- src/lib/nutritionFeatureFlags.test.ts src/lib/foodNormalization.test.ts src/lib/nutritionStats.test.ts src/lib/nutritionPlanValidation.test.ts src/lib/nutritionPlan.test.ts
npm run typecheck
git add src/lib/nutritionFeatureFlags.ts src/lib/nutritionFeatureFlags.test.ts src/lib/foodNormalization.ts src/lib/foodNormalization.test.ts src/lib/nutritionStats.ts src/lib/nutritionStats.test.ts src/lib/nutritionPlanPolicy.ts src/lib/nutritionPlanValidation.ts src/lib/nutritionPlanValidation.test.ts src/lib/nutritionPlan.ts src/lib/nutritionPlan.test.ts
git commit -m "feat: add gated nutrition calculations"
```

Expected: pure tests and typecheck PASS; no DB or React import exists in the six implementation modules.

### Task 5: Add idempotent food and effective-date plan repositories

**Files:** Create `src/repos/foodRepo.ts`, `src/repos/foodRepo.test.ts`, `src/repos/nutritionPlanRepo.ts`, and `src/repos/nutritionPlanRepo.test.ts`; modify `src/main.tsx`.

- [ ] **Step 1: Write RED repository tests**

Create `src/repos/foodRepo.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { PRESET_FOODS } from '../data/presetFoods';
import { db } from '../lib/db';
import { resetDb } from '../test/dbTestUtils';
import {
  getFood,
  listFoods,
  removeCustomFood,
  saveCustomFood,
  seedPresetFoods,
  type SaveCustomFoodInput,
} from './foodRepo';

beforeEach(resetDb);

const customInput: SaveCustomFoodInput = {
  name: '包装豆奶', aliases: [], rawOrCooked: 'not-applicable', preparation: '即饮',
  originalEnergyValue: 418.4, originalEnergyUnit: 'kJ', originalProteinG: 3.2,
  originalBasisAmount: 100, originalBasisUnit: 'mL',
  normalizedBasisAmount: 100, normalizedBasisUnit: 'mL',
  ediblePortionRatio: 1, densityGPerMl: null, conversionAssumptions: ['包装标签每 100 mL'],
  fdcId: null, fdcDataType: null, sourceRetrievedAt: null,
  source: 'user-label', sourceVersion: '2026-08-14', license: 'user-provided',
};

test('预置 seed 并发幂等，列表保持目录顺序', async () => {
  await Promise.all([seedPresetFoods(), seedPresetFoods(), seedPresetFoods()]);
  expect((await db.foods.toArray()).filter((food) => food.preset)).toHaveLength(3);
  expect((await listFoods()).map((food) => food.id)).toEqual(PRESET_FOODS.map((food) => food.id));
});

test('自定义食物只保存纯函数派生的标准化字段', async () => {
  const custom = await saveCustomFood('custom-soy-001', customInput);
  expect(custom).toMatchObject({
    id: 'food:custom:custom-soy-001', basisAmount: 100, basisUnit: 'mL',
    energyKcal: 100, proteinG: 3.2, preset: false, deletedAt: null,
  });
  expect((await saveCustomFood('custom-soy-001', structuredClone(customInput))).id).toBe(custom.id);
  await expect(saveCustomFood('custom-soy-001', { ...customInput, originalProteinG: 4 })).rejects.toThrow('operation id conflict');
  await expect(saveCustomFood('custom-soy-001', { ...customInput, normalizedBasisAmount: 200 })).rejects.toThrow('operation id conflict');
  expect(await getFood(custom.id)).toEqual(custom);

  await removeCustomFood(custom.id);
  expect(await getFood(custom.id)).toBeUndefined();
  expect((await listFoods()).some((food) => food.id === custom.id)).toBe(false);
});

test('搜索同时覆盖名称与别名，且不暴露软删除项', async () => {
  await seedPresetFoods();
  expect((await listFoods('鸡胸')).map((food) => food.id)).toEqual(['food:preset:usda:171477']);
  expect((await listFoods('米饭')).map((food) => food.id)).toEqual(['food:preset:usda:168878']);
});

test('预置不可删，不安全 operation id 和非法来源数据 fail closed', async () => {
  await seedPresetFoods();
  await expect(removeCustomFood(PRESET_FOODS[0].id)).rejects.toThrow('preset');
  await expect(saveCustomFood('', customInput)).rejects.toThrow('operation id');
  await expect(saveCustomFood('../escape', customInput)).rejects.toThrow('operation id');
  await expect(saveCustomFood('bad-number', { ...customInput, originalEnergyValue: Number.NaN })).rejects.toThrow('finite');
  await expect(saveCustomFood('bad-date', { ...customInput, sourceRetrievedAt: '2026-02-30' })).rejects.toThrow('sourceRetrievedAt');
});
```

Create `src/repos/nutritionPlanRepo.test.ts`:

```ts
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '../lib/db';
import { nutritionPlanRow } from '../test/nutritionFixtures';
import { resetDb } from '../test/dbTestUtils';
import {
  getEffectiveNutritionPlan,
  listNutritionPlans,
  removeNutritionPlan,
  saveNutritionPlan,
} from './nutritionPlanRepo';

beforeEach(resetDb);

function validPlan(effectiveFrom: string, updatedAt: number, id: string) {
  const plan = nutritionPlanRow({ id, effectiveFrom, updatedAt });
  plan.equationInputs.calculatedAt = updatedAt;
  if (effectiveFrom === '2026-08-01') {
    plan.safetyInputs.basisWeightDate = '2026-08-01';
    plan.safetyInputs.targetDate = '2026-11-21';
  }
  return plan;
}

test('同日计划使用确定 id 覆盖，历史日选最新生效版', async () => {
  const first = validPlan('2026-08-01', 1, 'ignored');
  const firstSaved = await saveNutritionPlan(first);
  expect(firstSaved.id).toBe('nutrition-plan:2026-08-01');

  await saveNutritionPlan(validPlan('2026-08-14', 2, 'ignored-again'));
  await saveNutritionPlan(validPlan('2026-08-14', 3, 'third'));

  expect(await db.nutritionPlans.count()).toBe(2);
  expect((await getEffectiveNutritionPlan('2026-08-13'))?.effectiveFrom).toBe('2026-08-01');
  expect((await getEffectiveNutritionPlan('2026-08-14'))?.updatedAt).toBe(3);
  expect((await listNutritionPlans()).map((plan) => plan.effectiveFrom)).toEqual(['2026-08-14', '2026-08-01']);
});

test('删除是软删除，查询自动回退到上一个有效版本', async () => {
  const now = Date.parse('2026-08-20T00:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    await saveNutritionPlan(validPlan('2026-08-01', 1, 'older'));
    await saveNutritionPlan(validPlan('2026-08-14', 2, 'newer'));
    await removeNutritionPlan('2026-08-14');
    expect((await getEffectiveNutritionPlan('2026-08-20'))?.effectiveFrom).toBe('2026-08-01');
    expect(await db.nutritionPlans.count()).toBe(2);
    expect((await db.nutritionPlans.get('nutrition-plan:2026-08-14'))?.deletedAt).toBe(now);
  } finally {
    vi.restoreAllMocks();
  }
});

test('持久化前调用共享语义门，无效计划不入库', async () => {
  const invalid = structuredClone(nutritionPlanRow());
  invalid.safetyInputs.ageYears = 0;
  await expect(saveNutritionPlan(invalid)).rejects.toThrow();
  expect(await db.nutritionPlans.count()).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify RED**

```bash
npm test -- src/repos/foodRepo.test.ts src/repos/nutritionPlanRepo.test.ts
```

Expected: FAIL because both repositories are missing.

- [ ] **Step 3: Implement the food repository and boot seed**

Create `src/repos/foodRepo.ts`:

```ts
import { PRESET_FOODS } from '../data/presetFoods';
import { db } from '../lib/db';
import { normalizeFoodNutrients, type FoodNormalizationInput } from '../lib/foodNormalization';
import { operationKey } from '../lib/nutritionIds';
import type { Food, FoodDataType } from '../lib/nutritionTypes';

export interface SaveCustomFoodInput extends FoodNormalizationInput {
  name: string; aliases: string[]; rawOrCooked: Food['rawOrCooked']; preparation: string;
  fdcId: number | null; fdcDataType: FoodDataType | null; sourceRetrievedAt: string | null;
  source: string; sourceVersion: string; license: string;
}

const PRESET_ORDER = new Map(PRESET_FOODS.map((food, index) => [food.id, index]));

function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`${field} must not be blank`);
  return trimmed;
}

function validOptionalDate(value: string | null): void {
  if (value === null) return;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('sourceRetrievedAt must be YYYY-MM-DD');
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('sourceRetrievedAt must be a real date');
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function semanticFood(food: Food): unknown {
  const { updatedAt: _updatedAt, deletedAt: _deletedAt, ...semantic } = food;
  void _updatedAt; void _deletedAt;
  return canonical(semantic);
}

function buildCustomFood(id: string, input: SaveCustomFoodInput, now: number): Food {
  validOptionalDate(input.sourceRetrievedAt);
  if (input.fdcId !== null && (!Number.isInteger(input.fdcId) || input.fdcId <= 0)) {
    throw new Error('fdcId must be a positive integer or null');
  }
  const normalized = normalizeFoodNutrients(input);
  const { normalizedBasisAmount: _amount, normalizedBasisUnit: _unit, ...sourceInput } = input;
  void _amount; void _unit;
  return {
    ...sourceInput,
    name: requiredText(input.name, 'name'),
    aliases: input.aliases.map((alias) => alias.trim()).filter(Boolean),
    preparation: input.preparation.trim(),
    source: requiredText(input.source, 'source'),
    sourceVersion: requiredText(input.sourceVersion, 'sourceVersion'),
    license: requiredText(input.license, 'license'),
    ...normalized,
    id,
    preset: false,
    updatedAt: now,
    deletedAt: null,
  };
}

export async function seedPresetFoods(): Promise<void> {
  await db.transaction('rw', db.foods, async () => {
    const existing = await db.foods.bulkGet(PRESET_FOODS.map((food) => food.id));
    const missing = PRESET_FOODS.filter((_food, index) => existing[index] === undefined);
    if (missing.length > 0) await db.foods.bulkAdd(missing.map((food) => structuredClone(food)));
  });
}

export async function listFoods(query = ''): Promise<Food[]> {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return (await db.foods.toArray())
    .filter((food) => food.deletedAt === null)
    .filter((food) => needle.length === 0 || `${food.name} ${food.aliases.join(' ')}`.toLocaleLowerCase('zh-CN').includes(needle))
    .sort((left, right) => {
      if (left.preset && right.preset) return (PRESET_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (PRESET_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      if (left.preset !== right.preset) return left.preset ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
}

export async function getFood(id: string): Promise<Food | undefined> {
  const row = await db.foods.get(id);
  return row?.deletedAt === null ? row : undefined;
}

export async function saveCustomFood(operationId: string, input: SaveCustomFoodInput): Promise<Food> {
  const id = `food:custom:${operationKey(operationId)}`;
  return db.transaction('rw', db.foods, async () => {
    const candidate = buildCustomFood(id, input, Date.now());
    const existing = await db.foods.get(id);
    if (existing !== undefined) {
      if (existing.preset || JSON.stringify(semanticFood(existing)) !== JSON.stringify(semanticFood(candidate))) {
        throw new Error('operation id conflict');
      }
      if (existing.deletedAt === null) return existing;
      await db.foods.put(candidate);
      return candidate;
    }
    await db.foods.add(candidate);
    return candidate;
  });
}

export async function removeCustomFood(id: string): Promise<void> {
  await db.transaction('rw', db.foods, async () => {
    const existing = await db.foods.get(id);
    if (existing === undefined) return;
    if (existing.preset) throw new Error('preset foods cannot be removed');
    const now = Date.now();
    await db.foods.put({ ...existing, updatedAt: now, deletedAt: now });
  });
}
```

In `src/main.tsx`, keep the existing exercise import and add the food import:

```ts
import { seedPresets } from './repos/exerciseRepo';
import { seedPresetFoods } from './repos/foodRepo';
```

Replace the single seed call with:

```ts
Promise.all([seedPresets(), seedPresetFoods()]).catch((error) =>
  log(`seedPresets/seedPresetFoods: ${String(error)}`),
);
```

Do not seed inside the v4 migration.

- [ ] **Step 4: Implement the nutrition-plan repository**

Create `src/repos/nutritionPlanRepo.ts`:

```ts
import { db } from '../lib/db';
import { nutritionPlanId } from '../lib/nutritionIds';
import { assertNutritionPlanSemantics } from '../lib/nutritionPlanValidation';
import type { NutritionPlan } from '../lib/nutritionTypes';

export async function saveNutritionPlan(plan: NutritionPlan): Promise<NutritionPlan> {
  const row: NutritionPlan = {
    ...structuredClone(plan),
    id: nutritionPlanId(plan.effectiveFrom),
    deletedAt: null,
  };
  assertNutritionPlanSemantics(row);
  await db.nutritionPlans.put(row);
  return row;
}

export async function getEffectiveNutritionPlan(date: string): Promise<NutritionPlan | undefined> {
  nutritionPlanId(date);
  const rows = await db.nutritionPlans.where('effectiveFrom').belowOrEqual(date).toArray();
  return rows
    .filter((plan) => plan.deletedAt === null)
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.updatedAt - left.updatedAt)[0];
}

export async function listNutritionPlans(): Promise<NutritionPlan[]> {
  return (await db.nutritionPlans.toArray())
    .filter((plan) => plan.deletedAt === null)
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom) || right.updatedAt - left.updatedAt);
}

export async function removeNutritionPlan(effectiveFrom: string): Promise<void> {
  const id = nutritionPlanId(effectiveFrom);
  await db.transaction('rw', db.nutritionPlans, async () => {
    const existing = await db.nutritionPlans.get(id);
    if (existing === undefined || existing.deletedAt !== null) return;
    const now = Date.now();
    await db.nutritionPlans.put({ ...existing, updatedAt: now, deletedAt: now });
  });
}
```

- [ ] **Step 5: Run GREEN verification and commit**

```bash
npm test -- src/repos/foodRepo.test.ts src/repos/nutritionPlanRepo.test.ts
npm run typecheck
git add src/repos/foodRepo.ts src/repos/foodRepo.test.ts src/repos/nutritionPlanRepo.ts src/repos/nutritionPlanRepo.test.ts src/main.tsx
git commit -m "feat: add food and nutrition plan repositories"
```

Expected: repository tests PASS; StrictMode boot still leaves exactly three preset rows.

### Task 6: Add atomic meal logging, local temporary-state lifecycle, and day queries

**Files:** Create `src/repos/mealRepo.ts` and `src/repos/mealRepo.test.ts`.

- [ ] **Step 1: Write RED tests for create, retry, delete, and day derivation**

Create `src/repos/mealRepo.test.ts`:

```ts
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DB_V4_STORES, db, type NutritionDb } from '../lib/db';
import { mealEstimateId, mealPhotoId } from '../lib/nutritionIds';
import {
  foodRow,
  mealEstimateRow,
  mealPhotoRow,
  mealRow,
} from '../test/nutritionFixtures';
import { resetDb } from '../test/dbTestUtils';
import {
  clearMealTemporaryState,
  createMealRepo,
  listNutritionDay,
  putMealEstimate,
  putMealPhoto,
  removeMeal,
  removeMealItem,
  saveConfirmedFoodItem,
  updateMealItemAmount,
  type SaveConfirmedFoodItemInput,
} from './mealRepo';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const preset = foodRow({ id: 'food:preset:usda:168878', energyKcal: 130, proteinG: 2.69 });
const confirmed = (overrides: Partial<SaveConfirmedFoodItemInput> = {}): SaveConfirmedFoodItemInput => ({
  operationId: 'tap-1', date: '2026-08-14', slot: 'lunch', food: preset, amount: 150, ...overrides,
});

async function putTemporaryState(mealId = 'meal:2026-08-14:lunch'): Promise<void> {
  await putMealPhoto(mealPhotoRow({ id: mealPhotoId(mealId), mealId }));
  await putMealEstimate(mealEstimateRow({ id: mealEstimateId(mealId), mealId }));
}

test('并发重试只创建一个餐次和一个确认项', async () => {
  const input = confirmed();
  await Promise.all([saveConfirmedFoodItem(input), saveConfirmedFoodItem(structuredClone(input))]);

  expect(await db.meals.toArray()).toHaveLength(1);
  expect(await db.mealItems.toArray()).toHaveLength(1);
  expect(await db.mealItems.get('meal-item:tap-1')).toMatchObject({
    mealId: 'meal:2026-08-14:lunch', energyKcalLow: 195, energyKcalHigh: 195,
    proteinGLow: 4.035, proteinGHigh: 4.035, quality: 'A', method: 'preset', order: 0, deletedAt: null,
  });
  await expect(saveConfirmedFoodItem(confirmed({ amount: 200 }))).rejects.toThrow('operation id conflict');
  await expect(saveConfirmedFoodItem(confirmed({ food: foodRow({ id: 'food:other' }) }))).rejects.toThrow('operation id conflict');
});

test('预置、标签、手工三种方式保留完整食物快照，改量不读变动目录', async () => {
  const label = foodRow({
    id: 'food:custom:soy', name: '豆奶', preset: false, source: 'user-label', sourceVersion: 'label-v1',
    originalEnergyValue: 45, originalEnergyUnit: 'kcal', originalProteinG: 3.2,
    originalBasisAmount: 100, originalBasisUnit: 'mL', basisAmount: 100, basisUnit: 'mL',
    energyKcal: 45, proteinG: 3.2, fdcId: null, fdcDataType: null, sourceRetrievedAt: null,
    densityGPerMl: null, conversionAssumptions: ['包装标签每 100 mL'], license: 'user-provided',
  });
  const savedLabel = await saveConfirmedFoodItem(confirmed({ operationId: 'label-1', food: label, amount: 200 }));
  const savedManual = await saveConfirmedFoodItem(confirmed({ operationId: 'manual-1', food: { ...label, id: 'food:custom:manual', source: 'user-manual' }, amount: 100 }));
  expect(savedLabel).toMatchObject({
    method: 'label', unit: 'mL', energyKcalLow: 90, energyKcalHigh: 90,
    proteinGLow: 6.4, proteinGHigh: 6.4, originalBasisUnit: 'mL', basisUnit: 'mL',
    conversionAssumptions: ['包装标签每 100 mL'],
  });
  expect(savedManual.method).toBe('manual');
  expect((await saveConfirmedFoodItem(confirmed({ operationId: 'preset-2' }))).method).toBe('preset');

  await db.foods.put({ ...label, energyKcal: 999, proteinG: 999 });
  const changed = await updateMealItemAmount(savedLabel.id, 250);
  expect(changed).toMatchObject({ energyKcalLow: 112.5, energyKcalHigh: 112.5, proteinGLow: 8, proteinGHigh: 8 });
  expect(changed.energyKcal).toBe(45);
  expect(changed.densityGPerMl).toBeNull();
});

test.each(['', 'x'.repeat(129), '../escape', 'contains space'])('不安全 operation id %s 在事务前拒绝', async (operationId) => {
  await expect(saveConfirmedFoodItem(confirmed({ operationId }))).rejects.toThrow('operation id');
  expect(await db.meals.count()).toBe(0);
  expect(await db.mealItems.count()).toBe(0);
});

test('两个 Dexie 连接并发写同一餐次，order 仍唯一', async () => {
  const second = new Dexie('tiezheng') as NutritionDb;
  second.version(4).stores(DB_V4_STORES);
  await second.open();
  try {
    const secondRepo = createMealRepo(second);
    await Promise.all([
      saveConfirmedFoodItem(confirmed({ operationId: 'connection-a' })),
      secondRepo.saveConfirmedFoodItem(confirmed({ operationId: 'connection-b' })),
    ]);
    const rows = (await db.mealItems.where('mealId').equals('meal:2026-08-14:lunch').toArray())
      .filter((item) => item.deletedAt === null)
      .sort((left, right) => left.order - right.order);
    expect(rows.map((item) => item.order)).toEqual([0, 1]);
    expect(new Set(rows.map((item) => item.id)).size).toBe(2);
  } finally {
    second.close();
  }
});

test('软删除后同 operation 重试安全复活；日查询始终四餐有序', async () => {
  const first = await saveConfirmedFoodItem(confirmed());
  await removeMealItem(first.id);
  expect((await db.meals.get(first.mealId))?.deletedAt).not.toBeNull();
  expect((await db.mealItems.get(first.id))?.deletedAt).not.toBeNull();

  const revived = await saveConfirmedFoodItem(confirmed());
  expect(revived.deletedAt).toBeNull();
  expect((await db.meals.get(first.mealId))?.deletedAt).toBeNull();
  await saveConfirmedFoodItem(confirmed({ operationId: 'dinner-1', slot: 'dinner' }));

  const estimateOnlyMeal = mealRow({ id: 'meal:2026-08-14:snack', slot: 'snack' });
  await db.meals.put(estimateOnlyMeal);
  await putMealEstimate(mealEstimateRow({ id: mealEstimateId(estimateOnlyMeal.id), mealId: estimateOnlyMeal.id }));
  const day = await listNutritionDay('2026-08-14');
  expect(day.meals.map((row) => row.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  expect(day.meals.map((row) => row.items.length)).toEqual([0, 1, 1, 0]);
  expect(day.summary).toMatchObject({ recordedMeals: 2, recordedSlots: ['lunch', 'dinner'] });
});

test('图片和估算只能绑定有效确定餐次，且 id 必须可重建', async () => {
  await saveConfirmedFoodItem(confirmed());
  const mealId = 'meal:2026-08-14:lunch';
  await expect(putMealPhoto(mealPhotoRow({ id: 'random-photo', mealId }))).rejects.toThrow('deterministic');
  await expect(putMealEstimate(mealEstimateRow({ id: 'random-estimate', mealId }))).rejects.toThrow('deterministic');
  await expect(putMealPhoto(mealPhotoRow({ id: mealPhotoId('meal:missing'), mealId: 'meal:missing' }))).rejects.toThrow('active meal');
  await expect(putMealEstimate(mealEstimateRow({ id: mealEstimateId(mealId), mealId, requestFingerprint: '' }))).rejects.toThrow('fingerprint');
  await expect(putMealEstimate(mealEstimateRow({
    id: mealEstimateId(mealId), mealId,
    candidates: [{ id: 'bad', name: '米饭', preparation: '熟', amountLow: 200, amountHigh: 100, unit: 'g', catalogFoodId: null }],
  }))).rejects.toThrow('candidate');
  await expect(putMealEstimate(mealEstimateRow({
    id: mealEstimateId(mealId), mealId,
    consent: { ...mealEstimateRow().consent!, requestId: 'different-request' },
  }))).rejects.toThrow('consent request');
  await removeMealItem('meal-item:tap-1');
  await expect(putMealPhoto(mealPhotoRow({ id: mealPhotoId(mealId), mealId }))).rejects.toThrow('active meal');
  await expect(putMealEstimate(mealEstimateRow({ id: mealEstimateId(mealId), mealId }))).rejects.toThrow('active meal');
});

test('清理临时状态是单事务，第二张表失败会回滚第一张表', async () => {
  await saveConfirmedFoodItem(confirmed());
  await putTemporaryState();
  vi.spyOn(db.mealEstimates, 'where').mockImplementationOnce(() => { throw new Error('forced clear failure'); });
  await expect(clearMealTemporaryState('meal:2026-08-14:lunch')).rejects.toThrow('forced clear failure');
  expect(await db.mealPhotos.count()).toBe(1);
  expect(await db.mealEstimates.count()).toBe(1);

  vi.restoreAllMocks();
  await clearMealTemporaryState('meal:2026-08-14:lunch');
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);
});

test('删最后一项清理孤儿；删整餐的末步失败会回滚四表', async () => {
  const first = await saveConfirmedFoodItem(confirmed());
  await putTemporaryState();
  await removeMealItem(first.id);
  expect((await db.meals.get(first.mealId))?.deletedAt).not.toBeNull();
  expect((await db.mealItems.get(first.id))?.deletedAt).not.toBeNull();
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);

  const rollbackItem = await saveConfirmedFoodItem(confirmed({ operationId: 'rollback-1', slot: 'dinner' }));
  await putTemporaryState(rollbackItem.mealId);
  vi.spyOn(db.meals, 'put').mockRejectedValueOnce(new Error('forced meal failure'));
  await expect(removeMeal(rollbackItem.mealId)).rejects.toThrow('forced meal failure');
  expect((await db.meals.get(rollbackItem.mealId))?.deletedAt).toBeNull();
  expect((await db.mealItems.get(rollbackItem.id))?.deletedAt).toBeNull();
  expect(await db.mealPhotos.where('mealId').equals(rollbackItem.mealId).count()).toBe(1);
  expect(await db.mealEstimates.where('mealId').equals(rollbackItem.mealId).count()).toBe(1);
});
```

- [ ] **Step 2: Run the meal repository test to verify RED**

```bash
npm test -- src/repos/mealRepo.test.ts
```

Expected: FAIL because `mealRepo.ts` does not exist.

- [ ] **Step 3: Implement the public meal repository API**

Create `src/repos/mealRepo.ts` with the complete implementation below. All functions created by `createMealRepo` close over the supplied connection; the named exports delegate to the default app connection.

```ts
import { db, type NutritionDb } from '../lib/db';
import {
  mealEstimateId,
  mealId as makeMealId,
  mealItemId,
  mealPhotoId,
  operationKey,
} from '../lib/nutritionIds';
import { scaleFood, summarizeNutritionDay, type NutritionDaySummary } from '../lib/nutritionStats';
import type { Food, Meal, MealEstimate, MealItem, MealPhoto, MealSlot } from '../lib/nutritionTypes';

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export interface SaveConfirmedFoodItemInput {
  operationId: string; date: string; slot: MealSlot; food: Food;
  amount: number;
}

export interface NutritionDay {
  date: string; meals: Array<{ slot: MealSlot; meal: Meal | undefined; items: MealItem[] }>;
  summary: NutritionDaySummary;
}

export interface MealRepository {
  saveConfirmedFoodItem(input: SaveConfirmedFoodItemInput): Promise<MealItem>;
  updateMealItemAmount(id: string, amount: number): Promise<MealItem>;
  removeMealItem(id: string): Promise<void>; removeMeal(id: string): Promise<void>;
  listNutritionDay(date: string): Promise<NutritionDay>;
  putMealPhoto(photo: MealPhoto): Promise<void>;
  putMealEstimate(estimate: MealEstimate): Promise<void>;
  clearMealTemporaryState(mealId: string): Promise<void>;
}

function requirePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be finite and positive`);
}

function checkedMealId(date: string, slot: MealSlot): string {
  if (!MEAL_SLOTS.includes(slot)) throw new Error('invalid meal slot');
  return makeMealId(date, slot);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function itemSemantic(item: MealItem): string {
  const {
    confirmedAt: _confirmedAt,
    order: _order,
    updatedAt: _updatedAt,
    deletedAt: _deletedAt,
    ...semantic
  } = item;
  void _confirmedAt; void _order; void _updatedAt; void _deletedAt;
  return JSON.stringify(canonical(semantic));
}

function buildConfirmedItem(
  input: SaveConfirmedFoodItemInput,
  id: string,
  parentId: string,
  order: number,
  now: number,
): MealItem {
  if (input.food.deletedAt !== null) throw new Error('food must be active');
  const nutrients = scaleFood(input.food, input.amount);
  return {
    id,
    mealId: parentId,
    name: input.food.name,
    preparation: input.food.preparation,
    amount: input.amount,
    unit: input.food.basisUnit,
    originalEnergyValue: input.food.originalEnergyValue,
    originalEnergyUnit: input.food.originalEnergyUnit,
    originalProteinG: input.food.originalProteinG,
    originalBasisAmount: input.food.originalBasisAmount,
    originalBasisUnit: input.food.originalBasisUnit,
    energyKcal: input.food.energyKcal,
    proteinG: input.food.proteinG,
    energyKcalLow: nutrients.energyKcal,
    energyKcalHigh: nutrients.energyKcal,
    proteinGLow: nutrients.proteinG,
    proteinGHigh: nutrients.proteinG,
    assumptions: [`用户确认可食部${input.food.basisUnit}`, `食物目录快照 ${input.food.id}`],
    uncertaintyModelVersion: 'exact-measured-v1',
    basisAmount: input.food.basisAmount,
    basisUnit: input.food.basisUnit,
    ediblePortionRatio: input.food.ediblePortionRatio,
    densityGPerMl: input.food.densityGPerMl,
    conversionAssumptions: [...input.food.conversionAssumptions],
    fdcId: input.food.fdcId,
    fdcDataType: input.food.fdcDataType,
    sourceRetrievedAt: input.food.sourceRetrievedAt,
    source: input.food.source,
    sourceVersion: input.food.sourceVersion,
    license: input.food.license,
    method: input.food.preset ? 'preset' : input.food.source === 'user-label' ? 'label' : 'manual',
    quality: 'A',
    confirmedAt: now,
    order,
    updatedAt: now,
    deletedAt: null,
  };
}

function validatePhoto(photo: MealPhoto): void {
  if (photo.id !== mealPhotoId(photo.mealId)) throw new Error('photo id must be deterministic');
  if (!(photo.thumbnail instanceof Blob) || photo.thumbnail.size === 0 || photo.size !== photo.thumbnail.size) {
    throw new Error('photo thumbnail metadata is invalid');
  }
  if (!Number.isInteger(photo.width) || photo.width <= 0 || !Number.isInteger(photo.height) || photo.height <= 0) {
    throw new Error('photo dimensions are invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(photo.mealSnapshotHash)) throw new Error('meal snapshot hash is invalid');
  if (!Number.isFinite(photo.updatedAt)) throw new Error('photo updatedAt is invalid');
}

function validateEstimate(estimate: MealEstimate): void {
  if (estimate.id !== mealEstimateId(estimate.mealId)) throw new Error('estimate id must be deterministic');
  if (estimate.requestId.trim().length === 0) throw new Error('request id must not be blank');
  if (!/^[a-f0-9]{64}$/.test(estimate.requestFingerprint)) throw new Error('request fingerprint is invalid');
  if (!Number.isFinite(estimate.updatedAt)) throw new Error('estimate updatedAt is invalid');
  const candidateIds = new Set<string>();
  for (const candidate of estimate.candidates) {
    if (candidate.id.trim().length === 0 || candidateIds.has(candidate.id) || candidate.name.trim().length === 0 ||
      !Number.isFinite(candidate.amountLow) || !Number.isFinite(candidate.amountHigh) ||
      candidate.amountLow <= 0 || candidate.amountHigh < candidate.amountLow) {
      throw new Error('estimate candidate is invalid');
    }
    candidateIds.add(candidate.id);
  }
  if (estimate.consent !== null) {
    const consent = estimate.consent;
    if (consent.requestId !== estimate.requestId) throw new Error('consent request does not match estimate request');
    if (!/^[a-f0-9]{64}$/.test(consent.uploadBlobSha256) || consent.providerPolicyVersion.trim().length === 0 ||
      !Number.isFinite(consent.consentedAt) || !Number.isFinite(consent.expiresAt) || consent.expiresAt <= consent.consentedAt) {
      throw new Error('estimate consent is invalid');
    }
  }
  if ((estimate.status === 'failed') !== (estimate.error !== null)) {
    throw new Error('estimate error must match failed status');
  }
}

export function createMealRepo(database: NutritionDb): MealRepository {
  async function save(input: SaveConfirmedFoodItemInput): Promise<MealItem> {
    const op = operationKey(input.operationId);
    requirePositive(input.amount, 'amount');
    const parentId = checkedMealId(input.date, input.slot);
    const itemId = mealItemId(op);
    return database.transaction('rw', [database.meals, database.mealItems], async () => {
      const existingItem = await database.mealItems.get(itemId);
      const comparison = buildConfirmedItem(input, itemId, parentId, existingItem?.order ?? 0, existingItem?.confirmedAt ?? 0);
      if (existingItem !== undefined && itemSemantic(existingItem) !== itemSemantic(comparison)) {
        throw new Error('operation id conflict');
      }
      const existingMeal = await database.meals.get(parentId);
      if (existingMeal !== undefined && (existingMeal.date !== input.date || existingMeal.slot !== input.slot)) {
        throw new Error('meal id conflict');
      }
      if (existingItem?.deletedAt === null) {
        if (existingMeal === undefined || existingMeal.deletedAt !== null) {
          const now = Date.now();
          await database.meals.put({ id: parentId, date: input.date, slot: input.slot, updatedAt: now, deletedAt: null });
        }
        return existingItem;
      }

      const activeSiblings = (await database.mealItems.where('mealId').equals(parentId).toArray())
        .filter((item) => item.deletedAt === null);
      const order = activeSiblings.reduce((maximum, item) => Math.max(maximum, item.order), -1) + 1;
      const now = Date.now();
      const meal: Meal = {
        id: parentId,
        date: input.date,
        slot: input.slot,
        updatedAt: now,
        deletedAt: null,
      };
      const row = buildConfirmedItem(input, itemId, parentId, order, now);
      if (existingItem !== undefined) row.confirmedAt = existingItem.confirmedAt;
      await database.meals.put(meal);
      await database.mealItems.put(row);
      return row;
    });
  }

  async function updateAmount(id: string, amount: number): Promise<MealItem> {
    requirePositive(amount, 'amount');
    return database.transaction('rw', database.mealItems, async () => {
      const existing = await database.mealItems.get(id);
      if (existing === undefined || existing.deletedAt !== null) throw new Error('active meal item not found');
      requirePositive(existing.amount, 'stored amount');
      const factor = amount / existing.amount;
      const row: MealItem = {
        ...existing,
        amount,
        energyKcalLow: existing.energyKcalLow * factor,
        energyKcalHigh: existing.energyKcalHigh * factor,
        proteinGLow: existing.proteinGLow * factor,
        proteinGHigh: existing.proteinGHigh * factor,
        updatedAt: Date.now(),
      };
      await database.mealItems.put(row);
      return row;
    });
  }

  async function removeItem(id: string): Promise<void> {
    await database.transaction('rw', [database.meals, database.mealItems, database.mealPhotos, database.mealEstimates], async () => {
      const existing = await database.mealItems.get(id);
      if (existing === undefined || existing.deletedAt !== null) return;
      const now = Date.now();
      await database.mealItems.put({ ...existing, updatedAt: now, deletedAt: now });
      const activeSiblings = (await database.mealItems.where('mealId').equals(existing.mealId).toArray())
        .filter((item) => item.deletedAt === null);
      if (activeSiblings.length > 0) return;
      await database.mealPhotos.where('mealId').equals(existing.mealId).delete();
      await database.mealEstimates.where('mealId').equals(existing.mealId).delete();
      const meal = await database.meals.get(existing.mealId);
      if (meal !== undefined) await database.meals.put({ ...meal, updatedAt: now, deletedAt: now });
    });
  }

  async function removeWholeMeal(id: string): Promise<void> {
    await database.transaction('rw', [database.meals, database.mealItems, database.mealPhotos, database.mealEstimates], async () => {
      const meal = await database.meals.get(id);
      if (meal === undefined || meal.deletedAt !== null) return;
      const now = Date.now();
      const items = (await database.mealItems.where('mealId').equals(id).toArray())
        .filter((item) => item.deletedAt === null)
        .map((item) => ({ ...item, updatedAt: now, deletedAt: now }));
      if (items.length > 0) await database.mealItems.bulkPut(items);
      await database.mealPhotos.where('mealId').equals(id).delete();
      await database.mealEstimates.where('mealId').equals(id).delete();
      await database.meals.put({ ...meal, updatedAt: now, deletedAt: now });
    });
  }

  async function listDay(date: string): Promise<NutritionDay> {
    checkedMealId(date, 'breakfast');
    const meals = (await database.meals.where('date').equals(date).toArray())
      .filter((meal) => meal.deletedAt === null);
    const mealIds = meals.map((meal) => meal.id);
    const items = mealIds.length === 0
      ? []
      : (await database.mealItems.where('mealId').anyOf(mealIds).toArray())
        .filter((item) => item.deletedAt === null)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const mealBySlot = new Map(meals.map((meal) => [meal.slot, meal]));
    return {
      date,
      meals: MEAL_SLOTS.map((slot) => {
        const meal = mealBySlot.get(slot);
        return { slot, meal, items: meal === undefined ? [] : items.filter((item) => item.mealId === meal.id) };
      }),
      summary: summarizeNutritionDay(meals, items),
    };
  }

  async function putPhoto(photo: MealPhoto): Promise<void> {
    validatePhoto(photo);
    await database.transaction('rw', [database.meals, database.mealPhotos], async () => {
      const meal = await database.meals.get(photo.mealId);
      if (meal === undefined || meal.deletedAt !== null) throw new Error('photo requires an active meal');
      await database.mealPhotos.put(structuredClone(photo));
    });
  }

  async function putEstimate(estimate: MealEstimate): Promise<void> {
    validateEstimate(estimate);
    await database.transaction('rw', [database.meals, database.mealEstimates], async () => {
      const meal = await database.meals.get(estimate.mealId);
      if (meal === undefined || meal.deletedAt !== null) throw new Error('estimate requires an active meal');
      await database.mealEstimates.put(structuredClone(estimate));
    });
  }

  async function clearTemporary(mealId: string): Promise<void> {
    await database.transaction('rw', [database.mealPhotos, database.mealEstimates], async () => {
      await database.mealPhotos.where('mealId').equals(mealId).delete();
      await database.mealEstimates.where('mealId').equals(mealId).delete();
    });
  }

  return {
    saveConfirmedFoodItem: save,
    updateMealItemAmount: updateAmount,
    removeMealItem: removeItem,
    removeMeal: removeWholeMeal,
    listNutritionDay: listDay,
    putMealPhoto: putPhoto,
    putMealEstimate: putEstimate,
    clearMealTemporaryState: clearTemporary,
  };
}

const defaultRepo = createMealRepo(db);

export const saveConfirmedFoodItem = (input: SaveConfirmedFoodItemInput): Promise<MealItem> =>
  defaultRepo.saveConfirmedFoodItem(input);
export const updateMealItemAmount = (id: string, amount: number): Promise<MealItem> =>
  defaultRepo.updateMealItemAmount(id, amount);
export const removeMealItem = (id: string): Promise<void> => defaultRepo.removeMealItem(id);
export const removeMeal = (id: string): Promise<void> => defaultRepo.removeMeal(id);
export const listNutritionDay = (date: string): Promise<NutritionDay> => defaultRepo.listNutritionDay(date);
export const putMealPhoto = (photo: MealPhoto): Promise<void> => defaultRepo.putMealPhoto(photo);
export const putMealEstimate = (estimate: MealEstimate): Promise<void> => defaultRepo.putMealEstimate(estimate);
export const clearMealTemporaryState = (mealId: string): Promise<void> => defaultRepo.clearMealTemporaryState(mealId);
```

- [ ] **Step 4: Run the focused repository suite to verify GREEN**

```bash
npm test -- src/repos/mealRepo.test.ts
```

Expected: PASS for idempotent retries, cross-connection order allocation, snapshot-only amount updates, active-parent guards, two-table temporary cleanup rollback, four-table delete rollback, and ordered day derivation.

- [ ] **Step 5: Run GREEN verification and commit**

```bash
npm run typecheck
git add src/repos/mealRepo.ts src/repos/mealRepo.test.ts
git commit -m "feat: add atomic local meal repository"
```

Expected: all concurrency, rollback, cleanup, and day-query tests PASS.

### Task 7: Turn the Health shell into a neutral plan-settings screen

**Files:** Modify `src/repos/weightRepo.ts` and its test; create `src/screens/health/NutritionPlanSetup.tsx` and its test; modify `src/screens/health/HealthScreen.tsx` and its test.

- [ ] **Step 1: Add the latest-weight RED test (2 minutes)**

First replace the repository import in `src/repos/weightRepo.test.ts` so the RED test compiles against the intended missing export:

```ts
import { getLatestWeightOnOrBefore, getWeight, listWeights, removeWeight, setWeight } from './weightRepo';
```

Then add this complete case:

```ts
test('只取目标日及之前最新的有效体重', async () => {
  await setWeight('2026-08-10', 80);
  await setWeight('2026-08-15', 79);
  expect(await getLatestWeightOnOrBefore('2026-08-14')).toMatchObject({ date: '2026-08-10', weightKg: 80 });
});
```

Run `npm test -- src/repos/weightRepo.test.ts`. Expected: RED because the export is missing.

- [ ] **Step 2: Implement the ordered lookup and turn it GREEN (2 minutes)**

```ts
export async function getLatestWeightOnOrBefore(date: string): Promise<WeightLog | undefined> {
  const rows = await db.weightLogs.where('date').belowOrEqual(date).toArray();
  return rows.filter((row) => row.deletedAt === null).sort((a, b) => b.date.localeCompare(a.date))[0];
}
```

Run `npm test -- src/repos/weightRepo.test.ts`. Expected: PASS. Do not use `reverse().sort().reverse()`.

- [ ] **Step 3: Create the complete plan-setup RED test (5 minutes)**

Create `src/screens/health/NutritionPlanSetup.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDb } from '../../test/dbTestUtils';
import { setWeight } from '../../repos/weightRepo';
import { getEffectiveNutritionPlan, listNutritionPlans } from '../../repos/nutritionPlanRepo';
import { deriveTargetSchedule, NUTRITION_DISCLAIMER, NutritionPlanSetup } from './NutritionPlanSetup';

beforeEach(resetDb);
afterEach(() => { vi.unstubAllEnvs(); });

async function fillAutomaticForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('年龄'), '30');
  await user.type(screen.getByLabelText('身高（厘米）'), '175');
  await user.selectOptions(screen.getByLabelText('方程分支'), 'male');
  await user.selectOptions(screen.getByLabelText('活动类别下界'), 'inactive');
  await user.selectOptions(screen.getByLabelText('活动类别上界'), 'low-active');
  await user.selectOptions(screen.getByLabelText('职业活动'), 'mixed');
  await user.type(screen.getByLabelText('主动通勤分钟/天'), '20');
  await user.type(screen.getByLabelText('家务分钟/天'), '30');
  await user.type(screen.getByLabelText('步数/天'), '8000');
  await user.selectOptions(screen.getByLabelText('训练类型'), 'resistance');
  await user.type(screen.getByLabelText('训练次数/周'), '4');
  await user.type(screen.getByLabelText('每次训练分钟'), '60');
  await user.selectOptions(screen.getByLabelText('训练强度'), 'moderate');
  await user.type(screen.getByLabelText('目标体重（公斤）'), '72');
  await user.type(screen.getByLabelText('每周减重（公斤）'), '0.459');
  await user.selectOptions(screen.getByLabelText('蛋白质计算体重'), 'current-weight');
  for (const label of ['高体脂或肥胖', '孕期或哺乳期', '需治疗性饮食', '肾病或复杂疾病', '进食障碍或 RED-S 风险', '运动员或极高活动量']) {
    await user.selectOptions(screen.getByLabelText(label), 'no');
  }
}

test('目标体重和每周速度是唯一可编辑权威，普通值和 0.5 kg/周边界都派生唯一日期', () => {
  expect(deriveTargetSchedule(80, 72, '2026-08-14', 0.459)).toEqual({
    targetDate: '2026-12-14', targetLossKgPerWeek: 0.459,
  });
  expect(deriveTargetSchedule(80, 76, '2026-08-14', 0.5)).toEqual({
    targetDate: '2026-10-09', targetLossKgPerWeek: 0.5,
  });
});

test('无法用整天表示的速度和非减重方向在进入 kernel 前拒绝', () => {
  expect(() => deriveTargetSchedule(80, 76, '2026-08-14', 0.501)).toThrow('无法按整天推算');
  expect(() => deriveTargetSchedule(80, 80, '2026-08-14', 0.5)).toThrow('目标体重必须低于计算体重');
});

test.each([
  ['增肌', { muscleGain: true, fatLoss: false }],
  ['减脂', { muscleGain: false, fatLoss: true }],
] as const)('flag off 的%s目标可手输体重，但保存中性计划且不伪造活动答案', async (label, goals) => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await user.click(screen.getByLabelText(label));
  await user.type(screen.getByLabelText('当前体重（公斤）'), '80');
  await user.click(screen.getByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  const plan = await getEffectiveNutritionPlan('2026-08-14');
  expect(plan).toMatchObject({
    goals,
    equationInputs: { activityInputs: { assessmentStatus: 'not-provided', occupation: 'not-provided', trainingTypes: [] } },
    targetMode: { protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only', autoTargetsEnabled: false },
  });
  expect(screen.getByText(NUTRITION_DISCLAIMER)).toBeInTheDocument();
});

test('flag on 且两个目标都未选时保存纯记录 canonical 分支', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const user = userEvent.setup(); render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  const plan = await getEffectiveNutritionPlan('2026-08-14');
  expect(plan?.goals).toEqual({ muscleGain: false, fatLoss: false });
  expect(plan?.targetMode).toEqual({ protein: 'disabled', energy: 'disabled', evaluationPolicy: 'neutral-intake-only', autoTargetsEnabled: true, reason: 'active' });
  expect(plan?.equationInputs).toMatchObject({ equationName: 'not-calculated', equationBranch: 'unavailable', activityInputs: { assessmentStatus: 'not-provided' }, activityCategoryLow: null, activityCategoryHigh: null, maintenanceEnergyLowKcal: null, maintenanceEnergyHighKcal: null, calculatedAt: null });
});

test('历史体重日期作为 basisWeightDate 保留，不改写为计划日期', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', ''); await setWeight('2026-08-10', 80);
  const user = userEvent.setup(); render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await user.click(screen.getByLabelText('增肌')); await user.click(await screen.findByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  expect((await getEffectiveNutritionPlan('2026-08-14'))?.safetyInputs).toMatchObject({ basisWeightKg: 80, basisWeightDate: '2026-08-10' });
});

test('flag on 提交双目标、完整活动与安全字段并保存 NASEM 区间', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await setWeight('2026-08-14', 80);
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await user.click(screen.getByLabelText('增肌'));
  await user.click(screen.getByLabelText('减脂'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await fillAutomaticForm(user);
  const derivedDate = screen.getByLabelText('推算目标日期');
  expect(derivedDate.tagName).toBe('OUTPUT'); expect(derivedDate).toHaveTextContent('2026-12-14');
  expect(screen.queryByLabelText('目标日期')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  const plan = await getEffectiveNutritionPlan('2026-08-14');
  expect(plan?.goals).toEqual({ muscleGain: true, fatLoss: true });
  expect(plan?.equationInputs.activityInputs).toMatchObject({ assessmentStatus: 'complete', occupation: 'mixed', activeCommuteMinutesPerDay: 20, householdMinutesPerDay: 30, stepsPerDay: 8000, trainingTypes: ['resistance'], trainingSessionsPerWeek: 4, trainingMinutesPerSession: 60, trainingIntensity: 'moderate' });
  expect(plan?.equationInputs.maintenanceEnergyLowKcal).toBeTypeOf('number');
  expect(plan?.equationInputs.maintenanceEnergyHighKcal).toBeGreaterThan(plan?.equationInputs.maintenanceEnergyLowKcal ?? 0);
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  expect(await listNutritionPlans()).toHaveLength(1);
});

test('BMI 23.9 显示 blocker 且不泄露热量目标', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await setWeight('2026-08-14', 73.19);
  const user = userEvent.setup();
  render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await user.click(screen.getByLabelText('减脂'));
  await user.click(await screen.findByLabelText('确认使用这条体重'));
  await fillAutomaticForm(user);
  await user.clear(screen.getByLabelText('目标体重（公斤）'));
  await user.type(screen.getByLabelText('目标体重（公斤）'), '68');
  await user.clear(screen.getByLabelText('每周减重（公斤）'));
  await user.type(screen.getByLabelText('每周减重（公斤）'), '0.298');
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  expect(await screen.findByTestId('blocker-fat-loss-bmi-ineligible')).toBeInTheDocument();
  expect((await getEffectiveNutritionPlan('2026-08-14'))?.targetRanges.energyLowKcal).toBeNull();
});

test.each([
  ['蛋白质计算体重', 'unverified', 'protein-weight-method-unverified'],
  ['肾病或复杂疾病', 'yes', 'kidney-or-complex-condition'],
] as const)('%s 安全阻断会显示且不生成隐藏目标', async (label, value, blocker) => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true'); await setWeight('2026-08-14', 80);
  const user = userEvent.setup(); render(<NutritionPlanSetup date="2026-08-14" onSaved={() => undefined} />);
  await user.click(screen.getByLabelText('增肌')); await user.click(screen.getByLabelText('减脂'));
  await user.click(await screen.findByLabelText('确认使用这条体重')); await fillAutomaticForm(user);
  await user.selectOptions(screen.getByLabelText(label), value);
  await user.click(screen.getByRole('button', { name: '保存健康计划' }));
  expect(await screen.findByTestId(`blocker-${blocker}`)).toBeInTheDocument();
  const plan = await getEffectiveNutritionPlan('2026-08-14');
  if (blocker === 'protein-weight-method-unverified') expect(plan?.targetRanges.proteinLowG).toBeNull();
  else expect(plan?.targetRanges.energyLowKcal).toBeNull();
});
```

Run `npm test -- src/screens/health/NutritionPlanSetup.test.tsx`. Expected: RED because the component is absent.

- [ ] **Step 4: Implement the complete typed form mapper (5 minutes)**

At the top of `src/screens/health/NutritionPlanSetup.tsx`, add these types and pure mapper; the component below is the only caller:

```tsx
import { useState, type FormEvent, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../../components/Button';
import { addDays } from '../../lib/dates';
import type { ActivityCategory, NutritionEligibilityBlocker, NutritionGoals, NutritionPlan, NutritionSafetyInputs, TrainingType } from '../../lib/nutritionTypes';
import { autoNutritionTargetsEnabled } from '../../lib/nutritionFeatureFlags';
import { buildNutritionPlan, type NutritionPlanDraft } from '../../lib/nutritionPlan';
import { impliedWeeklyLossKg } from '../../lib/nutritionPlanPolicy';
import { getLatestWeightOnOrBefore, setWeight } from '../../repos/weightRepo';
import { saveNutritionPlan } from '../../repos/nutritionPlanRepo';

export interface NutritionPlanSetupProps { date: string; existing?: NutritionPlan; onSaved(): void; }
const number = (form: FormData, name: string) => {
  const value = Number(form.get(name));
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
};
const yesNo = (form: FormData, name: string) => form.get(name) === 'yes';

export interface BasisWeightSnapshot { weightKg: number | null; weightDate: string | null; }
export interface DerivedTargetSchedule { targetDate: string; targetLossKgPerWeek: number; }

export function deriveTargetSchedule(
  basisWeightKg: number,
  targetWeightKg: number,
  basisDate: string,
  targetLossKgPerWeek: number,
): DerivedTargetSchedule {
  if (![basisWeightKg, targetWeightKg, targetLossKgPerWeek].every(Number.isFinite) || targetLossKgPerWeek <= 0) {
    throw new Error('每周减重必须是大于 0 的有限数');
  }
  if (targetWeightKg >= basisWeightKg) throw new Error('目标体重必须低于计算体重');
  const exactDays = ((basisWeightKg - targetWeightKg) * 7) / targetLossKgPerWeek;
  const candidates = [...new Set([Math.floor(exactDays), Math.round(exactDays), Math.ceil(exactDays)])]
    .filter((days) => days >= 1)
    .map((days) => {
      const targetDate = addDays(basisDate, days);
      const implied = impliedWeeklyLossKg(basisWeightKg, targetWeightKg, basisDate, targetDate);
      return { targetDate, difference: Math.abs(implied - targetLossKgPerWeek) };
    })
    .sort((a, b) => a.difference - b.difference || a.targetDate.localeCompare(b.targetDate));
  const best = candidates[0];
  if (!best || best.difference > 0.0005) throw new Error('该每周速度无法按整天推算，请以 0.001 kg/周为单位调整');
  return { targetDate: best.targetDate, targetLossKgPerWeek };
}

export function draftFromPlanForm(form: FormData, date: string, weight: BasisWeightSnapshot, goals: NutritionGoals, auto: boolean): NutritionPlanDraft {
  const emptySafety: Omit<NutritionSafetyInputs, 'eligibilityBlockers'> = {
    basisWeightKg: weight.weightKg, basisWeightDate: weight.weightDate,
    proteinWeightMethod: null, ageYears: null, heightCm: null, targetWeightKg: null,
    targetLossKgPerWeek: null, targetDate: null, highBodyFatOrObesity: null,
    pregnantOrBreastfeeding: null, requiresTherapeuticDiet: null,
    kidneyDiseaseOrComplexCondition: null, eatingDisorderOrRedsRisk: null,
    athleteOrExtremeActivity: null, eligibilityStandard: 'WS/T 428—2013',
  };
  if (!auto || (!goals.muscleGain && !goals.fatLoss)) return {
    effectiveFrom: date, goals, safetyInputs: emptySafety,
    equationInputs: {
      equationBranch: 'unavailable', activityCategoryLow: null, activityCategoryHigh: null,
      activityInputs: { assessmentStatus: 'not-provided', occupation: 'not-provided', activeCommuteMinutesPerDay: null, householdMinutesPerDay: null, stepsPerDay: null, trainingTypes: [], trainingSessionsPerWeek: null, trainingMinutesPerSession: null, trainingIntensity: 'not-provided' },
    },
  };
  const high = String(form.get('activityCategoryHigh'));
  const targetWeightKg = goals.fatLoss ? number(form, 'targetWeightKg') : null;
  if (goals.fatLoss && (weight.weightKg === null || weight.weightDate === null)) throw new Error('减脂目标需要已确认的计算体重与日期');
  const targetSchedule = goals.fatLoss
    ? deriveTargetSchedule(weight.weightKg!, targetWeightKg!, weight.weightDate!, number(form, 'targetLossKgPerWeek'))
    : null;
  return {
    effectiveFrom: date, goals,
    safetyInputs: {
      ...emptySafety, ageYears: number(form, 'ageYears'), heightCm: number(form, 'heightCm'),
      proteinWeightMethod: String(form.get('proteinWeightMethod')) as NutritionSafetyInputs['proteinWeightMethod'],
      targetWeightKg,
      targetLossKgPerWeek: targetSchedule?.targetLossKgPerWeek ?? null,
      targetDate: targetSchedule?.targetDate ?? null,
      highBodyFatOrObesity: yesNo(form, 'highBodyFatOrObesity'),
      pregnantOrBreastfeeding: yesNo(form, 'pregnantOrBreastfeeding'),
      requiresTherapeuticDiet: yesNo(form, 'requiresTherapeuticDiet'),
      kidneyDiseaseOrComplexCondition: yesNo(form, 'kidneyDiseaseOrComplexCondition'),
      eatingDisorderOrRedsRisk: yesNo(form, 'eatingDisorderOrRedsRisk'),
      athleteOrExtremeActivity: yesNo(form, 'athleteOrExtremeActivity'),
    },
    equationInputs: {
      equationBranch: String(form.get('equationBranch')) as 'female' | 'male',
      activityCategoryLow: String(form.get('activityCategoryLow')) as ActivityCategory,
      activityCategoryHigh: high === '' ? null : high as ActivityCategory,
      activityInputs: {
        assessmentStatus: 'complete', occupation: String(form.get('occupation')) as 'mostly-seated' | 'mixed' | 'mostly-standing' | 'manual-labor',
        activeCommuteMinutesPerDay: number(form, 'activeCommuteMinutesPerDay'), householdMinutesPerDay: number(form, 'householdMinutesPerDay'), stepsPerDay: number(form, 'stepsPerDay'),
        trainingTypes: [String(form.get('trainingType')) as TrainingType], trainingSessionsPerWeek: number(form, 'trainingSessionsPerWeek'),
        trainingMinutesPerSession: number(form, 'trainingMinutesPerSession'), trainingIntensity: String(form.get('trainingIntensity')) as 'light' | 'moderate' | 'vigorous' | 'mixed' | 'none',
      },
    },
  };
}

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="grid gap-1 text-xs text-mute">{label}<input {...props} aria-label={label} className="min-h-11 rounded-xl border border-line bg-raised px-3 text-ink" /></label>;
}
function Select({ label, children, ...props }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <label className="grid gap-1 text-xs text-mute">{label}<select {...props} aria-label={label} className="min-h-11 rounded-xl border border-line bg-raised px-3 text-ink">{children}</select></label>;
}
const YesNo = ({ label, name }: { label: string; name: string }) => <Select label={label} name={name} required><option value="">请选择</option><option value="no">否</option><option value="yes">是</option></Select>;
```

- [ ] **Step 5: Add complete setup state, handlers, and JSX (5 minutes)**

Append to the same file:

```tsx
export const NUTRITION_DISCLAIMER = '自动估算仅作饮食记录参考，不构成医疗诊断或治疗建议，也不保证达到增肌或减脂结果。';
export const NUTRITION_BLOCKER_COPY: Record<NutritionEligibilityBlocker, string> = {
  'automatic-targets-disabled': '自动目标尚未开放，当前仅记录摄入',
  'protein-age-under-18': '18 岁以下暂不自动估算蛋白质目标',
  'energy-age-under-19': '19 岁以下暂不自动估算热量目标',
  'missing-inputs': '资料不完整，暂不自动计算',
  'equation-branch-unavailable': '计算分支未确认，暂不估算热量',
  'fat-loss-bmi-ineligible': '当前 BMI 不在首阶段自动热量估算范围',
  'target-bmi-below-18.5': '目标体重低于安全边界，暂不估算热量',
  'speed-or-six-month-limit': '请把目标拆为不超过初始体重 10% 的首阶段',
  'protein-weight-method-unverified': '请先确认蛋白质计算所用体重',
  'pregnancy-or-breastfeeding': '孕期或哺乳期需由专业人员评估',
  'therapeutic-diet-required': '治疗性饮食需由专业人员评估',
  'kidney-or-complex-condition': '复杂健康情况需由专业人员评估',
  'eating-disorder-or-reds-risk': '进食障碍或 RED-S 风险需由专业人员评估',
  'athlete-or-extreme-activity': '运动员或极高活动量需个体化评估',
  'energy-floor': '估算热量低于当前安全下限，暂不生成目标',
};

const rangeText = (low: number | null, high: number | null, unit: string) => {
  if (low === null || high === null) return '暂不自动估算';
  return low === high ? `${Math.round(low)} ${unit}/日` : `${Math.round(low)}–${Math.round(high)} ${unit}/日`;
};

export interface NutritionPlanDetailsProps {
  plan: NutritionPlan;
  targetsEnabled: boolean;
  onEdit(): void;
}

export function NutritionPlanDetails({ plan, targetsEnabled, onEdit }: NutritionPlanDetailsProps) {
  if (!targetsEnabled) return <section aria-label="当前健康计划" className="forged-surface rounded-2xl p-5">
    <p className="text-sm font-semibold text-ink">当前状态：仅记录饮食</p>
    <p className="mt-2 text-xs text-mute">自动目标评价未开启</p>
    <p className="mt-3 text-xs text-mute">{NUTRITION_DISCLAIMER}</p>
    <Button variant="secondary" className="mt-3" onClick={onEdit}>调整目标</Button>
  </section>;
  const goalText = [plan.goals.muscleGain ? '增肌' : '', plan.goals.fatLoss ? '减脂' : ''].filter(Boolean).join(' · ') || '仅记录';
  const basis = plan.safetyInputs.basisWeightKg === null || plan.safetyInputs.basisWeightDate === null
    ? '未提供计算体重'
    : `${plan.safetyInputs.basisWeightDate} 的 ${plan.safetyInputs.basisWeightKg.toFixed(1)} kg`;
  const energySource = plan.equationInputs.equationName === 'NASEM-2023-adult-EER' ? 'NASEM 2023 成人 EER' : '未计算';
  return <section aria-label="当前健康计划" className="forged-surface rounded-2xl p-5">
    <p className="text-sm font-semibold text-ink">目标：{goalText}</p>
    <dl className="mt-3 grid gap-2 text-sm text-mute">
      <div><dt className="inline font-semibold text-ink">蛋白质建议：</dt><dd className="inline">{rangeText(plan.targetRanges.proteinLowG, plan.targetRanges.proteinHighG, 'g')}</dd></div>
      <div><dt className="inline font-semibold text-ink">热量建议：</dt><dd className="inline">{rangeText(plan.targetRanges.energyLowKcal, plan.targetRanges.energyHighKcal, 'kcal')}</dd></div>
      <div><dt className="inline font-semibold text-ink">计算依据：</dt><dd className="inline">{basis}</dd></div>
      <div><dt className="inline font-semibold text-ink">蛋白质来源：</dt><dd className="inline">{plan.proteinPolicySource} · {plan.proteinPolicyVersion}</dd></div>
      <div><dt className="inline font-semibold text-ink">热量来源：</dt><dd className="inline">{energySource}</dd></div>
      {plan.goals.fatLoss && plan.safetyInputs.targetWeightKg !== null && plan.safetyInputs.targetLossKgPerWeek !== null && plan.safetyInputs.targetDate !== null && <div><dt className="inline font-semibold text-ink">减脂节奏：</dt><dd className="inline">目标 {plan.safetyInputs.targetWeightKg.toFixed(1)} kg · {plan.safetyInputs.targetLossKgPerWeek.toFixed(3)} kg/周 · 推算至 {plan.safetyInputs.targetDate}</dd></div>}
    </dl>
    {plan.safetyInputs.eligibilityBlockers.length > 0 && <ul aria-label="计划限制" className="mt-3 space-y-1 text-xs text-mute">{plan.safetyInputs.eligibilityBlockers.map((code) => <li data-testid={`blocker-${code}`} key={code}>{NUTRITION_BLOCKER_COPY[code] ?? '当前资料不足，暂不自动计算'}</li>)}</ul>}
    <p className="mt-3 text-xs text-mute">{NUTRITION_DISCLAIMER}</p>
    <Button variant="secondary" className="mt-3" onClick={onEdit}>调整目标</Button>
  </section>;
}

export function NutritionPlanSetup({ date, existing, onSaved }: NutritionPlanSetupProps) {
  const auto = autoNutritionTargetsEnabled();
  const latest = useLiveQuery(() => getLatestWeightOnOrBefore(date), [date]);
  const [muscleGain, setMuscleGain] = useState(existing?.goals.muscleGain ?? false);
  const [fatLoss, setFatLoss] = useState(existing?.goals.fatLoss ?? false);
  const [manualWeight, setManualWeight] = useState('');
  const [targetWeight, setTargetWeight] = useState(existing?.safetyInputs.targetWeightKg?.toString() ?? '');
  const [weeklyLoss, setWeeklyLoss] = useState(existing?.safetyInputs.targetLossKgPerWeek?.toString() ?? '');
  const [weightConfirmed, setWeightConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [blockers, setBlockers] = useState<NutritionEligibilityBlocker[]>(existing?.safetyInputs.eligibilityBlockers ?? []);
  const hasGoal = muscleGain || fatLoss;
  const candidateWeight = latest?.weightKg ?? Number(manualWeight);
  const validWeight = !hasGoal || (Number.isFinite(candidateWeight) && candidateWeight >= 20 && candidateWeight <= 300);
  let targetDatePreview = '';
  if (fatLoss && validWeight && targetWeight !== '' && weeklyLoss !== '') {
    try { targetDatePreview = deriveTargetSchedule(candidateWeight, Number(targetWeight), latest?.date ?? date, Number(weeklyLoss)).targetDate; }
    catch { targetDatePreview = ''; }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validWeight || (hasGoal && !weightConfirmed)) { setError('请确认 20–300 公斤的体重'); return; }
    setSaving(true); setError('');
    try {
      if (hasGoal && !latest) await setWeight(date, candidateWeight);
      const weight = hasGoal
        ? { weightKg: candidateWeight, weightDate: latest?.date ?? date }
        : { weightKg: null, weightDate: null };
      const draft = draftFromPlanForm(new FormData(event.currentTarget), date, weight, { muscleGain, fatLoss }, auto);
      const plan = buildNutritionPlan(draft, { autoTargetsEnabled: auto, now: Date.now() });
      await saveNutritionPlan(plan); setBlockers(plan.safetyInputs.eligibilityBlockers); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setSaving(false); }
  }

  return <section aria-labelledby="nutrition-plan-title" className="forged-surface rounded-2xl p-5">
    <h2 id="nutrition-plan-title" className="text-lg font-extrabold text-ink">健康计划</h2>
    {!auto && <p className="mt-2 text-sm text-mute">自动目标尚未开放，仍可记录饮食</p>}
    <form className="mt-4 space-y-4" onSubmit={submit}>
      <fieldset className="grid grid-cols-2 gap-3"><legend className="sr-only">选择目标</legend>
        <label className="min-h-11 rounded-xl border border-line p-3 text-ink"><input aria-label="增肌" type="checkbox" checked={muscleGain} onChange={(e) => setMuscleGain(e.target.checked)} /> 增肌</label>
        <label className="min-h-11 rounded-xl border border-line p-3 text-ink"><input aria-label="减脂" type="checkbox" checked={fatLoss} onChange={(e) => setFatLoss(e.target.checked)} /> 减脂</label>
      </fieldset>
      {hasGoal && !latest && <Field label="当前体重（公斤）" type="number" min="20" max="300" step="0.1" value={manualWeight} onChange={(e) => setManualWeight(e.target.value)} required />}
      {hasGoal && <label className="flex min-h-11 items-center gap-3 text-sm text-ink"><input aria-label="确认使用这条体重" type="checkbox" checked={weightConfirmed} onChange={(e) => setWeightConfirmed(e.target.checked)} />确认使用 {latest ? `${latest.date} 的 ${latest.weightKg.toFixed(1)} kg` : '这条体重'}</label>}
      {auto && hasGoal && <div className="grid gap-3">
        <Field label="年龄" name="ageYears" type="number" min="1" max="120" required /><Field label="身高（厘米）" name="heightCm" type="number" min="100" max="250" required />
        <Select label="方程分支" name="equationBranch" required><option value="">请选择</option><option value="female">女性方程</option><option value="male">男性方程</option></Select>
        <Select label="活动类别下界" name="activityCategoryLow" required><option value="inactive">inactive</option><option value="low-active">low-active</option><option value="active">active</option><option value="very-active">very-active</option></Select>
        <Select label="活动类别上界" name="activityCategoryHigh"><option value="">单点</option><option value="low-active">low-active</option><option value="active">active</option><option value="very-active">very-active</option></Select>
        <Select label="职业活动" name="occupation" required><option value="">请选择</option><option value="mostly-seated">久坐</option><option value="mixed">混合</option><option value="mostly-standing">久站</option><option value="manual-labor">体力劳动</option></Select>
        <Field label="主动通勤分钟/天" name="activeCommuteMinutesPerDay" type="number" min="0" max="1440" required /><Field label="家务分钟/天" name="householdMinutesPerDay" type="number" min="0" max="1440" required /><Field label="步数/天" name="stepsPerDay" type="number" min="0" max="100000" required />
        <Select label="训练类型" name="trainingType" required><option value="resistance">抗阻</option><option value="cardio">有氧</option><option value="sport">运动</option><option value="mobility">灵活性</option><option value="mixed">混合</option><option value="none">无</option></Select>
        <Field label="训练次数/周" name="trainingSessionsPerWeek" type="number" min="0" max="14" required /><Field label="每次训练分钟" name="trainingMinutesPerSession" type="number" min="0" max="600" required />
        <Select label="训练强度" name="trainingIntensity" required><option value="light">轻</option><option value="moderate">中</option><option value="vigorous">高</option><option value="mixed">混合</option><option value="none">无</option></Select>
        {fatLoss && <><Field label="目标体重（公斤）" name="targetWeightKg" type="number" min="20" max="300" step="0.1" value={targetWeight} onChange={(event) => setTargetWeight(event.target.value)} required /><Field label="每周减重（公斤）" name="targetLossKgPerWeek" type="number" min="0.001" max="0.5" step="0.001" value={weeklyLoss} onChange={(event) => setWeeklyLoss(event.target.value)} required /><p className="text-xs text-mute">推算目标日期：<output aria-label="推算目标日期">{targetDatePreview || '完成体重与速度后显示'}</output></p></>}
        <Select label="蛋白质计算体重" name="proteinWeightMethod" required><option value="">请选择</option><option value="current-weight">当前体重</option><option value="unverified">尚未确认</option></Select>
        <YesNo label="高体脂或肥胖" name="highBodyFatOrObesity" /><YesNo label="孕期或哺乳期" name="pregnantOrBreastfeeding" /><YesNo label="需治疗性饮食" name="requiresTherapeuticDiet" /><YesNo label="肾病或复杂疾病" name="kidneyDiseaseOrComplexCondition" /><YesNo label="进食障碍或 RED-S 风险" name="eatingDisorderOrRedsRisk" /><YesNo label="运动员或极高活动量" name="athleteOrExtremeActivity" />
      </div>}
      {blockers.length > 0 && <ul aria-label="计划限制" className="space-y-1 text-xs text-mute">{blockers.map((code) => <li data-testid={`blocker-${code}`} key={code}>{NUTRITION_BLOCKER_COPY[code] ?? '当前资料不足，暂不自动计算'}</li>)}</ul>}
      <p className="text-xs text-mute">{NUTRITION_DISCLAIMER}</p>
      {error && <p role="alert" className="text-sm text-iron">{error}</p>}
      <Button type="submit" fullWidth loading={saving} disabled={!validWeight || (hasGoal && !weightConfirmed)}>保存健康计划</Button>
    </form>
  </section>;
}
```

- [ ] **Step 6: Integrate the setup into the full-screen shell (3 minutes)**

Replace `HealthScreen.tsx` for this task with this compile-ready intermediate screen; Task 8 extends it without changing the route:

```tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { todayStr } from '../../lib/dates';
import { autoNutritionTargetsEnabled } from '../../lib/nutritionFeatureFlags';
import { getEffectiveNutritionPlan } from '../../repos/nutritionPlanRepo';
import { NutritionPlanDetails, NutritionPlanSetup } from './NutritionPlanSetup';

export function HealthScreen() {
  const navigate = useNavigate();
  const date = todayStr();
  const targetsEnabled = autoNutritionTargetsEnabled();
  const plan = useLiveQuery(() => getEffectiveNutritionPlan(date), [date]);
  const [editing, setEditing] = useState(false);
  return <main className="mx-auto min-h-dvh max-w-md px-5 pt-[calc(env(safe-area-inset-top)+16px)] pb-8">
    <header className="flex items-center gap-3"><Button variant="tertiary" aria-label="返回今日页" onClick={() => navigate('/', { replace: true })} className="-ml-3 size-11 p-0">‹</Button><h1 className="text-xl font-extrabold text-ink">健康</h1></header>
    <div className="mt-6">{!plan || editing ? <NutritionPlanSetup date={date} existing={plan} onSaved={() => setEditing(false)} /> : <NutritionPlanDetails plan={plan} targetsEnabled={targetsEnabled} onEdit={() => setEditing(true)} />}</div>
  </main>;
}
```

Keep the entry-plan `renderHealth()` route harness and replace its shell assertion with this complete intermediate-screen case:

```tsx
test('健康计划位于全屏路由且返回固定 replace 到今日页', async () => {
  const user = userEvent.setup(); const { router } = renderHealth();
  expect(await screen.findByRole('heading', { name: '健康计划' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '返回今日页' }));
  expect(await screen.findByRole('heading', { name: '今日页探针' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
  expect(router.state.historyAction).toBe('REPLACE');
});
```

Do not change `App.tsx` or `TabBar`.

- [ ] **Step 7: Run GREEN and commit (3 minutes)**

```bash
npm test -- src/repos/weightRepo.test.ts src/screens/health/NutritionPlanSetup.test.tsx src/screens/health/HealthScreen.test.tsx src/App.test.tsx
npm run typecheck
git add src/repos/weightRepo.ts src/repos/weightRepo.test.ts src/screens/health/NutritionPlanSetup.tsx src/screens/health/NutritionPlanSetup.test.tsx src/screens/health/HealthScreen.tsx src/screens/health/HealthScreen.test.tsx
git commit -m "feat: add local nutrition plan settings"
```

Expected: GREEN; flag-off stores canonical `assessmentStatus:'not-provided'`, while automatic energy accepts only complete activity answers.

### Task 8: Render four meal groups and add the real-image food picker

**Files:** Create `src/screens/health/useDialogFocusTrap.ts`, `src/screens/health/FoodPickerSheet.tsx`, `src/screens/health/MealSection.tsx`, and their tests; modify `src/screens/health/HealthScreen.tsx` and its test.

- [ ] **Step 1: Write the complete FoodPicker RED tests (5 minutes)**

Create `src/screens/health/FoodPickerSheet.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { PRESET_FOODS } from '../../data/presetFoods';
import { resetDb } from '../../test/dbTestUtils';
import { saveCustomFood } from '../../repos/foodRepo';
import { scaleFood } from '../../lib/nutritionStats';
import { FoodPickerSheet } from './FoodPickerSheet';

beforeEach(resetDb);
afterEach(() => { vi.restoreAllMocks(); document.body.style.overflow = ''; });

function picker(overrides: Partial<ComponentProps<typeof FoodPickerSheet>> = {}) {
  const onClose = vi.fn(); const onSave = vi.fn().mockResolvedValue(undefined);
  const view = render(<FoodPickerSheet slot="lunch" foods={PRESET_FOODS} onClose={onClose} onCreateCustomFood={saveCustomFood} onSave={onSave} {...overrides} />);
  return { ...view, onClose, onSave };
}

test('真实图目录、本地搜索、单位提示和稳定 operation id 均可用', async () => {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
  const { container, onSave } = picker();
  expect(screen.getByRole('dialog', { name: '选择食物' })).toHaveClass('motion-reduce:transition-none');
  expect(new Set([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).size).toBe(3);
  await user.type(screen.getByLabelText('搜索食物'), '米饭');
  expect(screen.getByRole('button', { name: '熟米饭' })).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '熟米饭' }));
  await user.clear(screen.getByLabelText('实际克数')); await user.type(screen.getByLabelText('实际克数'), '0');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('大于 0');
  await user.clear(screen.getByLabelText('实际克数')); await user.type(screen.getByLabelText('实际克数'), '150');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  expect(onSave).toHaveBeenCalledWith({ operationId: '11111111-1111-4111-8111-111111111111', food: PRESET_FOODS[0], amount: 150 });
});

test('手动 100 mL 标签食物由 repo 标准化，200 mL 得到 90 kcal', async () => {
  const user = userEvent.setup(); const { onSave } = picker();
  await user.click(screen.getByRole('button', { name: '手动添加食物' }));
  await user.type(screen.getByLabelText('食物名称'), '包装豆奶');
  await user.selectOptions(screen.getByLabelText('原始单位'), 'mL');
  await user.type(screen.getByLabelText('原始能量'), '45');
  await user.type(screen.getByLabelText('原始蛋白质（克）'), '3.2');
  await user.type(screen.getByLabelText('处理方式'), '即饮');
  await user.type(screen.getByLabelText('换算说明'), '包装标签每 100 mL');
  await user.clear(screen.getByLabelText('实际毫升')); await user.type(screen.getByLabelText('实际毫升'), '200');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  const saved = onSave.mock.calls[0][0];
  expect(saved.food).toMatchObject({ basisAmount: 100, basisUnit: 'mL', energyKcal: 45, proteinG: 3.2 });
  expect(scaleFood(saved.food, 200).energyKcal).toBe(90);
  expect(saved.food).not.toHaveProperty('normalizedBasisAmount');
});

test('自定义食物没有 manifest 行时显示明确占位而不渲染破图', () => {
  const custom = { ...PRESET_FOODS[0], id: 'custom:homemade-rice', name: '自制米饭', aliases: [] };
  const { container } = picker({ foods: [custom] });
  expect(screen.getByRole('img', { name: '自制米饭暂无图片' })).toHaveTextContent('暂无图片');
  expect(container.querySelector('img')).toBeNull();
});

test('dialog 锁滚动、首焦点、Tab 环、Escape 和返回焦点完整恢复', async () => {
  const user = userEvent.setup(); const opener = document.createElement('button'); opener.textContent = 'opener';
  document.body.append(opener); opener.focus(); const { unmount, onClose } = picker();
  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.getByRole('button', { name: '关闭选择食物' })).toHaveFocus();
  await user.tab({ shift: true }); expect(screen.getByRole('button', { name: '加入午餐' })).toHaveFocus();
  await user.keyboard('{Escape}'); expect(onClose).toHaveBeenCalledTimes(1);
  unmount(); expect(document.body.style.overflow).toBe(''); expect(opener).toHaveFocus(); opener.remove();
});
```

Create `src/screens/health/MealSection.test.tsx`:

```tsx
import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mealItemRow } from '../../test/nutritionFixtures';
import { MealSection } from './MealSection';

test('餐段显示快照营养、可改数量并二次确认删除', async () => {
  const user = userEvent.setup(); const onUpdate = vi.fn().mockResolvedValue(undefined); const onRemove = vi.fn().mockResolvedValue(undefined);
  render(<MealSection slot="lunch" items={[mealItemRow({ name: '熟米饭', preparation: '蒸煮', amount: 150, unit: 'g', energyKcalLow: 195, energyKcalHigh: 195, proteinGLow: 4.035, proteinGHigh: 4.035 })]} onAdd={vi.fn()} onUpdate={onUpdate} onRemove={onRemove} />);
  expect(screen.getByRole('region', { name: '午餐' })).toHaveTextContent('做法：蒸煮 · 实际吃下：150 g');
  expect(screen.getByRole('region', { name: '午餐' })).toHaveTextContent('195 kcal');
  await user.clear(screen.getByLabelText('修改熟米饭实际吃下数量')); await user.type(screen.getByLabelText('修改熟米饭实际吃下数量'), '200');
  await user.click(screen.getByRole('button', { name: '保存熟米饭数量' })); expect(onUpdate).toHaveBeenCalledWith(expect.any(String), 200);
  await user.click(screen.getByRole('button', { name: '删除熟米饭' }));
  expect(onRemove).not.toHaveBeenCalled(); await user.click(screen.getByRole('button', { name: '确认删除熟米饭' })); expect(onRemove).toHaveBeenCalledTimes(1);
});

test('数量必须是有限正数，异步保存期间禁用按钮并在失败后恢复', async () => {
  let rejectUpdate!: (cause: Error) => void;
  const onUpdate = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectUpdate = reject; }));
  const user = userEvent.setup();
  render(<MealSection slot="lunch" items={[mealItemRow({ name: '熟米饭', amount: 150 })]} onAdd={vi.fn()} onUpdate={onUpdate} onRemove={vi.fn()} />);
  const input = screen.getByLabelText('修改熟米饭实际吃下数量');
  fireEvent.change(input, { target: { value: '1e309' } });
  await user.click(screen.getByRole('button', { name: '保存熟米饭数量' }));
  expect(screen.getByRole('alert')).toHaveTextContent('有限且大于 0'); expect(onUpdate).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '200' } });
  const save = screen.getByRole('button', { name: '保存熟米饭数量' }); await user.click(save);
  expect(save).toBeDisabled();
  await act(async () => { rejectUpdate(new Error('本地保存失败')); });
  expect(await screen.findByRole('alert')).toHaveTextContent('本地保存失败');
  await waitFor(() => expect(save).not.toBeDisabled());
});

test('每条食物独立 pending，A/B 交错完成不会提前解锁另一条', async () => {
  let resolveRice!: () => void;
  let resolveBeef!: () => void;
  const onUpdate = vi.fn((id: string) => new Promise<void>((resolve) => {
    if (id === 'meal-item:rice') resolveRice = resolve;
    else resolveBeef = resolve;
  }));
  const user = userEvent.setup();
  render(<MealSection slot="lunch" items={[
    mealItemRow({ id: 'meal-item:rice', name: '熟米饭', amount: 150 }),
    mealItemRow({ id: 'meal-item:beef', name: '瘦牛肉', amount: 100 }),
  ]} onAdd={vi.fn()} onUpdate={onUpdate} onRemove={vi.fn()} />);
  const riceInput = screen.getByLabelText('修改熟米饭实际吃下数量');
  const beefInput = screen.getByLabelText('修改瘦牛肉实际吃下数量');
  fireEvent.change(riceInput, { target: { value: '180' } });
  fireEvent.change(beefInput, { target: { value: '120' } });
  const riceSave = screen.getByRole('button', { name: '保存熟米饭数量' });
  const beefSave = screen.getByRole('button', { name: '保存瘦牛肉数量' });
  await user.click(riceSave);
  expect(riceSave).toBeDisabled();
  expect(beefSave).not.toBeDisabled();
  await user.click(beefSave);
  expect(riceSave).toBeDisabled();
  expect(beefSave).toBeDisabled();

  await act(async () => { resolveBeef(); });
  await waitFor(() => expect(beefSave).not.toBeDisabled());
  expect(riceSave).toBeDisabled();

  await act(async () => { resolveRice(); });
  await waitFor(() => expect(riceSave).not.toBeDisabled());
  expect(onUpdate).toHaveBeenNthCalledWith(1, 'meal-item:rice', 180);
  expect(onUpdate).toHaveBeenNthCalledWith(2, 'meal-item:beef', 120);
});
```

Replace the imports and harness at the top of `HealthScreen.test.tsx` with this complete block, retaining the route assertion from Task 7 below it:

```tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { db } from '../../lib/db';
import { seedPresetFoods } from '../../repos/foodRepo';
import { resetDb } from '../../test/dbTestUtils';
import { mealItemRow, mealRow, nutritionPlanRow } from '../../test/nutritionFixtures';
import { HealthScreen } from './HealthScreen';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-08-14T08:00:00+08:00'));
  vi.unstubAllEnvs(); await resetDb();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

function renderHealth() {
  const router = createMemoryRouter([
    { path: '/health', element: <HealthScreen /> },
    { path: '/', element: <h1>今日页探针</h1> },
  ], { initialEntries: ['/health'] });
  return { ...render(<RouterProvider router={router} />), router };
}
```

Only `Date` is faked, so Testing Library and Dexie keep real scheduling timers. `afterEach` must always restore the real clock, including when an assertion fails.

Add this DB-backed case after the route test:

```tsx
test('四餐通过真实 repo 记录 150 g 米饭并刷新汇总', async () => {
  await seedPresetFoods(); const user = userEvent.setup(); renderHealth();
  expect(await screen.findAllByRole('region', { name: /早餐|午餐|晚餐|加餐/ })).toHaveLength(4);
  await user.click(within(screen.getByRole('region', { name: '午餐' })).getByRole('button', { name: '选择食物' }));
  await user.click(screen.getByRole('button', { name: '熟米饭' }));
  await user.clear(screen.getByLabelText('实际克数')); await user.type(screen.getByLabelText('实际克数'), '150');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  expect(await within(screen.getByRole('region', { name: '午餐' })).findByText(/195 kcal/)).toBeInTheDocument();
  expect(await db.mealItems.count()).toBe(1);
  expect(screen.queryByText(/分数|惩罚|热量达标|失败/)).not.toBeInTheDocument();
});

test('持久计划卡持续展示双目标范围、来源、体重依据日期、blocker 和固定声明', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const base = nutritionPlanRow();
  const active = nutritionPlanRow({ safetyInputs: { ...base.safetyInputs, basisWeightKg: 80, basisWeightDate: '2026-08-14', eligibilityBlockers: [] } });
  await db.nutritionPlans.put(active);
  renderHealth(); const card = await screen.findByRole('region', { name: '当前健康计划' });
  expect(card).toHaveTextContent(/蛋白质建议：\d+–\d+ g\/日/);
  expect(card).toHaveTextContent(/热量建议：\d+–\d+ kcal\/日/);
  expect(card).toHaveTextContent('计算依据：2026-08-14 的 80.0 kg');
  expect(card).toHaveTextContent('蛋白质来源：ISSN · JISSN-2017-14-20');
  expect(card).toHaveTextContent('热量来源：NASEM 2023 成人 EER');
  expect(card).toHaveTextContent('不构成医疗诊断或治疗建议，也不保证');
  await act(async () => { await db.nutritionPlans.put({
      ...active,
      safetyInputs: { ...active.safetyInputs, eligibilityBlockers: ['fat-loss-bmi-ineligible'] },
      targetRanges: { ...active.targetRanges, energyLowKcal: null, energyHighKcal: null, energyRawLowKcal: null, energyRawHighKcal: null },
      targetMode: { ...active.targetMode, energy: 'disabled', evaluationPolicy: 'protein-range', reason: 'active' },
      updatedAt: active.updatedAt + 1,
    }); });
  expect(await screen.findByTestId('blocker-fat-loss-bmi-ineligible')).toHaveTextContent('当前 BMI 不在首阶段自动热量估算范围');
  expect(screen.getByRole('region', { name: '当前健康计划' })).toHaveTextContent('热量建议：暂不自动估算');
});

test('当前 flag off 压过历史 active 快照，计划卡只显示记录态', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  await db.nutritionPlans.put(nutritionPlanRow());
  renderHealth();
  const card = await screen.findByRole('region', { name: '当前健康计划' });
  expect(card).toHaveTextContent('当前状态：仅记录饮食');
  expect(card).toHaveTextContent('自动目标评价未开启');
  expect(card).not.toHaveTextContent(/蛋白质建议|热量建议|计算依据|蛋白质来源|热量来源|减脂节奏|ISSN|NASEM/);
});

test('切换日期会 remount 计划表单并清空未保存的体重确认', async () => {
  const user = userEvent.setup(); renderHealth();
  await user.click(await screen.findByLabelText('增肌'));
  await user.type(screen.getByLabelText('当前体重（公斤）'), '80');
  await user.click(screen.getByLabelText('确认使用这条体重'));
  await user.click(screen.getByRole('button', { name: '前一天' }));
  expect(await screen.findByText('2026-08-13')).toBeInTheDocument();
  expect(await screen.findByLabelText('增肌')).not.toBeChecked();
  await user.click(screen.getByLabelText('增肌'));
  expect(screen.getByLabelText('当前体重（公斤）')).toHaveValue(null);
  expect(screen.getByLabelText('确认使用这条体重')).not.toBeChecked();
});
```

In the same test file import `nutritionPlanRow`, `mealRow`, and `mealItemRow`, then add this component-level policy table (the pure relation boundaries remain in Task 4):

```tsx
test.each([
  ['protein', '建议范围'],
  ['energy', '相对当前估算'],
  ['both', '建议范围'],
  ['overlap', '重叠'],
] as const)('%s 模式只渲染独立中性评价', async (mode, copy) => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const plan = nutritionPlanRow({ id: 'nutrition-plan:2026-08-14', effectiveFrom: '2026-08-14' });
  if (mode === 'protein') {
    plan.targetMode = { ...plan.targetMode, protein: 'range', energy: 'disabled', evaluationPolicy: 'protein-range' };
    plan.targetRanges = { ...plan.targetRanges, energyLowKcal: null, energyHighKcal: null, energyRawLowKcal: null, energyRawHighKcal: null };
  } else if (mode === 'energy') {
    plan.targetMode = { ...plan.targetMode, protein: 'disabled', energy: 'range', evaluationPolicy: 'energy-relative' };
    plan.targetRanges = { ...plan.targetRanges, proteinLowG: null, proteinHighG: null, proteinReferenceG: null, proteinLowCoefficient: null, proteinHighCoefficient: null, proteinReferenceCoefficient: null };
  }
  await db.nutritionPlans.put(plan);
  await db.meals.put(mealRow({ id: 'meal:2026-08-14:lunch', date: '2026-08-14', slot: 'lunch' }));
  await db.mealItems.put(mealItemRow({ mealId: 'meal:2026-08-14:lunch', energyKcalLow: mode === 'overlap' ? plan.targetRanges.energyLowKcal! : 100, energyKcalHigh: mode === 'overlap' ? plan.targetRanges.energyHighKcal! : 100, proteinGLow: mode === 'overlap' ? plan.targetRanges.proteinLowG! : 5, proteinGHigh: mode === 'overlap' ? plan.targetRanges.proteinHighG! : 5, quality: mode === 'overlap' ? 'B' : 'A' }));
  renderHealth();
  expect(await screen.findByLabelText('今日目标状态')).toHaveTextContent(copy);
  expect(screen.getByLabelText('今日目标状态')).not.toHaveTextContent(/分数|惩罚|热量达标|失败/);
});
```

- [ ] **Step 2: Run UI tests to verify RED (2 minutes)**

```bash
npm test -- src/screens/health/FoodPickerSheet.test.tsx src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.test.tsx
```

Expected: FAIL because picker and meal components do not exist.

- [ ] **Step 3: Implement the reusable dialog gate (3 minutes)**

Create `src/screens/health/useDialogFocusTrap.ts`:

```ts
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

export function useDialogFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current; if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const controls = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => !node.hidden);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const nodes = controls(); if (nodes.length === 0) return;
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    return () => { dialog.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; opener?.focus(); };
  }, [ref]);
}
```

- [ ] **Step 4: Implement the complete manifest-backed picker (5 minutes)**

Create `src/screens/health/FoodPickerSheet.tsx`:

```tsx
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { PRESET_FOOD_IMAGE_MANIFEST } from '../../data/presetFoodImageManifest.generated';
import type { Food, MealSlot } from '../../lib/nutritionTypes';
import type { SaveCustomFoodInput } from '../../repos/foodRepo';
import { MEAL_LABELS } from './MealSection';
import { useDialogFocusTrap } from './useDialogFocusTrap';

export interface FoodPickerSheetProps {
  slot: MealSlot; foods: Food[]; onClose(): void;
  onCreateCustomFood(operationId: string, input: SaveCustomFoodInput): Promise<Food>;
  onSave(input: { operationId: string; food: Food; amount: number }): Promise<void>;
}

export function FoodPickerSheet({ slot, foods, onClose, onCreateCustomFood, onSave }: FoodPickerSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null); useDialogFocusTrap(dialogRef, onClose);
  const operationId = useRef(crypto.randomUUID());
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState<Food>();
  const [manual, setManual] = useState(false); const [manualUnit, setManualUnit] = useState<'g' | 'mL'>('g');
  const [amount, setAmount] = useState('100'); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  const visible = useMemo(() => foods.filter((food) => food.deletedAt === null && `${food.name} ${food.aliases.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())), [foods, query]);
  const unit = manual ? manualUnit : selected?.basisUnit ?? 'g';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const gramsOrMl = Number(amount);
    if (!Number.isFinite(gramsOrMl) || gramsOrMl <= 0) { setError('实际数量必须大于 0'); return; }
    setSubmitting(true); setError('');
    try {
      const form = new FormData(event.currentTarget); let food = selected;
      if (manual) {
        const densityText = String(form.get('densityGPerMl') ?? '').trim();
        const input: SaveCustomFoodInput = {
          name: String(form.get('name')).trim(), aliases: [], rawOrCooked: String(form.get('rawOrCooked')) as SaveCustomFoodInput['rawOrCooked'], preparation: String(form.get('preparation')).trim(),
          originalEnergyValue: Number(form.get('originalEnergyValue')), originalEnergyUnit: String(form.get('originalEnergyUnit')) as 'kcal' | 'kJ', originalProteinG: Number(form.get('originalProteinG')),
          originalBasisAmount: Number(form.get('originalBasisAmount')), originalBasisUnit: manualUnit, normalizedBasisAmount: 100, normalizedBasisUnit: manualUnit,
          ediblePortionRatio: Number(form.get('ediblePortionRatio')), densityGPerMl: densityText === '' ? null : Number(densityText), conversionAssumptions: [String(form.get('conversionAssumptions')).trim()],
          fdcId: null, fdcDataType: null, sourceRetrievedAt: null, source: 'user-label', sourceVersion: 'user-label-v1', license: 'user-provided',
        };
        food = await onCreateCustomFood(operationId.current, input);
      }
      if (!food) throw new Error('请先选择食物');
      await onSave({ operationId: operationId.current, food, amount: gramsOrMl });
      operationId.current = crypto.randomUUID(); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setSubmitting(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end bg-black/60" aria-hidden={false}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="food-picker-title" className="max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-raised p-5 text-ink transition motion-reduce:transition-none">
      <div className="flex items-center justify-between"><h2 id="food-picker-title" className="text-lg font-extrabold">选择食物</h2><Button variant="tertiary" aria-label="关闭选择食物" onClick={onClose} className="size-11 p-0">×</Button></div>
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <label className="grid gap-1 text-xs text-mute">搜索食物<input aria-label="搜索食物" value={query} onChange={(e) => setQuery(e.target.value)} className="min-h-11 rounded-xl border border-line bg-raised px-3 text-ink" /></label>
        <div className="grid grid-cols-3 gap-3">{visible.map((food) => {
          const image = PRESET_FOOD_IMAGE_MANIFEST.find((row) => row.foodId === food.id);
          return <button type="button" aria-label={food.name} key={food.id} onClick={() => { setSelected(food); setManual(false); setAmount(String(food.basisAmount)); }} className="min-h-11 rounded-xl border border-line p-2 text-xs">
            {image
              ? <img alt="" src={image.path} className="aspect-square w-full rounded-lg object-cover" />
              : <span role="img" aria-label={`${food.name}暂无图片`} className="flex aspect-square w-full items-center justify-center rounded-lg border border-line bg-raised text-[10px] text-mute">暂无图片</span>}
            <span>{food.name}</span>
          </button>;
        })}</div>
        <Button type="button" variant="secondary" onClick={() => { setManual(true); setSelected(undefined); setAmount('100'); }}>手动添加食物</Button>
        {manual && <fieldset className="grid gap-3 rounded-xl border border-line p-3 [&_input]:min-h-11 [&_input]:rounded-xl [&_input]:border [&_input]:border-line [&_input]:bg-raised [&_input]:px-3 [&_select]:min-h-11 [&_select]:rounded-xl [&_select]:border [&_select]:border-line [&_select]:bg-raised [&_select]:px-3"><legend className="text-sm font-bold">标签数据</legend>
          <label>食物名称<input name="name" aria-label="食物名称" required /></label>
          <label>生熟状态<select name="rawOrCooked" aria-label="生熟状态"><option value="not-applicable">不适用</option><option value="cooked">熟</option><option value="raw">生</option></select></label>
          <label>处理方式<input name="preparation" aria-label="处理方式" required /></label>
          <label>原始单位<select aria-label="原始单位" value={manualUnit} onChange={(e) => setManualUnit(e.target.value as 'g' | 'mL')}><option value="g">g</option><option value="mL">mL</option></select></label>
          <label>原始 basis<input name="originalBasisAmount" aria-label="原始 basis" type="number" defaultValue="100" min="0.01" required /></label>
          <label>能量单位<select name="originalEnergyUnit" aria-label="能量单位"><option value="kcal">kcal</option><option value="kJ">kJ</option></select></label>
          <label>原始能量<input name="originalEnergyValue" aria-label="原始能量" type="number" min="0" step="any" required /></label>
          <label>原始蛋白质（克）<input name="originalProteinG" aria-label="原始蛋白质（克）" type="number" min="0" step="any" required /></label>
          <label>可食部比例<input name="ediblePortionRatio" aria-label="可食部比例" type="number" defaultValue="1" min="0.01" max="1" step="any" required /></label>
          <label>密度 g/mL（可空）<input name="densityGPerMl" aria-label="密度 g/mL（可空）" type="number" min="0.01" step="any" /></label>
          <label>换算说明<input name="conversionAssumptions" aria-label="换算说明" required /></label>
        </fieldset>}
        <label className="grid gap-1 text-xs text-mute">{unit === 'g' ? '实际克数' : '实际毫升'}<input aria-label={unit === 'g' ? '实际克数' : '实际毫升'} value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0.01" step="any" className="min-h-11 rounded-xl border border-line bg-raised px-3 text-ink" /></label>
        {error && <p role="alert" className="text-sm text-iron">{error}</p>}
        <Button type="submit" fullWidth loading={submitting}>加入{MEAL_LABELS[slot]}</Button>
      </form>
    </div>
  </div>;
}
```

- [ ] **Step 5: Implement the complete meal section (4 minutes)**

Create `src/screens/health/MealSection.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../../components/Button';
import type { MealItem, MealSlot } from '../../lib/nutritionTypes';

export const MEAL_LABELS: Record<MealSlot, string> = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' };
export interface MealSectionProps {
  slot: MealSlot; items: MealItem[]; onAdd(slot: MealSlot): void;
  onUpdate(id: string, amount: number): Promise<void>; onRemove(id: string): Promise<void>;
}
const amountText = (low: number, high: number, unit: string) => low === high ? `${Math.round(low)} ${unit}` : `约 ${Math.round(low)}–${Math.round(high)} ${unit}`;

export function MealSection({ slot, items, onAdd, onUpdate, onRemove }: MealSectionProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string>();
  const [pendingById, setPendingById] = useState<Map<string, 'update' | 'remove'>>(() => new Map());
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function run(id: string, action: 'update' | 'remove', work: () => Promise<void>) {
    setErrors((all) => ({ ...all, [id]: '' }));
    setPendingById((all) => new Map(all).set(id, action));
    try { await work(); if (action === 'remove') setConfirming(undefined); }
    catch (cause) { setErrors((all) => ({ ...all, [id]: cause instanceof Error ? cause.message : '保存失败' })); }
    finally {
      setPendingById((all) => {
        const next = new Map(all); next.delete(id); return next;
      });
    }
  }

  return <section aria-labelledby={`meal-${slot}`} className="rounded-2xl border border-line p-4">
    <div className="flex items-center justify-between"><h2 id={`meal-${slot}`} className="text-lg font-extrabold text-ink">{MEAL_LABELS[slot]}</h2><Button variant="secondary" onClick={() => onAdd(slot)}>选择食物</Button></div>
    {items.length === 0 ? <p className="mt-3 text-sm text-mute">尚未记录</p> : <ul className="mt-3 space-y-3">{items.map((item) => { const pending = pendingById.get(item.id); return <li key={item.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
      <div className="flex justify-between gap-3"><div><p className="font-semibold text-ink">{item.name}</p><p className="text-xs text-mute">做法：{item.preparation} · 实际吃下：{item.amount} {item.unit}</p><p className="text-xs text-mute">{amountText(item.energyKcalLow, item.energyKcalHigh, 'kcal')} · {amountText(item.proteinGLow, item.proteinGHigh, 'g 蛋白质')}</p></div>
        <Button variant="tertiary" aria-label={`删除${item.name}`} disabled={pending !== undefined} onClick={() => setConfirming(item.id)}>删除</Button></div>
      <div className="mt-2 flex gap-2"><input aria-label={`修改${item.name}实际吃下数量`} type="number" min="0.01" step="any" value={drafts[item.id] ?? String(item.amount)} onChange={(e) => setDrafts((all) => ({ ...all, [item.id]: e.target.value }))} disabled={pending !== undefined} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-ink" /><Button variant="secondary" aria-label={`保存${item.name}数量`} loading={pending === 'update'} onClick={() => {
        const amount = Number(drafts[item.id] ?? item.amount);
        if (!Number.isFinite(amount) || amount <= 0) { setErrors((all) => ({ ...all, [item.id]: '实际吃下数量必须是有限且大于 0 的数' })); return; }
        void run(item.id, 'update', () => onUpdate(item.id, amount));
      }}>保存</Button></div>
      {errors[item.id] && <p role="alert" className="mt-2 text-xs text-iron">{errors[item.id]}</p>}
      {confirming === item.id && <div role="alertdialog" aria-label={`确认删除${item.name}`} className="mt-2 flex items-center gap-2 text-xs text-mute"><span>删除这条已确认记录？</span><Button variant="secondary" aria-label={`确认删除${item.name}`} loading={pending === 'remove'} onClick={() => void run(item.id, 'remove', () => onRemove(item.id))}>确认删除</Button><Button variant="tertiary" disabled={pending !== undefined} onClick={() => setConfirming(undefined)}>取消</Button></div>}
    </li>; })}</ul>}
  </section>;
}
```

`preparation` remains an immutable confirmed snapshot in this milestone: changing a cooking method requires deleting and re-adding the food so nutrient provenance is recalculated. Only the explicitly labelled “实际吃下数量” is editable in place; its repository test already proves all nutrient snapshot fields rescale atomically.

- [ ] **Step 6: Replace HealthScreen with complete repository orchestration (5 minutes)**

Replace `src/screens/health/HealthScreen.tsx`:

```tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { addDays, todayStr } from '../../lib/dates';
import type { MealSlot } from '../../lib/nutritionTypes';
import { autoNutritionTargetsEnabled } from '../../lib/nutritionFeatureFlags';
import { evaluateNutritionDay, formatNutritionIntake } from '../../lib/nutritionStats';
import { listFoods, saveCustomFood } from '../../repos/foodRepo';
import { getEffectiveNutritionPlan } from '../../repos/nutritionPlanRepo';
import { listNutritionDay, removeMealItem, saveConfirmedFoodItem, updateMealItemAmount } from '../../repos/mealRepo';
import { FoodPickerSheet } from './FoodPickerSheet';
import { MealSection } from './MealSection';
import { NutritionPlanDetails, NutritionPlanSetup } from './NutritionPlanSetup';

export function HealthScreen() {
  const navigate = useNavigate(); const today = todayStr(); const [date, setDate] = useState(today);
  const [pickerSlot, setPickerSlot] = useState<MealSlot>(); const [editingPlan, setEditingPlan] = useState(false);
  const data = useLiveQuery(async () => {
    const [day, foods, plan] = await Promise.all([listNutritionDay(date), listFoods(), getEffectiveNutritionPlan(date)]);
    return { day, foods, plan };
  }, [date]);
  const targetsEnabled = autoNutritionTargetsEnabled();
  const evaluation = data && targetsEnabled ? evaluateNutritionDay(data.day.summary, data.plan) : undefined;
  const messages = evaluation ? [evaluation.protein, evaluation.energy].filter((row) => row.mode !== 'disabled').map((row) => row.message) : [];
  const changeDate = (next: string) => { setPickerSlot(undefined); setEditingPlan(false); setDate(next); };

  return <main className="mx-auto min-h-dvh max-w-md px-5 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
    <header className="flex items-center gap-3"><Button variant="tertiary" aria-label="返回今日页" onClick={() => navigate('/', { replace: true })} className="-ml-3 size-11 p-0">‹</Button><div><p className="text-[10px] font-semibold tracking-[2px] text-amber">DAILY NUTRITION</p><h1 className="text-xl font-extrabold text-ink">健康</h1></div></header>
    <nav aria-label="饮食日期" className="mt-4 flex items-center justify-between"><Button variant="tertiary" aria-label="前一天" onClick={() => changeDate(addDays(date, -1))}>‹</Button><time dateTime={date} className="text-sm font-semibold text-ink">{date}</time><Button variant="tertiary" aria-label="后一天" disabled={date >= today} onClick={() => changeDate(addDays(date, 1))}>›</Button></nav>
    {data ? <>
      <div className="mt-5">{!data.plan || editingPlan ? <NutritionPlanSetup key={`plan:${date}:${data.plan?.id ?? 'new'}`} date={date} existing={data.plan} onSaved={() => setEditingPlan(false)} /> : <NutritionPlanDetails plan={data.plan} targetsEnabled={targetsEnabled} onEdit={() => setEditingPlan(true)} />}</div>
      <section aria-label="今日摄入" className="mt-4 rounded-2xl border border-line p-4"><h2 className="text-sm font-bold text-ink">今日摄入</h2><p className="mt-1 text-sm text-mute">{data.day.summary.recordedMeals === 0 ? '今天还没有已确认食物' : formatNutritionIntake(data.day.summary)}</p><div aria-label="今日目标状态" className="mt-2 space-y-1 text-xs text-mute">{messages.length > 0 ? messages.map((message) => <p key={message}>{message}</p>) : <p>目标评价未开启</p>}</div></section>
      <div className="mt-4 space-y-4">{data.day.meals.map(({ slot, items }) => <MealSection key={slot} slot={slot} items={items} onAdd={setPickerSlot} onUpdate={async (id, amount) => { await updateMealItemAmount(id, amount); }} onRemove={removeMealItem} />)}</div>
      {pickerSlot && <FoodPickerSheet slot={pickerSlot} foods={data.foods} onClose={() => setPickerSlot(undefined)} onCreateCustomFood={saveCustomFood} onSave={async ({ operationId, food, amount }) => { await saveConfirmedFoodItem({ operationId, date, slot: pickerSlot, food, amount }); setPickerSlot(undefined); }} />}
    </> : <p className="mt-8 text-sm text-mute">正在读取饮食记录</p>}
  </main>;
}
```

The four sections come from `listNutritionDay`'s fixed order; do not duplicate a UI-only slot array. The only color tokens above already exist. Evaluation stays two independent neutral text rows; no progress bar, score, red punishment, calorie “达标”, or “失败” state is introduced.

- [ ] **Step 7: Run GREEN verification and commit (3 minutes)**

```bash
npm test -- src/screens/health/FoodPickerSheet.test.tsx src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.test.tsx src/repos/mealRepo.test.ts
npm run typecheck
git add src/screens/health/useDialogFocusTrap.ts src/screens/health/FoodPickerSheet.tsx src/screens/health/FoodPickerSheet.test.tsx src/screens/health/MealSection.tsx src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.tsx src/screens/health/HealthScreen.test.tsx
git commit -m "feat: add four-meal local food picker"
```

Expected: full Health interaction is offline and PASS; no network mock is required.

### Task 9: Replace the Today empty entry with the live day summary and verify the whole local core

**Files:** Modify `src/screens/today/TodayNutritionSummary.tsx`, `src/screens/today/TodayScreen.tsx`, and their tests; test `src/App.test.tsx` without changing it.

- [ ] **Step 1: Write RED Today-summary tests with real repository data**

Replace the entry-plan `TodayNutritionSummary.test.tsx` with this complete DB-backed file. Every case passes an explicit date and restores the feature-flag environment:

```tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PRESET_FOODS } from '../../data/presetFoods';
import { track } from '../../lib/analytics';
import { db } from '../../lib/db';
import { evaluateNutritionDay } from '../../lib/nutritionStats';
import { listNutritionDay, saveConfirmedFoodItem } from '../../repos/mealRepo';
import { resetDb } from '../../test/dbTestUtils';
import { mealItemRow, mealRow, nutritionPlanRow } from '../../test/nutritionFixtures';
import { TodayNutritionSummary } from './TodayNutritionSummary';

vi.mock('../../lib/analytics', { spy: true });

beforeEach(async () => { vi.clearAllMocks(); vi.unstubAllEnvs(); await resetDb(); });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function renderSummary(date: string) {
  return render(<MemoryRouter><TodayNutritionSummary date={date} /></MemoryRouter>);
}

test('无记录、无计划时保留中性空态、低强调入口和关闭的目标评价', async () => {
  const { container } = renderSummary('2026-08-14');
  expect(await screen.findByText('记录今天吃了什么')).toBeInTheDocument();
  expect(screen.queryByText('今天还没有已确认食物')).not.toBeInTheDocument();
  expect(container).not.toHaveTextContent(/0 kcal|0 g 蛋白质|已记录 0 \/ 4 餐/);
  expect(screen.getByLabelText('今日目标状态')).toHaveTextContent('目标评价未开启');
  expect(screen.getByRole('link', { name: '进入健康' })).toHaveAttribute('href', '/health');
  expect(container.querySelector('.heat')).toBeNull();
  expect(container).not.toHaveTextContent(/进度|分数|惩罚|达标|失败/);
});

test('无记录但已有计划时使用已确认食物空态并保持中性评价', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await db.nutritionPlans.put(nutritionPlanRow());
  renderSummary('2026-08-14');
  expect(await screen.findByText('今天还没有已确认食物')).toBeInTheDocument();
  expect(screen.queryByText('记录今天吃了什么')).not.toBeInTheDocument();
  expect(screen.getByLabelText('今日目标状态')).toHaveTextContent('尚无已确认食物，暂不评价蛋白质');
});

test('点击入口只上报 health_opened', async () => {
  const user = userEvent.setup(); renderSummary('2026-08-14');
  await user.click(await screen.findByRole('link', { name: '进入健康' }));
  expect(track).toHaveBeenCalledWith('health_opened'); expect(track).toHaveBeenCalledTimes(1);
});

test('已确认食物显示真实热量、蛋白质和餐次，仍可进入健康', async () => {
  await saveConfirmedFoodItem({
    operationId: 'today-rice', date: '2026-08-14', slot: 'lunch',
    food: PRESET_FOODS[0], amount: 150,
  });
  renderSummary('2026-08-14');
  expect(await screen.findByText('195 kcal · 4 g 蛋白质')).toBeInTheDocument();
  expect(screen.getByText('已记录 1 / 4 餐')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '进入健康' })).toHaveAttribute('href', '/health');
});

test('B 级区间保留约数范围而不压成中点', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await db.meals.put(mealRow());
  await db.mealItems.put(mealItemRow({ energyKcalLow: 300, energyKcalHigh: 420, proteinGLow: 20, proteinGHigh: 30, quality: 'B' }));
  await db.nutritionPlans.put(nutritionPlanRow({
    targetRanges: { ...nutritionPlanRow().targetRanges, proteinLowG: 25, proteinHighG: 35, proteinReferenceG: 30 },
    targetMode: { ...nutritionPlanRow().targetMode, protein: 'range', evaluationPolicy: 'protein-range', autoTargetsEnabled: true, reason: 'active' },
  }));
  renderSummary('2026-08-14');
  expect(await screen.findByText('约 300–420 kcal / 20–30 g 蛋白质')).toBeInTheDocument();
  expect(screen.getByText('可能与建议范围重叠')).toBeInTheDocument();
});

test('flag on 时 Today 与共享评价函数显示同一条蛋白质偏低文案', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const plan = nutritionPlanRow(); await db.nutritionPlans.put(plan);
  await saveConfirmedFoodItem({ operationId: 'today-low-protein', date: '2026-08-14', slot: 'lunch', food: PRESET_FOODS[0], amount: 150 });
  const day = await listNutritionDay('2026-08-14');
  const expected = evaluateNutritionDay(day.summary, plan).protein.message;
  expect(expected).toContain('蛋白质相对建议范围偏低');
  renderSummary('2026-08-14');
  expect(await screen.findByLabelText('今日目标状态')).toHaveTextContent(expected);
});

test('当前 flag off 会压过历史 active 计划快照', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const plan = nutritionPlanRow(); await db.nutritionPlans.put(plan);
  await saveConfirmedFoodItem({ operationId: 'today-kill-switch', date: '2026-08-14', slot: 'lunch', food: PRESET_FOODS[0], amount: 150 });
  const day = await listNutritionDay('2026-08-14');
  const hidden = evaluateNutritionDay(day.summary, plan).protein.message;
  renderSummary('2026-08-14');
  const status = await screen.findByLabelText('今日目标状态');
  expect(status).toHaveTextContent('目标评价未开启'); expect(status).not.toHaveTextContent(hidden);
});
```

In `TodayScreen.test.tsx`, retain the entry plan's DOM-order case unchanged; it still proves training CTA → Today nutrition → weight. The implementation step below changes the mounted summary to receive the screen's already-computed `today` value, so the screen itself owns no second clock and the summary owns all paired nutrition queries.

- [ ] **Step 2: Run focused tests to verify RED**

```bash
npm test -- src/screens/today/TodayNutritionSummary.test.tsx src/screens/today/TodayScreen.test.tsx
```

Expected: FAIL because the entry component does not accept `date` and does not query the real day plus effective plan.

- [ ] **Step 3: Implement the live Today summary**

Replace `src/screens/today/TodayNutritionSummary.tsx` with this complete file:

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { track } from '../../lib/analytics';
import { autoNutritionTargetsEnabled } from '../../lib/nutritionFeatureFlags';
import { evaluateNutritionDay, formatNutritionIntake } from '../../lib/nutritionStats';
import { listNutritionDay } from '../../repos/mealRepo';
import { getEffectiveNutritionPlan } from '../../repos/nutritionPlanRepo';

export function TodayNutritionSummary({ date }: { date: string }) {
  const targetsEnabled = autoNutritionTargetsEnabled();
  const data = useLiveQuery(async () => {
    const [day, plan] = await Promise.all([
      listNutritionDay(date),
      getEffectiveNutritionPlan(date),
    ]);
    return { day, plan };
  }, [date]);
  const label = !data
    ? '正在读取饮食记录'
    : data.day.summary.recordedMeals === 0 && data.plan === undefined
      ? '记录今天吃了什么'
      : formatNutritionIntake(data.day.summary);
  const evaluation = data && targetsEnabled
    ? evaluateNutritionDay(data.day.summary, data.plan)
    : undefined;
  const statusMessages = evaluation
    ? [evaluation.protein, evaluation.energy]
        .filter((dimension) => dimension.mode !== 'disabled')
        .map((dimension) => dimension.message)
    : [];

  return (
    <section aria-labelledby="today-nutrition-title" className="mt-4 rounded-xl border border-line bg-raised px-4 py-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="today-nutrition-title" className="text-[11px] tracking-[2px] text-mute uppercase">今日饮食</h2>
          <p className="mt-1 text-sm font-semibold text-ink">{label}</p>
          {data && data.day.summary.recordedMeals > 0 && <p className="mt-1 text-xs text-mute">已记录 {data.day.summary.recordedMeals} / 4 餐</p>}
          <div aria-label="今日目标状态" className="mt-2 space-y-1 text-xs text-mute">
            {statusMessages.length > 0
              ? statusMessages.map((message) => <p key={message}>{message}</p>)
              : <p>目标评价未开启</p>}
          </div>
        </div>
        <Link to="/health" aria-label="进入健康" onClick={() => track('health_opened')} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-iron outline-none transition active:scale-[.98] focus-visible:ring-2 focus-visible:ring-iron motion-reduce:transition-none">进入健康<span aria-hidden>›</span></Link>
      </div>
    </section>
  );
}
```

The Today copy contract is intentionally state-specific: only the combined no-record/no-plan state says `记录今天吃了什么`; once confirmed food exists, intake remains visible even without a plan; when a plan exists but food does not, the shared neutral `今天还没有已确认食物` copy remains visible beside the plan's neutral evaluation. Exact intake uses `X kcal · Y g 蛋白质`; any B-grade/ranged intake uses an approximation prefix plus slash separator, for example `约 X–Y kcal / X–Y g 蛋白质`, while retaining each dimension's actual point or interval endpoints. The formatter and both its unit test and Today integration test above must retain that single contract.

The current flag is an outer kill switch even when an old persisted plan says `autoTargetsEnabled:true`. In `TodayScreen.tsx`, replace the entry-plan `<TodayNutritionSummary />` call with `<TodayNutritionSummary date={today} />` at the already-established location. Do not add nutrition queries to `TodayScreen`; the summary owns the paired reactive read. Reuse evaluation messages verbatim so Health and Today cannot disagree.

- [ ] **Step 4: Run complete automated verification**

```bash
npm test -- src/lib/nutritionIds.test.ts src/lib/stableJson.test.ts src/lib/mealSnapshot.test.ts src/lib/dbMigrationV4.test.ts src/data/presetFoods.test.ts src/lib/nutritionFeatureFlags.test.ts src/lib/foodNormalization.test.ts src/lib/nutritionStats.test.ts src/lib/nutritionPlanValidation.test.ts src/lib/nutritionPlan.test.ts src/repos/foodRepo.test.ts src/repos/nutritionPlanRepo.test.ts src/repos/mealRepo.test.ts src/screens/health/NutritionPlanSetup.test.tsx src/screens/health/FoodPickerSheet.test.tsx src/screens/health/MealSection.test.tsx src/screens/health/HealthScreen.test.tsx src/screens/today/TodayNutritionSummary.test.tsx src/screens/today/TodayScreen.test.tsx src/App.test.tsx
npm test
npm run typecheck
npm run build
```

Expected: every focused test, the full suite, strict typecheck, and production build PASS.

- [ ] **Step 5: Verify assets, privacy boundary, and excluded files**

```bash
npm run food-assets:manifest
git diff --exit-code -- src/data/presetFoodImageManifest.generated.ts
if rg -n "fetch\(|XMLHttpRequest|Authorization|VITE_.*AI" src/screens/health src/repos/foodRepo.ts src/repos/nutritionPlanRepo.ts src/repos/mealRepo.ts; then echo "unexpected network or AI code"; exit 1; fi
if rg -n "const EER|753\.07|584\.90" src/lib/nutritionPlan.ts src/lib/nutritionPlanValidation.ts; then echo "duplicate nutrition policy outside shared kernel"; exit 1; fi
if git diff --name-only HEAD~9..HEAD | rg -q "nutritionBackup|exportData|importData|DataRestorePanel|Onboarding|TabBar"; then echo "core scope violation"; exit 1; fi
```

Expected: manifest regeneration makes no diff; all three fail-on-match guards exit 0. Typed local `MealEstimate` storage is allowed, but no network or AI implementation exists, and all equations/policies remain in the shared kernel.

- [ ] **Step 6: Perform mobile real-browser acceptance**

Start a fixed local server:

```bash
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/#/` at 390×844 and verify: training is the only gradient CTA; Today order is training → nutrition → weight; `/health` has no TabBar and replace-backs to `/`; both goals coexist while default targets remain unavailable; target weight plus weekly speed derive a read-only target date; the persisted card keeps protein/energy ranges, both sources, basis-weight date, every blocker, and the fixed non-medical/non-guarantee disclaimer visible; changing the day clears uncommitted weight confirmation and closes transient state; four meals are ordered; three realistic cooked-food photos are distinct while a custom food without a manifest row shows “暂无图片” instead of a broken image; 150 g lunch rice updates Health and Today to 195 kcal/rounded 4 g protein; invalid or failed actual-intake edits remain recoverable; offline refresh retains all rows and summaries; and 44 px controls, existing tokens, focus behavior, and reduced motion all work.

Capture the browser result separately from unit-test evidence. A passing browser check does not replace the automated suite.

- [ ] **Step 7: Commit the live Today integration**

```bash
git add src/screens/today/TodayNutritionSummary.tsx src/screens/today/TodayNutritionSummary.test.tsx src/screens/today/TodayScreen.tsx src/screens/today/TodayScreen.test.tsx
git commit -m "feat: show live nutrition summary on today"
if git diff --name-only HEAD~9..HEAD | rg -q "nutritionBackup|exportData|importData|DataRestorePanel|Onboarding|TabBar"; then echo "nine-commit scope violation"; exit 1; fi
git status --short
```

Expected: the ninth implementation commit is created; the full nine-commit scope scan returns no matches. Worktree status contains no modified implementation file; unrelated pre-existing plan files may remain untracked.

## Final contract audit

Before handing the branch to the backup-v3 plan, confirm the actual exported shapes with:

```bash
rg -n "export interface (NutritionGoals|NutritionSafetyInputs|NutritionActivityInputs|NutritionEquationInputs|NutritionTargetRanges|NutritionTargetMode|NutritionPlan|Food|Meal|MealItem|MealPhoto|MealEstimate)|export async function buildMealSnapshotHash|export function (deriveNutritionPlanSemantics|assertNutritionPlanSemantics)" src/lib/nutritionTypes.ts src/lib/mealSnapshot.ts src/lib/nutritionPlanPolicy.ts src/lib/nutritionPlanValidation.ts
```

Expected exact ownership:

- `NutritionGoals`: `muscleGain`, `fatLoss`.
- `NutritionSafetyInputs`: basis weight/date and method, age/height, target weight/speed/date, high-body-fat status, five safety answers, WS/T standard, blocker list.
- `NutritionActivityInputs`: explicit `assessmentStatus`, occupation, active commute, housework, steps, and training type/frequency/duration/intensity; `not-provided` has one canonical null/empty form, while automatic energy requires `complete`.
- `NutritionTargetRanges`: nullable protein intervals and coefficients plus rounded and unrounded energy endpoints.
- `NutritionTargetMode`: independent protein and energy modes, evaluation policy, auto-target flag snapshot, reason.
- `NutritionPlan`: the backup prerequisite top-level fields with those five explicit nested interfaces, including literal `proteinPolicySource:'ISSN'` and `proteinPolicyVersion:'JISSN-2017-14-20'` provenance.
- `Food` and `MealItem`: original nutrient/basis fields, normalized density, edible ratio, nullable density, conversion assumptions, FDC identity/data type/retrieval snapshot, and source/license; `MealEstimate` keeps typed request/candidate/consent/error fields.
- `buildMealSnapshotHash(meal, items): Promise<string>`: one canonical exported implementation.
- `assertNutritionPlanSemantics(plan): void`: one shared post-parse semantic gate; `buildNutritionPlan` calls it before return and the backup parser calls it after field whitelisting.
- `deriveNutritionPlanSemantics(raw)`: the single coefficient, blocker, mode, EER, protein, speed/date, energy-policy, and floor authority used by both builder and validator; no second policy table is permitted.

The next plan may whitelist and parse this contract. It must not reinterpret generic records, invent a second set of health fields, export preset assets, or include photos and estimates in JSON.
