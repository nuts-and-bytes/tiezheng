import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { seedPresets } from '../../repos/exerciseRepo';
import { setWeight } from '../../repos/weightRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { BODY_PARTS } from '../../data/bodyParts';
import { EMPTY_HEAT, heatColor } from '../../lib/heat';
import { estimate1RM } from '../../lib/stats';
import { resetDb } from '../../test/dbTestUtils';
import { StatsScreen } from './StatsScreen';

// chart.js 在 jsdom 里画不出来（HTMLCanvasElement.prototype.getContext 未实现，
// react-chartjs-2 会静默吞掉 "Failed to create chart"）。所以断言 canvas 内容是不可能的，
// 真正的契约是「喂给图表的数据对不对」——把图表替换成把 data 摊平到 DOM 的探针。
vi.mock('react-chartjs-2', () => ({
  Line: ({
    data,
    'aria-label': ariaLabel,
  }: {
    data: { labels?: unknown[]; datasets?: { data: number[]; pointRadius?: number }[] };
    // react-chartjs-2 把多余的 props 透传到它渲染的 <canvas> 上。那个 canvas 自带
    // role="img"——一个有角色、没名字的图形，屏幕阅读器只念一声「图」。名字得自己给。
    'aria-label'?: string;
  }) => (
    <div
      data-testid="line-chart"
      role="img"
      aria-label={ariaLabel}
      data-labels={JSON.stringify(data?.labels ?? [])}
      data-series={JSON.stringify(data?.datasets?.[0]?.data ?? [])}
      data-point-radius={String(data?.datasets?.[0]?.pointRadius)}
    />
  ),
  Radar: () => null,
  Chart: () => null,
}));

// 数据页所有区间都由 todayStr() 锚定。2026-07-15 是周三 →
// 本周 = 07-13(周一)..07-15；环比的对照组是**上周同一相位**（week-to-date 比 week-to-date）
// = 07-06(上周一)..07-08(上周三)，而不是紧挨着的 07-10..07-12。
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

/** 把任意合法色值折算成浏览器的规范写法，才能拿 '#1a1a1d' 和 'rgb(26, 26, 29)' 相互比对 */
function norm(color: string): string {
  const el = document.createElement('div');
  el.style.backgroundColor = color;
  return el.style.backgroundColor;
}

/**
 * 混合日的格子背景是 linear-gradient，jsdom 不会把它展开进 backgroundColor。
 * 所以别问「backgroundColor 是什么」——问「这块格子上落了哪几个色，按什么顺序」。
 */
function fillsOf(el: HTMLElement): string[] {
  const s = el.style;
  const bg = s.background || s.backgroundImage || s.backgroundColor;
  return (bg.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi) ?? []).map(norm);
}

function bgOf(el: HTMLElement): string {
  const s = el.style;
  return s.background || s.backgroundImage || s.backgroundColor;
}

describe('零数据（新用户）', () => {
  test('不渲染空图表框，只给一句人话和打卡入口', async () => {
    renderStats();

    expect(await screen.findByText(/还没有.*铁证|还没有任何记录/)).toBeInTheDocument();
    // 空图表框是最没用的东西：一个只有坐标轴、没有数据的框
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(pageText()).not.toMatch(/NaN|Infinity/);
  });

  // 空状态的钢印是插图：它说的话（「铁证」）旁边的文案已经说了，读屏念第二遍只是噪声
  test('空状态的钢印是装饰，不进无障碍树', async () => {
    renderStats();

    await screen.findByText(/还没有.*铁证|还没有任何记录/);
    expect(screen.queryByRole('img', { name: '铁证' })).toBeNull();
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
    // 本周（截至周三）2 天，上周同期 1 天 → +100%
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-14', 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-07', 'p-bench', [{ weight: 60, reps: 8 }]);
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

    // 打卡天数 + 总组数各挂一个「累计」。总容量没有环比 → 没有第三个
    expect(await screen.findAllByText('累计')).toHaveLength(2);
    expect(screen.queryByText('新增')).not.toBeInTheDocument();
    expect(pageText()).not.toMatch(/NaN|Infinity|%/);
  });

  test('总容量不显示环比：撞上一个怪物日就 ↓88% 的指标回答不了「我在变好吗」', async () => {
    // 上周同期（07-06..07-08）一个 30 组的怪物日，本周只练了 1 组 → 旧版会红着箭头写 ↓
    await addWorkoutItem('2026-07-07', 'p-bench', Array.from({ length: 30 }, () => ({ weight: 60, reps: 10 })));
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const volume = await screen.findByTestId('hero-volume');
    expect(within(volume).getByText('总容量')).toBeInTheDocument();
    expect(within(volume).queryByText(/%|新增|持平|累计/)).not.toBeInTheDocument();

    // 组数是稳定指标，环比留着
    expect(within(screen.getByTestId('hero-sets')).getByText(/%/)).toBeInTheDocument();
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

describe('力量趋势（进步曲线：脱离上方的范围切换器）', () => {
  const series = (el: HTMLElement) => JSON.parse(el.getAttribute('data-series') ?? '[]');

  test('默认动作是练得最多的那个，不是随手取的一个', async () => {
    // 深蹲只练 1 天，卧推练 3 天 → 默认必须是卧推。注意：全程停在默认的「周」上，
    // 这些记录全在本周之外——曲线照样要画出来
    await addWorkoutItem('2026-07-01', 'p-squat', [{ weight: 100, reps: 5 }]);
    await addWorkoutItem('2026-07-02', 'p-bench', [{ weight: 60, reps: 10 }]);
    await addWorkoutItem('2026-07-03', 'p-bench', [{ weight: 62.5, reps: 8 }]);
    await addWorkoutItem('2026-07-04', 'p-bench', [{ weight: 65, reps: 8 }]);
    renderStats();

    const chart = await screen.findByTestId('line-chart');
    expect(series(chart)).toEqual([
      estimate1RM(60, 10),
      estimate1RM(62.5, 8),
      estimate1RM(65, 8),
    ]);
    // 深蹲那一天（100kg）绝不能混进卧推的曲线
    expect(series(chart)).not.toContain(estimate1RM(100, 5));
  });

  test('本周只练过一次该动作，曲线依然完整——这是默认「周」的用户看到空图的根因', async () => {
    // 卧推：5 月、6 月各一次，本周一次。旧版按「周」裁剪 → 只剩 1 个点 → 一张空图
    await addWorkoutItem('2026-05-01', 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-06-01', 'p-bench', [{ weight: 70, reps: 8 }]);
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 80, reps: 8 }]);
    const user = userEvent.setup();
    renderStats();

    const chart = await screen.findByTestId('line-chart');
    expect(series(chart)).toEqual([estimate1RM(60, 8), estimate1RM(70, 8), estimate1RM(80, 8)]);
    // 语义写在脸上：这一块跟上方的范围切换器无关
    expect(screen.getByText(/最近 12 次记录 · 不随上方范围变化/)).toBeInTheDocument();

    // 切到「月」「全部」，曲线一个点都不能变
    await user.click(screen.getByRole('button', { name: '月' }));
    expect(series(screen.getByTestId('line-chart'))).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '全部' }));
    expect(series(screen.getByTestId('line-chart'))).toHaveLength(3);
  });

  test('只有 1 个数据点时不画空图表壳，而是把那个数值和下一步说清楚', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    expect(await screen.findByTestId('strength-single')).toBeInTheDocument();
    // 空图表壳（画了坐标轴却一个像素数据都没有）是在骗人说「这里本该有东西」
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    const single = screen.getByTestId('strength-single');
    expect(within(single).getByText(estimate1RM(60, 8).toFixed(1))).toBeInTheDocument();
    expect(within(single).getByText(/07-15/)).toBeInTheDocument();
    expect(within(single).getByText(/再练一次/)).toBeInTheDocument();
  });

  test('单点降级态里仍能切换动作（切到有 2 个点的动作就长出曲线）', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]); // 卧推 1 个点
    await addWorkoutItem('2026-07-01', 'p-squat', [{ weight: 100, reps: 5 }]);
    await addWorkoutItem('2026-07-08', 'p-squat', [{ weight: 105, reps: 5 }]);
    const user = userEvent.setup();
    renderStats();

    // 深蹲 2 天 > 卧推 1 天 → 默认深蹲，有曲线
    const chart = await screen.findByTestId('line-chart');
    expect(series(chart)).toEqual([estimate1RM(100, 5), estimate1RM(105, 5)]);

    await user.click(screen.getByRole('button', { name: '卧推' }));
    expect(await screen.findByTestId('strength-single')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
  });

  // weight: 0 是**合法输入** —— validLoad(0) === true（自重动作：引体、俯卧撑），SetRows 会真的存成 0。
  // 但 estimate1RM(0, reps) === 0，e1rmSeries 把 e1rm===0 的组全丢掉 → 该动作的 series 是**空数组**。
  // 而 hasWeightData / topExerciseIds 只判 `weight !== undefined`，0 照样通过 —— 于是自重动作被
  // 选成力量趋势的主角，却永远画不出一个点。守卫必须在「1 个点」和「0 个点」上都站得住。
  test('纯自重用户（重量记 0）打开数据页：不崩，走「还没有重量数据」空态', async () => {
    await addWorkoutItem('2026-07-13', 'p-pullup', [{ weight: 0, reps: 10 }]);
    await addWorkoutItem('2026-07-14', 'p-pullup', [{ weight: 0, reps: 12 }]);
    await addWorkoutItem(TODAY, 'p-pullup', [{ weight: 0, reps: 10 }]);
    renderStats();

    expect(await screen.findByText(/记下重量和次数，这里就会画出你的力量曲线/)).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('strength-single')).not.toBeInTheDocument();
  });

  test('混合用户：练得最勤的是自重动作，力量趋势也不能选它当主角——它画不出曲线', async () => {
    // 引体 3 天（自重，e1RM 恒 0）vs 卧推 2 天（有配重）→ topExerciseIds 会把引体排第一
    await addWorkoutItem('2026-07-01', 'p-pullup', [{ weight: 0, reps: 10 }]);
    await addWorkoutItem('2026-07-02', 'p-pullup', [{ weight: 0, reps: 10 }]);
    await addWorkoutItem('2026-07-03', 'p-pullup', [{ weight: 0, reps: 10 }]);
    await addWorkoutItem('2026-07-04', 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-05', 'p-bench', [{ weight: 62.5, reps: 8 }]);
    renderStats();

    const chart = await screen.findByTestId('line-chart');
    expect(series(chart)).toEqual([estimate1RM(60, 8), estimate1RM(62.5, 8)]);
    // 引体不该出现在动作选择器里——列出来只会让用户点进一个永远空着的图
    expect(screen.queryByRole('button', { name: '引体向上' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '卧推' })).toBeInTheDocument();
  });

  test('最多只画最近 12 次，且点数少时点可见（否则单条线段两端空空如也）', async () => {
    for (let i = 0; i < 14; i++) {
      await addWorkoutItem(`2026-06-${String(i + 1).padStart(2, '0')}`, 'p-bench', [
        { weight: 60 + i, reps: 8 },
      ]);
    }
    renderStats();

    const chart = await screen.findByTestId('line-chart');
    expect(series(chart)).toHaveLength(12);
    // 最早两天（06-01、06-02）被挤出去，最新一天必须在
    expect(series(chart)).not.toContain(estimate1RM(60, 8));
    expect(series(chart)).toContain(estimate1RM(73, 8));
    expect(chart.getAttribute('data-point-radius')).toBe('3');
  });

  test('可以切换到别的动作', async () => {
    await addWorkoutItem('2026-07-02', 'p-bench', [{ weight: 60, reps: 10 }]);
    await addWorkoutItem('2026-07-03', 'p-bench', [{ weight: 65, reps: 8 }]);
    await addWorkoutItem('2026-07-04', 'p-squat', [{ weight: 100, reps: 5 }]);
    await addWorkoutItem('2026-07-06', 'p-squat', [{ weight: 110, reps: 5 }]);
    const user = userEvent.setup();
    renderStats();

    await user.click(await screen.findByRole('button', { name: '深蹲' }));

    const chart = await screen.findByTestId('line-chart');
    expect(series(chart)).toEqual([estimate1RM(100, 5), estimate1RM(110, 5)]);
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
  test('副标题指代的是颜色不是位置——因为「右侧」那一列会骗人', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    const user = userEvent.setup();
    renderStats();

    // 右侧那一列其实是两行：组数（永远在）+ 琥珀色的「距上次训练」（只在 ≥7 天没练时出现）。
    // 旧文案写「右侧 = 距上次训练」，可对最近练过的部位，右侧唯一在场的恰恰是组数，
    // 副标题声称的那一行根本不显示——用位置指代一个条件渲染的东西，必然说谎。
    // 颜色不会：琥珀行可以不出现，但只要出现就一定是琥珀色。
    expect(await screen.findByText(/柱长 \/ 数字 = 本周组数 · 琥珀 = 距上次训练/)).toBeInTheDocument();

    // 范围一换，柱长的口径也换了——文案必须跟着走，不能永远写「本周」
    await user.click(screen.getByRole('button', { name: '月' }));
    expect(await screen.findByText(/柱长 \/ 数字 = 本月组数/)).toBeInTheDocument();
    expect(screen.queryByText(/柱长 \/ 数字 = 本周组数/)).not.toBeInTheDocument();
  });

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

    // 副标题许诺「琥珀 = 距上次训练」，那它就得真的只在琥珀行出现。
    // 今天刚练的胸不该有这一行——这条断言是副标题那句话的兑现凭据。
    expect(within(chest).queryByText(/天没练/)).not.toBeInTheDocument();
  });
});

describe('年度热力图', () => {
  test('格子颜色与日历页同源（heatColor），不是另一套色', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const cell = await screen.findByTestId('heat-2026-07-13');
    // 单日单组：percentile([1], 90) = 1 → alpha 打满
    expect(fillsOf(cell)).toEqual([norm(heatColor('chest'))]);
  });

  test('没练的日子不是黑洞，用 EMPTY_HEAT 兜底', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const empty = await screen.findByTestId('heat-2026-07-14');
    expect(fillsOf(empty)).toEqual([norm(EMPTY_HEAT)]);
  });

  test('有月份轴：不然用户根本不知道哪一列是几月', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const months = await screen.findByTestId('heat-months');
    for (const m of [1, 4, 7, 12]) {
      expect(within(months).getByText(`${m}月`)).toBeInTheDocument();
    }
  });

  test('有部位图例：色块本身不自解释，日历页有的这里也得有', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const legend = await screen.findByTestId('heat-legend');
    for (const p of BODY_PARTS) {
      expect(within(legend).getByText(p.name)).toBeInTheDocument();
    }
  });

  /**
   * 部位曾经**只**编码在色相里。9px 的格子、七个色相——红绿色盲（男性约 8%）
   * 读到的信息量是零，而说实话谁也分不清。颜色只能当冗余通道，真相得另有出口。
   * 出口有两个：格子自己说得出话（title / 无障碍名），以及图例能筛（下一组测试）。
   */
  test('格子说得出练的是什么：日期 · 部位 · 组数，不是只有一个颜色', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const cell = await screen.findByTestId('heat-2026-07-13');
    expect(cell).toHaveAttribute('title', '2026-07-13 · 胸 1 组');
    // 色块要进无障碍树就得有 role——光挂 aria-label 在 <span> 上，屏幕阅读器不念
    expect(cell).toHaveAttribute('role', 'img');
    expect(cell).toHaveAccessibleName('2026-07-13 · 胸 1 组');
  });

  test('一天练了两个部位，两个都说出来（主练部位不是全部真相）', async () => {
    await addWorkoutItem('2026-07-13', 'p-squat', [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }]);
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const cell = await screen.findByTestId('heat-2026-07-13');
    expect(cell).toHaveAttribute('title', '2026-07-13 · 腿 2 组 · 胸 1 组');
  });

  test('没练的日子不进无障碍树：一年 365 声「未训练」是纯噪声', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    await screen.findByTestId('heat-2026-07-13');
    expect(screen.getByTestId('heat-2026-07-14')).toHaveAttribute('aria-hidden', 'true');
  });

  /**
   * 筛选通道。七色同屏谁都读不出「我腿练得少吗」——那是个查询，不是个看。
   * 点「腿」，整张图退成单色的腿部贡献图：此时唯一的变量是浓淡，色觉障碍者也读得全。
   */
  test('点图例筛部位：只留这个部位的日子，其余退回底色', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]); // 胸
    await addWorkoutItem('2026-07-14', 'p-squat', [{ weight: 80, reps: 5 }]); // 腿
    const user = userEvent.setup();
    renderStats();

    const legend = await screen.findByTestId('heat-legend');
    await user.click(within(legend).getByRole('button', { name: '胸' }));

    expect(fillsOf(screen.getByTestId('heat-2026-07-13'))).toEqual([
      norm(heatColor('chest')),
    ]);
    expect(fillsOf(screen.getByTestId('heat-2026-07-14'))).toEqual([norm(EMPTY_HEAT)]);
    expect(within(legend).getByRole('button', { name: '胸' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('主练的是腿、顺带练了胸的那天，筛「胸」也留得下（按主练部位筛会漏掉它）', async () => {
    await addWorkoutItem('2026-07-13', 'p-squat', [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }]);
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    const user = userEvent.setup();
    renderStats();

    const legend = await screen.findByTestId('heat-legend');
    await user.click(within(legend).getByRole('button', { name: '胸' }));

    // 那天只练了 1 组胸 → 筛出来的浓淡按「这个部位当天的组数」算，不是当天总组数
    expect(fillsOf(screen.getByTestId('heat-2026-07-13'))).toEqual([
      norm(heatColor('chest')),
    ]);
  });

  test('再点一次取消筛选（不然用户被自己锁死在一个部位里）', async () => {
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-14', 'p-squat', [{ weight: 80, reps: 5 }]);
    const user = userEvent.setup();
    renderStats();

    const legend = await screen.findByTestId('heat-legend');
    await user.click(within(legend).getByRole('button', { name: '胸' }));
    await user.click(within(legend).getByRole('button', { name: '胸' }));

    expect(fillsOf(screen.getByTestId('heat-2026-07-14'))).toEqual([norm(heatColor('leg'))]);
  });
});

/**
 * 一格一色是一次**有损压缩**：主练腿、顺带练胸的那天，格子只涂腿色——而同一页往上滚
 * 两屏的「部位分布」正写着腿 2 / 胸 1。两个模块在同一页上互相拆台。
 *
 * 日历格、海报格、这里的年度格必须服从同一条规则（`cellParts` 是它唯一的出处）：
 * 至多两块，对角劈开，主练在左上。三处同色同形，用户才不用重新学一遍怎么读。
 */
describe('年度热力图的混合日：一格看得出两块', () => {
  test('主练腿 + 顺带胸：格子对角劈成腿色/胸色，浓淡按当天总组数', async () => {
    await addWorkoutItem('2026-07-13', 'p-squat', [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }]);
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const cell = await screen.findByTestId('heat-2026-07-13');
    // 全年只有这一天 → percentile([3], 90) = 3。两块共用同一个 alpha：
    // 格子的深浅答的是「这天练得狠不狠」，不是「这一块练了几组」
    expect(fillsOf(cell)).toEqual([norm(heatColor('leg')), norm(heatColor('chest'))]);
    // 硬边对角、主练在左上——跟日历格和海报格同一个方向
    expect(bgOf(cell)).toContain('135deg');
  });

  test('练了三块的一天只画前两块：9px 的格子上第三条色带不足 3px，画了只是噪声', async () => {
    await addWorkoutItem('2026-07-13', 'p-squat', [
      { weight: 80, reps: 5 },
      { weight: 80, reps: 5 },
      { weight: 80, reps: 5 },
    ]);
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-13', 'p-pullup', [{ weight: 0, reps: 8 }]);
    renderStats();

    const cell = await screen.findByTestId('heat-2026-07-13');
    expect(fillsOf(cell)).toEqual([norm(heatColor('leg')), norm(heatColor('chest'))]);
    // 但 title 仍报全部真相——被截断的只是像素，不是账
    expect(cell).toHaveAttribute('title', '2026-07-13 · 腿 3 组 · 胸 2 组 · 背 1 组');
  });

  test('筛选态回到单色：此时唯一的变量是浓淡，色觉障碍者才读得全', async () => {
    await addWorkoutItem('2026-07-13', 'p-squat', [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }]);
    await addWorkoutItem('2026-07-13', 'p-bench', [{ weight: 60, reps: 8 }]);
    const user = userEvent.setup();
    renderStats();

    const legend = await screen.findByTestId('heat-legend');
    await user.click(within(legend).getByRole('button', { name: '腿' }));

    const cell = screen.getByTestId('heat-2026-07-13');
    expect(fillsOf(cell)).toEqual([norm(heatColor('leg'))]);
    expect(bgOf(cell)).not.toContain('gradient'); // 筛出来的图不该还劈着
  });
});

describe('海报入口', () => {
  test('文案与「我的」页统一为「导出训练海报」', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    expect(await screen.findByText('导出训练海报')).toBeInTheDocument();
    expect(screen.queryByText('生成训练海报')).not.toBeInTheDocument();
  });

  /**
   * 链接的无障碍名由子内容拼出来。钢印带着 aria-label="铁证" 站在链接第一位，
   * 读屏用户听到的第一个词就是品牌名——而他要判断的是「这个链接干什么」。
   * 品牌感是给眼睛的，不该占用耳朵的第一秒。钢印在这里是装饰，让它闭嘴。
   */
  test('入口的无障碍名说的是它干什么，不是念一遍品牌名', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    expect(await screen.findByRole('link', { name: /导出训练海报/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /铁证/ })).toBeNull();
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

  /**
   * 一个点画不出线，也画不出「7 日均线」——均线组的 pointRadius 是 0，那条 dataset 在
   * 单点上根本不落笔。用户看到的是一个坐标轴框、一个 2px 的橙点，和一行标题在那儿
   * 宣称这是「7 日均线」。力量趋势早就懂这个道理（series.length < 2 → 亮数字 + 下一步），
   * 体重却只挡了 === 0。同一个文件里两套标准，说明这不是取舍，是漏了。
   */
  test('只称过一次：不画只有一个点的均线图，把那个数字亮出来', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    await setWeight(TODAY, 70);
    renderStats();

    const single = await screen.findByTestId('weight-single');
    expect(single).toHaveTextContent('70.0');
    // 标题不许再说「7 日均线」——没有均线
    expect(screen.queryByText(/7 日均线/)).toBeNull();
  });

  /**
   * 体重是独立于打卡的一条数据流：TodayScreen 上可以只称重、不打卡。
   * 而数据页的空态门闩写的是 `dates.length === 0` —— 一个「先称了两天体重、还没练第一次」
   * 的用户，weights 已经从 IndexedDB 取回来了，却被这道门闩连页面一起换掉、当场丢弃。
   * 空态该做的是不画一排 0 和空坐标轴，不是把用户真有的数据也一并没收。
   */
  test('只称了体重、还没打过卡：空态还在，但体重不许被丢掉', async () => {
    await setWeight('2026-07-14', 70);
    await setWeight(TODAY, 72);
    renderStats();

    expect(await screen.findByText(/还没有.*铁证|还没有任何记录/)).toBeInTheDocument();
    // 两次称重都进了图（Line mock 只把 data 摊平成属性，textContent 是空的——问属性）
    const chart = await screen.findByTestId('line-chart');
    expect(JSON.parse(chart.dataset.labels ?? '[]')).toEqual(['07-14', '07-15']);
    expect(pageText()).not.toMatch(/NaN|Infinity/);
  });
});

describe('大数字三格的口径（K）', () => {
  /**
   * hero 用 scoped（当前区间）判断有没有重量数据，而下面的「力量趋势」吃的是全时段 items。
   * 于是同一屏上会出现：曲线好端端画着卧推的 e1RM，上面的大数字却当他没有重量数据，
   * 把第三格降级成「当前连续」。
   *
   * 更深的问题是**页面结构在漂**：一个举铁的人，这周碰巧只练了自重/有氧，整块
   * 容量口径就消失；下周一又回来。用户没法建立「这一页长什么样」的稳定预期。
   *
   * 「你是不是一个搬铁的人」是这个人的属性，不是这三天的属性 → 用全时段判断。
   * 本周真的没搬起重量，就诚实显示 0 kg——旁边天数和组数一起为 0 时，这读得懂。
   */
  test('举铁的人本周只练了自重，第三格仍是总容量，而不是整块换掉', async () => {
    await addWorkoutItem('2026-06-20', 'p-bench', [{ weight: 60, reps: 8 }]); // 上个月搬过铁
    await addWorkoutItem(TODAY, 'p-pushup', [{ reps: 20 }]); // 本周只有自重
    renderStats();

    expect(await screen.findByTestId('hero-volume')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-streak')).not.toBeInTheDocument();
  });

  /**
   * 降级态原本把第三格给了「当前连续」——而它下面 4px 处的那行小字里已经印了一遍
   * 「当前连续 N 天 · 最长 M 天」。同一个数字在一屏里出现两次，第二次不携带任何新信息，
   * 白白占掉三格中的一格。
   *
   * 纯自重训练者缺的恰恰是负荷维度：他的 volumeKg 恒为 0，但**总次数**是真的。
   */
  test('纯自重的人，第三格给总次数（而不是把「当前连续」印第二遍）', async () => {
    await addWorkoutItem(TODAY, 'p-pushup', [{ reps: 20 }, { reps: 15 }]);
    renderStats();

    const reps = await screen.findByTestId('hero-reps');
    expect(within(reps).getByText('总次数')).toBeInTheDocument();
    expect(within(reps).getByText('35')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-streak')).not.toBeInTheDocument();

    // 「当前连续」全页只该出现一次（那行小字里）
    expect(pageText().match(/当前连续/g)).toHaveLength(1);
  });

  /**
   * 梯子的第三级。sanitizeSets 白纸黑字允许「全空时保留组数——徒手训练允许只记组数不记
   * 次数」。这类人的 volumeKg 和 reps 双 0，于是第二级（总次数）也塌了：他练了 5 组，
   * 第三格却写着「总次数 0」——旁边「总组数 5」正亮着，两个数字在同一排互相拆台。
   *
   * 他的记录里唯一还没被前两格用掉的真实维度是动作数。那个数字是真的，且总是 ≥1。
   */
  test('只记组数、连次数都不记的人：第三格给动作数，不是骗人的「总次数 0」', async () => {
    await addWorkoutItem(TODAY, 'p-pushup', [{}, {}, {}]);
    await addWorkoutItem(TODAY, 'p-pullup', [{}, {}]);
    renderStats();

    const moves = await screen.findByTestId('hero-moves');
    expect(within(moves).getByText('动作数')).toBeInTheDocument();
    expect(within(moves).getByText('2')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-reps')).not.toBeInTheDocument();
    // 总组数照旧算全部 5 组——动作数不是拿它换来的
    expect(within(await screen.findByTestId('hero-sets')).getByText('5')).toBeInTheDocument();
  });
});

describe('环比的零值：「↓100%」在周期开头是常态，不是新闻', () => {
  /**
   * prevRangeOf 是**同相位**对照（上周期的同一时点），所以 cur=0 / prev>0 时 -100% 在算术和
   * 相位上都没错。问题不是错，是它**没有信息量**：周一早上只要你上周一练过，就必然 -100%。
   * 天天见的最大负值，用户三周就学会无视它——而那正是它本该报警的时候。
   *
   * 取舍已明确：换成「未开张」，代价是周期末尾真的一次没练时它也只说「未开张」，
   * 不会喊「↓100%」。严厉程度被拉平，换来的是那个红灯不再叫狼来了。
   */
  test('本周期一次没练、上周期同期练过 → 「未开张」，不是「↓ 100%」', async () => {
    // 上周同期（周一）练过，本周（截至周二）一次没练
    await addWorkoutItem('2026-07-06', 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const days = await screen.findByTestId('hero-days');
    expect(within(days).getByText('未开张')).toBeInTheDocument();
    // 只问这一格——「部位均衡」那块的百分比是另一回事，别拿整页文本去撞
    expect(within(days).queryByText(/%/)).toBeNull();
    expect(pageText()).not.toMatch(/NaN|Infinity/);
  });

  /** 上期也是 0 → 是真的什么都没有，那就还是「—」，不该说「未开张」（没有可开张的对照） */
  test('本期和上期都是 0 → 还是「—」', async () => {
    await addWorkoutItem('2026-05-01', 'p-bench', [{ weight: 60, reps: 8 }]); // 远在两个周期之前
    renderStats();

    const days = await screen.findByTestId('hero-days');
    expect(within(days).getByText('—')).toBeInTheDocument();
    expect(within(days).queryByText('未开张')).not.toBeInTheDocument();
  });
});

/**
 * 两张折线图都画在 <canvas> 上。canvas 里的像素对屏幕阅读器是不存在的——react-chartjs-2
 * 给它挂了 role="img"，于是它成了「一个图形」，但没有名字：读屏软件念出来就是一声「图」，
 * 然后什么都没有。这一整块数据对看不见的人是**空白**。
 *
 * 所以名字不能是「力量趋势图」这种同义反复的标签——那只是把「图」换成「力量趋势图」，
 * 信息量还是零。名字里得装着这张图真正在说的那句话：练的哪个动作、几个点、从多少到多少。
 */
describe('折线图的可访问名：canvas 里的像素对读屏软件不存在', () => {
  test('力量趋势图的名字里有动作名、点数和首尾 1RM，不是一句「力量趋势图」', async () => {
    await addWorkoutItem('2026-07-01', 'p-bench', [{ weight: 60, reps: 10 }]);
    await addWorkoutItem('2026-07-03', 'p-bench', [{ weight: 65, reps: 8 }]);
    renderStats();

    const chart = await screen.findByTestId('line-chart');
    const name = chart.getAttribute('aria-label') ?? '';
    expect(name).toContain('卧推');
    expect(name).toContain('2 次');
    expect(name).toContain(estimate1RM(60, 10).toFixed(1)); // 起点
    expect(name).toContain(estimate1RM(65, 8).toFixed(1)); // 终点
  });

  test('体重图的名字里有记录条数和首尾体重', async () => {
    await setWeight('2026-07-10', 70);
    await setWeight('2026-07-13', 72.4);
    renderStats();

    const charts = await screen.findAllByTestId('line-chart');
    const name = charts.map((c) => c.getAttribute('aria-label') ?? '').find((n) => n.includes('体重'));
    expect(name).toBeDefined();
    expect(name).toContain('2 条');
    expect(name).toContain('70');
    expect(name).toContain('72.4');
  });
});
