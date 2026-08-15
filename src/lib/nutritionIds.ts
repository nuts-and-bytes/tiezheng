import type { MealSlot } from './nutritionTypes';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const OPERATION_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function assertDateKey(dateKey: string): void {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) throw new Error('date key must use YYYY-MM-DD');

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('date key must be a real calendar date');
  }
}

export function nutritionPlanId(dateKey: string): string {
  assertDateKey(dateKey);
  return `nutrition-plan:${dateKey}`;
}

export function mealId(dateKey: string, slot: MealSlot): string {
  assertDateKey(dateKey);
  return `meal:${dateKey}:${slot}`;
}

export function operationKey(value: string): string {
  if (!OPERATION_KEY_PATTERN.test(value)) {
    throw new Error('operation id must contain 1-128 letters, numbers, underscores, or hyphens');
  }
  return value;
}

export function mealItemId(operationId: string): string {
  return `meal-item:${operationKey(operationId)}`;
}

export function mealPhotoId(parentMealId: string): string {
  return `meal-photo:${parentMealId}`;
}

export function mealEstimateId(parentMealId: string): string {
  return `meal-estimate:${parentMealId}`;
}
