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

export const POSTER_W = 390;
/** 设计卡的 min-height。内容长了就往下长（卡上 .bottom 是 margin-top:auto）。 */
export const POSTER_MIN_H = 693;
/** 导出倍率：390×~900 的 3 倍 = 1170×~2700，够朋友圈/IG 清晰。 */
export const POSTER_SCALE = 3;

const PAD_X = 36;
const PAD_T = 44;
const PAD_B = 30;
const CW = POSTER_W - PAD_X * 2; // 318
const X0 = PAD_X;
const X1 = POSTER_W - PAD_X;

/* ── 颜色（= theme.css 的 token，Canvas 读不到 CSS 变量，只能同步一份）──── */

const BG = '#0A0A0B';
const INK = '#F2F0EB';
const MUTE = '#8B8B85';
const IRON = '#FF5C1F';
const AMBER = '#FFB340';
const LINE = 'rgba(255,255,255,.07)';
const TRACK = 'rgba(255,255,255,.05)';

/* ── 字体 ─────────────────────────────────────────────────────────────── */

/** 只给纯数字用。Anton 没有中文字形，写中文会出豆腐块。 */
const DISPLAY = "'Anton', 'Arial Narrow', 'Helvetica Neue', sans-serif";
const UI = "-apple-system, 'PingFang SC', 'Helvetica Neue', Arial, sans-serif";

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

/** 12400 → 12.4t；860 → 860kg；0 → 「—」（纯自重训练不该看到一个硬邦邦的 0） */
export function formatVolume(kg: number): { value: string; unit: string } {
  if (!(kg > 0)) return { value: '—', unit: '' };
  if (kg >= 1000) return { value: (kg / 1000).toFixed(1), unit: 't' };
  return { value: String(Math.round(kg)), unit: 'kg' };
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
    (16 + 12 + 10 + gridH + 6) + // 热力图（带 label）
    distH(d.split.length) +
    (d.prs.length === 0 ? 0 : 16 + 12 + 10 + d.prs.length * ROW_H + 6) +
    (20 + BOTTOM_H) +
    PAD_B
  );
}

export function posterSize(d: PosterData): { w: number; h: number } {
  const content = d.kind === 'monthly' ? monthlyContentH(d) : yearlyContentH(d);
  return { w: POSTER_W, h: Math.max(POSTER_MIN_H, Math.ceil(content)) };
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
  ctx.save();
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 2600; i++) {
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
  const baseline = y + 26 + 70;
  const g = ctx.createLinearGradient(X0, baseline - 70, X0 + 160, baseline);
  g.addColorStop(0, IRON);
  g.addColorStop(1, AMBER);
  text(ctx, big, X0, baseline, { font: display(88), fill: g });

  // 小标和大号基线对齐（卡上是同一行的 inline）
  const bigW = ctx.measureText(big).width;
  text(ctx, sub, X0 + bigW + 6, baseline, { font: ui(13), fill: MUTE, track: 4 });

  return y + 26 + 79 + 4;
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
  const vol = formatVolume(d.volumeKg);

  const cols: { value: string; unit: string; label: string; color: string }[] = [
    { value: String(d.sets), unit: '', label: '总组数 SETS', color: INK },
    { value: vol.value, unit: vol.unit, label: '总容量 VOLUME', color: INK },
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
  return top + 7 * YEAR_CELL + 6 * YEAR_GAP + 6;
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

function bottom(ctx: CanvasRenderingContext2D, h: number): void {
  const base = h - PAD_B;
  text(ctx, '你练过的，都有铁证。', X0, base - 15, {
    font: ui(15, 800),
    fill: INK,
    baseline: 'top',
    track: 1,
  });
  text(ctx, 'TIEZHENG.PAGES.DEV · 本地生成 · 照片不上传', X0, base, {
    font: ui(9),
    fill: MUTE,
    baseline: 'bottom',
    track: 2,
  });
  stamp(ctx, X1 - BOTTOM_H / 2, base - BOTTOM_H / 2, BOTTOM_H);
}

/* ── 对外的两个入口 ───────────────────────────────────────────────────── */

export function drawMonthlyPoster(ctx: CanvasRenderingContext2D, d: MonthlyPosterData): void {
  const { w, h } = posterSize(d);
  ctx.save();
  ctx.scale(POSTER_SCALE, POSTER_SCALE);

  background(ctx, w, h);
  topRow(ctx, 'MONTHLY PROOF');

  let y = titleBlock(ctx, pad2(d.month), `${d.year} ${MONTH_EN[d.month - 1]}`, PAD_T + 12);
  etch(ctx, y);
  y = hero(ctx, d.days, y + 1);
  y = metrics(ctx, d, y);
  etch(ctx, y);
  y = distBlock(ctx, d.split, y + 1);
  monthGridBlock(ctx, d, y);
  bottom(ctx, h);

  ctx.restore();
}

export function drawYearlyPoster(ctx: CanvasRenderingContext2D, d: YearlyPosterData): void {
  const { w, h } = posterSize(d);
  ctx.save();
  ctx.scale(POSTER_SCALE, POSTER_SCALE);

  background(ctx, w, h);
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

  ctx.restore();
}

export function drawPoster(ctx: CanvasRenderingContext2D, d: PosterData): void {
  if (d.kind === 'monthly') drawMonthlyPoster(ctx, d);
  else drawYearlyPoster(ctx, d);
}
