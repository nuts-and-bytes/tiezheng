# 铁证 IRONPROOF · 视觉重塑 v2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「铁证」从版块化卡片堆重塑为锻造工业风的一体化产品：品牌钢印 + 部位图标 + 蚀刻线取代卡片、日历一眼看出练了什么、数据页按「用户想知道什么」重做信息架构、【我的】重做、4 步首启引导、月度/年度训练海报本地导出。

**Architecture:** 严格两阶段。**阶段 0（串行，单 agent）**只碰全局共享层——`theme.css`（唯一 CSS 入口）、`bodyParts.ts`、`lib/stats.ts` 新纯函数、`lib/platform.ts`、三个原子组件、`App.tsx`、测试 helper——做完必须 `tsc --noEmit` + `npm test` 全绿才放行。**阶段 1（并行，6 agent）**每个 agent 独占一组 screen 文件，互不重叠，一律禁止回头改阶段 0 的文件。海报强制两层拆分（纯数据 `buildPosterModel` + 副作用 `paint(ctx, model)`），否则 jsdom 一行都测不了。

**Tech Stack:** React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS 4（`@theme`）+ Dexie 4 + Chart.js 4 + Vitest + Testing Library + fake-indexeddb。海报用原生 Canvas 2D（无 html2canvas）。字体走 pyftsubset 子集 + base64 内联（零网络）。

**基准文档（实现真相源，必须先读）：**
- 规格：`docs/superpowers/specs/2026-07-12-tiezheng-redesign-v2-design.md`（v2，优先级高于 v1）
- 视觉母版：`docs/design-cards/**` 共 8 张 HTML 卡片
- **铁律 7（不可协商）**：海报全本地、零网络请求、照片绝不上传；`workout.note` 是用户私人文字，**绝不出现在海报任何位置**

---

## 文件结构

### 阶段 0 —— 全局共享层（串行，单 agent 独占）

| 文件 | 职责 |
|---|---|
| `assets/fonts/Anton-Regular.ttf`（新增，commit） | 字体源文件。**不在 `src/` 或 `public/` 下 → vite 不会打包它**，只作为子集脚本的输入 |
| `scripts/gen-theme-assets.py`（新增） | 一次性生成器：Anton 子集 woff2 → base64；64×64 噪点 PNG → base64；**就地重写** `src/styles/theme.css` 里两行标记行。幂等 |
| `src/styles/theme.css`（改写） | **唯一 CSS 入口**（`main.tsx:6` import）。全部 `@theme` token（含 `card2`/`iron2` 兼容别名）+ `@font-face`（内联 Anton）+ `.grain` + `.etch` + `.display` + keyframes。**禁止新建任何 .css 文件** |
| `src/data/bodyParts.ts`（改 1 行） | 胸 `#FF5C1F` → `#E8483F`，让 `--iron` 成为界面上唯一的橙 |
| `src/lib/stats.ts`（追加，不删旧函数） | 全部新纯函数：`rangeOf` `prevRangeOf` `daysBetween` `daysInRange` `hasWeightData` `dailyLoad` `compare` `estimate1RM` `prsByExercise` `e1rmSeries` `topExerciseIds` `setsByBodyPart` `lastTrainedByBodyPart` `longestStreak` `dailyPartLoad` `percentile` `daysInYear` `yearsWithData` `dailyMovingAverage` |
| `src/lib/platform.ts`（新增） | 平台能力探测：`canShareFiles(files)` / `shareFiles(files)` / `vibrate(ms)`。**jsdom 里 `navigator.vibrate` 不存在，不判空会让 7 个 LogFlow 测试变红** |
| `src/components/Stamp.tsx`（新增） | 品牌钢印「铁」：旋转 −6°、iron 描边、内圈虚线、外发光 |
| `src/components/PartIcon.tsx`（新增） | 7 个部位 SVG 图标 + 4 个 nav 图标，统一 `viewBox="0 0 24 24"` `fill="none"` `stroke-width="1.8"` |
| `src/components/ForgeRing.tsx`（新增） | 周目标进度环。**内部复用 `ProgressRing`，不得删除 `ProgressRing.tsx`**（否则 `ProgressRing.test` 的 4 个测试变孤儿） |
| `src/components/ProgressRing.tsx`（改 2 行） | 只换硬编码旧色：`#FF8C42` → `#FFB340`、底环 `#2C2C2E` → `#1A1A1D`。**几何一行不动**（4 个测试全在断言 `stroke-dashoffset`） |
| `src/screens/poster/PosterScreen.tsx`（新增 stub） | 阶段 0 只建最小可编译占位，让 `App.tsx` 的 `/poster` 路由能过 tsc。**实现权归阶段 1 的 Agent F** |
| `src/App.tsx`（改） | 挂 `.grain` 噪点层 + 注册 `/poster` 路由 |
| `src/test/helpers.ts`（新增） | `completeOnboarding(user)`：4 步引导流程的测试穿透器 |

### 阶段 1 —— screen 层（6 agent 并行，文件所有权互斥）

| Agent | 独占文件 | 必读卡片 |
|---|---|---|
| **A** | `src/screens/today/**`、`src/components/PhotoCard.tsx`、`src/components/SetRows.tsx` | `docs/design-cards/screens/today.html` |
| **B** | `src/screens/calendar/**`（含 `DayDetailScreen`）、`src/components/HeatGrid.tsx`（新增） | `docs/design-cards/screens/calendar.html` |
| **C** | `src/screens/stats/**`、`src/components/charts.tsx`、`src/components/PhotoTimeline.tsx` | `docs/design-cards/screens/stats.html` |
| **D** | `src/screens/profile/**`、`src/components/ExerciseManager.tsx` | `docs/design-cards/screens/profile.html` |
| **E** | `src/screens/log/**`、`src/components/TabBar.tsx`、`src/components/InstallHint.tsx`、`src/components/UpdateToast.tsx` | `docs/design-cards/brand/icons.html` |
| **F** | `src/screens/Onboarding.tsx`、`src/screens/poster/**`、`src/lib/poster/**`（新增）、`src/App.test.tsx` | `docs/design-cards/screens/onboarding.html`、`docs/design-cards/poster/monthly.html` |

**阶段 1 硬约束：任何 agent 不得修改 `theme.css` / `App.tsx` / `bodyParts.ts` / `lib/stats.ts` / `lib/platform.ts` / `components/Stamp.tsx` / `components/PartIcon.tsx` / `components/ForgeRing.tsx`。** 缺 token 或缺纯函数，就在返回结果里报告，不要自己动手改共享文件。

---

# 阶段 0（串行 · 单 agent · 必须按序）

### Task 0.1: 字体子集 + 噪点资产生成器

Anton 走 `@fontsource` 会让 woff2 落在 workbox 预缓存之外（默认 `globPatterns` 只含 js/wasm/css/html）→ 装 PWA 后离线仍发网络请求，**违反铁律 7**。所以子集化后 base64 内联进 CSS。已实测：`U+0020-007E` 子集 = **4772 字节 woff2 / 6364 字符 base64**。

**Files:**
- Create: `assets/fonts/Anton-Regular.ttf`
- Create: `scripts/gen-theme-assets.py`

- [ ] **Step 1: 下载 Anton 字体源文件并 commit 进仓库**

```bash
cd /Users/ericlu/fitness-app-v2
mkdir -p assets/fonts scripts
curl -sL -o assets/fonts/Anton-Regular.ttf \
  https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf
ls -la assets/fonts/Anton-Regular.ttf
```

Expected: `170812` 字节左右的文件。Anton 是 SIL OFL 协议，可随仓库分发。

- [ ] **Step 2: 写生成器脚本**

`scripts/gen-theme-assets.py`：

```python
#!/usr/bin/env python3
"""一次性资产生成器（幂等）。

1) Anton-Regular.ttf --(pyftsubset U+0020-007E)--> woff2 --> base64
2) 64x64 灰度噪点 PNG（zlib 手写编码，无需 PIL）--> base64
3) 就地重写 src/styles/theme.css 中带 /* GEN:ANTON */ 和 /* GEN:GRAIN */ 标记的下一行

前置：python3 需装 fontTools 和 brotli（本机 /usr/local/bin/python3 已具备）。
构建（vite / Cloudflare）不依赖本脚本——生成结果已 commit 进 theme.css。
"""
import base64
import io
import pathlib
import random
import struct
import zlib

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
TTF = ROOT / 'assets' / 'fonts' / 'Anton-Regular.ttf'
CSS = ROOT / 'src' / 'styles' / 'theme.css'


def anton_b64() -> str:
    font = TTFont(str(TTF))
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = []
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = []
    opts.notdef_outline = False
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=list(range(0x20, 0x7F)))  # 数字 + 基本拉丁；中文用回退字体
    sub.subset(font)
    font.flavor = 'woff2'
    buf = io.BytesIO()
    font.save(buf)
    data = buf.getvalue()
    print(f'anton woff2: {len(data)} bytes')
    return base64.b64encode(data).decode()


def grain_b64(size: int = 64, seed: int = 7) -> str:
    """灰度 PNG（color type 0, 8-bit）。CSS 侧再叠 opacity:.05 控制强度。"""
    rng = random.Random(seed)
    raw = bytearray()
    for _ in range(size):
        raw.append(0)  # PNG 每行前缀 filter byte = 0 (None)
        raw.extend(rng.randrange(256) for _ in range(size))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        body = tag + payload
        return struct.pack('>I', len(payload)) + body + struct.pack('>I', zlib.crc32(body))

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 0, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )
    print(f'grain png: {len(png)} bytes')
    return base64.b64encode(png).decode()


def inject(css: str, marker: str, line: str) -> str:
    lines = css.split('\n')
    for i, cur in enumerate(lines):
        if marker in cur:
            assert i + 1 < len(lines), f'{marker} 后面没有可替换的行'
            lines[i + 1] = line
            return '\n'.join(lines)
    raise SystemExit(f'theme.css 里找不到标记 {marker}')


def main() -> None:
    css = CSS.read_text()
    css = inject(
        css,
        '/* GEN:ANTON */',
        f"  src: url('data:font/woff2;base64,{anton_b64()}') format('woff2');",
    )
    css = inject(
        css,
        '/* GEN:GRAIN */',
        f"  background-image: url('data:image/png;base64,{grain_b64()}');",
    )
    CSS.write_text(css)
    print(f'theme.css 已更新（{len(css)} 字符）')


if __name__ == '__main__':
    main()
```

- [ ] **Step 3: 暂不运行**（`theme.css` 还没有标记行，跑了会 `SystemExit`）。先做 Task 0.2，写完 CSS 骨架再回来跑。

---

### Task 0.2: theme.css —— 唯一 CSS 入口

**BLOCKER B1 复述：`src/index.css` 根本不存在。** 真入口是 `src/styles/theme.css`（`src/main.tsx:6` import）。**禁止新建任何 .css 文件**——jsdom 不解析 CSS，写错文件后 `npm test` 全绿、`npm run build` 也过，只有真机才看到没样式的黑页。

**BLOCKER B2 复述：Tailwind 4 下删掉 `--color-card2` / `--color-iron2` 不会报错**，`bg-card2` 只是静默不生成 utility → 输入框变透明贴在 `#0A0A0B` 上，测试仍全绿。这两个 token 现存于 8 个源文件，**必须保留为别名**直到阶段 1 全部替换完。

**Files:**
- Modify: `src/styles/theme.css`（现 29 行，整体改写）

- [ ] **Step 1: 改写 theme.css**

```css
@import 'tailwindcss';

/* 锻造工业风：暗金属底 + 噪点 + iron 橙作为界面上唯一的热源。
   token 与 docs/design-cards/brand/tokens.html 逐字对齐。 */
@theme {
  --color-bg: #0a0a0b;      /* 冷黑底 */
  --color-raised: #141416;  /* 抬起面（输入框、chip 底） */
  --color-card: #1a1a1d;    /* 卡片——本次改造后应极少使用，用 .etch 分隔取代 */
  --color-ink: #f2f0eb;     /* 暖白，不是纯白 */
  --color-mute: #8b8b85;    /* 暖灰 */
  --color-iron: #ff5c1f;    /* 唯一热源 */
  --color-amber: #ffb340;   /* 热源的高光端 */
  --color-line: rgba(255, 255, 255, 0.07);

  /* 兼容别名：阶段 1 逐个替换掉 bg-card2 / text-iron2 后再删。
     现在删会静默失效（Tailwind 4 不报错），测试也照样全绿。 */
  --color-card2: #1a1a1d;
  --color-iron2: #ffb340;

  --font-display: 'Anton', 'Arial Narrow', 'Helvetica Neue Condensed', system-ui, sans-serif;
}

/* Anton 数字子集，base64 内联。
   走 @fontsource 会让 woff2 落在 workbox 预缓存之外 → 离线时发网络请求 → 违反铁律 7。
   下一行由 scripts/gen-theme-assets.py 生成，不要手改。 */
@font-face {
  font-family: 'Anton';
  /* GEN:ANTON */
  src: url('data:font/woff2;base64,PLACEHOLDER') format('woff2');
  font-weight: 400;
  font-style: normal;
  /* block 而非 swap：钢印大字用 swap 会先闪一帧系统字体再跳字宽 */
  font-display: block;
}

/* 全屏噪点层：base64 PNG tile。
   SVG feTurbulence 全屏栅格化会让 iOS 滚动时整层重绘。
   下一行由 scripts/gen-theme-assets.py 生成，不要手改。 */
.grain {
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
  opacity: 0.05;
  /* GEN:GRAIN */
  background-image: url('data:image/png;base64,PLACEHOLDER');
  background-repeat: repeat;
}

/* 蚀刻线：取代卡片作为分隔手段。1px 亮线 + 1px 暗影 = 金属刻痕 */
.etch {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.65);
  margin: 20px 0;
}

/* 压缩体数字。Anton 没有中文字形——
   .display 只允许包纯数字/单位的 <span>，中文另起 span 用默认字体，否则基线错位。 */
.display {
  font-family: var(--font-display);
  letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
}

/* 热源渐变：数字/进度环/CTA 的唯一上色方式 */
.heat {
  background: linear-gradient(135deg, #ff5c1f, #ffb340);
}

.heat-text {
  background: linear-gradient(135deg, #ff5c1f, #ffb340);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* 打卡完成时钢印落下 */
@keyframes stamp-in {
  0% {
    transform: rotate(-6deg) scale(1.35);
    opacity: 0;
  }
  60% {
    transform: rotate(-6deg) scale(0.94);
    opacity: 1;
  }
  100% {
    transform: rotate(-6deg) scale(1);
    opacity: 1;
  }
}

.animate-stamp-in {
  animation: stamp-in 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}

@media (prefers-reduced-motion: reduce) {
  .animate-stamp-in {
    animation: none;
  }
}
```

- [ ] **Step 2: 跑生成器注入 base64**

```bash
cd /Users/ericlu/fitness-app-v2 && /usr/local/bin/python3 scripts/gen-theme-assets.py
```

Expected 输出：
```
anton woff2: 4772 bytes
grain png: ~4200 bytes
theme.css 已更新（NNNNN 字符）
```

- [ ] **Step 3: 验证 base64 真的进去了、且没有残留占位符**

```bash
cd /Users/ericlu/fitness-app-v2 && grep -c "PLACEHOLDER" src/styles/theme.css; grep -o "base64,[A-Za-z0-9+/=]\{40\}" src/styles/theme.css
```

Expected: `grep -c PLACEHOLDER` 输出 `0`；两条 `base64,xxxx…` 匹配。

- [ ] **Step 4: 确认没有新建任何 .css**

```bash
cd /Users/ericlu/fitness-app-v2 && find src -name "*.css"
```

Expected: 只有 `src/styles/theme.css` 一行。

- [ ] **Step 5: 构建冒烟**

```bash
cd /Users/ericlu/fitness-app-v2 && npm run build 2>&1 | tail -5
```

Expected: build 成功。

- [ ] **Step 6: Commit**

```bash
cd /Users/ericlu/fitness-app-v2
git add assets/fonts scripts/gen-theme-assets.py src/styles/theme.css
git commit -m "feat(theme): 锻造工业风 token + 内联 Anton 子集 + 噪点层（零网络）"
```

---

### Task 0.3: bodyParts 胸色让位

胸和 `--iron` 撞成同一个 `#FF5C1F`，`iron` 就不再是「唯一热源」。改成砖红 `#E8483F`。

**Files:**
- Modify: `src/data/bodyParts.ts:10`

- [ ] **Step 1: 确认没有测试断言这个色值**

```bash
cd /Users/ericlu/fitness-app-v2 && grep -rni "ff5c1f" src/data src/**/*.test.* 2>/dev/null || echo "无测试依赖该色值"
```

Expected: 只有 `src/data/bodyParts.ts:10` 一行（或提示无依赖）。

- [ ] **Step 2: 改色**

```ts
  { id: 'chest', name: '胸', color: '#E8483F' },
```

- [ ] **Step 3: 跑测试**

```bash
cd /Users/ericlu/fitness-app-v2 && npx vitest run src/data/presetExercises.test.ts
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
cd /Users/ericlu/fitness-app-v2 && git add src/data/bodyParts.ts && git commit -m "feat(brand): 胸色改砖红 #E8483F，让 iron 成为界面唯一热源"
```

---

### Task 0.4: lib/stats.ts —— 数据页的全部新纯函数（TDD）

数据页的根因是「能力驱动」：`stats.ts` 能算什么就画什么。要按「用户想知道什么」倒推，就得先有能回答这些问题的纯函数。**全部纯函数、零 Dexie 依赖 → 全部可单测。**

现有函数 `countByBodyPart` `weeklyCounts` `movingAverage` `maxWeightSeries` `totals` `currentStreak` `weekProgress` **一律保留不删**（其它页和现有测试仍依赖）。

关键类型（已从代码核实）：
- `RangeItem = { date: string; exerciseId: string; sets: SetEntry[] }`（`src/repos/workoutRepo.ts:9`）
- `SetEntry = { weight?: number; reps?: number }`，**两者都选填**
- `getExercisesByIds(ids)` 返回 `Map<string, Exercise>`

**Files:**
- Modify: `src/lib/stats.ts`（追加）
- Modify: `src/lib/stats.test.ts`（追加）

- [ ] **Step 1: 先写失败的测试**

在 `src/lib/stats.test.ts` 末尾追加。顶部 import 补上新函数名和类型：

```ts
import {
  compare,
  dailyLoad,
  dailyMovingAverage,
  dailyPartLoad,
  daysBetween,
  daysInRange,
  daysInYear,
  e1rmSeries,
  estimate1RM,
  hasWeightData,
  lastTrainedByBodyPart,
  longestStreak,
  percentile,
  prevRangeOf,
  prsByExercise,
  rangeOf,
  setsByBodyPart,
  topExerciseIds,
  yearsWithData,
} from './stats';
import type { Exercise } from './types';

/** 测试夹具：两个动作，胸推 + 深蹲 */
const EX: Map<string, Exercise> = new Map([
  ['e1', { id: 'e1', name: '卧推', bodyPart: 'chest', preset: true, updatedAt: 0, deletedAt: null }],
  ['e2', { id: 'e2', name: '深蹲', bodyPart: 'leg', preset: true, updatedAt: 0, deletedAt: null }],
]);

const ITEMS = [
  { date: '2026-07-01', exerciseId: 'e1', sets: [{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }] },
  { date: '2026-07-03', exerciseId: 'e1', sets: [{ weight: 65, reps: 8 }] },
  { date: '2026-07-03', exerciseId: 'e2', sets: [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }, { weight: 80, reps: 5 }] },
  { date: '2026-06-20', exerciseId: 'e1', sets: [{ weight: 50, reps: 10 }] },
];

describe('rangeOf / prevRangeOf', () => {
  it('本周从周一到今天', () => {
    // 2026-07-12 是周日 → 周一是 07-06
    expect(rangeOf('week', '2026-07-12')).toEqual({ from: '2026-07-06', to: '2026-07-12' });
  });

  it('本月从 1 号到今天', () => {
    expect(rangeOf('month', '2026-07-12')).toEqual({ from: '2026-07-01', to: '2026-07-12' });
  });

  it('今年从 1 月 1 日到今天', () => {
    expect(rangeOf('year', '2026-07-12')).toEqual({ from: '2026-01-01', to: '2026-07-12' });
  });

  it('全部从纪元起算', () => {
    expect(rangeOf('all', '2026-07-12')).toEqual({ from: '1970-01-01', to: '2026-07-12' });
  });

  it('上一区间与本区间等长且紧邻', () => {
    // 07-06..07-12 共 7 天 → 上一段 06-29..07-05
    expect(prevRangeOf({ from: '2026-07-06', to: '2026-07-12' })).toEqual({
      from: '2026-06-29',
      to: '2026-07-05',
    });
  });
});

describe('daysBetween / daysInRange / daysInYear', () => {
  it('daysBetween 算头尾差值', () => {
    expect(daysBetween('2026-07-01', '2026-07-12')).toBe(11);
    expect(daysBetween('2026-07-12', '2026-07-12')).toBe(0);
  });

  it('daysInRange 去重且只数区间内的', () => {
    const dates = ['2026-07-01', '2026-07-03', '2026-07-03', '2026-06-20'];
    expect(daysInRange(dates, '2026-07-01', '2026-07-12')).toBe(2);
  });

  it('daysInYear 认得闰年', () => {
    expect(daysInYear(2026)).toBe(365);
    expect(daysInYear(2024)).toBe(366);
  });
});

describe('hasWeightData', () => {
  it('有重量+次数才算有', () => {
    expect(hasWeightData(ITEMS)).toBe(true);
  });

  it('只记组数的用户算没有', () => {
    expect(hasWeightData([{ date: '2026-07-01', exerciseId: 'e1', sets: [{}, {}, {}] }])).toBe(false);
  });

  it('只填重量不填次数也算没有（容量算不出来）', () => {
    expect(
      hasWeightData([{ date: '2026-07-01', exerciseId: 'e1', sets: [{ weight: 60 }] }]),
    ).toBe(false);
  });
});

describe('dailyLoad', () => {
  it('按日期汇总组数，区间外不计', () => {
    const load = dailyLoad(ITEMS, '2026-07-01', '2026-07-12');
    expect(load.get('2026-07-01')).toBe(2);
    expect(load.get('2026-07-03')).toBe(4); // e1 一组 + e2 三组
    expect(load.has('2026-06-20')).toBe(false);
  });
});

describe('compare', () => {
  it('环比给出本期、上期和百分比', () => {
    const dates = ITEMS.map((i) => i.date);
    const r = compare(
      ITEMS,
      dates,
      { from: '2026-07-01', to: '2026-07-12' },
      { from: '2026-06-19', to: '2026-06-30' },
    );
    expect(r.days.cur).toBe(2);
    expect(r.days.prev).toBe(1);
    expect(r.days.pct).toBe(100);
    expect(r.sets.cur).toBe(6);
    expect(r.sets.prev).toBe(1);
  });

  it('上期为 0 时百分比为 null（不能除以 0，也不能写成 +Infinity%）', () => {
    const r = compare(ITEMS, ['2026-07-01'], { from: '2026-07-01', to: '2026-07-12' }, { from: '2026-06-01', to: '2026-06-12' });
    expect(r.days.prev).toBe(0);
    expect(r.days.pct).toBeNull();
  });
});

describe('estimate1RM', () => {
  it('Epley 公式', () => {
    expect(estimate1RM(100, 1)).toBeCloseTo(103.33, 1);
    expect(estimate1RM(60, 10)).toBeCloseTo(80, 5);
  });

  it('非法输入返回 0，不返回 NaN', () => {
    expect(estimate1RM(0, 10)).toBe(0);
    expect(estimate1RM(60, 0)).toBe(0);
  });
});

describe('prsByExercise', () => {
  it('每个动作取历史最佳 e1RM，按 e1RM 降序', () => {
    const prs = prsByExercise(ITEMS, EX);
    expect(prs[0].name).toBe('深蹲'); // 80×5 → 93.3
    expect(prs[0].e1rm).toBeCloseTo(93.33, 1);
    expect(prs[1].name).toBe('卧推'); // 65×8 → 82.3 胜过 60×10 的 80
    expect(prs[1].date).toBe('2026-07-03');
  });

  it('没有重量数据时返回空数组，不返回 NaN 行', () => {
    expect(prsByExercise([{ date: '2026-07-01', exerciseId: 'e1', sets: [{}] }], EX)).toEqual([]);
  });
});

describe('e1rmSeries / topExerciseIds', () => {
  it('每天取该动作最大 e1RM，按日期升序', () => {
    const s = e1rmSeries(ITEMS, 'e1');
    expect(s.map((p) => p.date)).toEqual(['2026-06-20', '2026-07-01', '2026-07-03']);
    expect(s[2].e1rm).toBeCloseTo(82.33, 1);
  });

  it('默认动作 = 有效数据点最多的那个（不再是 Map 迭代顺序里随机的第一个）', () => {
    expect(topExerciseIds(ITEMS, 5)[0]).toBe('e1'); // e1 有 3 天，e2 只有 1 天
  });
});

describe('setsByBodyPart / lastTrainedByBodyPart', () => {
  it('按部位汇总组数（组数计权，不是次数计权）', () => {
    const by = setsByBodyPart(ITEMS, EX);
    expect(by.chest).toBe(4);
    expect(by.leg).toBe(3);
    expect(by.back).toBe(0);
  });

  it('距上次训练天数；从未练过为 null', () => {
    const last = lastTrainedByBodyPart(ITEMS, EX, '2026-07-12');
    expect(last.chest).toBe(9); // 07-03
    expect(last.back).toBeNull();
  });
});

describe('longestStreak', () => {
  it('最长连续打卡天数', () => {
    expect(longestStreak(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06'])).toBe(3);
  });

  it('空数组为 0', () => {
    expect(longestStreak([])).toBe(0);
  });

  it('重复日期不重复计数', () => {
    expect(longestStreak(['2026-07-01', '2026-07-01', '2026-07-02'])).toBe(2);
  });
});

describe('dailyPartLoad', () => {
  it('每天给出主练部位和总组数', () => {
    const m = dailyPartLoad(ITEMS, EX);
    expect(m.get('2026-07-03')).toEqual({ part: 'leg', sets: 4 }); // 腿 3 组 > 胸 1 组
    expect(m.get('2026-07-01')).toEqual({ part: 'chest', sets: 2 });
  });

  it('并列时取 BODY_PARTS 顺序靠前者（结果必须确定，不能靠 Map 迭代顺序）', () => {
    const tie = [
      { date: '2026-07-05', exerciseId: 'e2', sets: [{}] }, // leg 1 组
      { date: '2026-07-05', exerciseId: 'e1', sets: [{}] }, // chest 1 组
    ];
    expect(dailyPartLoad(tie, EX).get('2026-07-05')).toEqual({ part: 'chest', sets: 2 });
  });
});

describe('percentile', () => {
  it('p90', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(10);
  });

  it('空数组为 0（海报热力图靠它防 0 除）', () => {
    expect(percentile([], 90)).toBe(0);
  });
});

describe('yearsWithData', () => {
  it('降序返回有数据的年份', () => {
    expect(yearsWithData(['2025-12-31', '2026-01-01', '2026-07-01'])).toEqual([2026, 2025]);
  });
});

describe('dailyMovingAverage', () => {
  it('按自然日开窗，不按记录序号（隔了 30 天的两条不该互相平滑）', () => {
    const out = dailyMovingAverage(
      [
        { date: '2026-06-01', value: 70 },
        { date: '2026-07-01', value: 80 },
        { date: '2026-07-02', value: 82 },
      ],
      7,
    );
    expect(out[0].value).toBe(70);
    expect(out[1].value).toBe(80); // 7 日窗内只有它自己，不该被 6-01 的 70 拖下来
    expect(out[2].value).toBe(81); // (80+82)/2
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/ericlu/fitness-app-v2 && npx vitest run src/lib/stats.test.ts 2>&1 | tail -20
```

Expected: 编译期就红——`"rangeOf" is not exported by "src/lib/stats.ts"`。

- [ ] **Step 3: 实现**

在 `src/lib/stats.ts` 末尾追加（顶部 import 补 `parseDate`、`toDateStr`、`Exercise`、`WorkoutItem` 相关类型）：

```ts
// ---- 数据页 v2：按「用户想知道什么」倒推的纯函数 ----

/** stats 的输入统一用这个形状（= workoutRepo.RangeItem，此处独立声明避免 lib 反向依赖 repos） */
export interface LoadItem {
  date: string;
  exerciseId: string;
  sets: SetEntry[];
}

export type ExMap = Map<string, Exercise>;
export type Segment = 'week' | 'month' | 'year' | 'all';

export interface Range {
  from: string;
  to: string;
}

export interface Delta {
  cur: number;
  prev: number;
  /** prev 为 0 时为 null——不能除以 0，也不能显示 +Infinity% */
  pct: number | null;
}

const EPOCH = '1970-01-01';

export function rangeOf(seg: Segment, today: string): Range {
  if (seg === 'week') return { from: weekStartOf(today), to: today };
  if (seg === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (seg === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  return { from: EPOCH, to: today };
}

/** 相邻的等长上一区间（环比用） */
export function prevRangeOf(cur: Range): Range {
  const len = daysBetween(cur.from, cur.to) + 1;
  const to = addDays(cur.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

export function daysBetween(a: string, b: string): number {
  const ms = parseDate(b).getTime() - parseDate(a).getTime();
  return Math.round(ms / 86400000);
}

export function daysInRange(dates: string[], from: string, to: string): number {
  return new Set(dates.filter((d) => d >= from && d <= to)).size;
}

export function daysInYear(year: number): number {
  return daysBetween(`${year}-01-01`, `${year}-12-31`) + 1;
}

function inRange<T extends { date: string }>(items: T[], from: string, to: string): T[] {
  return items.filter((i) => i.date >= from && i.date <= to);
}

/** 有没有可算容量的数据。只记「练了什么+几组」的用户返回 false → 全页降级为组数口径 */
export function hasWeightData(items: LoadItem[]): boolean {
  return items.some((i) => i.sets.some((s) => s.weight !== undefined && s.reps !== undefined));
}

/** date → 当天总组数（热力图深浅） */
export function dailyLoad(items: LoadItem[], from: string, to: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of inRange(items, from, to)) {
    m.set(i.date, (m.get(i.date) ?? 0) + i.sets.length);
  }
  return m;
}

function pct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

export function compare(
  items: LoadItem[],
  dates: string[],
  cur: Range,
  prev: Range,
): { days: Delta; sets: Delta; volumeKg: Delta } {
  const a = totals(inRange(items, cur.from, cur.to), dates.filter((d) => d >= cur.from && d <= cur.to));
  const b = totals(inRange(items, prev.from, prev.to), dates.filter((d) => d >= prev.from && d <= prev.to));
  return {
    days: { cur: a.days, prev: b.days, pct: pct(a.days, b.days) },
    sets: { cur: a.sets, prev: b.sets, pct: pct(a.sets, b.sets) },
    volumeKg: { cur: a.volumeKg, prev: b.volumeKg, pct: pct(a.volumeKg, b.volumeKg) },
  };
}

/** Epley 估算 1RM。重量或次数缺失/非正 → 0（绝不返回 NaN，NaN 进 Chart.js 会画出断线） */
export function estimate1RM(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps > 0)) return 0;
  return weight * (1 + reps / 30);
}

export interface PrRow {
  exerciseId: string;
  name: string;
  bodyPart: BodyPart;
  e1rm: number;
  weight: number;
  reps: number;
  date: string;
}

/** 每个动作的历史最佳 e1RM，按 e1RM 降序。抗稀疏：只要有一组带重量就有一行，永远画不出空图 */
export function prsByExercise(items: LoadItem[], exMap: ExMap): PrRow[] {
  const best = new Map<string, PrRow>();
  for (const item of items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;
    for (const s of item.sets) {
      if (s.weight === undefined || s.reps === undefined) continue;
      const e1rm = estimate1RM(s.weight, s.reps);
      if (e1rm === 0) continue;
      const cur = best.get(item.exerciseId);
      if (!cur || e1rm > cur.e1rm) {
        best.set(item.exerciseId, {
          exerciseId: item.exerciseId,
          name: ex.name,
          bodyPart: ex.bodyPart,
          e1rm,
          weight: s.weight,
          reps: s.reps,
          date: item.date,
        });
      }
    }
  }
  return [...best.values()].sort((a, b) => b.e1rm - a.e1rm);
}

/** 某动作每日最大 e1RM，日期升序 */
export function e1rmSeries(items: LoadItem[], exerciseId: string): { date: string; e1rm: number }[] {
  const byDate = new Map<string, number>();
  for (const item of items) {
    if (item.exerciseId !== exerciseId) continue;
    for (const s of item.sets) {
      if (s.weight === undefined || s.reps === undefined) continue;
      const e1rm = estimate1RM(s.weight, s.reps);
      if (e1rm === 0) continue;
      const cur = byDate.get(item.date);
      if (cur === undefined || e1rm > cur) byDate.set(item.date, e1rm);
    }
  }
  return [...byDate.entries()]
    .map(([date, e1rm]) => ({ date, e1rm }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 按「有 e1RM 数据的训练日数」降序的动作 id。默认动作靠它选，不再靠 Map 迭代顺序随机取 */
export function topExerciseIds(items: LoadItem[], limit: number): string[] {
  const days = new Map<string, Set<string>>();
  for (const item of items) {
    const usable = item.sets.some((s) => s.weight !== undefined && s.reps !== undefined);
    if (!usable) continue;
    if (!days.has(item.exerciseId)) days.set(item.exerciseId, new Set());
    days.get(item.exerciseId)!.add(item.date);
  }
  return [...days.entries()]
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

export function setsByBodyPart(items: LoadItem[], exMap: ExMap): Record<BodyPart, number> {
  const out = Object.fromEntries(BODY_PARTS.map((p) => [p.id, 0])) as Record<BodyPart, number>;
  for (const item of items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;
    out[ex.bodyPart] += item.sets.length;
  }
  return out;
}

/** 距上次练该部位的天数；从未练过 → null（「背已经 12 天没练了」靠它） */
export function lastTrainedByBodyPart(
  items: LoadItem[],
  exMap: ExMap,
  today: string,
): Record<BodyPart, number | null> {
  const last = Object.fromEntries(BODY_PARTS.map((p) => [p.id, null])) as Record<
    BodyPart,
    number | null
  >;
  const latest = new Map<BodyPart, string>();
  for (const item of items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;
    const cur = latest.get(ex.bodyPart);
    if (cur === undefined || item.date > cur) latest.set(ex.bodyPart, item.date);
  }
  for (const [part, date] of latest) last[part] = daysBetween(date, today);
  return last;
}

export function longestStreak(dates: string[]): number {
  const sorted = [...new Set(dates)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && daysBetween(prev, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

export interface DayPartLoad {
  part: BodyPart;
  sets: number;
}

/** 每天的主练部位（组数最多者；并列取 BODY_PARTS 顺序靠前者）+ 当天总组数。
    日历格上色和年度海报热力图共用这一个函数——两处颜色规则必须完全一致 */
export function dailyPartLoad(items: LoadItem[], exMap: ExMap): Map<string, DayPartLoad> {
  const perDay = new Map<string, Map<BodyPart, number>>();
  for (const item of items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;
    if (!perDay.has(item.date)) perDay.set(item.date, new Map());
    const bucket = perDay.get(item.date)!;
    bucket.set(ex.bodyPart, (bucket.get(ex.bodyPart) ?? 0) + item.sets.length);
  }
  const order = BODY_PARTS.map((p) => p.id);
  const out = new Map<string, DayPartLoad>();
  for (const [date, bucket] of perDay) {
    let winner: BodyPart | null = null;
    let total = 0;
    for (const [part, n] of bucket) {
      total += n;
      if (
        winner === null ||
        n > bucket.get(winner)! ||
        (n === bucket.get(winner)! && order.indexOf(part) < order.indexOf(winner))
      ) {
        winner = part;
      }
    }
    if (winner !== null) out.set(date, { part: winner, sets: total });
  }
  return out;
}

/** 线性插值分位数。空数组返回 0——海报热力图的 maxSets 靠它防 0 除 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** 有数据的年份，降序（海报年份切换器用） */
export function yearsWithData(dates: string[]): number[] {
  return [...new Set(dates.map((d) => Number(d.slice(0, 4))))].sort((a, b) => b - a);
}

/** 按自然日开窗的移动平均。
    旧的 movingAverage 按记录序号开窗——隔了 30 天的两次称重会被当成相邻点互相平滑，是 bug */
export function dailyMovingAverage(
  series: { date: string; value: number }[],
  windowDays: number,
): { date: string; value: number }[] {
  const w = Math.max(1, windowDays);
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((point, i) => {
    const from = addDays(point.date, -(w - 1));
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0; j--) {
      if (sorted[j].date < from) break;
      sum += sorted[j].value;
      n += 1;
    }
    return { date: point.date, value: sum / n };
  });
}
```

`src/lib/stats.ts` 顶部的 import 改成：

```ts
import { BODY_PARTS } from '../data/bodyParts';
import { addDays, parseDate, weekStartOf } from './dates';
import type { BodyPart, Exercise, SetEntry } from './types';
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/ericlu/fitness-app-v2 && npx vitest run src/lib/stats.test.ts 2>&1 | tail -10
```

Expected: 全绿，测试数明显多于改动前。

- [ ] **Step 5: Commit**

```bash
cd /Users/ericlu/fitness-app-v2 && git add src/lib/stats.ts src/lib/stats.test.ts && git commit -m "feat(stats): 数据页 v2 的纯函数（环比/PR/e1RM/热力图/自然日均线）"
```

---

### Task 0.5: lib/platform.ts —— 平台能力探测（TDD）

**BLOCKER B6 的地基。** iOS WebKit 里 `onClick → await toBlob → navigator.share()` 会因 transient activation 失效而抛 `NotAllowedError`——**分享调用栈内不得出现任何 `await`**。另外 jsdom 里 `navigator.vibrate` 不存在，直接调会让 7 个 LogFlow 测试变红。

**Files:**
- Create: `src/lib/platform.ts`
- Create: `src/lib/platform.test.ts`

- [ ] **Step 1: 先写失败的测试**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, shareFiles, vibrate } from './platform';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vibrate', () => {
  it('jsdom 里没有 navigator.vibrate 时静默跳过，不抛', () => {
    expect(() => vibrate(10)).not.toThrow();
  });

  it('有 vibrate 时透传时长', () => {
    const spy = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate: spy });
    vibrate(30);
    expect(spy).toHaveBeenCalledWith(30);
  });

  it('vibrate 抛异常时吞掉（某些浏览器在无用户手势时抛）', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      vibrate: () => {
        throw new Error('no gesture');
      },
    });
    expect(() => vibrate(10)).not.toThrow();
  });
});

describe('canShareFiles', () => {
  const file = new File(['x'], 'a.png', { type: 'image/png' });

  it('没有 navigator.share 时为 false', () => {
    expect(canShareFiles([file])).toBe(false);
  });

  it('有 share 但没有 canShare 时为 false（Android 老版本会假阳性）', () => {
    vi.stubGlobal('navigator', { ...navigator, share: vi.fn() });
    expect(canShareFiles([file])).toBe(false);
  });

  it('share + canShare 且 canShare 返回 true 时为 true', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: vi.fn(),
      canShare: () => true,
    });
    expect(canShareFiles([file])).toBe(true);
  });

  it('canShare 抛异常时为 false，不冒泡', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      share: vi.fn(),
      canShare: () => {
        throw new TypeError('bad');
      },
    });
    expect(canShareFiles([file])).toBe(false);
  });
});

describe('shareFiles', () => {
  it('同步调用 navigator.share —— 调用栈里不能有 await，否则 iOS 丢失用户手势授权', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, share, canShare: () => true });
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    const returned = shareFiles([file], '铁证');

    // 关键断言：shareFiles 返回时 share 必须已经被调用过（同步），而不是在某个 await 之后
    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].files[0]).toBe(file);
    expect(returned).toBe(true);
  });

  it('不支持时返回 false，不抛', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(shareFiles([file], '铁证')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/ericlu/fitness-app-v2 && npx vitest run src/lib/platform.test.ts 2>&1 | tail -10
```

Expected: FAIL —— `Failed to resolve import "./platform"`。

- [ ] **Step 3: 实现**

`src/lib/platform.ts`：

```ts
import { log } from './logger';

/** 震动。jsdom / 桌面浏览器没有 vibrate；无用户手势时部分浏览器还会抛。一律静默 */
export function vibrate(ms: number): void {
  const nav = navigator as Navigator & { vibrate?: (p: number) => boolean };
  if (typeof nav.vibrate !== 'function') return;
  try {
    nav.vibrate(ms);
  } catch {
    /* 无手势时抛 —— 震动失败不该影响业务 */
  }
}

type ShareNav = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

/** 能否分享文件。必须同时有 share 和 canShare —— 只有 share 的老 Android 会在传 files 时静默失败 */
export function canShareFiles(files: File[]): boolean {
  const nav = navigator as ShareNav;
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * 同步发起文件分享。
 *
 * 返回 boolean 而不是 Promise，是为了在调用点强制「无 await」：
 * iOS WebKit 的 transient activation 只在用户手势的同步调用栈里有效，
 * 一旦 `await toBlob()` 再调 share，授权已失效 → NotAllowedError。
 * 所以 blob 必须提前备好，onClick 里只能同步取用。
 */
export function shareFiles(files: File[], title: string): boolean {
  if (!canShareFiles(files)) return false;
  const nav = navigator as ShareNav;
  try {
    void nav.share!({ files, title }).catch((err: unknown) => {
      // 用户取消分享面板会 reject AbortError —— 不是错误
      if (err instanceof Error && err.name === 'AbortError') return;
      log(`share: ${String(err)}`);
    });
    return true;
  } catch (err) {
    log(`share sync: ${String(err)}`);
    return false;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd /Users/ericlu/fitness-app-v2 && npx vitest run src/lib/platform.test.ts 2>&1 | tail -10
```

Expected: 8 passed。

- [ ] **Step 5: Commit**

```bash
cd /Users/ericlu/fitness-app-v2 && git add src/lib/platform.ts src/lib/platform.test.ts && git commit -m "feat(platform): 能力探测——同步 share（保住 iOS 用户手势）+ 安全 vibrate"
```

---

### Task 0.6: 三个品牌原子组件（TDD）

**Files:**
- Create: `src/components/Stamp.tsx`
- Create: `src/components/PartIcon.tsx`
- Create: `src/components/ForgeRing.tsx`
- Create: `src/components/Stamp.test.tsx`
- Create: `src/components/PartIcon.test.tsx`
- Read first: `docs/design-cards/brand/tokens.html`、`docs/design-cards/brand/icons.html`

- [ ] **Step 1: 先写失败的测试**

`src/components/Stamp.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stamp } from './Stamp';

describe('Stamp', () => {
  it('渲染「铁」字', () => {
    render(<Stamp size={96} />);
    expect(screen.getByText('铁')).toBeInTheDocument();
  });

  it('装饰性使用时对读屏隐藏', () => {
    const { container } = render(<Stamp size={96} decorative />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('非装饰时有可读标签', () => {
    render(<Stamp size={96} />);
    expect(screen.getByLabelText('铁证')).toBeInTheDocument();
  });
});
```

`src/components/PartIcon.test.tsx`：

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BODY_PARTS } from '../data/bodyParts';
import { PartIcon } from './PartIcon';

describe('PartIcon', () => {
  it('7 个部位每个都有图标，且用自己的部位色描边', () => {
    for (const p of BODY_PARTS) {
      const { container } = render(<PartIcon part={p.id} size={24} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
      // 部位色必须出现在 svg 内部（stroke 硬编码为部位色）
      expect(container.innerHTML.toUpperCase()).toContain(p.color.toUpperCase());
    }
  });

  it('可覆盖描边色（TabBar 里用 currentColor）', () => {
    const { container } = render(<PartIcon part="chest" size={24} color="currentColor" />);
    expect(container.querySelector('svg')!.innerHTML).toContain('currentColor');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/ericlu/fitness-app-v2 && npx vitest run src/components/Stamp.test.tsx src/components/PartIcon.test.tsx 2>&1 | tail -8
```

Expected: FAIL —— 两个模块都不存在。

- [ ] **Step 3: 实现 Stamp**

`src/components/Stamp.tsx`（尺寸从 `docs/design-cards/brand/tokens.html` 的 `.stamp` 换算：96px 时 border 3.5px / radius 18px / 字号 52px，其余按比例缩放）：

```tsx
interface Props {
  size: number;
  /** 落章动画（打卡完成时） */
  animate?: boolean;
  /** 纯装饰时对读屏隐藏 */
  decorative?: boolean;
}

/** 品牌钢印。打卡 = 盖钢印，这是整个产品的核心隐喻 */
export function Stamp({ size, animate = false, decorative = false }: Props) {
  const k = size / 96; // 96 是 design card 的基准尺寸
  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center ${animate ? 'animate-stamp-in' : ''}`}
      style={{
        width: size,
        height: size,
        border: `${3.5 * k}px solid var(--color-iron)`,
        borderRadius: 18 * k,
        transform: 'rotate(-6deg)',
        boxShadow: `0 0 ${34 * k}px rgba(255,92,31,.35), inset 0 0 ${18 * k}px rgba(255,92,31,.18)`,
      }}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : '铁证'}
      role={decorative ? undefined : 'img'}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          inset: 5 * k,
          border: `1px dashed rgba(255,92,31,.45)`,
          borderRadius: 12 * k,
        }}
      />
      <span
        className="leading-none font-black text-iron"
        style={{ fontSize: 52 * k }}
      >
        铁
      </span>
    </div>
  );
}
```

- [ ] **Step 4: 实现 PartIcon**

`src/components/PartIcon.tsx` —— 图标路径逐字取自 `docs/design-cards/brand/icons.html`（若与此处有出入，**以卡片为准**）。统一 `fill="none"` / `stroke-width="1.8"` / 圆头圆角：

```tsx
import { bodyPartInfo } from '../data/bodyParts';
import type { BodyPart } from '../lib/types';

const PATHS: Record<BodyPart, string> = {
  chest: 'M4 8c2-2 5-2 8 1 3-3 6-3 8-1 0 6-4 9-8 11C8 17 4 14 4 8Z',
  shoulder: 'M12 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM5 20c0-4 3-6 7-6s7 2 7 6',
  back: 'M12 3v18M7 6l5-3 5 3M6 11h12M7 16h10',
  leg: 'M9 3v7l-2 11M15 3v7l2 11M9 10h6',
  arm: 'M6 6h6a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H6M16 9h3v6h-3',
  core: 'M12 3v18M8 7h8M7 12h10M8 17h8',
  cardio: 'M20 8a4 4 0 0 0-8-1 4 4 0 0 0-8 1c0 5 8 9 8 9s8-4 8-9Z',
};

interface Props {
  part: BodyPart;
  size?: number;
  /** 覆盖描边色。默认用部位色；TabBar 等场景传 'currentColor' */
  color?: string;
}

export function PartIcon({ part, size = 24, color }: Props) {
  const stroke = color ?? bodyPartInfo(part).color;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[part]} />
    </svg>
  );
}

export type NavIcon = 'today' | 'calendar' | 'stats' | 'profile';

const NAV_PATHS: Record<NavIcon, string> = {
  // 「今日」= 倾斜的钢印（与品牌隐喻同源）
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  stats: 'M5 20V10M12 20V4M19 20v-7',
  profile: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c0-4 4-6 8-6s8 2 8 6',
  today: '',
};

export function NavGlyph({ icon, size = 24 }: { icon: NavIcon; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (icon === 'today') {
    return (
      <svg {...common}>
        <rect x="5" y="4" width="14" height="14" rx="3" transform="rotate(-6 12 11)" />
        <path d="M9 11.2l2 2 4-4.2" />
        <path d="M7 21h10" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d={NAV_PATHS[icon]} />
    </svg>
  );
}
```

- [ ] **Step 5: 改 ProgressRing 的两处硬编码旧色（只改颜色，不动几何）**

`ProgressRing.tsx` 里写死了 `#FF8C42`（渐变末端）和 `#2C2C2E`（底环）——都是旧配色。不改的话今日页的 Hero 环会是全 app 唯一还用旧橙的地方。

**它的 4 个测试只断言 `stroke-dashoffset` 几何，零颜色断言** → 改色不会让任何测试变红。**只改这两行，其余一律不动**（`ForgeRing` 要复用它已测过的 dashoffset 计算）。

`src/components/ProgressRing.tsx:20`：
```tsx
            <stop offset="100%" stopColor="#FFB340" />
```

`src/components/ProgressRing.tsx:23`：
```tsx
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1A1A1D" strokeWidth={stroke} />
```

- [ ] **Step 6: 实现 ForgeRing**

`src/components/ForgeRing.tsx` —— **必须复用 `ProgressRing`**，不得删除它。

`ProgressRing` 的真实签名（已核实）是 `{ value, max, size?, stroke?, children? }`——**注意是 `max` 不是 `goal`**，且它自带居中的 `children` 插槽，所以不需要再套一层绝对定位：

```tsx
import { ProgressRing } from './ProgressRing';
import { Stamp } from './Stamp';

interface Props {
  value: number;
  goal: number;
  size?: number;
}

/** 周目标进度环：环由 ProgressRing 画（沿用它已测过的 dashoffset 计算），
    中心插槽在达标时换成落章钢印——把「完成」变成一个可以被看见的动作 */
export function ForgeRing({ value, goal, size = 160 }: Props) {
  const done = goal > 0 && value >= goal;
  return (
    <ProgressRing value={value} max={goal} size={size} stroke={12}>
      {done ? (
        <Stamp size={size * 0.44} animate decorative />
      ) : (
        <>
          <span className="display text-4xl leading-none text-ink">{value}</span>
          <span className="mt-1 text-xs text-mute">/ {goal} 练</span>
        </>
      )}
    </ProgressRing>
  );
}
```

- [ ] **Step 7: 跑测试确认通过**

```bash
cd /Users/ericlu/fitness-app-v2 && npx vitest run src/components 2>&1 | tail -10
```

Expected: 全绿（含原有的 `ProgressRing.test` 4 个——改色后它们必须仍然绿，绿不了说明动到了几何）。

- [ ] **Step 8: Commit**

```bash
cd /Users/ericlu/fitness-app-v2 && git add src/components/Stamp.tsx src/components/PartIcon.tsx src/components/ForgeRing.tsx src/components/ProgressRing.tsx src/components/Stamp.test.tsx src/components/PartIcon.test.tsx && git commit -m "feat(brand): 钢印 / 部位图标 / 锻造进度环"
```

---

### Task 0.7: 测试 helper —— completeOnboarding

**BLOCKER B3 复述：重写 Onboarding 和「117 个测试全绿」互斥。** `App.test.tsx` 的 3 个测试都靠 `findByText('开始第一次打卡')` 穿过引导页；4 步流程下这个按钮在第 4 屏。先把穿透逻辑收进 helper，阶段 1 的 Agent F 再改 Onboarding 本体。

**Files:**
- Create: `src/test/helpers.ts`

- [ ] **Step 1: 写 helper**

```ts
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * 穿过 4 步首启引导，停在 `/log`。
 *
 * 引导页的四屏是**全部挂载 + translateX 位移**（不是条件渲染），非当前屏带 inert + aria-hidden。
 * Testing Library 的 getByRole 默认忽略 aria-hidden 子树，所以下面每一步拿到的都只会是当前屏的按钮。
 */
export async function completeOnboarding(user: UserEvent): Promise<void> {
  // 第 1 屏：品牌 —— 「开始」
  await user.click(await screen.findByRole('button', { name: '开始' }));
  // 第 2 屏：本地优先 —— 「继续」
  await user.click(await screen.findByRole('button', { name: '继续' }));
  // 第 3 屏：海报 —— 「继续」
  await user.click(await screen.findByRole('button', { name: '继续' }));
  // 第 4 屏：设周目标 —— 「开始第一次打卡」（这句文案必须保留，是 3 个 App 测试的锚点）
  await user.click(await screen.findByRole('button', { name: '开始第一次打卡' }));
}
```

- [ ] **Step 2: 暂不跑测试。** 此时 Onboarding 还是旧的单屏版，helper 会失败——这是预期的。Agent F 在阶段 1 里会同时改 `Onboarding.tsx` 和 `App.test.tsx`，届时 helper 才生效。

> **给 Agent F 的契约（不可改）**：四屏按钮的可访问名依次是 `开始` → `继续` → `继续` → `开始第一次打卡`。改了任何一个，就必须同步改这个 helper。

- [ ] **Step 3: Commit**

```bash
cd /Users/ericlu/fitness-app-v2 && git add src/test/helpers.ts && git commit -m "test: 4 步引导的测试穿透器 completeOnboarding"
```

---

### Task 0.8: App.tsx —— 噪点层 + /poster 路由

`/poster` 的实现权归 Agent F，但 `App.tsx` 归阶段 0。所以阶段 0 先建一个**最小可编译的 PosterScreen stub**，让 tsc 过；Agent F 再把它实现完。

**Files:**
- Create: `src/screens/poster/PosterScreen.tsx`（stub，Agent F 接手）
- Modify: `src/App.tsx`

- [ ] **Step 1: 建 PosterScreen stub**

```tsx
/** 阶段 0 的可编译占位。实现权归阶段 1 的 Agent F（月度/年度海报预览 + 本地导出）。 */
export function PosterScreen() {
  return <div data-testid="poster-screen" />;
}
```

- [ ] **Step 2: 改 App.tsx**

```tsx
import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ErrorBoundary } from './components/ErrorBoundary';
import { InstallHint } from './components/InstallHint';
import { UpdateToast } from './components/UpdateToast';
import { TabBar } from './components/TabBar';
import { CalendarScreen } from './screens/calendar/CalendarScreen';
import { DayDetailScreen } from './screens/calendar/DayDetailScreen';
import { LogFlow } from './screens/log/LogFlow';
import { PosterScreen } from './screens/poster/PosterScreen';
import { ProfileScreen } from './screens/profile/ProfileScreen';
import { StatsScreen } from './screens/stats/StatsScreen';
import { TodayScreen } from './screens/today/TodayScreen';
import { Onboarding } from './screens/Onboarding';
import { getProfile } from './repos/profileRepo';

function TabLayout() {
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-24 pt-[env(safe-area-inset-top)]">
      <Outlet />
      <TabBar />
    </div>
  );
}

/** 引导门：置于 Routes 外统一生效，未引导时任何路由（含 /log、/day/:date）都进不去 */
function OnboardingGate() {
  const profile = useLiveQuery(() => getProfile(), []);
  if (!profile) return null;
  if (!profile.onboarded) return <Onboarding />;
  return (
    <Routes>
      <Route path="/log" element={<LogFlow />} />
      <Route path="/day/:date" element={<DayDetailScreen />} />
      <Route path="/poster" element={<PosterScreen />} />
      <Route element={<TabLayout />}>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/calendar" element={<CalendarScreen />} />
        <Route path="/stats" element={<StatsScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      {/* 全屏噪点：锻造质感的来源，pointer-events:none 不挡交互 */}
      <div className="grain" aria-hidden />
      <UpdateToast />
      <InstallHint />
      <HashRouter>
        <OnboardingGate />
      </HashRouter>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 3: 跑全量测试 + 类型检查**

```bash
cd /Users/ericlu/fitness-app-v2 && npx tsc --noEmit && npm test 2>&1 | tail -12
```

Expected: tsc 无输出；测试全绿（≥ 117 + 新增的 stats/platform/组件测试）。

- [ ] **Step 4: Commit**

```bash
cd /Users/ericlu/fitness-app-v2 && git add src/App.tsx src/screens/poster/PosterScreen.tsx && git commit -m "feat(app): 全屏噪点层 + /poster 路由（PosterScreen 占位）"
```

---

## ✋ 阶段 0 → 阶段 1 的 Gate（不过不许 fan-out）

```bash
cd /Users/ericlu/fitness-app-v2 && npx tsc --noEmit && npm test && npm run build && git push origin main
```

四项全过才允许启动阶段 1。任何一项红，先修，别 fan-out——6 个 agent 在坏地基上并行改，冲突排查成本是线性的 6 倍。

---

# 阶段 1（并行 · 6 agent · 文件所有权互斥）

**每个 agent 的通用契约（写进每个 agent 的 prompt）：**

1. **先读你那张 design card**（`docs/design-cards/**`）。卡片是像素级母版，**与本计划的文字描述冲突时以卡片为准**。
2. **只改你名下的文件。** 禁止碰 `src/styles/theme.css` / `src/App.tsx` / `src/data/bodyParts.ts` / `src/lib/stats.ts` / `src/lib/platform.ts` / `src/components/Stamp.tsx` / `src/components/PartIcon.tsx` / `src/components/ForgeRing.tsx`。缺 token 或缺函数就在返回结果里报告，**不要自己动手改共享文件**。
3. **可用的新料**：`.etch`（蚀刻分隔线，取代卡片）、`.display`（Anton 压缩体，**只能包纯数字/单位的 span，中文另起 span**）、`.heat` / `.heat-text`（渐变）、`bg-raised`、`text-amber`、`<Stamp>`、`<PartIcon>`、`<NavGlyph>`、`<ForgeRing>`。
4. **清掉 `bg-card2` / `text-iron2` / `border-iron2`**：`card2` → `bg-raised`，`iron2` → `text-amber`。你名下的文件里必须清零。
5. **TDD**：改行为前先改/加测试；跑 `npx vitest run <你的测试文件>` 见红，再实现，再见绿。
6. **逐字保留**下列文案（现有测试的锚点，改一个字就红）：
   - Today：`体重 kg` / `记录` / `体重需在 20–300kg 之间` / `+ 开始今日训练` / `+ 继续加练`
   - Calendar：`${y}年${m}月`（如 `2026年7月`）
   - Profile：`导出 CSV` / `导出 JSON` / `导出失败，请重试`
   - `aria-label`：`上个月` / `下个月` / `减少目标` / `增加目标`
7. **交付前自查**：`npx tsc --noEmit` + `npx vitest run <你名下的测试>` 全绿。
8. **不要 commit、不要 push。** 主 agent 统一验收后一次性提交。

---

### Agent A — 今日页

**Files（独占）:** `src/screens/today/TodayScreen.tsx`、`src/screens/today/TodayScreen.test.tsx`、`src/components/PhotoCard.tsx`、`src/components/SetRows.tsx`
**必读:** `docs/design-cards/screens/today.html`

**BLOCKER B4：v1 规格漏掉了 `<WeightQuickEntry>` 和 `<PhotoCard>`。** `WeightQuickEntry` 是**全 app 唯一的体重录入口**，删了它体重趋势图就永远没数据。照 v1 字面重写会静默删功能，且 `TodayScreen.test` 6 个测试全红。

- [ ] **Step 1** 读卡片 `today.html` + 现有 `TodayScreen.tsx` + `TodayScreen.test.tsx`
- [ ] **Step 2** 改造：
  - 顶部品牌行：`<Stamp size={28} decorative />` + 「铁证」字标 + 右侧日期（`formatToday`）
  - Hero 换 `<ForgeRing value={weekProgress(...)} goal={profile.weeklyGoal} />`
  - 今日已练部位：横排 `<PartIcon part={p} size={20} />` + 部位名 + 组数
  - **保留** `<WeightQuickEntry>`（文案逐字：`体重 kg` / `记录` / `体重需在 20–300kg 之间`）和 `<PhotoCard>`
  - **保留** CTA 文案：无记录时 `+ 开始今日训练`，有记录时 `+ 继续加练`
  - 卡片 → `.etch` 分隔；`bg-card2` → `bg-raised`
  - 大数字用 `<span className="display">`，中文单位另起 `<span>`
- [ ] **Step 3** `npx vitest run src/screens/today` 全绿（6 个原有测试一个都不能少）
- [ ] **Step 4** `grep -n "card2\|iron2" src/screens/today src/components/PhotoCard.tsx src/components/SetRows.tsx` → 无输出

---

### Agent B — 日历页

**Files（独占）:** `src/screens/calendar/CalendarScreen.tsx`、`src/screens/calendar/DayDetailScreen.tsx`、对应 test、`src/components/HeatGrid.tsx`（新建）
**必读:** `docs/design-cards/screens/calendar.html`

**用户原话：「日历页面也比较简洁，不能一眼看到练的什么部位」。** 这是本 agent 的唯一 KPI。

- [ ] **Step 1** 读卡片 + 现有两个 screen + 两个 test
- [ ] **Step 2** 改造：
  - 每个训练日的格子上色 = **当天主练部位色**，用阶段 0 的 `dailyPartLoad(items, exMap)`（**日历和年度海报必须共用这一个函数**，否则两处颜色规则会漂移）
  - 深浅 = 当天组数：`alpha = 0.35 + 0.65 * min(1, sets / maxSets)`，`maxSets = Math.max(1, percentile(当月各日组数, 90))`
  - 格子右下角叠一个 `<PartIcon size={10}>`，让"练了什么"不必靠记颜色
  - 底部图例：7 个部位色点 + 名称
  - 月标题保留 `${y}年${m}月` 文本（测试锚点）；视觉大字用 `aria-hidden`，另加 `<h1 className="sr-only">{y}年{m}月</h1>`
  - 保留 `aria-label`：`上个月` / `下个月`
  - `DayDetailScreen`：卡片 → `.etch`；`--color-line` 变淡后边框会几乎消失，改用 `.etch` 分隔而不是 `border`
  - `HeatGrid.tsx`：把「按日期渲染带部位色的格子网格」抽成组件，日历页和数据页热力图共用
- [ ] **Step 3** `npx vitest run src/screens/calendar` 全绿（`DayDetailScreen.test` 5 个测试文案逐字不变）
- [ ] **Step 4** `grep -n "card2\|iron2" src/screens/calendar` → 无输出

---

### Agent C — 数据页（工作量最大）

**Files（独占）:** `src/screens/stats/StatsScreen.tsx`、`src/screens/stats/*.test.tsx`、`src/components/charts.tsx`、`src/components/charts.test.tsx`、`src/components/PhotoTimeline.tsx`
**必读:** `docs/design-cards/screens/stats.html`、v2 规格 §1 全文

**根因：整页是「能力驱动」而非「问题驱动」——`stats.ts` 能算什么就画什么。** 四个病灶：①30/90/365 分段是**假控件**（只作用于雷达图，点了页面几乎不动）②稀疏数据下每张图都像 bug（雷达图 7 轴 5 轴为 0 的畸形三角、12 周柱状图 11 根空柱、力量曲线默认动作**本质随机**）③只记组数不记重量的用户，总容量恒为 0、力量曲线整块消失 ④「我在变强吗」「我这个月比上个月强吗」零回答。

**KILL：雷达图、`<select>` 下拉式力量曲线、局部 30/90/365 分段。**

- [ ] **Step 1** 读卡片 + v2 规格 §1 + 现有 `StatsScreen.tsx`（211 行）+ `src/lib/stats.ts` 的新函数签名
- [ ] **Step 2** 按这个版式重建（自上而下）：
  1. 页头：标题「数据」+ **全局时间分段「本周 / 本月 / 今年 / 全部」**（`Segment`）。**它必须驱动下面每一个区块**——这是修「假控件」的核心
  2. Hero 三数：连续 N 天（`currentStreak`，`.heat-text`）/ 本区间打卡 X 天 · 目标达成率 / 本区间有效组数（`hasWeightData` 为 true 时并列容量 t）
  3. **训练热力图**（复用 Agent B 的 `HeatGrid`，若尚未就绪则自己画格子，接口对齐 `dailyLoad`）→ 取代 12 周柱状图
  4. **环比卡**：`compare(items, dates, rangeOf(seg), prevRangeOf(...))` → 天数 / 组数 / 容量各带 Δ%（`pct === null` 时显示 `—`，**绝不显示 `Infinity%`**）
  5. **PR 榜**：`prsByExercise(items, exMap)` → 历史最佳 e1RM × 动作，本区间内创造的 PR 高亮。抗稀疏、永不空图
  6. **主力动作 e1RM 曲线**：`topExerciseIds(items, 6)` 出 chip 横滑（**杀掉 `<select>`**），默认选第一个（= 数据点最多的）；`e1rmSeries` 出线。**< 3 个有效训练日 → 整块降级为引导态**，不画只有 1 个点的折线
  7. **部位分布水平条**：`setsByBodyPart` 出长度、`lastTrainedByBodyPart` 出「N 天没练」，未练过的部位显示灰条 + 提示 → 取代雷达图
  8. 体重趋势：x 轴改为**距 from 的天数（linear scale）**而非 category（修不等距 bug，且不引入 `chartjs-adapter-date-fns` 新依赖）；均线用 `dailyMovingAverage(series, 7)`；**< 2 条记录不渲染**
  9. `<PhotoTimeline />`
  10. 海报入口 banner → `nav('/poster?kind=month&period=' + today.slice(0,7))`
- [ ] **Step 3** **分级空状态阶梯（渲染契约，必须实现且必须有测试）：**

| 数据量 | 渲染 |
|---|---|
| 0 次打卡 | 整页换**单张引导卡**，不渲染任何 chart |
| 1–2 次 | 只渲 Hero + 热力图 + PR 榜；趋势类显示「再练 N 次解锁」 |
| 有打卡但 `hasWeightData === false` | 容量/PR/e1RM **整体降级为组数口径** + 提示「填上重量和次数，解锁力量曲线」 |

- [ ] **Step 4** `charts.tsx`：`ChartJS.defaults.color` → `#8B8B85`、`borderColor` → `rgba(255,255,255,.07)`；不再导出 `Radar`（若无其它引用）；保留 `Line` / `MixedChart` 导出以免 `charts.test.tsx` 变孤儿——**先看 `charts.test.tsx` 断言了什么再动**
- [ ] **Step 5** 新建 `src/screens/stats/StatsScreen.test.tsx`，至少覆盖三种数据量下的渲染契约（0 次 / 1 次 / 只记组数）
- [ ] **Step 6** `npx vitest run src/screens/stats src/components/charts.test.tsx` 全绿
- [ ] **Step 7** `grep -n "card2\|iron2" src/screens/stats src/components/charts.tsx src/components/PhotoTimeline.tsx` → 无输出

---

### Agent D — 我的页

**Files（独占）:** `src/screens/profile/ProfileScreen.tsx`、`src/screens/profile/ProfileScreen.test.tsx`、`src/components/ExerciseManager.tsx`、`src/components/ExerciseManager.test.tsx`
**必读:** `docs/design-cards/screens/profile.html`

**用户原话：「【我的】部分做的不好」。** 现状是 4 张一模一样的圆角卡竖着堆，「云同步 · Phase 2 敬请期待」还占了首屏最重的位置——把一个**不存在的功能**放在最显眼处。

- [ ] **Step 1** 读卡片 + 现有 `ProfileScreen.tsx`（104 行）+ 其 test
- [ ] **Step 2** 改造：
  - 顶部**身份区**：`<Stamp size={64} />` + 「铁证 IRONPROOF」+ 铁龄（`总打卡天数` 天）+ 最长连续（`longestStreak(dates)` 天）—— 用 `.display` 大字
  - 「云同步 · Phase 2」**降级**为最底部一行淡字，不再占卡片
  - 每周目标 stepper：保留 `aria-label` `减少目标` / `增加目标`、保留 `{weeklyGoal} 练/周`、保留 ≤1 / ≥7 的 disabled
  - **新增海报入口行**：「导出训练海报 · 月度 / 年度」→ `/poster`
  - `<ExerciseManager />` 保留，卡片壳 → `.etch` 分隔
  - 数据导出：文案逐字保留 `导出 CSV` / `导出 JSON` / `导出失败，请重试`；保留 `exportingRef` 门闩
  - 页脚保留「铁证 IRONPROOF · 你练过的，都有铁证」
  - 全部 `bg-card2` → `bg-raised`
- [ ] **Step 3** `npx vitest run src/screens/profile src/components/ExerciseManager.test.tsx` 全绿
- [ ] **Step 4** `grep -n "card2\|iron2" src/screens/profile src/components/ExerciseManager.tsx` → 无输出

---

### Agent E — 记录流 + 外壳组件

**Files（独占）:** `src/screens/log/LogFlow.tsx`、`src/screens/log/LogFlow.test.tsx`、`src/components/TabBar.tsx`、`src/components/InstallHint.tsx`、`src/components/InstallHint.test.tsx`、`src/components/UpdateToast.tsx`
**必读:** `docs/design-cards/brand/icons.html`（nav 图标）、`docs/design-cards/brand/tokens.html`

**注意：`--color-line` 从 `#3a3a3c` 变成 `rgba(255,255,255,.07)` 后，`InstallHint` / `UpdateToast` 的边框会几乎消失** —— 必须改用 `bg-raised` + `.etch` 重新建立层次，否则这两个浮层会"融进背景"。

- [ ] **Step 1** 读卡片 + 4 个文件 + `LogFlow.test.tsx`（7 个测试）
- [ ] **Step 2** 改造：
  - `TabBar`：4 个图标换 `<NavGlyph icon="today|calendar|stats|profile" />`；选中态 = `text-iron` + 顶部 2px iron 短线；未选中 `text-mute`
  - `LogFlow` 部位 chip：`border 1.5px solid <partColor>` + `background <partColor>1a` + `radius 14px` + `padding 10px 18px`（选中态），配 `<PartIcon>`
  - `LogFlow` 完成打卡：`<Stamp animate>` 落章动画 + `vibrate(30)`（**必须走 `src/lib/platform.ts` 的 `vibrate`**，直接调 `navigator.vibrate` 会让 7 个 LogFlow 测试在 jsdom 里全红）
  - `InstallHint` / `UpdateToast`：`bg-raised` + `.etch`，不再依赖 `border-line`
  - `bg-card2` → `bg-raised`
- [ ] **Step 3** `npx vitest run src/screens/log src/components/InstallHint.test.tsx` 全绿（7 + N 个）
- [ ] **Step 4** `grep -n "card2\|iron2" src/screens/log src/components/TabBar.tsx src/components/InstallHint.tsx src/components/UpdateToast.tsx` → 无输出

---

### Agent F — 引导 + 海报（工作量第二大）

**Files（独占）:** `src/screens/Onboarding.tsx`、`src/screens/Onboarding.test.tsx`（新建）、`src/screens/poster/**`、`src/lib/poster/**`（新建）、`src/App.test.tsx`
**必读:** `docs/design-cards/screens/onboarding.html`、`docs/design-cards/poster/monthly.html`、v2 规格 §2 全文

#### F-1: 4 步引导

**BLOCKER B3：** `App.test.tsx` 的 3 个测试都 `findByText('开始第一次打卡')` 穿过引导。阶段 0 已备好 `src/test/helpers.ts` 的 `completeOnboarding(user)`。**先改 `App.test.tsx` 换成 helper（红）→ 再实现 4 步引导（绿）。**

四屏内容：
1. **品牌**：`<Stamp size={120} animate />` + 「你练过的，都有铁证。」→ 按钮 `开始`
2. **本地优先**：「数据存在你手机本地。无广告，无推销，照片不上传。」→ 按钮 `继续`
3. **海报**（用户明确要求「尤其是可以导出年度月度训练海报，要有一个介绍」）：一张海报缩略图 + 「每月、每年，把你练过的一切压成一张钢印海报。全程本地生成，照片不出手机。」→ 按钮 `继续`
4. **设周目标**：`GOALS = [3, 4, 5]` → 按钮 `开始第一次打卡`（**逐字**）

**渲染方式（硬要求）：四屏全部挂载 + `translateX` 位移**，不是条件渲染。非当前屏加 `inert` + `aria-hidden="true"`。理由：条件渲染会让「上一屏的按钮还在 DOM 里」这类假绿测试不可能出现，但也让转场动画做不了；全挂载 + inert 两者兼得，且 Testing Library 的 `getByRole` 默认忽略 `aria-hidden` 子树 → 测试拿到的永远是当前屏的按钮。

保留：`submittingRef` 门闩、`saveProfile({ weeklyGoal, onboarded: true })`、`nav('/log')`。
Logo 渐变里的 `#FF8C42` 改为 `#FFB340`（对齐 amber token）。

#### F-2: 海报引擎

```
src/lib/poster/
  tokens.ts        Canvas 读不到 CSS 变量 → 硬编码一份颜色/字号常量（与 theme.css 手工对齐）
  fonts.ts         ensurePosterFonts(timeoutMs = 3000) —— document.fonts.load('700 100px Anton')
  model.ts         buildMonthlyModel(raw) / buildYearlyModel(raw) → PosterModel（纯数据，无 ctx）
  layers.ts        纯 ctx 原语：drawBackdrop drawGrain drawHeader drawTitle drawEtch
                   drawHero drawMetrics drawSplit drawMonthGrid drawYearGrid drawFooter drawStamp
  monthly.ts       paintMonthly(ctx, model) —— 一串 layers 调用 + 一张 y 常量表
  yearly.ts        paintYearly(ctx, model)  —— 同上
  canvas.ts        唯一碰 DOM 的文件：renderPoster(model, kind, scale) → HTMLCanvasElement
                   exportBlob(canvas) → Promise<Blob>
```

**HIGH 修正（必须遵守）：**
- **海报在 jsdom 里一行都测不了**（没有 `getContext('2d')` / `toBlob` / `document.fonts` / `navigator.share`）。所以**强制两层拆分**：`model.ts` 是纯数据（单测全覆盖），`layers.ts` / `monthly.ts` / `yearly.ts` 只接受 `ctx` 参数（用 mock ctx spy 断言调用序列）。`canvas.ts` 不测。
- **Canvas 里没有 feTurbulence。** 噪点 = 128×128 离屏 canvas 生成一次 → `createPattern('repeat')` → `globalAlpha = 0.06` 铺满。**禁止逐像素 ImageData 铺满全图**（1170×2340 ≈ 11MB + 270 万次循环 → 旧 iPhone 白屏）。
- 导出 **2x 保底**（780×1560）；3x 可选并 `try/catch` 回退 2x。

**年度海报（390×780，hero = 打卡天数，用户拍板）y 常量表：**

| 元素 | 位置 |
|---|---|
| HEADER | 基线 48，右「ANNUAL PROOF」 |
| YEAR 标题 | Anton 88px + heat 渐变，基线 160；右侧「铁龄 IRON AGE / N 天」 |
| ETCH | y = 182 |
| **HERO** | Anton **120px 打卡天数**，基线 300 +「天 · 全年钢印」；右对齐「占全年 N%」 |
| METRICS | 三数 y 326–372（总组数 / 总容量 t / 最长连续 → amber） |
| ETCH | y = 390 |
| HEATMAP | 标题基线 412；月份刻度基线 430；GitHub 式 53/54 列 × 7 行网格 y 438–479（cell ≈ 4.79px，gap 1.2，列数按当年周数动态算）；图例基线 494 |
| ETCH | y = 510 |
| SPLIT | 100% 堆叠条 x36 y544 w318 h12 r6 + 两行色点图例 |
| ETCH | y = 612 |
| PEAK DAY | 「最猛的一天」y 624–670 |
| FOOTER | 钢印 x280 y674 size74；「你练过的，都有铁证。」基线 730；「TIEZHENG.PAGES.DEV · 本地生成 · 照片不上传」基线 748 |

**热力图上色（必须与日历页共用 `dailyPartLoad`）：** 未练格 `rgba(255,255,255,.045)`；已练格 = 当日主练部位色，`alpha = 0.35 + 0.65 * min(1, sets / maxSets)`，`maxSets = Math.max(1, percentile(该年单日组数, 90))`；已练格叠 0.5px 同色描边。

月度海报 390×693，版式以 `docs/design-cards/poster/monthly.html` 为像素母版。**月度和年度共用同一套 layers**——视觉一致性由代码保证。

**明确否决**：吨数具象化（"相当于 3 辆 SUV"）——廉价营销腔，违背锻造工业风的克制。

#### F-3: PosterScreen

**BLOCKER B6：iOS 分享**
```
进预览页 → useEffect 里异步 renderPoster + exportBlob → setBlob(blob)
「保存图片」onClick → 同步 shareFiles([new File([blob], 'tiezheng-2026.png', {type:'image/png'})], '铁证')
                    ↑ 调用栈内不得出现任何 await，否则 iOS transient activation 失效 → NotAllowedError
不支持 share files → 降级：全屏 <img src={objectUrl}> + 「长按图片 → 存储到照片」
```
（`<a download>` 在 iOS 上存不了相册，不要用它做降级。）

- 路由参数：`/poster?kind=month&period=2026-07`、`/poster?kind=year&period=2026`
- 顶部 segmented control「月度 / 年度」+ 期数切换（年份用 `yearsWithData(dates)`）
- **铁律 7：`workout.note` 绝不出现在海报任何位置。** 海报数据只来自 `dailyPartLoad` / `totals` / `longestStreak` / `prsByExercise` 这类聚合，**不读 note、不读 photo blob**。

- [ ] **Step 1** 读两张卡片 + v2 规格 §2 + `src/lib/stats.ts` 新函数签名 + `src/lib/platform.ts`
- [ ] **Step 2** 先改 `App.test.tsx`：3 处引导穿透换成 `await completeOnboarding(user)`（import 自 `../test/helpers`）→ 跑 → 红
- [ ] **Step 3** 实现 4 步 Onboarding → 跑 `npx vitest run src/App.test.tsx` → 绿
- [ ] **Step 4** TDD `src/lib/poster/model.ts`（先写 `model.test.ts`：0 次打卡、只记组数、跨年、闰年、`maxSets` 防 0 除、**断言 model 里不含 note 字段**）
- [ ] **Step 5** TDD `layers.ts` + `monthly.ts` + `yearly.ts`（mock ctx spy，断言 `fillText` 的调用序列与 y 坐标表一致）
- [ ] **Step 6** 实现 `canvas.ts` + `PosterScreen.tsx`（替换阶段 0 的 stub）
- [ ] **Step 7** `npx vitest run src/lib/poster src/screens/poster src/App.test.tsx` 全绿

---

# 阶段 2 —— 集成验收

- [ ] **Step 1: 全量门禁**

```bash
cd /Users/ericlu/fitness-app-v2 && npx tsc --noEmit && npm test && npm run build
```

Expected: tsc 无输出；测试全绿且**总数 > 117**；build 成功。

- [ ] **Step 2: 遗留 token 清零**

```bash
cd /Users/ericlu/fitness-app-v2 && grep -rn "card2\|iron2" src
```

Expected: 只剩 `src/styles/theme.css` 里的两行别名定义。**若为 0，把这两行别名从 `@theme` 里删掉再跑一遍全量门禁。**

- [ ] **Step 3: 零网络请求（铁律 7）**

```bash
cd /Users/ericlu/fitness-app-v2 && grep -rn "https\?://" dist/assets/*.css dist/assets/*.js 2>/dev/null | grep -v "tiezheng.pages.dev\|w3.org\|sourceMappingURL" | head
```

Expected: 无字体 CDN、无 Google Fonts、无任何第三方域名。

- [ ] **Step 4: PWA 预缓存清单里没有掉队的字体**

```bash
cd /Users/ericlu/fitness-app-v2 && ls dist/assets | grep -i "woff\|ttf" || echo "无独立字体文件 —— 已全部 base64 内联，符合预期"
```

Expected: `无独立字体文件`。

- [ ] **Step 5: 数据页三种数据量人工验收**（自动化测试之外的最后一道）

启 `npm run dev`，用三种账号状态各看一遍数据页：**0 次打卡** / **1 次打卡** / **只记组数不记重量**。三种都必须**无空图、无畸形图、无 `Infinity%`、无 `NaN`**。

- [ ] **Step 6: 提交并推送**

```bash
cd /Users/ericlu/fitness-app-v2
git add -A
git commit -m "feat: 锻造工业风重塑——品牌钢印、部位日历、数据页信息架构重做、4 步引导、月度/年度海报"
git push origin main
```

---

## 验收标准（对齐 v2 规格 §5）

- [ ] `npm test` 全绿，测试数 > 117
- [ ] `npx tsc --noEmit` 无错
- [ ] `npm run build` 通过
- [ ] `grep -rn "card2\|iron2" src` → 0（别名已删）
- [ ] **零新增网络请求**：字体 base64 内联、噪点 base64 内联、海报全本地
- [ ] 六个界面与 `docs/design-cards/**` 对应卡片视觉一致
- [ ] 数据页在 0 次 / 1 次 / 只记组数不记重量 三种数据下均无空图、无畸形图
- [ ] 首启引导 4 步走完，第 3 步明确介绍了月度/年度海报导出
- [ ] 海报里**不出现 `workout.note`**、不出现任何照片
- [ ] 日历页一眼能看出每天练的是什么部位
