import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { seedPresets } from '../repos/exerciseRepo';
import { addWorkoutItem } from '../repos/workoutRepo';
import { resetDb } from '../test/dbTestUtils';
import { CalendarScreen } from './calendar/CalendarScreen';
import { ProfileScreen } from './profile/ProfileScreen';
import { TodayScreen } from './today/TodayScreen';

/**
 * 全站命名不变量：**一个名词只指一个量。**
 *
 * 这不是文案洁癖。用户在首页记住「个人纪录 12 天」，翻到「我的」点开「个人纪录 · PR」，
 * 看到的是卧推 103.3kg —— 他不会想「哦这是两个不同的指标」，他会想「这 app 算错了」。
 * 同理「最长连续」：日历页算的是**本月**（还随手指往左划而变），我的页和数据页算的是
 * **终身**。同一个词，两个数，用户没有任何线索知道哪个是真的。
 *
 * 定下的规矩：
 * - **最长连续** = 全时段最长连续训练天数。一个人的一个成就，全站同一个数。
 * - 日历页那个随月份漂移的数**不叫这个名字** —— 它叫「本月最长连续」，口径写进名字里。
 * - **个人纪录 / PR** 这个词只归 e1RM 重量榜（「我的」页），别处一律不许用。
 *
 * 跨屏契约没法由任何单屏的测试文件持有，所以它住在这里。
 */

const TODAY = '2026-07-15'; // 周三
vi.mock('../lib/dates', async (orig) => ({
  ...(await orig<typeof import('../lib/dates')>()),
  todayStr: () => TODAY,
}));

beforeEach(async () => {
  await resetDb();
  await seedPresets();
  localStorage.clear();
});

/**
 * 让两个口径必然打架的 fixture：
 *   6 月连练 5 天（终身最长 = 5），7 月练 3 天但只连了 2 天（本月最长 = 2）。
 * 口径一混，两个数就会互相冒充。
 *
 * 三个月度数字（打卡 3 / 最长连续 2 / 组数 5）必须互不相等 —— 否则断言到底命中了哪一格，
 * 测试自己也说不清。
 */
async function seed() {
  for (const d of ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']) {
    await addWorkoutItem(d, 'p-bench', [{ weight: 60, reps: 8 }]);
  }
  const two = [
    { weight: 60, reps: 8 },
    { weight: 60, reps: 8 },
  ];
  await addWorkoutItem('2026-07-01', 'p-bench', [{ weight: 60, reps: 8 }]); // 孤立的一天
  await addWorkoutItem('2026-07-13', 'p-bench', two);
  await addWorkoutItem('2026-07-14', 'p-bench', two);
}

function renderAt(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

test('首页说的是「最长连续」，不是「个人纪录」——那个词归 PR 榜', async () => {
  await seed();
  renderAt(<TodayScreen />);

  // 今天没练，昨天练了 → 当前连续从昨天算 = 2；终身最长 = 5（六月那一串）
  await screen.findByText(/连续 2 天/);
  expect(document.body.textContent).toContain('最长连续 5 天');
  expect(document.body.textContent).not.toContain('个人纪录');
});

test('「我的」页的「最长连续」是终身口径，和首页同一个数', async () => {
  await seed();
  renderAt(<ProfileScreen />);

  const cell = (await screen.findByText('最长连续')).closest('div') as HTMLElement;
  expect(within(cell).getByText('5')).toBeInTheDocument();
});

test('日历页那个随翻月漂移的数不许叫「最长连续」——它是「本月最长连续」', async () => {
  await seed();
  renderAt(<CalendarScreen />);

  const stats = await screen.findByTestId('month-stats');
  // 日历页的 label 本身就是 <div>，closest('div') 会返回它自己 —— 要的是它的父格
  const cell = within(stats).getByText('本月最长连续').parentElement as HTMLElement;
  expect(within(cell).getByText('2')).toBeInTheDocument(); // 07-13..07-14，不是六月那 5 天

  // getByText 默认整串相等 → 「本月最长连续」不会被误当成「最长连续」
  expect(within(stats).queryByText('最长连续')).toBeNull();
});

test('日历页的「总组数」也是本月的账——别的屏上「总组数」是终身的', async () => {
  await seed();
  renderAt(<CalendarScreen />);

  const stats = await screen.findByTestId('month-stats');
  const cell = within(stats).getByText('本月组数').parentElement as HTMLElement;
  expect(within(cell).getByText('5')).toBeInTheDocument(); // 1 + 2 + 2
  expect(within(stats).queryByText('总组数')).toBeNull();
});
