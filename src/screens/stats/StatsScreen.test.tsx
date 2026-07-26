import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { seedPresets } from '../../repos/exerciseRepo';
import { setWeight } from '../../repos/weightRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { estimate1RM } from '../../lib/stats';
import { db } from '../../lib/db';
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

describe('数据页新叙事', () => {
  test('初次选择优先今日动作，否则回退到全历史最近动作', async () => {
    await addWorkoutItem('2026-07-01', 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem(TODAY, 'p-squat', [{ weight: 80, reps: 6 }]);
    renderStats();

    expect(await screen.findByRole('button', { name: /深蹲.*今日/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('当前动作元数据消失后回退到仍存在的最近动作', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    await addWorkoutItem('2026-07-14', 'p-squat', [{ weight: 80, reps: 6 }]);
    renderStats();

    const bench = await screen.findByRole('button', { name: /卧推.*今日/ });
    expect(bench).toHaveAttribute('aria-pressed', 'true');
    await db.exercises.delete('p-bench');

    await waitFor(() => expect(screen.getByRole('button', { name: '深蹲' })).toHaveAttribute('aria-pressed', 'true'));
  });

  test('固定顺序包含动作、12 周、趋势、均衡，且不再出现年度热力', async () => {
    await addWorkoutItem(TODAY, 'p-bench', [{ weight: 60, reps: 8 }]);
    renderStats();

    const action = await screen.findByText('动作进步');
    const rhythm = screen.getByText('最近 12 周');
    const trend = screen.getByText('力量趋势 · 估算 1RM');
    const balance = screen.getByText('部位均衡');
    expect(action.compareDocumentPosition(rhythm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rhythm.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trend.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('年度热力')).not.toBeInTheDocument();

    const rhythmGroup = screen.getByRole('group', { name: '最近 12 周训练节奏' });
    expect(within(rhythmGroup).getAllByRole('img')).toHaveLength(12);
    expect(within(rhythmGroup).getByRole('img', { name: /^本周/ })).toBeInTheDocument();
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

  test('只练辅助动作：负荷格显示次数，不显示假容量或 e1RM', async () => {
    await addWorkoutItem(TODAY, 'p-assisted-pullup', [{ weight: 30, reps: 10 }]);
    renderStats();

    const reps = await screen.findByTestId('hero-reps');
    expect(within(reps).getByText('总次数')).toBeInTheDocument();
    expect(within(reps).getByText('10')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-volume')).not.toBeInTheDocument();
    expect(await screen.findByText('辅助趋势')).toBeInTheDocument();
    expect(screen.getByText('辅助越少，表现越强')).toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(screen.getByTestId('strength-single')).toBeInTheDocument();
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
