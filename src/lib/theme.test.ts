import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BODY_PARTS } from '../data/bodyParts';
import { AA_TEXT, compositeOver, contrastRatio, parseColor } from './contrast';
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
 * - data/bodyParts.ts：部位色是另一个独立的真相源，不跟随 THEME。它写自己的 hex 是本分，
 *   不是抄本——改 THEME.amber 时肩色不该跟着变。豁免的代价是撞色会从这条测试底下溜过去
 *   （肩曾经就是 #FFB340，跟 THEME.amber 一字不差），所以下面单独给它一条守门。
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

/**
 * 上面那条只扫 hex。而 Chart.js 和 canvas 要的是**带 alpha** 的色——token 里只有 hex，
 * 于是人手转一遍写成 rgba(...)，从守门测试眼皮底下整个溜过去。
 * （src 下现存 13 处 `rgba(255,92,31,…)`，全是 THEME.iron 的 rgba 抄本。那是一次独立的
 * token 卫生重构，不在这条测试的射程里。）
 *
 * 但网格色是另一回事：它压根不是 token，是一笔独立的对比度预算，而它被抄在了**两个图表里**。
 * 004ed03 自称「消灭了各处自己抄一份」，漏的正是这两处 `grid: { color: 'rgba(255,255,255,0.05)' }`——
 * 它们把 ChartJS.defaults 整个盖掉，所以改 default 对这两个图**一点效果都没有**，而没人发现。
 * 漏网的原因不是不够仔细，是「grep 一次」不是个能持续的机制。所以钉死：网格色只准有一处出处。
 */
test('图表的网格色只准来自 charts.tsx —— 别处不许写 grid.color 字面量', () => {
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    if (/\.test\.tsx?$/.test(file) || file.endsWith('components/charts.tsx')) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // grid: { color: 'rgba(…)' } —— 字面量。grid: { color: CHART_GRID } 不匹配（引号是关键）
        if (/grid:\s*\{[^}]*color:\s*['"`]/.test(line)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1} 自己写了网格色，应为 CHART_GRID`);
        }
      });
  }

  expect(offenders).toEqual([]);
});

/**
 * 部位色不许和 THEME 的语义色撞同一个 hex。
 *
 * 这不是 token 卫生，是**语义**：琥珀在这个 app 里说的是「警示 / PR」，肩说的是身体部位。
 * 同屏同色，读者只能靠位置猜哪个是哪个——而位置正是最不该承担语义的通道。
 * 肩曾经就是 #FFB340，跟 THEME.amber 一字不差；因为 bodyParts.ts 在上面那条测试的豁免名单里，
 * 它整整躲过了那条守门。豁免开出去了，就得在这里把口子补回来。
 *
 * 为什么不干脆让部位色去引 THEME：因为它们本就不该联动。这条测试要的是「别撞」，不是「同源」。
 */
test('部位色不许撞 THEME 的语义色 —— 同一个 hex 就是两种含义抢一个信号', () => {
  const themeHex = new Map(
    Object.entries(THEME)
      .filter(([, v]) => v.startsWith('#'))
      .map(([name, v]) => [v.toLowerCase(), name]),
  );

  const collisions = BODY_PARTS.filter((p) => themeHex.has(p.color.toLowerCase())).map(
    (p) => `${p.name}(${p.color}) 撞了 THEME.${themeHex.get(p.color.toLowerCase())}`,
  );

  expect(collisions).toEqual([]);
});

/**
 * mute 不许再降 alpha —— 因为 `text-mute/70` 这类写法看着是「更淡一点」，实际是把字
 * 推到 AA 门槛之下，而降 alpha 的人**没有一次是算过的**。
 *
 * 门槛不写死，从 contrast.ts 解出来：mute 落在最亮的表面（raised）上，要过 AA_TEXT
 * 需要多少 alpha。答案是 ~0.89 —— 也就是说 /50 到 /88 全部不合格，而 /89 以上跟实色
 * 肉眼没有区别。这条规则于是干净得没有灰带：**mute 就是不带 alpha 后缀。**
 *
 * 被这条抓出来的原案：
 *   - SetRows 的 placeholder:text-mute/50 → 2.28:1。那两个框只有 placeholder 没有 label，
 *     标签的活儿由一个 2.28:1 的字在干。
 *   - 4 处 placeholder:text-mute/60 → 2.70:1
 *   - StatsScreen 的说明文字 text-mute/70 → 3.33:1
 */
test('mute 不许带 alpha 后缀——降下去就压穿 AA，而降的人从来没算过', () => {
  const mute = parseColor(THEME.mute).rgb;
  const raised = parseColor(THEME.raised).rgb; // 最亮的表面 = 最坏情况
  const minAlpha = (() => {
    for (let a = 1; a >= 0; a -= 0.01) {
      if (contrastRatio(compositeOver(mute, raised, a), raised) < AA_TEXT) {
        return Math.round((a + 0.01) * 100);
      }
    }
    return 0;
  })();
  expect(minAlpha).toBeGreaterThan(85); // 解出来的门槛确实高到「没有可用的 alpha 档位」

  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/text-mute\/(\d+)/g)) {
          const a = Number(m[1]);
          if (a < minAlpha) {
            const c = compositeOver(mute, raised, a / 100);
            offenders.push(
              `${file.slice(SRC.length + 1)}:${i + 1} text-mute/${a} → ${contrastRatio(c, raised).toFixed(2)}:1，AA 要 ${AA_TEXT}`,
            );
          }
        }
      });
  }
  expect(offenders).toEqual([]);
});
