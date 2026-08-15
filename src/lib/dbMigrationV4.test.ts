import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { foodRow, mealRow } from '../test/nutritionFixtures';

const V1_STORES = {
  workouts: 'id, date, updatedAt',
  workoutItems: 'id, workoutId, exerciseId, updatedAt',
  exercises: 'id, bodyPart, updatedAt',
  weightLogs: 'id, date, updatedAt',
  photos: 'id, date, updatedAt',
  profile: 'id',
};

const V3_DEFAULT_PROFILE = {
  id: 'me',
  weeklyGoal: 4,
  onboarded: false,
  updatedAt: 0,
};

type LegacySnapshot = Record<
  'workouts' | 'workoutItems' | 'exercises' | 'weightLogs' | 'photos' | 'profile',
  unknown[]
>;

let opened: Dexie | null = null;

async function wipe() {
  opened?.close();
  opened = null;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('tiezheng');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('删除测试数据库失败'));
    request.onblocked = () => reject(new Error('删除测试数据库被未关闭的连接阻塞'));
  });
}

beforeEach(async () => {
  await wipe();
  vi.resetModules();
});
afterEach(wipe);

async function seedLegacyV2() {
  const legacyV2 = new Dexie('tiezheng');
  legacyV2.version(1).stores(V1_STORES);
  legacyV2.version(2).upgrade(() => {});
  await legacyV2.open();

  try {
    await legacyV2.transaction('rw', legacyV2.tables, async () => {
      await legacyV2.table('workouts').put({
        id: 'legacy-workout',
        date: '2026-08-13',
        note: '原样保留',
        updatedAt: 11,
        deletedAt: null,
      });
      await legacyV2.table('workoutItems').put({
        id: 'legacy-workout-item',
        workoutId: 'legacy-workout',
        exerciseId: 'legacy-exercise',
        order: 0,
        sets: [{ weight: 80, reps: 5 }],
        updatedAt: 12,
        deletedAt: null,
      });
      await legacyV2.table('exercises').put({
        id: 'legacy-exercise',
        name: '卧推',
        bodyPart: 'chest',
        loadMode: 'external',
        preset: false,
        updatedAt: 13,
        deletedAt: null,
      });
      await legacyV2.table('weightLogs').put({
        id: 'legacy-weight',
        date: '2026-08-13',
        weightKg: 80.5,
        updatedAt: 14,
        deletedAt: null,
      });
      await legacyV2.table('photos').put({
        id: 'legacy-photo',
        date: '2026-08-13',
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
        size: 3,
        updatedAt: 15,
        deletedAt: null,
      });
      await legacyV2.table('profile').put({
        id: 'me',
        weeklyGoal: 5,
        nickname: '旧用户',
        updatedAt: 16,
      });
    });

    expect(await legacyV2.table('profile').get('me')).toEqual({
      id: 'me',
      weeklyGoal: 5,
      nickname: '旧用户',
      updatedAt: 16,
    });
  } finally {
    legacyV2.close();
  }
}

async function upgradeToLegacyV3AndCapture(): Promise<LegacySnapshot> {
  const legacyV3 = new Dexie('tiezheng');
  legacyV3.version(1).stores(V1_STORES);
  legacyV3.version(2).upgrade(() => {});
  legacyV3.version(3).upgrade(async (tx) => {
    if ((await tx.table('workouts').count()) === 0) return;
    const current = await tx.table('profile').get('me');
    await tx.table('profile').put({
      ...V3_DEFAULT_PROFILE,
      ...current,
      id: 'me',
      onboarded: true,
      updatedAt: Date.now(),
    });
  });
  await legacyV3.open();

  try {
    expect(await legacyV3.table('profile').get('me')).toMatchObject({
      weeklyGoal: 5,
      nickname: '旧用户',
      onboarded: true,
    });

    const entries = await Promise.all(
      legacyV3.tables.map(async (table) => [table.name, await table.toArray()] as const),
    );
    return Object.fromEntries(entries) as LegacySnapshot;
  } finally {
    legacyV3.close();
  }
}

async function openCurrent() {
  const { db } = await import('./db');
  opened = db;
  await db.open();
  return db;
}

test('v3 升级到 v4 不改写旧六表，新六表为空且可写', async () => {
  await seedLegacyV2();
  const before = await upgradeToLegacyV3AndCapture();
  const current = await openCurrent();

  expect(await current.workouts.toArray()).toEqual(before.workouts);
  expect(await current.workoutItems.toArray()).toEqual(before.workoutItems);
  expect(await current.exercises.toArray()).toEqual(before.exercises);
  expect(await current.weightLogs.toArray()).toEqual(before.weightLogs);
  expect(await current.photos.toArray()).toEqual(before.photos);
  expect(await current.profile.toArray()).toEqual(before.profile);

  expect(await current.nutritionPlans.count()).toBe(0);
  expect(await current.foods.count()).toBe(0);
  expect(await current.meals.count()).toBe(0);
  expect(await current.mealItems.count()).toBe(0);
  expect(await current.mealPhotos.count()).toBe(0);
  expect(await current.mealEstimates.count()).toBe(0);

  await current.foods.put(foodRow());
  await current.meals.put(mealRow());
  expect(await current.foods.count()).toBe(1);
  expect(await current.meals.count()).toBe(1);
});

test('直接新建v4库拥有全部十二张表，新用户仍未完成引导', async () => {
  const current = await openCurrent();
  const { getProfile } = await import('../repos/profileRepo');

  expect(current.tables.map((table) => table.name).sort()).toEqual([
    'exercises',
    'foods',
    'mealEstimates',
    'mealItems',
    'mealPhotos',
    'meals',
    'nutritionPlans',
    'photos',
    'profile',
    'weightLogs',
    'workoutItems',
    'workouts',
  ]);
  expect((await getProfile()).onboarded).toBe(false);
});
