# 铁证 IRONPROOF · Phase 1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付「铁证」Phase 1 单机完整版 —— 无需登录即可完整使用的本地优先健身打卡 PWA（记录流 / 日历 / 体重 / 图表 / 本地拍照 / 铁与暗 UI / Logo / iOS 可添加主屏）。

**Architecture:** Vite + React SPA，HashRouter（静态托管零配置回退）。数据全部落 IndexedDB（Dexie），软删除 `deletedAt` + `updatedAt` 毫秒时间戳，字段结构与 Phase 2 云端同构。UI 为 4 个底部 Tab + 全屏记录流，记录流草稿由 Zustand persist 兜底。纯逻辑（日期/统计/校验/导出/图片尺寸）全部 TDD；图表与拍照管道在浏览器手动验证。

**Tech Stack:** Vite 6 · React 19 · TypeScript 5 · Tailwind 4（@tailwindcss/vite + `@theme`）· Zustand 5（persist）· Dexie 4（EntityTable + dexie-react-hooks）· Chart.js 4（按需注册，react-chartjs-2）· vite-plugin-pwa + @vite-pwa/assets-generator · Vitest + jsdom + Testing Library + fake-indexeddb

**规格：** `docs/superpowers/specs/2026-07-08-tiezheng-fitness-app-design.md`（Phase 1 范围见 §5）

**执行须知：**
- 工作目录：`/Users/ericlu/fitness-app-v2`（已是 git 仓库，main 分支，暂无远程；远程仓库在 Task 20 创建）。
- 开始任何 UI 任务（Task 10–17）前，先读 `/Users/ericlu/.claude/skills/design-taste-frontend/SKILL.md`。
- 每个 Task 结束必须 commit。Task 20 建远程后才能 push。
- 测试基准日期事实：2026-07-08 是**周三**；`weekStartOf('2026-07-08') === '2026-07-06'`（周一起始）；`monthGrid('2026-07')` 首格为 `'2026-06-29'`、共 42 格。

---

## 文件结构总览

```
fitness-app-v2/
├── index.html                      # iOS meta 全家桶
├── package.json / tsconfig.json / vite.config.ts
├── pwa-assets.config.ts            # Task 18
├── public/logo.svg                 # Task 18（图标由生成器产出到 public/）
├── .github/workflows/ci.yml        # Task 20
├── docs/checklists/ios-device.md   # Task 20
└── src/
    ├── main.tsx / App.tsx / vite-env.d.ts
    ├── styles/theme.css            # 铁与暗 @theme 令牌
    ├── test/setup.ts / test/dbTestUtils.ts / test/pwaRegisterMock.ts
    ├── lib/                        # 纯逻辑：types dates ids validation db stats image logger exportData
    ├── data/bodyParts.ts / data/presetExercises.ts
    ├── repos/                      # workoutRepo weightRepo exerciseRepo photoRepo profileRepo
    ├── stores/logDraftStore.ts
    ├── components/                 # TabBar SetRows ProgressRing PhotoCard PhotoTimeline ErrorBoundary UpdateToast InstallHint charts
    └── screens/
        ├── today/TodayScreen.tsx
        ├── log/LogFlow.tsx
        ├── calendar/CalendarScreen.tsx + DayDetailScreen.tsx
        ├── stats/StatsScreen.tsx
        ├── profile/ProfileScreen.tsx + ExerciseManager.tsx
        └── Onboarding.tsx
```

测试与源文件同目录（`*.test.ts` / `*.test.tsx`）。

---

### Task 1: 脚手架与主题基座

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/vite-env.d.ts`, `src/styles/theme.css`, `src/test/setup.ts`, `src/main.tsx`, `src/App.tsx`, `src/App.test.tsx`

- [ ] **Step 1: 写 `package.json`**

```json
{
  "name": "tiezheng",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "icons": "pwa-assets-generator"
  },
  "dependencies": {
    "chart.js": "^4.4.9",
    "dexie": "^4.0.11",
    "dexie-react-hooks": "^1.1.7",
    "react": "^19.1.0",
    "react-chartjs-2": "^5.3.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.6.0",
    "zustand": "^5.0.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.8",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.1.6",
    "@types/react-dom": "^19.1.5",
    "@vite-pwa/assets-generator": "^1.0.0",
    "@vitejs/plugin-react": "^4.5.0",
    "fake-indexeddb": "^6.0.1",
    "jsdom": "^26.1.0",
    "tailwindcss": "^4.1.8",
    "typescript": "^5.8.3",
    "vite": "^6.3.5",
    "vite-plugin-pwa": "^1.0.0",
    "vitest": "^3.1.4"
  }
}
```

- [ ] **Step 2: 写 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts", "pwa-assets.config.ts"]
}
```

- [ ] **Step 3: 写 `vite.config.ts`**（PWA 插件 Task 19 才加）

```ts
/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    alias: {
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwaRegisterMock.ts', import.meta.url),
      ),
    },
  },
});
```

- [ ] **Step 4: 写 `src/test/setup.ts` 与 `src/test/pwaRegisterMock.ts`**

`src/test/setup.ts`：

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom 没有 matchMedia，InstallHint 等组件需要
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
```

`src/test/pwaRegisterMock.ts`（Task 19 引入 virtual 模块后测试仍可跑）：

```ts
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as const,
    offlineReady: [false, () => {}] as const,
    updateServiceWorker: async () => {},
  };
}
```

- [ ] **Step 5: 写 `index.html`**（iOS meta 全家桶；图标 link 在 Task 18 补）

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0A0A0B" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="铁证" />
    <meta name="description" content="铁证 IRONPROOF —— 你练过的，都有铁证。训练、体重、照片，全部本地优先，断网照样用。" />
    <title>铁证 IRONPROOF</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: 写 `src/styles/theme.css`**（铁与暗令牌）

```css
@import 'tailwindcss';

@theme {
  --color-bg: #0a0a0b;
  --color-card: #1c1c1e;
  --color-card2: #2c2c2e;
  --color-line: #3a3a3c;
  --color-ink: #f5f5f7;
  --color-mute: #8e8e93;
  --color-iron: #ff5c1f;
  --color-iron2: #ff8c42;
}

html,
body {
  background: var(--color-bg);
  color: var(--color-ink);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
  overscroll-behavior: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  -webkit-font-smoothing: antialiased;
}

input,
textarea,
select {
  font-size: 16px; /* 防止 iOS 聚焦自动放大页面 */
}
```

- [ ] **Step 7: 写 `src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 8: 安装依赖**

Run: `cd /Users/ericlu/fitness-app-v2 && npm install`
Expected: 无 ERESOLVE 报错，生成 `package-lock.json` 与 `node_modules/`

- [ ] **Step 9: 写失败测试 `src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';

test('渲染应用外壳', () => {
  render(<App />);
  expect(screen.getByText('铁证')).toBeInTheDocument();
});
```

- [ ] **Step 10: 跑测试确认失败**

Run: `npm test`
Expected: FAIL —— `Cannot find module './App'`（或 Failed to resolve import）

- [ ] **Step 11: 写 `src/main.tsx` 与 `src/App.tsx`**

`src/main.tsx`：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`src/App.tsx`（临时外壳，Task 10 全量替换）：

```tsx
export default function App() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg text-ink">
      <h1 className="text-2xl font-black">铁证</h1>
    </div>
  );
}
```

- [ ] **Step 12: 跑测试确认通过 + 构建通过**

Run: `npm test && npm run build`
Expected: 1 passed；`vite build` 产出 `dist/`

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: 脚手架 Vite+React+TS+Tailwind4，铁与暗主题令牌与 iOS meta"
```

### Task 2: 日期与 ID 工具（TDD）

**Files:**
- Create: `src/lib/dates.ts`, `src/lib/ids.ts`
- Test: `src/lib/dates.test.ts`, `src/lib/ids.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/dates.test.ts`**

```ts
import {
  addDays, formatToday, lastNDates, monthGrid, parseDate,
  shiftMonth, toDateStr, weekStartOf,
} from './dates';

test('toDateStr / parseDate 互逆（本地时区）', () => {
  expect(toDateStr(new Date(2026, 6, 8))).toBe('2026-07-08');
  expect(toDateStr(parseDate('2026-07-08'))).toBe('2026-07-08');
});

test('addDays 跨月跨年', () => {
  expect(addDays('2026-07-08', -1)).toBe('2026-07-07');
  expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
  expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
});

test('weekStartOf 周一起始', () => {
  expect(weekStartOf('2026-07-08')).toBe('2026-07-06'); // 周三 → 周一
  expect(weekStartOf('2026-07-06')).toBe('2026-07-06'); // 周一 → 自身
  expect(weekStartOf('2026-07-12')).toBe('2026-07-06'); // 周日 → 上周一
});

test('lastNDates 旧到新含末日', () => {
  expect(lastNDates(3, '2026-07-08')).toEqual(['2026-07-06', '2026-07-07', '2026-07-08']);
});

test('monthGrid 42 格、周一起始', () => {
  const grid = monthGrid('2026-07');
  expect(grid).toHaveLength(42);
  expect(grid[0]).toBe('2026-06-29');
  expect(grid[41]).toBe('2026-08-09');
});

test('shiftMonth 跨年', () => {
  expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  expect(shiftMonth('2026-12', 1)).toBe('2027-01');
});

test('formatToday 中文格式', () => {
  expect(formatToday(new Date(2026, 6, 8))).toBe('7月8日 周三');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: FAIL —— Cannot find module './dates'

- [ ] **Step 3: 实现 `src/lib/dates.ts`**

```ts
export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function weekStartOf(dateStr: string): string {
  const dow = (parseDate(dateStr).getDay() + 6) % 7; // 周一=0
  return addDays(dateStr, -dow);
}

export function lastNDates(n: number, end: string): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
}

export function monthGrid(ym: string): string[] {
  const start = weekStartOf(`${ym}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatToday(d: Date): string {
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 周${week}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/dates.test.ts`
Expected: 7 passed

- [ ] **Step 5: 写失败测试 `src/lib/ids.test.ts`**

```ts
import { newId } from './ids';

test('newId 生成 UUID 且不重复', () => {
  const ids = new Set(Array.from({ length: 100 }, () => newId()));
  expect(ids.size).toBe(100);
  expect([...ids][0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
```

- [ ] **Step 6: 跑测试确认失败，然后实现 `src/lib/ids.ts`**

Run: `npx vitest run src/lib/ids.test.ts` → FAIL

```ts
export const newId = (): string => crypto.randomUUID();
```

Run: `npx vitest run src/lib/ids.test.ts` → 1 passed

- [ ] **Step 7: Commit**

```bash
git add src/lib
git commit -m "feat: 日期工具（周一起始/42格月网格）与 UUID 生成，TDD"
```

---

### Task 3: 核心类型、部位表与 40 个预置动作（TDD）

**Files:**
- Create: `src/lib/types.ts`, `src/data/bodyParts.ts`, `src/data/presetExercises.ts`
- Test: `src/data/presetExercises.test.ts`

- [ ] **Step 1: 写 `src/lib/types.ts`**（纯类型，无需测试）

```ts
export type BodyPart = 'chest' | 'shoulder' | 'back' | 'leg' | 'arm' | 'core' | 'cardio';

/** 一组：重量/次数均选填（规格 §5：组数必填、重量次数选填） */
export interface SetEntry {
  weight?: number;
  reps?: number;
}

export interface Workout {
  id: string;
  date: string; // YYYY-MM-DD，每天最多一条有效记录
  note?: string;
  updatedAt: number;
  deletedAt: number | null;
}

export interface WorkoutItem {
  id: string;
  workoutId: string;
  exerciseId: string;
  order: number;
  sets: SetEntry[]; // 组数 = 数组长度
  updatedAt: number;
  deletedAt: number | null;
}

export interface Exercise {
  id: string;
  name: string;
  bodyPart: BodyPart;
  preset: boolean; // true=系统预置，不可改名/删除
  updatedAt: number;
  deletedAt: number | null;
}

export interface WeightLog {
  id: string;
  date: string; // 每天最多一条有效记录
  weightKg: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Photo {
  id: string;
  date: string; // 每天最多一张有效照片
  blob: Blob;
  size: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Profile {
  id: string; // 恒为 'me'
  weeklyGoal: number; // 默认 4
  nickname?: string;
  onboarded: boolean;
  updatedAt: number;
}
```

- [ ] **Step 2: 写 `src/data/bodyParts.ts`**（部位色 = 规格 §4，暗底校准后的终值）

```ts
import type { BodyPart } from '../lib/types';

export interface BodyPartInfo {
  id: BodyPart;
  name: string;
  color: string;
}

export const BODY_PARTS: BodyPartInfo[] = [
  { id: 'chest', name: '胸', color: '#FF5C1F' },
  { id: 'shoulder', name: '肩', color: '#FFB340' },
  { id: 'back', name: '背', color: '#4F8EF7' },
  { id: 'leg', name: '腿', color: '#A06BFF' },
  { id: 'arm', name: '手臂', color: '#2FD6C3' },
  { id: 'core', name: '核心', color: '#FF5C8A' },
  { id: 'cardio', name: '有氧', color: '#8FAE9B' },
];

export function bodyPartInfo(id: BodyPart): BodyPartInfo {
  return BODY_PARTS.find((p) => p.id === id)!;
}
```

- [ ] **Step 3: 写失败测试 `src/data/presetExercises.test.ts`**

```ts
import { BODY_PARTS } from './bodyParts';
import { PRESET_EXERCISES } from './presetExercises';

test('预置动作共 40 个且 id 唯一', () => {
  expect(PRESET_EXERCISES).toHaveLength(40);
  expect(new Set(PRESET_EXERCISES.map((e) => e.id)).size).toBe(40);
});

test('每个动作的部位合法，每个部位至少 4 个动作', () => {
  const valid = new Set(BODY_PARTS.map((p) => p.id));
  for (const e of PRESET_EXERCISES) expect(valid.has(e.bodyPart)).toBe(true);
  for (const p of BODY_PARTS) {
    expect(PRESET_EXERCISES.filter((e) => e.bodyPart === p.id).length).toBeGreaterThanOrEqual(4);
  }
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npx vitest run src/data/presetExercises.test.ts`
Expected: FAIL —— Cannot find module './presetExercises'

- [ ] **Step 5: 实现 `src/data/presetExercises.ts`**（40 个，定稿清单）

```ts
import type { BodyPart } from '../lib/types';

export interface PresetExercise {
  id: string;
  name: string;
  bodyPart: BodyPart;
}

export const PRESET_EXERCISES: PresetExercise[] = [
  // 胸 6
  { id: 'p-bench', name: '卧推', bodyPart: 'chest' },
  { id: 'p-incline-bench', name: '上斜卧推', bodyPart: 'chest' },
  { id: 'p-db-fly', name: '哑铃飞鸟', bodyPart: 'chest' },
  { id: 'p-dip', name: '双杠臂屈伸', bodyPart: 'chest' },
  { id: 'p-cable-fly', name: '绳索夹胸', bodyPart: 'chest' },
  { id: 'p-pushup', name: '俯卧撑', bodyPart: 'chest' },
  // 肩 6
  { id: 'p-ohp', name: '站姿推举', bodyPart: 'shoulder' },
  { id: 'p-lat-raise', name: '哑铃侧平举', bodyPart: 'shoulder' },
  { id: 'p-face-pull', name: '面拉', bodyPart: 'shoulder' },
  { id: 'p-front-raise', name: '前平举', bodyPart: 'shoulder' },
  { id: 'p-reverse-fly', name: '反向飞鸟', bodyPart: 'shoulder' },
  { id: 'p-shrug', name: '耸肩', bodyPart: 'shoulder' },
  // 背 6
  { id: 'p-pullup', name: '引体向上', bodyPart: 'back' },
  { id: 'p-lat-pulldown', name: '高位下拉', bodyPart: 'back' },
  { id: 'p-bb-row', name: '杠铃划船', bodyPart: 'back' },
  { id: 'p-seated-row', name: '坐姿划船', bodyPart: 'back' },
  { id: 'p-straight-arm', name: '直臂下拉', bodyPart: 'back' },
  { id: 'p-deadlift', name: '硬拉', bodyPart: 'back' },
  // 腿 6
  { id: 'p-squat', name: '深蹲', bodyPart: 'leg' },
  { id: 'p-leg-press', name: '腿举', bodyPart: 'leg' },
  { id: 'p-leg-ext', name: '腿屈伸', bodyPart: 'leg' },
  { id: 'p-leg-curl', name: '腿弯举', bodyPart: 'leg' },
  { id: 'p-bulgarian', name: '保加利亚分腿蹲', bodyPart: 'leg' },
  { id: 'p-calf-raise', name: '提踵', bodyPart: 'leg' },
  // 手臂 6
  { id: 'p-bb-curl', name: '杠铃弯举', bodyPart: 'arm' },
  { id: 'p-db-curl', name: '哑铃弯举', bodyPart: 'arm' },
  { id: 'p-hammer-curl', name: '锤式弯举', bodyPart: 'arm' },
  { id: 'p-pushdown', name: '绳索下压', bodyPart: 'arm' },
  { id: 'p-skull-crusher', name: '仰卧臂屈伸', bodyPart: 'arm' },
  { id: 'p-close-bench', name: '窄距卧推', bodyPart: 'arm' },
  // 核心 4
  { id: 'p-crunch', name: '卷腹', bodyPart: 'core' },
  { id: 'p-plank', name: '平板支撑', bodyPart: 'core' },
  { id: 'p-hanging-leg', name: '悬垂举腿', bodyPart: 'core' },
  { id: 'p-russian-twist', name: '俄罗斯转体', bodyPart: 'core' },
  // 有氧 6
  { id: 'p-run', name: '跑步', bodyPart: 'cardio' },
  { id: 'p-bike', name: '单车', bodyPart: 'cardio' },
  { id: 'p-elliptical', name: '椭圆机', bodyPart: 'cardio' },
  { id: 'p-rope', name: '跳绳', bodyPart: 'cardio' },
  { id: 'p-rowing', name: '划船机', bodyPart: 'cardio' },
  { id: 'p-stairs', name: '爬楼机', bodyPart: 'cardio' },
];
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run src/data/presetExercises.test.ts`
Expected: 2 passed

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/data
git commit -m "feat: 核心类型、7 部位表与 40 个预置动作，TDD"
```

---

### Task 4: 表单校验（TDD）

**Files:**
- Create: `src/lib/validation.ts`
- Test: `src/lib/validation.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/validation.test.ts`**（边界值 = 规格 §12）

```ts
import {
  LIMITS, sanitizeSets, validBodyWeight, validLoad, validReps, validSetCount,
} from './validation';

test('体重 20–300kg', () => {
  expect(validBodyWeight(20)).toBe(true);
  expect(validBodyWeight(300)).toBe(true);
  expect(validBodyWeight(19.9)).toBe(false);
  expect(validBodyWeight(300.1)).toBe(false);
  expect(validBodyWeight(NaN)).toBe(false);
});

test('组数 1–20 整数', () => {
  expect(validSetCount(1)).toBe(true);
  expect(validSetCount(20)).toBe(true);
  expect(validSetCount(0)).toBe(false);
  expect(validSetCount(21)).toBe(false);
  expect(validSetCount(2.5)).toBe(false);
});

test('重量 0–500kg，次数 1–100 整数', () => {
  expect(validLoad(0)).toBe(true);
  expect(validLoad(500)).toBe(true);
  expect(validLoad(-1)).toBe(false);
  expect(validLoad(501)).toBe(false);
  expect(validReps(1)).toBe(true);
  expect(validReps(100)).toBe(true);
  expect(validReps(0)).toBe(false);
  expect(validReps(3.5)).toBe(false);
});

test('sanitizeSets 剔除非法重量/次数，保留组本身', () => {
  expect(
    sanitizeSets([{ weight: 60, reps: 10 }, { weight: 9999, reps: 0 }, {}]),
  ).toEqual([{ weight: 60, reps: 10 }, {}, {}]);
  expect(LIMITS.sets.max).toBe(20);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/validation.test.ts`
Expected: FAIL —— Cannot find module './validation'

- [ ] **Step 3: 实现 `src/lib/validation.ts`**

```ts
import type { SetEntry } from './types';

export const LIMITS = {
  weightKg: { min: 20, max: 300 },
  sets: { min: 1, max: 20 },
  load: { min: 0, max: 500 },
  reps: { min: 1, max: 100 },
} as const;

export const validBodyWeight = (v: number): boolean =>
  Number.isFinite(v) && v >= LIMITS.weightKg.min && v <= LIMITS.weightKg.max;

export const validSetCount = (v: number): boolean =>
  Number.isInteger(v) && v >= LIMITS.sets.min && v <= LIMITS.sets.max;

export const validLoad = (v: number): boolean =>
  Number.isFinite(v) && v >= LIMITS.load.min && v <= LIMITS.load.max;

export const validReps = (v: number): boolean =>
  Number.isInteger(v) && v >= LIMITS.reps.min && v <= LIMITS.reps.max;

/** 提交时清洗：非法的重量/次数直接丢弃，组数（数组长度）不变 */
export function sanitizeSets(sets: SetEntry[]): SetEntry[] {
  return sets.map((s) => {
    const out: SetEntry = {};
    if (s.weight !== undefined && validLoad(s.weight)) out.weight = s.weight;
    if (s.reps !== undefined && validReps(s.reps)) out.reps = s.reps;
    return out;
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/validation.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat: 表单校验边界（体重/组数/重量/次数）与提交清洗，TDD"
```

### Task 5: Dexie 数据库（TDD）

**Files:**
- Create: `src/lib/db.ts`, `src/test/dbTestUtils.ts`
- Test: `src/lib/db.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/db.test.ts`**

```ts
import { db } from './db';
import { resetDb } from '../test/dbTestUtils';

beforeEach(resetDb);

test('六张表齐全', () => {
  expect(db.tables.map((t) => t.name).sort()).toEqual(
    ['exercises', 'photos', 'profile', 'weightLogs', 'workoutItems', 'workouts'],
  );
});

test('写入并读回一条训练', async () => {
  await db.workouts.add({ id: 'w1', date: '2026-07-08', updatedAt: 1, deletedAt: null });
  const row = await db.workouts.get('w1');
  expect(row?.date).toBe('2026-07-08');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/db.test.ts`
Expected: FAIL —— Cannot find module './db'

- [ ] **Step 3: 实现 `src/lib/db.ts` 与 `src/test/dbTestUtils.ts`**

`src/lib/db.ts`：

```ts
import Dexie, { type EntityTable } from 'dexie';
import type { Exercise, Photo, Profile, WeightLog, Workout, WorkoutItem } from './types';

export const db = new Dexie('tiezheng') as Dexie & {
  workouts: EntityTable<Workout, 'id'>;
  workoutItems: EntityTable<WorkoutItem, 'id'>;
  exercises: EntityTable<Exercise, 'id'>;
  weightLogs: EntityTable<WeightLog, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  profile: EntityTable<Profile, 'id'>;
};

db.version(1).stores({
  workouts: 'id, date, updatedAt',
  workoutItems: 'id, workoutId, exerciseId, updatedAt',
  exercises: 'id, bodyPart, updatedAt',
  weightLogs: 'id, date, updatedAt',
  photos: 'id, date, updatedAt',
  profile: 'id',
});
```

`src/test/dbTestUtils.ts`：

```ts
import { db } from '../lib/db';

export async function resetDb(): Promise<void> {
  await db.delete();
  await db.open();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/db.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/db.test.ts src/test/dbTestUtils.ts
git commit -m "feat: Dexie v1 六表结构（软删除+updatedAt，云同构），TDD"
```

---

### Task 6: exerciseRepo + profileRepo（TDD）

**Files:**
- Create: `src/repos/exerciseRepo.ts`, `src/repos/profileRepo.ts`
- Test: `src/repos/exerciseRepo.test.ts`, `src/repos/profileRepo.test.ts`

- [ ] **Step 1: 写失败测试 `src/repos/exerciseRepo.test.ts`**

```ts
import { db } from '../lib/db';
import { resetDb } from '../test/dbTestUtils';
import {
  addCustomExercise, getExercisesByIds, listByPart, removeExercise, renameExercise, seedPresets,
} from './exerciseRepo';

beforeEach(resetDb);

test('seedPresets 幂等：跑两次仍是 40 条', async () => {
  await seedPresets();
  await seedPresets();
  expect(await db.exercises.count()).toBe(40);
});

test('listByPart 只返回该部位的有效动作', async () => {
  await seedPresets();
  const chest = await listByPart('chest');
  expect(chest).toHaveLength(6);
  expect(chest.every((e) => e.bodyPart === 'chest')).toBe(true);
});

test('新建/改名/软删自定义动作', async () => {
  const ex = await addCustomExercise('  龙门架下斜夹胸 ', 'chest');
  expect(ex.name).toBe('龙门架下斜夹胸');
  expect(ex.preset).toBe(false);

  await renameExercise(ex.id, '下斜夹胸');
  const map = await getExercisesByIds([ex.id]);
  expect(map.get(ex.id)?.name).toBe('下斜夹胸');

  await removeExercise(ex.id);
  expect(await listByPart('chest')).toHaveLength(0); // 未 seed，删掉后为空
  // 软删：行还在，仍能按 id 取到（供历史记录关联展示）
  expect((await getExercisesByIds([ex.id])).has(ex.id)).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/repos/exerciseRepo.test.ts`
Expected: FAIL —— Cannot find module './exerciseRepo'

- [ ] **Step 3: 实现 `src/repos/exerciseRepo.ts`**

```ts
import { db } from '../lib/db';
import { newId } from '../lib/ids';
import type { BodyPart, Exercise } from '../lib/types';
import { PRESET_EXERCISES } from '../data/presetExercises';

/** 首次启动灌入预置动作库；已有数据则跳过（幂等） */
export async function seedPresets(): Promise<void> {
  if ((await db.exercises.count()) > 0) return;
  const now = Date.now();
  await db.exercises.bulkAdd(
    PRESET_EXERCISES.map((p) => ({
      id: p.id,
      name: p.name,
      bodyPart: p.bodyPart,
      preset: true,
      updatedAt: now,
      deletedAt: null,
    })),
  );
}

export async function listByPart(part: BodyPart): Promise<Exercise[]> {
  const rows = await db.exercises.where('bodyPart').equals(part).toArray();
  return rows.filter((e) => e.deletedAt === null);
}

/** 含软删行：历史记录里被删动作仍需显示名字 */
export async function getExercisesByIds(ids: string[]): Promise<Map<string, Exercise>> {
  const rows = await db.exercises.bulkGet(ids);
  const map = new Map<string, Exercise>();
  for (const e of rows) if (e) map.set(e.id, e);
  return map;
}

export async function addCustomExercise(name: string, part: BodyPart): Promise<Exercise> {
  const ex: Exercise = {
    id: newId(),
    name: name.trim(),
    bodyPart: part,
    preset: false,
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await db.exercises.add(ex);
  return ex;
}

export async function renameExercise(id: string, name: string): Promise<void> {
  await db.exercises.update(id, { name: name.trim(), updatedAt: Date.now() });
}

export async function removeExercise(id: string): Promise<void> {
  await db.exercises.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/repos/exerciseRepo.test.ts`
Expected: 3 passed

- [ ] **Step 5: 写失败测试 `src/repos/profileRepo.test.ts`**

```ts
import { resetDb } from '../test/dbTestUtils';
import { getProfile, saveProfile } from './profileRepo';

beforeEach(resetDb);

test('默认档案：每周 4 练、未引导', async () => {
  const p = await getProfile();
  expect(p).toMatchObject({ id: 'me', weeklyGoal: 4, onboarded: false });
});

test('saveProfile 合并补丁并持久化', async () => {
  await saveProfile({ weeklyGoal: 5 });
  await saveProfile({ onboarded: true });
  const p = await getProfile();
  expect(p.weeklyGoal).toBe(5);
  expect(p.onboarded).toBe(true);
  expect(p.updatedAt).toBeGreaterThan(0);
});
```

- [ ] **Step 6: 跑测试确认失败，然后实现 `src/repos/profileRepo.ts`**

Run: `npx vitest run src/repos/profileRepo.test.ts` → FAIL

```ts
import { db } from '../lib/db';
import type { Profile } from '../lib/types';

const DEFAULT: Profile = { id: 'me', weeklyGoal: 4, onboarded: false, updatedAt: 0 };

export async function getProfile(): Promise<Profile> {
  return (await db.profile.get('me')) ?? { ...DEFAULT };
}

export async function saveProfile(patch: Partial<Omit<Profile, 'id'>>): Promise<Profile> {
  const next: Profile = { ...(await getProfile()), ...patch, id: 'me', updatedAt: Date.now() };
  await db.profile.put(next);
  return next;
}
```

Run: `npx vitest run src/repos/profileRepo.test.ts` → 2 passed

- [ ] **Step 7: Commit**

```bash
git add src/repos
git commit -m "feat: 动作库仓库（预置灌入幂等）与档案仓库，TDD"
```

---

### Task 7: weightRepo + photoRepo（TDD）

**Files:**
- Create: `src/repos/weightRepo.ts`, `src/repos/photoRepo.ts`
- Test: `src/repos/weightRepo.test.ts`, `src/repos/photoRepo.test.ts`

- [ ] **Step 1: 写失败测试 `src/repos/weightRepo.test.ts`**

```ts
import { resetDb } from '../test/dbTestUtils';
import { getWeight, listWeights, removeWeight, setWeight } from './weightRepo';

beforeEach(resetDb);

test('同日重复记录 = 覆盖，不产生第二条', async () => {
  await setWeight('2026-07-08', 72.4);
  await setWeight('2026-07-08', 72.0);
  const rows = await listWeights('2026-07-01', '2026-07-31');
  expect(rows).toHaveLength(1);
  expect(rows[0].weightKg).toBe(72.0);
});

test('listWeights 按日期升序、含区间端点', async () => {
  await setWeight('2026-07-03', 73);
  await setWeight('2026-07-01', 74);
  await setWeight('2026-06-30', 75); // 区间外
  const rows = await listWeights('2026-07-01', '2026-07-03');
  expect(rows.map((r) => r.date)).toEqual(['2026-07-01', '2026-07-03']);
});

test('removeWeight 软删后查不到', async () => {
  await setWeight('2026-07-08', 72.4);
  await removeWeight('2026-07-08');
  expect(await getWeight('2026-07-08')).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败，然后实现 `src/repos/weightRepo.ts`**

Run: `npx vitest run src/repos/weightRepo.test.ts` → FAIL

```ts
import { db } from '../lib/db';
import { newId } from '../lib/ids';
import type { WeightLog } from '../lib/types';

async function activeByDate(date: string): Promise<WeightLog | undefined> {
  const rows = await db.weightLogs.where('date').equals(date).toArray();
  return rows.find((w) => w.deletedAt === null);
}

/** 每天一条：已有则覆盖数值 */
export async function setWeight(date: string, weightKg: number): Promise<WeightLog> {
  const existing = await activeByDate(date);
  if (existing) {
    const next = { ...existing, weightKg, updatedAt: Date.now() };
    await db.weightLogs.put(next);
    return next;
  }
  const row: WeightLog = { id: newId(), date, weightKg, updatedAt: Date.now(), deletedAt: null };
  await db.weightLogs.add(row);
  return row;
}

export async function getWeight(date: string): Promise<WeightLog | undefined> {
  return activeByDate(date);
}

export async function listWeights(from: string, to: string): Promise<WeightLog[]> {
  const rows = await db.weightLogs.where('date').between(from, to, true, true).toArray();
  return rows
    .filter((w) => w.deletedAt === null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function removeWeight(date: string): Promise<void> {
  const existing = await activeByDate(date);
  if (existing) {
    await db.weightLogs.update(existing.id, { deletedAt: Date.now(), updatedAt: Date.now() });
  }
}
```

Run: `npx vitest run src/repos/weightRepo.test.ts` → 3 passed

- [ ] **Step 3: 写失败测试 `src/repos/photoRepo.test.ts`**

```ts
import { db } from '../lib/db';
import { resetDb } from '../test/dbTestUtils';
import { getPhoto, listPhotoDates, listPhotos, removePhoto, savePhoto } from './photoRepo';

beforeEach(resetDb);

const blob = (s: string) => new Blob([s], { type: 'image/jpeg' });

test('每天一张：重拍替换旧照（旧照软删）', async () => {
  await savePhoto('2026-07-08', blob('v1'));
  await savePhoto('2026-07-08', blob('v2-x'));
  const p = await getPhoto('2026-07-08');
  expect(p?.size).toBe(4); // 'v2-x'
  expect(await db.photos.count()).toBe(2); // 软删行保留
  expect(await listPhotos()).toHaveLength(1);
});

test('listPhotos 新日期在前；listPhotoDates 返回区间内日期集合', async () => {
  await savePhoto('2026-07-01', blob('a'));
  await savePhoto('2026-07-05', blob('b'));
  expect((await listPhotos()).map((p) => p.date)).toEqual(['2026-07-05', '2026-07-01']);
  const dates = await listPhotoDates('2026-07-01', '2026-07-04');
  expect(dates.has('2026-07-01')).toBe(true);
  expect(dates.has('2026-07-05')).toBe(false);
});

test('removePhoto 软删后查不到', async () => {
  await savePhoto('2026-07-08', blob('a'));
  await removePhoto('2026-07-08');
  expect(await getPhoto('2026-07-08')).toBeUndefined();
});
```

- [ ] **Step 4: 跑测试确认失败，然后实现 `src/repos/photoRepo.ts`**

Run: `npx vitest run src/repos/photoRepo.test.ts` → FAIL

```ts
import { db } from '../lib/db';
import { newId } from '../lib/ids';
import type { Photo } from '../lib/types';

async function activeByDate(date: string): Promise<Photo | undefined> {
  const rows = await db.photos.where('date').equals(date).toArray();
  return rows.find((p) => p.deletedAt === null);
}

/** 每天一张上限（规格 §9）：重拍 = 软删旧照 + 新增 */
export async function savePhoto(date: string, blob: Blob): Promise<Photo> {
  const old = await activeByDate(date);
  if (old) await db.photos.update(old.id, { deletedAt: Date.now(), updatedAt: Date.now() });
  const row: Photo = {
    id: newId(),
    date,
    blob,
    size: blob.size,
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await db.photos.add(row);
  return row;
}

export async function getPhoto(date: string): Promise<Photo | undefined> {
  return activeByDate(date);
}

export async function listPhotos(): Promise<Photo[]> {
  const rows = await db.photos.toArray();
  return rows
    .filter((p) => p.deletedAt === null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function listPhotoDates(from: string, to: string): Promise<Set<string>> {
  const rows = await db.photos.where('date').between(from, to, true, true).toArray();
  return new Set(rows.filter((p) => p.deletedAt === null).map((p) => p.date));
}

export async function removePhoto(date: string): Promise<void> {
  const existing = await activeByDate(date);
  if (existing) {
    await db.photos.update(existing.id, { deletedAt: Date.now(), updatedAt: Date.now() });
  }
}
```

Run: `npx vitest run src/repos/photoRepo.test.ts` → 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/repos/weightRepo.ts src/repos/weightRepo.test.ts src/repos/photoRepo.ts src/repos/photoRepo.test.ts
git commit -m "feat: 体重仓库（同日覆盖）与照片仓库（每日一张、重拍替换），TDD"
```

### Task 8: workoutRepo（TDD）

**Files:**
- Create: `src/repos/workoutRepo.ts`
- Test: `src/repos/workoutRepo.test.ts`

- [ ] **Step 1: 写失败测试 `src/repos/workoutRepo.test.ts`**

```ts
import { db } from '../lib/db';
import { resetDb } from '../test/dbTestUtils';
import { seedPresets } from './exerciseRepo';
import {
  addWorkoutItem, commitDraft, getDayItems, getOrCreateWorkout, listItemsInRange,
  listRecentExerciseIds, listWorkoutDates, removeWorkoutItem, updateItemSets,
} from './workoutRepo';

beforeEach(async () => {
  await resetDb();
  await seedPresets();
});

test('同一天只有一条 workout（getOrCreateWorkout 去重）', async () => {
  const a = await getOrCreateWorkout('2026-07-08');
  const b = await getOrCreateWorkout('2026-07-08');
  expect(a.id).toBe(b.id);
  expect(await db.workouts.count()).toBe(1);
});

test('addWorkoutItem 顺序递增；getDayItems 关联动作并按序返回', async () => {
  await addWorkoutItem('2026-07-08', 'p-bench', [{ weight: 60, reps: 10 }]);
  await addWorkoutItem('2026-07-08', 'p-squat', [{}, {}]);
  const items = await getDayItems('2026-07-08');
  expect(items.map((i) => i.order)).toEqual([0, 1]);
  expect(items.map((i) => i.exercise.bodyPart)).toEqual(['chest', 'leg']);
});

test('删光当天条目后，listWorkoutDates 不再含该日', async () => {
  const item = await addWorkoutItem('2026-07-08', 'p-bench', [{}]);
  await addWorkoutItem('2026-07-07', 'p-squat', [{}]);
  await removeWorkoutItem(item.id);
  expect(await listWorkoutDates('2026-07-01', '2026-07-31')).toEqual(['2026-07-07']);
});

test('updateItemSets 覆盖组数据', async () => {
  const item = await addWorkoutItem('2026-07-08', 'p-bench', [{}]);
  await updateItemSets(item.id, [{ weight: 70, reps: 5 }, { weight: 70, reps: 5 }]);
  const items = await getDayItems('2026-07-08');
  expect(items[0].sets).toHaveLength(2);
  expect(items[0].sets[0].weight).toBe(70);
});

test('commitDraft 跳过 0 组条目、按日期入库', async () => {
  await commitDraft(
    [
      { exerciseId: 'p-bench', sets: [{ weight: 60, reps: 10 }, {}] },
      { exerciseId: 'p-squat', sets: [] },
    ],
    '2026-07-08',
  );
  const items = await getDayItems('2026-07-08');
  expect(items).toHaveLength(1);
  expect(items[0].exercise.id).toBe('p-bench');
});

test('listItemsInRange 只含区间内有效条目并带日期', async () => {
  await addWorkoutItem('2026-07-01', 'p-bench', [{ weight: 60, reps: 10 }]);
  await addWorkoutItem('2026-06-30', 'p-squat', [{}]);
  const rows = await listItemsInRange('2026-07-01', '2026-07-31');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ date: '2026-07-01', exerciseId: 'p-bench' });
});

test('listRecentExerciseIds 去重且最近使用在前', async () => {
  await addWorkoutItem('2026-07-06', 'p-bench', [{}]);
  await new Promise((r) => setTimeout(r, 5)); // 确保 updatedAt 递增
  await addWorkoutItem('2026-07-07', 'p-squat', [{}]);
  await new Promise((r) => setTimeout(r, 5));
  await addWorkoutItem('2026-07-08', 'p-bench', [{}]);
  const ids = await listRecentExerciseIds();
  expect(ids.slice(0, 2)).toEqual(['p-bench', 'p-squat']);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/repos/workoutRepo.test.ts`
Expected: FAIL —— Cannot find module './workoutRepo'

- [ ] **Step 3: 实现 `src/repos/workoutRepo.ts`**

```ts
import { db } from '../lib/db';
import { newId } from '../lib/ids';
import type { Exercise, SetEntry, Workout, WorkoutItem } from '../lib/types';

export interface DayItem extends WorkoutItem {
  exercise: Exercise;
}

export interface RangeItem {
  date: string;
  exerciseId: string;
  sets: SetEntry[];
}

export interface DraftItem {
  exerciseId: string;
  sets: SetEntry[];
}

export async function getWorkoutByDate(date: string): Promise<Workout | undefined> {
  const rows = await db.workouts.where('date').equals(date).toArray();
  return rows.find((w) => w.deletedAt === null);
}

export async function getOrCreateWorkout(date: string): Promise<Workout> {
  const existing = await getWorkoutByDate(date);
  if (existing) return existing;
  const row: Workout = { id: newId(), date, updatedAt: Date.now(), deletedAt: null };
  await db.workouts.add(row);
  return row;
}

async function activeItems(workoutId: string): Promise<WorkoutItem[]> {
  const rows = await db.workoutItems.where('workoutId').equals(workoutId).toArray();
  return rows
    .filter((i) => i.deletedAt === null)
    .sort((a, b) => a.order - b.order);
}

export async function addWorkoutItem(
  date: string,
  exerciseId: string,
  sets: SetEntry[],
): Promise<WorkoutItem> {
  const workout = await getOrCreateWorkout(date);
  const order = (await activeItems(workout.id)).length;
  const row: WorkoutItem = {
    id: newId(),
    workoutId: workout.id,
    exerciseId,
    order,
    sets,
    updatedAt: Date.now(),
    deletedAt: null,
  };
  await db.workoutItems.add(row);
  return row;
}

export async function updateItemSets(id: string, sets: SetEntry[]): Promise<void> {
  await db.workoutItems.update(id, { sets, updatedAt: Date.now() });
}

/** 软删条目；若该日已无有效条目，连 workout 一起软删（日历不再亮格） */
export async function removeWorkoutItem(id: string): Promise<void> {
  const item = await db.workoutItems.get(id);
  if (!item) return;
  await db.workoutItems.update(id, { deletedAt: Date.now(), updatedAt: Date.now() });
  const rest = await activeItems(item.workoutId);
  if (rest.length === 0) {
    await db.workouts.update(item.workoutId, { deletedAt: Date.now(), updatedAt: Date.now() });
  }
}

export async function getDayItems(date: string): Promise<DayItem[]> {
  const workout = await getWorkoutByDate(date);
  if (!workout) return [];
  const items = await activeItems(workout.id);
  const exercises = await db.exercises.bulkGet(items.map((i) => i.exerciseId));
  return items.flatMap((item, idx) => {
    const exercise = exercises[idx];
    return exercise ? [{ ...item, exercise }] : [];
  });
}

export async function listWorkoutDates(from: string, to: string): Promise<string[]> {
  const rows = await db.workouts.where('date').between(from, to, true, true).toArray();
  return rows
    .filter((w) => w.deletedAt === null)
    .map((w) => w.date)
    .sort();
}

export async function listAllWorkoutDates(): Promise<string[]> {
  const rows = await db.workouts.toArray();
  return rows
    .filter((w) => w.deletedAt === null)
    .map((w) => w.date)
    .sort();
}

async function itemsOfWorkouts(workouts: Workout[]): Promise<RangeItem[]> {
  const active = workouts.filter((w) => w.deletedAt === null);
  if (active.length === 0) return [];
  const dateOf = new Map(active.map((w) => [w.id, w.date]));
  const items = await db.workoutItems
    .where('workoutId')
    .anyOf(active.map((w) => w.id))
    .toArray();
  return items
    .filter((i) => i.deletedAt === null)
    .map((i) => ({ date: dateOf.get(i.workoutId)!, exerciseId: i.exerciseId, sets: i.sets }));
}

export async function listItemsInRange(from: string, to: string): Promise<RangeItem[]> {
  const workouts = await db.workouts.where('date').between(from, to, true, true).toArray();
  return itemsOfWorkouts(workouts);
}

export async function listAllItems(): Promise<RangeItem[]> {
  return itemsOfWorkouts(await db.workouts.toArray());
}

/** 最近使用的动作 id，去重、最近在前（记录流「最近使用置顶」用） */
export async function listRecentExerciseIds(limit = 8): Promise<string[]> {
  const rows = await db.workoutItems.orderBy('updatedAt').reverse().limit(200).toArray();
  const seen: string[] = [];
  for (const row of rows) {
    if (row.deletedAt !== null) continue;
    if (!seen.includes(row.exerciseId)) seen.push(row.exerciseId);
    if (seen.length >= limit) break;
  }
  return seen;
}

/** 记录流「完成打卡」：0 组的条目直接丢弃 */
export async function commitDraft(items: DraftItem[], date: string): Promise<void> {
  for (const item of items) {
    if (item.sets.length === 0) continue;
    await addWorkoutItem(date, item.exerciseId, item.sets);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/repos/workoutRepo.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/repos/workoutRepo.ts src/repos/workoutRepo.test.ts
git commit -m "feat: 训练仓库（每日去重/条目排序/区间查询/最近动作/草稿提交），TDD"
```

---

### Task 9: 统计纯函数（TDD）

**Files:**
- Create: `src/lib/stats.ts`
- Test: `src/lib/stats.test.ts`

图表数据变换全部做成纯函数，与 Chart.js 解耦（jsdom 无 canvas，图表组件不做单测，逻辑在这里测全）。

- [ ] **Step 1: 写失败测试 `src/lib/stats.test.ts`**

```ts
import {
  countByBodyPart, currentStreak, maxWeightSeries, movingAverage, totals, weekProgress, weeklyCounts,
} from './stats';

test('countByBodyPart 零填充全部 7 个部位', () => {
  const r = countByBodyPart(['chest', 'chest', 'leg']);
  expect(r).toEqual({ chest: 2, shoulder: 0, back: 0, leg: 1, arm: 0, core: 0, cardio: 0 });
});

test('weeklyCounts 按周一开头分桶、从旧到新', () => {
  const r = weeklyCounts(['2026-07-06', '2026-07-07', '2026-06-30'], 2, '2026-07-08');
  expect(r).toEqual([
    { weekStart: '2026-06-29', count: 1 },
    { weekStart: '2026-07-06', count: 2 },
  ]);
});

test('movingAverage 前段不足窗口时按已有值平均', () => {
  expect(movingAverage([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
});

test('maxWeightSeries 取每日最大重量、跳过无重量组', () => {
  const r = maxWeightSeries([
    { date: '2026-07-01', sets: [{ weight: 60, reps: 10 }, { weight: 70, reps: 5 }, { reps: 12 }] },
  ]);
  expect(r).toEqual([{ date: '2026-07-01', maxKg: 70 }]);
});

test('totals 统计天数/组数/容量（容量只算重量×次数齐全的组）', () => {
  const r = totals(
    [
      { sets: [{ weight: 60, reps: 10 }, { weight: 60, reps: 8 }] }, // 600+480
      { sets: [{ weight: 0, reps: 10 }, { reps: 12 }] },             // 0 + 无重量
    ],
    ['2026-07-01', '2026-07-02', '2026-07-01'],
  );
  expect(r).toEqual({ days: 2, sets: 4, volumeKg: 1080 });
});

test('currentStreak：今天没练看昨天，断档归零', () => {
  expect(currentStreak(new Set(['2026-07-08', '2026-07-07', '2026-07-05']), '2026-07-08')).toBe(2);
  expect(currentStreak(new Set(['2026-07-07', '2026-07-06']), '2026-07-08')).toBe(2);
  expect(currentStreak(new Set(['2026-07-05']), '2026-07-08')).toBe(0);
});

test('weekProgress 只数本周（周一起）', () => {
  expect(weekProgress(['2026-07-06', '2026-07-08', '2026-07-01'], '2026-07-08')).toBe(2);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: FAIL —— Cannot find module './stats'

- [ ] **Step 3: 实现 `src/lib/stats.ts`**

```ts
import { BODY_PARTS } from '../data/bodyParts';
import { addDays, weekStartOf } from './dates';
import type { BodyPart, SetEntry } from './types';

export function countByBodyPart(parts: BodyPart[]): Record<BodyPart, number> {
  const result = Object.fromEntries(BODY_PARTS.map((p) => [p.id, 0])) as Record<BodyPart, number>;
  for (const p of parts) result[p] += 1;
  return result;
}

export interface WeekCount {
  weekStart: string;
  count: number;
}

/** 近 N 周训练天数，按周一开头分桶，从旧到新 */
export function weeklyCounts(workoutDates: string[], weeks: number, today: string): WeekCount[] {
  const thisWeek = weekStartOf(today);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - 1 - i)));
  const bucket = new Map(starts.map((s) => [s, 0]));
  for (const d of new Set(workoutDates)) {
    const key = weekStartOf(d);
    if (bucket.has(key)) bucket.set(key, bucket.get(key)! + 1);
  }
  return starts.map((weekStart) => ({ weekStart, count: bucket.get(weekStart)! }));
}

/** 移动平均；前段不足窗口时按已有值平均（体重 7 日均线用） */
export function movingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** 力量曲线：每个日期取该动作最大重量，无重量的组跳过 */
export function maxWeightSeries(
  items: { date: string; sets: SetEntry[] }[],
): { date: string; maxKg: number }[] {
  const byDate = new Map<string, number>();
  for (const item of items) {
    for (const set of item.sets) {
      if (set.weight === undefined) continue;
      const cur = byDate.get(item.date);
      if (cur === undefined || set.weight > cur) byDate.set(item.date, set.weight);
    }
  }
  return [...byDate.entries()]
    .map(([date, maxKg]) => ({ date, maxKg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 累计大数字：容量 = Σ(重量×次数)，仅重量次数都填了才计入 */
export function totals(
  items: { sets: SetEntry[] }[],
  workoutDates: string[],
): { days: number; sets: number; volumeKg: number } {
  let sets = 0;
  let volumeKg = 0;
  for (const item of items) {
    sets += item.sets.length;
    for (const s of item.sets) {
      if (s.weight !== undefined && s.reps !== undefined) volumeKg += s.weight * s.reps;
    }
  }
  return { days: new Set(workoutDates).size, sets, volumeKg };
}

/** 连续打卡天数：今天没练则从昨天起算（今天还没练不算断） */
export function currentStreak(dates: Set<string>, today: string): number {
  let cursor = dates.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 本周（周一起）训练天数，目标进度环用 */
export function weekProgress(workoutDates: string[], today: string): number {
  const start = weekStartOf(today);
  const end = addDays(start, 6);
  return new Set(workoutDates.filter((d) => d >= start && d <= end)).size;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/stats.test.ts`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: 图表统计纯函数（部位频次/周分桶/均线/力量曲线/累计/连击/周进度），TDD"
```

### Task 10: App 壳（路由 / TabBar / 错误边界 / 日志）

**Files:**
- Create: `src/lib/logger.ts`, `src/components/ErrorBoundary.tsx`, `src/components/TabBar.tsx`, `src/screens/today/TodayScreen.tsx`, `src/screens/calendar/CalendarScreen.tsx`, `src/screens/calendar/DayDetailScreen.tsx`, `src/screens/stats/StatsScreen.tsx`, `src/screens/profile/ProfileScreen.tsx`, `src/screens/log/LogFlow.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`, `src/App.test.tsx`
- Test: `src/lib/logger.test.ts`

本任务先把 6 个页面文件建成占位（只有标题），后续任务逐个填充。

- [ ] **Step 1: 写失败测试 `src/lib/logger.test.ts`**

```ts
import { log, readLogs } from './logger';

beforeEach(() => localStorage.clear());

test('log 追加一条带时间戳的记录', () => {
  log('something broke');
  const logs = readLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatch(/^\d{4}-\d{2}-\d{2}T.*something broke$/);
});

test('环形上限 100 条，旧的被挤出', () => {
  for (let i = 0; i < 105; i++) log(`msg-${i}`);
  const logs = readLogs();
  expect(logs).toHaveLength(100);
  expect(logs[0]).toContain('msg-5');
  expect(logs[99]).toContain('msg-104');
});

test('localStorage 损坏时 readLogs 返回空数组', () => {
  localStorage.setItem('tiezheng-log', '{not json');
  expect(readLogs()).toEqual([]);
});
```

- [ ] **Step 2: 跑测试确认失败，然后实现 `src/lib/logger.ts`**

Run: `npx vitest run src/lib/logger.test.ts` → FAIL

```ts
const KEY = 'tiezheng-log';
const MAX = 100;

/** 本地环形日志（规格 §12）：容量 100 条，写入永不抛错 */
export function log(msg: string): void {
  try {
    const logs = readLogs();
    logs.push(`${new Date().toISOString()} ${msg}`);
    localStorage.setItem(KEY, JSON.stringify(logs.slice(-MAX)));
  } catch {
    // 日志失败不影响主流程
  }
}

export function readLogs(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
```

Run: `npx vitest run src/lib/logger.test.ts` → 3 passed

- [ ] **Step 3: 创建 `src/components/ErrorBoundary.tsx`**

```tsx
import { Component, type ReactNode } from 'react';
import { log } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    log(`ErrorBoundary: ${error.message}`);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-2xl font-bold">出了点问题</p>
        <p className="text-sm text-mute">你的数据都在本地，不会丢失。</p>
        <button
          type="button"
          className="rounded-xl bg-iron px-6 py-3 font-semibold text-white active:scale-95"
          onClick={() => window.location.reload()}
        >
          重新载入
        </button>
      </div>
    );
  }
}
```

- [ ] **Step 4: 创建 `src/components/TabBar.tsx`**

```tsx
import { NavLink } from 'react-router-dom';

const TABS = [
  {
    to: '/',
    label: '今日',
    d: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  },
  {
    to: '/calendar',
    label: '日历',
    d: 'M7 2v3m10-3v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z',
  },
  {
    to: '/stats',
    label: '数据',
    d: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  },
  {
    to: '/profile',
    label: '我的',
    d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  },
];

export function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-md pb-[env(safe-area-inset-bottom)]">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                isActive ? 'text-iron' : 'text-mute'
              }`
            }
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={tab.d} />
            </svg>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: 创建 6 个占位页面**

`src/screens/today/TodayScreen.tsx`：

```tsx
export function TodayScreen() {
  return <h1 className="p-4 text-2xl font-bold">今日</h1>;
}
```

`src/screens/calendar/CalendarScreen.tsx`：

```tsx
export function CalendarScreen() {
  return <h1 className="p-4 text-2xl font-bold">日历</h1>;
}
```

`src/screens/calendar/DayDetailScreen.tsx`：

```tsx
export function DayDetailScreen() {
  return <h1 className="p-4 text-2xl font-bold">日详情</h1>;
}
```

`src/screens/stats/StatsScreen.tsx`：

```tsx
export function StatsScreen() {
  return <h1 className="p-4 text-2xl font-bold">数据</h1>;
}
```

`src/screens/profile/ProfileScreen.tsx`：

```tsx
export function ProfileScreen() {
  return <h1 className="p-4 text-2xl font-bold">我的</h1>;
}
```

`src/screens/log/LogFlow.tsx`：

```tsx
export function LogFlow() {
  return <h1 className="p-4 text-2xl font-bold">记录</h1>;
}
```

- [ ] **Step 6: 改写 `src/App.tsx`**

```tsx
import { HashRouter, Outlet, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabBar } from './components/TabBar';
import { CalendarScreen } from './screens/calendar/CalendarScreen';
import { DayDetailScreen } from './screens/calendar/DayDetailScreen';
import { LogFlow } from './screens/log/LogFlow';
import { ProfileScreen } from './screens/profile/ProfileScreen';
import { StatsScreen } from './screens/stats/StatsScreen';
import { TodayScreen } from './screens/today/TodayScreen';

function TabLayout() {
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-24 pt-[env(safe-area-inset-top)]">
      <Outlet />
      <TabBar />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route path="/log" element={<LogFlow />} />
          <Route path="/day/:date" element={<DayDetailScreen />} />
          <Route element={<TabLayout />}>
            <Route path="/" element={<TodayScreen />} />
            <Route path="/calendar" element={<CalendarScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 7: 改写 `src/main.tsx`（全局错误钩子 + 预置动作灌入）**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { log } from './lib/logger';
import { seedPresets } from './repos/exerciseRepo';
import './styles/theme.css';

window.addEventListener('error', (e) => log(`window.error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => log(`unhandledrejection: ${String(e.reason)}`));

seedPresets().catch((e) => log(`seedPresets: ${String(e)}`));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: 更新 `src/App.test.tsx`（4 个 Tab 都渲染）**

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';
import { resetDb } from './test/dbTestUtils';

beforeEach(async () => {
  window.location.hash = '';
  await resetDb();
});

test('渲染 4 个底部 Tab', async () => {
  render(<App />);
  expect(await screen.findByText('今日')).toBeInTheDocument();
  expect(screen.getByText('日历')).toBeInTheDocument();
  expect(screen.getByText('数据')).toBeInTheDocument();
  expect(screen.getByText('我的')).toBeInTheDocument();
});
```

- [ ] **Step 9: 全量测试 + 构建 + Commit**

Run: `npm test` → 全部通过；`npm run build` → 无 TS 报错

```bash
git add src
git commit -m "feat: App 壳（HashRouter 路由/TabBar/错误边界/环形日志/占位页面）"
```

### Task 11: 记录流（草稿 store + 三步流程）

**Files:**
- Create: `src/stores/logDraftStore.ts`, `src/components/SetRows.tsx`
- Modify: `src/screens/log/LogFlow.tsx`（替换占位）
- Test: `src/stores/logDraftStore.test.ts`, `src/screens/log/LogFlow.test.tsx`

> **UI 任务**：动手前先读 `/Users/ericlu/.claude/skills/design-taste-frontend/SKILL.md`。

- [ ] **Step 1: 写失败测试 `src/stores/logDraftStore.test.ts`**

```ts
import { useLogDraft } from './logDraftStore';

beforeEach(() => {
  useLogDraft.setState({ active: false, parts: [], items: [] });
  localStorage.clear();
});

test('start 开启草稿；已激活时不清空已有内容', () => {
  useLogDraft.getState().start();
  useLogDraft.getState().togglePart('chest');
  useLogDraft.getState().start();
  expect(useLogDraft.getState().parts).toEqual(['chest']);
});

test('togglePart 选中/取消', () => {
  const s = useLogDraft.getState();
  s.togglePart('chest');
  s.togglePart('leg');
  s.togglePart('chest');
  expect(useLogDraft.getState().parts).toEqual(['leg']);
});

test('addItem 去重、默认 3 空组；removeItemByExercise 移除', () => {
  const s = useLogDraft.getState();
  s.addItem('p-bench');
  s.addItem('p-bench');
  expect(useLogDraft.getState().items).toHaveLength(1);
  expect(useLogDraft.getState().items[0].sets).toEqual([{}, {}, {}]);
  s.removeItemByExercise('p-bench');
  expect(useLogDraft.getState().items).toHaveLength(0);
});

test('updateSets 按下标更新；reset 清空', () => {
  const s = useLogDraft.getState();
  s.addItem('p-bench');
  s.updateSets(0, [{ weight: 60, reps: 10 }]);
  expect(useLogDraft.getState().items[0].sets).toEqual([{ weight: 60, reps: 10 }]);
  s.reset();
  expect(useLogDraft.getState()).toMatchObject({ active: false, parts: [], items: [] });
});
```

- [ ] **Step 2: 跑测试确认失败，然后实现 `src/stores/logDraftStore.ts`**

Run: `npx vitest run src/stores/logDraftStore.test.ts` → FAIL

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BodyPart, SetEntry } from '../lib/types';

export interface DraftState {
  active: boolean;
  parts: BodyPart[];
  items: { exerciseId: string; sets: SetEntry[] }[];
  start: () => void;
  togglePart: (part: BodyPart) => void;
  addItem: (exerciseId: string) => void;
  updateSets: (index: number, sets: SetEntry[]) => void;
  removeItem: (index: number) => void;
  removeItemByExercise: (exerciseId: string) => void;
  reset: () => void;
}

/** 记录流草稿：persist 到 localStorage，退出/刷新不丢（产品铁律 2） */
export const useLogDraft = create<DraftState>()(
  persist(
    (set, get) => ({
      active: false,
      parts: [],
      items: [],
      start: () => {
        if (!get().active) set({ active: true, parts: [], items: [] });
      },
      togglePart: (part) =>
        set((s) => ({
          parts: s.parts.includes(part) ? s.parts.filter((p) => p !== part) : [...s.parts, part],
        })),
      addItem: (exerciseId) =>
        set((s) =>
          s.items.some((i) => i.exerciseId === exerciseId)
            ? s
            : { items: [...s.items, { exerciseId, sets: [{}, {}, {}] }] },
        ),
      updateSets: (index, sets) =>
        set((s) => ({
          items: s.items.map((item, i) => (i === index ? { ...item, sets } : item)),
        })),
      removeItem: (index) =>
        set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
      removeItemByExercise: (exerciseId) =>
        set((s) => ({ items: s.items.filter((i) => i.exerciseId !== exerciseId) })),
      reset: () => set({ active: false, parts: [], items: [] }),
    }),
    { name: 'tiezheng-draft' },
  ),
);
```

Run: `npx vitest run src/stores/logDraftStore.test.ts` → 4 passed

- [ ] **Step 3: 创建 `src/components/SetRows.tsx`（组编辑器，日详情也复用）**

```tsx
import { LIMITS } from '../lib/validation';
import type { SetEntry } from '../lib/types';

interface Props {
  sets: SetEntry[];
  onChange: (sets: SetEntry[]) => void;
}

function numOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function SetRows({ sets, onChange }: Props) {
  const patch = (index: number, entry: SetEntry) =>
    onChange(sets.map((s, i) => (i === index ? entry : s)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="减一组"
          disabled={sets.length <= LIMITS.sets.min}
          onClick={() => onChange(sets.slice(0, -1))}
          className="h-9 w-9 rounded-lg bg-card2 text-lg text-ink disabled:opacity-30 active:scale-95"
        >
          −
        </button>
        <span className="min-w-12 text-center text-sm text-mute">{sets.length} 组</span>
        <button
          type="button"
          aria-label="加一组"
          disabled={sets.length >= LIMITS.sets.max}
          onClick={() => onChange([...sets, {}])}
          className="h-9 w-9 rounded-lg bg-card2 text-lg text-ink disabled:opacity-30 active:scale-95"
        >
          ＋
        </button>
      </div>
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-8 text-mute">{i + 1}</span>
          <input
            inputMode="decimal"
            placeholder="重量kg"
            value={s.weight ?? ''}
            onChange={(e) => patch(i, { ...s, weight: numOrUndefined(e.target.value) })}
            className="w-24 rounded-lg bg-card2 px-3 py-2 text-ink placeholder:text-mute/60"
          />
          <span className="text-mute">×</span>
          <input
            inputMode="numeric"
            placeholder="次数"
            value={s.reps ?? ''}
            onChange={(e) => patch(i, { ...s, reps: numOrUndefined(e.target.value) })}
            className="w-20 rounded-lg bg-card2 px-3 py-2 text-ink placeholder:text-mute/60"
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 改写 `src/screens/log/LogFlow.tsx`（完整三步流程）**

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { SetRows } from '../../components/SetRows';
import { BODY_PARTS, bodyPartInfo } from '../../data/bodyParts';
import { todayStr } from '../../lib/dates';
import { sanitizeSets } from '../../lib/validation';
import type { BodyPart, Exercise } from '../../lib/types';
import { addCustomExercise, getExercisesByIds, listByPart } from '../../repos/exerciseRepo';
import { commitDraft, listRecentExerciseIds } from '../../repos/workoutRepo';
import { useLogDraft } from '../../stores/logDraftStore';

export function LogFlow() {
  const nav = useNavigate();
  const draft = useLogDraft();
  const [step, setStep] = useState(() => {
    const s = useLogDraft.getState();
    return s.items.length > 0 ? 2 : s.parts.length > 0 ? 1 : 0;
  });
  const [done, setDone] = useState<{ moves: number; sets: number } | null>(null);

  useEffect(() => {
    if (!useLogDraft.getState().active) useLogDraft.getState().start();
  }, []);

  async function finish() {
    const items = useLogDraft.getState().items.map((i) => ({
      exerciseId: i.exerciseId,
      sets: sanitizeSets(i.sets),
    }));
    await commitDraft(items, todayStr());
    setDone({
      moves: items.filter((i) => i.sets.length > 0).length,
      sets: items.reduce((n, i) => n + i.sets.length, 0),
    });
    useLogDraft.getState().reset();
  }

  if (done) return <DoneScreen moves={done.moves} sets={done.sets} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-8 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="mb-4 flex items-center justify-between">
        <button type="button" onClick={() => nav(-1)} className="py-2 pr-4 text-mute">
          关闭
        </button>
        <span className="text-xs text-mute">草稿自动保存</span>
      </header>
      {step === 0 && <PickParts onNext={() => setStep(1)} />}
      {step === 1 && <PickExercises onBack={() => setStep(0)} onNext={() => setStep(2)} />}
      {step === 2 && <EditSets onBack={() => setStep(1)} onFinish={finish} />}
    </div>
  );

  function PickParts({ onNext }: { onNext: () => void }) {
    return (
      <div className="flex flex-1 flex-col">
        <h1 className="mb-6 text-3xl font-bold">今天练哪儿？</h1>
        <div className="grid grid-cols-2 gap-3">
          {BODY_PARTS.map((p) => {
            const selected = draft.parts.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => draft.togglePart(p.id)}
                className={`flex items-center gap-3 rounded-2xl border p-4 text-left text-lg font-semibold active:scale-[.97] ${
                  selected ? 'border-iron bg-iron/10' : 'border-line bg-card'
                }`}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                {p.name}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={draft.parts.length === 0}
          onClick={onNext}
          className="mt-auto rounded-2xl bg-iron py-4 text-lg font-bold text-white disabled:opacity-30 active:scale-[.98]"
        >
          下一步 · 选动作
        </button>
      </div>
    );
  }

  function PickExercises({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
    const [query, setQuery] = useState('');
    return (
      <div className="flex flex-1 flex-col gap-4">
        <h1 className="text-3xl font-bold">选动作</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索动作…"
          className="rounded-xl bg-card px-4 py-3 text-ink placeholder:text-mute/60"
        />
        <div className="flex flex-col gap-5 overflow-y-auto">
          {draft.parts.map((part) => (
            <PartSection key={part} part={part} query={query} />
          ))}
        </div>
        <div className="mt-auto flex gap-3">
          <button type="button" onClick={onBack} className="flex-1 rounded-2xl bg-card py-4 font-semibold text-ink active:scale-[.98]">
            上一步
          </button>
          <button
            type="button"
            disabled={draft.items.length === 0}
            onClick={onNext}
            className="flex-[2] rounded-2xl bg-iron py-4 text-lg font-bold text-white disabled:opacity-30 active:scale-[.98]"
          >
            下一步 · 记组数（{draft.items.length}）
          </button>
        </div>
      </div>
    );
  }

  function PartSection({ part, query }: { part: BodyPart; query: string }) {
    const [newName, setNewName] = useState('');
    const data = useLiveQuery(async () => {
      const [list, recent] = await Promise.all([listByPart(part), listRecentExerciseIds()]);
      const rank = (e: Exercise) => {
        const i = recent.indexOf(e.id);
        return i === -1 ? 99 : i;
      };
      return list.sort((a, b) => rank(a) - rank(b));
    }, [part]);
    const info = bodyPartInfo(part);
    const shown = (data ?? []).filter((e) => !query || e.name.includes(query));
    return (
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-mute">
          <span className="h-2 w-2 rounded-full" style={{ background: info.color }} />
          {info.name}
        </h2>
        <div className="flex flex-wrap gap-2">
          {shown.map((e) => {
            const chosen = draft.items.some((i) => i.exerciseId === e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => (chosen ? draft.removeItemByExercise(e.id) : draft.addItem(e.id))}
                className={`rounded-full px-4 py-2 text-sm active:scale-95 ${
                  chosen ? 'bg-iron font-semibold text-white' : 'bg-card text-ink'
                }`}
              >
                {e.name}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`新建${info.name}动作…`}
            className="flex-1 rounded-lg bg-card2 px-3 py-2 text-sm text-ink placeholder:text-mute/60"
          />
          <button
            type="button"
            disabled={newName.trim() === ''}
            onClick={async () => {
              const ex = await addCustomExercise(newName, part);
              draft.addItem(ex.id);
              setNewName('');
            }}
            className="rounded-lg bg-card2 px-3 py-2 text-sm text-iron disabled:opacity-30"
          >
            新建
          </button>
        </div>
      </section>
    );
  }

  function EditSets({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
    const names = useLiveQuery(
      () => getExercisesByIds(draft.items.map((i) => i.exerciseId)),
      [draft.items.length],
    );
    return (
      <div className="flex flex-1 flex-col gap-4">
        <h1 className="text-3xl font-bold">记组数</h1>
        <div className="flex flex-col gap-4 overflow-y-auto">
          {draft.items.map((item, index) => (
            <div key={item.exerciseId} className="rounded-2xl bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-semibold">{names?.get(item.exerciseId)?.name ?? '…'}</span>
                <button type="button" onClick={() => draft.removeItem(index)} className="text-sm text-mute">
                  移除
                </button>
              </div>
              <SetRows sets={item.sets} onChange={(sets) => draft.updateSets(index, sets)} />
            </div>
          ))}
        </div>
        <div className="mt-auto flex gap-3">
          <button type="button" onClick={onBack} className="flex-1 rounded-2xl bg-card py-4 font-semibold text-ink active:scale-[.98]">
            上一步
          </button>
          <button
            type="button"
            disabled={draft.items.length === 0}
            onClick={onFinish}
            className="flex-[2] rounded-2xl bg-iron py-4 text-lg font-bold text-white disabled:opacity-30 active:scale-[.98]"
          >
            完成打卡
          </button>
        </div>
      </div>
    );
  }
}

function DoneScreen({ moves, sets }: { moves: number; sets: number }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="text-6xl">🔥</span>
      <h1 className="text-3xl font-bold">已留下铁证</h1>
      <p className="text-mute">
        {moves} 个动作 · {sets} 组
      </p>
      <button
        type="button"
        onClick={() => nav('/')}
        className="mt-4 w-full rounded-2xl bg-iron py-4 text-lg font-bold text-white active:scale-[.98]"
      >
        回到今日
      </button>
    </div>
  );
}
```

注意：`Link` 未使用则删除 import（`noUnusedLocals` 会报错）；上面代码里没有用到 `Link`，**不要 import 它**。

- [ ] **Step 5: 写组件测试 `src/screens/log/LogFlow.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { seedPresets } from '../../repos/exerciseRepo';
import { resetDb } from '../../test/dbTestUtils';
import { useLogDraft } from '../../stores/logDraftStore';
import { LogFlow } from './LogFlow';

beforeEach(async () => {
  await resetDb();
  await seedPresets();
  useLogDraft.setState({ active: false, parts: [], items: [] });
  localStorage.clear();
});

test('第一步展示 7 个部位，选中后可进下一步', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <LogFlow />
    </MemoryRouter>,
  );
  expect(await screen.findByText('今天练哪儿？')).toBeInTheDocument();
  expect(screen.getByText('胸')).toBeInTheDocument();
  expect(screen.getByText('有氧')).toBeInTheDocument();

  const next = screen.getByText('下一步 · 选动作');
  expect(next).toBeDisabled();
  await user.click(screen.getByText('胸'));
  expect(next).toBeEnabled();
});
```

- [ ] **Step 6: 跑测试 + 构建 + Commit**

Run: `npm test` → 全部通过；`npm run build` → 无报错

```bash
git add src/stores src/components/SetRows.tsx src/screens/log
git commit -m "feat: 记录流（选部位/选动作/记组数三步 + 草稿持久化 + 完成打卡）"
```

### Task 12: 今日页

**Files:**
- Create: `src/components/ProgressRing.tsx`
- Modify: `src/screens/today/TodayScreen.tsx`（替换占位）
- Test: `src/screens/today/TodayScreen.test.tsx`

> **UI 任务**：动手前先读 `/Users/ericlu/.claude/skills/design-taste-frontend/SKILL.md`。

- [ ] **Step 1: 创建 `src/components/ProgressRing.tsx`**

```tsx
interface Props {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
}

/** 本周目标进度环：锻铁橙渐变描边 */
export function ProgressRing({ value, max, size = 120, stroke = 10, children }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FF5C1F" />
            <stop offset="100%" stopColor="#FF8C42" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2C2C2E" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: 改写 `src/screens/today/TodayScreen.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ProgressRing } from '../../components/ProgressRing';
import { bodyPartInfo } from '../../data/bodyParts';
import { formatToday, todayStr } from '../../lib/dates';
import { currentStreak, weekProgress } from '../../lib/stats';
import { validBodyWeight } from '../../lib/validation';
import { getProfile } from '../../repos/profileRepo';
import { getWeight, setWeight } from '../../repos/weightRepo';
import { getDayItems, listAllWorkoutDates } from '../../repos/workoutRepo';
import { useLogDraft } from '../../stores/logDraftStore';

export function TodayScreen() {
  const today = todayStr();
  const items = useLiveQuery(() => getDayItems(today), [today]);
  const data = useLiveQuery(async () => {
    const [profile, allDates] = await Promise.all([getProfile(), listAllWorkoutDates()]);
    return { profile, allDates };
  }, []);
  const draft = useLogDraft();
  const draftActive = draft.active && (draft.parts.length > 0 || draft.items.length > 0);

  const goal = data?.profile.weeklyGoal ?? 4;
  const week = data ? weekProgress(data.allDates, today) : 0;
  const streak = data ? currentStreak(new Set(data.allDates), today) : 0;

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <header>
        <p className="text-sm text-mute">{formatToday(today)}</p>
        <h1 className="text-3xl font-bold">今天，留证。</h1>
      </header>

      <div className="flex items-center gap-6 rounded-2xl bg-card p-5">
        <ProgressRing value={week} max={goal}>
          <span className="text-2xl font-bold">
            {week}
            <span className="text-base text-mute">/{goal}</span>
          </span>
          <span className="text-[11px] text-mute">本周目标</span>
        </ProgressRing>
        <div className="flex flex-col gap-2 text-sm text-mute">
          <p>
            <span className="text-xl font-bold text-ink">{streak}</span> 天连续
          </p>
          <p>
            <span className="text-xl font-bold text-ink">{data?.allDates.length ?? 0}</span> 天累计
          </p>
        </div>
      </div>

      {items && items.length > 0 && (
        <div className="rounded-2xl bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-mute">今日已练</h2>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: bodyPartInfo(item.exercise.bodyPart).color }}
                />
                <span className="flex-1">{item.exercise.name}</span>
                <span className="text-sm text-mute">{item.sets.length} 组</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        to="/log"
        className="rounded-2xl bg-iron py-4 text-center text-lg font-bold text-white active:scale-[.98]"
      >
        {items && items.length > 0
          ? '+ 继续加练'
          : draftActive
            ? '继续未完成的记录'
            : '+ 开始今日训练'}
      </Link>

      <WeightQuickEntry today={today} />
    </div>
  );
}

function WeightQuickEntry({ today }: { today: string }) {
  const existing = useLiveQuery(() => getWeight(today), [today]);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState(false);

  async function save() {
    const kg = Number(raw);
    if (!validBodyWeight(kg)) {
      setError(true);
      return;
    }
    setError(false);
    await setWeight(today, kg);
    setRaw('');
  }

  return (
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold text-mute">今日体重</h2>
      {existing && <p className="mb-2 text-2xl font-bold">{existing.weightKg} kg</p>}
      <div className="flex gap-2">
        <input
          inputMode="decimal"
          placeholder={existing ? '修改…' : '体重 kg'}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          className="flex-1 rounded-lg bg-card2 px-3 py-2 text-ink placeholder:text-mute/60"
        />
        <button
          type="button"
          disabled={raw.trim() === ''}
          onClick={save}
          className="rounded-lg bg-card2 px-4 py-2 text-iron disabled:opacity-30 active:scale-95"
        >
          记录
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-iron">体重需在 20–300kg 之间</p>}
    </div>
  );
}
```

- [ ] **Step 3: 写测试 `src/screens/today/TodayScreen.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { resetDb } from '../../test/dbTestUtils';
import { useLogDraft } from '../../stores/logDraftStore';
import { TodayScreen } from './TodayScreen';

beforeEach(async () => {
  await resetDb();
  useLogDraft.setState({ active: false, parts: [], items: [] });
  localStorage.clear();
});

test('空状态显示开始训练 CTA 与目标环', async () => {
  render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );
  expect(await screen.findByText('+ 开始今日训练')).toBeInTheDocument();
  expect(screen.getByText('今天，留证。')).toBeInTheDocument();
  expect(screen.getByText('本周目标')).toBeInTheDocument();
});

test('体重超限提示错误', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );
  await user.type(await screen.findByPlaceholderText('体重 kg'), '500');
  await user.click(screen.getByText('记录'));
  expect(await screen.findByText('体重需在 20–300kg 之间')).toBeInTheDocument();
});
```

- [ ] **Step 4: 跑测试 + Commit**

Run: `npm test` → 全部通过

```bash
git add src/components/ProgressRing.tsx src/screens/today
git commit -m "feat: 今日页（目标进度环/连击累计/今日已练/CTA 三态/体重快捷录入）"
```

---

### Task 13: 日历与日详情

**Files:**
- Modify: `src/screens/calendar/CalendarScreen.tsx`, `src/screens/calendar/DayDetailScreen.tsx`（替换占位）
- Test: `src/screens/calendar/CalendarScreen.test.tsx`

> **UI 任务**：动手前先读 `/Users/ericlu/.claude/skills/design-taste-frontend/SKILL.md`。

- [ ] **Step 1: 改写 `src/screens/calendar/CalendarScreen.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { bodyPartInfo } from '../../data/bodyParts';
import { monthGrid, shiftMonth, todayStr } from '../../lib/dates';
import type { BodyPart } from '../../lib/types';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { listPhotoDates } from '../../repos/photoRepo';
import { listItemsInRange } from '../../repos/workoutRepo';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function CalendarScreen() {
  const today = todayStr();
  const [ym, setYm] = useState(today.slice(0, 7));
  const grid = monthGrid(ym);
  const from = grid[0];
  const to = grid[41];

  const data = useLiveQuery(async () => {
    const [items, photos] = await Promise.all([listItemsInRange(from, to), listPhotoDates(from, to)]);
    const exMap = await getExercisesByIds([...new Set(items.map((i) => i.exerciseId))]);
    const parts = new Map<string, Set<BodyPart>>();
    for (const item of items) {
      const part = exMap.get(item.exerciseId)?.bodyPart;
      if (!part) continue;
      if (!parts.has(item.date)) parts.set(item.date, new Set());
      parts.get(item.date)!.add(part);
    }
    return { parts, photos };
  }, [from, to]);

  const [yyyy, mm] = ym.split('-');

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {yyyy}年{Number(mm)}月
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setYm(shiftMonth(ym, -1))}
            className="h-9 w-9 rounded-lg bg-card text-mute active:scale-95"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => setYm(shiftMonth(ym, 1))}
            className="h-9 w-9 rounded-lg bg-card text-mute active:scale-95"
          >
            ›
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-mute">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((date) => {
          const inMonth = date.startsWith(ym);
          const parts = data?.parts.get(date);
          const hasPhoto = data?.photos.has(date) ?? false;
          return (
            <Link
              key={date}
              to={`/day/${date}`}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${
                parts ? 'bg-card' : ''
              } ${inMonth ? 'text-ink' : 'text-mute/40'} ${
                date === today ? 'ring-1 ring-iron' : ''
              }`}
            >
              {hasPhoto && <span className="absolute right-0.5 top-0.5 text-[8px]">📷</span>}
              {Number(date.slice(8))}
              <span className="mt-0.5 flex h-1.5 gap-0.5">
                {parts &&
                  [...parts].slice(0, 4).map((p) => (
                    <span
                      key={p}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: bodyPartInfo(p).color }}
                    />
                  ))}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 改写 `src/screens/calendar/DayDetailScreen.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { SetRows } from '../../components/SetRows';
import { bodyPartInfo } from '../../data/bodyParts';
import { sanitizeSets } from '../../lib/validation';
import { getWeight } from '../../repos/weightRepo';
import { getDayItems, removeWorkoutItem, updateItemSets, type DayItem } from '../../repos/workoutRepo';

export function DayDetailScreen() {
  const { date = '' } = useParams();
  const nav = useNavigate();
  const items = useLiveQuery(() => getDayItems(date), [date]);
  const weight = useLiveQuery(() => getWeight(date), [date]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-8 pt-[max(env(safe-area-inset-top),16px)]">
      <header className="flex items-center gap-3">
        <button type="button" onClick={() => nav(-1)} className="py-2 pr-2 text-mute">
          返回
        </button>
        <h1 className="text-xl font-bold">{date}</h1>
      </header>

      {items && items.length === 0 && <p className="py-8 text-center text-mute">这天没有训练记录</p>}

      {items?.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}

      {weight && (
        <div className="flex items-center justify-between rounded-2xl bg-card p-4">
          <span className="text-sm text-mute">当日体重</span>
          <span className="text-xl font-bold">{weight.weightKg} kg</span>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item }: { item: DayItem }) {
  const [editing, setEditing] = useState(false);
  const [sets, setSets] = useState(item.sets);
  const info = bodyPartInfo(item.exercise.bodyPart);

  const summary = item.sets
    .map((s) => (s.weight !== undefined && s.reps !== undefined ? `${s.weight}×${s.reps}` : null))
    .filter((s) => s !== null);

  return (
    <div className="rounded-2xl bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: info.color }} />
        <span className="flex-1 font-semibold">{item.exercise.name}</span>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setSets(item.sets);
              setEditing(true);
            }}
            className="text-sm text-iron"
          >
            编辑
          </button>
        )}
      </div>
      {!editing && (
        <p className="text-sm text-mute">
          {summary.length > 0 ? summary.join('  ') : `${item.sets.length} 组`}
        </p>
      )}
      {editing && (
        <div className="flex flex-col gap-3">
          <SetRows sets={sets} onChange={setSets} />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                await updateItemSets(item.id, sanitizeSets(sets));
                setEditing(false);
              }}
              className="flex-1 rounded-lg bg-iron py-2 text-sm font-semibold text-white active:scale-95"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-lg bg-card2 py-2 text-sm text-ink active:scale-95"
            >
              取消
            </button>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('删除这个动作记录？')) await removeWorkoutItem(item.id);
              }}
              className="flex-1 rounded-lg bg-card2 py-2 text-sm text-iron active:scale-95"
            >
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 写测试 `src/screens/calendar/CalendarScreen.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetDb } from '../../test/dbTestUtils';
import { CalendarScreen } from './CalendarScreen';

beforeEach(resetDb);

test('渲染当月标题与星期行', async () => {
  render(
    <MemoryRouter>
      <CalendarScreen />
    </MemoryRouter>,
  );
  expect(await screen.findByText('2026年7月')).toBeInTheDocument();
  expect(screen.getByText('一')).toBeInTheDocument();
  expect(screen.getByLabelText('上个月')).toBeInTheDocument();
});
```

注意：该测试依赖系统日期在 2026-07；若执行日期不同，用 `vi.setSystemTime(new Date('2026-07-08'))`（`beforeEach` 中 `vi.useFakeTimers({ shouldAdvanceTime: true })`，`afterEach` 中 `vi.useRealTimers()`）固定日期，断言不变。

- [ ] **Step 4: 跑测试 + 构建 + Commit**

Run: `npm test` → 全部通过；`npm run build` → 无报错

```bash
git add src/screens/calendar
git commit -m "feat: 日历月视图（部位色点/照片角标/今日描边）与日详情（编辑/删除/当日体重）"
```

### Task 14: 数据页（四类图表 + 累计大数字）

**Files:**
- Create: `src/components/charts.tsx`
- Modify: `src/screens/stats/StatsScreen.tsx`（替换占位）

> **UI 任务**：动手前先读 `/Users/ericlu/.claude/skills/design-taste-frontend/SKILL.md`。
>
> **本任务不写组件测试**：Chart.js 需要真实 canvas，jsdom 跑不了；数据变换已在 Task 9 全量单测。完成后用浏览器手动验证（`npm run dev`，造几条数据看四张图）。

- [ ] **Step 1: 创建 `src/components/charts.tsx`（按需注册 + 暗色默认值）**

```tsx
import {
  BarElement, CategoryScale, Chart as ChartJS, Filler, LinearScale, LineElement,
  PointElement, RadialLinearScale, Tooltip,
} from 'chart.js';

ChartJS.register(
  RadialLinearScale, CategoryScale, LinearScale,
  PointElement, LineElement, BarElement, Filler, Tooltip,
);

ChartJS.defaults.color = '#8e8e93';
ChartJS.defaults.borderColor = '#2c2c2e';
ChartJS.defaults.font.family = "-apple-system, 'PingFang SC', sans-serif";

export { Line, Radar, Chart as MixedChart } from 'react-chartjs-2';
```

- [ ] **Step 2: 改写 `src/screens/stats/StatsScreen.tsx`**

关键约束：**items 与打卡日期必须全量拉取**（12 周柱状图与累计大数字要看全历史），只有雷达按 30/90/365 天过滤。

```tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Line, MixedChart, Radar } from '../../components/charts';
import { BODY_PARTS } from '../../data/bodyParts';
import { addDays, todayStr } from '../../lib/dates';
import {
  countByBodyPart, maxWeightSeries, movingAverage, totals, weeklyCounts,
} from '../../lib/stats';
import type { BodyPart } from '../../lib/types';
import { getExercisesByIds } from '../../repos/exerciseRepo';
import { getProfile } from '../../repos/profileRepo';
import { listWeights } from '../../repos/weightRepo';
import { listAllItems, listAllWorkoutDates } from '../../repos/workoutRepo';

const RANGES = [30, 90, 365] as const;

export function StatsScreen() {
  const today = todayStr();
  const [rangeDays, setRangeDays] = useState<(typeof RANGES)[number]>(30);
  const [strengthExId, setStrengthExId] = useState('');

  const data = useLiveQuery(async () => {
    const [items, dates, weights, profile] = await Promise.all([
      listAllItems(),
      listAllWorkoutDates(),
      listWeights(addDays(today, -364), today),
      getProfile(),
    ]);
    const exMap = await getExercisesByIds([...new Set(items.map((i) => i.exerciseId))]);
    return { items, dates, weights, profile, exMap };
  }, [today]);

  if (!data) return null;

  const { items, dates, weights, profile, exMap } = data;

  const rangeFrom = addDays(today, -(rangeDays - 1));
  const radarParts = items
    .filter((i) => i.date >= rangeFrom)
    .map((i) => exMap.get(i.exerciseId)?.bodyPart)
    .filter((p): p is BodyPart => p !== undefined);
  const radarCounts = countByBodyPart(radarParts);

  const weeks = weeklyCounts(dates, 12, today);
  const sums = totals(items, dates);

  const strengthOptions = [...exMap.values()].filter((ex) =>
    items.some((i) => i.exerciseId === ex.id && i.sets.some((s) => s.weight !== undefined)),
  );
  const strengthEx = strengthOptions.find((e) => e.id === strengthExId) ?? strengthOptions[0];
  const strength = strengthEx
    ? maxWeightSeries(items.filter((i) => i.exerciseId === strengthEx.id))
    : [];

  const weightValues = weights.map((w) => w.weightKg);
  const weightMa = movingAverage(weightValues, 7);

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <h1 className="text-2xl font-bold">数据</h1>

      <div className="grid grid-cols-3 gap-3">
        <BigNumber label="总打卡天数" value={sums.days} />
        <BigNumber label="总组数" value={sums.sets} />
        <BigNumber label="总容量 kg" value={Math.round(sums.volumeKg)} />
      </div>

      <section className="rounded-2xl bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-mute">部位频次</h2>
          <div className="flex gap-1">
            {RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRangeDays(d)}
                className={`rounded-md px-2 py-1 text-xs ${
                  rangeDays === d ? 'bg-iron/15 text-iron' : 'text-mute'
                }`}
              >
                {d}天
              </button>
            ))}
          </div>
        </div>
        <Radar
          data={{
            labels: BODY_PARTS.map((p) => p.name),
            datasets: [
              {
                data: BODY_PARTS.map((p) => radarCounts[p.id]),
                backgroundColor: 'rgba(255,92,31,0.25)',
                borderColor: '#FF5C1F',
                pointBackgroundColor: '#FF5C1F',
              },
            ],
          }}
          options={{ scales: { r: { ticks: { display: false }, beginAtZero: true } } }}
        />
      </section>

      <section className="rounded-2xl bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-mute">周训练频次 · 近 12 周</h2>
        <MixedChart
          type="bar"
          data={{
            labels: weeks.map((w) => w.weekStart.slice(5)),
            datasets: [
              {
                type: 'bar' as const,
                data: weeks.map((w) => w.count),
                backgroundColor: '#FF5C1F',
                borderRadius: 4,
              },
              {
                type: 'line' as const,
                data: weeks.map(() => profile.weeklyGoal),
                borderColor: '#8E8E93',
                borderDash: [6, 4],
                pointRadius: 0,
              },
            ],
          }}
          options={{ scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }}
        />
      </section>

      {weights.length > 0 && (
        <section className="rounded-2xl bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-mute">体重趋势 · 7 日均线</h2>
          <Line
            data={{
              labels: weights.map((w) => w.date.slice(5)),
              datasets: [
                {
                  data: weightValues,
                  borderColor: 'rgba(255,92,31,0.4)',
                  pointRadius: 2,
                  pointBackgroundColor: '#FF5C1F',
                },
                { data: weightMa, borderColor: '#FF8C42', pointRadius: 0, tension: 0.3 },
              ],
            }}
          />
        </section>
      )}

      {strengthEx && (
        <section className="rounded-2xl bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-mute">力量曲线 · 每日最大重量</h2>
            <select
              value={strengthEx.id}
              onChange={(e) => setStrengthExId(e.target.value)}
              className="rounded-md bg-card2 px-2 py-1 text-xs text-ink"
            >
              {strengthOptions.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>
          <Line
            data={{
              labels: strength.map((s) => s.date.slice(5)),
              datasets: [
                {
                  data: strength.map((s) => s.maxKg),
                  borderColor: '#FF5C1F',
                  pointBackgroundColor: '#FF5C1F',
                  tension: 0.2,
                },
              ],
            }}
          />
        </section>
      )}
    </div>
  );
}

function BigNumber({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-card p-3 text-center">
      <p className="text-2xl font-bold text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-mute">{label}</p>
    </div>
  );
}
```

- [ ] **Step 3: 构建 + 手动浏览器验证**

Run: `npm run build` → 无 TS 报错
Run: `npm run dev` → 打开页面，先在记录流造 2–3 天数据（含重量）+ 记 2 个体重，切到「数据」Tab 检查：雷达随 30/90/365 切换、柱状图有目标虚线、体重两条线、力量曲线可换动作。

- [ ] **Step 4: 全量测试 + Commit**

Run: `npm test` → 全部通过（本任务无新增测试，确认无回归）

```bash
git add src/components/charts.tsx src/screens/stats
git commit -m "feat: 数据页（部位雷达/周频次+目标线/体重均线/力量曲线/累计大数字）"
```

### Task 15: 拍照打卡（压缩管道 + 照片卡片 + 时间轴）

**Files:**
- Create: `src/lib/image.ts`, `src/components/PhotoCard.tsx`, `src/components/PhotoTimeline.tsx`
- Modify: `src/screens/today/TodayScreen.tsx`, `src/screens/log/LogFlow.tsx`, `src/screens/calendar/DayDetailScreen.tsx`, `src/screens/stats/StatsScreen.tsx`（各插一行）
- Test: `src/lib/image.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/image.test.ts`（纯尺寸计算可测；压缩本身依赖浏览器 API，手动验证）**

```ts
import { fitWithin } from './image';

test('横图长边压到 1280', () => {
  expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
});

test('竖图长边压到 1280', () => {
  expect(fitWithin(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 });
});

test('小图不放大', () => {
  expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
});
```

- [ ] **Step 2: 跑测试确认失败，然后实现 `src/lib/image.ts`**

Run: `npx vitest run src/lib/image.test.ts` → FAIL

```ts
/** 长边限制在 max 内的等比缩放，小图不放大 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** 规格 §9：长边 1280、JPEG q0.8，产出约 100–200KB */
export async function compressImage(file: Blob, max = 1280, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}
```

Run: `npx vitest run src/lib/image.test.ts` → 3 passed

- [ ] **Step 3: 创建 `src/components/PhotoCard.tsx`（自包含：各页面一行接入）**

```tsx
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { compressImage } from '../lib/image';
import { log } from '../lib/logger';
import { getPhoto, removePhoto, savePhoto } from '../repos/photoRepo';

export function PhotoCard({ date }: { date: string }) {
  const photo = useLiveQuery(() => getPhoto(date), [date]);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) {
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setError(false);
      await savePhoto(date, await compressImage(file));
    } catch (err) {
      log(`photo compress: ${String(err)}`);
      setError(true);
    }
  }

  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-mute">体型铁证</h2>
        <span className="text-[11px] text-mute">仅存本机</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      {!url && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-xl border border-dashed border-line py-6 text-mute active:scale-[.98]"
        >
          📷 拍一张，留下今天的证据
        </button>
      )}
      {url && (
        <div className="flex flex-col gap-2">
          <img src={url} alt={`${date} 体型照片`} className="max-h-80 w-full rounded-xl object-cover" />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex-1 rounded-lg bg-card2 py-2 text-sm text-ink active:scale-95"
            >
              重拍
            </button>
            <button
              type="button"
              onClick={async () => {
                if (window.confirm('删除这张照片？')) await removePhoto(date);
              }}
              className="flex-1 rounded-lg bg-card2 py-2 text-sm text-iron active:scale-95"
            >
              删除
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-iron">照片处理失败，请重试或换一张</p>}
    </div>
  );
}
```

- [ ] **Step 4: 创建 `src/components/PhotoTimeline.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listPhotos } from '../repos/photoRepo';
import type { Photo } from '../lib/types';

export function PhotoTimeline() {
  const photos = useLiveQuery(() => listPhotos(), []);
  if (!photos || photos.length === 0) return null;
  return (
    <section className="rounded-2xl bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-mute">体型时间轴</h2>
        <span className="text-[11px] text-mute">仅存本机</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((p) => (
          <Thumb key={p.id} photo={p} />
        ))}
      </div>
    </section>
  );
}

function Thumb({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return (
    <figure className="shrink-0">
      <img src={url} alt={photo.date} className="h-24 w-24 rounded-lg object-cover" />
      <figcaption className="mt-1 text-center text-[10px] text-mute">{photo.date.slice(5)}</figcaption>
    </figure>
  );
}
```

- [ ] **Step 5: 四个页面各插一行**

`src/screens/today/TodayScreen.tsx`：顶部 import 加 `import { PhotoCard } from '../../components/PhotoCard';`，在 `<WeightQuickEntry today={today} />` 之后加：

```tsx
      <PhotoCard date={today} />
```

`src/screens/log/LogFlow.tsx`：顶部 import 加 `import { PhotoCard } from '../../components/PhotoCard';`，`DoneScreen` 里「回到今日」按钮之前加：

```tsx
      <div className="w-full">
        <PhotoCard date={todayStr()} />
      </div>
```

`src/screens/calendar/DayDetailScreen.tsx`：顶部 import 加 `import { PhotoCard } from '../../components/PhotoCard';`，当日体重卡片之后加：

```tsx
      <PhotoCard date={date} />
```

`src/screens/stats/StatsScreen.tsx`：顶部 import 加 `import { PhotoTimeline } from '../../components/PhotoTimeline';`，最后一个 `</section>` 之后（最外层 div 收尾前）加：

```tsx
      <PhotoTimeline />
```

- [ ] **Step 6: 全量测试 + 构建 + Commit**

Run: `npm test` → 全部通过；`npm run build` → 无报错

```bash
git add src/lib/image.ts src/lib/image.test.ts src/components/PhotoCard.tsx src/components/PhotoTimeline.tsx src/screens
git commit -m "feat: 拍照打卡（压缩管道/每日一张/重拍删除/时间轴，本地私密）"
```

---

### Task 16: 我的页（目标设置 / 动作库管理 / 数据导出）

**Files:**
- Create: `src/lib/exportData.ts`, `src/components/ExerciseManager.tsx`
- Modify: `src/screens/profile/ProfileScreen.tsx`（替换占位）
- Test: `src/lib/exportData.test.ts`

- [ ] **Step 1: 写失败测试 `src/lib/exportData.test.ts`**

```ts
import { resetDb } from '../test/dbTestUtils';
import { seedPresets } from '../repos/exerciseRepo';
import { addWorkoutItem } from '../repos/workoutRepo';
import { buildJsonExport, buildWorkoutCsv, csvEscape } from './exportData';

beforeEach(async () => {
  await resetDb();
  await seedPresets();
});

test('csvEscape 处理逗号/引号/换行', () => {
  expect(csvEscape('plain')).toBe('plain');
  expect(csvEscape('a,b')).toBe('"a,b"');
  expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
});

test('buildWorkoutCsv 每组一行、空值留空', async () => {
  await addWorkoutItem('2026-07-08', 'p-bench', [{ weight: 60, reps: 10 }, {}]);
  const csv = await buildWorkoutCsv();
  const lines = csv.split('\n');
  expect(lines[0]).toBe('date,exercise,body_part,set,weight_kg,reps');
  expect(lines[1]).toBe('2026-07-08,杠铃卧推,chest,1,60,10');
  expect(lines[2]).toBe('2026-07-08,杠铃卧推,chest,2,,');
});

test('buildJsonExport 含全部表（照片除外）', async () => {
  await addWorkoutItem('2026-07-08', 'p-bench', [{}]);
  const json = JSON.parse(await buildJsonExport());
  expect(json.workouts).toHaveLength(1);
  expect(json.workoutItems).toHaveLength(1);
  expect(json.exercises).toHaveLength(40);
  expect(json.exportedAt).toBeTruthy();
  expect(json).not.toHaveProperty('photos');
});
```

- [ ] **Step 2: 跑测试确认失败，然后实现 `src/lib/exportData.ts`**

Run: `npx vitest run src/lib/exportData.test.ts` → FAIL

```ts
import { db } from './db';

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
}

/** 每组一行的扁平 CSV（数据主权，规格 §3） */
export async function buildWorkoutCsv(): Promise<string> {
  const [workouts, items, exercises] = await Promise.all([
    db.workouts.toArray(),
    db.workoutItems.toArray(),
    db.exercises.toArray(),
  ]);
  const dateOf = new Map(
    workouts.filter((w) => w.deletedAt === null).map((w) => [w.id, w.date]),
  );
  const exOf = new Map(exercises.map((e) => [e.id, e]));
  const rows: string[][] = [];
  const active = items
    .filter((i) => i.deletedAt === null && dateOf.has(i.workoutId))
    .sort((a, b) => {
      const d = dateOf.get(a.workoutId)!.localeCompare(dateOf.get(b.workoutId)!);
      return d !== 0 ? d : a.order - b.order;
    });
  for (const item of active) {
    const ex = exOf.get(item.exerciseId);
    item.sets.forEach((s, i) => {
      rows.push([
        dateOf.get(item.workoutId)!,
        ex?.name ?? item.exerciseId,
        ex?.bodyPart ?? '',
        String(i + 1),
        s.weight !== undefined ? String(s.weight) : '',
        s.reps !== undefined ? String(s.reps) : '',
      ]);
    });
  }
  return toCsv(['date', 'exercise', 'body_part', 'set', 'weight_kg', 'reps'], rows);
}

/** 全量 JSON 备份；照片是二进制不进 JSON（UI 里注明） */
export async function buildJsonExport(): Promise<string> {
  const [workouts, workoutItems, exercises, weightLogs, profile] = await Promise.all([
    db.workouts.toArray(),
    db.workoutItems.toArray(),
    db.exercises.toArray(),
    db.weightLogs.toArray(),
    db.profile.toArray(),
  ]);
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), workouts, workoutItems, exercises, weightLogs, profile },
    null,
    2,
  );
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Run: `npx vitest run src/lib/exportData.test.ts` → 3 passed

- [ ] **Step 3: 创建 `src/components/ExerciseManager.tsx`**

```tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BODY_PARTS, bodyPartInfo } from '../data/bodyParts';
import type { BodyPart } from '../lib/types';
import { addCustomExercise, listByPart, removeExercise, renameExercise } from '../repos/exerciseRepo';

export function ExerciseManager() {
  const [open, setOpen] = useState(false);
  const [part, setPart] = useState<BodyPart>('chest');
  const [newName, setNewName] = useState('');
  const list = useLiveQuery(() => listByPart(part), [part]);
  const info = bodyPartInfo(part);

  return (
    <div className="rounded-2xl bg-card p-5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between"
      >
        <h2 className="text-sm font-semibold text-mute">动作库管理</h2>
        <span className="text-sm text-iron">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {BODY_PARTS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPart(p.id)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  part === p.id ? 'bg-iron/15 font-semibold text-iron' : 'bg-card2 text-mute'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <ul className="flex flex-col gap-2">
            {list?.map((ex) => (
              <li key={ex.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{ex.name}</span>
                {ex.preset && <span className="rounded bg-card2 px-1.5 py-0.5 text-[10px] text-mute">预置</span>}
                {!ex.preset && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        const name = window.prompt('新名称', ex.name);
                        if (name && name.trim()) await renameExercise(ex.id, name);
                      }}
                      className="text-mute"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (window.confirm(`删除「${ex.name}」？已有记录不受影响。`)) {
                          await removeExercise(ex.id);
                        }
                      }}
                      className="text-iron"
                    >
                      删除
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`新建${info.name}动作…`}
              className="flex-1 rounded-lg bg-card2 px-3 py-2 text-sm text-ink placeholder:text-mute/60"
            />
            <button
              type="button"
              disabled={newName.trim() === ''}
              onClick={async () => {
                await addCustomExercise(newName, part);
                setNewName('');
              }}
              className="rounded-lg bg-card2 px-3 py-2 text-sm text-iron disabled:opacity-30"
            >
              新建
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 改写 `src/screens/profile/ProfileScreen.tsx`**

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { ExerciseManager } from '../../components/ExerciseManager';
import { todayStr } from '../../lib/dates';
import { buildJsonExport, buildWorkoutCsv, downloadText } from '../../lib/exportData';
import { getProfile, saveProfile } from '../../repos/profileRepo';

export function ProfileScreen() {
  const profile = useLiveQuery(() => getProfile(), []);
  if (!profile) return null;

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <h1 className="text-2xl font-bold">我的</h1>

      <div className="flex items-center justify-between rounded-2xl bg-card p-5">
        <div>
          <h2 className="font-semibold">云同步</h2>
          <p className="mt-1 text-sm text-mute">换手机不丢数据 · 照片云备份</p>
        </div>
        <span className="rounded-full bg-card2 px-3 py-1 text-xs text-mute">Phase 2 · 敬请期待</span>
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-card p-5">
        <h2 className="font-semibold">每周目标</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="减少目标"
            disabled={profile.weeklyGoal <= 1}
            onClick={() => saveProfile({ weeklyGoal: profile.weeklyGoal - 1 })}
            className="h-9 w-9 rounded-lg bg-card2 text-lg disabled:opacity-30 active:scale-95"
          >
            −
          </button>
          <span className="min-w-14 text-center text-lg font-bold">{profile.weeklyGoal} 练/周</span>
          <button
            type="button"
            aria-label="增加目标"
            disabled={profile.weeklyGoal >= 7}
            onClick={() => saveProfile({ weeklyGoal: profile.weeklyGoal + 1 })}
            className="h-9 w-9 rounded-lg bg-card2 text-lg disabled:opacity-30 active:scale-95"
          >
            ＋
          </button>
        </div>
      </div>

      <ExerciseManager />

      <div className="rounded-2xl bg-card p-5">
        <h2 className="mb-1 font-semibold">数据导出</h2>
        <p className="mb-3 text-sm text-mute">数据主权归你。照片仅存本机，不含在导出文件中。</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              downloadText(`tiezheng-${todayStr()}.csv`, await buildWorkoutCsv(), 'text/csv');
            }}
            className="flex-1 rounded-lg bg-card2 py-3 text-sm font-semibold text-ink active:scale-95"
          >
            导出 CSV
          </button>
          <button
            type="button"
            onClick={async () => {
              downloadText(`tiezheng-${todayStr()}.json`, await buildJsonExport(), 'application/json');
            }}
            className="flex-1 rounded-lg bg-card2 py-3 text-sm font-semibold text-ink active:scale-95"
          >
            导出 JSON
          </button>
        </div>
      </div>

      <p className="py-4 text-center text-xs text-mute">铁证 IRONPROOF · 你练过的，都有铁证</p>
    </div>
  );
}
```

- [ ] **Step 5: 全量测试 + 构建 + Commit**

Run: `npm test` → 全部通过；`npm run build` → 无报错

```bash
git add src/lib/exportData.ts src/lib/exportData.test.ts src/components/ExerciseManager.tsx src/screens/profile
git commit -m "feat: 我的页（每周目标步进/动作库管理/CSV+JSON 导出/云同步占位）"
```

### Task 17: 首次引导

**Files:**
- Create: `src/screens/Onboarding.tsx`
- Modify: `src/App.tsx`（TabLayout 加引导门）, `src/App.test.tsx`
- Test: `src/App.test.tsx`

> **UI 任务**：动手前先读 `/Users/ericlu/.claude/skills/design-taste-frontend/SKILL.md`。

- [ ] **Step 1: 创建 `src/screens/Onboarding.tsx`**

注意：此时 logo.svg 还不存在（Task 18 才做），品牌块用纯 CSS 渐变「铁」字实现，不引用任何图片。

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveProfile } from '../repos/profileRepo';

const GOALS = [3, 4, 5];

export function Onboarding() {
  const nav = useNavigate();
  const [goal, setGoal] = useState(4);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-8 text-center">
      <div
        className="flex h-24 w-24 items-center justify-center rounded-3xl text-5xl font-black text-white"
        style={{ background: 'linear-gradient(135deg, #FF5C1F, #FF8C42)' }}
      >
        铁
      </div>
      <div>
        <h1 className="text-3xl font-bold">你练过的，都有铁证。</h1>
        <p className="mt-2 text-sm text-mute">数据存在你手机本地，无广告，无推销。</p>
      </div>
      <div className="w-full">
        <p className="mb-3 text-sm text-mute">每周想练几次？</p>
        <div className="flex justify-center gap-3">
          {GOALS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGoal(g)}
              className={`h-14 w-14 rounded-2xl text-xl font-bold active:scale-95 ${
                goal === g ? 'bg-iron text-white' : 'bg-card text-ink'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={async () => {
          await saveProfile({ weeklyGoal: goal, onboarded: true });
          nav('/log');
        }}
        className="w-full rounded-2xl bg-iron py-4 text-lg font-bold text-white active:scale-[.98]"
      >
        开始第一次打卡
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `src/App.tsx` 的 TabLayout 加引导门**

顶部 import 加：

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { Onboarding } from './screens/Onboarding';
import { getProfile } from './repos/profileRepo';
```

`TabLayout` 函数替换为：

```tsx
function TabLayout() {
  const profile = useLiveQuery(() => getProfile(), []);
  if (!profile) return null;
  if (!profile.onboarded) return <Onboarding />;
  return (
    <div className="mx-auto min-h-dvh max-w-md pb-24 pt-[env(safe-area-inset-top)]">
      <Outlet />
      <TabBar />
    </div>
  );
}
```

- [ ] **Step 3: 改写 `src/App.test.tsx`（新用户见引导，老用户见 Tab）**

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';
import { db } from './lib/db';
import { resetDb } from './test/dbTestUtils';

beforeEach(async () => {
  window.location.hash = '';
  await resetDb();
});

test('新用户先看到首次引导', async () => {
  render(<App />);
  expect(await screen.findByText('开始第一次打卡')).toBeInTheDocument();
  expect(screen.getByText('你练过的，都有铁证。')).toBeInTheDocument();
});

test('已引导用户直接进 4 Tab 主界面', async () => {
  await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
  render(<App />);
  expect(await screen.findByText('今日')).toBeInTheDocument();
  expect(screen.getByText('日历')).toBeInTheDocument();
  expect(screen.getByText('数据')).toBeInTheDocument();
  expect(screen.getByText('我的')).toBeInTheDocument();
});
```

- [ ] **Step 4: 跑测试 + 构建 + Commit**

Run: `npm test` → 全部通过；`npm run build` → 无报错

```bash
git add src/screens/Onboarding.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: 首次引导（选每周目标→直接进第一次打卡）与引导门"
```

---

### Task 18: Logo 与全套图标

**Files:**
- Create: `public/logo.svg`, `pwa-assets.config.ts`
- Modify: `index.html`
- 生成产物: `public/pwa-64x64.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png`, `public/maskable-icon-512x512.png`, `public/apple-touch-icon-180x180.png`, `public/favicon.ico`

- [ ] **Step 1: 创建 `public/logo.svg`（斜杠铃 + 印章框，180px 下清晰可辨）**

```svg
<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FF5C1F"/>
      <stop offset="100%" stop-color="#FF8C42"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="#0A0A0B"/>
  <rect x="88" y="88" width="336" height="336" rx="48" fill="none" stroke="url(#g)" stroke-width="14" opacity="0.35"/>
  <g transform="rotate(-45 256 256)">
    <rect x="106" y="244" width="300" height="24" rx="12" fill="url(#g)"/>
    <rect x="130" y="196" width="34" height="120" rx="14" fill="url(#g)"/>
    <rect x="180" y="176" width="40" height="160" rx="16" fill="url(#g)"/>
    <rect x="292" y="176" width="40" height="160" rx="16" fill="url(#g)"/>
    <rect x="348" y="196" width="34" height="120" rx="14" fill="url(#g)"/>
  </g>
</svg>
```

意象：印章边框 =「铁证如山」，45° 上扬杠铃 =「撸铁 + 上升曲线」。

- [ ] **Step 2: 创建 `pwa-assets.config.ts`**

```ts
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: {
      sizes: [512],
      padding: 0.3,
      resizeOptions: { background: '#0A0A0B' },
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { background: '#0A0A0B' },
    },
  },
  images: ['public/logo.svg'],
});
```

- [ ] **Step 3: 生成图标**

Run: `npm run icons`
Expected: `public/` 下出现 pwa-64x64.png、pwa-192x192.png、pwa-512x512.png、maskable-icon-512x512.png、apple-touch-icon-180x180.png、favicon.ico

- [ ] **Step 4: `index.html` 的 `<head>` 中加图标链接**

在现有 meta 标签之后加：

```html
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/logo.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
```

- [ ] **Step 5: 构建 + Commit**

Run: `npm run build` → 无报错

```bash
git add public pwa-assets.config.ts index.html
git commit -m "feat: 铁证 Logo（印章+斜杠铃）与全套 PWA/苹果图标"
```

---

### Task 19: PWA（manifest / SW 更新提示 / iOS 安装引导）

**Files:**
- Create: `src/components/UpdateToast.tsx`, `src/components/InstallHint.tsx`
- Modify: `vite.config.ts`, `src/vite-env.d.ts`, `src/App.tsx`, `.gitignore`

- [ ] **Step 1: `vite.config.ts` 加 VitePWA 插件**

顶部 import 加 `import { VitePWA } from 'vite-plugin-pwa';`，`plugins` 数组追加：

```ts
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['logo.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: '铁证 IRONPROOF',
        short_name: '铁证',
        description: '你练过的，都有铁证',
        lang: 'zh-CN',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0A0A0B',
        background_color: '#0A0A0B',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
```

- [ ] **Step 2: `src/vite-env.d.ts` 加类型引用**

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
```

- [ ] **Step 3: 创建 `src/components/UpdateToast.tsx`**

```tsx
import { useRegisterSW } from 'virtual:pwa-register/react';

/** 规格 §11：新版本顶部提示「点击更新」 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <button
      type="button"
      onClick={() => updateServiceWorker(true)}
      className="fixed left-1/2 top-[max(env(safe-area-inset-top),12px)] z-50 -translate-x-1/2 rounded-full bg-iron px-4 py-2 text-sm font-semibold text-white shadow-lg active:scale-95"
    >
      新版本已就绪 · 点击更新
    </button>
  );
}
```

- [ ] **Step 4: 创建 `src/components/InstallHint.tsx`**

```tsx
import { useState } from 'react';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone))
  );
}

const DISMISS_KEY = 'installHintDismissed';

/** iOS Safari 无安装 API：提示「分享→添加到主屏幕」。微信内提示先用 Safari 打开。 */
export function InstallHint() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1',
  );
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

  if (dismissed || !isIOS || isStandalone()) return null;
  return (
    <div className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-card p-4 text-sm shadow-lg">
      <span className="flex-1">
        {isWeChat
          ? '用 Safari 打开后：分享 → 添加到主屏幕，即可像 App 一样使用'
          : '点底部「分享」→「添加到主屏幕」，即可像 App 一样使用'}
      </span>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        className="shrink-0 text-mute"
      >
        知道了
      </button>
    </div>
  );
}
```

- [ ] **Step 5: `src/App.tsx` 挂载两个组件**

顶部 import 加：

```tsx
import { InstallHint } from './components/InstallHint';
import { UpdateToast } from './components/UpdateToast';
```

`App` 的 return 改为（ErrorBoundary 内、HashRouter 外挂 toast 与安装提示）：

```tsx
    <ErrorBoundary>
      <UpdateToast />
      <InstallHint />
      <HashRouter>
        <Routes>
          <Route path="/log" element={<LogFlow />} />
          <Route path="/day/:date" element={<DayDetailScreen />} />
          <Route element={<TabLayout />}>
            <Route path="/" element={<TodayScreen />} />
            <Route path="/calendar" element={<CalendarScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
```

- [ ] **Step 6: `.gitignore` 追加一行**

```
dev-dist/
```

- [ ] **Step 7: 全量测试 + 构建 + Commit**

Run: `npm test` → 全部通过（vitest alias 已把 virtual:pwa-register/react 指到 mock）
Run: `npm run build` → dist/ 里有 sw.js 与 manifest.webmanifest
Run: `npm run preview` → 浏览器打开，DevTools → Application 确认 manifest 与 SW 注册成功

```bash
git add vite.config.ts src/vite-env.d.ts src/components/UpdateToast.tsx src/components/InstallHint.tsx src/App.tsx .gitignore
git commit -m "feat: PWA（manifest/SW 更新提示/iOS 添加主屏引导）"
```

---

### Task 20: 收尾（CI / iOS 真机清单 / README / 远程仓库）

**Files:**
- Create: `.github/workflows/ci.yml`, `docs/checklists/ios-device.md`, `README.md`

- [ ] **Step 1: 创建 `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: 创建 `docs/checklists/ios-device.md`**

```markdown
# iOS 真机验收清单（规格 §15）

在 iPhone Safari 上逐项验证，全部打勾才算 Phase 1 完成：

- [ ] 添加到主屏幕后全屏打开，无浏览器地址栏
- [ ] 灵动岛/刘海与底部横条不遮挡内容（安全区生效）
- [ ] 双击、双指缩放均无效；输入框聚焦不触发页面放大
- [ ] 飞行模式下完成一次完整打卡（部位→动作→组数→完成）
- [ ] 飞行模式下记体重、拍照均成功
- [ ] 从主屏杀掉 App 再打开，数据完好
- [ ] 记录流中途退出再进入，草稿恢复到原步骤
- [ ] 发新版后打开 App，顶部出现「新版本已就绪 · 点击更新」，点击后生效
- [ ] 微信内打开链接可正常浏览，并出现「用 Safari 打开」提示
- [ ] 安装提示点「知道了」后不再出现
```

- [ ] **Step 3: 创建 `README.md`**

````markdown
# 铁证 IRONPROOF

> 你练过的，都有铁证。

面向健身爱好者的本地优先打卡 PWA：训练记录、日历、体重、图表、拍照留证。数据存在手机本地（IndexedDB），断网照样用，支持一键导出 CSV/JSON。

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # 全量单测（Vitest）
npm run typecheck  # TS 检查
npm run build      # 类型检查 + 生产构建 → dist/
npm run preview    # 本地预览生产构建（验 PWA）
npm run icons      # 从 public/logo.svg 重新生成全套图标
```

## 部署（Cloudflare Pages，手动）

```bash
npm run build
npx wrangler pages deploy dist --project-name tiezheng
```

首次执行会引导登录 Cloudflare 账号。验证期手动部署，Phase 2 再接自动化。

## 路线图

- Phase 1（当前）：单机完整版 —— 记录/日历/体重/图表/拍照/PWA
- Phase 2：邮箱账号 + 云同步（Supabase）
- Phase 3：铁证海报（季/半年/年）+ 微信引导 + 隐私政策
````

- [ ] **Step 4: 全量测试 + Commit**

Run: `npm test` && `npm run build` → 全部通过

```bash
git add .github docs/checklists/ios-device.md README.md
git commit -m "chore: CI 工作流、iOS 真机验收清单、README"
```

- [ ] **Step 5: 创建远程仓库并推送**

```bash
gh repo create tiezheng --private --source=. --push
```

Expected: 推送成功，GitHub Actions 首跑绿色。

- [ ] **Step 6: 部署前与用户确认**

`npx wrangler pages deploy` 需要用户的 Cloudflare 账号登录——**执行到这一步时先询问用户**，用户确认后再跑：

```bash
npm run build
npx wrangler pages deploy dist --project-name tiezheng
```

---

## 完成定义

全部 Task 完成后，Phase 1 交付物为：

1. `npm test` 全绿、`npm run build` 无警告错误。
2. 手机浏览器访问部署地址可完整走通：引导 → 打卡 → 日历回看 → 数据图表 → 导出。
3. `docs/checklists/ios-device.md` 真机逐项验收通过。
