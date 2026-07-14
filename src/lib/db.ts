import Dexie, { type EntityTable } from 'dexie';
import type { Exercise, Photo, Profile, WeightLog, Workout, WorkoutItem } from './types';
import { sanitizeSets } from './validation';

/** 单一出处：v3 迁移和 profileRepo 都要它，放在这里避免 repo → db 的反向依赖。 */
export const DEFAULT_PROFILE: Profile = { id: 'me', weeklyGoal: 4, onboarded: false, updatedAt: 0 };

export const db = new Dexie('tiezheng') as Dexie & {
  workouts: EntityTable<Workout, 'id'>;
  workoutItems: EntityTable<WorkoutItem, 'id'>;
  exercises: EntityTable<Exercise, 'id'>;
  weightLogs: EntityTable<WeightLog, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  profile: EntityTable<Profile, 'id'>;
};

db.version(1).stores({
  workouts: 'id, date, updatedAt',
  workoutItems: 'id, workoutId, exerciseId, updatedAt',
  exercises: 'id, bodyPart, updatedAt',
  weightLogs: 'id, date, updatedAt',
  photos: 'id, date, updatedAt',
  profile: 'id',
});

// v1 时期 sanitizeSets 允许空组 {} 入库（默认三行的残留），虚增总组数；
// 重新清洗存量数据（全空 = 徒手只记组数，保留）
db.version(2).upgrade((tx) =>
  tx
    .table<WorkoutItem>('workoutItems')
    .toCollection()
    .modify((item) => {
      item.sets = sanitizeSets(item.sets);
    }),
);

/**
 * 首开引导（v3 新增）靠 profile.onboarded 门控，而 v2 之前的 profile 记录里没有这个字段。
 * `!profile.onboarded` 对 undefined 为真 —— 一个练了半年的老用户升级后会被推一遍四页引导，
 * 而引导最后那句 saveProfile({ weeklyGoal, onboarded: true }) 还会用引导页的默认值
 * 覆盖掉他原来的每周目标。
 *
 * 「是不是新人」的真值不在这个布尔字段里，在于他有没有练过。据此补字段。
 *
 * upgrade 只对「从旧版本升上来」的库执行；全新库直接建到最新 schema、跳过 upgrade——
 * 所以新用户照常看引导。这条假设由 dbMigrationV3.test.ts 钉住，别把它当常识。
 */
db.version(3).upgrade(async (tx) => {
  if ((await tx.table('workouts').count()) === 0) return; // 装了没练过 —— 他确实该看引导
  const cur = await tx.table<Profile>('profile').get('me');
  await tx.table<Profile>('profile').put({
    ...DEFAULT_PROFILE,
    ...cur,
    id: 'me',
    onboarded: true,
    updatedAt: Date.now(),
  });
});
