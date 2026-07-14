import { describe, expect, it } from 'vitest';
import { BODY_PARTS } from '../data/bodyParts';
import { AA_TEXT, compositeOver, contrastRatio, parseColor } from './contrast';
import { THEME } from './theme';
import type { BodyPart } from './types';
import {
  CALENDAR_ALPHA_CEIL,
  CELL_PARTS_MAX,
  EMPTY_HEAT,
  HEAT_FLOOR,
  calendarHeatColor,
  cellParts,
  heatAlpha,
  heatBackground,
  heatColor,
  OVERFLOW_HEAT_FADE,
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
    expect(EMPTY_HEAT).toBe('#1a1a1d'); // = --color-card
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

/**
 * 一格一色是一次**有损压缩**：练了胸 18 组 + 背 18 组的那天，格子只涂胸色，
 * 而同一屏的「部位分布」正写着胸 18 / 背 18。两个模块在同一页上互相拆台。
 * 更糟的是：练一个部位的日子和练两个部位的日子长得**一模一样**——
 * 日历页最该一眼答出的那个问题（「这天练的什么」），它答不出。
 *
 * cellParts 是「一格涂哪几块」这条规则的唯一出处。它不做排序（dailyPartBreakdown
 * 已经排好，并列也已定好决胜规则），只负责「至多两块」这一刀。
 */
describe('cellParts：一格至多两块，主练在前', () => {
  it('单部位日：就一块', () => {
    expect(cellParts(['chest'])).toEqual(['chest']);
  });

  it('双部位日：两块都上，顺序照抄输入（主练在前）', () => {
    expect(cellParts(['back', 'chest'])).toEqual(['back', 'chest']);
  });

  it('三个及以上：截到两块。第三条色带在 4px 的年度格上不足 1px，画了只是噪声', () => {
    expect(cellParts(['leg', 'core', 'arm', 'cardio'])).toEqual(['leg', 'core']);
    expect(CELL_PARTS_MAX).toBe(2);
  });

  it('空日子：一块都没有（未训练日不该被当成有色格）', () => {
    expect(cellParts([])).toEqual([]);
  });
});

/**
 * 对角分割而不是左右/上下对半：45° 的分割线在 4px 的小格上仍然可辨（对角是最长的那条边），
 * 而横竖分割在小格上会跟网格的行列线混成一片。
 */
describe('heatBackground：把 1~2 个色变成一块 CSS 背景', () => {
  it('没有色 → 空白格底色', () => {
    expect(heatBackground([])).toBe(EMPTY_HEAT);
  });

  it('一个色 → 就是那个色，不套渐变（单部位日不该多一层 CSS）', () => {
    expect(heatBackground(['rgba(232, 72, 63, 1)'])).toBe('rgba(232, 72, 63, 1)');
  });

  it('两个色 → 沿对角线劈开的硬边，不是柔和过渡', () => {
    const bg = heatBackground(['rgba(232, 72, 63, 1)', 'rgba(79, 142, 247, 1)']);
    expect(bg).toBe(
      'linear-gradient(135deg, rgba(232, 72, 63, 1) 0 50%, rgba(79, 142, 247, 1) 50% 100%)',
    );
    // 硬边：两个色标都落在 50%，中间没有插值区。否则两个部位色会在中缝糊出第三个颜色
    expect(bg).toContain('0 50%');
    expect(bg).toContain('50% 100%');
  });

  it('主练色在左上（渐变的起点），跟 canvas 侧画的三角同向', () => {
    const bg = heatBackground(['MAIN', 'SECOND']);
    expect(bg.indexOf('MAIN')).toBeLessThan(bg.indexOf('SECOND'));
    expect(bg).toContain('135deg');
  });
});

/**
 * 常驻守门：日历格上的日期数字必须读得出。
 *
 * 这条测试的存在是因为「浓度上限」曾经是个拍脑袋的常数（0.6），配的注释还写反了——
 * 说「饱和红/紫会把白字吃掉」，实测红/紫是 7.0:1 绰绰有余，真正跌破 AA 的是最亮的
 * 黄和青（3.87 / 3.95）。肉眼在暗底 + 半透明色上是个合格的异常探测器、不合格的因果分析器。
 *
 * 所以断言的是**渲染出来的那个颜色**对 ink 的实测比值，而不是 alpha 的账面值——
 * 后者是可读性的代理指标，代理指标正是上一版栽跟头的地方。
 * 有了它，将来任何人改部位色、加部位，都会被当场兜住。
 */
describe('日历格的白字必须读得出（WCAG AA 4.5:1）', () => {
  const BG = parseColor(THEME.bg).rgb;
  const INK = parseColor(THEME.ink).rgb;

  /** 渲染成什么色，就量什么色——包括最浓的那一格（sets = maxSets） */
  function ratioAt(part: BodyPart, fade: number): number {
    const { rgb, alpha } = parseColor(calendarHeatColor(part, 20, 20, fade));
    return contrastRatio(compositeOver(rgb, BG, alpha), INK);
  }

  it.each(BODY_PARTS.map((p) => [p.name, p.id] as const))(
    '%s：最深的那一格上，日期数字仍有 4.5:1',
    (_name, id) => {
      expect(ratioAt(id, 1)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each(BODY_PARTS.map((p) => [p.name, p.id] as const))(
    '%s：溢出月的格子淡了底色，字反而更清楚',
    (_name, id) => {
      expect(ratioAt(id, OVERFLOW_HEAT_FADE)).toBeGreaterThanOrEqual(ratioAt(id, 1));
    },
  );

  it('弱化溢出格靠的是底色浓度，不是整格 opacity —— 后者会把字一起稀释掉', () => {
    const full = parseColor(calendarHeatColor('chest', 20, 20, 1)).alpha;
    const faded = parseColor(calendarHeatColor('chest', 20, 20, OVERFLOW_HEAT_FADE)).alpha;
    expect(faded).toBeLessThan(full * 0.8); // 看得出不是本月
    expect(faded).toBeGreaterThan(0); // 但色块还在，练没练仍一眼可辨
  });
});
