import Dexie, { type EntityTable } from 'dexie';
import type { Exercise, Photo, Profile, WeightLog, Workout, WorkoutItem } from './types';

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
