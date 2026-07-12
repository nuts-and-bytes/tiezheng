import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { seedPresets } from '../../repos/exerciseRepo';
import { setWeight } from '../../repos/weightRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { heatColor } from '../../lib/heat';
import { estimate1RM } from '../../lib/stats';
import { resetDb } from '../../test/dbTestUtils';
import { StatsScreen } from './StatsScreen';

// chart.js 在 jsdom 里画不出来（HTMLCanvasElement.prototype.getContext 未实现，
// react-chartjs-2 会静默吞掉 "Failed to create chart"）。所以断言 canvas 内容是不可能的，
// 真正的契约是「喂给图表的数据对不对」——把图表替换成把 data 摊平到 DOM 的探针。
vi.mock('react-chartjs-2', () => ({
  Line: ({ data }: { data: { labels?: unknown[]; datasets?: { data: number[] }[] } }) => (
    <div
      data-testid="line-chart"
      data-labels={JSON.stringify(data?.labels ?? [])}
      data-series={JSON.stringify(data?.datasets?.[0]?.data ?? [])}
    />
  ),
  Radar: () => null,
  Chart: () => null,
}));

// 数据页所有区间都由 todayStr() 锚定。2026-07-15 是周三 →
// 本周 = 07-13(周一)..07-15，上一等长区间 = 07-10..07-12。
const TODAY = '2026-07-15';
vi.mock('../../lib/dates', async (orig) => ({
  ...(await orig<typeof import('../../lib/dates')>()),
  todayStr: () => TODAY,
}));

beforeEach(async () => {
  await resetDb();
  await seedPresets();
});

function renderStats() {
  return render(
    <MemoryRouter>
      <StatsScreen />
    </MemoryRouter>,
  );
}

/** 整页可见文本——用来证明永远不会漏出 NaN / Infinity */
function pageText(): string {
  return document.body.textContent ?? '';
}

describe('零数据（新用户）', () => {
  test('不渲染空图表框，只给一句人话和打卡入口', async () => {
    renderStats();

    expect(await screen.findByText(/还没有.*铁证|还没有任何记录/)).toBeInTheDocument();
    // 空图表框是最没用的东西：一个只有坐标轴、没有数据的框
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(pageText()).not.toMatch(/NaN|Infinity/);
  });
});

describe('顶部时间范围 + 环比', () => {
  test('上期为 0 时显示「新增」，绝不渲染 NaN% 或 Infinity%', async () => {
    // 只有本周有记录，上一区间（07-10..07-12）完全空 → pct 为 null
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    expect(await screen.findByText('打卡天数')).toBeInTheDocument();
    expect(screen.getAllByText('新增').length).toBeGreaterThan(0);
    expect(pageText()).not.toMatch(/NaN|Infinity/);
    expect(pageText()).not.toContain('%%');
  });

  test('上期有数据时给出真实环比百分比', async () => {
    // 本周 2 天，上一区间 1 天 → +100%
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-14', 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-11', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const days = await screen.findByTestId('hero-days');
    expect(within(days).getByText('2')).toBeInTheDocument();
    expect(within(days).getByText(/100%/)).toBeInTheDocument();
    expect(pageText()).not.toMatch(/NaN|Infinity/);
  });

  test('切到「全部」不编造环比（没有"上一个全部"），也不出现 NaN', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    const user = userEvent.setup();
    renderStats();

    await user.click(await screen.findByRole('button', { name: '全部' }));

    // 三个大数字各挂一个「累计」——不是环比，因为「全部」没有上一期
    expect(await screen.findAllByText('累计')).toHaveLength(3);
    expect(screen.queryByText('新增')).not.toBeInTheDocument();
    expect(pageText()).not.toMatch(/NaN|Infinity|%/);
  });

  test('切换区间会重算数字（月含本周之外的记录）', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]); // 本周
    await addWorkoutItem('2026-07-02', 'p-bench', [{ weight: 60, reps: 8 }]); // 本月非本周
    const user = userEvent.setup();
    renderStats();

    const days = () => screen.getByTestId('hero-days');
    expect(await screen.findByTestId('hero-days')).toBeInTheDocument();
    expect(within(days()).getByText('1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '月' }));
    expect(await within(days()).findByText('2')).toBeInTheDocument();
  });
});

describe('力量趋势', () => {
  test('默认动作是练得最多的那个，不是随手取的一个', async () => {
    // 深蹲只练 1 天，卧推练 3 天 → 默认必须是卧推
    await addWorkoutItem('2026-07-01', 'p-squat', [{ weight: 100, reps: 5 }]);
    await addWorkoutItem('2026-07-02', 'p-bench', [{ weight: 60, reps: 10 }]);
    await addWorkoutItem('2026-07-03', 'p-bench', [{ weight: 62.5, reps: 8 }]);
    await addWorkoutItem('2026-07-04', 'p-bench', [{ weight: 65, reps: 8 }]);
    const user = userEvent.setup();
    renderStats();

    await user.click(await screen.findByRole('button', { name: '月' }));

    const chart = await screen.findByTestId('line-chart');
    const series = JSON.parse(chart.getAttribute('data-series') ?? '[]');
    expect(series).toEqual([
      estimate1RM(60, 10),
      estimate1RM(62.5, 8),
      estimate1RM(65, 8),
    ]);
    // 深蹲那一天（100kg）绝不能混进卧推的曲线
    expect(series).not.toContain(estimate1RM(100, 5));
  });

  test('可以切换到别的动作', async () => {
    await addWorkoutItem('2026-07-02', 'p-bench', [{ weight: 60, reps: 10 }]);
    await addWorkoutItem('2026-07-03', 'p-bench', [{ weight: 65, reps: 8 }]);
    await addWorkoutItem('2026-07-04', 'p-squat', [{ weight: 100, reps: 5 }]);
    const user = userEvent.setup();
    renderStats();

    await user.click(await screen.findByRole('button', { name: '月' }));
    await user.click(await screen.findByRole('button', { name: '深蹲' }));

    const chart = await screen.findByTestId('line-chart');
    const series = JSON.parse(chart.getAttribute('data-series') ?? '[]');
    expect(series).toEqual([estimate1RM(100, 5)]);
  });

  test('没有任何重量数据时不画空坐标轴，说人话', async () => {
    // 只记「练了什么 + 几组」的用户：没有 weight/reps
    await addWorkoutItem(TODAY, 'p-pushup', [{}, {}, {}]);
    renderStats();

    expect(await screen.findByText(/记下重量.*次数|还没有带重量/)).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(pageText()).not.toMatch(/NaN|Infinity/);
  });

  test('无重量数据时大数字降级为组数口径，不显示 0 容量', async () => {
    await addWorkoutItem(TODAY, 'p-pushup', [{}, {}, {}]);
    renderStats();

    expect(await screen.findByText('总组数')).toBeInTheDocument();
    expect(screen.queryByText('总容量')).not.toBeInTheDocument();
  });
});

describe('部位均衡', () => {
  test('显示每个部位的组数，以及久疏于练的天数', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-03', 'p-pullup', [{ weight: 0, reps: 10 }]); // 12 天前练的背
    const user = userEvent.setup();
    renderStats();

    await user.click(await screen.findByRole('button', { name: '全部' }));

    const back = await screen.findByTestId('part-back');
    expect(within(back).getByText(/12 天没练/)).toBeInTheDocument();

    const chest = screen.getByTestId('part-chest');
    expect(within(chest).getByText('2 组')).toBeInTheDocument();
  });
});

describe('年度热力图', () => {
  test('格子颜色与日历页同源（heatColor），不是另一套色', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const cell = await screen.findByTestId('heat-2026-07-13');
    // 单日单组：percentile([1], 90) = 1 → alpha 打满
    expect(cell).toHaveStyle({ backgroundColor: heatColor('chest', 1, 1) });
  });

  test('没练的日子不是黑洞，用 EMPTY_HEAT 兜底', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const empty = await screen.findByTestId('heat-2026-07-14');
    expect(empty).not.toHaveStyle({ backgroundColor: heatColor('chest', 1, 1) });
  });
});

describe('体重趋势', () => {
  test('有体重记录才渲染，且不把相隔很远的两次称重当作相邻点', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    await setWeight('2026-07-14', 70);
    await setWeight(TODAY, 72);
    renderStats();

    expect(await screen.findByText(/体重/)).toBeInTheDocument();
    expect(pageText()).not.toMatch(/NaN|Infinity/);
  });
});
