import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { seedPresets } from '../../repos/exerciseRepo';
import { savePhoto } from '../../repos/photoRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { resetDb } from '../../test/dbTestUtils';
import { shiftMonth, todayStr } from '../../lib/dates';
import { EMPTY_HEAT, heatColor } from '../../lib/heat';
import { percentile } from '../../lib/stats';
import { CalendarScreen } from './CalendarScreen';

beforeEach(async () => {
  await resetDb();
  await seedPresets();
});

const YM = todayStr().slice(0, 7);
const d = (day: string) => `${YM}-${day}`;
const CN_MONTHS = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月',
];

/** jsdom 会重新序列化颜色（alpha=1 时 rgba→rgb），两边都过同一次归一化再比。 */
function norm(color: string): string {
  const el = document.createElement('div');
  el.style.backgroundColor = color;
  return el.style.backgroundColor;
}

function setsOf(n: number) {
  return Array.from({ length: n }, () => ({ weight: 60, reps: 8 }));
}

/** 本月 6 个训练日；09 是「练爆的一天」，专门用来验证归一化取 p90 而不是 max */
async function seedMonth() {
  await addWorkoutItem(d('03'), 'p-bench', setsOf(3)); // 胸 3
  await addWorkoutItem(d('04'), 'p-pullup', setsOf(3)); // 背 3
  await addWorkoutItem(d('05'), 'p-squat', setsOf(3)); // 腿 3
  await addWorkoutItem(d('06'), 'p-bench', setsOf(3)); // 胸 3
  await addWorkoutItem(d('09'), 'p-bench', setsOf(30)); // 胸 30（怪物日）
  await addWorkoutItem(d('10'), 'p-bench', setsOf(5)); // 混合日：胸 5 + 背 2 = 7
  await addWorkoutItem(d('10'), 'p-pullup', setsOf(2));
}

/** 与页面同一套输入算出的 p90。页面必须用它归一，用 max 则下面的断言必挂。 */
const P90 = () => percentile([3, 3, 3, 3, 30, 7], 90);

function renderCal() {
  return render(
    <MemoryRouter>
      <CalendarScreen />
    </MemoryRouter>,
  );
}

const cell = (date: string) => screen.getByTestId(`day-${date}`);

/**
 * 格子在 useLiveQuery 回来之前就已经挂上了（空态底色），所以 findByTestId 会立刻返回，
 * 断言会跑在数据到达之前——必须等到热力真正落到格子上，否则整组测试都是假绿。
 */
async function waitForHeat() {
  await waitFor(() => {
    expect(cell(d('03')).querySelector('[data-part]')).toBeTruthy();
  });
}

test('月份头用大号数字 + 年份月名，星期行与上下月按钮俱在', async () => {
  renderCal();
  const [y, m] = todayStr().split('-');
  // 用 testid 而不是 getByText(m)：10/11/12 月时月份数字会和日期格里的 '10' 撞上
  expect(await screen.findByTestId('month-num')).toHaveTextContent(m); // '07'：Anton 大字，只放数字
  expect(screen.getByText(`${y} ${CN_MONTHS[Number(m) - 1]}`)).toBeInTheDocument();
  expect(screen.getByText('一')).toBeInTheDocument();
  expect(screen.getByLabelText('上个月')).toBeInTheDocument();
  expect(screen.getByLabelText('下个月')).toBeInTheDocument();
});

test('训练日格子的底色 = 当天主练部位色，浓淡按 p90 归一（不是 max）', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();

  // 胸 3 组的一天：底色是胸色，按 p90 归一
  expect(cell(d('03')).style.backgroundColor).toBe(norm(heatColor('chest', 3, P90())));

  // 关键回归：若拿 max(30) 归一，这一天会被怪物日冲淡成另一个颜色
  expect(cell(d('03')).style.backgroundColor).not.toBe(norm(heatColor('chest', 3, 30)));

  // 背 / 腿 各按自己的部位色，不共用一种橙
  expect(cell(d('04')).style.backgroundColor).toBe(norm(heatColor('back', 3, P90())));
  expect(cell(d('05')).style.backgroundColor).toBe(norm(heatColor('leg', 3, P90())));

  // 怪物日 sets ≥ p90 → alpha 封顶
  expect(cell(d('09')).style.backgroundColor).toBe(norm(heatColor('chest', 30, P90())));
});

test('训练日格子叠部位图标；混合日主练部位排在最前', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();

  expect(cell(d('03')).querySelector('[data-part="chest"]')).toBeTruthy();
  expect(cell(d('04')).querySelector('[data-part="back"]')).toBeTruthy();
  expect(cell(d('05')).querySelector('[data-part="leg"]')).toBeTruthy();

  // 混合日：胸 5 > 背 2 → 底色取胸，图标也是胸在前
  expect(cell(d('10')).style.backgroundColor).toBe(norm(heatColor('chest', 7, P90())));
  const icons = [...cell(d('10')).querySelectorAll('[data-part]')].map((e) =>
    e.getAttribute('data-part'),
  );
  expect(icons[0]).toBe('chest');
  expect(icons).toContain('back');
});

test('未训练日是 EMPTY_HEAT，且不带部位图标', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();

  expect(cell(d('20')).style.backgroundColor).toBe(norm(EMPTY_HEAT));
  expect(cell(d('20')).querySelector('[data-part]')).toBeNull();
});

test('今日格子带 aria-current，有照片的日子带相机标记', async () => {
  await seedMonth();
  await savePhoto(d('05'), new Blob(['x']));
  renderCal();
  await waitForHeat();

  expect(cell(todayStr()).getAttribute('aria-current')).toBe('date');
  expect(cell(d('05')).querySelector('[data-photo]')).toBeTruthy();
  expect(cell(d('04')).querySelector('[data-photo]')).toBeNull();
});

test('底部图例给出七个部位的图标与名称，第一次打开就能学会配色', async () => {
  renderCal();
  const legend = await screen.findByTestId('part-legend');
  for (const name of ['胸', '肩', '背', '腿', '手臂', '核心', '有氧']) {
    expect(within(legend).getByText(name)).toBeInTheDocument();
  }
  expect(legend.querySelectorAll('[data-part]')).toHaveLength(7);
  expect(within(legend).getByText('有照片')).toBeInTheDocument();
});

test('月份统计：本月打卡天数 / 最长连续 / 总组数', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();
  const stats = screen.getByTestId('month-stats');

  expect(within(stats).getByText('6')).toBeInTheDocument(); // 打卡 6 天
  expect(within(stats).getByText('4')).toBeInTheDocument(); // 03–06 连续 4 天
  expect(within(stats).getByText('49')).toBeInTheDocument(); // 3+3+3+3+30+7
  expect(within(stats).getByText('本月打卡')).toBeInTheDocument();
  expect(within(stats).getByText('最长连续')).toBeInTheDocument();
  expect(within(stats).getByText('总组数')).toBeInTheDocument();
});

test('切到上个月：月份头与网格都换成上个月', async () => {
  const user = userEvent.setup();
  await seedMonth();
  renderCal();
  await waitForHeat();

  await user.click(screen.getByLabelText('上个月'));

  const prevYm = shiftMonth(YM, -1);
  const [py, pm] = prevYm.split('-');
  expect(screen.getByTestId('month-num')).toHaveTextContent(pm);
  expect(screen.getByText(`${py} ${CN_MONTHS[Number(pm) - 1]}`)).toBeInTheDocument();
  // 上月 15 号一定在上月网格里（当月 15 号则未必——42 格窗口只覆盖到上月首周）
  expect(screen.getByTestId(`day-${prevYm}-15`)).toBeInTheDocument();
});
