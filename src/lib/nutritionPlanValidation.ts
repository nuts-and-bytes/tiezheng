import { nutritionPlanId } from './nutritionIds';
import {
  deriveNutritionPlanSemantics,
  type NutritionPlanRawInputs,
} from './nutritionPlanPolicy';
import { stableJson } from './stableJson';
import type { NutritionPlan } from './nutritionTypes';

function assertFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteNumbers(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assertFiniteNumbers(entry, `${path}.${key}`);
    }
  }
}

function assertSafeTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

export function assertNutritionPlanSemantics(plan: NutritionPlan): void {
  if (!plan || typeof plan !== 'object') throw new Error('nutrition plan must be an object');
  assertFiniteNumbers(plan, 'plan');
  if (plan.id !== nutritionPlanId(plan.effectiveFrom)) {
    throw new Error('nutrition plan id does not match effectiveFrom');
  }
  if (plan.standardVersion !== 'WS/T-428-2013') {
    throw new Error('unexpected nutrition standardVersion');
  }
  if (plan.equationVersion !== 'NASEM-2023-adult-EER') {
    throw new Error('unexpected nutrition equationVersion');
  }
  if (plan.sourceVersion !== 'tiezheng-local-nutrition-v1') {
    throw new Error('unexpected nutrition sourceVersion');
  }
  if (plan.proteinPolicySource !== 'ISSN') {
    throw new Error('proteinPolicySource must be ISSN');
  }
  if (plan.proteinPolicyVersion !== 'JISSN-2017-14-20') {
    throw new Error('proteinPolicyVersion must be JISSN-2017-14-20');
  }
  assertSafeTimestamp(plan.updatedAt, 'updatedAt');
  if (plan.deletedAt !== null) assertSafeTimestamp(plan.deletedAt, 'deletedAt');
  if (plan.equationInputs.calculatedAt !== null) {
    assertSafeTimestamp(plan.equationInputs.calculatedAt, 'calculatedAt');
  }

  const { eligibilityBlockers: _ignored, ...safetyInputs } = plan.safetyInputs;
  const raw: NutritionPlanRawInputs = {
    effectiveFrom: plan.effectiveFrom,
    goals: plan.goals,
    safetyInputs,
    equationInputs: {
      equationBranch: plan.equationInputs.equationBranch,
      activityInputs: plan.equationInputs.activityInputs,
      activityCategoryLow: plan.equationInputs.activityCategoryLow,
      activityCategoryHigh: plan.equationInputs.activityCategoryHigh,
    },
    autoTargetsEnabled: plan.targetMode.autoTargetsEnabled,
    now: plan.equationInputs.calculatedAt ?? plan.updatedAt,
  };
  const expected = deriveNutritionPlanSemantics(raw);
  const actual = {
    safetyInputs: plan.safetyInputs,
    equationInputs: plan.equationInputs,
    targetRanges: plan.targetRanges,
    targetMode: plan.targetMode,
  };
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error('nutrition plan derived semantics do not match canonical policy');
  }
}
