import type {
  Food,
  Meal,
  MealItem,
  MealSlot,
  NutritionPlan,
} from './nutritionTypes';

export interface NutritionDaySummary {
  energyKcalLow: number;
  energyKcalHigh: number;
  proteinGLow: number;
  proteinGHigh: number;
  recordedMeals: number;
  recordedSlots: MealSlot[];
  hasRange: boolean;
}

export interface NutritionDimensionEvaluation {
  mode: 'disabled' | 'protein-range' | 'energy-relative';
  relation: 'neutral' | 'below' | 'within' | 'above' | 'overlap';
  message: string;
  differenceLow: number | null;
  differenceHigh: number | null;
}

export interface NutritionDayEvaluation {
  protein: NutritionDimensionEvaluation;
  energy: NutritionDimensionEvaluation;
}

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be finite and non-negative`);
  }
}

export function scaleFood(food: Food, amount: number): {
  energyKcal: number;
  proteinG: number;
} {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be finite and positive');
  }
  if (!Number.isFinite(food.basisAmount) || food.basisAmount <= 0) {
    throw new Error('food basisAmount must be finite and positive');
  }
  assertFiniteNonNegative(food.energyKcal, 'food energyKcal');
  assertFiniteNonNegative(food.proteinG, 'food proteinG');
  const factor = amount / food.basisAmount;
  const energyKcal = food.energyKcal * factor;
  const proteinG = food.proteinG * factor;
  assertFiniteNonNegative(energyKcal, 'scaled energyKcal');
  assertFiniteNonNegative(proteinG, 'scaled proteinG');
  return {
    energyKcal,
    proteinG,
  };
}

function assertItemRange(item: MealItem): void {
  const fields = [
    ['energyKcalLow', item.energyKcalLow],
    ['energyKcalHigh', item.energyKcalHigh],
    ['proteinGLow', item.proteinGLow],
    ['proteinGHigh', item.proteinGHigh],
  ] as const;
  for (const [field, value] of fields) assertFiniteNonNegative(value, field);
  if (item.energyKcalLow > item.energyKcalHigh) {
    throw new Error('energy range must be ascending');
  }
  if (item.proteinGLow > item.proteinGHigh) {
    throw new Error('protein range must be ascending');
  }
}

export function summarizeNutritionDay(
  meals: readonly Meal[],
  items: readonly MealItem[],
): NutritionDaySummary {
  const activeMeals = new Map(
    meals.filter((meal) => meal.deletedAt === null).map((meal) => [meal.id, meal]),
  );
  const recordedMealIds = new Set<string>();
  let energyKcalLow = 0;
  let energyKcalHigh = 0;
  let proteinGLow = 0;
  let proteinGHigh = 0;
  let hasRange = false;

  for (const item of items) {
    if (item.deletedAt !== null || !activeMeals.has(item.mealId)) continue;
    assertItemRange(item);
    recordedMealIds.add(item.mealId);
    energyKcalLow += item.energyKcalLow;
    energyKcalHigh += item.energyKcalHigh;
    proteinGLow += item.proteinGLow;
    proteinGHigh += item.proteinGHigh;
    assertFiniteNonNegative(energyKcalLow, 'daily energyKcalLow');
    assertFiniteNonNegative(energyKcalHigh, 'daily energyKcalHigh');
    assertFiniteNonNegative(proteinGLow, 'daily proteinGLow');
    assertFiniteNonNegative(proteinGHigh, 'daily proteinGHigh');
    if (
      item.quality === 'B' ||
      item.energyKcalLow !== item.energyKcalHigh ||
      item.proteinGLow !== item.proteinGHigh
    ) {
      hasRange = true;
    }
  }

  const recordedSlots = SLOT_ORDER.filter((slot) =>
    [...recordedMealIds].some((mealId) => activeMeals.get(mealId)?.slot === slot),
  );
  return {
    energyKcalLow,
    energyKcalHigh,
    proteinGLow,
    proteinGHigh,
    recordedMeals: recordedSlots.length,
    recordedSlots,
    hasRange,
  };
}

function neutral(
  mode: NutritionDimensionEvaluation['mode'],
  message: string,
): NutritionDimensionEvaluation {
  return {
    mode,
    relation: 'neutral',
    message,
    differenceLow: null,
    differenceHigh: null,
  };
}

function separatedRelation(
  intakeLow: number,
  intakeHigh: number,
  targetLow: number,
  targetHigh: number,
): Pick<
  NutritionDimensionEvaluation,
  'relation' | 'differenceLow' | 'differenceHigh'
> {
  if (intakeHigh < targetLow) {
    return {
      relation: 'below',
      differenceLow: targetLow - intakeHigh,
      differenceHigh: targetHigh - intakeLow,
    };
  }
  if (intakeLow > targetHigh) {
    return {
      relation: 'above',
      differenceLow: intakeLow - targetHigh,
      differenceHigh: intakeHigh - targetLow,
    };
  }
  return { relation: 'overlap', differenceLow: null, differenceHigh: null };
}

function evaluateProtein(
  summary: NutritionDaySummary,
  plan: NutritionPlan | undefined,
): NutritionDimensionEvaluation {
  if (
    !plan ||
    plan.deletedAt !== null ||
    plan.targetMode.protein === 'disabled' ||
    plan.targetRanges.proteinLowG === null ||
    plan.targetRanges.proteinHighG === null
  ) {
    return neutral('disabled', '蛋白质建议范围未启用');
  }
  if (summary.recordedMeals === 0) {
    return neutral('protein-range', '尚无已确认食物，暂不评价蛋白质');
  }

  const relation = separatedRelation(
    summary.proteinGLow,
    summary.proteinGHigh,
    plan.targetRanges.proteinLowG,
    plan.targetRanges.proteinHighG,
  );
  if (
    relation.relation === 'overlap' &&
    !summary.hasRange &&
    summary.proteinGLow === summary.proteinGHigh &&
    summary.proteinGLow >= plan.targetRanges.proteinLowG &&
    summary.proteinGLow <= plan.targetRanges.proteinHighG
  ) {
    return {
      mode: 'protein-range',
      relation: 'within',
      message: '已进入建议范围',
      differenceLow: 0,
      differenceHigh: 0,
    };
  }
  const message =
    relation.relation === 'below'
      ? '蛋白质相对建议范围偏低'
      : relation.relation === 'above'
        ? '蛋白质相对建议范围偏高'
        : '可能与建议范围重叠';
  return { mode: 'protein-range', message, ...relation };
}

function evaluateEnergy(
  summary: NutritionDaySummary,
  plan: NutritionPlan | undefined,
): NutritionDimensionEvaluation {
  if (
    !plan ||
    plan.deletedAt !== null ||
    plan.targetMode.energy === 'disabled' ||
    plan.targetRanges.energyLowKcal === null ||
    plan.targetRanges.energyHighKcal === null
  ) {
    return neutral('disabled', '热量当前估算未启用');
  }
  if (summary.recordedMeals === 0) {
    return neutral('energy-relative', '尚无已确认食物，暂不评价热量');
  }
  const relation = separatedRelation(
    summary.energyKcalLow,
    summary.energyKcalHigh,
    plan.targetRanges.energyLowKcal,
    plan.targetRanges.energyHighKcal,
  );
  const message =
    relation.relation === 'below'
      ? '热量相对当前估算可能偏低'
      : relation.relation === 'above'
        ? '热量相对当前估算可能偏高'
        : '热量相对当前估算重叠';
  return { mode: 'energy-relative', message, ...relation };
}

export function evaluateNutritionDay(
  summary: NutritionDaySummary,
  plan: NutritionPlan | undefined,
): NutritionDayEvaluation {
  return {
    protein: evaluateProtein(summary, plan),
    energy: evaluateEnergy(summary, plan),
  };
}

export function formatNutritionIntake(summary: NutritionDaySummary): string {
  if (summary.recordedMeals === 0) return '今天还没有已确认食物';
  const energyLow = Math.round(summary.energyKcalLow);
  const energyHigh = Math.round(summary.energyKcalHigh);
  const proteinLow = Math.round(summary.proteinGLow * 10) / 10;
  const proteinHigh = Math.round(summary.proteinGHigh * 10) / 10;
  if (!summary.hasRange) {
    return `${energyLow} kcal · ${proteinLow} g 蛋白质`;
  }
  const energy = energyLow === energyHigh ? `${energyLow}` : `${energyLow}–${energyHigh}`;
  const protein =
    proteinLow === proteinHigh ? `${proteinLow}` : `${proteinLow}–${proteinHigh}`;
  return `约 ${energy} kcal / ${protein} g 蛋白质`;
}
