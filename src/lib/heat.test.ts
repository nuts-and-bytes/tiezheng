import { describe, expect, it } from 'vitest';
import { EMPTY_HEAT, HEAT_FLOOR, heatAlpha, heatColor } from './heat';

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
