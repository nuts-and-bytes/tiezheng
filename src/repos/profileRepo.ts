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

/**
 * 事务内读最新值步进每周目标并 clamp 到 1–7。
 * 避免 UI 基于渲染旧值计算导致的 lost update（Task 16 评审修复，纯增量新增）。
 */
export async function adjustWeeklyGoal(delta: number): Promise<Profile> {
  return await db.transaction('rw', db.profile, async () => {
    const cur = await getProfile();
    const weeklyGoal = Math.min(7, Math.max(1, cur.weeklyGoal + delta));
    const next: Profile = { ...cur, weeklyGoal, id: 'me', updatedAt: Date.now() };
    await db.profile.put(next);
    return next;
  });
}
