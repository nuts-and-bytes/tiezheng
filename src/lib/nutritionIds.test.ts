import {
  mealEstimateId,
  mealId,
  mealItemId,
  mealPhotoId,
  nutritionPlanId,
  operationKey,
} from './nutritionIds';

test('nutrition plan id uses the validated date key', () => {
  expect(nutritionPlanId('2026-08-14')).toBe('nutrition-plan:2026-08-14');
});

test('meal id includes date and slot', () => {
  expect(mealId('2026-08-14', 'lunch')).toBe('meal:2026-08-14:lunch');
});

test('photo and estimate ids prefix the meal id', () => {
  const lunchId = mealId('2026-08-14', 'lunch');
  expect(mealPhotoId(lunchId)).toBe(`meal-photo:${lunchId}`);
  expect(mealEstimateId(lunchId)).toBe(`meal-estimate:${lunchId}`);
});

test('meal item id prefixes the operation id', () => {
  expect(mealItemId('operation-1')).toBe('meal-item:operation-1');
});

test('operation key returns a valid operation id unchanged', () => {
  expect(operationKey('operation-1')).toBe('operation-1');
});

test('date keys must use YYYY-MM-DD', () => {
  expect(() => nutritionPlanId('2026/08/14')).toThrow('YYYY-MM-DD');
});

test('date keys must be real calendar dates', () => {
  expect(() => mealId('2026-02-30', 'lunch')).toThrow('calendar date');
});

test.each(['', 'a'.repeat(129), 'bad/id'])('rejects invalid operation id %j', (operationId) => {
  expect(() => mealItemId(operationId)).toThrow('operation id');
});
