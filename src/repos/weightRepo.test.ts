import { db } from '../lib/db';
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
  // 软删：行仍物理存在，deletedAt 已置为时间戳
  const all = await db.weightLogs.toArray();
  const row = all.find((w) => w.date === '2026-07-08');
  expect(row).toBeDefined();
  expect(typeof row?.deletedAt).toBe('number');
});

test('setWeight 并发同日写入仅保留一条活跃记录', async () => {
  await Promise.all([setWeight('2026-07-08', 70), setWeight('2026-07-08', 71)]);
  const all = await db.weightLogs.toArray();
  const active = all.filter((w) => w.date === '2026-07-08' && w.deletedAt === null);
  expect(active).toHaveLength(1);
});
