import { Blob as NodeBlob } from 'node:buffer';
import Dexie from 'dexie';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { DB_V4_STORES, type NutritionDb } from './db';

const V3_STORES = {
  workouts: 'id, date, updatedAt',
  workoutItems: 'id, workoutId, exerciseId, updatedAt',
  exercises: 'id, bodyPart, updatedAt',
  weightLogs: 'id, date, updatedAt',
  photos: 'id, date, updatedAt',
  profile: 'id',
};

// Dexie 把公开版本号乘以 10 写入 IndexedDB：v3=30、v4=40。
const IDB_V3_VERSION = 30;
const IDB_V4_VERSION = 40;

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const opened = new Set<Dexie>();
const rawConnections = new Set<IDBDatabase>();
const databaseNames = new Set<string>();
let databaseSequence = 0;

function databaseName(label: string): string {
  const name = `tiezheng-db-version-race-${runId}-${label}-${++databaseSequence}`;
  databaseNames.add(name);
  return name;
}

function track<T extends Dexie>(database: T): T {
  opened.add(database);
  return database;
}

function bounded<T>(promise: PromiseLike<T>, label: string, timeoutMs = 1_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function deleteDatabase(name: string): Promise<void> {
  return bounded(
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error(`删除测试数据库 ${name} 失败`));
      request.onblocked = () => reject(new Error(`删除测试数据库 ${name} 被连接阻塞`));
    }),
    `删除测试数据库 ${name}`,
  );
}

async function wipe(): Promise<void> {
  for (const connection of rawConnections) connection.close();
  rawConnections.clear();
  for (const database of opened) database.close();
  opened.clear();
  const names = [...databaseNames];
  databaseNames.clear();
  await Promise.all(names.map(deleteDatabase));
}

beforeAll(() => vi.stubGlobal('Blob', NodeBlob));
afterAll(() => vi.unstubAllGlobals());
beforeEach(wipe);
afterEach(wipe);

function currentDatabase(name: string): NutritionDb {
  const database = track(new Dexie(name) as NutritionDb);
  database.version(4).stores(DB_V4_STORES);
  return database;
}

async function seedLegacyV3(name: string) {
  const old = track(new Dexie(name));
  old.version(3).stores(V3_STORES);
  await bounded(old.open(), '打开 v3 数据库');
  const workout = {
    id: 'w-before-upgrade',
    date: '2026-08-13',
    note: '升级前训练',
    updatedAt: 1,
    deletedAt: null,
  };
  const workoutItem = {
    id: 'wi-before-upgrade',
    workoutId: workout.id,
    exerciseId: 'e-before-upgrade',
    order: 0,
    sets: [{ weight: 80, reps: 8 }],
    updatedAt: 2,
    deletedAt: null,
  };
  const exercise = {
    id: 'e-before-upgrade',
    name: '升级前划船',
    bodyPart: 'back',
    loadMode: 'external',
    preset: false,
    updatedAt: 3,
    deletedAt: null,
  };
  const weightLog = {
    id: 'weight-before-upgrade',
    date: '2026-08-13',
    weightKg: 72.5,
    updatedAt: 4,
    deletedAt: null,
  };
  const photo = {
    id: 'photo-before-upgrade',
    date: '2026-08-13',
    blob: new Blob(['body-photo'], { type: 'image/jpeg' }),
    size: 10,
    updatedAt: 5,
    deletedAt: null,
  };
  const profile = {
    id: 'me',
    weeklyGoal: 5,
    nickname: '升级前',
    onboarded: true,
    updatedAt: 6,
  };

  try {
    await bounded(
      old.transaction('rw', old.tables, async () => {
        await old.table('workouts').put(workout);
        await old.table('workoutItems').put(workoutItem);
        await old.table('exercises').put(exercise);
        await old.table('weightLogs').put(weightLog);
        await old.table('photos').put(photo);
        await old.table('profile').put(profile);
      }),
      '写入 v3 代表数据',
    );
  } finally {
    old.close();
  }

  return { workout, workoutItem, exercise, weightLog, photo, profile };
}

function openRawV3(name: string): Promise<IDBDatabase> {
  return bounded(
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, IDB_V3_VERSION);
      request.onsuccess = () => {
        rawConnections.add(request.result);
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('打开原始 v3 连接失败'));
      request.onblocked = () => reject(new Error('打开原始 v3 连接被阻塞'));
    }),
    '打开原始 v3 连接',
  );
}

function closeRaw(connection: IDBDatabase): void {
  connection.close();
  rawConnections.delete(connection);
}

async function readBlobSnapshot(blob: Blob): Promise<{
  bytes: number[];
  size: number;
  type: string;
}> {
  const buffer =
    typeof blob.arrayBuffer === 'function'
      ? await bounded(blob.arrayBuffer(), '读取体型照字节')
      : await bounded(
          new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (reader.result instanceof ArrayBuffer) resolve(reader.result);
              else reject(new Error('读取体型照未返回字节'));
            };
            reader.onerror = () => reject(reader.error ?? new Error('读取体型照失败'));
            reader.readAsArrayBuffer(blob);
          }),
          '读取体型照字节',
        );
  return {
    bytes: Array.from(new Uint8Array(buffer)),
    size: blob.size,
    type: blob.type,
  };
}

async function expectLegacyRowsUnchanged(
  database: NutritionDb,
  rows: Awaited<ReturnType<typeof seedLegacyV3>>,
): Promise<void> {
  expect(
    await bounded(database.workouts.get(rows.workout.id), '读取升级后训练'),
  ).toEqual(rows.workout);
  expect(
    await bounded(database.workoutItems.get(rows.workoutItem.id), '读取升级后训练项'),
  ).toEqual(rows.workoutItem);
  expect(
    await bounded(database.exercises.get(rows.exercise.id), '读取升级后动作'),
  ).toEqual(rows.exercise);
  expect(
    await bounded(database.weightLogs.get(rows.weightLog.id), '读取升级后体重'),
  ).toEqual(rows.weightLog);
  const upgradedPhoto = await bounded(database.photos.get(rows.photo.id), '读取升级后体型照');
  expect(upgradedPhoto).toMatchObject({
    id: rows.photo.id,
    date: rows.photo.date,
    size: rows.photo.size,
    updatedAt: rows.photo.updatedAt,
    deletedAt: rows.photo.deletedAt,
  });
  expect(await readBlobSnapshot(upgradedPhoto!.blob)).toEqual(
    await readBlobSnapshot(rows.photo.blob),
  );
  expect(
    await bounded(database.profile.get(rows.profile.id), '读取升级后用户资料'),
  ).toEqual(rows.profile);
}

async function expectNutritionTablesInitialized(database: NutritionDb): Promise<void> {
  await expect(
    bounded(
      Promise.all([
        database.nutritionPlans.count(),
        database.foods.count(),
        database.meals.count(),
        database.mealItems.count(),
        database.mealPhotos.count(),
        database.mealEstimates.count(),
      ]),
      '读取升级后营养表行数',
    ),
  ).resolves.toEqual([0, 0, 0, 0, 0, 0]);
  expectCurrentTableNames(database);
}

function expectCurrentTableNames(database: Dexie): void {
  expect(database.tables.map((table) => table.name).sort()).toEqual([
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
}

test('v3 标签页收到 versionchange 后只关闭旧连接，v4 升级且旧六表不变', async () => {
  const name = databaseName('versionchange');
  const rows = await seedLegacyV3(name);
  const stale = await openRawV3(name);
  let versionchangeEvents = 0;
  stale.onversionchange = () => {
    versionchangeEvents += 1;
    closeRaw(stale);
  };

  const current = currentDatabase(name);
  let blockedEvents = 0;
  current.on('blocked', () => {
    blockedEvents += 1;
  });
  await bounded(current.open(), 'v4 versionchange 升级');

  expect(versionchangeEvents).toBe(1);
  expect(blockedEvents).toBe(0);
  expect(current.name).toBe(name);
  await expectLegacyRowsUnchanged(current, rows);
  await expectNutritionTablesInitialized(current);
});

test('v3 旧连接暂时阻塞 v4 时，关闭它后同一数据库有界完成升级', async () => {
  const name = databaseName('blocked');
  const rows = await seedLegacyV3(name);
  const stale = await openRawV3(name);
  let versionchangeEvents = 0;
  stale.onversionchange = () => {
    versionchangeEvents += 1;
  };

  const current = currentDatabase(name);
  let resolveBlocked!: () => void;
  const blocked = new Promise<void>((resolve) => {
    resolveBlocked = resolve;
  });
  let blockedEvents = 0;
  current.on('blocked', () => {
    blockedEvents += 1;
    resolveBlocked();
  });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const opening = Promise.resolve(current.open());
  void opening.catch(() => undefined);
  let blockedFailure: unknown;

  try {
    await bounded(blocked, 'v4 blocked 事件');
  } catch (error) {
    blockedFailure = error;
  } finally {
    closeRaw(stale);
  }
  try {
    await bounded(opening, '关闭旧连接后完成 v4 升级');
    if (blockedFailure !== undefined) throw blockedFailure;
    expect(versionchangeEvents).toBe(1);
    expect(blockedEvents).toBe(1);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(`Upgrade '${name}' blocked`));
  } finally {
    warning.mockRestore();
  }

  expect(current.name).toBe(name);
  await expectLegacyRowsUnchanged(current, rows);
  await expectNutritionTablesInitialized(current);
});

test('数据库已升到 v4 后不能降级，旧 v3 前端兼容打开也不丢 v4 数据', async () => {
  const name = databaseName('rollback');
  const current = currentDatabase(name);
  await bounded(current.open(), '打开 v4 数据库');
  await bounded(current.meals.put({
    id: 'meal:2026-08-14:lunch',
    date: '2026-08-14',
    slot: 'lunch',
    updatedAt: 1,
    deletedAt: null,
  }), '写入 v4 营养数据');
  current.close();

  await expect(bounded(
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, IDB_V3_VERSION);
      request.onsuccess = () => {
        request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('显式降级打开失败'));
      request.onblocked = () => reject(new Error('显式降级打开被阻塞'));
    }),
    '显式用 v3 版本打开 v4 数据库',
  )).rejects.toMatchObject({ name: 'VersionError' });

  // 计划原断言这里会拒绝为 VersionError；Dexie 4.4.4 实测会先不带版本号
  // 打开现有库，所以旧前端可以以六表视图继续运行；此测试修正该计划断言。
  // 关键是后端版本仍为 40，它不会把库降回 v3 或删除营养表。
  const oldFrontend = track(new Dexie(name));
  oldFrontend.version(3).stores(V3_STORES);
  await bounded(oldFrontend.open(), '旧 v3 前端兼容打开 v4 数据库');
  expect(oldFrontend.backendDB()?.version).toBe(IDB_V4_VERSION);
  expect(oldFrontend.tables.map((table) => table.name).sort()).toEqual(
    Object.keys(V3_STORES).sort(),
  );
  const legacyWrite = {
    id: 'workout:written-by-v3-client',
    date: '2026-08-15',
    note: '旧客户端兼容写入',
    updatedAt: 2,
    deletedAt: null,
  };
  await bounded(oldFrontend.table('workouts').put(legacyWrite), '旧 v3 前端写入训练');
  expect(await bounded(
    oldFrontend.table('workouts').get(legacyWrite.id),
    '旧 v3 前端读取训练',
  )).toEqual(legacyWrite);
  oldFrontend.close();

  const reopened = currentDatabase(name);
  await bounded(reopened.open(), '重新打开 v4 数据库');
  expect(reopened.backendDB()?.version).toBe(IDB_V4_VERSION);
  expect(await bounded(
    reopened.meals.get('meal:2026-08-14:lunch'),
    '重开 v4 后读取餐次',
  )).toBeDefined();
  expect(await bounded(
    reopened.workouts.get(legacyWrite.id),
    '重开 v4 后读取训练',
  )).toEqual(legacyWrite);
  expectCurrentTableNames(reopened);
  expect(reopened.name).toBe(name);
});
