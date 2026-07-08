import { resetDb } from '../test/dbTestUtils';
import { getProfile, saveProfile } from './profileRepo';

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
