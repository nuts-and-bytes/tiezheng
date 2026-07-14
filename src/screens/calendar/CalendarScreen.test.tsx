import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { bodyPartInfo } from '../../data/bodyParts';
import { seedPresets } from '../../repos/exerciseRepo';
import { savePhoto } from '../../repos/photoRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { resetDb } from '../../test/dbTestUtils';
import { monthGrid, shiftMonth, todayStr } from '../../lib/dates';
import { AA_TEXT, compositeOver, contrastRatio, parseColor } from '../../lib/contrast';
import {
  CALENDAR_ALPHA_CEIL,
  EMPTY_HEAT,
  OVERFLOW_HEAT_FADE,
  calendarHeatColor,
} from '../../lib/heat';
import { THEME } from '../../lib/theme';
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

/** 拆出 rgba 四个通道：断言"alpha 单调递增 / 不超封顶"要的是数字，不是字符串。 */
function rgba(color: string): [number, number, number, number] {
  const nums = norm(color)
    .match(/rgba?\(([^)]+)\)/)![1]
    .split(',')
    .map((s) => Number(s.trim()));
  return [nums[0], nums[1], nums[2], nums[3] ?? 1];
}

/**
 * 格子的填充：单部位日是一个纯色，混合日是一条对角渐变——所以不能再读 backgroundColor
 * （渐变会把它清成 initial）。统一从 background 里按出现顺序抠出颜色：[0] = 主练，[1] = 次练。
 */
function colorsOf(date: string): string[] {
  const s = cell(date).style;
  const fill = s.background || s.backgroundImage || s.backgroundColor;
  return (fill.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi) ?? []).map(norm);
}

const INK: [number, number, number] = [242, 240, 235]; // --ink #F2F0EB
const MUTE: [number, number, number] = [139, 139, 133]; // --mute #8B8B85

const GRID = monthGrid(YM);
/** 溢出格：1 号是周一时没有上月溢出，尾部溢出（42 格窗口最多覆盖 6+31=37 天）则必然存在。 */
const OVERFLOW = GRID.find((x) => x < `${YM}-01`) ?? GRID[41];
const OVERFLOW_EMPTY = GRID.filter((x) => !x.startsWith(YM) && x !== OVERFLOW).at(-1)!;
/** seedMonth 练过的日子。本月的空白参照格要算出来，不能写死——写死的那天迟早会撞上今天。 */
const SEEDED = new Set(['03', '04', '05', '06', '09', '10'].map(d));
const IN_MONTH_EMPTY = GRID.find(
  (x) => x.startsWith(YM) && !SEEDED.has(x) && x !== todayStr(),
)!;

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

  // 胸 3 组的一天：单部位，只有一个色，按 p90 归一
  expect(colorsOf(d('03'))).toEqual([norm(calendarHeatColor('chest', 3, P90()))]);

  // 关键回归：若拿 max(30) 归一，这一天会被怪物日冲淡成另一个颜色
  expect(colorsOf(d('03'))[0]).not.toBe(norm(calendarHeatColor('chest', 3, 30)));

  // 背 / 腿 各按自己的部位色，不共用一种橙
  expect(colorsOf(d('04'))).toEqual([norm(calendarHeatColor('back', 3, P90()))]);
  expect(colorsOf(d('05'))).toEqual([norm(calendarHeatColor('leg', 3, P90()))]);

  // 怪物日 sets ≥ p90 → alpha 封顶
  expect(colorsOf(d('09'))).toEqual([norm(calendarHeatColor('chest', 30, P90()))]);
});

test('格子填充压在 CALENDAR_ALPHA_CEIL 以内，白色日期数字才压得住饱和红/紫', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();

  // 满 alpha 的纯色块是儿童贴纸；日历格的浓度必须封顶——混合日的两个色都要封顶
  for (const day of ['03', '04', '05', '09', '10']) {
    for (const c of colorsOf(d(day))) {
      expect(rgba(c)[3]).toBeLessThanOrEqual(CALENDAR_ALPHA_CEIL);
    }
  }

  // 但强度信息不能因此丢失：3 组 < 7 组 < 30 组，alpha 仍严格递增
  const a3 = rgba(colorsOf(d('03'))[0])[3];
  const a7 = rgba(colorsOf(d('10'))[0])[3];
  const a30 = rgba(colorsOf(d('09'))[0])[3];
  expect(a3).toBeLessThan(a7);
  expect(a7).toBeLessThan(a30);

  // 日期数字统一用 --ink
  expect(rgba(screen.getByTestId(`daynum-${d('04')}`).style.color).slice(0, 3)).toEqual(INK);
});

test('色相锚点：饱和度被压低后，用实色部位色条把"练了哪个部位"钉回来', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();

  const bar = cell(d('04')).querySelector<HTMLElement>('[data-hue="back"]')!;
  expect(bar).toBeTruthy();
  // 底条是部位本色（满饱和），不是被 alpha 压过的填充色
  expect(bar.style.backgroundColor).toBe(norm(bodyPartInfo('back').color));
  expect(cell(d('05')).querySelector('[data-hue="leg"]')).toBeTruthy();

  // 没练的日子没有色相锚点
  expect(cell(d('20')).querySelector('[data-hue]')).toBeNull();
});

test('训练日格子叠部位图标；混合日主练部位排在最前', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();

  expect(cell(d('03')).querySelector('[data-part="chest"]')).toBeTruthy();
  expect(cell(d('04')).querySelector('[data-part="back"]')).toBeTruthy();
  expect(cell(d('05')).querySelector('[data-part="leg"]')).toBeTruthy();

  // 混合日：胸 5 > 背 2 → 图标胸在前（底色见下面「混合日」那组测试）
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

  expect(colorsOf(d('20'))).toEqual([norm(EMPTY_HEAT)]);
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

/**
 * 三格的标签全带「本月」——它们算的都是当前浏览的这个月，翻一页就变。
 * 而「最长连续」「总组数」在首页 /「我的」页 / 数据页是**终身**口径。
 * 同一个词两个数，用户没有线索知道哪个是真的。见 src/screens/naming.test.tsx。
 */
test('月份统计：本月打卡天数 / 本月最长连续 / 本月组数', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();
  const stats = screen.getByTestId('month-stats');

  expect(within(stats).getByText('6')).toBeInTheDocument(); // 打卡 6 天
  expect(within(stats).getByText('4')).toBeInTheDocument(); // 03–06 连续 4 天
  expect(within(stats).getByText('49')).toBeInTheDocument(); // 3+3+3+3+30+7
  expect(within(stats).getByText('本月打卡')).toBeInTheDocument();
  expect(within(stats).getByText('本月最长连续')).toBeInTheDocument();
  expect(within(stats).getByText('本月组数')).toBeInTheDocument();

  // 有数据就照常显示数字，不许退化成引导文案
  expect(screen.queryByTestId('month-empty')).toBeNull();
});

test('本月一天没练：顶部不摆一排 0，给引导文案', async () => {
  renderCal();

  const empty = await screen.findByTestId('month-empty');
  expect(empty).toHaveTextContent(/铁证/); // 与数据页 / PR 榜同一套零态语气

  // 干瘪的 0 就是在告诉新用户"你什么都没有"
  expect(screen.queryByTestId('month-stats')).toBeNull();
  expect(screen.queryByText('0')).toBeNull();
  expect(screen.queryByText('本月打卡')).toBeNull();
});

test('零态只认"当前浏览的月"：翻回有数据的本月，数字回来', async () => {
  const user = userEvent.setup();
  await seedMonth();
  renderCal();
  await waitForHeat();

  await user.click(screen.getByLabelText('上个月')); // 上个月没种任何数据
  expect(await screen.findByTestId('month-empty')).toBeInTheDocument();

  await user.click(screen.getByLabelText('下个月'));
  await waitFor(() => expect(screen.getByTestId('month-stats')).toBeInTheDocument());
  expect(screen.queryByTestId('month-empty')).toBeNull();
});

/**
 * 溢出格（网格里属于上/下月的那些天）要同时满足两件事，它们互相拉扯：
 *   1. 练过就得读得出——有色块却读不出日期是自相矛盾；
 *   2. 又必须一眼看出「不是本月」——否则 6 周窗口里的月界就没了，
 *      而月界恰恰在最该看清的地方（练过的那天）消失。
 *
 * 上一版把这两件事绑在**同一个旋钮**上：整格 opacity=0.7。opacity 压的是整格，
 * 日期数字跟着底色一起被稀释，实测白字掉到 3.2:1（空白溢出格 opacity=0.35，1.6:1，
 * 基本隐形）。当时的测试断言的是「有效 alpha = 整格 opacity × 数字 alpha ≥ 0.6」——
 * 但 alpha 只是可读性的**代理指标**，而代理指标正是上一版栽跟头的地方：0.7 的账面值
 * 看着很安全，落到眼睛里是 3.2:1。所以这一版直接量**渲染出来的颜色**。
 *
 * 修法：弱化只落在底色上（OVERFLOW_HEAT_FADE），字保持全亮。两件事就各归各了。
 */
test('溢出格练过：既读得出日期，又一眼看得出不是本月', async () => {
  await seedMonth();
  await addWorkoutItem(OVERFLOW, 'p-pullup', setsOf(3)); // 上/下月的一天：练背
  renderCal();
  await waitForHeat();

  await waitFor(() => expect(cell(OVERFLOW).querySelector('[data-hue]')).toBeTruthy());

  const BG = parseColor(THEME.bg).rgb;
  const cellEl = cell(OVERFLOW);
  const [r, g, b, textAlpha] = rgba(screen.getByTestId(`daynum-${OVERFLOW}`).style.color);
  expect([r, g, b]).toEqual(INK); // 暗灰是给「没练」用的，练过的一律 --ink

  // 0. 弱化不许再走整格 opacity —— 它会把要读的字一起拖下水
  expect(cellEl.style.opacity).toBe('');
  expect(textAlpha).toBe(1);

  // 1. 读得出：量的是最终落到眼睛里的那个颜色，不是 alpha 的账面值
  const bgc = parseColor(cellEl.style.background || cellEl.style.backgroundColor);
  expect(contrastRatio(compositeOver(bgc.rgb, BG, bgc.alpha), INK)).toBeGreaterThanOrEqual(AA_TEXT);

  // 2. 看得出不是本月：底色明显淡于本月的**同款**格子。
  //    04 号也是背 3 组——同色同强度，两格之间只剩「本月 / 不是本月」这一个变量。
  const inMonthAlpha = parseColor(cell(d('04')).style.background).alpha;
  expect(cell(d('04')).style.opacity).toBe('');
  expect(bgc.alpha).toBeLessThan(inMonthAlpha * 0.8);
  expect(bgc.alpha).toBeCloseTo(inMonthAlpha * OVERFLOW_HEAT_FADE, 2);
});

/**
 * 没练过的溢出格：数字仍是要读的（那一格是可点的 Link，点进去就能补记）。
 * 上一版 opacity=0.35 把 mute 字压到 1.6:1——「不是本月」的信号强到把内容也一起吞了。
 * 「不是本月」应该由**有没有底块**来说，而不是把整格调暗。
 */
test('溢出格没练：日期仍读得出，靠没有底块来说明不是本月', async () => {
  await seedMonth();
  renderCal();
  await waitForHeat();

  const cellEl = cell(OVERFLOW_EMPTY);
  expect(cellEl.style.opacity).toBe('');

  const [r, g, b, alpha] = rgba(screen.getByTestId(`daynum-${OVERFLOW_EMPTY}`).style.color);
  expect([r, g, b]).toEqual(MUTE);
  expect(alpha).toBe(1);

  const BG = parseColor(THEME.bg).rgb;
  const bgc = parseColor(cellEl.style.background || cellEl.style.backgroundColor || THEME.bg);
  expect(contrastRatio(compositeOver(bgc.rgb, BG, bgc.alpha), MUTE)).toBeGreaterThanOrEqual(AA_TEXT);

  // 本月的空白格有底块（EMPTY_HEAT），溢出的融进页面底色——层次全靠这个说
  expect(parseColor(cell(IN_MONTH_EMPTY).style.background).rgb).toEqual(parseColor(EMPTY_HEAT).rgb);
  expect(compositeOver(bgc.rgb, BG, bgc.alpha)).toEqual(BG);
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

/**
 * 日历页最该一眼答出的问题是「这天练的什么」。而「一格一色」答不出它：
 * 胸 5 + 背 2 的那天和只练了胸的那天长得**一模一样**，格子里的图标行早就写着两个部位，
 * 底色却只有一个——同一个格子里两个模块互相拆台。
 *
 * 规则（至多两块、主练在前、对角硬边）是 heat.ts 的 cellParts / heatBackground，
 * 海报的 canvas 走同一套。这里只钉日历页有没有照做。
 */
describe('混合日：一个格子看得出练了两块', () => {
  test('底色沿对角线劈开：左上主练、右下次练，两块共享同一个浓度', async () => {
    await seedMonth();
    renderCal();
    await waitForHeat();

    // 胸 5 + 背 2 = 7 组。浓度由**总组数**决定（这天练得狠不狠），不是各自的组数
    const [main, second] = colorsOf(d('10'));
    expect(main).toBe(norm(calendarHeatColor('chest', 7, P90())));
    expect(second).toBe(norm(calendarHeatColor('back', 7, P90())));

    // 硬边、135deg（分割线 ╱）——不给插值区，否则中缝会糊出一个色表里不存在的第三色
    const fill = cell(d('10')).style.background || cell(d('10')).style.backgroundImage;
    expect(fill).toContain('linear-gradient');
    expect(fill).toContain('135deg');
  });

  test('底部色相条也劈成两段——饱和度被压低后，它才是「练了哪两块」的锚点', async () => {
    await seedMonth();
    renderCal();
    await waitForHeat();

    const bars = [...cell(d('10')).querySelectorAll<HTMLElement>('[data-hue]')];
    expect(bars.map((b) => b.getAttribute('data-hue'))).toEqual(['chest', 'back']);
    // 满饱和的部位本色，不是被 alpha 压过的填充色
    expect(bars[0].style.backgroundColor).toBe(norm(bodyPartInfo('chest').color));
    expect(bars[1].style.backgroundColor).toBe(norm(bodyPartInfo('back').color));
  });

  test('无障碍树里也得念全：读屏用户听到的不能只有主练部位', async () => {
    await seedMonth();
    renderCal();
    await waitForHeat();

    const label = cell(d('10')).getAttribute('aria-label')!;
    expect(label).toContain('胸');
    expect(label).toContain('背'); // 一格一色时代，这里只念得出「胸」
    expect(label).toContain('7组');
  });
});
