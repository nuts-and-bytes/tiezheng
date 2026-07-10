import { resetDb } from '../test/dbTestUtils';
import { adjustWeeklyGoal, getProfile, saveProfile } from './profileRepo';

beforeEach(resetDb);

test('默认档案：每周 4 练、未引导', async () => {
  const p = await getProfile();
  expect(p).toMatchObject({ id: 'me', weeklyGoal: 4, onboarded: false });
});

test('saveProfile 合并补丁并持久化', async () => {
  await saveProfile({ weeklyGoal: 5 });
  await saveProfile({ onboarded: true });
  const p = await getProfile();
  expect(p.weeklyGoal).toBe(5);
  expect(p.onboarded).toBe(true);
  expect(p.updatedAt).toBeGreaterThan(0);
});

test('saveProfile 并发补丁不丢更新', async () => {
  await Promise.all([saveProfile({ weeklyGoal: 5 }), saveProfile({ onboarded: true })]);
  const p = await getProfile();
  expect(p.weeklyGoal).toBe(5);
  expect(p.onboarded).toBe(true);
});

test('adjustWeeklyGoal 连续两次 +1 不丢更新（4 → 6）', async () => {
  await Promise.all([adjustWeeklyGoal(1), adjustWeeklyGoal(1)]);
  expect((await getProfile()).weeklyGoal).toBe(6);
});

test('adjustWeeklyGoal 下界 clamp：1 不再减', async () => {
  await saveProfile({ weeklyGoal: 1 });
  await adjustWeeklyGoal(-1);
  expect((await getProfile()).weeklyGoal).toBe(1);
});

test('adjustWeeklyGoal 上界 clamp：7 不再加', async () => {
  await saveProfile({ weeklyGoal: 7 });
  await adjustWeeklyGoal(1);
  expect((await getProfile()).weeklyGoal).toBe(7);
});
