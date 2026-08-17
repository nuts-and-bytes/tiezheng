import Dexie from 'dexie';
import { db } from './db';
import { buildMealSnapshotHash } from './mealSnapshot';
import type { NutritionBackupSection } from './nutritionBackup';
import type { Food, Meal, MealItem, NutritionPlan } from './nutritionTypes';
import { stableJson } from './stableJson';

export type NutritionRestoreMode = 'merge' | 'replace';

export interface NutritionRestorePlan {
  fingerprint: string;
  photoIdsToDelete: string[];
  estimateIdsToDelete: string[];
}

type InvalidBackup = (message: string) => never;

const CUSTOM_FOOD_ID = /^food:custom:[A-Za-z0-9_-]{1,128}$/;
const MEAL_ITEM_ID = /^meal-item:[A-Za-z0-9_-]{1,128}$/;

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

const NUTRITION_WRITE_TABLE_NAMES = [
  'nutritionPlans',
  'foods',
  'meals',
  'mealItems',
  'mealPhotos',
  'mealEstimates',
] as const;

function hasAppTransaction(
  requiredTableNames: readonly string[],
  requireWrite: boolean,
): boolean {
  const transaction = Dexie.currentTransaction;
  if (
    transaction === null
    || transaction.db.backendDB() !== db.backendDB()
    || (requireWrite && transaction.mode !== 'readwrite')
  ) {
    return false;
  }
  const storeNames = new Set(transaction.storeNames);
  return requiredTableNames.every((name) => storeNames.has(name));
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedById<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => compareIds(left.id, right.id));
}

function assertUniqueIds(
  rows: ReadonlyArray<{ id: string }>,
  label: string,
  invalid: InvalidBackup,
): void {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    invalid(`${label} ID 存在重复值`);
  }
}

function assertCandidateReferences(
  section: NutritionBackupSection,
  invalid: InvalidBackup,
): void {
  if (
    section === null
    || typeof section !== 'object'
    || !Array.isArray(section.nutritionPlans)
    || !Array.isArray(section.foods)
    || !Array.isArray(section.meals)
    || !Array.isArray(section.mealItems)
  ) {
    invalid('营养备份格式不正确');
  }

  assertUniqueIds(section.nutritionPlans, '营养计划', invalid);
  assertUniqueIds(section.foods, '自定义食物', invalid);
  assertUniqueIds(section.meals, '餐次', invalid);
  assertUniqueIds(section.mealItems, '餐食条目', invalid);

  for (const plan of section.nutritionPlans) {
    if (plan.id !== `nutrition-plan:${plan.effectiveFrom}`) {
      invalid('营养计划 ID 与生效日期不一致');
    }
  }
  for (const food of section.foods) {
    if (!CUSTOM_FOOD_ID.test(food.id)) {
      invalid('自定义食物 ID 必须使用 food:custom: 命名空间');
    }
  }
  const mealKeys = new Set<string>();
  for (const meal of section.meals) {
    if (meal.id !== `meal:${meal.date}:${meal.slot}`) {
      invalid('餐次 ID 与日期和餐次不一致');
    }
    const key = `${meal.date}:${meal.slot}`;
    if (mealKeys.has(key)) invalid('日期和餐次存在重复值');
    mealKeys.add(key);
  }
  const mealIds = new Set(section.meals.map((meal) => meal.id));
  for (const item of section.mealItems) {
    if (!MEAL_ITEM_ID.test(item.id)) {
      invalid('餐食条目 ID 命名空间或操作键不正确');
    }
    if (!mealIds.has(item.mealId)) invalid('餐食条目引用了不存在的餐次');
  }
}

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
  for (const meal of sortedById(section.meals)) {
    const completeMeal: Meal = { ...meal, updatedAt: 0, deletedAt: null };
    const completeItems: MealItem[] = [...(itemsByMeal.get(meal.id) ?? [])]
      .sort((left, right) => left.order - right.order || compareIds(left.id, right.id))
      .map((item) => ({ ...item, updatedAt: 0, deletedAt: null }));
    hashes.set(meal.id, await buildMealSnapshotHash(completeMeal, completeItems));
  }
  return hashes;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('餐食缩略图无法读取'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('餐食缩略图未解码为字节'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

async function thumbnailFingerprint(thumbnail: Blob) {
  if (!hasAppTransaction(restoreTables().map((table) => table.name), false)) {
    throw new Error('餐食缩略图指纹必须在 Dexie 事务内计算');
  }
  const sha256 = await Dexie.waitFor((async () => {
    const bytes = await readBlob(thumbnail);
    return hex(await crypto.subtle.digest('SHA-256', bytes));
  })());
  return { type: thumbnail.type, size: thumbnail.size, sha256 };
}

async function snapshotRestoreLocalState() {
  if (!hasAppTransaction(restoreTables().map((table) => table.name), false)) {
    throw new Error('恢复状态指纹必须在 Dexie 事务内计算');
  }
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

function normalizedCandidate(section: NutritionBackupSection) {
  return {
    nutritionPlans: sortedById(section.nutritionPlans),
    foods: sortedById(section.foods),
    meals: sortedById(section.meals),
    mealItems: sortedById(section.mealItems),
  };
}

export async function calculateNutritionRestorePlan(
  section: NutritionBackupSection,
  mode: NutritionRestoreMode,
  incomingHashes: Map<string, string>,
): Promise<NutritionRestorePlan> {
  if (!hasAppTransaction(restoreTables().map((table) => table.name), false)) {
    throw new Error('营养恢复计划必须在调用方只读或写事务内计算');
  }
  const [photos, estimates, localState] = await Promise.all([
    db.mealPhotos.toArray(),
    db.mealEstimates.toArray(),
    snapshotRestoreLocalState(),
  ]);
  const incomingMealIds = new Set(section.meals.map((meal) => meal.id));
  const photoIdsToDelete = photos
    .filter((photo) => {
      const incomingHash = incomingHashes.get(photo.mealId);
      if (incomingHash !== undefined) return incomingHash !== photo.mealSnapshotHash;
      return mode === 'replace';
    })
    .map((photo) => photo.id)
    .sort(compareIds);
  const estimateIdsToDelete = estimates
    .filter((estimate) => mode === 'replace' || incomingMealIds.has(estimate.mealId))
    .map((estimate) => estimate.id)
    .sort(compareIds);

  return {
    fingerprint: stableJson({
      version: 'nutrition-restore-preview-v2',
      mode,
      candidate: normalizedCandidate(section),
      incomingMealHashes: [...incomingHashes.entries()]
        .sort(([left], [right]) => compareIds(left, right)),
      photoIdsToDelete,
      estimateIdsToDelete,
      localState,
    }),
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
    restoreTables(),
    () => calculateNutritionRestorePlan(section, mode, incomingHashes),
  );
}

function currentFoodIdentity(current: Food) {
  const { preset: _preset, updatedAt: _updatedAt, deletedAt: _deletedAt, ...identity } = current;
  void _preset;
  void _updatedAt;
  void _deletedAt;
  return identity;
}

export async function assertNutritionMergeIdSafety(
  section: NutritionBackupSection,
  mode: NutritionRestoreMode,
  invalid: InvalidBackup,
): Promise<void> {
  assertCandidateReferences(section, invalid);
  const [currentFoods, currentPlans, currentMeals, currentItems] = await Promise.all([
    db.foods.bulkGet(section.foods.map((food) => food.id)),
    db.nutritionPlans.toArray(),
    db.meals.toArray(),
    db.mealItems.bulkGet(section.mealItems.map((item) => item.id)),
  ]);

  for (const [index, current] of currentFoods.entries()) {
    if (current === undefined) continue;
    if (current.preset) invalid('备份自定义食物 ID 与本机预设食物冲突');
    if (
      mode === 'merge'
      && stableJson(currentFoodIdentity(current)) !== stableJson(section.foods[index])
    ) {
      invalid('备份自定义食物 ID 与本机不同食物业务身份冲突');
    }
  }

  if (mode === 'replace') return;

  for (const incoming of section.nutritionPlans) {
    const conflicts = currentPlans.some((current) =>
      (current.id === incoming.id && current.effectiveFrom !== incoming.effectiveFrom)
      || (current.effectiveFrom === incoming.effectiveFrom && current.id !== incoming.id));
    if (conflicts) {
      invalid('备份营养计划 ID 与本机不同计划业务身份冲突');
    }
  }

  const mealsById = new Map(currentMeals.map((meal) => [meal.id, meal]));
  const mealsByDateSlot = new Map(
    currentMeals.map((meal) => [`${meal.date}:${meal.slot}`, meal]),
  );
  for (const incoming of section.meals) {
    const sameId = mealsById.get(incoming.id);
    const sameDateSlot = mealsByDateSlot.get(`${incoming.date}:${incoming.slot}`);
    const current = sameId ?? sameDateSlot;
    if (
      current !== undefined
      && (
        current.id !== incoming.id
        || current.date !== incoming.date
        || current.slot !== incoming.slot
      )
    ) {
      invalid('备份餐次 ID 与本机不同餐次业务身份冲突');
    }
  }

  for (const [index, current] of currentItems.entries()) {
    if (current === undefined) continue;
    const incoming = section.mealItems[index];
    if (current.mealId !== incoming.mealId) {
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
  if (!hasAppTransaction(NUTRITION_WRITE_TABLE_NAMES, true)) {
    throw new Error('营养恢复必须在调用方事务内执行');
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('营养恢复时间必须是非负安全整数');
  }
  await assertNutritionMergeIdSafety(section, mode, (message) => {
    throw new Error(message);
  });

  const incomingMealIds = section.meals.map((meal) => meal.id).sort(compareIds);
  const nutritionPlans: NutritionPlan[] = section.nutritionPlans
    .map((row) => ({ ...row, updatedAt: now, deletedAt: null }))
    .sort(
      (left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom)
        || compareIds(left.id, right.id),
    );
  const foods: Food[] = section.foods
    .map((row) => ({ ...row, preset: false, updatedAt: now, deletedAt: null }))
    .sort((left, right) => compareIds(left.id, right.id));
  const meals: Meal[] = section.meals
    .map((row) => ({ ...row, updatedAt: now, deletedAt: null }))
    .sort((left, right) => compareIds(left.id, right.id));
  const mealItems: MealItem[] = section.mealItems
    .map((row) => ({ ...row, updatedAt: now, deletedAt: null }))
    .sort(
      (left, right) => compareIds(left.mealId, right.mealId)
        || left.order - right.order
        || compareIds(left.id, right.id),
    );
  const customFoodIds = mode === 'replace'
    ? (await db.foods.toArray())
      .filter((food) => !food.preset)
      .map((food) => food.id)
      .sort(compareIds)
    : [];

  if (plan.photoIdsToDelete.length > 0) {
    await db.mealPhotos.bulkDelete([...plan.photoIdsToDelete].sort(compareIds));
  }
  if (plan.estimateIdsToDelete.length > 0) {
    await db.mealEstimates.bulkDelete([...plan.estimateIdsToDelete].sort(compareIds));
  }

  if (mode === 'replace') {
    await db.mealItems.clear();
    await db.meals.clear();
    await db.nutritionPlans.clear();
    if (customFoodIds.length > 0) await db.foods.bulkDelete(customFoodIds);
  } else if (incomingMealIds.length > 0) {
    await db.mealItems.where('mealId').anyOf(incomingMealIds).delete();
    await db.meals.bulkDelete(incomingMealIds);
  }

  if (nutritionPlans.length > 0) await db.nutritionPlans.bulkPut(nutritionPlans);
  if (foods.length > 0) await db.foods.bulkPut(foods);
  if (meals.length > 0) await db.meals.bulkPut(meals);
  if (mealItems.length > 0) await db.mealItems.bulkPut(mealItems);
}
