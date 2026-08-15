import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '../lib/db';
import { buildNutritionPlan } from '../lib/nutritionPlan';
import { resetDb } from '../test/dbTestUtils';
import { nutritionPlanRow } from '../test/nutritionFixtures';
import {
  getEffectiveNutritionPlan,
  listNutritionPlans,
  removeNutritionPlan,
  saveNutritionPlan,
} from './nutritionPlanRepo';

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

function validPlan(effectiveFrom: string, updatedAt: number, id = 'ignored') {
  const plan = nutritionPlanRow({ id, effectiveFrom, updatedAt });
  plan.equationInputs.calculatedAt = updatedAt;
  if (effectiveFrom === '2026-08-01') {
    plan.safetyInputs.basisWeightDate = '2026-08-01';
    plan.safetyInputs.targetDate = '2026-11-21';
  }
  return plan;
}

function differentValidPlan(updatedAt: number) {
  const fixture = nutritionPlanRow();
  const { eligibilityBlockers: _ignored, ...safetyInputs } = fixture.safetyInputs;
  void _ignored;
  return buildNutritionPlan(
    {
      effectiveFrom: fixture.effectiveFrom,
      goals: { muscleGain: false, fatLoss: false },
      safetyInputs,
      equationInputs: {
        equationBranch: fixture.equationInputs.equationBranch,
        activityInputs: structuredClone(fixture.equationInputs.activityInputs),
        activityCategoryLow: fixture.equationInputs.activityCategoryLow,
        activityCategoryHigh: fixture.equationInputs.activityCategoryHigh,
      },
    },
    { autoTargetsEnabled: true, now: updatedAt },
  );
}

test('同日计划使用确定 id 覆盖，历史日选最新生效版', async () => {
  const firstSaved = await saveNutritionPlan(validPlan('2026-08-01', 1));
  expect(firstSaved.id).toBe('nutrition-plan:2026-08-01');

  await saveNutritionPlan(validPlan('2026-08-14', 2, 'ignored-again'));
  await saveNutritionPlan(validPlan('2026-08-14', 3, 'third'));

  expect(await db.nutritionPlans.count()).toBe(2);
  expect(await getEffectiveNutritionPlan('2026-07-31')).toBeUndefined();
  expect((await getEffectiveNutritionPlan('2026-08-13'))?.effectiveFrom).toBe('2026-08-01');
  expect((await getEffectiveNutritionPlan('2026-08-14'))?.updatedAt).toBe(3);
  expect((await listNutritionPlans()).map((plan) => plan.effectiveFrom)).toEqual([
    '2026-08-14',
    '2026-08-01',
  ]);
});

test('删除是软删除，生效查询自动回退到上一个有效版本', async () => {
  const now = Date.parse('2026-08-20T00:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  await saveNutritionPlan(validPlan('2026-08-01', 1, 'older'));
  await saveNutritionPlan(validPlan('2026-08-14', 2, 'newer'));

  await removeNutritionPlan('2026-08-14');

  expect((await getEffectiveNutritionPlan('2026-08-20'))?.effectiveFrom).toBe('2026-08-01');
  expect((await listNutritionPlans()).map((plan) => plan.effectiveFrom)).toEqual(['2026-08-01']);
  expect(await db.nutritionPlans.count()).toBe(2);
  expect((await db.nutritionPlans.get('nutrition-plan:2026-08-14'))?.deletedAt).toBe(now);
});

test('删除计划幂等，同日重新保存会复活确定 id 行', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(200);
  await saveNutritionPlan(validPlan('2026-08-14', 100));
  await removeNutritionPlan('2026-08-14');
  await expect(removeNutritionPlan('2026-08-14')).resolves.toBeUndefined();

  const revived = await saveNutritionPlan(validPlan('2026-08-14', 300));

  expect(revived).toMatchObject({
    id: 'nutrition-plan:2026-08-14',
    updatedAt: 300,
    deletedAt: null,
  });
  expect(await db.nutritionPlans.count()).toBe(1);
});

test('较旧 updatedAt 不能覆盖同日较新计划', async () => {
  const newer = await saveNutritionPlan(validPlan('2026-08-14', 200));

  await expect(saveNutritionPlan(validPlan('2026-08-14', 100))).rejects.toThrow('stale');

  expect(await db.nutritionPlans.get(newer.id)).toEqual(newer);
});

test('相同 updatedAt 与相同完整语义幂等，不同语义 fail closed', async () => {
  const first = await saveNutritionPlan(validPlan('2026-08-14', 200));

  await expect(
    saveNutritionPlan(validPlan('2026-08-14', 200, 'ignored-id-again')),
  ).resolves.toEqual(first);
  await expect(saveNutritionPlan(differentValidPlan(200))).rejects.toThrow('conflict');
  expect(await db.nutritionPlans.get(first.id)).toEqual(first);
});

test('同日并发逆序保存最终不能让低 updatedAt 覆盖高 updatedAt', async () => {
  const outcomes = await Promise.allSettled([
    saveNutritionPlan(validPlan('2026-08-14', 200)),
    saveNutritionPlan(validPlan('2026-08-14', 100)),
  ]);

  expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
  expect((await db.nutritionPlans.get('nutrition-plan:2026-08-14'))?.updatedAt).toBe(200);
});

test('较新删除不能被旧保存或同时间戳激活意图复活', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(200);
  await saveNutritionPlan(validPlan('2026-08-14', 100));
  await removeNutritionPlan('2026-08-14');

  await expect(saveNutritionPlan(validPlan('2026-08-14', 150))).rejects.toThrow('stale');
  const equalTimestampReactivation = validPlan('2026-08-14', 100);
  equalTimestampReactivation.updatedAt = 200;
  await expect(saveNutritionPlan(equalTimestampReactivation)).rejects.toThrow('conflict');

  expect(await db.nutritionPlans.get('nutrition-plan:2026-08-14')).toMatchObject({
    updatedAt: 200,
    deletedAt: 200,
  });
  expect(await getEffectiveNutritionPlan('2026-08-14')).toBeUndefined();
});

test('系统时钟回退时 tombstone 版本不倒退，只有严格更高版本可复活', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(200);
  await saveNutritionPlan(validPlan('2026-08-14', 300));

  await removeNutritionPlan('2026-08-14');

  expect(await db.nutritionPlans.get('nutrition-plan:2026-08-14')).toMatchObject({
    updatedAt: 300,
    deletedAt: 300,
  });
  await expect(saveNutritionPlan(validPlan('2026-08-14', 250))).rejects.toThrow('stale');
  await expect(saveNutritionPlan(validPlan('2026-08-14', 300))).rejects.toThrow('conflict');
  await expect(saveNutritionPlan(validPlan('2026-08-14', 301))).resolves.toMatchObject({
    updatedAt: 301,
    deletedAt: null,
  });
});

test.each([Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  '删除时 Date.now=%s 非合法 safe timestamp 时 fail closed',
  async (clock) => {
    vi.spyOn(Date, 'now').mockReturnValue(clock);
    const active = await saveNutritionPlan(validPlan('2026-08-14', 100));

    await expect(removeNutritionPlan('2026-08-14')).rejects.toThrow('timestamp');

    expect(await db.nutritionPlans.get(active.id)).toEqual(active);
  },
);

test('持久化前调用共享语义门，无效或伪造计划不入库', async () => {
  const invalidAge = structuredClone(nutritionPlanRow());
  invalidAge.safetyInputs.ageYears = 0;
  await expect(saveNutritionPlan(invalidAge)).rejects.toThrow();

  const forged = structuredClone(nutritionPlanRow());
  forged.targetRanges.proteinLowG = 999;
  await expect(saveNutritionPlan(forged)).rejects.toThrow('canonical policy');

  const invalidTime = structuredClone(nutritionPlanRow());
  invalidTime.updatedAt = Number.NaN;
  await expect(saveNutritionPlan(invalidTime)).rejects.toThrow('finite');
  expect(await db.nutritionPlans.count()).toBe(0);
});

test.each(['', '2026-2-03', '2026-02-30'])('所有日期入口拒绝非法日期 %j', async (date) => {
  await expect(getEffectiveNutritionPlan(date)).rejects.toThrow('date');
  await expect(removeNutritionPlan(date)).rejects.toThrow('date');
  await expect(saveNutritionPlan(validPlan(date, 1))).rejects.toThrow('date');
  expect(await db.nutritionPlans.count()).toBe(0);
});
