import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FONT, THEME } from './theme';

/**
 * Canvas（Chart.js / 海报）和 SVG 的 stroke 吃不到 CSS 类，只认字符串。
 * 所以 JS 侧必然要有一份色值——问题从来不是「要不要有」，而是「会不会漂」。
 *
 * 漂移已经发生过，而且没人看得出来：
 *   - charts.tsx 写着 #8e8e93 / #2c2c2e（iOS 系统灰），token 表里的 mute 是 #8b8b85（暖灰）。
 *     两个灰在暗底上肉眼几乎同色——「暖」这个基调就是从这种地方一点点漏光的。
 *   - poster.ts 的 display 字体栈掉了 'Helvetica Neue Condensed' 的 Condensed。
 *   - poster.ts 顶上还写着一行注释：「Canvas 读不到 CSS 变量，只能同步一份」——
 *     「只能靠人同步」不是理由，是缺一条测试。
 *
 * 这条测试让 theme.css 继续当唯一真相源：JS 常量逐字等于它，双向不许多也不许少。
 */

// jsdom 环境下 import.meta.url 是 http:// scheme，喂不进 fs——从 vitest 的 cwd（项目根）走
const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');
const start = css.indexOf('@theme');
const block = css.slice(start, css.indexOf('}', start));

const tokensOf = (prefix: string) =>
  new Map(
    [...block.matchAll(new RegExp(`--${prefix}-([\\w-]+):\\s*([^;]+);`, 'g'))].map(([, k, v]) => [
      k,
      v.trim(),
    ]),
  );

const cssColors = tokensOf('color');
const cssFonts = tokensOf('font');

test('正则确实咬到了 @theme 块——否则下面所有断言都是真空通过', () => {
  expect(cssColors.size).toBeGreaterThanOrEqual(8);
  expect(cssFonts.size).toBeGreaterThanOrEqual(2);
});

test('theme.css 的每个 --color-* 在 THEME 里逐字一致', () => {
  for (const [key, value] of cssColors) {
    expect(THEME[key as keyof typeof THEME]).toBe(value);
  }
});

test('theme.css 的每个 --font-* 在 FONT 里逐字一致', () => {
  for (const [key, value] of cssFonts) {
    expect(FONT[key as keyof typeof FONT]).toBe(value);
  }
});

test('JS 侧不许自己发明 token：THEME / FONT 的键与 theme.css 完全对齐', () => {
  expect(Object.keys(THEME).sort()).toEqual([...cssColors.keys()].sort());
  expect(Object.keys(FONT).sort()).toEqual([...cssFonts.keys()].sort());
});
