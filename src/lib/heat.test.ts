import { describe, expect, it } from 'vitest';
import {
  CALENDAR_ALPHA_CEIL,
  EMPTY_HEAT,
  HEAT_FLOOR,
  calendarHeatColor,
  heatAlpha,
  heatColor,
} from './heat';

describe('heatAlpha', () => {
  it('练了一组也必须比空白格明显——不透明度有下限', () => {
    expect(heatAlpha(1, 20)).toBeGreaterThanOrEqual(HEAT_FLOOR);
  });

  it('达到或超过 maxSets 时到满色，且不会溢出 1', () => {
    expect(heatAlpha(10, 10)).toBeCloseTo(1, 5);
    expect(heatAlpha(999, 10)).toBeCloseTo(1, 5);
  });

  it('组数越多颜色越浓（单调递增）', () => {
    const ramp = [1, 3, 5, 8, 10].map((s) => heatAlpha(s, 10));
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);
    }
  });

  it('maxSets 为 0 时不产生 NaN（全年只有空白日的极端情况）', () => {
    const a = heatAlpha(0, 0);
    expect(Number.isNaN(a)).toBe(false);
    expect(a).toBeCloseTo(HEAT_FLOOR, 5);
  });
});

describe('heatColor', () => {
  it('用该部位的本色，不是统一的铁橙', () => {
    expect(heatColor('chest', 10, 10)).toBe('rgba(232, 72, 63, 1)');
    expect(heatColor('back', 10, 10)).toBe('rgba(79, 142, 247, 1)');
  });

  it('低强度日返回同色低透明度，色相不变', () => {
    expect(heatColor('chest', 1, 100)).toMatch(/^rgba\(232, 72, 63, 0\.\d+\)$/);
  });

  it('EMPTY_HEAT 是未训练日的底色，与任何部位色都不同', () => {
    expect(EMPTY_HEAT).toBe('#1A1A1D');
  });
});

/**
 * 日历格和年度小格/海报格的差别只有一条：**日历格上要压一个白色日期数字**。
 * 满 alpha 的饱和红/紫上压白字，对比度不够；所以日历格的浓度必须有天花板。
 * 色相不能动——「一眼看出练了哪个部位」全靠色相。
 */
describe('calendarHeatColor', () => {
  it('浓度封顶，白色日期数字才压得住', () => {
    // 练爆的一天也不能满色，否则白字读不出来
    expect(calendarHeatColor('chest', 999, 10)).toBe(
      `rgba(232, 72, 63, ${CALENDAR_ALPHA_CEIL})`
    );
    expect(CALENDAR_ALPHA_CEIL).toBeLessThan(1);
  });

  it('色相与 heatColor 完全一致——日历/年度图/海报是同一个部位色', () => {
    expect(calendarHeatColor('back', 5, 10)).toMatch(/^rgba\(79, 142, 247, /);
    expect(calendarHeatColor('leg', 5, 10)).toMatch(/^rgba\(160, 107, 255, /);
  });

  it('封顶之后仍然单调递增——强度信息没被压平', () => {
    const ramp = [1, 3, 5, 8, 10].map((s) => Number(calendarHeatColor('chest', s, 10).match(/([\d.]+)\)$/)![1]));
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);
    }
  });

  it('练一组的日子仍明显区别于空白格', () => {
    const a = Number(calendarHeatColor('chest', 1, 20).match(/([\d.]+)\)$/)![1]);
    expect(a).toBeGreaterThanOrEqual(HEAT_FLOOR * CALENDAR_ALPHA_CEIL);
    expect(a).toBeGreaterThan(0.15);
  });
});
