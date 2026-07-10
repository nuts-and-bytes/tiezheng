import { db } from '../lib/db';
import { newId } from '../lib/ids';
import type { Photo } from '../lib/types';

async function activeByDate(date: string): Promise<Photo | undefined> {
  const rows = await db.photos.where('date').equals(date).toArray();
  return rows.find((p) => p.deletedAt === null);
}

/** 每天一张上限（规格 §9）：重拍 = 软删旧照 + 新增 */
export async function savePhoto(date: string, blob: Blob): Promise<Photo> {
  const old = await activeByDate(date);
  if (old) await db.photos.update(old.id, { deletedAt: Date.now(), updatedAt: Date.now() });
  const row: Photo = {
    id: newId(),
    date,
    blob,
    size: blob.size,
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await db.photos.add(row);
  return row;
}

export async function getPhoto(date: string): Promise<Photo | undefined> {
  return activeByDate(date);
}

export async function listPhotos(): Promise<Photo[]> {
  const rows = await db.photos.toArray();
  return rows
    .filter((p) => p.deletedAt === null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function listPhotoDates(from: string, to: string): Promise<Set<string>> {
  const rows = await db.photos.where('date').between(from, to, true, true).toArray();
  return new Set(rows.filter((p) => p.deletedAt === null).map((p) => p.date));
}

export async function removePhoto(date: string): Promise<void> {
  const existing = await activeByDate(date);
  if (existing) {
    await db.photos.update(existing.id, { deletedAt: Date.now(), updatedAt: Date.now() });
  }
}
