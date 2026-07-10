import { db } from '../lib/db';
import { newId } from '../lib/ids';
import type { Exercise, SetEntry, Workout, WorkoutItem } from '../lib/types';

export interface DayItem extends WorkoutItem {
  exercise: Exercise;
}

export interface RangeItem {
  date: string;
  exerciseId: string;
  sets: SetEntry[];
}

export interface DraftItem {
  exerciseId: string;
  sets: SetEntry[];
}

export async function getWorkoutByDate(date: string): Promise<Workout | undefined> {
  const rows = await db.workouts.where('date').equals(date).toArray();
  return rows.find((w) => w.deletedAt === null);
}

export async function getOrCreateWorkout(date: string): Promise<Workout> {
  return await db.transaction('rw', db.workouts, async () => {
    const existing = await getWorkoutByDate(date);
    if (existing) return existing;
    const row: Workout = { id: newId(), date, updatedAt: Date.now(), deletedAt: null };
    await db.workouts.add(row);
    return row;
  });
}

async function activeItems(workoutId: string): Promise<WorkoutItem[]> {
  const rows = await db.workoutItems.where('workoutId').equals(workoutId).toArray();
  return rows
    .filter((i) => i.deletedAt === null)
    .sort((a, b) => a.order - b.order);
}

export async function addWorkoutItem(
  date: string,
  exerciseId: string,
  sets: SetEntry[],
): Promise<WorkoutItem> {
  const workout = await getOrCreateWorkout(date);
  const order = (await activeItems(workout.id)).length;
  const row: WorkoutItem = {
    id: newId(),
    workoutId: workout.id,
    exerciseId,
    order,
    sets,
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await db.workoutItems.add(row);
  return row;
}

export async function updateItemSets(id: string, sets: SetEntry[]): Promise<void> {
  await db.workoutItems.update(id, { sets, updatedAt: Date.now() });
}

/** 软删条目；若该日已无有效条目，连 workout 一起软删（日历不再亮格） */
export async function removeWorkoutItem(id: string): Promise<void> {
  return await db.transaction('rw', db.workoutItems, db.workouts, async () => {
    const item = await db.workoutItems.get(id);
    if (!item) return;
    await db.workoutItems.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
    const rest = await activeItems(item.workoutId);
    if (rest.length === 0) {
      await db.workouts.update(item.workoutId, { deletedAt: Date.now(), updatedAt: Date.now() });
    }
  });
}

export async function getDayItems(date: string): Promise<DayItem[]> {
  const workout = await getWorkoutByDate(date);
  if (!workout) return [];
  const items = await activeItems(workout.id);
  const exercises = await db.exercises.bulkGet(items.map((i) => i.exerciseId));
  return items.flatMap((item, idx) => {
    const exercise = exercises[idx];
    return exercise ? [{ ...item, exercise }] : [];
  });
}

export async function listWorkoutDates(from: string, to: string): Promise<string[]> {
  const rows = await db.workouts.where('date').between(from, to, true, true).toArray();
  return rows
    .filter((w) => w.deletedAt === null)
    .map((w) => w.date)
    .sort();
}

export async function listAllWorkoutDates(): Promise<string[]> {
  const rows = await db.workouts.toArray();
  return rows
    .filter((w) => w.deletedAt === null)
    .map((w) => w.date)
    .sort();
}

async function itemsOfWorkouts(workouts: Workout[]): Promise<RangeItem[]> {
  const active = workouts.filter((w) => w.deletedAt === null);
  if (active.length === 0) return [];
  const dateOf = new Map(active.map((w) => [w.id, w.date]));
  const items = await db.workoutItems
    .where('workoutId')
    .anyOf(active.map((w) => w.id))
    .toArray();
  return items
    .filter((i) => i.deletedAt === null)
    .map((i) => ({ date: dateOf.get(i.workoutId)!, exerciseId: i.exerciseId, sets: i.sets }));
}

export async function listItemsInRange(from: string, to: string): Promise<RangeItem[]> {
  const workouts = await db.workouts.where('date').between(from, to, true, true).toArray();
  return itemsOfWorkouts(workouts);
}

export async function listAllItems(): Promise<RangeItem[]> {
  return itemsOfWorkouts(await db.workouts.toArray());
}

/** 最近使用的动作 id，去重、最近在前（记录流「最近使用置顶」用） */
export async function listRecentExerciseIds(limit = 8): Promise<string[]> {
  const rows = await db.workoutItems.orderBy('updatedAt').reverse().limit(200).toArray();
  const seen: string[] = [];
  for (const row of rows) {
    if (row.deletedAt !== null) continue;
    if (!seen.includes(row.exerciseId)) seen.push(row.exerciseId);
    if (seen.length >= limit) break;
  }
  return seen;
}

/** 记录流「完成打卡」：0 组的条目直接丢弃 */
export async function commitDraft(items: DraftItem[], date: string): Promise<void> {
  return await db.transaction('rw', db.workouts, db.workoutItems, async () => {
    for (const item of items) {
      if (item.sets.length === 0) continue;
      await addWorkoutItem(date, item.exerciseId, item.sets);
    }
  });
}
