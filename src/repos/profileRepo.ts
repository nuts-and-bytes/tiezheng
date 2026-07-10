import { db } from '../lib/db';
import type { Profile } from '../lib/types';

const DEFAULT: Profile = { id: 'me', weeklyGoal: 4, onboarded: false, updatedAt: 0 };

export async function getProfile(): Promise<Profile> {
  return (await db.profile.get('me')) ?? { ...DEFAULT };
}

export async function saveProfile(patch: Partial<Omit<Profile, 'id'>>): Promise<Profile> {
  return await db.transaction('rw', db.profile, async () => {
    const next: Profile = { ...(await getProfile()), ...patch, id: 'me', updatedAt: Date.now() };
    await db.profile.put(next);
    return next;
  });
}
