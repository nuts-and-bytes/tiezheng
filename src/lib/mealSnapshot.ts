import type { Meal, MealItem } from './nutritionTypes';
import { stableJson } from './stableJson';

export async function buildMealSnapshotHash(meal: Meal, items: MealItem[]): Promise<string> {
  const activeItems = items
    .filter((item) => item.deletedAt === null)
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      if (left.id < right.id) return -1;
      if (left.id > right.id) return 1;
      return 0;
    })
    .map((item) => ({ ...item, updatedAt: undefined }));
  const payload = {
    version: 'meal-snapshot-v1',
    meal: {
      id: meal.id,
      date: meal.date,
      slot: meal.slot,
      deletedAt: meal.deletedAt,
    },
    items: activeItems,
  };
  const bytes = new TextEncoder().encode(stableJson(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
