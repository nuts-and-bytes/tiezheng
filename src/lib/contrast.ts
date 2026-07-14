/**
 * WCAG 2.x 的对比度算术。存在的理由只有一个：**颜色不能靠肉眼审。**
 *
 * 日历格的白字压在半透明部位色上，人眼在暗底 + 低 alpha 下完全不可信——
 * 原本的注释断言「满 alpha 的饱和红/紫会把白字吃掉」，算出来红/紫是 7.0:1 绰绰有余，
 * 真正跌破 4.5 的反倒是最亮的黄和青（3.87 / 3.95）。心智模型整个是反的。
 * 所以浓度上限不能是拍脑袋定的常数，得由这里解出来。
 *
 * 公式：WCAG 2.1 相对亮度 + (L1+0.05)/(L2+0.05)。
 * 只做 heat.ts / 守门测试要用的那几件事，不长成一个颜色库。
 */

export type RGB = [number, number, number];

/** AA 级正文对比度门槛。日历格里的日期数字是正文，不是装饰。 */
export const AA_TEXT = 4.5;

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]: RGB): number {
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

export function contrastRatio(a: RGB, b: RGB): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 半透明色落到底色上，眼睛真正看到的那个颜色（source-over）。 */
export function compositeOver(fg: RGB, bg: RGB, alpha: number): RGB {
  return bg.map((b, i) => b * (1 - alpha) + fg[i] * alpha) as RGB;
}

/** 认得出 heat.ts 吐的 rgba()/rgb()/#RRGGBB。认不出就抛——静默兜底会让守门测试假绿。 */
export function parseColor(css: string): { rgb: RGB; alpha: number } {
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(
    css.trim(),
  );
  if (fn) {
    return {
      rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])],
      alpha: fn[4] === undefined ? 1 : Number(fn[4]),
    };
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  throw new Error(`parseColor: 认不出的颜色 "${css}"`);
}

/**
 * `color` 铺在 `backdrop` 上、最浓能到多少 alpha，而 `text` 压上去仍有 `minRatio`。
 *
 * 二分而不是解析求逆：相对亮度里有个分段的 gamma，逆解要分情况讨论；
 * 而对比度随 alpha 单调（底色越亮，白字上的比值越低），二分 60 次就到浮点极限了。
 * 这个函数在模块加载时每个部位跑一次，不在渲染路径上。
 */
export function maxReadableAlpha(
  color: RGB,
  backdrop: RGB,
  text: RGB,
  minRatio: number = AA_TEXT,
): number {
  const ok = (a: number) => contrastRatio(compositeOver(color, backdrop, a), text) >= minRatio;
  if (ok(1)) return 1; // 暗到怎么涂都压不垮字
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
