import { resetDb } from '../test/dbTestUtils';
import { getWeight, listWeights, removeWeight, setWeight } from './weightRepo';

beforeEach(resetDb);

test('同日重复记录 = 覆盖，不产生第二条', async () => {
  await setWeight('2026-07-08', 72.4);
  await setWeight('2026-07-08', 72.0);
  const rows = await listWeights('2026-07-01', '2026-07-31');
  expect(rows).toHaveLength(1);
  expect(rows[0].weightKg).toBe(72.0);
});

test('listWeights 按日期升序、含区间端点', async () => {
  await setWeight('2026-07-03', 73);
  await setWeight('2026-07-01', 74);
  await setWeight('2026-06-30', 75); // 区间外
  const rows = await listWeights('2026-07-01', '2026-07-03');
  expect(rows.map((r) => r.date)).toEqual(['2026-07-01', '2026-07-03']);
});

test('removeWeight 软删后查不到', async () => {
  await setWeight('2026-07-08', 72.4);
  await removeWeight('2026-07-08');
  expect(await getWeight('2026-07-08')).toBeUndefined();
});
