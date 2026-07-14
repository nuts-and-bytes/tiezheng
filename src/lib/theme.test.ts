import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

/**
 * 上面那几条只钉住「JS 常量 == CSS token」。它们钉不住的是：
 * 有没有人在别的文件里，把同一个色值又手抄了一遍。
 *
 * 抄本不会让上面任何一条变红——它只是躺在那儿，等下次改 token 时静默漂移。
 * 004ed03 自称消灭了「各处自己抄一份」，实际漏了两处（StatsScreen 的 pointBackgroundColor
 * 和 borderColor）。漏网的原因不是不够仔细，是「grep 一次」根本不是个能持续的机制。
 * 所以把它变成常驻断言：token 的 hex 值，在 src 下只准出现在 theme.ts 里。
 */
const SRC = resolve(process.cwd(), 'src');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });

/**
 * 豁免名单。每一条都必须带理由——否则这条测试迟早被豁免掏空：
 *
 * - theme.ts：token 的出处，本来就该写字面量。
 * - *.test.ts(x)：测试写字面量正是它的职责。改成 THEME.x 会让断言变成同义反复——
 *   用被测代码的常量去验证被测代码，等于什么都没测。
 * - data/bodyParts.ts：部位色是另一个独立的真相源，不跟随 THEME。肩部 #FFB340 与
 *   THEME.amber 撞了同一个 hex，但那是巧合不是抄本：改 amber 时肩部不该跟着变。
 *   （撞色本身是个设计问题——琥珀是「警示 / PR」语义，肩是部位语义，同屏同色会混淆。
 *   那是配色决策，不是 token 卫生问题，另案。）
 */
const isExempt = (file: string) =>
  /\.test\.tsx?$/.test(file) || file.endsWith('lib/theme.ts') || file.endsWith('data/bodyParts.ts');

test('THEME 的色值不许被手抄进别的文件——theme.ts 是唯一出处', () => {
  const hexTokens = Object.entries(THEME).filter(([, v]) => v.startsWith('#'));
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    if (isExempt(file)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const [name, value] of hexTokens) {
          if (line.toLowerCase().includes(value.toLowerCase())) {
            offenders.push(`${file.slice(SRC.length + 1)}:${i + 1} 抄了 ${value}，应为 THEME.${name}`);
          }
        }
      });
  }

  expect(offenders).toEqual([]);
});
