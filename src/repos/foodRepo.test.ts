import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PRESET_FOODS } from '../data/presetFoods';
import { db } from '../lib/db';
import { resetDb } from '../test/dbTestUtils';
import {
  getFood,
  listFoods,
  removeCustomFood,
  saveCustomFood,
  seedPresetFoods,
  type SaveCustomFoodInput,
} from './foodRepo';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const customInput: SaveCustomFoodInput = {
  name: '包装豆奶',
  aliases: ['豆奶饮品'],
  rawOrCooked: 'not-applicable',
  preparation: '即饮',
  originalEnergyValue: 418.4,
  originalEnergyUnit: 'kJ',
  originalProteinG: 3.2,
  originalBasisAmount: 100,
  originalBasisUnit: 'mL',
  normalizedBasisAmount: 100,
  normalizedBasisUnit: 'mL',
  ediblePortionRatio: 1,
  densityGPerMl: null,
  conversionAssumptions: ['包装标签每 100 mL'],
  fdcId: null,
  fdcDataType: null,
  sourceRetrievedAt: null,
  source: 'user-label',
  sourceVersion: '2026-08-14',
  license: 'user-provided',
};

test('预置 seed 并发幂等，数据库只有三条预置且列表保持目录顺序', async () => {
  await Promise.all([seedPresetFoods(), seedPresetFoods(), seedPresetFoods()]);

  expect((await db.foods.toArray()).filter((food) => food.preset)).toHaveLength(3);
  expect((await listFoods()).map((food) => food.id)).toEqual(
    PRESET_FOODS.map((food) => food.id),
  );
});

test('预置 seed 只补缺失项，不覆盖数据库中的已有同 id 行', async () => {
  const existing = { ...structuredClone(PRESET_FOODS[0]), name: '用户保留名称' };
  await db.foods.add(existing);

  await seedPresetFoods();

  expect(await db.foods.count()).toBe(3);
  expect((await db.foods.get(existing.id))?.name).toBe('用户保留名称');
});

test('自定义食物使用 operation id 派生 id，只保存纯函数标准化字段', async () => {
  const custom = await saveCustomFood('custom-soy-001', customInput);

  expect(custom).toMatchObject({
    id: 'food:custom:custom-soy-001',
    basisAmount: 100,
    basisUnit: 'mL',
    energyKcal: 100,
    proteinG: 3.2,
    preset: false,
    deletedAt: null,
  });
  expect(custom.conversionAssumptions).toEqual([
    '包装标签每 100 mL',
    'energy converted from kJ using 1 kcal = 4.184 kJ',
  ]);
  expect(await getFood(custom.id)).toEqual(custom);
});

test('相同 operation id 和相同语义幂等，任意营养语义变化都 fail closed', async () => {
  const first = await saveCustomFood('custom-soy-001', customInput);

  expect(await saveCustomFood('custom-soy-001', structuredClone(customInput))).toEqual(first);
  await expect(
    saveCustomFood('custom-soy-001', { ...customInput, originalProteinG: 4 }),
  ).rejects.toThrow('operation id conflict');
  await expect(
    saveCustomFood('custom-soy-001', { ...customInput, normalizedBasisAmount: 200 }),
  ).rejects.toThrow('operation id conflict');
  expect(await db.foods.count()).toBe(1);
});

test('软删后的自定义食物可由同 operation 与同语义复活', async () => {
  const now = vi.spyOn(Date, 'now');
  now.mockReturnValue(100);
  const first = await saveCustomFood('custom-soy-001', customInput);
  now.mockReturnValue(200);
  await removeCustomFood(first.id);
  expect(await getFood(first.id)).toBeUndefined();

  now.mockReturnValue(300);
  const revived = await saveCustomFood('custom-soy-001', structuredClone(customInput));

  expect(revived).toMatchObject({ id: first.id, updatedAt: 300, deletedAt: null });
  expect(await getFood(first.id)).toEqual(revived);
  expect(await db.foods.count()).toBe(1);
});

test('搜索同时覆盖名称与别名，且不暴露软删除项', async () => {
  await seedPresetFoods();
  const custom = await saveCustomFood('custom-soy-001', customInput);

  expect((await listFoods('鸡胸')).map((food) => food.id)).toEqual([
    'food:preset:usda:171477',
  ]);
  expect((await listFoods('米饭')).map((food) => food.id)).toEqual([
    'food:preset:usda:168878',
  ]);
  expect((await listFoods('豆奶饮品')).map((food) => food.id)).toEqual([custom.id]);

  await removeCustomFood(custom.id);
  expect(await listFoods('豆奶')).toEqual([]);
  expect((await listFoods()).some((food) => food.id === custom.id)).toBe(false);
});

test('预置不可删，删除不存在的自定义食物是幂等 no-op', async () => {
  await seedPresetFoods();

  await expect(removeCustomFood(PRESET_FOODS[0].id)).rejects.toThrow('preset');
  await expect(removeCustomFood('food:custom:missing')).resolves.toBeUndefined();
  expect((await db.foods.get(PRESET_FOODS[0].id))?.deletedAt).toBeNull();
});

test('重复删除已经软删的自定义食物是 no-op，删除时间不漂移', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100);
  const custom = await saveCustomFood('delete-once', customInput);
  now.mockReturnValue(200);
  await removeCustomFood(custom.id);
  const deleted = await db.foods.get(custom.id);

  now.mockReturnValue(300);
  await removeCustomFood(custom.id);

  expect(await db.foods.get(custom.id)).toEqual(deleted);
  expect(deleted).toMatchObject({ updatedAt: 200, deletedAt: 200 });
});

test('Food 持久化边界拒绝不安全写入时间', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Number.NaN);

  await expect(saveCustomFood('unsafe-clock', customInput)).rejects.toThrow('updatedAt');
  expect(await db.foods.count()).toBe(0);
});

test.each(['', '../escape', 'has whitespace', 'a'.repeat(129)])(
  '不安全 operation id %j fail closed',
  async (operationId) => {
    await expect(saveCustomFood(operationId, customInput)).rejects.toThrow('operation id');
    expect(await db.foods.count()).toBe(0);
  },
);

test('非法日期、fdcId、必填来源和非有限营养数据 fail closed', async () => {
  await expect(
    saveCustomFood('bad-number', { ...customInput, originalEnergyValue: Number.NaN }),
  ).rejects.toThrow('finite');
  await expect(
    saveCustomFood('bad-infinity', { ...customInput, originalProteinG: Number.POSITIVE_INFINITY }),
  ).rejects.toThrow('finite');
  await expect(
    saveCustomFood('bad-date', { ...customInput, sourceRetrievedAt: '2026-02-30' }),
  ).rejects.toThrow('sourceRetrievedAt');
  await expect(
    saveCustomFood('non-text-date', {
      ...customInput,
      sourceRetrievedAt: new String('2026-08-14') as never,
    }),
  ).rejects.toThrow('sourceRetrievedAt');
  await expect(
    saveCustomFood('bad-fdc', { ...customInput, fdcId: 0 }),
  ).rejects.toThrow('fdcId');
  await expect(
    saveCustomFood('bad-source', { ...customInput, source: '  ' }),
  ).rejects.toThrow('source');
  expect(await db.foods.count()).toBe(0);
});

test('运行时拒绝非法生熟状态、FDC 数据类型和非安全整数 FDC ID', async () => {
  await expect(
    saveCustomFood('bad-cooked-state', {
      ...customInput,
      rawOrCooked: 'boiled' as never,
    }),
  ).rejects.toThrow('rawOrCooked');
  await expect(
    saveCustomFood('bad-fdc-type', {
      ...customInput,
      fdcId: 123,
      fdcDataType: 'Experimental' as never,
      sourceRetrievedAt: '2026-08-14',
    }),
  ).rejects.toThrow('fdcDataType');
  await expect(
    saveCustomFood('unsafe-fdc', {
      ...customInput,
      fdcId: Number.MAX_SAFE_INTEGER + 1,
      fdcDataType: 'Branded',
      sourceRetrievedAt: '2026-08-14',
    }),
  ).rejects.toThrow('safe integer');
  expect(await db.foods.count()).toBe(0);
});

test('FDC ID 与数据类型必须成对，且 FDC 数据必须带真实获取日期', async () => {
  await expect(
    saveCustomFood('fdc-id-only', {
      ...customInput,
      fdcId: 123,
      sourceRetrievedAt: '2026-08-14',
    }),
  ).rejects.toThrow('simultaneously');
  await expect(
    saveCustomFood('fdc-type-only', { ...customInput, fdcDataType: 'Branded' }),
  ).rejects.toThrow('simultaneously');
  await expect(
    saveCustomFood('fdc-no-date', {
      ...customInput,
      fdcId: 123,
      fdcDataType: 'Branded',
    }),
  ).rejects.toThrow('sourceRetrievedAt');

  await expect(
    saveCustomFood('valid-fdc', {
      ...customInput,
      fdcId: 123,
      fdcDataType: 'Branded',
      sourceRetrievedAt: '2026-08-14',
    }),
  ).resolves.toMatchObject({ fdcId: 123, fdcDataType: 'Branded' });
});

test.each(['name', 'preparation'] as const)(
  '%s 超过 120 字符时 fail closed',
  async (field) => {
    await expect(
      saveCustomFood(`long-${field}`, { ...customInput, [field]: 'x'.repeat(121) }),
    ).rejects.toThrow(field);
  },
);

test.each(['source', 'sourceVersion', 'license'] as const)(
  '%s 超过 500 字符时 fail closed',
  async (field) => {
    await expect(
      saveCustomFood(`long-${field}`, { ...customInput, [field]: 'x'.repeat(501) }),
    ).rejects.toThrow(field);
  },
);

test.each([
  ['originalEnergyValue 上限', 'input-energy-too-high', { originalEnergyValue: 1_000_001 }, 'originalEnergyValue'],
  ['originalProteinG 上限', 'input-protein-too-high', { originalProteinG: 100_001 }, 'originalProteinG'],
  ['originalBasisAmount 下限', 'input-original-basis-low', { originalBasisAmount: 0.009 }, 'originalBasisAmount'],
  ['originalBasisAmount 上限', 'input-original-basis-high', { originalBasisAmount: 100_001 }, 'originalBasisAmount'],
  ['normalizedBasisAmount 下限', 'input-normalized-basis-low', { normalizedBasisAmount: 0.009 }, 'normalizedBasisAmount'],
  ['normalizedBasisAmount 上限', 'input-normalized-basis-high', { normalizedBasisAmount: 100_001 }, 'normalizedBasisAmount'],
  ['densityGPerMl 上限', 'input-density-high', { densityGPerMl: 100.01 }, 'densityGPerMl'],
  [
    '派生 energyKcal 上限',
    'derived-energy-high',
    { originalEnergyValue: 100_001, originalEnergyUnit: 'kcal' },
    'energyKcal',
  ],
  ['派生 proteinG 上限', 'derived-protein-high', { originalProteinG: 10_001 }, 'proteinG'],
] as Array<[string, string, Partial<SaveCustomFoodInput>, string]>)(
  '%s越界时 fail closed',
  async (_label, operationId, patch, expectedField) => {
    await expect(
      saveCustomFood(operationId, { ...customInput, ...patch }),
    ).rejects.toThrow(expectedField);
  },
);

test('文本与数值精确上限仍可保存', async () => {
  const saved = await saveCustomFood('exact-food-limits', {
    ...customInput,
    name: '名'.repeat(120),
    preparation: '做'.repeat(120),
    source: '源'.repeat(500),
    sourceVersion: '版'.repeat(500),
    license: '证'.repeat(500),
    aliases: ['别'.repeat(500)],
    conversionAssumptions: ['假'.repeat(500)],
    originalEnergyValue: 1_000_000,
    originalEnergyUnit: 'kcal',
    originalProteinG: 100_000,
    originalBasisAmount: 100,
    normalizedBasisAmount: 10,
    densityGPerMl: 100,
  });

  expect(saved).toMatchObject({ energyKcal: 100_000, proteinG: 10_000 });
});

test('别名与换算假设限制为 30 项，每项不超过 500 字符', async () => {
  await expect(
    saveCustomFood('too-many-aliases', {
      ...customInput,
      aliases: Array.from({ length: 31 }, (_, index) => `别名${index}`),
    }),
  ).rejects.toThrow('aliases');
  await expect(
    saveCustomFood('long-alias', { ...customInput, aliases: ['x'.repeat(501)] }),
  ).rejects.toThrow('aliases');
  await expect(
    saveCustomFood('too-many-assumptions', {
      ...customInput,
      conversionAssumptions: Array.from({ length: 31 }, (_, index) => `假设${index}`),
    }),
  ).rejects.toThrow('conversionAssumptions');
  await expect(
    saveCustomFood('long-assumption', {
      ...customInput,
      conversionAssumptions: ['x'.repeat(501)],
    }),
  ).rejects.toThrow('conversionAssumptions');
});

test('标准化自动追加的换算说明也不能让持久化假设超过 30 项', async () => {
  await expect(
    saveCustomFood('normalized-too-many-assumptions', {
      ...customInput,
      conversionAssumptions: Array.from({ length: 30 }, (_, index) => `假设${index}`),
    }),
  ).rejects.toThrow('conversionAssumptions');
});

test('别名和换算假设输入不是数组时明确 fail closed，空别名仍会被过滤', async () => {
  await expect(
    saveCustomFood('aliases-not-array', { ...customInput, aliases: '豆奶' as never }),
  ).rejects.toThrow('aliases must be an array');
  await expect(
    saveCustomFood('assumptions-not-array', {
      ...customInput,
      conversionAssumptions: '标签' as never,
    }),
  ).rejects.toThrow('conversionAssumptions must be an array');

  const saved = await saveCustomFood('trim-aliases', {
    ...customInput,
    aliases: ['', ' 豆奶 ', '  '],
  });
  expect(saved.aliases).toEqual(['豆奶']);
});
