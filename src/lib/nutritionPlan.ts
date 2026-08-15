import { nutritionPlanId } from './nutritionIds';
import {
  bodyMassIndex,
  deriveNutritionPlanSemantics,
  fatLossEnergyRange,
  impliedWeeklyLossKg,
  nasemAdultEer,
  proteinTargetRange,
  validateActivityInputs,
  type NutritionPlanRawInputs,
} from './nutritionPlanPolicy';
import type {
  NutritionEquationInputs,
  NutritionGoals,
  NutritionPlan,
  NutritionSafetyInputs,
} from './nutritionTypes';
import { assertNutritionPlanSemantics } from './nutritionPlanValidation';

export {
  bodyMassIndex,
  fatLossEnergyRange,
  impliedWeeklyLossKg,
  nasemAdultEer,
  proteinTargetRange,
  validateActivityInputs,
};

export interface NutritionPlanDraft {
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
}

export interface BuildNutritionPlanOptions {
  autoTargetsEnabled: boolean;
  now: number;
}

export function buildNutritionPlan(
  draft: NutritionPlanDraft,
  options: BuildNutritionPlanOptions,
): NutritionPlan {
  const raw: NutritionPlanRawInputs = {
    effectiveFrom: draft.effectiveFrom,
    goals: { ...draft.goals },
    safetyInputs: { ...draft.safetyInputs },
    equationInputs: {
      ...draft.equationInputs,
      activityInputs: {
        ...draft.equationInputs.activityInputs,
        trainingTypes: [...draft.equationInputs.activityInputs.trainingTypes],
      },
    },
    autoTargetsEnabled: options.autoTargetsEnabled,
    now: options.now,
  };
  const semantics = deriveNutritionPlanSemantics(raw);
  const plan: NutritionPlan = {
    id: nutritionPlanId(draft.effectiveFrom),
    effectiveFrom: draft.effectiveFrom,
    goals: { ...draft.goals },
    ...semantics,
    standardVersion: 'WS/T-428-2013',
    equationVersion: 'NASEM-2023-adult-EER',
    sourceVersion: 'tiezheng-local-nutrition-v1',
    proteinPolicySource: 'ISSN',
    proteinPolicyVersion: 'JISSN-2017-14-20',
    updatedAt: options.now,
    deletedAt: null,
  };
  assertNutritionPlanSemantics(plan);
  return plan;
}
