import { db } from '../lib/db';
import { nutritionPlanId } from '../lib/nutritionIds';
import { assertNutritionPlanSemantics } from '../lib/nutritionPlanValidation';
import { stableJson } from '../lib/stableJson';
import type { NutritionPlan } from '../lib/nutritionTypes';
import { setWeight } from './weightRepo';

export interface NutritionPlanWeightInput {
  date: string;
  weightKg: number;
}

function assertSafeTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe timestamp`);
  }
}

export async function saveNutritionPlan(plan: NutritionPlan): Promise<NutritionPlan> {
  const row: NutritionPlan = {
    ...structuredClone(plan),
    id: nutritionPlanId(plan.effectiveFrom),
    deletedAt: null,
  };
  assertNutritionPlanSemantics(row);
  return db.transaction('rw', db.nutritionPlans, async () => {
    const existing = await db.nutritionPlans.get(row.id);
    if (existing !== undefined) {
      if (row.updatedAt < existing.updatedAt) {
        throw new Error('stale nutrition plan update');
      }
      if (row.updatedAt === existing.updatedAt) {
        if (stableJson(row) !== stableJson(existing)) {
          throw new Error('nutrition plan timestamp conflict');
        }
        return existing;
      }
    }

    await db.nutritionPlans.put(row);
    return row;
  });
}

export async function saveNutritionPlanWithWeight(
  plan: NutritionPlan,
  weight: NutritionPlanWeightInput,
): Promise<NutritionPlan> {
  return db.transaction('rw', [db.weightLogs, db.nutritionPlans], async () => {
    await setWeight(weight.date, weight.weightKg);
    return saveNutritionPlan(plan);
  });
}

export async function getEffectiveNutritionPlan(
  date: string,
): Promise<NutritionPlan | undefined> {
  nutritionPlanId(date);
  const rows = await db.nutritionPlans.where('effectiveFrom').belowOrEqual(date).toArray();
  return rows
    .filter((plan) => plan.deletedAt === null)
    .sort(
      (left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom) || right.updatedAt - left.updatedAt,
    )[0];
}

export async function listNutritionPlans(): Promise<NutritionPlan[]> {
  return (await db.nutritionPlans.toArray())
    .filter((plan) => plan.deletedAt === null)
    .sort(
      (left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom) || right.updatedAt - left.updatedAt,
    );
}

export async function removeNutritionPlan(effectiveFrom: string): Promise<void> {
  const id = nutritionPlanId(effectiveFrom);
  await db.transaction('rw', db.nutritionPlans, async () => {
    const existing = await db.nutritionPlans.get(id);
    if (existing === undefined || existing.deletedAt !== null) return;
    const clock = Date.now();
    assertSafeTimestamp(existing.updatedAt, 'existing updatedAt');
    assertSafeTimestamp(clock, 'Date.now()');
    const tombstoneAt = Math.max(existing.updatedAt, clock);
    await db.nutritionPlans.put({
      ...existing,
      updatedAt: tombstoneAt,
      deletedAt: tombstoneAt,
    });
  });
}
