export type BodyPart = 'chest' | 'shoulder' | 'back' | 'leg' | 'arm' | 'core' | 'cardio';

/** 一组：重量/次数均选填（规格 §5：组数必填、重量次数选填） */
export interface SetEntry {
  weight?: number;
  reps?: number;
}

export interface Workout {
  id: string;
  date: string; // YYYY-MM-DD，每天最多一条有效记录
  note?: string;
  updatedAt: number;
  deletedAt: number | null;
}

export interface WorkoutItem {
  id: string;
  workoutId: string;
  exerciseId: string;
  order: number;
  sets: SetEntry[]; // 组数 = 数组长度
  updatedAt: number;
  deletedAt: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  bodyPart: BodyPart;
  preset: boolean; // true=系统预置，不可改名/删除
  updatedAt: number;
  deletedAt: number | null;
}

export interface WeightLog {
  id: string;
  date: string; // 每天最多一条有效记录
  weightKg: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Photo {
  id: string;
  date: string; // 每天最多一张有效照片
  blob: Blob;
  size: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Profile {
  id: string; // 恒为 'me'
  weeklyGoal: number; // 默认 4
  nickname?: string;
  onboarded: boolean;
  updatedAt: number;
}
