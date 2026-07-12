import { bodyPartInfo } from '../data/bodyParts';
import type { BodyPart } from './types';

/**
 * 热力色规则——日历格、年度热力图、海报 Canvas 三处共用的唯一真相源。
 *
 * 为什么是纯函数而不是共享组件：月历（7×5 大格带日期）和年度贡献图（53×7 小格）
 * 是两种不同的渲染，硬抽成一个组件只会两头不讨好。真正必须一致的是"同样的训练日
 * 在三个地方长同一个颜色"，那只是这个函数。
 */

/** 未训练日的底色（= --color-card）。有它兜底，空白格才不是纯黑洞。 */
export const EMPTY_HEAT = '#1A1A1D';

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

/** 当日主练部位的本色 + 由组数决定的浓淡。返回值可直接给 CSS 或 canvas fillStyle。 */
export function heatColor(part: BodyPart, sets: number, maxSets: number): string {
  const hex = bodyPartInfo(part).color;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.round(heatAlpha(sets, maxSets) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
