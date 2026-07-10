import { db } from '../lib/db';
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
});
