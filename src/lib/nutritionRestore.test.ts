import { Blob as NodeBlob } from 'node:buffer';
import Dexie from 'dexie';
import { resetDb } from '../test/dbTestUtils';
import {
  customFoodRow,
  mealEstimateRow,
  mealItemRow,
  mealPhotoRow,
  mealRow,
  nutritionBackupSectionFixture,
  nutritionPlanRow,
  presetFoodRow,
} from '../test/nutritionBackupFixtures';
import type { NutritionBackupSection } from './nutritionBackup';
import { db } from './db';
import {
  applyNutritionRestore,
  assertNutritionMergeIdSafety,
  buildIncomingMealHashes,
  calculateNutritionRestorePlan,
  previewNutritionRestore,
} from './nutritionRestore';

beforeAll(() => vi.stubGlobal('Blob', NodeBlob));
afterAll(() => vi.unstubAllGlobals());
beforeEach(resetDb);

const invalid = (message: string): never => {
  throw new Error(message);
};

test('merge 删除冲突照片和该餐候选', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  await db.mealPhotos.add({
    id: 'meal-photo:meal:2026-08-14:lunch',
    mealId: 'meal:2026-08-14:lunch',
    thumbnail: new Blob(['private']),
    size: 7,
    width: 100,
    height: 100,
    mealSnapshotHash: 'different-hash',
    updatedAt: 10,
  });
  await db.mealEstimates.add(mealEstimateRow());

  const preview = await previewNutritionRestore(section, 'merge', hashes);

  expect(preview.photoIdsToDelete).toEqual(['meal-photo:meal:2026-08-14:lunch']);
  expect(preview.estimateIdsToDelete).toEqual([mealEstimateRow().id]);
  expect(preview.fingerprint).toEqual(expect.any(String));
});

test('merge 对相同快照 hash 的本机照片保留且删除计数为零', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  const snapshotHash = hashes.get(section.meals[0].id)!;
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), snapshotHash));

  const preview = await previewNutritionRestore(section, 'merge', hashes);

  expect(preview.photoIdsToDelete).toEqual([]);
  expect(await db.mealPhotos.count()).toBe(1);
});

test('replace 删除备份中消失餐次的照片，merge 保留它', async () => {
  const empty: NutritionBackupSection = {
    nutritionPlans: [],
    foods: [],
    meals: [],
    mealItems: [],
  };
  await db.mealPhotos.add({
    id: 'meal-photo:meal:2026-08-13:dinner',
    mealId: 'meal:2026-08-13:dinner',
    thumbnail: new Blob(['private']),
    size: 7,
    width: 100,
    height: 100,
    mealSnapshotHash: 'local-hash',
    updatedAt: 10,
  });

  expect((await previewNutritionRestore(empty, 'merge', new Map())).photoIdsToDelete).toEqual([]);
  expect((await previewNutritionRestore(empty, 'replace', new Map())).photoIdsToDelete)
    .toEqual(['meal-photo:meal:2026-08-13:dinner']);
});

test('同一预览状态产生稳定指纹，本机候选状态变化后指纹变化', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  await db.mealEstimates.add(mealEstimateRow());
  const first = await previewNutritionRestore(section, 'merge', hashes);
  const second = await previewNutritionRestore(section, 'merge', hashes);
  expect(second.fingerprint).toBe(first.fingerprint);

  await db.mealEstimates.put({
    ...mealEstimateRow(),
    requestFingerprint: 'same-id-content-changed',
    candidates: [{
      id: 'candidate:one',
      name: '米饭',
      preparation: '熟',
      amountLow: 120,
      amountHigh: 180,
      unit: 'g',
      catalogFoodId: 'food:preset:rice-cooked',
      nutrientSource: 'catalog',
      energyKcalLow: null,
      energyKcalHigh: null,
      proteinGLow: null,
      proteinGHigh: null,
      assumptions: [],
    }],
  });
  const changed = await previewNutritionRestore(section, 'merge', hashes);
  expect(changed.fingerprint).not.toBe(first.fingerprint);
});

test('同一 meal ID 改变份量会改变候选摘要和预览指纹', async () => {
  const firstSection = nutritionBackupSectionFixture();
  const firstHashes = await buildIncomingMealHashes(firstSection);
  const first = await previewNutritionRestore(firstSection, 'merge', firstHashes);

  const changedSection = structuredClone(firstSection);
  changedSection.mealItems[0].amount += 25;
  const changedHashes = await buildIncomingMealHashes(changedSection);
  const changed = await previewNutritionRestore(changedSection, 'merge', changedHashes);

  expect(changedSection.meals[0].id).toBe(firstSection.meals[0].id);
  expect(changed.fingerprint).not.toBe(first.fingerprint);
});

test('同一 meal ID 改变餐食快照内容会改变预览指纹', async () => {
  const firstSection = nutritionBackupSectionFixture();
  const first = await previewNutritionRestore(
    firstSection,
    'merge',
    await buildIncomingMealHashes(firstSection),
  );
  const changedSection = structuredClone(firstSection);
  changedSection.mealItems[0].preparation = '快照已变更';

  const changed = await previewNutritionRestore(
    changedSection,
    'merge',
    await buildIncomingMealHashes(changedSection),
  );

  expect(changed.fingerprint).not.toBe(first.fingerprint);
});

test('候选数组和 meal hash Map 的输入顺序不影响指纹', async () => {
  const section = nutritionBackupSectionFixture();
  section.foods.push({ ...structuredClone(section.foods[0]), id: 'food:custom:second' });
  section.meals.push({ id: 'meal:2026-08-15:dinner', date: '2026-08-15', slot: 'dinner' });
  section.mealItems.push({
    ...structuredClone(section.mealItems[0]),
    id: 'meal-item:second',
    mealId: 'meal:2026-08-15:dinner',
  });
  const reordered: NutritionBackupSection = {
    nutritionPlans: [...section.nutritionPlans].reverse(),
    foods: [...section.foods].reverse(),
    meals: [...section.meals].reverse(),
    mealItems: [...section.mealItems].reverse(),
  };
  const hashes = await buildIncomingMealHashes(section);
  const reversedHashes = new Map([...hashes.entries()].reverse());

  const first = await previewNutritionRestore(section, 'merge', hashes);
  const second = await previewNutritionRestore(reordered, 'merge', reversedHashes);

  expect(second.fingerprint).toBe(first.fingerprint);
});

test('指纹绑定恢复模式', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);

  const merge = await previewNutritionRestore(section, 'merge', hashes);
  const replace = await previewNutritionRestore(section, 'replace', hashes);

  expect(replace.fingerprint).not.toBe(merge.fingerprint);
});

test('照片标识、元数据及 thumbnail type/size/SHA-256 都绑定指纹', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  const firstPhoto = mealPhotoRow(
    new Blob(['first'], { type: 'image/png' }),
    'different-hash',
  );
  await db.mealPhotos.add(firstPhoto);
  const first = await previewNutritionRestore(section, 'merge', hashes);

  await db.mealPhotos.put({
    ...firstPhoto,
    thumbnail: new Blob(['other'], { type: 'image/png' }),
  });
  const bytesChanged = await previewNutritionRestore(section, 'merge', hashes);
  expect(bytesChanged.fingerprint).not.toBe(first.fingerprint);

  await db.mealPhotos.put({
    ...firstPhoto,
    thumbnail: new Blob(['other'], { type: 'image/jpeg' }),
  });
  const mimeChanged = await previewNutritionRestore(section, 'merge', hashes);
  expect(mimeChanged.fingerprint).not.toBe(bytesChanged.fingerprint);
});

test('thumbnail size 在摘要相同时仍独立绑定指纹', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  const digest = vi.spyOn(crypto.subtle, 'digest')
    .mockResolvedValue(new Uint8Array(32).buffer);
  const photo = mealPhotoRow(new Blob(['short'], { type: 'image/webp' }), 'different-hash');

  try {
    await db.mealPhotos.add(photo);
    const first = await previewNutritionRestore(section, 'merge', hashes);
    await db.mealPhotos.put({
      ...photo,
      thumbnail: new Blob(['a-longer-thumbnail'], { type: 'image/webp' }),
    });
    const changed = await previewNutritionRestore(section, 'merge', hashes);

    expect(changed.fingerprint).not.toBe(first.fingerprint);
  } finally {
    digest.mockRestore();
  }
});

const localStateMutations: Array<[string, () => Promise<unknown>]> = [
  ['workouts', () => db.workouts.add({
    id: 'workout:local', date: '2026-08-13', updatedAt: 1, deletedAt: null,
  })],
  ['workoutItems', () => db.workoutItems.add({
    id: 'workout-item:local', workoutId: 'workout:local', exerciseId: 'exercise:local',
    order: 0, sets: [{ weight: 10, reps: 10 }], updatedAt: 1, deletedAt: null,
  })],
  ['exercises', () => db.exercises.add({
    id: 'exercise:local', name: '本机动作', bodyPart: 'back', preset: false,
    updatedAt: 1, deletedAt: null,
  })],
  ['weightLogs', () => db.weightLogs.add({
    id: 'weight:local', date: '2026-08-13', weightKg: 70, updatedAt: 1, deletedAt: null,
  })],
  ['profile', () => db.profile.add({
    id: 'me', weeklyGoal: 3, onboarded: true, updatedAt: 1,
  })],
  ['nutritionPlans', () => db.nutritionPlans.add(nutritionPlanRow())],
  ['foods', () => db.foods.add(customFoodRow())],
  ['meals', () => db.meals.add(mealRow())],
  ['mealItems', () => db.mealItems.add(mealItemRow())],
  ['mealPhotos', () => db.mealPhotos.add(mealPhotoRow())],
  ['mealEstimates', () => db.mealEstimates.add(mealEstimateRow())],
];

test.each(localStateMutations)('%s 任一本机行变化都使 merge 和 replace 指纹过期', async (_table, mutate) => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  const approvedMerge = await previewNutritionRestore(section, 'merge', hashes);
  const approvedReplace = await previewNutritionRestore(section, 'replace', hashes);

  await mutate();

  expect((await previewNutritionRestore(section, 'merge', hashes)).fingerprint)
    .not.toBe(approvedMerge.fingerprint);
  expect((await previewNutritionRestore(section, 'replace', hashes)).fingerprint)
    .not.toBe(approvedReplace.fingerprint);
});

const sameIdContentMutations: Array<[
  string,
  () => Promise<unknown>,
  () => Promise<unknown>,
]> = [
  [
    'workouts',
    () => db.workouts.add({
      id: 'workout:local', date: '2026-08-13', note: '变更前', updatedAt: 1, deletedAt: null,
    }),
    () => db.workouts.put({
      id: 'workout:local', date: '2026-08-13', note: '变更后', updatedAt: 1, deletedAt: null,
    }),
  ],
  [
    'workoutItems',
    () => db.workoutItems.add({
      id: 'workout-item:local', workoutId: 'workout:local', exerciseId: 'exercise:local',
      order: 0, sets: [{ weight: 10, reps: 10 }], updatedAt: 1, deletedAt: null,
    }),
    () => db.workoutItems.put({
      id: 'workout-item:local', workoutId: 'workout:local', exerciseId: 'exercise:local',
      order: 0, sets: [{ weight: 20, reps: 10 }], updatedAt: 1, deletedAt: null,
    }),
  ],
  [
    'exercises',
    () => db.exercises.add({
      id: 'exercise:local', name: '变更前', bodyPart: 'back', preset: false,
      updatedAt: 1, deletedAt: null,
    }),
    () => db.exercises.put({
      id: 'exercise:local', name: '变更后', bodyPart: 'back', preset: false,
      updatedAt: 1, deletedAt: null,
    }),
  ],
  [
    'weightLogs',
    () => db.weightLogs.add({
      id: 'weight:local', date: '2026-08-13', weightKg: 70, updatedAt: 1, deletedAt: null,
    }),
    () => db.weightLogs.put({
      id: 'weight:local', date: '2026-08-13', weightKg: 71, updatedAt: 1, deletedAt: null,
    }),
  ],
  [
    'profile',
    () => db.profile.add({ id: 'me', weeklyGoal: 3, onboarded: true, updatedAt: 1 }),
    () => db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: 1 }),
  ],
  [
    'nutritionPlans',
    () => db.nutritionPlans.add(nutritionPlanRow()),
    () => db.nutritionPlans.put({
      ...nutritionPlanRow(), goals: { muscleGain: false, fatLoss: true },
    }),
  ],
  [
    'foods',
    () => db.foods.add(customFoodRow()),
    () => db.foods.put({ ...customFoodRow(), name: '同 ID 变更后食物' }),
  ],
  [
    'meals',
    () => db.meals.add(mealRow()),
    () => db.meals.put({ ...mealRow(), updatedAt: mealRow().updatedAt + 1 }),
  ],
  [
    'mealItems',
    () => db.mealItems.add(mealItemRow()),
    () => db.mealItems.put({ ...mealItemRow(), amount: mealItemRow().amount + 1 }),
  ],
  [
    'mealPhotos',
    () => db.mealPhotos.add(mealPhotoRow(
      new Blob(['first'], { type: 'image/webp' }),
    )),
    () => db.mealPhotos.put(mealPhotoRow(
      new Blob(['other'], { type: 'image/webp' }),
    )),
  ],
  [
    'mealEstimates',
    () => db.mealEstimates.add(mealEstimateRow()),
    () => db.mealEstimates.put({
      ...mealEstimateRow(),
      status: 'failed',
      requestFingerprint: 'same-id-content-changed',
      error: 'provider-timeout',
    }),
  ],
];

test.each(sameIdContentMutations)(
  '%s 同 ID 仅内容变化也使 merge 和 replace 指纹过期',
  async (_table, seed, mutate) => {
    const section = nutritionBackupSectionFixture();
    const hashes = await buildIncomingMealHashes(section);
    await seed();
    const approvedMerge = await previewNutritionRestore(section, 'merge', hashes);
    const approvedReplace = await previewNutritionRestore(section, 'replace', hashes);

    await mutate();

    expect((await previewNutritionRestore(section, 'merge', hashes)).fingerprint)
      .not.toBe(approvedMerge.fingerprint);
    expect((await previewNutritionRestore(section, 'replace', hashes)).fingerprint)
      .not.toBe(approvedReplace.fingerprint);
  },
);

test('calculateNutritionRestorePlan 只读计划且不会删除候选或照片', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  await db.mealPhotos.add(mealPhotoRow());
  await db.mealEstimates.add(mealEstimateRow());

  const plan = await db.transaction(
    'r',
    [
      db.workouts,
      db.workoutItems,
      db.exercises,
      db.weightLogs,
      db.profile,
      db.nutritionPlans,
      db.foods,
      db.meals,
      db.mealItems,
      db.mealPhotos,
      db.mealEstimates,
    ],
    () => calculateNutritionRestorePlan(section, 'merge', hashes),
  );

  expect(plan.photoIdsToDelete).toEqual([mealPhotoRow().id]);
  expect(plan.estimateIdsToDelete).toEqual([mealEstimateRow().id]);
  expect(await db.mealPhotos.count()).toBe(1);
  expect(await db.mealEstimates.count()).toBe(1);
});

test('merge 在写入前拒绝非目标餐次的 mealItem ID 碰撞', async () => {
  const section = nutritionBackupSectionFixture();
  await db.mealItems.add({
    ...mealItemRow(),
    id: section.mealItems[0].id,
    mealId: 'meal:2026-08-13:dinner',
  });
  expect.assertions(1);
  await expect(assertNutritionMergeIdSafety(section, 'merge', invalid))
    .rejects.toThrow('备份餐食条目 ID 与本机非目标餐次冲突');
});

test('任何模式都在写入前拒绝自定义食物 ID 碰撞本机预设', async () => {
  const section = nutritionBackupSectionFixture();
  await db.foods.add({ ...presetFoodRow(), id: section.foods[0].id });

  for (const mode of ['merge', 'replace'] as const) {
    await expect(assertNutritionMergeIdSafety(section, mode, invalid))
      .rejects.toThrow('备份自定义食物 ID 与本机预设食物冲突');
  }
});

test('merge 在写入前拒绝同 ID 但业务身份不同的自定义食物', async () => {
  const section = nutritionBackupSectionFixture();
  await db.foods.add({ ...customFoodRow(), name: '另一种食物' });

  await expect(assertNutritionMergeIdSafety(section, 'merge', invalid))
    .rejects.toThrow('备份自定义食物 ID 与本机不同食物业务身份冲突');
});

test('merge 允许同生效日营养计划由备份整体替换', async () => {
  const section = nutritionBackupSectionFixture();
  await db.nutritionPlans.add({
    ...nutritionPlanRow(),
    goals: { muscleGain: false, fatLoss: true },
  });

  await expect(assertNutritionMergeIdSafety(section, 'merge', invalid))
    .resolves.toBeUndefined();

  const preview = await previewNutritionRestore(
    section,
    'merge',
    await buildIncomingMealHashes(section),
  );
  await db.transaction(
    'rw',
    [db.nutritionPlans, db.foods, db.meals, db.mealItems, db.mealPhotos, db.mealEstimates],
    () => applyNutritionRestore(section, 'merge', preview, 500),
  );

  expect(await db.nutritionPlans.get(section.nutritionPlans[0].id)).toMatchObject({
    goals: section.nutritionPlans[0].goals,
    updatedAt: 500,
    deletedAt: null,
  });
});

test('merge 拒绝同生效日却使用不同确定性 ID 的本机计划', async () => {
  const section = nutritionBackupSectionFixture();
  await db.nutritionPlans.add({ ...nutritionPlanRow(), id: 'nutrition-plan:legacy-id' });

  await expect(assertNutritionMergeIdSafety(section, 'merge', invalid))
    .rejects.toThrow('备份营养计划 ID 与本机不同计划业务身份冲突');
});

test('merge 拒绝同 ID 却属于不同生效日的本机计划', async () => {
  const section = nutritionBackupSectionFixture();
  await db.nutritionPlans.add({ ...nutritionPlanRow(), effectiveFrom: '2026-08-13' });

  await expect(assertNutritionMergeIdSafety(section, 'merge', invalid))
    .rejects.toThrow('备份营养计划 ID 与本机不同计划业务身份冲突');
});

test.each(['nutrition-plan:0000-legacy', 'nutrition-plan:legacy-id'])(
  'merge 检查同日全部本机计划，不受异常 ID 排序影响：%s',
  async (duplicateId) => {
    const section = nutritionBackupSectionFixture();
    await db.nutritionPlans.bulkAdd([
      nutritionPlanRow(),
      { ...nutritionPlanRow(), id: duplicateId },
    ]);

    await expect(assertNutritionMergeIdSafety(section, 'merge', invalid))
      .rejects.toThrow('备份营养计划 ID 与本机不同计划业务身份冲突');
  },
);

test('恶意候选的命名空间和父子引用在任何写入前拒绝', async () => {
  const badFood = nutritionBackupSectionFixture();
  badFood.foods[0].id = 'food:preset:not-custom';
  await expect(assertNutritionMergeIdSafety(badFood, 'replace', invalid))
    .rejects.toThrow('自定义食物 ID 必须使用 food:custom: 命名空间');

  const orphan = nutritionBackupSectionFixture();
  orphan.mealItems[0].mealId = 'meal:2026-08-13:dinner';
  await expect(assertNutritionMergeIdSafety(orphan, 'replace', invalid))
    .rejects.toThrow('餐食条目引用了不存在的餐次');

  expect(await db.foods.count()).toBe(0);
  expect(await db.meals.count()).toBe(0);
  expect(await db.mealItems.count()).toBe(0);
});

test('replace 允许覆盖本机自定义食物和计划业务身份', async () => {
  const section = nutritionBackupSectionFixture();
  await db.foods.add({ ...customFoodRow(), name: '本机不同食物' });
  await db.nutritionPlans.add({
    ...nutritionPlanRow(),
    goals: { muscleGain: false, fatLoss: true },
  });

  await expect(assertNutritionMergeIdSafety(section, 'replace', invalid)).resolves.toBeUndefined();
});

test('applyNutritionRestore 物理删除预览指定的照片和候选', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  await db.mealPhotos.add(mealPhotoRow(new Blob(['private']), 'different-hash'));
  await db.mealEstimates.add(mealEstimateRow());
  const plan = await previewNutritionRestore(section, 'merge', hashes);

  await db.transaction(
    'rw',
    [
      db.nutritionPlans,
      db.foods,
      db.meals,
      db.mealItems,
      db.mealPhotos,
      db.mealEstimates,
    ],
    () => applyNutritionRestore(section, 'merge', plan, 100),
  );

  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);
  expect(await db.meals.get(section.meals[0].id)).toBeDefined();
});

test('merge 保留非目标餐次的餐食、照片和未保存候选', async () => {
  const section = nutritionBackupSectionFixture();
  const localMeal = {
    ...mealRow(),
    id: 'meal:2026-08-13:dinner',
    date: '2026-08-13',
    slot: 'dinner' as const,
  };
  const localItem = {
    ...mealItemRow(),
    id: 'meal-item:local',
    mealId: localMeal.id,
  };
  const localPhoto = {
    ...mealPhotoRow(),
    id: `meal-photo:${localMeal.id}`,
    mealId: localMeal.id,
  };
  const localEstimate = {
    ...mealEstimateRow(),
    id: `meal-estimate:${localMeal.id}`,
    mealId: localMeal.id,
  };
  await db.meals.add(localMeal);
  await db.mealItems.add(localItem);
  await db.mealPhotos.add(localPhoto);
  await db.mealEstimates.add(localEstimate);
  const plan = await previewNutritionRestore(
    section,
    'merge',
    await buildIncomingMealHashes(section),
  );

  await db.transaction(
    'rw',
    [db.nutritionPlans, db.foods, db.meals, db.mealItems, db.mealPhotos, db.mealEstimates],
    () => applyNutritionRestore(section, 'merge', plan, 200),
  );

  expect(await db.meals.get(localMeal.id)).toEqual(localMeal);
  expect(await db.mealItems.get(localItem.id)).toEqual(localItem);
  expect(await db.mealPhotos.get(localPhoto.id)).toBeDefined();
  expect(await db.mealEstimates.get(localEstimate.id)).toEqual(localEstimate);
});

test('replace 清理本机营养数据但保留预设食物，恢复行统一去软删并重打时间', async () => {
  const section = nutritionBackupSectionFixture();
  const localFood = { ...customFoodRow(), id: 'food:custom:local', name: '本机食物' };
  const localMeal = {
    ...mealRow(), id: 'meal:2026-08-13:dinner', date: '2026-08-13', slot: 'dinner' as const,
  };
  await db.foods.bulkAdd([presetFoodRow(), localFood]);
  await db.meals.add(localMeal);
  await db.mealPhotos.add({
    ...mealPhotoRow(), id: `meal-photo:${localMeal.id}`, mealId: localMeal.id,
  });
  await db.mealEstimates.add({
    ...mealEstimateRow(), id: `meal-estimate:${localMeal.id}`, mealId: localMeal.id,
  });
  const plan = await previewNutritionRestore(
    section,
    'replace',
    await buildIncomingMealHashes(section),
  );

  await db.transaction(
    'rw',
    [db.nutritionPlans, db.foods, db.meals, db.mealItems, db.mealPhotos, db.mealEstimates],
    () => applyNutritionRestore(section, 'replace', plan, 300),
  );

  expect(await db.foods.get(presetFoodRow().id)).toEqual(presetFoodRow());
  expect(await db.foods.get(localFood.id)).toBeUndefined();
  expect(await db.meals.get(localMeal.id)).toBeUndefined();
  expect(await db.mealPhotos.count()).toBe(0);
  expect(await db.mealEstimates.count()).toBe(0);
  expect(await db.nutritionPlans.get(section.nutritionPlans[0].id))
    .toMatchObject({ updatedAt: 300, deletedAt: null });
  expect(await db.foods.get(section.foods[0].id))
    .toMatchObject({ preset: false, updatedAt: 300, deletedAt: null });
  expect(await db.meals.get(section.meals[0].id))
    .toMatchObject({ updatedAt: 300, deletedAt: null });
  expect(await db.mealItems.get(section.mealItems[0].id))
    .toMatchObject({ updatedAt: 300, deletedAt: null });
});

test('applyNutritionRestore 必须由调用方提供事务，无事务时在首写前拒绝', async () => {
  const section = nutritionBackupSectionFixture();
  const plan = await previewNutritionRestore(
    section,
    'merge',
    await buildIncomingMealHashes(section),
  );

  await expect(applyNutritionRestore(section, 'merge', plan, 100))
    .rejects.toThrow('营养恢复必须在调用方事务内执行');
  expect(await db.nutritionPlans.count()).toBe(0);
  expect(await db.foods.count()).toBe(0);
  expect(await db.meals.count()).toBe(0);
  expect(await db.mealItems.count()).toBe(0);
});

test('异库 ambient transaction 不能伪装成恢复事务', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  const plan = await previewNutritionRestore(section, 'merge', hashes);
  const foreign = new Dexie('nutrition-restore-foreign');
  foreign.version(1).stores({ sentinel: 'id' });
  await foreign.open();

  try {
    await expect(foreign.transaction('rw', foreign.table('sentinel'), () =>
      Dexie.waitFor(applyNutritionRestore(section, 'merge', plan, 100))))
      .rejects.toThrow('营养恢复必须在调用方事务内执行');
  } finally {
    foreign.close();
    await foreign.delete();
  }

  expect(await db.nutritionPlans.count()).toBe(0);
  expect(await db.foods.count()).toBe(0);
  expect(await db.meals.count()).toBe(0);
  expect(await db.mealItems.count()).toBe(0);
});

test('异库 ambient transaction 不能伪装成只读预览事务', async () => {
  const section = nutritionBackupSectionFixture();
  const hashes = await buildIncomingMealHashes(section);
  const foreign = new Dexie('nutrition-preview-foreign');
  foreign.version(1).stores({ sentinel: 'id' });
  await foreign.open();

  try {
    await expect(foreign.transaction('r', foreign.table('sentinel'), () =>
      Dexie.waitFor(calculateNutritionRestorePlan(section, 'merge', hashes))))
      .rejects.toThrow('营养恢复计划必须在调用方只读或写事务内计算');
  } finally {
    foreign.close();
    await foreign.delete();
  }
});

test('调用方事务中途失败会回滚照片、候选和营养写入', async () => {
  const section = nutritionBackupSectionFixture();
  await db.mealPhotos.add(mealPhotoRow());
  await db.mealEstimates.add(mealEstimateRow());
  const plan = await previewNutritionRestore(
    section,
    'merge',
    await buildIncomingMealHashes(section),
  );
  const bulkPut = vi.spyOn(db.mealItems, 'bulkPut').mockRejectedValueOnce(new Error('boom'));

  try {
    await expect(db.transaction(
      'rw',
      [db.nutritionPlans, db.foods, db.meals, db.mealItems, db.mealPhotos, db.mealEstimates],
      () => applyNutritionRestore(section, 'merge', plan, 100),
    )).rejects.toThrow('boom');
  } finally {
    bulkPut.mockRestore();
  }

  expect(await db.mealPhotos.count()).toBe(1);
  expect(await db.mealEstimates.count()).toBe(1);
  expect(await db.nutritionPlans.count()).toBe(0);
  expect(await db.foods.count()).toBe(0);
  expect(await db.meals.count()).toBe(0);
  expect(await db.mealItems.count()).toBe(0);
});
