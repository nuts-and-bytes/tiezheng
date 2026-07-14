import { describe, expect, test } from 'vitest';
import { compositeOver, contrastRatio, maxReadableAlpha, parseColor } from './contrast';

/**
 * 这一组用的是 WCAG 自己公布的基准值，不是我们算出来再抄回去的。
 * 目的很直接：守门测试要用这里的 contrastRatio 去验 heat.ts 解出来的 alpha，
 * 如果亮度公式本身写错了，那两边会一起错、一起绿——所以公式必须先被外部基准钉死。
 */
describe('contrastRatio —— 对着 WCAG 的已知值', () => {
  test('纯黑与纯白是 21:1（比值的上界）', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 2);
  });

  test('同色是 1:1（下界）', () => {
    expect(contrastRatio([18, 52, 86], [18, 52, 86])).toBeCloseTo(1, 5);
  });

  test('#767676 是白底上刚好过 AA 的那个灰（WCAG 的经典临界例）', () => {
    expect(contrastRatio([0x76, 0x76, 0x76], [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    // 再亮一档就掉下去——说明公式的斜率也是对的，不只是某一点撞对了
    expect(contrastRatio([0x77, 0x77, 0x77], [255, 255, 255])).toBeLessThan(4.5);
  });

  test('谁前谁后不影响比值', () => {
    const a: [number, number, number] = [10, 10, 11];
    const b: [number, number, number] = [242, 240, 235];
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });
});

describe('compositeOver —— 半透明色落到底色上真正变成的那个颜色', () => {
  test('alpha=1 就是前景本身', () => {
    expect(compositeOver([232, 72, 63], [10, 10, 11], 1)).toEqual([232, 72, 63]);
  });

  test('alpha=0 就是底色本身', () => {
    expect(compositeOver([232, 72, 63], [10, 10, 11], 0)).toEqual([10, 10, 11]);
  });

  test('alpha=0.5 落在两者正中间', () => {
    expect(compositeOver([200, 100, 0], [0, 0, 100], 0.5)).toEqual([100, 50, 50]);
  });
});

describe('parseColor —— 认得出 heat.ts 吐出来的那两种字符串', () => {
  test('rgba()', () => {
    expect(parseColor('rgba(232, 72, 63, 0.6)')).toEqual({ rgb: [232, 72, 63], alpha: 0.6 });
  });

  test('rgb() 当作全不透明', () => {
    expect(parseColor('rgb(26, 26, 29)')).toEqual({ rgb: [26, 26, 29], alpha: 1 });
  });

  test('#RRGGBB', () => {
    expect(parseColor('#1a1a1d')).toEqual({ rgb: [26, 26, 29], alpha: 1 });
  });

  test('认不出来的就抛——静默返回黑色会让守门测试拿到假绿', () => {
    expect(() => parseColor('linear-gradient(135deg, red, blue)')).toThrow();
  });
});

describe('maxReadableAlpha —— 这个色最浓能涂到多少，还不至于压垮上面的字', () => {
  const BG: [number, number, number] = [10, 10, 11];
  const INK: [number, number, number] = [242, 240, 235];

  test('解出来的 alpha 恰好还站在 4.5:1 上', () => {
    const a = maxReadableAlpha([0xff, 0xb3, 0x40], BG, INK, 4.5);
    expect(contrastRatio(compositeOver([0xff, 0xb3, 0x40], BG, a), INK)).toBeGreaterThanOrEqual(4.5);
  });

  test('再浓一点点就掉下去——说明解的是上确界，不是随便一个安全值', () => {
    const a = maxReadableAlpha([0xff, 0xb3, 0x40], BG, INK, 4.5);
    expect(
      contrastRatio(compositeOver([0xff, 0xb3, 0x40], BG, a + 0.02), INK),
    ).toBeLessThan(4.5);
  });

  test('暗到怎么涂都压不垮字的色，返回上限 1', () => {
    // 深蓝几乎和底色一样暗：满 alpha 也不会把 ink 吃掉
    expect(maxReadableAlpha([0, 0, 40], BG, INK, 4.5)).toBe(1);
  });
});
