import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PRESET_FOODS } from '../../data/presetFoods';
import { track } from '../../lib/analytics';
import { db } from '../../lib/db';
import { evaluateNutritionDay } from '../../lib/nutritionStats';
import { listNutritionDay, saveConfirmedFoodItem } from '../../repos/mealRepo';
import { resetDb } from '../../test/dbTestUtils';
import { mealItemRow, mealRow, nutritionPlanRow } from '../../test/nutritionFixtures';
import { TodayNutritionSummary } from './TodayNutritionSummary';

vi.mock('../../lib/analytics', { spy: true });

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await resetDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function summaryTree(date: string) {
  return (
    <StrictMode>
      <MemoryRouter>
        <TodayNutritionSummary date={date} />
      </MemoryRouter>
    </StrictMode>
  );
}

function renderSummary(date: string) {
  return render(summaryTree(date));
}

test('读取本地数据期间显示显式 loading，且不闪出零值摘要', () => {
  const { container } = renderSummary('2026-08-14');

  expect(screen.getByText('正在读取饮食记录')).toBeInTheDocument();
  expect(container).not.toHaveTextContent(/0 kcal|0 g 蛋白质|已记录 0 \/ 4 餐/);
  expect(screen.queryByLabelText('今日目标状态')).not.toBeInTheDocument();
});

test('无记录、无计划时保留中性空态、低强调入口和关闭的目标评价', async () => {
  const { container } = renderSummary('2026-08-14');

  expect(await screen.findByText('记录今天吃了什么')).toBeInTheDocument();
  expect(screen.queryByText('今天还没有已确认食物')).not.toBeInTheDocument();
  expect(container).not.toHaveTextContent(/0 kcal|0 g 蛋白质|已记录 0 \/ 4 餐/);
  expect(screen.getByLabelText('今日目标状态')).toHaveTextContent('目标评价未开启');
  expect(screen.getByRole('link', { name: '进入健康' })).toHaveAttribute('href', '/health');
  expect(container.querySelector('.heat')).toBeNull();
  expect(container).not.toHaveTextContent(/进度|分数|惩罚|达标|失败/);
});

test('目标评价使用 polite 状态区域向读屏器暴露更新', async () => {
  renderSummary('2026-08-14');
  await screen.findByText('记录今天吃了什么');

  const status = screen.getByRole('status', { name: '今日目标状态' });
  expect(status).toHaveAttribute('aria-live', 'polite');
  expect(status).toHaveTextContent('目标评价未开启');
});

test('无记录但已有计划时显示共享的两个中性评价', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const plan = nutritionPlanRow();
  await db.nutritionPlans.put(plan);
  const expected = evaluateNutritionDay((await listNutritionDay('2026-08-14')).summary, plan);

  renderSummary('2026-08-14');

  expect(await screen.findByText('今天还没有已确认食物')).toBeInTheDocument();
  expect(screen.queryByText('记录今天吃了什么')).not.toBeInTheDocument();
  const status = screen.getByLabelText('今日目标状态');
  expect(status).toHaveTextContent(expected.protein.message);
  expect(status).toHaveTextContent(expected.energy.message);
});

test('挂载后新增本地计划会实时刷新空态与两个评价维度', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const plan = nutritionPlanRow();
  const expected = evaluateNutritionDay((await listNutritionDay('2026-08-14')).summary, plan);
  renderSummary('2026-08-14');
  expect(await screen.findByText('记录今天吃了什么')).toBeInTheDocument();
  expect(screen.getByRole('status', { name: '今日目标状态' })).toHaveTextContent(
    '目标评价未开启',
  );

  await act(async () => {
    await db.nutritionPlans.put(plan);
  });

  expect(await screen.findByText('今天还没有已确认食物')).toBeInTheDocument();
  const status = screen.getByRole('status', { name: '今日目标状态' });
  expect(status).toHaveTextContent(expected.protein.message);
  expect(status).toHaveTextContent(expected.energy.message);
});

test('点击入口只上报 health_opened', async () => {
  const user = userEvent.setup();
  renderSummary('2026-08-14');

  await user.click(await screen.findByRole('link', { name: '进入健康' }));

  expect(track).toHaveBeenCalledWith('health_opened');
  expect(track).toHaveBeenCalledTimes(1);
});

test('有记录但无计划时显示真实摄入并关闭目标评价', async () => {
  await saveConfirmedFoodItem({
    operationId: 'today-rice',
    date: '2026-08-14',
    slot: 'lunch',
    food: PRESET_FOODS[0],
    amount: 150,
  });

  renderSummary('2026-08-14');

  expect(await screen.findByText('195 kcal · 4 g 蛋白质')).toBeInTheDocument();
  expect(screen.getByText('已记录 1 / 4 餐')).toBeInTheDocument();
  expect(screen.getByLabelText('今日目标状态')).toHaveTextContent('目标评价未开启');
  expect(screen.getByRole('link', { name: '进入健康' })).toHaveAttribute('href', '/health');
});

test('餐次按 distinct slot 计数，同一餐多项食物仍只算一餐', async () => {
  await saveConfirmedFoodItem({
    operationId: 'today-lunch-rice',
    date: '2026-08-14',
    slot: 'lunch',
    food: PRESET_FOODS[0],
    amount: 150,
  });
  await saveConfirmedFoodItem({
    operationId: 'today-lunch-rice-second',
    date: '2026-08-14',
    slot: 'lunch',
    food: PRESET_FOODS[0],
    amount: 100,
  });
  await saveConfirmedFoodItem({
    operationId: 'today-breakfast-rice',
    date: '2026-08-14',
    slot: 'breakfast',
    food: PRESET_FOODS[0],
    amount: 100,
  });

  renderSummary('2026-08-14');

  expect(await screen.findByText('已记录 2 / 4 餐')).toBeInTheDocument();
});

test('B 级区间保留约数范围而不压成中点', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  await db.meals.put(mealRow());
  await db.mealItems.put(
    mealItemRow({
      originalEnergyValue: 240,
      originalProteinG: 50 / 3,
      energyKcal: 240,
      proteinG: 50 / 3,
      energyKcalLow: 300,
      energyKcalHigh: 420,
      proteinGLow: 20,
      proteinGHigh: 30,
      quality: 'B',
    }),
  );
  const plan = nutritionPlanRow({
    targetRanges: {
      ...nutritionPlanRow().targetRanges,
      proteinLowG: 25,
      proteinHighG: 35,
      proteinReferenceG: 30,
    },
    targetMode: {
      ...nutritionPlanRow().targetMode,
      protein: 'range',
      evaluationPolicy: 'protein-range',
      autoTargetsEnabled: true,
      reason: 'active',
    },
  });
  await db.nutritionPlans.put(plan);
  const expected = evaluateNutritionDay((await listNutritionDay('2026-08-14')).summary, plan);

  renderSummary('2026-08-14');

  expect(await screen.findByText('约 300–420 kcal / 20–30 g 蛋白质')).toBeInTheDocument();
  const status = screen.getByLabelText('今日目标状态');
  expect(status).toHaveTextContent(expected.protein.message);
  expect(status).toHaveTextContent(expected.energy.message);
});

test('flag on 时 Today 逐字显示共享评价函数的两个独立维度', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', 'true');
  const plan = nutritionPlanRow();
  await db.nutritionPlans.put(plan);
  await saveConfirmedFoodItem({
    operationId: 'today-low-protein',
    date: '2026-08-14',
    slot: 'lunch',
    food: PRESET_FOODS[0],
    amount: 150,
  });
  const day = await listNutritionDay('2026-08-14');
  const expected = evaluateNutritionDay(day.summary, plan);
  expect(expected.protein.message).toContain('蛋白质相对建议范围偏低');

  renderSummary('2026-08-14');

  await screen.findByText(expected.protein.message);
  const status = screen.getByLabelText('今日目标状态');
  expect(status).toHaveTextContent(expected.protein.message);
  expect(status).toHaveTextContent(expected.energy.message);
});

test('当前 flag off 会压过历史 active 计划快照', async () => {
  vi.stubEnv('VITE_ENABLE_AUTO_NUTRITION_TARGETS', '');
  const plan = nutritionPlanRow();
  await db.nutritionPlans.put(plan);
  await saveConfirmedFoodItem({
    operationId: 'today-kill-switch',
    date: '2026-08-14',
    slot: 'lunch',
    food: PRESET_FOODS[0],
    amount: 150,
  });
  const day = await listNutritionDay('2026-08-14');
  const hidden = evaluateNutritionDay(day.summary, plan);

  renderSummary('2026-08-14');

  const status = await screen.findByLabelText('今日目标状态');
  expect(status).toHaveTextContent('目标评价未开启');
  expect(status).not.toHaveTextContent(hidden.protein.message);
  expect(status).not.toHaveTextContent(hidden.energy.message);
});

test('挂载后保存 150g 米饭会实时刷新本地摘要', async () => {
  renderSummary('2026-08-14');
  expect(await screen.findByText('记录今天吃了什么')).toBeInTheDocument();

  await act(async () => {
    await saveConfirmedFoodItem({
      operationId: 'today-live-rice',
      date: '2026-08-14',
      slot: 'lunch',
      food: PRESET_FOODS[0],
      amount: 150,
    });
  });

  expect(await screen.findByText('195 kcal · 4 g 蛋白质')).toBeInTheDocument();
  expect(screen.getByText('已记录 1 / 4 餐')).toBeInTheDocument();
});

test('切换 date 时不会把上一天的摘要短暂显示到新日期', async () => {
  await saveConfirmedFoodItem({
    operationId: 'today-date-switch-rice',
    date: '2026-08-14',
    slot: 'lunch',
    food: PRESET_FOODS[0],
    amount: 150,
  });
  const view = renderSummary('2026-08-14');
  expect(await screen.findByText('195 kcal · 4 g 蛋白质')).toBeInTheDocument();

  view.rerender(summaryTree('2026-08-15'));

  expect(screen.getByText('正在读取饮食记录')).toBeInTheDocument();
  expect(screen.queryByText('195 kcal · 4 g 蛋白质')).not.toBeInTheDocument();
  expect(await screen.findByText('记录今天吃了什么')).toBeInTheDocument();
});
