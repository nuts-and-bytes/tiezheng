import { describe, expect, test } from 'vitest';
import {
  POSTER_MIN_H,
  POSTER_SCALE,
  POSTER_W,
  posterSize,
  buildMonthly,
  buildYearly,
  drawMonthlyPoster,
  drawYearlyPoster,
  formatVolume,
  posterFileName,
  posterTitle,
  type PosterInput,
} from './poster';
import { EMPTY_HEAT, heatColor } from './heat';
import type { ExMap, LoadItem } from './stats';
import type { Exercise } from './types';

/* ── 录像机 ctx ──────────────────────────────────────────────────────────
   jsdom 没有 2D canvas 实现（package.json 里没装 canvas / vitest-canvas-mock），
   getContext('2d') 返回 null。所以 poster.ts 必须是「只认 ctx 接口」的纯绘制，
   测试拿一个会录音的假 ctx 去断言调用序列。这也是唯一能证明
   「note 从未被 fillText 出去」的办法。 */

interface Call {
  fn: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  font: string;
}

interface Recorder {
  ctx: CanvasRenderingContext2D;
  calls: Call[];
  texts: string[];
  /** 所有 fillText 的 (文字, 当时的 font) —— 用来抓「中文用了 Anton」 */
  textFonts: { text: string; font: string; fillStyle: unknown }[];
  fills: { fn: string; fillStyle: unknown; args: unknown[] }[];
}

function recorder(): Recorder {
  const calls: Call[] = [];
  const stack: Record<string, unknown>[] = [];

  const state: Record<string, unknown> = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    lineJoin: 'miter',
    globalAlpha: 1,
    letterSpacing: '0px',
    shadowBlur: 0,
    shadowColor: 'transparent',
  };

  const rec =
    (fn: string) =>
    (...args: unknown[]) => {
      calls.push({
        fn,
        args,
        fillStyle: state.fillStyle,
        strokeStyle: state.strokeStyle,
        font: String(state.font),
      });
    };

  const gradient = {
    addColorStop: () => {},
  };

  const ctx = {
    save: () => {
      calls.push({ fn: 'save', args: [], fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, font: String(state.font) });
      stack.push({ ...state });
    },
    restore: () => {
      calls.push({ fn: 'restore', args: [], fillStyle: state.fillStyle, strokeStyle: state.strokeStyle, font: String(state.font) });
      Object.assign(state, stack.pop() ?? state);
    },
    scale: rec('scale'),
    translate: rec('translate'),
    rotate: rec('rotate'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arcTo: rec('arcTo'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    clearRect: rec('clearRect'),
    fillText: rec('fillText'),
    setLineDash: rec('setLineDash'),
    measureText: (t: string) => ({ width: t.length * 8 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  } as Record<string, unknown>;

  for (const key of Object.keys(state)) {
    Object.defineProperty(ctx, key, {
      get: () => state[key],
      set: (v: unknown) => {
        state[key] = v;
      },
    });
  }

  const texts = () => calls.filter((c) => c.fn === 'fillText').map((c) => String(c.args[0]));

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    get texts() {
      return texts();
    },
    get textFonts() {
      return calls
        .filter((c) => c.fn === 'fillText')
        .map((c) => ({ text: String(c.args[0]), font: c.font, fillStyle: c.fillStyle }));
    },
    get fills() {
      return calls
        .filter((c) => c.fn === 'fillRect' || c.fn === 'fill')
        .map((c) => ({ fn: c.fn, fillStyle: c.fillStyle, args: c.args }));
    },
  } as Recorder;
}

/* ── 夹具 ─────────────────────────────────────────────────────────────── */

function ex(id: string, name: string, bodyPart: Exercise['bodyPart']): Exercise {
  return { id, name, bodyPart, preset: true, updatedAt: 0, deletedAt: null };
}

const EX_MAP: ExMap = new Map([
  ['e-bench', ex('e-bench', '杠铃卧推', 'chest')],
  ['e-row', ex('e-row', '杠铃划船', 'back')],
  ['e-squat', ex('e-squat', '深蹲', 'leg')],
]);

function item(date: string, exerciseId: string, sets: number, weight = 60, reps = 8): LoadItem {
  return {
    date,
    exerciseId,
    sets: Array.from({ length: sets }, () => ({ weight, reps })),
  };
}

/** 2026-07：3 个训练日（1/2/3 连续），胸 4 组 + 背 2 组 + 腿 3 组 */
function julyInput(): PosterInput {
  const items: LoadItem[] = [
    item('2026-07-01', 'e-bench', 4, 60, 8), // 胸 4 组 = 1920kg
    item('2026-07-02', 'e-row', 2, 50, 10), // 背 2 组 = 1000kg
    item('2026-07-03', 'e-squat', 3, 100, 5), // 腿 3 组 = 1500kg
    item('2026-06-20', 'e-bench', 9, 60, 8), // 越界：不该进 7 月海报
  ];
  return {
    items,
    dates: ['2026-06-20', '2026-07-01', '2026-07-02', '2026-07-03'],
    exMap: EX_MAP,
  };
}

describe('尺寸', () => {
  test('宽 390 逻辑像素（设计卡），高度随内容长，但不低于卡上的 min-height 693', () => {
    expect(POSTER_W).toBe(390);
    expect(POSTER_MIN_H).toBe(693);
    expect(POSTER_SCALE).toBeGreaterThanOrEqual(2); // 至少 2x，否则分享出去糊

    const m = posterSize(buildMonthly('2026-07', julyInput()));
    expect(m.w).toBe(390);
    expect(m.h).toBeGreaterThanOrEqual(POSTER_MIN_H);

    const y = posterSize(buildYearly(2026, julyInput()));
    expect(y.w).toBe(390);
    expect(y.h).toBeGreaterThanOrEqual(POSTER_MIN_H);
  });

  test('六行的月份比五行的高 —— 网格不许被裁掉', () => {
    const five = buildMonthly('2026-07', julyInput()); // 7/1 周三 → 5 行

    // 把 7 月的训练原样搬到 8 月：内容等量，只有网格行数不同（8/1 周六 → 6 行）
    const items = julyInput()
      .items.filter((i) => i.date.startsWith('2026-07'))
      .map((i) => ({ ...i, date: i.date.replace('2026-07', '2026-08') }));
    const six = buildMonthly('2026-08', {
      items,
      dates: items.map((i) => i.date),
      exMap: EX_MAP,
    });

    expect(five.weeks).toHaveLength(5);
    expect(six.weeks).toHaveLength(6);
    expect(six.split).toHaveLength(five.split.length); // 等量内容，只差一行网格
    expect(posterSize(six).h).toBeGreaterThan(posterSize(five).h);
  });
});

describe('buildMonthly', () => {
  test('只统计当月，越界的训练日不计入', () => {
    const d = buildMonthly('2026-07', julyInput());
    expect(d.kind).toBe('monthly');
    expect(d.year).toBe(2026);
    expect(d.month).toBe(7);
    expect(d.days).toBe(3); // 6-20 不算
    expect(d.sets).toBe(9); // 4 + 2 + 3
    expect(d.volumeKg).toBe(1920 + 1000 + 1500);
    expect(d.streak).toBe(3); // 7/1-7/3
  });

  test('部位分布按组数降序，没练过的部位不出现', () => {
    const d = buildMonthly('2026-07', julyInput());
    expect(d.split.map((r) => [r.part, r.sets])).toEqual([
      ['chest', 4],
      ['leg', 3],
      ['back', 2],
    ]);
    expect(d.split.every((r) => r.name.length > 0)).toBe(true);
  });

  test('热力网格按周对齐：每行 7 格，非本月的格子是 null', () => {
    const d = buildMonthly('2026-07', julyInput());
    expect(d.weeks.every((w) => w.length === 7)).toBe(true);

    const flat = d.weeks.flat();
    const cells = flat.filter((c) => c !== null);
    expect(cells).toHaveLength(31); // 7 月 31 天全在网格里
    expect(cells.every((c) => c!.date.startsWith('2026-07'))).toBe(true);

    // 2026-07-01 是周三 → 该行前两格（周一、周二）是 null
    expect(d.weeks[0]!.slice(0, 2)).toEqual([null, null]);
    expect(d.weeks[0]![2]).toMatchObject({ date: '2026-07-01', part: 'chest', sets: 4 });

    // 没练的日子留格但无部位
    const d7 = flat.find((c) => c?.date === '2026-07-07');
    expect(d7).toMatchObject({ part: null, sets: 0 });
  });

  test('maxSets 用 90 分位而不是 max —— 一天练爆不许冲淡全月', () => {
    const input = julyInput();
    input.items.push(item('2026-07-10', 'e-bench', 40)); // 极端值
    const d = buildMonthly('2026-07', input);
    expect(d.maxSets).toBeGreaterThan(0);
    expect(d.maxSets).toBeLessThan(40);
  });

  test('空月份不炸：全 0，网格全是空格', () => {
    const d = buildMonthly('2026-02', { items: [], dates: [], exMap: EX_MAP });
    expect(d.days).toBe(0);
    expect(d.sets).toBe(0);
    expect(d.volumeKg).toBe(0);
    expect(d.streak).toBe(0);
    expect(d.split).toEqual([]);
    expect(d.maxSets).toBe(0);
    expect(d.weeks.flat().filter((c) => c !== null)).toHaveLength(28); // 2026 年 2 月 28 天
  });
});

describe('buildYearly', () => {
  test('hero 数字是打卡天数（不是总组数、不是总容量）', () => {
    const d = buildYearly(2026, julyInput());
    expect(d.kind).toBe('yearly');
    expect(d.days).toBe(4); // 6-20 + 7/1 + 7/2 + 7/3
    expect(d.sets).toBe(9 + 9);
    expect(d.streak).toBe(3);
  });

  test('全年热力图是 53×7 的列网格，跨年的格子是 null', () => {
    const d = buildYearly(2026, julyInput());
    expect(d.columns.length).toBeGreaterThanOrEqual(52);
    expect(d.columns.length).toBeLessThanOrEqual(54);
    expect(d.columns.every((col) => col.length === 7)).toBe(true);

    const cells = d.columns.flat().filter((c) => c !== null);
    expect(cells).toHaveLength(365); // 2026 不是闰年
    expect(cells.every((c) => c!.date.startsWith('2026-'))).toBe(true);

    const jul1 = cells.find((c) => c!.date === '2026-07-01');
    expect(jul1).toMatchObject({ part: 'chest', sets: 4 });
  });

  test('PR 亮点取 e1RM 最高的几条', () => {
    const d = buildYearly(2026, julyInput());
    expect(d.prs.length).toBeGreaterThan(0);
    expect(d.prs.length).toBeLessThanOrEqual(3);
    expect(d.prs[0]!.name).toBe('深蹲'); // 100×5 的 e1RM 最高
    expect(d.prs[0]!.weight).toBe(100);
    expect(d.prs[0]!.reps).toBe(5);
    // 降序
    const e = d.prs.map((p) => p.e1rm);
    expect([...e].sort((a, b) => b - a)).toEqual(e);
  });

  test('空年份不炸', () => {
    const d = buildYearly(2025, { items: [], dates: [], exMap: EX_MAP });
    expect(d.days).toBe(0);
    expect(d.prs).toEqual([]);
    expect(d.columns.flat().filter((c) => c !== null)).toHaveLength(365);
  });
});

describe('formatVolume / 文件名 / 标题', () => {
  test('吨与公斤', () => {
    expect(formatVolume(12400)).toEqual({ value: '12.4', unit: 't' });
    expect(formatVolume(860)).toEqual({ value: '860', unit: 'kg' });
    expect(formatVolume(0)).toEqual({ value: '—', unit: '' }); // 纯自重训练：没容量就别硬编 0
  });

  test('文件名与分享标题', () => {
    const m = buildMonthly('2026-07', julyInput());
    const y = buildYearly(2026, julyInput());
    expect(posterFileName(m)).toBe('ironproof-2026-07.png');
    expect(posterFileName(y)).toBe('ironproof-2026.png');
    expect(posterTitle(m)).toContain('2026');
    expect(posterTitle(m)).toContain('铁证');
    expect(posterTitle(y)).toContain('铁证');
  });
});

describe('drawMonthlyPoster', () => {
  test('画出设计卡上的每一块：品牌条 / 月份 / hero / 三指标 / 分布 / 签名 / 钢印', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', julyInput()));

    const t = r.texts;
    expect(t).toContain('铁证 IRONPROOF');
    expect(t).toContain('MONTHLY PROOF');
    expect(t).toContain('07');
    expect(t).toContain('2026 JULY');
    expect(t).toContain('3'); // hero：打卡天数
    expect(t).toContain('天 · 盖下钢印');
    expect(t).toContain('总组数 SETS');
    expect(t).toContain('总容量 VOLUME');
    expect(t).toContain('最长连续 STREAK');
    expect(t).toContain('部位分布 SPLIT');
    expect(t).toContain('胸');
    expect(t).toContain('你练过的，都有铁证。');
    expect(t).toContain('TIEZHENG.PAGES.DEV · 本地生成 · 照片不上传');
    expect(t).toContain('铁'); // 钢印
  });

  test('先缩放再画，画完还原 —— 调用方拿到的 ctx 状态不被污染', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', julyInput()));
    expect(r.calls[0]!.fn).toBe('save');
    expect(r.calls.at(-1)!.fn).toBe('restore');
    const scale = r.calls.find((c) => c.fn === 'scale');
    expect(scale!.args).toEqual([POSTER_SCALE, POSTER_SCALE]);
  });

  test('热力格的颜色必须来自 heat.ts —— 和日历页、数据页一模一样', () => {
    const d = buildMonthly('2026-07', julyInput());
    const r = recorder();
    drawMonthlyPoster(r.ctx, d);

    const styles = r.fills.map((f) => String(f.fillStyle));
    expect(styles).toContain(heatColor('chest', 4, d.maxSets));
    expect(styles).toContain(heatColor('back', 2, d.maxSets));
    expect(styles).toContain(heatColor('leg', 3, d.maxSets));

    // 7 月 31 天，练了 3 天 → 28 个空格，一个不多一个不少
    // （EMPTY_HEAT 在海报里只有这一处用途，所以这个数字是可数的）
    expect(styles.filter((s) => s === EMPTY_HEAT)).toHaveLength(28);
  });

  test('Anton 只有数字和拉丁字形 —— 中文绝不许用 Anton 画（否则是豆腐块）', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', julyInput()));

    const cjk = /[一-鿿]/;
    const offenders = r.textFonts.filter((c) => cjk.test(c.text) && /Anton/i.test(c.font));
    expect(offenders).toEqual([]);

    // 反过来：大数字必须用 Anton（display 字体是品牌的一半）
    const hero = r.textFonts.find((c) => c.text === '3' && /Anton/i.test(c.font));
    expect(hero).toBeDefined();
  });

  test('连续天数用琥珀色 —— 唯一被高亮的指标', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', julyInput()));
    const streak = r.textFonts.filter((c) => c.text === '3' && /Anton/i.test(c.font));
    expect(streak.some((c) => String(c.fillStyle).toUpperCase().includes('FFB340'))).toBe(true);
  });
});

describe('drawYearlyPoster', () => {
  test('hero 是打卡天数，不是组数也不是容量', () => {
    const d = buildYearly(2026, julyInput());
    const r = recorder();
    drawYearlyPoster(r.ctx, d);

    const t = r.texts;
    expect(t).toContain('铁证 IRONPROOF');
    expect(t).toContain('YEARLY PROOF');
    expect(t).toContain('2026');
    expect(t).toContain('天 · 盖下钢印');

    // 120px 的那个数字（hero）必须等于打卡天数
    const hero = r.textFonts.find((c) => /12\dpx/.test(c.font) && /Anton/i.test(c.font));
    expect(hero).toBeDefined();
    expect(hero!.text).toBe(String(d.days));
    expect(hero!.text).not.toBe(String(d.sets));
  });

  test('全年 53×7 格全画出来，颜色同样来自 heat.ts', () => {
    const d = buildYearly(2026, julyInput());
    const r = recorder();
    drawYearlyPoster(r.ctx, d);

    const styles = r.fills.map((f) => String(f.fillStyle));
    expect(styles).toContain(heatColor('chest', 4, d.maxSets));

    // 2026 年 365 天，练了 4 天 → 361 个空格
    expect(styles.filter((s) => s === EMPTY_HEAT)).toHaveLength(361);
  });

  test('PR 亮点上榜', () => {
    const r = recorder();
    drawYearlyPoster(r.ctx, buildYearly(2026, julyInput()));
    const t = r.texts;
    expect(t).toContain('深蹲');
    expect(t.some((s) => s.includes('100') && s.includes('5'))).toBe(true);
  });

  test('中文不许用 Anton', () => {
    const r = recorder();
    drawYearlyPoster(r.ctx, buildYearly(2026, julyInput()));
    const cjk = /[一-鿿]/;
    expect(r.textFonts.filter((c) => cjk.test(c.text) && /Anton/i.test(c.font))).toEqual([]);
  });
});

/* ── 产品铁律 7：note 是用户的私人文字 ──────────────────────────────────── */
describe('隐私：workout.note 绝不出现在海报的任何位置', () => {
  const NOTE = '今天状态很差，和老板吵架了，别人别看';

  /** 就算上游哪天手滑把 note 混进 item 里（结构上 LoadItem 根本没这个字段），
      海报也必须一个字都不画出去。 */
  function taintedInput(): PosterInput {
    const items = julyInput().items.map((i) => ({ ...i, note: NOTE }) as unknown as LoadItem);
    return { items, dates: julyInput().dates, exMap: EX_MAP };
  }

  test('build 出来的数据结构里没有 note', () => {
    const m = buildMonthly('2026-07', taintedInput());
    const y = buildYearly(2026, taintedInput());
    expect(JSON.stringify(m)).not.toContain('今天状态');
    expect(JSON.stringify(m)).not.toContain('note');
    expect(JSON.stringify(y)).not.toContain('今天状态');
    expect(JSON.stringify(y)).not.toContain('note');
  });

  test('月度海报的任何一次 fillText 都不含 note 的任何片段', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', taintedInput()));
    for (const s of r.texts) {
      expect(s).not.toContain('老板');
      expect(s).not.toContain('状态');
      // 反向：画出去的任何一段文字，都不能是 note 的子串
      if (s.length >= 2) expect(NOTE).not.toContain(s.slice(0, 4));
    }
  });

  test('年度海报同样一个字都不漏', () => {
    const r = recorder();
    drawYearlyPoster(r.ctx, buildYearly(2026, taintedInput()));
    for (const s of r.texts) {
      expect(s).not.toContain('老板');
      expect(s).not.toContain('状态');
    }
  });
});
