import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

/* 首开引导是这次重构新加的，它靠 profile.onboarded 这个布尔字段门控。
   但线上那些库里的 profile 记录是重构之前写的——里面根本没有这个字段。
   `!profile.onboarded` 对 undefined 为真，于是一个练了半年的老用户升级后
   会被当成新人，推一遍四页引导；而引导最后那句
   saveProfile({ weeklyGoal: goal, onboarded: true })
   还会拿引导页的默认值把他原来的每周目标覆盖掉。

   "是不是新人" 的真值不在这个布尔字段里，在于他有没有练过。v3 迁移据此补字段。 */

const V1_STORES = {
  workouts: 'id, date, updatedAt',
  workoutItems: 'id, workoutId, exerciseId, updatedAt',
  exercises: 'id, bodyPart, updatedAt',
  weightLogs: 'id, date, updatedAt',
  photos: 'id, date, updatedAt',
  profile: 'id',
};

let opened: Dexie | null = null;

async function wipe() {
  opened?.close();
  opened = null;
  await new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase('tiezheng');
    r.onsuccess = r.onerror = r.onblocked = () => res();
  });
}

beforeEach(async () => {
  await wipe();
  vi.resetModules(); // db 是模块单例；每个场景都要一个新实例去跑 upgrade
});
afterEach(wipe);

/** 造一个「升级前」的库：schema 停在 v2，profile 记录里没有 onboarded。 */
async function legacyDb(fill: (t: Dexie) => Promise<void>) {
  const old = new Dexie('tiezheng');
  old.version(1).stores(V1_STORES);
  old.version(2).upgrade(() => {});
  await old.open();
  await fill(old);
  old.close();
}

/** 用当前代码打开这个库（触发 upgrade），读出档案。 */
async function openCurrent() {
  const { db } = await import('./db');
  const { getProfile } = await import('../repos/profileRepo');
  opened = db;
  await db.open();
  return getProfile();
}

test('老用户练过 → 升级后直接进 app，原来的每周目标不被引导覆盖', async () => {
  await legacyDb(async (t) => {
    await t.table('workouts').put({ id: 'w1', date: '2026-06-01', updatedAt: 1 });
    await t.table('profile').put({ id: 'me', weeklyGoal: 5, updatedAt: 1 }); // 没有 onboarded
  });

  const p = await openCurrent();
  expect(p.onboarded).toBe(true);
  expect(p.weeklyGoal).toBe(5);
});

test('老用户练过但从没存过 profile → 也算已引导', async () => {
  await legacyDb(async (t) => {
    await t.table('workouts').put({ id: 'w1', date: '2026-06-01', updatedAt: 1 });
  });

  const p = await openCurrent();
  expect(p.onboarded).toBe(true);
  expect(p.weeklyGoal).toBe(4);
});

/* 整个方案立在这条假设上：upgrade 只对「从旧版本升上来」的库跑，
   全新库直接建到最新 schema、跳过所有 upgrade。假设一旦不成立，
   新用户就永远看不到引导——那正是引导本身被 v3 迁移吃掉。 */
test('全新用户（没有旧库）→ 照常走引导', async () => {
  const p = await openCurrent();
  expect(p.onboarded).toBe(false);
});

/* 装了但一次都没练：他确实没用过这个 app，该看引导。
   顺带钉住归一化——IndexedDB 不强制 schema，读出来的记录是不可信输入，
   而类型声明说 onboarded 是 boolean。这个谎言不能带进 UI。 */
test('老库但零训练记录 → 仍然走引导，且 onboarded 是 false 不是 undefined', async () => {
  await legacyDb(async (t) => {
    await t.table('profile').put({ id: 'me', weeklyGoal: 3, updatedAt: 1 });
  });

  const p = await openCurrent();
  expect(p.onboarded).toBe(false);
  expect(typeof p.onboarded).toBe('boolean');
  expect(p.weeklyGoal).toBe(3);
});
