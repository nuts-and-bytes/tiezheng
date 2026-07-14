import { DEFAULT_PROFILE, db } from '../lib/db';
import type { Profile } from '../lib/types';

/**
 * IndexedDB 不强制 schema：读出来的记录是不可信输入，而类型声明说 onboarded 是 boolean。
 * 重构前写入的记录里它是 undefined —— 这个谎言不能带进 UI（见 db.ts 的 v3 迁移）。
 * 用显式赋值而不是 spread 兜底：{...DEFAULT, ...row} 会把 row 里的 undefined 也铺上去。
 */
export async function getProfile(): Promise<Profile> {
  const row = await db.profile.get('me');
  if (!row) return { ...DEFAULT_PROFILE };
  return { ...DEFAULT_PROFILE, ...row, onboarded: row.onboarded ?? DEFAULT_PROFILE.onboarded };
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
