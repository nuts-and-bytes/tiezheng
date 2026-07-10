import { db } from '../lib/db';
import type { Photo } from '../lib/types';
import { resetDb } from '../test/dbTestUtils';
import { getPhoto, listPhotoDates, listPhotos, removePhoto, savePhoto } from './photoRepo';

beforeEach(resetDb);

const blob = (s: string) => new Blob([s], { type: 'image/jpeg' });

test('每天一张：重拍替换旧照（旧照软删）', async () => {
  await savePhoto('2026-07-08', blob('v1'));
  await savePhoto('2026-07-08', blob('v2-x'));
  const p = await getPhoto('2026-07-08');
  expect(p?.size).toBe(4); // 'v2-x'
  expect(await db.photos.count()).toBe(2); // 软删行保留
  expect(await listPhotos()).toHaveLength(1);
});

test('listPhotos 新日期在前；listPhotoDates 返回区间内日期集合', async () => {
  await savePhoto('2026-07-01', blob('a'));
  await savePhoto('2026-07-05', blob('b'));
  expect((await listPhotos()).map((p) => p.date)).toEqual(['2026-07-05', '2026-07-01']);
  const dates = await listPhotoDates('2026-07-01', '2026-07-04');
  expect(dates.has('2026-07-01')).toBe(true);
  expect(dates.has('2026-07-05')).toBe(false);
});

test('removePhoto 软删后查不到', async () => {
  await savePhoto('2026-07-08', blob('a'));
  await removePhoto('2026-07-08');
  expect(await getPhoto('2026-07-08')).toBeUndefined();
  // 软删：行仍物理存在，deletedAt 已置为时间戳
  const all = await db.photos.toArray();
  const row = all.find((p) => p.date === '2026-07-08');
  expect(row).toBeDefined();
  expect(typeof row?.deletedAt).toBe('number');
});

test('savePhoto 并发同日写入仅保留一张活跃照片', async () => {
  await Promise.all([savePhoto('2026-07-08', blob('a')), savePhoto('2026-07-08', blob('b'))]);
  const all = await db.photos.toArray();
  const active = all.filter((p) => p.date === '2026-07-08' && p.deletedAt === null);
  expect(active).toHaveLength(1);
});

// 注：fake-indexeddb 会把 Blob 克隆成空 Object（回读后 blob.size 恒为 undefined），
// 故物理行只断言可无损回读的 size/deletedAt；blob 置空在写入边界用 spy 断言。
test('removePhoto 软删时置空 blob（隐私：字节不得滞留）', async () => {
  await savePhoto('2026-07-08', blob('secret-bytes'));
  const spy = vi.spyOn(db.photos, 'update');
  await removePhoto('2026-07-08');
  const changes = spy.mock.calls[0][1] as Partial<Photo>;
  spy.mockRestore();
  expect(changes.blob).toBeInstanceOf(Blob);
  expect(changes.blob?.size).toBe(0);
  expect(changes.size).toBe(0);
  const row = (await db.photos.toArray()).find((p) => p.date === '2026-07-08');
  expect(row).toBeDefined();
  expect(typeof row?.deletedAt).toBe('number');
  expect(row?.size).toBe(0);
});

test('重拍软删旧行时置空旧 blob，新活跃行 blob 完整', async () => {
  await savePhoto('2026-07-08', blob('old-secret'));
  const spy = vi.spyOn(db.photos, 'update');
  await savePhoto('2026-07-08', blob('new-photo'));
  const changes = spy.mock.calls[0][1] as Partial<Photo>;
  spy.mockRestore();
  expect(changes.blob).toBeInstanceOf(Blob);
  expect(changes.blob?.size).toBe(0);
  expect(changes.size).toBe(0);
  const all = await db.photos.toArray();
  const deleted = all.find((p) => p.date === '2026-07-08' && p.deletedAt !== null);
  const active = all.find((p) => p.date === '2026-07-08' && p.deletedAt === null);
  expect(deleted).toBeDefined();
  expect(deleted?.size).toBe(0);
  expect(active?.size).toBe(9); // 'new-photo'
});
