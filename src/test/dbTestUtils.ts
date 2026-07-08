import { db } from '../lib/db';

export async function resetDb(): Promise<void> {
  await db.delete();
  await db.open();
}
