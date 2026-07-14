import { describe, expect, test } from 'vitest';
import {
  FRAME_H,
  FRAME_W,
  POSTER_SCALE,
  POSTER_W,
  contentH,
  footerLayout,
  posterSize,
  titleLayout,
  buildMonthly,
  buildYearly,
  drawMonthlyPoster,
  drawPoster,
  drawYearlyPoster,
  formatVolume,
  loadMetric,
  monthTicks,
  posterFileName,
  posterTitle,
  type MonthlyPosterData,
  type PosterInput,
  type YearlyPosterData,
  prRowLayout,
  type PosterPr,
} from './poster';
import { BODY_PARTS } from '../data/bodyParts';
import { EMPTY_HEAT, heatColor } from './heat';
import type { ExMap, LoadItem } from './stats';
import type { Exercise } from './types';

/* ── 确定性字宽模型 ──────────────────────────────────────────────────────
   jsdom 的 measureText 不存在，真字体又不该被测试依赖。这里给一个**注入**的假
   measure：Anton 0.51em、拉丁 0.55em、全角 1em——量级贴着真字体，足够钉死
   「不溢出 / 不重叠」这类几何不变量。海报的排版函数全部收 measure 参数，
   就是为了能在这里被量出来（而不是 mock CanvasRenderingContext2D）。 */

const FULLWIDTH = /[⺀-鿿　-〿＀-￯]/u;

function fakeMeasure(s: string, font: string): number {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const anton = /Anton/i.test(font);
  let w = 0;
  for (const ch of s) w += size * (anton ? 0.51 : FULLWIDTH.test(ch) ? 1 : 0.55);
  return w;
}

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
    clip: rec('clip'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    clearRect: rec('clearRect'),
    fillText: rec('fillText'),
    setLineDash: rec('setLineDash'),
    measureText: (t: string) => ({ width: fakeMeasure(t, String(state.font)) }),
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

/** 内容等量、只多一行网格的 8 月（8/1 是周六 → 6 行） */
function augustSix(): MonthlyPosterData {
  const items = julyInput()
    .items.filter((i) => i.date.startsWith('2026-07'))
    .map((i) => ({ ...i, date: i.date.replace('2026-07', '2026-08') }));
  return buildMonthly('2026-08', { items, dates: items.map((i) => i.date), exMap: EX_MAP });
}

const splitOf = (rows: number) =>
  BODY_PARTS.slice(0, rows).map((p) => ({ part: p.id, name: p.name, sets: 10 }));

/** 手搓最坏情况：build 出来的真数据碰不到「6 行网格 + 5 条分布」这种组合 */
function monthlyOf(weeks: number, rows: number): MonthlyPosterData {
  return {
    kind: 'monthly',
    year: 2026,
    month: 8,
    days: 26,
    sets: 188,
    reps: 1504,
    volumeKg: 96000,
    moves: 12,
    streak: 14,
    split: splitOf(rows),
    weeks: Array.from({ length: weeks }, () => Array.from({ length: 7 }, () => null)),
  };
}

function yearlyOf(rows: number, prs: number): YearlyPosterData {
  return {
    kind: 'yearly',
    year: 2026,
    days: 260,
    sets: 1880,
    reps: 15040,
    volumeKg: 960000,
    moves: 24,
    streak: 42,
    split: splitOf(rows),
    columns: Array.from({ length: 53 }, () => Array.from({ length: 7 }, () => null)),
    prs: Array.from({ length: prs }, (_, i) => ({
      name: `动作${i}`,
      weight: 100,
      reps: 5,
      e1rm: 116,
    })),
  };
}

/* ── B4：海报是标准件，尺寸不许随内容浮动 ────────────────────────────── */
describe('尺寸：固定 9:16 相框', () => {
  test('相框恒为 540×960（精确 9:16），导出恒为 1080×1920', () => {
    expect(POSTER_W).toBe(390); // 内容坐标系（设计卡宽度）保持不变
    expect(FRAME_W).toBe(540);
    expect(FRAME_H).toBe(960);
    expect(FRAME_W / FRAME_H).toBeCloseTo(9 / 16, 10);
    expect(POSTER_SCALE).toBe(2);
    expect(FRAME_W * POSTER_SCALE).toBe(1080);
    expect(FRAME_H * POSTER_SCALE).toBe(1920);
  });

  test('稀疏月 / 六行月 / 年度 / 空月 —— 四种输入，同一个尺寸', () => {
    const five = buildMonthly('2026-07', julyInput()); // 7/1 周三 → 5 行
    const six = augustSix();
    const yearly = buildYearly(2026, julyInput());
    const empty = buildMonthly('2026-02', { items: [], dates: [], exMap: EX_MAP });

    expect(five.weeks).toHaveLength(5);
    expect(six.weeks).toHaveLength(6); // 内容确实不一样，尺寸却必须一样
    for (const d of [five, six, yearly, empty]) {
      expect(posterSize(d)).toEqual({ w: FRAME_W, h: FRAME_H });
    }
  });

  test('最坏情况的内容高度也塞得进相框 —— 谁再往海报上加一行，都会在这里红', () => {
    for (let weeks = 4; weeks <= 6; weeks++) {
      for (let rows = 0; rows <= 5; rows++) {
        expect(contentH(monthlyOf(weeks, rows))).toBeLessThanOrEqual(FRAME_H);
      }
    }
    for (let rows = 0; rows <= 5; rows++) {
      for (let prs = 0; prs <= 3; prs++) {
        expect(contentH(yearlyOf(rows, prs))).toBeLessThanOrEqual(FRAME_H);
      }
    }
  });
});

/* ── B3：标题小标不许溢出画布 ────────────────────────────────────────── */
describe('titleLayout', () => {
  const X1 = 354; // POSTER_W - PAD_X

  test('月度：设计值原样保留（13px / 4px 字距），小标跟在大字后面', () => {
    const l = titleLayout(fakeMeasure, '07', '2026 JULY');
    expect(l.wrapped).toBe(false);
    expect(l.size).toBe(13);
    expect(l.track).toBe(4);
    expect(l.text).toBe('2026 JULY');
    expect(l.right).toBeLessThanOrEqual(X1);
  });

  test('年度：2026 + THE YEAR IN IRON 会挤出画布 → 降级，而不是溢出，也不是截断', () => {
    const l = titleLayout(fakeMeasure, '2026', 'THE YEAR IN IRON');
    expect(l.right).toBeLessThanOrEqual(X1);
    expect(l.text).toBe('THE YEAR IN IRON'); // 一个字母都不许掉
    expect(l.size).toBeLessThanOrEqual(13);
    expect(l.size).toBeGreaterThanOrEqual(10); // 降级有下限，不许缩成蚂蚁
  });

  test('任意 big/sub 组合都不溢出 —— 布局契约不该指望调用方的字符串恰好够短', () => {
    const bigs = ['1', '07', '12', '2026', '88888'];
    const subs = [
      '',
      'X',
      '2026 JULY',
      'THE YEAR IN IRON',
      'THE YEAR IN IRON AND FIRE AND MORE IRON',
      'A'.repeat(120),
    ];
    for (const big of bigs) {
      for (const sub of subs) {
        const l = titleLayout(fakeMeasure, big, sub);
        expect(l.right).toBeLessThanOrEqual(X1 + 1e-6);
        expect(l.x).toBeGreaterThanOrEqual(36);
        // 换行也不许把标题块撑高：相框高度是钉死的，任何一块变高都会挤爆底部
        expect(l.height).toBe(109);
      }
    }
  });

  test('实在放不下才换行到大字下面', () => {
    const l = titleLayout(fakeMeasure, '2026', 'THE YEAR IN IRON AND FIRE AND MORE IRON');
    expect(l.wrapped).toBe(true);
    expect(l.x).toBe(36); // 回到左边距，不再跟在大字后面
    expect(l.right).toBeLessThanOrEqual(X1);
  });
});

/* ── B2：footer 两行不许叠在一起 ─────────────────────────────────────── */
describe('footerLayout', () => {
  test('标语在上、小字在下，两行的包围盒不相交', () => {
    for (const h of [693, 800, 951, FRAME_H]) {
      const f = footerLayout(fakeMeasure, h);
      expect(f.tagline.bottom).toBeLessThanOrEqual(f.meta.top);
      expect(f.meta.top - f.tagline.bottom).toBeGreaterThanOrEqual(6); // 中间得有呼吸
      expect(f.meta.bottom).toBeLessThanOrEqual(h - 30); // 不许越过 PAD_B
      expect(f.tagline.top).toBeGreaterThanOrEqual(h - 30 - 74); // 不许爬出 footer 区
    }
  });

  test('文字给钢印让位：两行的右边缘都在钢印左边缘之外', () => {
    const f = footerLayout(fakeMeasure, 951);
    expect(f.stamp.left).toBe(354 - 74);
    expect(f.tagline.right).toBeLessThanOrEqual(f.stamp.left);
    expect(f.meta.right).toBeLessThanOrEqual(f.stamp.left);
  });

  test('隐私承诺那句必须整句画出来 —— 让位靠降级，不靠截断', () => {
    const f = footerLayout(fakeMeasure, 951);
    expect(f.tagline.text).toBe('你练过的，都有铁证。');
    expect(f.meta.text).toBe('TIEZHENG.PAGES.DEV · 本地生成 · 照片不上传');
  });
});

/* ── B3：PR 行的动作名不许压到成绩上 ─────────────────────────────────── */
describe('prRowLayout', () => {
  const X0 = 36; // PAD_X
  const X1 = 354; // POSTER_W - PAD_X

  /**
   * 海报的 PR 行是「动作名 …… 成绩」两端对齐。动作名来自用户自建的动作库——
   * 它的长度是**用户输入**，不是设计师能预设的常量。而 prBlock 一直是直接
   * fillText(p.name, X0) + fillText(成绩, X1, align:right)：谁都没量过宽。
   * 「史密斯机上斜哑铃飞鸟（改良版）」这种名字画出去，就直接叠在 120kg × 5 上面。
   *
   * 成绩是这一行的载荷（PR 是几公斤几次），它一个字都不能少；名字是标识，
   * 长了可以截。所以让位方向是单向的：截名字，永不截成绩。
   *
   * 「多长才咬到」：11px 下一个汉字约 11px，`120kg × 5` 约 54px，X0..X1 是 318px，
   * 留出 8px 空隙后名字只剩 ~256px —— **23 个汉字**。而 addExercise 只 trim() 不设上限
   * （src/repos/exerciseRepo.ts:48），所以这不是一个够不着的边界，是个没人拦的输入。
   */
  const LONG: PosterPr = {
    name: '史密斯机上斜哑铃飞鸟（改良版）教练特训专用超长动作名称',
    weight: 120,
    reps: 5,
    e1rm: 140,
  };
  const SHORT: PosterPr = { name: '卧推', weight: 120, reps: 5, e1rm: 140 };

  test('短名字原样画出，成绩右对齐贴着右边距', () => {
    const l = prRowLayout(fakeMeasure, SHORT);
    expect(l.name.text).toBe('卧推');
    expect(l.name.x).toBe(X0);
    expect(l.score.text).toBe('120kg × 5');
    expect(l.score.right).toBe(X1);
  });

  test('长名字被截断，而不是压到成绩上 —— 两个包围盒不相交', () => {
    const l = prRowLayout(fakeMeasure, LONG);
    expect(l.name.right).toBeLessThanOrEqual(l.score.left);
    expect(l.score.left - l.name.right).toBeGreaterThanOrEqual(8); // 中间得有呼吸
    expect(l.name.text).not.toBe(LONG.name);
    expect(l.name.text.endsWith('…')).toBe(true);
  });

  test('成绩永不被截：它是这行的载荷，名字才是可牺牲的那个', () => {
    const l = prRowLayout(fakeMeasure, LONG);
    expect(l.score.text).toBe('120kg × 5');
    expect(l.name.x).toBeGreaterThanOrEqual(X0);
    expect(l.score.right).toBeLessThanOrEqual(X1);
  });

  test('正常长度的名字不许被误伤：截断只在真放不下时发生', () => {
    const l = prRowLayout(fakeMeasure, { ...LONG, name: '史密斯机上斜卧推' });
    expect(l.name.text).toBe('史密斯机上斜卧推');
  });

  /** 名字长度是用户输入 —— 契约不该指望它恰好够短（titleLayout 判例） */
  test('任意长度的名字都不越界、不重叠', () => {
    for (const n of [1, 2, 5, 12, 30, 80]) {
      const l = prRowLayout(fakeMeasure, { ...LONG, name: '深'.repeat(n) });
      expect(l.name.x).toBeGreaterThanOrEqual(X0);
      expect(l.name.right).toBeLessThanOrEqual(l.score.left);
      expect(l.score.right).toBeLessThanOrEqual(X1);
    }
  });

  test('canvas：画出去的名字就是布局算出来的那个（截断版），不是原文', () => {
    const d = buildYearly(2026, {
      items: [item('2026-03-02', 'e-long', 3, 120, 5)],
      dates: ['2026-03-02'],
      exMap: new Map([['e-long', ex('e-long', LONG.name, 'chest')]]),
    });
    const r = recorder();
    drawYearlyPoster(r.ctx, d);
    const drawn = r.calls.filter((c) => c.fn === 'fillText').map((c) => String(c.args[0]));

    expect(drawn).not.toContain(LONG.name);
    expect(drawn).toContain(prRowLayout(fakeMeasure, { ...LONG, e1rm: 0 }).name.text);
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
    expect(d.weeks[0]![2]).toMatchObject({ date: '2026-07-01', parts: ['chest'], sets: 4 });

    // 没练的日子留格但无部位
    const d7 = flat.find((c) => c?.date === '2026-07-07');
    expect(d7).toMatchObject({ parts: [], sets: 0 });
  });


  test('空月份不炸：全 0，网格全是空格', () => {
    const d = buildMonthly('2026-02', { items: [], dates: [], exMap: EX_MAP });
    expect(d.days).toBe(0);
    expect(d.sets).toBe(0);
    expect(d.volumeKg).toBe(0);
    expect(d.streak).toBe(0);
    expect(d.split).toEqual([]);
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
    expect(jul1).toMatchObject({ parts: ['chest'], sets: 4 });
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
    expect(styles).toContain(heatColor('chest'));
    expect(styles).toContain(heatColor('back'));
    expect(styles).toContain(heatColor('leg'));

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
    expect(styles).toContain(heatColor('chest'));

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

/* ── B4 的绘制侧：内容在相框里居中，衬边是背景的一部分 ────────────────── */
describe('相框与衬边', () => {
  test('背景铺满整个 540×960，不是只铺内容那一块（否则衬边是块透明空白）', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', julyInput()));
    expect(r.calls.find((c) => c.fn === 'fillRect')!.args).toEqual([0, 0, FRAME_W, FRAME_H]);
    expect(r.calls.find((c) => c.fn === 'strokeRect')!.args).toEqual([
      0.5,
      0.5,
      FRAME_W - 1,
      FRAME_H - 1,
    ]);
  });

  test('内容整块居中：水平 75，垂直按自然高度居中', () => {
    for (const d of [buildMonthly('2026-07', julyInput()), buildYearly(2026, julyInput())]) {
      const r = recorder();
      drawPoster(r.ctx, d);
      const t = r.calls.find((c) => c.fn === 'translate')!; // 第一个 translate 就是内容整块的位移
      expect(t.args[0]).toBe((FRAME_W - POSTER_W) / 2);
      expect(t.args[1]).toBe(Math.round((FRAME_H - contentH(d)) / 2));
      expect(t.args[1] as number).toBeGreaterThanOrEqual(0); // 内容不许被相框裁掉
    }
  });

  test('footer 落在内容底部，不是相框底部（h 传错就会掉到衬边上）', () => {
    const d = buildMonthly('2026-07', julyInput());
    const r = recorder();
    drawMonthlyPoster(r.ctx, d);

    const tagline = r.calls.find((c) => c.fn === 'fillText' && c.args[0] === '你练过的，都有铁证。')!;
    const expected = footerLayout(fakeMeasure, contentH(d)).tagline;
    expect(tagline.args[2]).toBe(expected.y);
    expect(contentH(d)).toBeLessThan(FRAME_H); // 前提：这个月的内容确实比相框矮
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

/* ── 自重训练者的负荷维度 ────────────────────────────────────────────────
   容量 = 重量 × 次数，练俯卧撑和引体向上的人恒为 0。海报此前在那一格画一个「—」。
   而项目自己早就否掉了这个做法——ProfileScreen.tsx:102 原话：
   「也不降级成「—」：那还是『本该有东西但没有』。自重训练者的负荷维度本来就是次数。」
   数据页（weighted ? Volume : 总次数）、资料页（hasWeightData ? Volume : 总次数）都已落地。
   海报是最后一处，也是唯一要分享出去的那一处。

   根因不在 formatVolume 选了破折号，而在 baseOf() 把 totals() 平级返回的 reps 扔了——
   metrics() 手里没有第二个维度可换，只能在「0」和「—」之间挑个危害小的。 */
describe('自重训练者：海报不许拿一个「—」占着负荷那一格', () => {
  const BW_MAP: ExMap = new Map([
    ['e-pushup', ex('e-pushup', '俯卧撑', 'chest')],
    ['e-pullup', ex('e-pullup', '引体向上', 'back')],
  ]);

  /** 整月纯自重：weight 全 0 → volumeKg 恒为 0；但 4×20 + 3×10 = 110 次是他真做到的 */
  function bodyweightInput(): PosterInput {
    const items: LoadItem[] = [
      item('2026-07-01', 'e-pushup', 4, 0, 20), // 80 次
      item('2026-07-02', 'e-pullup', 3, 0, 10), // 30 次
    ];
    return { items, dates: items.map((i) => i.date), exMap: BW_MAP };
  }

  test('有容量 → 还是 VOLUME（别把负重的人也改了）', () => {
    expect(loadMetric({ volumeKg: 12400, reps: 300, moves: 8 })).toEqual({
      value: '12.4',
      unit: 't',
      label: '总容量 VOLUME',
    });
  });

  test('没容量 → 换成他真正挣到的那个维度，而不是一个破折号', () => {
    expect(loadMetric({ volumeKg: 0, reps: 110, moves: 4 })).toEqual({
      value: '110',
      unit: '',
      label: '总次数 REPS',
    });
  });

  /**
   * 梯子的第三级。只记组数、连次数都不记的人（sanitizeSets 明确允许），volumeKg 和 reps
   * 双 0 —— 他练了一整个月，海报上却印着「总次数 0」，然后把这张图发出去。
   * 海报是这个 app 唯一会离开手机的东西，这一格不能撒谎。
   */
  test('容量和次数双 0（只记组数的人）→ 动作数，不是「总次数 0」', () => {
    expect(loadMetric({ volumeKg: 0, reps: 0, moves: 6 })).toEqual({
      value: '6',
      unit: '',
      label: '动作数 MOVES',
    });
  });

  test('月度海报：整月自重，画出去的字里一个「—」都没有', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', bodyweightInput()));
    for (const s of r.texts) expect(s).not.toContain('—');
  });

  test('月度海报：那一格画的是 110 次 / 总次数 REPS', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', bodyweightInput()));
    expect(r.texts).toContain('110');
    expect(r.texts).toContain('总次数 REPS');
    expect(r.texts).not.toContain('总容量 VOLUME');
  });

  test('年度海报：同一条口径，一个「—」都没有', () => {
    const r = recorder();
    drawYearlyPoster(r.ctx, buildYearly(2026, bodyweightInput()));
    for (const s of r.texts) expect(s).not.toContain('—');
    expect(r.texts).toContain('110');
    expect(r.texts).toContain('总次数 REPS');
  });

  test('负重月仍然画 VOLUME —— 这条不许被上面几条改坏', () => {
    const r = recorder();
    drawMonthlyPoster(r.ctx, buildMonthly('2026-07', julyInput()));
    expect(r.texts).toContain('总容量 VOLUME');
    expect(r.texts).not.toContain('总次数 REPS');
  });
});

/* ── 年度热力图的月份刻度 ────────────────────────────────────────────────
   53 列格子没有时间轴，读者认不出哪一列是几月——热力图读不出「什么时候」，
   就只是一张色块壁纸。数据页的同款热力图早有月份轴（heat-months），设计研究
   2026-07-12-yearly-poster-design.json 第 13 条也明文规定了刻度的字号与基线，
   海报这份是从版式表阶段就漏掉了（yearlyContentH 里从没给它留过一像素）。

   刻度直接从 columns 派生：HeatCell 自带 date，所以标签和格子必然对齐——
   而不是重算一遍 heatWeekStarts，再赌它跟 buildYearly 的列凑巧同构。 */
describe('monthTicks：年度热力图得有时间轴', () => {
  test('12 个月一个不多一个不少，且自左向右递增', () => {
    const ticks = monthTicks(buildYearly(2026, julyInput()).columns);
    expect(ticks).toHaveLength(buildYearly(2026, julyInput()).columns.length);
    const months = ticks.filter((m): m is number => m !== null);
    expect(months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('首列含上一年的 12 月尾巴，但不许因此标出一个 12', () => {
    // 2026-01-01 是周四 → 首列从 2025-12-29 起。跨年的格子是 null，标签不该被它带偏。
    const ticks = monthTicks(buildYearly(2026, julyInput()).columns);
    expect(ticks[0]).toBe(1); // 1/1 就在首列里
    expect(ticks.indexOf(12)).toBeGreaterThan(40); // 12 月只能出现在年尾
  });

  test('每个月标在它 1 号所在的那一列上', () => {
    const cols = buildYearly(2026, julyInput()).columns;
    const ticks = monthTicks(cols);
    ticks.forEach((m, c) => {
      if (m === null) return;
      const first = `2026-${String(m).padStart(2, '0')}-01`;
      expect(cols[c]!.some((cell) => cell?.date === first)).toBe(true);
    });
  });

  test('年度海报真的把 1..12 画出去了', () => {
    const r = recorder();
    drawYearlyPoster(r.ctx, buildYearly(2026, julyInput()));
    for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      expect(r.texts).toContain(String(m));
    }
  });
});

/**
 * 一格一色是一次**有损压缩**。练了胸 4 组 + 背 2 组的那天，海报格只涂胸色——
 * 而同一张海报的「部位分布」条形图正写着胸 4 / 背 2。两个模块在同一张图上互相拆台。
 *
 * 规则本身归 heat.ts（cellParts / heatBackground）。这里只钉 canvas 侧：
 * 双部位日必须落下**两个**部位色，且和 CSS 的 135deg 同向（主练色在左上）。
 * 浓淡由当天**总组数**决定（两块共享同一个 alpha）——格子的深浅答的是「这天练得狠不狠」，
 * 不是「这块练了几组」；后者是条形图的活。
 */
describe('多部位日：一个格子涂两块部位色', () => {
  /** 2026-07-01：胸 4 组 + 背 2 组（同一天）；07-03：腿 3 组（单部位对照） */
  function twoPartInput(): PosterInput {
    return {
      items: [
        item('2026-07-01', 'e-bench', 4, 60, 8),
        item('2026-07-01', 'e-row', 2, 50, 10),
        item('2026-07-03', 'e-squat', 3, 100, 5),
      ],
      dates: ['2026-07-01', '2026-07-03'],
      exMap: EX_MAP,
    };
  }

  test('数据层：格子带着当天全部部位，组数降序，总组数决定浓淡', () => {
    const d = buildMonthly('2026-07', twoPartInput());
    expect(d.weeks[0]![2]).toMatchObject({
      date: '2026-07-01',
      parts: ['chest', 'back'], // 胸 4 > 背 2
      sets: 6, // 4 + 2 —— 不是主练部位的 4
    });
  });

  test('canvas：双部位日落下两个部位色（主练 + 次练都上色）', () => {
    const d = buildMonthly('2026-07', twoPartInput());
    const r = recorder();
    drawMonthlyPoster(r.ctx, d);
    const styles = r.calls.filter((c) => c.fn === 'fill').map((c) => c.fillStyle);

    expect(styles).toContain(heatColor('chest'));
    expect(styles).toContain(heatColor('back')); // 次练也上色
  });

  /**
   * 定位「次练色那次 fill」不能只按颜色找。热力格不再掺 alpha 之后，它和**分布条**用的是
   * 同一个 hex（同一个部位就该同一个色，这是设计不是巧合），而月度海报里 distBlock 画在
   * monthGridBlock 之前——按颜色 findIndex 会先撞上分布条，然后在「它前面没有 clip」上假红。
   *
   * 所以按**路径形状**定位：三角是海报上唯一一处「beginPath 后正好三个顶点再 fill」的画法
   * （分布条走 roundRect，主练色走整格 fill）。找不到这样一次 fill，下面就是空数组 → 红。
   */
  test('canvas：次练色画成三角形——分割线是 ╱，和 CSS 的 135deg 同向', () => {
    const d = buildMonthly('2026-07', twoPartInput());
    const r = recorder();
    drawMonthlyPoster(r.ctx, d);

    const vertsBefore = (i: number) => {
      const path = r.calls.slice(0, i);
      return path
        .slice(path.map((c) => c.fn).lastIndexOf('beginPath'))
        .filter((c) => c.fn === 'moveTo' || c.fn === 'lineTo')
        .map((c) => c.args);
    };

    const tris = r.calls
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.fn === 'fill' && c.fillStyle === heatColor('back') && vertsBefore(i).length === 3);

    // 样本里只有一个双部位日 —— 多一个三角说明单部位日也被切了，少一个说明次练色压根没画
    expect(tris).toHaveLength(1);
    const i = tris[0]!.i;

    // 三角那次 fill 之前必须先 clip（切回圆角），否则斜边会捅出格子的圆角
    expect(r.calls.slice(0, i).some((c) => c.fn === 'clip')).toBe(true);

    // 三角的三个顶点：右上 → 左下 → 右下。moveTo(x+size, y) 是关键——起点在右上角，
    // 斜边由此指向左下，围出的是**右下**三角（左上留给主练色）。
    const pts = vertsBefore(i);
    const [p0, p1, p2] = pts as [number, number][];
    const size = p2[0] - p1[0]; // 右下.x - 左下.x = 格子边长
    expect(size).toBeGreaterThan(0);
    expect(p0[0]).toBeCloseTo(p2[0], 6); // 右上 与 右下 同一列
    expect(p1[1]).toBeCloseTo(p2[1], 6); // 左下 与 右下 同一行
    expect(p1[1] - p0[1]).toBeCloseTo(size, 6); // 斜边正好 45°：它是正方形的对角线
  });

  test('单部位日不多画一层：只有它自己的色，没有第二个三角', () => {
    const d = buildMonthly('2026-07', twoPartInput());
    const r = recorder();
    drawMonthlyPoster(r.ctx, d);
    const styles = r.calls.filter((c) => c.fn === 'fill').map((c) => c.fillStyle);

    expect(styles).toContain(heatColor('leg'));
    // 腿只在 07-03 出现，而那天没有第二块部位 —— 三角只该为双部位日画一次
    const clips = r.calls.filter((c) => c.fn === 'clip').length;
    expect(clips).toBe(1);
  });
});
