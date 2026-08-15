import {
  foodRow,
  mealEstimateRow,
  mealItemRow,
  mealPhotoRow,
  mealRow,
  nutritionPlanRow,
} from '../test/nutritionFixtures';
import type { MealEstimateConsentBinding } from './nutritionTypes';
import { buildMealSnapshotHash } from './mealSnapshot';

test('nutrition fixtures preserve the exact persistence contract', () => {
  const food = foodRow();
  const item = mealItemRow();
  const photo = mealPhotoRow();
  const consent: MealEstimateConsentBinding | null = mealEstimateRow().consent;

  expect(nutritionPlanRow().equationVersion).toBe('NASEM-2023-adult-EER');
  expect(food.conversionAssumptions).toEqual([
    'USDA cooked edible portion already reported per 100 g',
  ]);
  expect(item).toMatchObject({
    energyKcal: 130,
    proteinG: 2.69,
    energyKcalLow: 195,
    energyKcalHigh: 195,
    proteinGLow: 4.035,
    proteinGHigh: 4.035,
    assumptions: ['用户确认可食部 g'],
  });
  expect(photo.size).toBe(photo.thumbnail.size);
  expect(consent?.requestId).toBe('request-fixture-1');
});

test('snapshot hash is a SHA-256 hex digest', async () => {
  const hash = await buildMealSnapshotHash(mealRow(), [mealItemRow()]);
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
});

test('items are ordered by order before hashing', async () => {
  const first = mealItemRow({ id: 'meal-item:first', order: 0 });
  const second = mealItemRow({ id: 'meal-item:second', order: 1 });

  await expect(buildMealSnapshotHash(mealRow(), [second, first])).resolves.toBe(
    await buildMealSnapshotHash(mealRow(), [first, second]),
  );
});

test('same-order item ids use a locale-independent comparator', async () => {
  const localeCompare = vi
    .spyOn(String.prototype, 'localeCompare')
    .mockImplementation(() => {
      throw new Error('localeCompare must not be used');
    });

  try {
    const upper = mealItemRow({ id: 'meal-item:A', order: 0 });
    const lower = mealItemRow({ id: 'meal-item:a', order: 0 });
    await expect(buildMealSnapshotHash(mealRow(), [lower, upper])).resolves.toMatch(
      /^[0-9a-f]{64}$/,
    );
  } finally {
    localeCompare.mockRestore();
  }
});

test('soft-deleted items do not affect the snapshot', async () => {
  const active = mealItemRow({ id: 'meal-item:active' });
  const deleted = mealItemRow({ id: 'meal-item:deleted', deletedAt: 1723568400001 });
  const withoutDeleted = await buildMealSnapshotHash(mealRow(), [active]);
  const withDeleted = await buildMealSnapshotHash(mealRow(), [deleted, active]);

  expect(withDeleted).toBe(withoutDeleted);
});

test('updatedAt changes do not affect the snapshot', async () => {
  const original = await buildMealSnapshotHash(mealRow(), [mealItemRow()]);
  const updated = await buildMealSnapshotHash(
    mealRow({ updatedAt: 1723568409999 }),
    [mealItemRow({ updatedAt: 1723568409999 })],
  );

  expect(updated).toBe(original);
});

test('item property insertion order does not affect the snapshot', async () => {
  const first = mealItemRow();
  const reversed = Object.fromEntries(Object.entries(first).reverse()) as typeof first;

  await expect(buildMealSnapshotHash(mealRow(), [reversed])).resolves.toBe(
    await buildMealSnapshotHash(mealRow(), [first]),
  );
});

test('amount changes affect the snapshot', async () => {
  const original = await buildMealSnapshotHash(mealRow(), [mealItemRow()]);
  const changed = await buildMealSnapshotHash(mealRow(), [mealItemRow({ amount: 151 })]);

  expect(changed).not.toBe(original);
});

test('conversion assumptions affect the snapshot', async () => {
  const original = await buildMealSnapshotHash(mealRow(), [mealItemRow()]);
  const changed = await buildMealSnapshotHash(mealRow(), [
    mealItemRow({ conversionAssumptions: ['different conversion'] }),
  ]);

  expect(changed).not.toBe(original);
});
