import { db } from '../lib/db';
import { newId } from '../lib/ids';
import type { WeightLog } from '../lib/types';

async function activeByDate(date: string): Promise<WeightLog | undefined> {
  const rows = await db.weightLogs.where('date').equals(date).toArray();
  return rows.find((w) => w.deletedAt === null);
}

/** 每天一条：已有则覆盖数值 */
export async function setWeight(date: string, weightKg: number): Promise<WeightLog> {
  return await db.transaction('rw', db.weightLogs, async () => {
    const existing = await activeByDate(date);
    if (existing) {
      const next = { ...existing, weightKg, updatedAt: Date.now() };
      await db.weightLogs.put(next);
      return next;
    }
    const row: WeightLog = { id: newId(), date, weightKg, updatedAt: Date.now(), deletedAt: null };
    await db.weightLogs.add(row);
    return row;
  });
}

export async function getWeight(date: string): Promise<WeightLog | undefined> {
  return activeByDate(date);
}

export async function listWeights(from: string, to: string): Promise<WeightLog[]> {
  const rows = await db.weightLogs.where('date').between(from, to, true, true).toArray();
  return rows
    .filter((w) => w.deletedAt === null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function removeWeight(date: string): Promise<void> {
  const existing = await activeByDate(date);
  if (existing) {
    await db.weightLogs.update(existing.id, { deletedAt: Date.now(), updatedAt: Date.now() });
  }
}
