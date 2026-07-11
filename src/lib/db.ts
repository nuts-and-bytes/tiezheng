import Dexie, { type EntityTable } from 'dexie';
import type { Exercise, Photo, Profile, WeightLog, Workout, WorkoutItem } from './types';
import { sanitizeSets } from './validation';

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
