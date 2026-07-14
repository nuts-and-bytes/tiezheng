import { bodyPartInfo } from '../data/bodyParts';
import type { BodyPart } from './types';
import { THEME } from './theme';

/**
 * 热力色规则——日历格、年度热力图、海报 Canvas 三处共用的唯一真相源。
 *
 * 为什么是纯函数而不是共享组件：月历（7×5 大格带日期）和年度贡献图（53×7 小格）
 * 是两种不同的渲染，硬抽成一个组件只会两头不讨好。真正必须一致的是"同样的训练日
 * 在三个地方长同一个颜色"，那只是这个函数。
 */

/** 未训练日的底色（= --color-card）。有它兜底，空白格才不是纯黑洞。 */
export const EMPTY_HEAT = THEME.card;

/** 最低不透明度：练了一组也必须一眼看得出与空白格的区别。 */
export const HEAT_FLOOR = 0.3;

/**
 * 强度 → 不透明度。maxSets 传 percentile(dailySets, 90)，
 * 而不是 max()——否则一天练爆会把全年其余日子的颜色全冲淡。
 */
export function heatAlpha(sets: number, maxSets: number): number {
  const t = maxSets > 0 ? Math.min(Math.max(sets, 0) / maxSets, 1) : 0;
  return HEAT_FLOOR + (1 - HEAT_FLOOR) * t;
}

function rgb(part: BodyPart): [number, number, number] {
  const hex = bodyPartInfo(part).color;
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** 当日主练部位的本色 + 由组数决定的浓淡。返回值可直接给 CSS 或 canvas fillStyle。 */
export function heatColor(part: BodyPart, sets: number, maxSets: number): string {
  const [r, g, b] = rgb(part);
  const a = Math.round(heatAlpha(sets, maxSets) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * 日历格的浓度天花板。年度小格和海报格上没有字，可以满色；
 * 日历格上压着白色日期数字——满 alpha 的饱和红/紫会把白字吃掉。
 */
export const CALENDAR_ALPHA_CEIL = 0.6;

/** 日历格专用：同一个色相、同一条浓淡曲线，只是整体压到 CALENDAR_ALPHA_CEIL 以内。 */
export function calendarHeatColor(part: BodyPart, sets: number, maxSets: number): string {
  const [r, g, b] = rgb(part);
  const a = Math.round(heatAlpha(sets, maxSets) * CALENDAR_ALPHA_CEIL * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * 一个格子最多承载两块部位。
 *
 * 一格一色是一次有损压缩：胸 18 组 + 背 18 组的那天只涂胸色，而同屏的「部位分布」
 * 正写着胸 18 / 背 18——两个模块在同一页上互相拆台。更要命的是，练一块和练两块的
 * 日子长得一模一样，日历页最该一眼答出的问题（「这天练的什么」）它答不出。
 *
 * 为什么止步于 2：第三条色带在 4px 的海报年度格上不足 1px，画出来只是噪声；
 * 日历格的图标行早就是 slice(0, 2)（CalendarScreen 一直这么画），色块跟上它就是了。
 */
export const CELL_PARTS_MAX = 2;

/**
 * 一格涂哪几块（主练在前）。
 * 不排序——dailyPartBreakdown 已经排好，并列也已定好决胜规则；这里只负责「至多两块」这一刀。
 */
export function cellParts(parts: BodyPart[]): BodyPart[] {
  return parts.slice(0, CELL_PARTS_MAX);
}

/**
 * 1~2 个色 → 一块 CSS 背景。
 *
 * 对角分割，不是左右/上下对半：45° 是格子里最长的那条边，4px 的小格上仍然可辨；
 * 横竖分割在小格上会跟网格自己的行列缝混成一片。
 *
 * 两个色标都落在 50%（硬边），不给插值区——否则两个部位色会在中缝糊出第三个颜色，
 * 而那个颜色在色表里不存在，读者只会当成第三个部位。
 *
 * 135deg 的渐变线指向右下，所以分割线是 ╱，主练色占左上——跟 canvas 侧画的三角同向。
 */
export function heatBackground(colors: string[]): string {
  if (colors.length === 0) return EMPTY_HEAT;
  if (colors.length === 1) return colors[0];
  return `linear-gradient(135deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`;
}
