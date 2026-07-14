import { BODY_PARTS, bodyPartInfo } from '../data/bodyParts';
import { addDays, monthGrid, weekStartOf } from './dates';
import { EMPTY_HEAT, heatColor } from './heat';
import {
  dailyPartLoad,
  longestStreak,
  percentile,
  prsByExercise,
  setsByBodyPart,
  totals,
  type ExMap,
  type LoadItem,
} from './stats';
import { FONT, THEME } from './theme';
import type { BodyPart } from './types';

/**
 * 海报：纯 Canvas 2D 手绘，零依赖、零网络请求。
 *
 * 三条硬约束，改这个文件前先读：
 * 1. **隐私**：入参只有 LoadItem（date / exerciseId / sets）和日期字符串——
 *    结构上就拿不到 workout.note。海报画不出 note，不是因为我们记得躲开它，
 *    而是因为它根本没进这个模块。poster.test.ts 里有回归测试盯着。
 * 2. **颜色**：热力格一律走 heat.ts 的 heatColor / EMPTY_HEAT。日历页、数据页年度图、
 *    海报三处必须像素级同色，所以这里绝不许自己调色。
 * 3. **字体**：Anton（--font-display）是数字子集，**没有中文字形**。中文一律走系统字体栈，
 *    只有纯数字才配 display 字体。测试会抓「中文用了 Anton」。
 *
 * 排版坐标系 = 设计卡的 CSS 像素（宽 390），导出时整体 scale(POSTER_SCALE)。
 * 这样设计卡上的每个数字（44 内边距 / 88 月份 / 120 hero）都能原样抄进来。
 * 真相源：docs/design-cards/poster/monthly.html
 */

/* ── 画布尺寸 ─────────────────────────────────────────────────────────── */

/** 内容坐标系的宽度 = 设计卡宽度。所有区块的坐标都活在这个坐标系里。 */
export const POSTER_W = 390;

/**
 * 相框：540×960 = 精确 9:16。
 *
 * 海报的**成品尺寸必须是常数**。之前是「高度随内容长」，结果 3 月导出 1170×2853、
 * 7 月 1170×2715——同一个人分享两个月，社交平台裁出来的边不一样，还都不是 9:16。
 * 现在内容照旧按自然高度排，画完整块居中放进这个固定相框里，多出来的地方是衬边。
 */
export const FRAME_W = 540;
export const FRAME_H = 960;
/** 导出倍率：540×960 的 2 倍 = 1080×1920，朋友圈/IG Story 的原生画幅。 */
export const POSTER_SCALE = 2;

const PAD_X = 36;
const PAD_T = 44;
const PAD_B = 30;
const CW = POSTER_W - PAD_X * 2; // 318
const X0 = PAD_X;
const X1 = POSTER_W - PAD_X;

/* ── 颜色 ─────────────────────────────────────────────────────────────── */

// Canvas 读不到 CSS 变量，但也不必手抄：src/lib/theme.ts 是 token 的 JS 镜像，
// 由 theme.test.ts 逐字钉在 theme.css 上。
const { bg: BG, ink: INK, mute: MUTE, iron: IRON, amber: AMBER, line: LINE } = THEME;
/** 轨道底色只有海报用（比 --color-line 再退半档），不是 token，别往 theme.css 里塞。 */
const TRACK = 'rgba(255,255,255,.05)';

/* ── 字体 ─────────────────────────────────────────────────────────────── */

/** 只给纯数字用。Anton 没有中文字形，写中文会出豆腐块。 */
const DISPLAY = FONT.display;
const UI = FONT.body;

const display = (size: number) => `${size}px ${DISPLAY}`;
const ui = (size: number, weight = 400) => `${weight} ${size}px ${UI}`;

const MONTH_EN = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

/* ── 数据模型 ─────────────────────────────────────────────────────────── */

/** 热力格：一天。part=null 表示当天没练（画 EMPTY_HEAT）。 */
export interface HeatCell {
  date: string;
  part: BodyPart | null;
  sets: number;
}

export interface SplitRow {
  part: BodyPart;
  name: string;
  sets: number;
}

export interface PosterPr {
  name: string;
  weight: number;
  reps: number;
  e1rm: number;
}

interface PosterBase {
  days: number;
  sets: number;
  /** 跟 volumeKg 平级带上来：纯自重训练者的容量恒为 0，次数才是他的负荷维度（见 loadMetric） */
  reps: number;
  volumeKg: number;
  streak: number;
  split: SplitRow[];
  maxSets: number;
}

export interface MonthlyPosterData extends PosterBase {
  kind: 'monthly';
  year: number;
  month: number;
  /** 按周对齐的月历，每行 7 格；非本月的位置是 null */
  weeks: (HeatCell | null)[][];
}

export interface YearlyPosterData extends PosterBase {
  kind: 'yearly';
  year: number;
  /** 53 列 × 7 行的贡献图；跨年的位置是 null */
  columns: (HeatCell | null)[][];
  prs: PosterPr[];
}

export type PosterData = MonthlyPosterData | YearlyPosterData;

/** 海报的原料。注意这里**没有** note——隐私铁律靠类型来保证，不靠自觉。 */
export interface PosterInput {
  items: LoadItem[];
  dates: string[];
  exMap: ExMap;
}

const MAX_SPLIT_ROWS = 5;
const MAX_PR_ROWS = 3;

/* ── 组装（纯函数）─────────────────────────────────────────────────────── */

function baseOf(items: LoadItem[], dates: string[], exMap: ExMap): PosterBase & { load: Map<string, { part: BodyPart; sets: number }> } {
  const t = totals(items, dates);
  const bySet = setsByBodyPart(items, exMap);
  const split = BODY_PARTS.map((p) => ({ part: p.id, name: p.name, sets: bySet[p.id] }))
    .filter((r) => r.sets > 0)
    .sort((a, b) => b.sets - a.sets)
    .slice(0, MAX_SPLIT_ROWS);

  const load = dailyPartLoad(items, exMap);
  // 90 分位而不是 max：一天练爆不许把其余日子的颜色全冲淡（见 heat.ts）
  const maxSets = percentile([...load.values()].map((v) => v.sets), 90);

  return {
    days: t.days,
    sets: t.sets,
    reps: t.reps,
    volumeKg: t.volumeKg,
    streak: longestStreak(dates),
    split,
    maxSets,
    load,
  };
}

function cellOf(
  date: string,
  prefix: string,
  load: Map<string, { part: BodyPart; sets: number }>,
): HeatCell | null {
  if (!date.startsWith(prefix)) return null;
  const hit = load.get(date);
  return { date, part: hit?.part ?? null, sets: hit?.sets ?? 0 };
}

/** ym = '2026-07' */
export function buildMonthly(ym: string, input: PosterInput): MonthlyPosterData {
  const [year, month] = ym.split('-').map(Number);
  const items = input.items.filter((i) => i.date.startsWith(ym));
  const dates = input.dates.filter((d) => d.startsWith(ym));
  const { load, ...base } = baseOf(items, dates, input.exMap);

  const grid = monthGrid(ym).map((d) => cellOf(d, ym, load));
  const weeks: (HeatCell | null)[][] = [];
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7));
  while (weeks.length > 0 && weeks[weeks.length - 1]!.every((c) => c === null)) weeks.pop();

  return { kind: 'monthly', year, month, weeks, ...base };
}

export function buildYearly(year: number, input: PosterInput): YearlyPosterData {
  const prefix = `${year}-`;
  const items = input.items.filter((i) => i.date.startsWith(prefix));
  const dates = input.dates.filter((d) => d.startsWith(prefix));
  const { load, ...base } = baseOf(items, dates, input.exMap);

  const columns: (HeatCell | null)[][] = [];
  const end = `${year}-12-31`;
  let cur = weekStartOf(`${year}-01-01`);
  for (;;) {
    columns.push(Array.from({ length: 7 }, (_, i) => cellOf(addDays(cur, i), prefix, load)));
    if (addDays(cur, 6) >= end) break;
    cur = addDays(cur, 7);
  }

  const prs = prsByExercise(items, input.exMap)
    .slice(0, MAX_PR_ROWS)
    .map((p) => ({ name: p.name, weight: p.weight, reps: p.reps, e1rm: p.e1rm }));

  return { kind: 'yearly', year, columns, prs, ...base };
}

/* ── 格式化 ───────────────────────────────────────────────────────────── */

/**
 * 12400 → 12.4t；860 → 860kg。
 * 0 → 「—」只是一道兜底防线，海报走不到这里：负荷那一格由 loadMetric 决定，
 * 容量为 0 时它压根不会问容量该怎么格式化。
 */
export function formatVolume(kg: number): { value: string; unit: string } {
  if (!(kg > 0)) return { value: '—', unit: '' };
  if (kg >= 1000) return { value: (kg / 1000).toFixed(1), unit: 't' };
  return { value: String(Math.round(kg)), unit: 'kg' };
}

/**
 * 三大数字中间那一格：负荷。
 *
 * 容量 = 重量 × 次数，所以练俯卧撑和引体向上的人恒为 0 —— 而这是一个要分享出去的
 * 28px 大字。他读到的不是「我没记重量」，是「我练了等于零」。降级成「—」也一样：
 * 那还是「本该有东西但没有」。他的负荷维度本来就是次数，那个数字是真的。
 *
 * 数据页（weighted ? Volume : 总次数）和资料页（hasWeightData ? Volume : 总次数）
 * 早就是这条口径了，海报是最后一处补上的。
 */
export function loadMetric(d: { volumeKg: number; reps: number }): {
  value: string;
  unit: string;
  label: string;
} {
  if (!(d.volumeKg > 0)) return { value: String(d.reps), unit: '', label: '总次数 REPS' };
  return { ...formatVolume(d.volumeKg), label: '总容量 VOLUME' };
}

/**
 * 年度热力图的月份刻度：某一列里含有当年某月的 1 号，就在那列底下标那个月。
 *
 * 直接从 columns 派生（HeatCell 自带 date），而不是拿 year 去重算一遍 heatWeekStarts ——
 * 刻度和格子于是必然对齐，不靠两处算法凑巧同构。跨年的格子在 buildYearly 里已经是 null，
 * 上一年 12 月的尾巴带不出一个假的「12」。
 */
export function monthTicks(columns: (HeatCell | null)[][]): (number | null)[] {
  return columns.map((col) => {
    for (const cell of col) {
      if (cell && cell.date.slice(8) === '01') return Number(cell.date.slice(5, 7));
    }
    return null;
  });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function posterFileName(d: PosterData): string {
  return d.kind === 'monthly'
    ? `ironproof-${d.year}-${pad2(d.month)}.png`
    : `ironproof-${d.year}.png`;
}

export function posterTitle(d: PosterData): string {
  return d.kind === 'monthly' ? `铁证 · ${d.year}年${d.month}月` : `铁证 · ${d.year} 年度`;
}

/* ── 版式度量（画之前先知道有多高）───────────────────────────────────── */

const GRID_GAP = 3;
const MONTH_CELL = (CW - GRID_GAP * 6) / 7; // 42.857
const YEAR_GAP = 2;
/** 月份刻度：格子底下 4px 处的一行 9px 小字（1..12） */
const TICK_GAP = 4;
const TICK_SIZE = 9;
const YEAR_COLS = 53;
const YEAR_CELL = (CW - YEAR_GAP * (YEAR_COLS - 1)) / YEAR_COLS; // 4.04
const ROW_H = 20; // 分布行 / PR 行
const BOTTOM_H = 74; // 钢印

/** 分布区（含 label + 上下 margin）。没数据就整块不出现。 */
function distH(rows: number): number {
  return rows === 0 ? 0 : 16 + 12 + 10 + rows * ROW_H + 6;
}

function monthlyContentH(d: MonthlyPosterData): number {
  const gridRows = d.weeks.length;
  const gridH = gridRows * MONTH_CELL + (gridRows - 1) * GRID_GAP;
  return (
    PAD_T +
    12 + // .top
    (26 + 79 + 4) + // .month
    1 + // .etch
    (18 + 108 + 6) + // .hero
    (22 + 49 + 22) + // .metrics
    1 + // .etch
    distH(d.split.length) +
    (14 + gridH + 4) + // .mini-grid
    (20 + BOTTOM_H) + // .bottom
    PAD_B
  );
}

function yearlyContentH(d: YearlyPosterData): number {
  const gridH = 7 * YEAR_CELL + 6 * YEAR_GAP;
  return (
    PAD_T +
    12 +
    (26 + 79 + 4) +
    1 +
    (18 + 108 + 6) +
    (22 + 49 + 22) +
    1 +
    (16 + 12 + 10 + gridH + TICK_GAP + TICK_SIZE + 6) + // 热力图（带 label + 月份刻度）
    distH(d.split.length) +
    (d.prs.length === 0 ? 0 : 16 + 12 + 10 + d.prs.length * ROW_H + 6) +
    (20 + BOTTOM_H) +
    PAD_B
  );
}

/** 内容的自然高度（不含衬边）。海报画多高由它说了算，但**画布多大跟它无关**。 */
export function contentH(d: PosterData): number {
  return Math.ceil(d.kind === 'monthly' ? monthlyContentH(d) : yearlyContentH(d));
}

/** 画布尺寸恒定：稀疏月、6 周月、年度、空数据，都是同一张 9:16 的相框。 */
export function posterSize(_d?: PosterData): { w: number; h: number } {
  return { w: FRAME_W, h: FRAME_H };
}

/* ── 排版不变量（纯函数，注入 measure）───────────────────────────────────
   标题小标溢出、footer 两行重叠，本质都是「排版结果没人量过」。把量文字这件事
   抽成注入的 measure，布局就成了可测的纯函数——测试直接断言几何，不用去 mock
   一整个 CanvasRenderingContext2D。 */

/** (文字, CSS font) → 宽度。绘制时接 ctx.measureText，测试里接确定性假字宽。 */
export type Measure = (text: string, font: string) => number;

type Step = readonly [size: number, track: number];

interface Fit {
  text: string;
  size: number;
  track: number;
  width: number;
  /** 原文完整放下了吗（false = 连最小档都不够，只能截断/换行） */
  ok: boolean;
}

/** letterSpacing 在每个字后面都补一次，所以宽度要按字数把 track 加回来。 */
function lineW(measure: Measure, s: string, font: string, track: number): number {
  return measure(s, font) + track * [...s].length;
}

/**
 * 按阶梯降级把一行文字塞进 avail：先收字距，再收字号。
 * 到最小档还是放不下才截断——截断是最后一招，因为 footer 那句是隐私承诺，
 * 掉字等于承诺缺一半。
 */
function fitLine(
  measure: Measure,
  s: string,
  avail: number,
  steps: readonly Step[],
  font: (size: number) => string,
): Fit {
  for (const [size, track] of steps) {
    const w = lineW(measure, s, font(size), track);
    if (w <= avail) return { text: s, size, track, width: w, ok: true };
  }

  const [size, track] = steps[steps.length - 1]!;
  const chars = [...s];
  while (chars.length > 1) {
    chars.pop();
    const t = `${chars.join('')}…`;
    const w = lineW(measure, t, font(size), track);
    if (w <= avail) return { text: t, size, track, width: w, ok: false };
  }
  return { text: s, size, track, width: lineW(measure, s, font(size), track), ok: false };
}

/* ── 标题块 ─────────────────────────────────────────────────────────── */

const BIG_SIZE = 88;
const BIG_BASELINE = 26 + 70;
const TITLE_H = 26 + 79 + 4;
const SUB_GAP = 6;
/** 小标降级阶梯：设计值 13/4 打头，一路收到 10/0 为止。 */
const SUB_STEPS: readonly Step[] = [
  [13, 4],
  [13, 3],
  [13, 2],
  [12, 2],
  [12, 1],
  [11, 1],
  [11, 0],
  [10, 0],
];
/** 换行到大字下面时最多 11px：再大就会顶穿标题块下沿的蚀刻线。 */
const WRAP_STEPS = SUB_STEPS.filter(([size]) => size <= 11);

export interface TitleLayout {
  /** 小标的 x（未换行时跟在大字后面，换行后回到左边距） */
  x: number;
  /** 小标基线，相对标题块顶部 */
  y: number;
  text: string;
  size: number;
  track: number;
  wrapped: boolean;
  /** 整块内容的右边缘——这个值必须恒 ≤ X1，否则就是溢出画布 */
  right: number;
  /** 标题块高度：恒定。换行也不许把它撑高，否则底部会被挤出相框 */
  height: number;
}

/**
 * 大字 + 小标。'2026' + 'THE YEAR IN IRON' 按设计值要占到 x≈398——画布只有 390 宽，
 * 年度海报的小标从来就是被切掉半截的。所以这里不再假设「反正放得下」：
 * 量一次，放不下就降级，再放不下就换行到大字下面。
 */
export function titleLayout(measure: Measure, big: string, sub: string): TitleLayout {
  const bigW = measure(big, display(BIG_SIZE));
  const inlineX = X0 + bigW + SUB_GAP;

  const inline = fitLine(measure, sub, X1 - inlineX, SUB_STEPS, (s) => ui(s));

  if (inline.ok) {
    return {
      x: inlineX,
      y: BIG_BASELINE,
      text: inline.text,
      size: inline.size,
      track: inline.track,
      wrapped: false,
      right: Math.max(X0 + bigW, inlineX + inline.width),
      height: TITLE_H,
    };
  }

  const wrap = fitLine(measure, sub, CW, WRAP_STEPS, (s) => ui(s));
  return {
    x: X0,
    y: BIG_BASELINE + 11,
    text: wrap.text,
    size: wrap.size,
    track: wrap.track,
    wrapped: true,
    right: Math.max(X0 + bigW, X0 + wrap.width),
    height: TITLE_H,
  };
}

/* ── footer ──────────────────────────────────────────────────────────── */

const TAGLINE = '你练过的，都有铁证。';
const META = 'TIEZHENG.PAGES.DEV · 本地生成 · 照片不上传';
const TAGLINE_SIZE = 15;
const LINE_GAP = 8;
/** 小字降级阶梯：先收字距（2→0），再掉一号字。 */
const META_STEPS: readonly Step[] = [
  [9, 2],
  [9, 1],
  [9, 0],
  [8, 1],
  [8, 0],
];
/** 文字和钢印之间的呼吸 */
const STAMP_GUTTER = 12;

export interface FooterLine {
  text: string;
  x: number;
  /** 绘制时传给 fillText 的 y（tagline 是 top 基线，meta 是 bottom 基线） */
  y: number;
  size: number;
  track: number;
  top: number;
  bottom: number;
  right: number;
}

export interface FooterLayout {
  tagline: FooterLine;
  meta: FooterLine;
  stamp: { cx: number; cy: number; size: number; left: number };
}

/**
 * 底部两行 + 钢印。原来两行都压在 base 附近（一个 top 基线 -15、一个 bottom 基线 0），
 * 在 base-9..base 这 9px 里整个叠在一起——小字直接糊在标语上。
 * 现在两行明确垂直堆叠，且都不许伸进钢印的地盘。
 */
export function footerLayout(measure: Measure, h: number): FooterLayout {
  const base = h - PAD_B;
  const stampLeft = X1 - BOTTOM_H;
  const avail = stampLeft - STAMP_GUTTER - X0;

  const meta = fitLine(measure, META, avail, META_STEPS, (s) => ui(s));
  const tagline = fitLine(measure, TAGLINE, avail, [[TAGLINE_SIZE, 1]], (s) => ui(s, 800));

  const metaTop = base - meta.size;
  const taglineTop = metaTop - LINE_GAP - TAGLINE_SIZE;

  return {
    tagline: {
      text: tagline.text,
      x: X0,
      y: taglineTop, // baseline: 'top'
      size: tagline.size,
      track: tagline.track,
      top: taglineTop,
      bottom: taglineTop + TAGLINE_SIZE,
      right: X0 + tagline.width,
    },
    meta: {
      text: meta.text,
      x: X0,
      y: base, // baseline: 'bottom'
      size: meta.size,
      track: meta.track,
      top: metaTop,
      bottom: base,
      right: X0 + meta.width,
    },
    stamp: {
      cx: X1 - BOTTOM_H / 2,
      cy: base - BOTTOM_H / 2,
      size: BOTTOM_H,
      left: stampLeft,
    },
  };
}

/* ── Canvas 原语 ──────────────────────────────────────────────────────── */

/** letterSpacing 是 Chrome 99+ / Safari 17.4+ 才有的；老设备上退化成不带字距，不炸。 */
type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

interface TextOpt {
  font: string;
  fill: string | CanvasGradient;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  track?: number;
}

/** 把 ctx 包成布局函数要的 Measure。（ctx.font 会被改写，但每次 text() 都会重设，无副作用） */
function measureWith(ctx: CanvasRenderingContext2D): Measure {
  return (s, font) => {
    ctx.font = font;
    return ctx.measureText(s).width;
  };
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpt): void {
  const c = ctx as Ctx;
  ctx.font = o.font;
  ctx.fillStyle = o.fill;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  if ('letterSpacing' in c) c.letterSpacing = `${o.track ?? 0}px`;
  ctx.fillText(s, x, y);
  if ('letterSpacing' in c) c.letterSpacing = '0px';
}

/** roundRect 在老 iOS Safari 上没有，自己用 arcTo 搓一个。 */
function roundPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function fillRound(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  roundPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function etch(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(X0, y, CW, 1);
  ctx.fillStyle = 'rgba(0,0,0,.65)'; // 蚀刻线的下沿高光，让 1px 有厚度
  ctx.fillRect(X0, y + 1, CW, 1);
}

/** 确定性噪点，代替设计卡里的 SVG feTurbulence（不许引外部资源）。 */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  let seed = 0x1f5c1f;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  // 按面积撒点：换了相框尺寸，噪点密度还得是原来那个密度（约 142px²/点）
  const dots = Math.round((w * h) / 142);
  ctx.save();
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#FFFFFF' : '#000000';
    ctx.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 1, 1);
  }
  ctx.restore();
}

function background(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  // radial-gradient(120% 70% at 50% -10%, rgba(255,92,31,.16), transparent 60%)
  const g = ctx.createRadialGradient(w / 2, -h * 0.1, 0, w / 2, -h * 0.1, w * 0.72);
  g.addColorStop(0, 'rgba(255,92,31,.16)');
  g.addColorStop(1, 'rgba(255,92,31,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  grain(ctx, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

/* ── 各个区块 ─────────────────────────────────────────────────────────── */

function topRow(ctx: CanvasRenderingContext2D, right: string): void {
  text(ctx, '铁证 IRONPROOF', X0, PAD_T, { font: ui(10), fill: MUTE, baseline: 'top', track: 3 });
  text(ctx, right, X1, PAD_T, {
    font: ui(10),
    fill: MUTE,
    baseline: 'top',
    align: 'right',
    track: 3,
  });
}

/** 大号 + 小标：'07' / '2026 JULY'。大号走渐变（设计卡的 background-clip:text）。 */
function titleBlock(ctx: CanvasRenderingContext2D, big: string, sub: string, y: number): number {
  const l = titleLayout(measureWith(ctx), big, sub);
  const baseline = y + BIG_BASELINE;

  const g = ctx.createLinearGradient(X0, baseline - 70, X0 + 160, baseline);
  g.addColorStop(0, IRON);
  g.addColorStop(1, AMBER);
  text(ctx, big, X0, baseline, { font: display(BIG_SIZE), fill: g });

  text(ctx, l.text, l.x, y + l.y, { font: ui(l.size), fill: MUTE, track: l.track });

  return y + l.height;
}

/** hero：120px 打卡天数 + 单位。天数是海报唯一的主角。 */
function hero(ctx: CanvasRenderingContext2D, days: number, y: number): number {
  const baseline = y + 18 + 96;
  const n = String(days);
  text(ctx, n, X0, baseline, { font: display(120), fill: INK });
  const nW = ctx.measureText(n).width;
  text(ctx, '天 · 盖下钢印', X0 + nW + 12, baseline, { font: ui(15), fill: MUTE });
  return y + 18 + 108 + 6;
}

function metrics(ctx: CanvasRenderingContext2D, d: PosterData, y: number): number {
  const top = y + 22;
  const sepW = 1;
  const sepM = 14;
  const colW = (CW - 2 * (sepW + sepM * 2)) / 3;

  const cols: { value: string; unit: string; label: string; color: string }[] = [
    { value: String(d.sets), unit: '', label: '总组数 SETS', color: INK },
    // 容量 or 次数——自重训练者不该在这儿看到一个破折号（见 loadMetric）
    { ...loadMetric(d), color: INK },
    // 连续是唯一被高亮的指标——它是这张海报真正想夸的事
    { value: String(d.streak), unit: '', label: '最长连续 STREAK', color: AMBER },
  ];

  cols.forEach((c, i) => {
    const x = X0 + i * (colW + sepW + sepM * 2);
    const baseline = top + 28;
    text(ctx, c.value, x, baseline, { font: display(28), fill: c.color });
    if (c.unit) {
      const w = ctx.measureText(c.value).width;
      text(ctx, c.unit, x + w + 1, baseline, { font: display(16), fill: c.color });
    }
    text(ctx, c.label, x, baseline + 9, { font: ui(10), fill: MUTE, baseline: 'top', track: 1 });

    if (i < 2) {
      ctx.fillStyle = LINE;
      ctx.fillRect(x + colW + sepM, top + 4, sepW, 41);
    }
  });

  return y + 22 + 49 + 22;
}

/** 小标签（部位分布 / 全年热力 / 年度突破） */
function sectionLabel(ctx: CanvasRenderingContext2D, label: string, y: number): number {
  text(ctx, label, X0, y + 16, { font: ui(10), fill: MUTE, baseline: 'top', track: 2 });
  return y + 16 + 12 + 10;
}

function distBlock(ctx: CanvasRenderingContext2D, split: SplitRow[], y: number): number {
  if (split.length === 0) return y;
  let cur = sectionLabel(ctx, '部位分布 SPLIT', y);

  const nameW = 26;
  const valueW = 36;
  const gap = 8;
  const trackX = X0 + nameW + gap;
  const trackW = CW - nameW - valueW - gap * 2;
  const top = split[0]!.sets;

  for (const row of split) {
    const mid = cur + ROW_H / 2 - 3;
    text(ctx, row.name, X0, cur + ROW_H / 2, { font: ui(11), fill: MUTE, baseline: 'middle' });
    fillRound(ctx, trackX, mid, trackW, 6, 3, TRACK);
    const w = Math.max(6, (row.sets / top) * trackW);
    fillRound(ctx, trackX, mid, w, 6, 3, bodyPartInfo(row.part).color);
    text(ctx, String(row.sets), X1, cur + ROW_H / 2, {
      font: ui(11),
      fill: MUTE,
      align: 'right',
      baseline: 'middle',
    });
    cur += ROW_H;
  }

  return cur + 6;
}

/** 热力格：颜色**只能**来自 heat.ts，日历页 / 数据页 / 海报三处同色。 */
function heatCell(
  ctx: CanvasRenderingContext2D,
  cell: HeatCell | null,
  x: number,
  y: number,
  size: number,
  maxSets: number,
  radius: number,
): void {
  if (cell === null) return; // 不属于本月/本年：留空，不画
  const fill =
    cell.part === null || cell.sets === 0 ? EMPTY_HEAT : heatColor(cell.part, cell.sets, maxSets);
  fillRound(ctx, x, y, size, size, radius, fill);
}

function monthGridBlock(ctx: CanvasRenderingContext2D, d: MonthlyPosterData, y: number): number {
  const top = y + 14;
  d.weeks.forEach((week, r) => {
    week.forEach((cell, c) => {
      heatCell(
        ctx,
        cell,
        X0 + c * (MONTH_CELL + GRID_GAP),
        top + r * (MONTH_CELL + GRID_GAP),
        MONTH_CELL,
        d.maxSets,
        3,
      );
    });
  });
  const rows = d.weeks.length;
  return top + rows * MONTH_CELL + (rows - 1) * GRID_GAP + 4;
}

function yearGridBlock(ctx: CanvasRenderingContext2D, d: YearlyPosterData, y: number): number {
  const top = sectionLabel(ctx, '全年热力 HEATMAP', y);
  d.columns.forEach((col, c) => {
    col.forEach((cell, r) => {
      heatCell(
        ctx,
        cell,
        X0 + c * (YEAR_CELL + YEAR_GAP),
        top + r * (YEAR_CELL + YEAR_GAP),
        YEAR_CELL,
        d.maxSets,
        1,
      );
    });
  });

  // 没有时间轴的热力图只是一张色块壁纸——读者认不出哪一列是几月
  const ticksTop = top + 7 * YEAR_CELL + 6 * YEAR_GAP + TICK_GAP;
  monthTicks(d.columns).forEach((m, c) => {
    if (m === null) return;
    text(ctx, String(m), X0 + c * (YEAR_CELL + YEAR_GAP), ticksTop, {
      font: ui(TICK_SIZE),
      fill: MUTE,
      baseline: 'top',
    });
  });

  return ticksTop + TICK_SIZE + 6;
}

function prBlock(ctx: CanvasRenderingContext2D, prs: PosterPr[], y: number): number {
  if (prs.length === 0) return y;
  let cur = sectionLabel(ctx, '年度突破 PR', y);
  for (const p of prs) {
    text(ctx, p.name, X0, cur + ROW_H / 2, { font: ui(11), fill: MUTE, baseline: 'middle' });
    text(ctx, `${p.weight}kg × ${p.reps}`, X1, cur + ROW_H / 2, {
      font: ui(11, 600),
      fill: INK,
      align: 'right',
      baseline: 'middle',
    });
    cur += ROW_H;
  }
  return cur + 6;
}

/** 钢印：整个产品的核心隐喻，海报的落款。几何取自 components/Stamp.tsx（96px 基准）。 */
function stamp(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const k = size / 96;
  const half = size / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-6 * Math.PI) / 180);

  ctx.shadowColor = 'rgba(255,92,31,.4)';
  ctx.shadowBlur = 26;
  ctx.strokeStyle = IRON;
  ctx.lineWidth = 3;
  roundPath(ctx, -half, -half, size, size, 14);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = 'rgba(255,92,31,.45)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  roundPath(ctx, -half + 5 * k, -half + 5 * k, size - 10 * k, size - 10 * k, 10);
  ctx.stroke();
  ctx.setLineDash([]);

  text(ctx, '铁', 0, 2, {
    font: ui(38, 900),
    fill: IRON,
    align: 'center',
    baseline: 'middle',
  });

  ctx.restore();
}

/** h 是**内容的自然高度**，不是相框高度——footer 贴的是内容的底，不是衬边的底。 */
function bottom(ctx: CanvasRenderingContext2D, h: number): void {
  const f = footerLayout(measureWith(ctx), h);

  text(ctx, f.tagline.text, f.tagline.x, f.tagline.y, {
    font: ui(f.tagline.size, 800),
    fill: INK,
    baseline: 'top',
    track: f.tagline.track,
  });
  text(ctx, f.meta.text, f.meta.x, f.meta.y, {
    font: ui(f.meta.size),
    fill: MUTE,
    baseline: 'bottom',
    track: f.meta.track,
  });
  stamp(ctx, f.stamp.cx, f.stamp.cy, f.stamp.size);
}

/* ── 对外的两个入口 ───────────────────────────────────────────────────── */

/**
 * 相框铺满 → 内容整块居中 → 画内容。内容坐标系（宽 390）原样保留，
 * 每个区块该在哪还在哪，只是整块被 translate 进了相框中央。
 */
function withFrame(
  ctx: CanvasRenderingContext2D,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  ctx.save();
  ctx.scale(POSTER_SCALE, POSTER_SCALE);

  background(ctx, FRAME_W, FRAME_H); // 噪点和暗角是整张相框的，衬边也得有

  ctx.save();
  ctx.translate((FRAME_W - POSTER_W) / 2, Math.round((FRAME_H - h) / 2));
  draw(ctx);
  ctx.restore();

  ctx.restore();
}

export function drawMonthlyPoster(ctx: CanvasRenderingContext2D, d: MonthlyPosterData): void {
  const h = contentH(d);
  withFrame(ctx, h, () => {
    topRow(ctx, 'MONTHLY PROOF');

    let y = titleBlock(ctx, pad2(d.month), `${d.year} ${MONTH_EN[d.month - 1]}`, PAD_T + 12);
    etch(ctx, y);
    y = hero(ctx, d.days, y + 1);
    y = metrics(ctx, d, y);
    etch(ctx, y);
    y = distBlock(ctx, d.split, y + 1);
    monthGridBlock(ctx, d, y);
    bottom(ctx, h);
  });
}

export function drawYearlyPoster(ctx: CanvasRenderingContext2D, d: YearlyPosterData): void {
  const h = contentH(d);
  withFrame(ctx, h, () => {
    topRow(ctx, 'YEARLY PROOF');

    let y = titleBlock(ctx, String(d.year), 'THE YEAR IN IRON', PAD_T + 12);
    etch(ctx, y);
    y = hero(ctx, d.days, y + 1);
    y = metrics(ctx, d, y);
    etch(ctx, y);
    y = yearGridBlock(ctx, d, y + 1);
    y = distBlock(ctx, d.split, y);
    prBlock(ctx, d.prs, y);
    bottom(ctx, h);
  });
}

export function drawPoster(ctx: CanvasRenderingContext2D, d: PosterData): void {
  if (d.kind === 'monthly') drawMonthlyPoster(ctx, d);
  else drawYearlyPoster(ctx, d);
}
