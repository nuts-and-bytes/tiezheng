import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DB_V4_STORES, db, type NutritionDb } from '../lib/db';
import { buildMealSnapshotHash } from '../lib/mealSnapshot';
import { mealEstimateId, mealId, mealPhotoId } from '../lib/nutritionIds';
import type { ConfirmedPhotoCandidate } from '../lib/photoAiCandidate';
import type { MealEstimate, MealEstimateCandidate, MealPhoto } from '../lib/nutritionTypes';
import {
  foodRow,
  mealEstimateRow,
  mealItemRow,
  mealPhotoRow,
  mealRow,
} from '../test/nutritionFixtures';
import { resetDb } from '../test/dbTestUtils';
import {
  clearMealEstimate,
  clearMealTemporaryState,
  confirmPhotoEstimate,
  createMealRepo,
  listNutritionDay,
  putMealEstimate,
  putMealPhoto,
  removeMeal,
  removeMealItem,
  saveConfirmedFoodItem,
  updateMealItemAmount,
  type ConfirmPhotoEstimateInput,
  type SaveConfirmedFoodItemInput,
} from './mealRepo';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const preset = foodRow({
  id: 'food:preset:usda:168878',
  energyKcal: 130,
  proteinG: 2.69,
});
const confirmed = (
  overrides: Partial<SaveConfirmedFoodItemInput> = {},
): SaveConfirmedFoodItemInput => ({
  operationId: 'tap-1',
  date: '2026-08-14',
  slot: 'lunch',
  food: preset,
  amount: 150,
  ...overrides,
});

async function putTemporaryState(mealId = 'meal:2026-08-14:lunch'): Promise<void> {
  await putMealPhoto(await currentMealPhoto(mealId));
  await putMealEstimate(mealEstimateRow({ id: mealEstimateId(mealId), mealId }));
}

async function currentMealPhoto(
  mealId = 'meal:2026-08-14:lunch',
  overrides: Partial<MealPhoto> = {},
): Promise<MealPhoto> {
  const meal = await db.meals.get(mealId);
  if (meal === undefined) throw new Error('test requires a meal');
  const items = await db.mealItems.where('mealId').equals(mealId).toArray();
  return mealPhotoRow({
    id: mealPhotoId(mealId),
    mealId,
    mealSnapshotHash: await buildMealSnapshotHash(meal, items),
    ...overrides,
  });
}

function estimateState(
  status: MealEstimate['status'],
  overrides: Partial<MealEstimate> = {},
): MealEstimate {
  const base = mealEstimateRow();
  const byStatus: Record<MealEstimate['status'], Partial<MealEstimate>> = {
    preprocessing: {
      requestFingerprint: null,
      candidates: [],
      consent: null,
      error: null,
    },
    'awaiting-consent': {
      requestFingerprint: null,
      candidates: [],
      consent: null,
      error: null,
    },
    uploading: {
      requestFingerprint: null,
      candidates: [],
      consent: base.consent,
      error: null,
    },
    estimating: {
      requestFingerprint: null,
      candidates: [],
      consent: base.consent,
      error: null,
    },
    'needs-confirmation': {
      requestFingerprint: base.requestFingerprint,
      candidates: base.candidates,
      consent: base.consent,
      error: null,
    },
    confirmed: {
      requestFingerprint: base.requestFingerprint,
      candidates: [],
      consent: null,
      error: null,
    },
    failed: { candidates: [], error: 'offline' },
  };
  return { ...base, status, ...byStatus[status], ...overrides };
}

function confirmedCandidate(
  overrides: Partial<ConfirmedPhotoCandidate> = {},
): ConfirmedPhotoCandidate {
  return {
    candidate: structuredClone(mealEstimateRow().candidates[0]!),
    confirmedAmount: 150,
    confirmedUnit: 'g',
    confirmedName: '熟米饭',
    confirmedPreparation: '蒸煮',
    confirmedAssumptions: ['用户确认份量'],
    ...overrides,
  };
}

function modelConfirmedCandidate(
  overrides: Partial<ConfirmedPhotoCandidate> = {},
): ConfirmedPhotoCandidate {
  return confirmedCandidate({
    candidate: {
      id: 'candidate-model-1',
      name: '番茄炒蛋',
      preparation: '家常炒制',
      amountLow: 180,
      amountHigh: 220,
      unit: 'g',
      catalogFoodId: null,
      nutrientSource: 'model-range',
      energyKcalLow: 240,
      energyKcalHigh: 360,
      proteinGLow: 14,
      proteinGHigh: 24,
      assumptions: ['按常见家常做法估算'],
    },
    confirmedAmount: 200,
    confirmedName: '番茄炒蛋',
    confirmedPreparation: '少油炒制',
    ...overrides,
  });
}

function confirmPhotoInput(
  overrides: Partial<ConfirmPhotoEstimateInput> = {},
): ConfirmPhotoEstimateInput {
  const photo = mealPhotoRow();
  return {
    operationId: 'photo-confirm-1',
    date: '2026-08-14',
    slot: 'lunch',
    requestId: 'request-fixture-1',
    uploadBlobSha256: 'c'.repeat(64),
    candidates: [confirmedCandidate(), modelConfirmedCandidate()],
    thumbnail: {
      blob: photo.thumbnail,
      width: photo.width,
      height: photo.height,
    },
    ...overrides,
  };
}

async function seedConfirmableEstimate(
  overrides: Partial<MealEstimate> = {},
): Promise<MealEstimate> {
  const base = mealEstimateRow();
  const estimate = estimateState('needs-confirmation', {
    candidates: [
      structuredClone(confirmedCandidate().candidate),
      structuredClone(modelConfirmedCandidate().candidate),
    ],
    ...overrides,
  });
  await putMealEstimate(estimate);
  await db.foods.put(preset);
  vi.spyOn(Date, 'now').mockReturnValue(base.consent!.consentedAt + 1);
  return estimate;
}

test('并发重试只创建一个餐次和一个确认项', async () => {
  const input = confirmed();
  await Promise.all([
    saveConfirmedFoodItem(input),
    saveConfirmedFoodItem(structuredClone(input)),
  ]);

  expect(await db.meals.toArray()).toHaveLength(1);
  expect(await db.mealItems.toArray()).toHaveLength(1);
  expect(await db.mealItems.get('meal-item:tap-1')).toMatchObject({
    mealId: 'meal:2026-08-14:lunch',
    energyKcalLow: 195,
    energyKcalHigh: 195,
    proteinGLow: 4.035,
    proteinGHigh: 4.035,
    quality: 'A',
    method: 'preset',
    order: 0,
    deletedAt: null,
  });
  await expect(saveConfirmedFoodItem(confirmed({ amount: 200 }))).rejects.toThrow(
    'operation id conflict',
  );
  await expect(
    saveConfirmedFoodItem(confirmed({ food: foodRow({ id: 'food:other' }) })),
  ).rejects.toThrow('operation id conflict');
});

test('save 在任何异步边界前快照完整可变输入', async () => {
  const input = confirmed({
    operationId: 'snapshot-save',
    food: structuredClone(preset),
  });
  const expectedName = input.food.name;
  const pending = saveConfirmedFoodItem(input);

  input.operationId = 'mutated-operation';
  input.date = '2026-08-15';
  input.slot = 'dinner';
  input.amount = 999;
  input.food.name = '突变食物';
  input.food.energyKcal = 999;
  input.food.proteinG = 999;

  await expect(pending).resolves.toMatchObject({
    id: 'meal-item:snapshot-save',
    mealId: 'meal:2026-08-14:lunch',
    name: expectedName,
    amount: 150,
    energyKcal: 130,
    proteinG: 2.69,
  });
  expect(await db.meals.toArray()).toMatchObject([
    { id: 'meal:2026-08-14:lunch', date: '2026-08-14', slot: 'lunch' },
  ]);
  expect(await db.mealItems.get('meal-item:mutated-operation')).toBeUndefined();
});

test('幂等语义比较复用 stableJson，不依赖 localeCompare', async () => {
  const input = confirmed({ operationId: 'stable-json-1' });
  await saveConfirmedFoodItem(input);
  vi.spyOn(String.prototype, 'localeCompare').mockImplementation(() => {
    throw new Error('localeCompare must not be used for canonical JSON');
  });

  await expect(saveConfirmedFoodItem(structuredClone(input))).resolves.toMatchObject({
    id: 'meal-item:stable-json-1',
    deletedAt: null,
  });
});

test('预置、标签、手工三种方式保留完整食物快照，改量不读变动目录', async () => {
  const label = foodRow({
    id: 'food:custom:soy',
    name: '豆奶',
    preset: false,
    source: 'user-label',
    sourceVersion: 'label-v1',
    originalEnergyValue: 45,
    originalEnergyUnit: 'kcal',
    originalProteinG: 3.2,
    originalBasisAmount: 100,
    originalBasisUnit: 'mL',
    basisAmount: 100,
    basisUnit: 'mL',
    energyKcal: 45,
    proteinG: 3.2,
    fdcId: null,
    fdcDataType: null,
    sourceRetrievedAt: null,
    densityGPerMl: null,
    conversionAssumptions: ['包装标签每 100 mL'],
    license: 'user-provided',
  });
  const savedLabel = await saveConfirmedFoodItem(
    confirmed({ operationId: 'label-1', food: label, amount: 200 }),
  );
  const savedManual = await saveConfirmedFoodItem(
    confirmed({
      operationId: 'manual-1',
      food: { ...label, id: 'food:custom:manual', source: 'user-manual' },
      amount: 100,
    }),
  );
  expect(savedLabel).toMatchObject({
    name: '豆奶',
    preparation: label.preparation,
    amount: 200,
    method: 'label',
    unit: 'mL',
    energyKcalLow: 90,
    energyKcalHigh: 90,
    proteinGLow: 6.4,
    proteinGHigh: 6.4,
    originalEnergyValue: 45,
    originalEnergyUnit: 'kcal',
    originalProteinG: 3.2,
    originalBasisAmount: 100,
    originalBasisUnit: 'mL',
    basisAmount: 100,
    basisUnit: 'mL',
    ediblePortionRatio: label.ediblePortionRatio,
    densityGPerMl: null,
    conversionAssumptions: ['包装标签每 100 mL'],
    fdcId: null,
    fdcDataType: null,
    sourceRetrievedAt: null,
    source: 'user-label',
    sourceVersion: 'label-v1',
    license: 'user-provided',
    energyKcal: 45,
    proteinG: 3.2,
    quality: 'A',
    uncertaintyModelVersion: 'exact-measured-v1',
  });
  expect(savedLabel.assumptions).toEqual([
    '用户确认可食部mL',
    '食物目录快照 food:custom:soy',
  ]);
  expect(savedManual.method).toBe('manual');
  expect(
    (await saveConfirmedFoodItem(confirmed({ operationId: 'preset-2' }))).method,
  ).toBe('preset');

  await db.foods.put({ ...label, energyKcal: 999, proteinG: 999 });
  const changed = await updateMealItemAmount(savedLabel.id, 250);
  expect(changed).toMatchObject({
    energyKcalLow: 112.5,
    energyKcalHigh: 112.5,
    proteinGLow: 8,
    proteinGHigh: 8,
  });
  expect(changed.energyKcal).toBe(45);
  expect(changed.proteinG).toBe(3.2);
  expect(changed.densityGPerMl).toBeNull();
});

test.each([
  ['伪造归一化营养', { energyKcal: 999 }, 'normalized nutrient'],
  ['名称过长', { name: '食'.repeat(121) }, 'name'],
  ['别名过多', { aliases: Array.from({ length: 31 }, (_, index) => `别名${index}`) }, 'aliases'],
  ['非法生熟枚举', { rawOrCooked: 'boiled' as never }, 'rawOrCooked'],
  ['原始营养越界', { originalEnergyValue: 1_000_001 }, 'originalEnergyValue'],
  ['密度越界', { densityGPerMl: 101 }, 'densityGPerMl'],
  ['FDC 字段不成对', { fdcDataType: null }, 'fdc'],
  ['伪造获取日期', { sourceRetrievedAt: '2026-02-30' }, 'sourceRetrievedAt'],
  ['来源文本过长', { source: '源'.repeat(501) }, 'source'],
  ['不安全食物时间', { updatedAt: Number.NaN }, 'updatedAt'],
] as const)(
  '确认食物前由共享持久化边界拒绝%s',
  async (_label, patch, expected) => {
    await expect(
      saveConfirmedFoodItem(
        confirmed({ operationId: 'forged-food', food: { ...preset, ...patch } }),
      ),
    ).rejects.toThrow(expected);
    expect(await db.meals.count()).toBe(0);
    expect(await db.mealItems.count()).toBe(0);
  },
);

test.each([0.001, 100_001])('确认份量 %s 超出备份边界时拒绝', async (amount) => {
  await expect(
    saveConfirmedFoodItem(confirmed({ operationId: 'bad-amount', amount })),
  ).rejects.toThrow('amount');
  expect(await db.meals.count()).toBe(0);
  expect(await db.mealItems.count()).toBe(0);
});

test('现有最大 order 为 10000 时拒绝创建 order 10001', async () => {
  await db.meals.put(mealRow());
  await db.mealItems.put(mealItemRow({ id: 'meal-item:last-order', order: 10_000 }));

  await expect(
    saveConfirmedFoodItem(confirmed({ operationId: 'order-overflow' })),
  ).rejects.toThrow('order');
  expect(await db.mealItems.count()).toBe(1);
});

test.each([
  ['条目名称', { name: '食'.repeat(121) }, 'name'],
  ['条目做法', { preparation: '做'.repeat(121) }, 'preparation'],
  ['条目来源', { source: '源'.repeat(501) }, 'source'],
  ['条目数组', { assumptions: Array.from({ length: 31 }, () => '假设') }, 'assumptions'],
  ['条目份量', { amount: 0.001 }, 'amount'],
  ['条目原始营养', { originalEnergyValue: 1_000_001 }, 'originalEnergyValue'],
  ['条目归一营养', { energyKcal: 999 }, 'normalized nutrient'],
  ['条目确认时间', { confirmedAt: Number.NaN }, 'confirmedAt'],
  ['条目顺序', { order: 10_001 }, 'order'],
  ['条目点估计', { energyKcalLow: 0, energyKcalHigh: 0 }, 'point estimate'],
] as const)(
  '改量前拒绝不符合 backup-v3 的%s快照',
  async (_label, patch, expected) => {
    await db.meals.put(mealRow());
    const forged = mealItemRow({ id: 'meal-item:forged-update', ...patch });
    await db.mealItems.put(forged);

    await expect(updateMealItemAmount(forged.id, 200)).rejects.toThrow(expected);
    expect(await db.mealItems.get(forged.id)).toEqual(forged);
  },
);

test.each(['', 'x'.repeat(129), '../escape', 'contains space'])(
  '不安全 operation id %s 在事务前拒绝',
  async (operationId) => {
    const transaction = vi.spyOn(db, 'transaction');
    await expect(saveConfirmedFoodItem(confirmed({ operationId }))).rejects.toThrow(
      'operation id',
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(await db.meals.count()).toBe(0);
    expect(await db.mealItems.count()).toBe(0);
  },
);

test.each([
  { date: '2026-02-30' },
  { date: '14-08-2026' },
  { slot: 'midnight' as SaveConfirmedFoodItemInput['slot'] },
  { amount: 0 },
  { amount: Number.POSITIVE_INFINITY },
])('其他不安全确认输入也不会留下数据：$date $slot $amount', async (overrides) => {
  await expect(saveConfirmedFoodItem(confirmed(overrides))).rejects.toThrow();
  expect(await db.meals.count()).toBe(0);
  expect(await db.mealItems.count()).toBe(0);
});

test('两个 Dexie 连接并发写同一餐次，order 仍唯一', async () => {
  const second = new Dexie('tiezheng') as NutritionDb;
  second.version(4).stores(DB_V4_STORES);
  await second.open();
  try {
    const secondRepo = createMealRepo(second);
    await Promise.all([
      saveConfirmedFoodItem(confirmed({ operationId: 'connection-a' })),
      secondRepo.saveConfirmedFoodItem(confirmed({ operationId: 'connection-b' })),
    ]);
    const rows = (
      await db.mealItems.where('mealId').equals('meal:2026-08-14:lunch').toArray()
    )
      .filter((item) => item.deletedAt === null)
      .sort((left, right) => left.order - right.order);
    expect(rows.map((item) => item.order)).toEqual([0, 1]);
    expect(new Set(rows.map((item) => item.id)).size).toBe(2);
  } finally {
    second.close();
  }
});

test('软删除后同 operation 重试安全复活；日查询始终四餐有序', async () => {
  const first = await saveConfirmedFoodItem(confirmed());
  await removeMealItem(first.id);
  expect((await db.meals.get(first.mealId))?.deletedAt).not.toBeNull();
  expect((await db.mealItems.get(first.id))?.deletedAt).not.toBeNull();

  const revived = await saveConfirmedFoodItem(confirmed());
  expect(revived.deletedAt).toBeNull();
  expect(revived.confirmedAt).toBe(first.confirmedAt);
  expect((await db.meals.get(first.mealId))?.deletedAt).toBeNull();
  await saveConfirmedFoodItem(confirmed({ operationId: 'dinner-1', slot: 'dinner' }));

  const estimateOnlyMeal = mealRow({ id: 'meal:2026-08-14:snack', slot: 'snack' });
  await db.meals.put(estimateOnlyMeal);
  await putMealEstimate(
    mealEstimateRow({ id: mealEstimateId(estimateOnlyMeal.id), mealId: estimateOnlyMeal.id }),
  );
  const day = await listNutritionDay('2026-08-14');
  expect(day.meals.map((row) => row.slot)).toEqual([
    'breakfast',
    'lunch',
    'dinner',
    'snack',
  ]);
  expect(day.meals.map((row) => row.items.length)).toEqual([0, 1, 1, 0]);
  expect(day.summary).toMatchObject({
    recordedMeals: 2,
    recordedSlots: ['lunch', 'dinner'],
  });
});

test('日查询排除软删除数据，并按 order 后 id 确定排序', async () => {
  const parent = mealRow();
  await db.meals.put(parent);
  await db.mealItems.bulkPut([
    mealItemRow({ id: 'meal-item:z', order: 1 }),
    mealItemRow({ id: 'meal-item:a', order: 1 }),
    mealItemRow({ id: 'meal-item:deleted', order: 0, deletedAt: 1 }),
  ]);
  await db.meals.put(
    mealRow({
      id: 'meal:2026-08-14:dinner',
      slot: 'dinner',
      deletedAt: 1,
    }),
  );
  await db.mealItems.put(
    mealItemRow({
      id: 'meal-item:orphaned',
      mealId: 'meal:2026-08-14:dinner',
      order: 0,
    }),
  );

  const result = await listNutritionDay('2026-08-14');
  expect(result.meals[1]?.items.map((item) => item.id)).toEqual([
    'meal-item:a',
    'meal-item:z',
  ]);
  expect(result.summary.recordedMeals).toBe(1);
  await expect(listNutritionDay('2026-02-30')).rejects.toThrow('real calendar date');
});

test('日查询用同一读事务隔离另一 Dexie 连接的餐次删除', async () => {
  const saved = await saveConfirmedFoodItem(
    confirmed({ operationId: 'consistent-read' }),
  );
  const second = new Dexie('tiezheng') as NutritionDb;
  second.version(4).stores(DB_V4_STORES);
  await second.open();
  const secondRepo = createMealRepo(second);
  let writePromise: Promise<void> | undefined;
  let readSettled = false;
  let writeObservedReadSettled: boolean | undefined;
  let gateOutcome: 'written' | 'timeout' | undefined;
  const waitForWrite = (timeoutMs: number): Promise<'written' | 'timeout'> => {
    if (writePromise === undefined) throw new Error('test write was not started');
    const pending = writePromise;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => resolve('timeout'), timeoutMs);
      pending.then(
        () => {
          clearTimeout(timeout);
          resolve('written');
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  };

  const mealItemsWhere = db.mealItems.where.bind(db.mealItems);
  vi.spyOn(db.mealItems, 'where').mockImplementation(((index: string) => {
    const clause = mealItemsWhere(index);
    if (index !== 'mealId') return clause;
    const anyOf = clause.anyOf.bind(clause);
    clause.anyOf = ((values: string[]) => {
      const collection = anyOf(values);
      const toArray = collection.toArray.bind(collection);
      collection.toArray = (async () => {
        writePromise ??= Dexie.ignoreTransaction(() =>
          secondRepo.removeMeal(saved.mealId).then(() => {
            writeObservedReadSettled = readSettled;
          }),
        );
        gateOutcome = await Dexie.waitFor(waitForWrite(100));
        return toArray();
      }) as typeof collection.toArray;
      return collection;
    }) as typeof clause.anyOf;
    return clause;
  }) as never);

  try {
    const result = await listNutritionDay('2026-08-14').finally(() => {
      readSettled = true;
    });
    const lunch = result.meals.find(({ slot }) => slot === 'lunch')!;
    const beforeSnapshot = lunch.meal !== undefined && lunch.items.length === 1;
    const afterSnapshot = lunch.meal === undefined && lunch.items.length === 0;
    expect(beforeSnapshot || afterSnapshot).toBe(true);
    expect(gateOutcome).toBe('timeout');

    expect(writePromise).toBeDefined();
    expect(await waitForWrite(1_000)).toBe('written');
    expect(writeObservedReadSettled).toBe(true);
    expect((await db.meals.get(saved.mealId))?.deletedAt).not.toBeNull();
    expect((await db.mealItems.get(saved.id))?.deletedAt).not.toBeNull();
  } finally {
    if (writePromise !== undefined) {
      await waitForWrite(1_000).catch(() => 'written' as const);
    }
    second.close();
  }
});

test('恢复的旧条目 ID 可查询、改量，并与同餐新增条目并存', async () => {
  await db.meals.put(mealRow());
  await db.mealItems.put(mealItemRow({ id: 'legacy-item' }));

  const before = await listNutritionDay('2026-08-14');
  expect(before.meals.find(({ slot }) => slot === 'lunch')?.items[0]?.id).toBe(
    'legacy-item',
  );

  await expect(updateMealItemAmount('legacy-item', 200)).resolves.toMatchObject({
    id: 'legacy-item',
    amount: 200,
  });
  await expect(
    saveConfirmedFoodItem(confirmed({ operationId: 'after-restore' })),
  ).resolves.toMatchObject({
    id: 'meal-item:after-restore',
    order: 1,
  });
});

test('日查询遇到非确定餐次 ID 或重复 active slot 时 fail closed', async () => {
  await db.meals.put(mealRow({ id: 'meal:forged' }));
  await expect(listNutritionDay('2026-08-14')).rejects.toThrow('meal id');

  await resetDb();
  await db.meals.bulkPut([
    mealRow(),
    mealRow({ id: 'meal:2026-08-14:dinner', slot: 'lunch' }),
  ]);
  await expect(listNutritionDay('2026-08-14')).rejects.toThrow('duplicate meal slot');
});

test.each([
  ['空条目 ID', { id: ' ' }, 'meal item id'],
  ['过长条目 ID', { id: 'i'.repeat(201) }, 'meal item id'],
  ['order 越界', { order: 10_001 }, 'order'],
  ['amount 越界', { amount: 0.001 }, 'amount'],
  ['点估计不一致', { proteinGLow: 0, proteinGHigh: 0 }, 'point estimate'],
] as const)('日查询遇到%s时 fail closed', async (_label, patch, expected) => {
  await db.meals.put(mealRow());
  await db.mealItems.put(mealItemRow(patch));

  await expect(listNutritionDay('2026-08-14')).rejects.toThrow(expected);
});

test('图片需要 active 餐次；临时估算可在建餐前存在，且 id 必须可重建', async () => {
  const mealId = 'meal:2026-08-14:lunch';
  await expect(
    putMealEstimate(mealEstimateRow({ id: mealEstimateId(mealId), mealId })),
  ).resolves.toBeUndefined();
  expect(await listNutritionDay('2026-08-14')).toMatchObject({
    summary: { recordedMeals: 0 },
  });
  await clearMealEstimate(mealId);

  await saveConfirmedFoodItem(confirmed());
  await expect(putMealPhoto(mealPhotoRow({ id: 'random-photo', mealId }))).rejects.toThrow(
    'deterministic',
  );
  await expect(
    putMealEstimate(mealEstimateRow({ id: 'random-estimate', mealId })),
  ).rejects.toThrow('deterministic');
  await expect(
    putMealPhoto(
      mealPhotoRow({ id: mealPhotoId('meal:missing'), mealId: 'meal:missing' }),
    ),
  ).rejects.toThrow('active meal');
  await expect(
    putMealEstimate(
      mealEstimateRow({ id: mealEstimateId(mealId), mealId, requestFingerprint: '' }),
    ),
  ).rejects.toThrow('fingerprint');
  await expect(
    putMealEstimate(
      mealEstimateRow({
        id: mealEstimateId(mealId),
        mealId,
        candidates: [
          {
            id: 'bad',
            name: '米饭',
            preparation: '熟',
            amountLow: 200,
            amountHigh: 100,
            unit: 'g',
            catalogFoodId: null,
            nutrientSource: 'none',
            energyKcalLow: null,
            energyKcalHigh: null,
            proteinGLow: null,
            proteinGHigh: null,
            assumptions: [],
          },
        ],
      }),
    ),
  ).rejects.toThrow('candidate');
  await expect(
    putMealEstimate(
      mealEstimateRow({
        id: mealEstimateId(mealId),
        mealId,
        consent: { ...mealEstimateRow().consent!, requestId: 'different-request' },
      }),
    ),
  ).rejects.toThrow('consent request');
  await removeMealItem('meal-item:tap-1');
  await expect(
    putMealPhoto(mealPhotoRow({ id: mealPhotoId(mealId), mealId })),
  ).rejects.toThrow('active meal');
});

describe('图片字段验证', () => {
  test.each([
    ['空缩略图', (photo: MealPhoto) => ({ ...photo, thumbnail: new Blob(), size: 0 })],
    ['大小不符', (photo: MealPhoto) => ({ ...photo, size: photo.size + 1 })],
    ['非整数宽度', (photo: MealPhoto) => ({ ...photo, width: 1.5 })],
    ['无效高度', (photo: MealPhoto) => ({ ...photo, height: 0 })],
    ['无效哈希', (photo: MealPhoto) => ({ ...photo, mealSnapshotHash: 'ABC' })],
    ['负时间', (photo: MealPhoto) => ({ ...photo, updatedAt: -1 })],
    ['非整数时间', (photo: MealPhoto) => ({ ...photo, updatedAt: 1.5 })],
    [
      '非安全时间',
      (photo: MealPhoto) => ({ ...photo, updatedAt: Number.MAX_SAFE_INTEGER + 1 }),
    ],
  ])('拒绝%s', async (_label, mutate) => {
    await saveConfirmedFoodItem(confirmed());
    await expect(putMealPhoto(mutate(mealPhotoRow()))).rejects.toThrow('photo');
    expect(await db.mealPhotos.count()).toBe(0);
  });
});

test('照片绑定当前餐食快照，并按 updatedAt 实现 stale、幂等与冲突语义', async () => {
  await saveConfirmedFoodItem(confirmed());
  const original = await currentMealPhoto(undefined, { updatedAt: 100 });
  await putMealPhoto(original);
  await expect(putMealPhoto({ ...original })).resolves.toBeUndefined();

  const changedBytes = new Blob(
    [new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80, 1])],
    { type: 'image/webp' },
  );
  await expect(
    putMealPhoto({
      ...original,
      thumbnail: changedBytes,
      size: changedBytes.size,
    }),
  ).rejects.toThrow('timestamp conflict');
  await expect(putMealPhoto({ ...original, updatedAt: 99 })).rejects.toThrow('stale');

  const newer = { ...original, updatedAt: 101 };
  await expect(putMealPhoto(newer)).resolves.toBeUndefined();
  expect((await db.mealPhotos.get(original.id))?.updatedAt).toBe(101);
});

test('putPhoto 在 Blob 异步校验前快照完整可变输入', async () => {
  await saveConfirmedFoodItem(confirmed());
  const photo = await currentMealPhoto(undefined, { updatedAt: 321 });
  const put = vi.spyOn(db.mealPhotos, 'put');
  const expected = {
    id: photo.id,
    width: photo.width,
    updatedAt: photo.updatedAt,
    size: photo.size,
  };
  const pending = putMealPhoto(photo);

  photo.id = 'mutated-photo';
  photo.width = 999;
  photo.updatedAt = -1;
  photo.thumbnail = new Blob([new Uint8Array(12)], { type: 'image/jpeg' });

  await expect(pending).resolves.toBeUndefined();
  expect(await db.mealPhotos.get(expected.id)).toMatchObject(expected);
  expect(await db.mealPhotos.get('mutated-photo')).toBeUndefined();
  expect(put).toHaveBeenCalledOnce();
  expect(put.mock.calls[0]?.[0].thumbnail).toMatchObject({
    size: expected.size,
    type: 'image/webp',
  });
});

test('照片哈希必须等于事务内当前 active meal snapshot', async () => {
  const item = await saveConfirmedFoodItem(confirmed());
  const current = await currentMealPhoto(undefined, { updatedAt: 100 });
  await expect(
    putMealPhoto({ ...current, mealSnapshotHash: 'd'.repeat(64) }),
  ).rejects.toThrow('snapshot');

  await putMealPhoto(current);
  await updateMealItemAmount(item.id, 200);
  await expect(putMealPhoto({ ...current, updatedAt: 101 })).rejects.toThrow('snapshot');
  expect((await db.mealPhotos.get(current.id))?.updatedAt).toBe(100);
});

test.each([
  [
    '非 WebP MIME',
    (photo: MealPhoto) => ({
      ...photo,
      thumbnail: new Blob([photo.thumbnail], { type: 'image/jpeg' }),
    }),
  ],
  [
    '伪造 WebP magic',
    (photo: MealPhoto) => {
      const thumbnail = new Blob([new Uint8Array(12)], { type: 'image/webp' });
      return { ...photo, thumbnail, size: thumbnail.size };
    },
  ],
  [
    '超过 100KiB',
    (photo: MealPhoto) => {
      const bytes = new Uint8Array(100 * 1024 + 1);
      bytes.set([82, 73, 70, 70], 0);
      bytes.set([87, 69, 66, 80], 8);
      const thumbnail = new Blob([bytes], { type: 'image/webp' });
      return { ...photo, thumbnail, size: thumbnail.size };
    },
  ],
  ['宽度超过 320', (photo: MealPhoto) => ({ ...photo, width: 321 })],
  ['高度超过 320', (photo: MealPhoto) => ({ ...photo, height: 321 })],
])('拒绝图片配额或格式违规：%s', async (_label, mutate) => {
  await saveConfirmedFoodItem(confirmed());
  const photo = await currentMealPhoto();
  await expect(putMealPhoto(mutate(photo))).rejects.toThrow('photo');
  expect(await db.mealPhotos.count()).toBe(0);
});

describe('估算字段、候选项和同意凭证验证', () => {
  test.each([
    ['空 request id', { requestId: '   ' }],
    ['无效 fingerprint', { requestFingerprint: 'g'.repeat(64) }],
    ['无效 status', { status: 'done' as MealEstimate['status'] }],
    ['负 updatedAt', { updatedAt: -1 }],
    ['非整数 updatedAt', { updatedAt: 1.5 }],
    ['非安全 updatedAt', { updatedAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['失败状态没有 error', { status: 'failed' as const, error: null }],
    ['非失败状态却有 error', { status: 'confirmed' as const, error: 'offline' as const }],
    ['未知 error', { status: 'failed' as const, error: 'unknown' as MealEstimate['error'] }],
  ])('拒绝%s', async (_label, overrides) => {
    await saveConfirmedFoodItem(confirmed());
    await expect(putMealEstimate(mealEstimateRow(overrides))).rejects.toThrow('estimate');
    expect(await db.mealEstimates.count()).toBe(0);
  });

  test.each([
    ['空 id', { id: '' }],
    ['重复 id', null],
    ['空 name', { name: ' ' }],
    ['非文本 preparation', { preparation: 1 as unknown as string }],
    ['零下界', { amountLow: 0 }],
    ['无限上界', { amountHigh: Number.POSITIVE_INFINITY }],
    ['反向范围', { amountLow: 200, amountHigh: 100 }],
    ['无效 unit', { unit: 'kg' as MealEstimateCandidate['unit'] }],
    ['空 catalogFoodId', { catalogFoodId: ' ' }],
  ])('拒绝候选项：%s', async (_label, override) => {
    await saveConfirmedFoodItem(confirmed());
    const base = mealEstimateRow().candidates[0]!;
    const candidates =
      override === null
        ? [base, { ...base }]
        : [{ ...base, ...override }];
    await expect(putMealEstimate(mealEstimateRow({ candidates }))).rejects.toThrow(
      'candidate',
    );
    expect(await db.mealEstimates.count()).toBe(0);
  });

  test.each([
    ['无效上传哈希', { uploadBlobSha256: 'x' }],
    ['空策略版本', { providerPolicyVersion: ' ' }],
    ['负同意时间', { consentedAt: -1 }],
    ['非整数同意时间', { consentedAt: 1.5 }],
    ['非安全过期时间', { expiresAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['过期不晚于同意', { expiresAt: mealEstimateRow().consent!.consentedAt }],
  ])('拒绝同意凭证：%s', async (_label, override) => {
    await saveConfirmedFoodItem(confirmed());
    await expect(
      putMealEstimate(
        mealEstimateRow({ consent: { ...mealEstimateRow().consent!, ...override } }),
      ),
    ).rejects.toThrow('consent');
    expect(await db.mealEstimates.count()).toBe(0);
  });
});

test('同一估算请求按 updatedAt 实现 stale、幂等、冲突且新请求须先 clear', async () => {
  await saveConfirmedFoodItem(confirmed());
  const original = estimateState('needs-confirmation', { updatedAt: 100 });
  await putMealEstimate(original);
  await expect(putMealEstimate(structuredClone(original))).resolves.toBeUndefined();
  await expect(
    putMealEstimate({
      ...original,
      candidates: [{ ...original.candidates[0]!, name: '不同食物' }],
    }),
  ).rejects.toThrow('timestamp conflict');
  await expect(putMealEstimate({ ...original, updatedAt: 99 })).rejects.toThrow('stale');
  await expect(
    putMealEstimate({
      ...original,
      updatedAt: 101,
      requestId: 'request-new',
      requestFingerprint: 'e'.repeat(64),
      consent: { ...original.consent!, requestId: 'request-new' },
    }),
  ).rejects.toThrow('clear');

  await clearMealTemporaryState(original.mealId);
  await expect(
    putMealEstimate({
      ...original,
      updatedAt: 101,
      requestId: 'request-new',
      requestFingerprint: 'e'.repeat(64),
      consent: { ...original.consent!, requestId: 'request-new' },
    }),
  ).resolves.toBeUndefined();
});

test('估算状态只能前进，confirmed 与 failed 均为终态', async () => {
  await saveConfirmedFoodItem(confirmed());
  await putMealEstimate(estimateState('uploading', { updatedAt: 100 }));
  await expect(
    putMealEstimate(estimateState('awaiting-consent', { updatedAt: 101 })),
  ).rejects.toThrow('transition');
  await putMealEstimate(estimateState('estimating', { updatedAt: 102 }));
  await putMealEstimate(estimateState('needs-confirmation', { updatedAt: 103 }));
  await expect(putMealEstimate(estimateState('confirmed', { updatedAt: 104 }))).rejects.toThrow(
    'atomic',
  );

  await clearMealTemporaryState('meal:2026-08-14:lunch');
  await putMealEstimate(estimateState('failed', { updatedAt: 200 }));
  await expect(
    putMealEstimate(estimateState('estimating', { updatedAt: 201 })),
  ).rejects.toThrow('transition');
});

test('putMealEstimate 不能绕过原子确认 API 直接制造 confirmed 状态', async () => {
  await expect(putMealEstimate(estimateState('confirmed'))).rejects.toThrow('atomic');
  expect(await db.mealEstimates.count()).toBe(0);
});

test.each([
  ['preprocessing 有 consent', estimateState('preprocessing', { consent: mealEstimateRow().consent })],
  ['awaiting-consent 有候选', estimateState('awaiting-consent', { candidates: mealEstimateRow().candidates })],
  ['uploading 无 consent', estimateState('uploading', { consent: null })],
  ['uploading 有候选', estimateState('uploading', { candidates: mealEstimateRow().candidates })],
  ['estimating 无 consent', estimateState('estimating', { consent: null })],
  ['needs-confirmation 无候选', estimateState('needs-confirmation', { candidates: [] })],
  ['needs-confirmation 无 consent', estimateState('needs-confirmation', { consent: null })],
  ['confirmed 有候选', estimateState('confirmed', { candidates: mealEstimateRow().candidates })],
  ['confirmed 有 consent', estimateState('confirmed', { consent: mealEstimateRow().consent })],
  ['failed 有候选', estimateState('failed', { candidates: mealEstimateRow().candidates })],
])('拒绝非法估算状态组合：%s', async (_label, estimate) => {
  await saveConfirmedFoodItem(confirmed());
  await expect(putMealEstimate(estimate)).rejects.toThrow('estimate state');
  expect(await db.mealEstimates.count()).toBe(0);
});

test.each([
  ['requestId 过长', { requestId: 'r'.repeat(201) }],
  [
    '候选超过 30',
    {
      candidates: Array.from({ length: 31 }, (_, index) => ({
        ...mealEstimateRow().candidates[0]!,
        id: `candidate-${index}`,
      })),
    },
  ],
  ['候选 id 过长', { candidates: [{ ...mealEstimateRow().candidates[0]!, id: 'i'.repeat(201) }] }],
  ['候选名称过长', { candidates: [{ ...mealEstimateRow().candidates[0]!, name: '名'.repeat(121) }] }],
  ['候选做法过长', { candidates: [{ ...mealEstimateRow().candidates[0]!, preparation: '做'.repeat(121) }] }],
  ['候选量过小', { candidates: [{ ...mealEstimateRow().candidates[0]!, amountLow: 0.001 }] }],
  ['候选量过大', { candidates: [{ ...mealEstimateRow().candidates[0]!, amountHigh: 100_001 }] }],
  ['目录 food id 过长', { candidates: [{ ...mealEstimateRow().candidates[0]!, catalogFoodId: 'f'.repeat(201) }] }],
  [
    'provider policy 过长',
    { consent: { ...mealEstimateRow().consent!, providerPolicyVersion: 'p'.repeat(501) } },
  ],
] as Array<[string, Partial<MealEstimate>]>)(
  '拒绝估算配额违规：%s',
  async (_label, overrides) => {
    await saveConfirmedFoodItem(confirmed());
    const estimate = mealEstimateRow(overrides);
    if (overrides.requestId !== undefined && estimate.consent !== null) {
      estimate.consent.requestId = overrides.requestId;
    }
    await expect(putMealEstimate(estimate)).rejects.toThrow('estimate');
    expect(await db.mealEstimates.count()).toBe(0);
  },
);

test('清理临时状态是单事务，第二张表失败会回滚第一张表', async () => {
  await saveConfirmedFoodItem(confirmed());
  await putTemporaryState();
  vi.spyOn(db.mealEstimates, 'where').mockImplementationOnce(() => {
    throw new Error('forced clear failure');
  });
  await expect(clearMealTemporaryState('meal:2026-08-14:lunch')).rejects.toThrow(
    'forced clear failure',
  );
  expect(await db.mealPhotos.count()).toBe(1);
  expect(await db.mealEstimates.count()).toBe(1);

  vi.restoreAllMocks();
  await clearMealTemporaryState('meal:2026-08-14:lunch');
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);
});

test('删最后一项清理孤儿；删整餐的末步失败会回滚四表', async () => {
  const first = await saveConfirmedFoodItem(confirmed());
  await putTemporaryState();
  await removeMealItem(first.id);
  expect((await db.meals.get(first.mealId))?.deletedAt).not.toBeNull();
  expect((await db.mealItems.get(first.id))?.deletedAt).not.toBeNull();
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);

  const rollbackItem = await saveConfirmedFoodItem(
    confirmed({ operationId: 'rollback-1', slot: 'dinner' }),
  );
  await putTemporaryState(rollbackItem.mealId);
  vi.spyOn(db.meals, 'put').mockRejectedValueOnce(new Error('forced meal failure'));
  await expect(removeMeal(rollbackItem.mealId)).rejects.toThrow('forced meal failure');
  expect((await db.meals.get(rollbackItem.mealId))?.deletedAt).toBeNull();
  expect((await db.mealItems.get(rollbackItem.id))?.deletedAt).toBeNull();
  expect(
    await db.mealPhotos.where('mealId').equals(rollbackItem.mealId).count(),
  ).toBe(1);
  expect(
    await db.mealEstimates.where('mealId').equals(rollbackItem.mealId).count(),
  ).toBe(1);
});

test('删非最后一项保留餐次和临时状态；删整餐成功原子清理四表', async () => {
  const first = await saveConfirmedFoodItem(confirmed({ operationId: 'keep-1' }));
  const second = await saveConfirmedFoodItem(confirmed({ operationId: 'keep-2' }));
  await putTemporaryState(first.mealId);
  await removeMealItem(first.id);
  expect((await db.meals.get(first.mealId))?.deletedAt).toBeNull();
  expect((await db.mealItems.get(second.id))?.deletedAt).toBeNull();
  expect(await db.mealPhotos.count()).toBe(1);
  expect(await db.mealEstimates.count()).toBe(1);

  await removeMeal(first.mealId);
  expect((await db.meals.get(first.mealId))?.deletedAt).not.toBeNull();
  expect((await db.mealItems.get(second.id))?.deletedAt).not.toBeNull();
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);
  await expect(removeMeal(first.mealId)).resolves.toBeUndefined();
  await expect(removeMealItem(second.id)).resolves.toBeUndefined();
});

test.each([Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  '拒绝不可备份的 Date.now 值 %s 且事务不留写入',
  async (invalidNow) => {
    vi.spyOn(Date, 'now').mockReturnValue(invalidNow);
    await expect(
      saveConfirmedFoodItem(confirmed({ operationId: 'bad-clock' })),
    ).rejects.toThrow('Date.now');
    expect(await db.meals.count()).toBe(0);
    expect(await db.mealItems.count()).toBe(0);
  },
);

test('每个写操作把一次安全时钟复用到同一原子变更', async () => {
  let nextClock = 1_000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => nextClock++);
  const first = await saveConfirmedFoodItem(confirmed({ operationId: 'clock-save-1' }));
  expect(first.confirmedAt).toBe(first.updatedAt);
  expect((await db.meals.get(first.mealId))?.updatedAt).toBe(first.updatedAt);

  clock.mockClear();
  const updated = await updateMealItemAmount(first.id, 200);
  expect(Number.isSafeInteger(updated.updatedAt)).toBe(true);

  clock.mockClear();
  await removeMealItem(first.id);
  const deletedItem = await db.mealItems.get(first.id);
  const deletedMeal = await db.meals.get(first.mealId);
  expect(deletedItem?.updatedAt).toBe(deletedItem?.deletedAt);
  expect(deletedMeal?.updatedAt).toBe(deletedItem?.deletedAt);
  expect(deletedMeal?.deletedAt).toBe(deletedItem?.deletedAt);
});

test('改量要求 active parent，并以 item、parent、Date.now 最大值原子推进双方时间', async () => {
  const saved = await saveConfirmedFoodItem(confirmed({ operationId: 'monotonic-update' }));
  const meal = (await db.meals.get(saved.mealId))!;
  const parentFloor = saved.updatedAt + 10_000;
  await db.meals.put({ ...meal, updatedAt: parentFloor });
  vi.spyOn(Date, 'now').mockReturnValue(1);

  const changed = await updateMealItemAmount(saved.id, 200);
  expect(changed.updatedAt).toBe(parentFloor);
  expect((await db.meals.get(saved.mealId))?.updatedAt).toBe(parentFloor);

  await db.meals.delete(saved.mealId);
  const before = await db.mealItems.get(saved.id);
  await expect(updateMealItemAmount(saved.id, 250)).rejects.toThrow('active parent');
  expect(await db.mealItems.get(saved.id)).toEqual(before);
});

test('改量写 parent 失败会回滚 item', async () => {
  const saved = await saveConfirmedFoodItem(confirmed({ operationId: 'update-rollback' }));
  const beforeItem = await db.mealItems.get(saved.id);
  const beforeMeal = await db.meals.get(saved.mealId);
  vi.spyOn(db.meals, 'put').mockRejectedValueOnce(new Error('forced parent update failure'));

  await expect(updateMealItemAmount(saved.id, 200)).rejects.toThrow(
    'forced parent update failure',
  );
  expect(await db.mealItems.get(saved.id)).toEqual(beforeItem);
  expect(await db.meals.get(saved.mealId)).toEqual(beforeMeal);
});

test('新确认不会让已有 parent 的 updatedAt 回退', async () => {
  await db.meals.put(mealRow({ updatedAt: 9_000 }));
  vi.spyOn(Date, 'now').mockReturnValue(1_000);

  const saved = await saveConfirmedFoodItem(confirmed({ operationId: 'save-floor' }));
  expect(saved.updatedAt).toBe(9_000);
  expect(saved.confirmedAt).toBe(9_000);
  expect((await db.meals.get(saved.mealId))?.updatedAt).toBe(9_000);
});

test('同 operation 复活使用 item 与 parent 的单调时间下界', async () => {
  const first = await saveConfirmedFoodItem(confirmed({ operationId: 'revive-floor' }));
  await removeMealItem(first.id);
  const deletedItem = (await db.mealItems.get(first.id))!;
  const deletedMeal = (await db.meals.get(first.mealId))!;
  const floor = deletedMeal.updatedAt + 10_000;
  await db.mealItems.put({ ...deletedItem, updatedAt: floor, deletedAt: floor });
  await db.meals.put({ ...deletedMeal, updatedAt: floor + 1, deletedAt: floor + 1 });
  vi.spyOn(Date, 'now').mockReturnValue(1);

  const revived = await saveConfirmedFoodItem(
    confirmed({ operationId: 'revive-floor' }),
  );
  expect(revived.updatedAt).toBe(floor + 1);
  expect((await db.meals.get(first.mealId))?.updatedAt).toBe(floor + 1);
  expect(revived.deletedAt).toBeNull();
});

test('删除非最后 item 也会用单调同一时间更新 parent', async () => {
  const first = await saveConfirmedFoodItem(confirmed({ operationId: 'remove-floor-a' }));
  await saveConfirmedFoodItem(confirmed({ operationId: 'remove-floor-b' }));
  const meal = (await db.meals.get(first.mealId))!;
  const itemFloor = first.updatedAt + 5_000;
  const parentFloor = itemFloor + 5_000;
  await db.mealItems.put({ ...first, updatedAt: itemFloor });
  await db.meals.put({ ...meal, updatedAt: parentFloor });
  vi.spyOn(Date, 'now').mockReturnValue(1);

  await removeMealItem(first.id);

  const removed = await db.mealItems.get(first.id);
  expect(removed?.updatedAt).toBe(parentFloor);
  expect(removed?.deletedAt).toBe(parentFloor);
  expect((await db.meals.get(first.mealId))?.updatedAt).toBe(parentFloor);
  expect((await db.meals.get(first.mealId))?.deletedAt).toBeNull();
});

test('删整餐的所有 tombstone 共用一次安全时钟', async () => {
  const first = await saveConfirmedFoodItem(confirmed({ operationId: 'whole-clock-1' }));
  const second = await saveConfirmedFoodItem(confirmed({ operationId: 'whole-clock-2' }));
  let nextClock = 4_000;
  vi.spyOn(Date, 'now').mockImplementation(() => nextClock++);

  await removeMeal(first.mealId);

  const deletedAt = (await db.meals.get(first.mealId))?.deletedAt;
  expect((await db.meals.get(first.mealId))?.updatedAt).toBe(deletedAt);
  expect((await db.mealItems.get(first.id))?.deletedAt).toBe(deletedAt);
  expect((await db.mealItems.get(first.id))?.updatedAt).toBe(deletedAt);
  expect((await db.mealItems.get(second.id))?.deletedAt).toBe(deletedAt);
  expect((await db.mealItems.get(second.id))?.updatedAt).toBe(deletedAt);
});

test('removeMeal 在 parent 缺失时仍软删 active items 并清理临时两表', async () => {
  const first = await saveConfirmedFoodItem(confirmed({ operationId: 'missing-parent-a' }));
  const second = await saveConfirmedFoodItem(confirmed({ operationId: 'missing-parent-b' }));
  await putTemporaryState(first.mealId);
  await db.meals.delete(first.mealId);
  const floor = Math.max(first.updatedAt, second.updatedAt);
  vi.spyOn(Date, 'now').mockReturnValue(1);

  await removeMeal(first.mealId);

  expect((await db.mealItems.get(first.id))?.deletedAt).toBe(floor);
  expect((await db.mealItems.get(second.id))?.deletedAt).toBe(floor);
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);
  expect(await db.meals.get(first.mealId)).toBeUndefined();
});

test('removeMeal 收敛已删 parent 下的活动项，重复调用不漂移 tombstone', async () => {
  const item = await saveConfirmedFoodItem(confirmed({ operationId: 'deleted-parent' }));
  await putTemporaryState(item.mealId);
  const meal = (await db.meals.get(item.mealId))!;
  const floor = item.updatedAt + 10_000;
  await db.meals.put({ ...meal, updatedAt: floor, deletedAt: floor });
  vi.spyOn(Date, 'now').mockReturnValue(1);

  await removeMeal(item.mealId);
  const firstMeal = await db.meals.get(item.mealId);
  const firstItem = await db.mealItems.get(item.id);
  expect(firstMeal).toMatchObject({ updatedAt: floor, deletedAt: floor });
  expect(firstItem).toMatchObject({ updatedAt: floor, deletedAt: floor });
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);

  vi.mocked(Date.now).mockReturnValue(floor + 10_000);
  await db.mealPhotos.put(mealPhotoRow({ mealId: item.mealId, id: mealPhotoId(item.mealId) }));
  await db.mealEstimates.put(
    mealEstimateRow({ mealId: item.mealId, id: mealEstimateId(item.mealId) }),
  );
  await removeMeal(item.mealId);
  expect(await db.meals.get(item.mealId)).toEqual(firstMeal);
  expect(await db.mealItems.get(item.id)).toEqual(firstItem);
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);
});

test('removeMeal 在 parent 缺失时末步失败也会回滚 item 与临时两表', async () => {
  const item = await saveConfirmedFoodItem(confirmed({ operationId: 'missing-rollback' }));
  await putTemporaryState(item.mealId);
  await db.meals.delete(item.mealId);
  vi.spyOn(db.mealEstimates, 'where').mockImplementationOnce(() => {
    throw new Error('forced orphan cleanup failure');
  });

  await expect(removeMeal(item.mealId)).rejects.toThrow('forced orphan cleanup failure');
  expect((await db.mealItems.get(item.id))?.deletedAt).toBeNull();
  expect(await db.mealPhotos.count()).toBe(1);
  expect(await db.mealEstimates.count()).toBe(1);
});

test('保存和改量都拒绝溢出或负数营养值，不写入不可备份数据', async () => {
  await expect(
    saveConfirmedFoodItem(
      confirmed({
        operationId: 'overflow-save',
        amount: 2,
        food: foodRow({ basisAmount: 1, energyKcal: Number.MAX_VALUE }),
      }),
    ),
  ).rejects.toThrow('scaled energyKcal');
  expect(await db.meals.count()).toBe(0);
  expect(await db.mealItems.count()).toBe(0);

  const saved = await saveConfirmedFoodItem(confirmed({ operationId: 'overflow-update' }));
  const before = structuredClone(saved);
  await expect(updateMealItemAmount(saved.id, Number.MAX_VALUE)).rejects.toThrow(
    'scaled energyKcalLow',
  );
  expect(await db.mealItems.get(saved.id)).toEqual(before);

  await db.mealItems.put({ ...saved, proteinGLow: -1 });
  await expect(updateMealItemAmount(saved.id, 200)).rejects.toThrow('stored proteinGLow');
});

describe('照片估算原子确认', () => {
  test('确认前不进入日汇总；确认后一次写入餐次、两项、WebP 与脱敏状态', async () => {
    await seedConfirmableEstimate();
    expect((await listNutritionDay('2026-08-14')).summary.recordedMeals).toBe(0);
    const photoPut = vi.spyOn(db.mealPhotos, 'put');

    const rows = await confirmPhotoEstimate(confirmPhotoInput());

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.order, row.quality, row.method])).toEqual([
      [0, 'B', 'ai-confirmed'],
      [1, 'B', 'ai-confirmed'],
    ]);
    expect(new Set(rows.map((row) => row.updatedAt)).size).toBe(1);
    const parentId = mealId('2026-08-14', 'lunch');
    const meal = await db.meals.get(parentId);
    const storedItems = await db.mealItems.where('mealId').equals(parentId).toArray();
    const photo = await db.mealPhotos.get(mealPhotoId(parentId));
    const estimate = await db.mealEstimates.get(mealEstimateId(parentId));
    expect(meal).toMatchObject({ id: parentId, deletedAt: null, updatedAt: rows[0]!.updatedAt });
    expect(storedItems).toHaveLength(2);
    expect(photo).toMatchObject({
      id: mealPhotoId(parentId),
      mealId: parentId,
      size: confirmPhotoInput().thumbnail.blob.size,
      updatedAt: rows[0]!.updatedAt,
    });
    expect(photoPut.mock.calls[0]?.[0].thumbnail.type).toBe('image/webp');
    expect(photo?.mealSnapshotHash).toBe(
      await buildMealSnapshotHash(meal!, storedItems),
    );
    expect(estimate).toMatchObject({
      status: 'confirmed',
      requestId: 'request-fixture-1',
      candidates: [],
      consent: null,
      error: null,
      updatedAt: rows[0]!.updatedAt,
    });
    expect((await listNutritionDay('2026-08-14')).summary.recordedMeals).toBe(1);
  });

  test('目录食物在事务内从 Dexie 重载，调用方不能供应伪造 Food', async () => {
    await seedConfirmableEstimate();
    const input = confirmPhotoInput({ candidates: [confirmedCandidate()] });
    await db.foods.put(
      foodRow({
        id: preset.id,
        originalEnergyValue: 200,
        originalProteinG: 3,
        energyKcal: 200,
        proteinG: 3,
      }),
    );
    (input as ConfirmPhotoEstimateInput & { food?: unknown }).food = foodRow({
      energyKcal: 99_999,
      proteinG: 99_999,
    });
    const get = vi.spyOn(db.foods, 'get');

    const [row] = await confirmPhotoEstimate(input);

    expect(get).toHaveBeenCalledWith(preset.id);
    expect(row).toMatchObject({ energyKcalLow: 300, energyKcalHigh: 300 });
  });

  test('同 operation 同语义幂等；改数量、名称、缩略图或请求均冲突', async () => {
    await seedConfirmableEstimate();
    const input = confirmPhotoInput();
    const first = await confirmPhotoEstimate(input);
    await expect(confirmPhotoEstimate(confirmPhotoInput())).resolves.toEqual(first);

    await expect(
      confirmPhotoEstimate(
        confirmPhotoInput({ candidates: [confirmedCandidate()] }),
      ),
    ).rejects.toThrow('conflict');

    const changedAmount = confirmPhotoInput();
    changedAmount.candidates[0]!.confirmedAmount = 151;
    await expect(confirmPhotoEstimate(changedAmount)).rejects.toThrow('conflict');

    const changedName = confirmPhotoInput();
    changedName.candidates[0]!.confirmedName = '另一份米饭';
    await expect(confirmPhotoEstimate(changedName)).rejects.toThrow('conflict');

    const changedBytes = new Blob(
      [new Uint8Array([82, 73, 70, 70, 5, 0, 0, 0, 87, 69, 66, 80, 1])],
      { type: 'image/webp' },
    );
    await expect(
      confirmPhotoEstimate(
        confirmPhotoInput({
          thumbnail: { blob: changedBytes, width: 1, height: 1 },
        }),
      ),
    ).rejects.toThrow('conflict');

    await expect(
      confirmPhotoEstimate(confirmPhotoInput({ requestId: 'different-request' })),
    ).rejects.toThrow('request');
  });

  test('独立 operation 恰好带同名前缀数字时不破坏确认重试幂等', async () => {
    await saveConfirmedFoodItem(
      confirmed({ operationId: 'photo-confirm-1_99', amount: 100 }),
    );
    await seedConfirmableEstimate();
    const input = confirmPhotoInput();
    const first = await confirmPhotoEstimate(input);

    await expect(confirmPhotoEstimate(confirmPhotoInput())).resolves.toEqual(first);
    expect((await db.mealItems.toArray()).map((row) => row.id).sort()).toEqual([
      'meal-item:photo-confirm-1_0',
      'meal-item:photo-confirm-1_1',
      'meal-item:photo-confirm-1_99',
    ]);
  });

  test('同一 operation 跨餐次确认在全局主键覆盖前冲突关闭', async () => {
    await seedConfirmableEstimate();
    await confirmPhotoEstimate(confirmPhotoInput({ operationId: 'shared-photo' }));
    const lunchBefore = await db.mealItems
      .where('mealId')
      .equals(mealId('2026-08-14', 'lunch'))
      .toArray();
    const dinnerId = mealId('2026-08-14', 'dinner');
    const dinnerEstimate = estimateState('needs-confirmation', {
      id: mealEstimateId(dinnerId),
      mealId: dinnerId,
      requestId: 'request-dinner',
      consent: {
        ...mealEstimateRow().consent!,
        requestId: 'request-dinner',
      },
      candidates: [
        structuredClone(confirmedCandidate().candidate),
        structuredClone(modelConfirmedCandidate().candidate),
      ],
    });
    await putMealEstimate(dinnerEstimate);

    await expect(
      confirmPhotoEstimate(
        confirmPhotoInput({
          operationId: 'shared-photo',
          slot: 'dinner',
          requestId: 'request-dinner',
        }),
      ),
    ).rejects.toThrow('conflict');
    expect(
      await db.mealItems.where('mealId').equals(mealId('2026-08-14', 'lunch')).toArray(),
    ).toEqual(lunchBefore);
    expect(await db.meals.get(dinnerId)).toBeUndefined();
  });

  test.each([
    ['请求过期', { requestId: 'stale-request' }],
    ['上传哈希变化', { uploadBlobSha256: 'd'.repeat(64) }],
  ])('%s 时拒绝确认且不写营养记录', async (_label, overrides) => {
    await seedConfirmableEstimate();
    await expect(confirmPhotoEstimate(confirmPhotoInput(overrides))).rejects.toThrow();
    expect(await db.meals.count()).toBe(0);
    expect(await db.mealItems.count()).toBe(0);
    expect(await db.mealPhotos.count()).toBe(0);
  });

  test('同意已过期或状态不是 needs-confirmation 时拒绝确认', async () => {
    const estimate = await seedConfirmableEstimate();
    vi.mocked(Date.now).mockReturnValue(estimate.consent!.expiresAt);
    await expect(confirmPhotoEstimate(confirmPhotoInput())).rejects.toThrow('expired');

    await db.mealEstimates.put(estimateState('estimating', { updatedAt: estimate.updatedAt }));
    vi.mocked(Date.now).mockReturnValue(estimate.consent!.consentedAt + 1);
    await expect(confirmPhotoEstimate(confirmPhotoInput())).rejects.toThrow(
      'needs-confirmation',
    );
    expect(await db.meals.count()).toBe(0);
  });

  test('确认输入在第一个 await 前完成快照，调用方后续突变不会入库', async () => {
    await seedConfirmableEstimate();
    const input = confirmPhotoInput({ candidates: [confirmedCandidate()] });
    const pending = confirmPhotoEstimate(input);
    input.operationId = 'mutated-operation';
    input.date = '2026-08-15';
    input.slot = 'dinner';
    input.candidates[0]!.confirmedName = '突变名称';
    input.candidates[0]!.confirmedAmount = 999;
    input.thumbnail.width = 999;

    await expect(pending).resolves.toMatchObject([
      {
        id: 'meal-item:photo-confirm-1_0',
        mealId: 'meal:2026-08-14:lunch',
        name: '熟米饭',
        amount: 150,
      },
    ]);
    expect((await db.mealPhotos.toArray())[0]?.width).toBe(1);
  });

  test.each(['meals', 'mealItems', 'mealPhotos', 'mealEstimates'] as const)(
    '%s 写入失败会回滚全部五表事务写入',
    async (table) => {
      const original = await seedConfirmableEstimate();
      const method = table === 'mealItems' ? 'bulkPut' : 'put';
      vi.spyOn(db[table], method).mockRejectedValueOnce(new Error(`forced ${table} failure`));

      await expect(confirmPhotoEstimate(confirmPhotoInput())).rejects.toThrow(
        `forced ${table} failure`,
      );
      expect(await db.meals.count()).toBe(0);
      expect(await db.mealItems.count()).toBe(0);
      expect(await db.mealPhotos.count()).toBe(0);
      expect(await db.mealEstimates.get(original.id)).toEqual(original);
    },
  );

  test('两个 Dexie 连接竞态确认不会创建重复 order', async () => {
    await seedConfirmableEstimate();
    const second = new Dexie('tiezheng') as NutritionDb;
    second.version(4).stores(DB_V4_STORES);
    await second.open();
    try {
      const secondRepo = createMealRepo(second);
      const [left, right] = await Promise.all([
        confirmPhotoEstimate(confirmPhotoInput()),
        secondRepo.confirmPhotoEstimate(confirmPhotoInput()),
      ]);
      expect(left).toEqual(right);
      const active = (await db.mealItems.toArray()).filter((row) => row.deletedAt === null);
      expect(active.map((row) => row.order)).toEqual([0, 1]);
      expect(new Set(active.map((row) => row.order)).size).toBe(2);
    } finally {
      second.close();
    }
  });

  test('取消只删除估算，不删除已确认的本地缩略图', async () => {
    await seedConfirmableEstimate();
    await confirmPhotoEstimate(confirmPhotoInput());
    const parentId = mealId('2026-08-14', 'lunch');

    await clearMealEstimate(parentId);

    expect(await db.mealEstimates.get(mealEstimateId(parentId))).toBeUndefined();
    expect(await db.mealPhotos.get(mealPhotoId(parentId))).toBeDefined();
    expect((await listNutritionDay('2026-08-14')).summary.recordedMeals).toBe(1);
  });
});
