# 铁证引导跳过与健康入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不创建训练记录或训练草稿的前提下，让用户从首次引导最后一页进入今日页，并从今日页的低强调饮食摘要进入独立全屏 `/health` 空壳。

**Architecture:** 保留现有 `OnboardingGate` 和四 Tab 信息架构；引导的两个出口共用一个由 `submittingRef` 保护的完成函数，只有目标路由、history 行为和白名单事件名不同。`/health` 与 `/log`、`/day/:date`、`/poster` 同级挂在 `TabLayout` 外，今日页只增加无营养数据依赖的空态摘要入口；这一计划不创建营养类型、Dexie 表、repo 或计算逻辑。

**Tech Stack:** React 19、React Router 7、TypeScript 5.8、Tailwind CSS 4、Dexie 4、Zustand、Vitest 3、Testing Library。

---

## Scope guard

- 保留引导第 3 屏当前“全本地生成 · 照片不上传”文案及其测试；餐食 AI 真正上线时再按已批准规范修改。
- 不新增或修改营养 IndexedDB 表、营养 repo、食物目录、热量/蛋白质计算、健康资料表单、照片识别或登录逻辑。
- `/health` 本次只交付可访问的全屏空壳、稳定返回今日页的行为和路由统计。
- 今日饮食摘要只展示无计划空态“记录今天吃了什么”，不伪造热量、蛋白质或餐次完成度。
- `TabBar` 保持“今日 / 日历 / 数据 / 我的”四项，不新增“健康”标签。

### Task 0: Install locked dependencies and verify the starting point

**Files:**
- Read: `package.json`
- Read: `package-lock.json`
- Test: `src/screens/Onboarding.test.tsx`
- Test: `src/screens/today/TodayScreen.test.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Install exactly the lockfile dependency graph**

Run:

```bash
npm ci
```

Expected: exit 0; local `node_modules/.bin/vitest` exists. Do not replace this with `npm install`, because implementation must not rewrite `package-lock.json`.

- [ ] **Step 2: Run the focused baseline before editing**

Run:

```bash
npm test -- src/screens/Onboarding.test.tsx src/screens/today/TodayScreen.test.tsx src/App.test.tsx src/lib/analytics.test.ts src/components/ScreenTracker.test.tsx
```

Expected: PASS with zero failed tests. If the baseline fails, stop and diagnose that failure before implementing this plan.

- [ ] **Step 3: Confirm the implementation starts from the approved commit**

Run:

```bash
git rev-parse --short HEAD
```

Expected: `d18245d` when starting this plan. If execution intentionally begins from a descendant commit, record that exact SHA in the task commentary before editing.

### Task 1: Extend the analytics allowlists for the two new entry paths

**Files:**
- Modify: `src/lib/analytics.ts:34-67`
- Test: `src/lib/analytics.test.ts:112-135,190-209`
- Test: `src/components/ScreenTracker.test.tsx:21-36`

- [ ] **Step 1: Add the failing analytics tests**

In `src/lib/analytics.test.ts`, add this test after the existing `trackScreen` describe block:

```ts
test('引导跳过与健康入口只发送白名单事件名字面量', () => {
  const spy = fakeUmami();

  track('onboarding_done_without_workout');
  track('health_opened');

  expect(spy.mock.calls.map(([payload]) => payload)).toEqual([
    'onboarding_done_without_workout',
    'health_opened',
  ]);
});
```

In the existing `screenOf` table, add the health row so the complete table becomes:

```ts
test.each([
  ['/', 'today'],
  ['/calendar', 'calendar'],
  ['/stats', 'stats'],
  ['/profile', 'profile'],
  ['/health', 'health'],
  ['/log', 'log'],
  ['/poster', 'poster'],
])('%s → %s', (path, screen) => {
  expect(screenOf(path)).toBe(screen);
});
```

In `src/components/ScreenTracker.test.tsx`, add:

```ts
test('停在 /health 时上报 health 白名单屏幕名', () => {
  at('/health');
  expect(trackScreen).toHaveBeenCalledWith('health');
  expect(trackScreen).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the tests and typecheck to verify RED**

Run:

```bash
npm test -- src/lib/analytics.test.ts src/components/ScreenTracker.test.tsx
```

Expected: FAIL because `screenOf('/health')` returns `null` and `ScreenTracker` does not call `trackScreen`.

Run:

```bash
npm run typecheck
```

Expected: FAIL because the two new event literals and `health` screen literal are not yet members of their TypeScript allowlists.

- [ ] **Step 3: Expand the event and screen allowlists minimally**

Replace the analytics declarations and maps in `src/lib/analytics.ts` with:

```ts
/** 白名单：能出境的事件，就这几个 */
export type AnalyticsEvent =
  | 'onboarding_done'
  | 'onboarding_done_without_workout'
  | 'health_opened'
  | 'workout_logged'
  | 'poster_exported';

/** 白名单：能出境的屏幕名 */
export type AnalyticsScreen =
  | 'today'
  | 'calendar'
  | 'stats'
  | 'profile'
  | 'health'
  | 'log'
  | 'poster'
  | 'day';

/** 屏幕 → 上报用的固定字面量。这里没有任何一个字符来自用户数据 */
const SCREENS: Record<AnalyticsScreen, { url: string; title: string }> = {
  today: { url: '/today', title: '今日' },
  calendar: { url: '/calendar', title: '日历' },
  stats: { url: '/stats', title: '数据' },
  profile: { url: '/profile', title: '我的' },
  health: { url: '/health', title: '健康' },
  log: { url: '/log', title: '记录训练' },
  poster: { url: '/poster', title: '海报' },
  day: { url: '/day', title: '训练详情' },
};

/** 路径首段 → 屏幕名。'/day/2026-07-14' 的日期在这一步就被丢掉 */
const BY_SEGMENT: Record<string, AnalyticsScreen> = {
  '': 'today',
  calendar: 'calendar',
  stats: 'stats',
  profile: 'profile',
  health: 'health',
  log: 'log',
  poster: 'poster',
  day: 'day',
};
```

- [ ] **Step 4: Run analytics tests and typecheck to verify GREEN**

Run:

```bash
npm test -- src/lib/analytics.test.ts src/components/ScreenTracker.test.tsx
```

Expected: PASS.

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the allowlist change**

```bash
git add src/lib/analytics.ts src/lib/analytics.test.ts src/components/ScreenTracker.test.tsx
git commit -m "feat: extend analytics for health entry"
```

### Task 2: Add the idempotent “暂不训练，先看看” onboarding exit

**Files:**
- Modify: `src/test/helpers.ts:1-19`
- Modify: `src/screens/Onboarding.tsx:29-56,131-150`
- Test: `src/screens/Onboarding.test.tsx:1-19,137-207`
- Test: `src/App.test.tsx:1-19,82-90`

- [ ] **Step 1: Extract a test helper that reaches the final onboarding screen**

Replace `src/test/helpers.ts` with:

```ts
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/** 穿过前三屏首启引导，停在第 4 屏周目标。 */
export async function reachOnboardingGoal(user: UserEvent): Promise<void> {
  await user.click(await screen.findByRole('button', { name: '开始' }));
  await user.click(await screen.findByRole('button', { name: '继续' }));
  await user.click(await screen.findByRole('button', { name: '继续' }));
}

/** 穿过 4 步首启引导，停在 `/log`。 */
export async function completeOnboarding(user: UserEvent): Promise<void> {
  await reachOnboardingGoal(user);
  await user.click(await screen.findByRole('button', { name: '开始第一次打卡' }));
}
```

- [ ] **Step 2: Run the existing onboarding tests after the helper-only refactor**

Run:

```bash
npm test -- src/screens/Onboarding.test.tsx src/App.test.tsx
```

Expected: PASS; this step changes no production behavior.

- [ ] **Step 3: Prepare the onboarding test harness for route and draft assertions**

Update the import section of `src/screens/Onboarding.test.tsx` to:

```ts
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from 'react-router-dom';
import { Onboarding } from './Onboarding';
import { db } from '../lib/db';
import { track } from '../lib/analytics';
import { useLogDraft } from '../stores/logDraftStore';
import { resetDb } from '../test/dbTestUtils';
import { completeOnboarding, reachOnboardingGoal } from '../test/helpers';

vi.mock('../lib/analytics', { spy: true });
```

Replace the existing `beforeEach` with:

```ts
beforeEach(async () => {
  await resetDb();
  localStorage.clear();
  useLogDraft.setState({ active: false, parts: [], items: [] });
  vi.clearAllMocks();
});
```

Add this routed renderer after `renderOnboarding()`:

```tsx
function renderRoutedOnboarding() {
  const router = createMemoryRouter(
    [
      { path: '/onboarding', element: <Onboarding /> },
      { path: '/', element: <h1>今日页探针</h1> },
      { path: '/log', element: <h1>训练页探针</h1> },
    ],
    { initialEntries: ['/onboarding'] },
  );

  return { ...render(<RouterProvider router={router} />), router };
}
```

- [ ] **Step 4: Add the failing final-screen presentation test**

Add to `src/screens/Onboarding.test.tsx` after the existing weekly-goal tests:

```ts
test('最后一屏同时提供主打卡动作和低强调暂不训练动作', async () => {
  const user = userEvent.setup();
  renderOnboarding();
  await reachOnboardingGoal(user);

  expect(screen.getByRole('button', { name: '开始第一次打卡' })).toHaveAttribute(
    'data-variant',
    'primary',
  );
  expect(screen.getByRole('button', { name: '暂不训练，先看看' })).toHaveAttribute(
    'data-variant',
    'tertiary',
  );
});
```

- [ ] **Step 5: Add the failing route, persistence, event, and no-side-effect test**

Add:

```ts
test('暂不训练保存同一周目标、replace 进入今日页且不创建训练或草稿', async () => {
  const user = userEvent.setup();
  const { router } = renderRoutedOnboarding();
  await reachOnboardingGoal(user);
  await user.click(screen.getByRole('button', { name: '5' }));

  await user.click(screen.getByRole('button', { name: '暂不训练，先看看' }));

  expect(await screen.findByRole('heading', { name: '今日页探针' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
  expect(router.state.historyAction).toBe('REPLACE');
  expect(await db.profile.get('me')).toMatchObject({
    onboarded: true,
    weeklyGoal: 5,
  });
  expect(await db.workouts.count()).toBe(0);
  expect(useLogDraft.getState()).toMatchObject({
    active: false,
    parts: [],
    items: [],
  });
  expect(track).toHaveBeenCalledWith('onboarding_done_without_workout');
});
```

- [ ] **Step 6: Add the failing shared-idempotency test**

Add:

```ts
test('连点暂不训练只落库一次并共用提交门闩', async () => {
  const user = userEvent.setup();
  const putSpy = vi.spyOn(db.profile, 'put');
  renderOnboarding();
  await reachOnboardingGoal(user);

  const skip = screen.getByRole('button', { name: '暂不训练，先看看' });
  await Promise.all([user.click(skip), user.click(skip), user.click(skip)]);

  expect(putSpy).toHaveBeenCalledTimes(1);
  putSpy.mockRestore();
});
```

- [ ] **Step 7: Add the failing App-level integration test**

In `src/App.test.tsx`, change the helper import to:

```ts
import { completeOnboarding, reachOnboardingGoal } from './test/helpers';
```

Add:

```ts
test('暂不训练完成引导后进入今日页且没有训练记录', async () => {
  const user = userEvent.setup();
  render(<App />);
  await reachOnboardingGoal(user);

  await user.click(screen.getByRole('button', { name: '暂不训练，先看看' }));

  expect(await screen.findByRole('heading', { name: '今天，留证。' })).toBeInTheDocument();
  expect(screen.getByRole('navigation')).toBeInTheDocument();
  expect(window.location.hash).toBe('#/');
  expect(await db.workouts.count()).toBe(0);
  expect(await db.profile.get('me')).toMatchObject({ onboarded: true, weeklyGoal: 4 });
});
```

- [ ] **Step 8: Run the new tests to verify RED**

Run:

```bash
npm test -- src/screens/Onboarding.test.tsx src/App.test.tsx
```

Expected: FAIL because no button named “暂不训练，先看看” exists.

- [ ] **Step 9: Replace the fixed `start()` function with one shared completion function**

In `src/screens/Onboarding.tsx`, add this type above the component:

```ts
interface Completion {
  destination: '/log' | '/';
  event: 'onboarding_done' | 'onboarding_done_without_workout';
  replace?: boolean;
}
```

Replace `start()` with:

```ts
async function complete({ destination, event, replace = false }: Completion) {
  if (submittingRef.current) return;
  submittingRef.current = true;
  try {
    vibrate(18);
    await saveProfile({ weeklyGoal: goal, onboarded: true });
    track(event);
    nav(destination, { replace });
  } catch (err) {
    submittingRef.current = false;
    throw err;
  }
}
```

- [ ] **Step 10: Wire both final-screen actions to the shared function**

Replace the bottom action block in `src/screens/Onboarding.tsx` with:

```tsx
<Button
  onClick={
    last
      ? () => complete({ destination: '/log', event: 'onboarding_done' })
      : () => go(step + 1)
  }
  fullWidth
  className="min-h-14 text-[15px]"
>
  {CTA_LABELS[step]}
</Button>
{last && (
  <Button
    variant="tertiary"
    onClick={() =>
      complete({
        destination: '/',
        event: 'onboarding_done_without_workout',
        replace: true,
      })
    }
    fullWidth
    className="mt-2 min-h-11 text-[13px]"
  >
    暂不训练，先看看
  </Button>
)}
```

Do not edit `PosterPanel` or the existing privacy-copy test in this task.

- [ ] **Step 11: Run unit and App integration tests to verify GREEN**

Run:

```bash
npm test -- src/screens/Onboarding.test.tsx src/App.test.tsx
```

Expected: PASS, including the pre-existing D10 layout tests and the pre-existing privacy wording test.

- [ ] **Step 12: Commit the onboarding slice**

```bash
git add src/test/helpers.ts src/screens/Onboarding.tsx src/screens/Onboarding.test.tsx src/App.test.tsx
git commit -m "feat: let onboarding finish without training"
```

### Task 3: Add the full-screen `/health` shell outside `TabLayout`

**Files:**
- Create: `src/screens/health/HealthScreen.tsx`
- Create: `src/screens/health/HealthScreen.test.tsx`
- Modify: `src/App.tsx:8-16,42-51`
- Test: `src/App.test.tsx:55-101`

- [ ] **Step 1: Write the failing Health screen navigation test**

Create `src/screens/health/HealthScreen.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { HealthScreen } from './HealthScreen';

function renderHealth() {
  const router = createMemoryRouter(
    [
      { path: '/health', element: <HealthScreen /> },
      { path: '/', element: <h1>今日页探针</h1> },
    ],
    { initialEntries: ['/health'] },
  );

  return { ...render(<RouterProvider router={router} />), router };
}

test('健康空壳是独立全屏且返回固定 replace 到今日页', async () => {
  const user = userEvent.setup();
  const { router } = renderHealth();

  expect(screen.getByRole('heading', { name: '健康' })).toBeInTheDocument();
  expect(screen.getByText('记录今天吃了什么')).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '返回今日页' }));

  expect(await screen.findByRole('heading', { name: '今日页探针' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
  expect(router.state.historyAction).toBe('REPLACE');
});
```

- [ ] **Step 2: Add the failing App route tests**

Add to `src/App.test.tsx`:

```ts
test('健康页挂在 TabLayout 外，已引导用户直连时不显示底部导航', async () => {
  await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
  window.location.hash = '#/health';
  try {
    render(<App />);
    expect(await screen.findByRole('heading', { name: '健康' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  } finally {
    window.location.hash = '';
  }
});

test('未引导用户直连健康页仍被引导门拦截', async () => {
  window.location.hash = '#/health';
  try {
    render(<App />);
    expect(await screen.findByText('你练过的，都有铁证。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '健康' })).not.toBeInTheDocument();
  } finally {
    window.location.hash = '';
  }
});
```

- [ ] **Step 3: Run the focused tests to verify RED**

Run:

```bash
npm test -- src/screens/health/HealthScreen.test.tsx src/App.test.tsx
```

Expected: FAIL because `HealthScreen.tsx` does not exist and `/health` falls through to the wildcard route.

- [ ] **Step 4: Implement the empty full-screen Health shell**

Create `src/screens/health/HealthScreen.tsx` with:

```tsx
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';

export function HealthScreen() {
  const navigate = useNavigate();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <header className="flex items-center gap-3">
        <Button
          variant="tertiary"
          aria-label="返回今日页"
          onClick={() => navigate('/', { replace: true })}
          className="-ml-3 size-11 p-0"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Button>
        <div>
          <p className="text-[10px] font-semibold tracking-[2px] text-amber">DAILY NUTRITION</p>
          <h1 className="mt-0.5 text-xl font-extrabold text-ink">健康</h1>
        </div>
      </header>

      <section
        aria-labelledby="health-empty-title"
        className="flex flex-1 flex-col items-center justify-center px-6 text-center"
      >
        <h2 id="health-empty-title" className="text-2xl font-extrabold text-ink">
          记录今天吃了什么
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-mute">早餐 · 午餐 · 晚餐 · 加餐</p>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Register `/health` beside the existing full-screen routes**

Add this import to `src/App.tsx`:

```ts
import { HealthScreen } from './screens/health/HealthScreen';
```

Make the top-level route block read:

```tsx
<Routes>
  <Route path="/log" element={<LogFlow />} />
  <Route path="/day/:date" element={<DayDetailScreen />} />
  <Route path="/poster" element={<PosterScreen />} />
  <Route path="/health" element={<HealthScreen />} />
  <Route element={<TabLayout />}>
    <Route path="/" element={<TodayScreen />} />
    <Route path="/calendar" element={<CalendarScreen />} />
    <Route path="/stats" element={<StatsScreen />} />
    <Route path="/profile" element={<ProfileScreen />} />
  </Route>
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

Do not add `/health` to `src/components/TabBar.tsx`.

- [ ] **Step 6: Run Health and App tests to verify GREEN**

Run:

```bash
npm test -- src/screens/health/HealthScreen.test.tsx src/App.test.tsx src/components/TabBar.test.tsx
```

Expected: PASS; the Health test proves replace navigation, the App test proves the route is gated and outside `TabLayout`, and the TabBar test proves the four-tab contract is unchanged.

- [ ] **Step 7: Commit the routable Health shell**

```bash
git add src/screens/health/HealthScreen.tsx src/screens/health/HealthScreen.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: add full-screen health route"
```

### Task 4: Build the no-plan Today nutrition summary entry

**Files:**
- Create: `src/screens/today/TodayNutritionSummary.tsx`
- Create: `src/screens/today/TodayNutritionSummary.test.tsx`

- [ ] **Step 1: Write the failing summary component tests**

Create `src/screens/today/TodayNutritionSummary.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { track } from '../../lib/analytics';
import { TodayNutritionSummary } from './TodayNutritionSummary';

vi.mock('../../lib/analytics', { spy: true });

function renderSummary() {
  return render(
    <MemoryRouter>
      <TodayNutritionSummary />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

test('无营养计划时展示中性空态并链接到健康页', () => {
  const { container } = renderSummary();

  expect(screen.getByRole('region', { name: '今日饮食' })).toBeInTheDocument();
  expect(screen.getByText('记录今天吃了什么')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '进入健康' })).toHaveAttribute('href', '/health');
  expect(container.querySelector('.heat')).toBeNull();
});

test('点击入口只上报 health_opened 事件名', async () => {
  const user = userEvent.setup();
  renderSummary();

  await user.click(screen.getByRole('link', { name: '进入健康' }));

  expect(track).toHaveBeenCalledWith('health_opened');
  expect(track).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the component test to verify RED**

Run:

```bash
npm test -- src/screens/today/TodayNutritionSummary.test.tsx
```

Expected: FAIL because `TodayNutritionSummary.tsx` does not exist.

- [ ] **Step 3: Implement the low-emphasis summary entry without nutrition data**

Create `src/screens/today/TodayNutritionSummary.tsx` with:

```tsx
import { Link } from 'react-router-dom';
import { track } from '../../lib/analytics';

export function TodayNutritionSummary() {
  return (
    <section
      aria-labelledby="today-nutrition-title"
      className="mt-4 rounded-xl border border-line bg-raised px-4 py-4"
    >
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h2
            id="today-nutrition-title"
            className="text-[11px] tracking-[2px] text-mute uppercase"
          >
            今日饮食
          </h2>
          <p className="mt-1 text-sm font-semibold text-ink">记录今天吃了什么</p>
        </div>
        <Link
          to="/health"
          aria-label="进入健康"
          onClick={() => track('health_opened')}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-iron outline-none transition active:scale-[.98] focus-visible:ring-2 focus-visible:ring-iron motion-reduce:transition-none"
        >
          进入健康
          <span aria-hidden>›</span>
        </Link>
      </div>
    </section>
  );
}
```

This component deliberately has no `useLiveQuery`, calories, protein, meal count, red progress state, or nutrition placeholder object.

- [ ] **Step 4: Run the summary tests to verify GREEN**

Run:

```bash
npm test -- src/screens/today/TodayNutritionSummary.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the standalone summary component**

```bash
git add src/screens/today/TodayNutritionSummary.tsx src/screens/today/TodayNutritionSummary.test.tsx
git commit -m "feat: add today nutrition summary entry"
```

### Task 5: Mount the summary in the required Today-page order and prove the complete route

**Files:**
- Modify: `src/screens/today/TodayScreen.tsx:1-17,167-180`
- Test: `src/screens/today/TodayScreen.test.tsx:18-24,117-155`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Add the failing Today DOM-order test**

Add to `src/screens/today/TodayScreen.test.tsx` immediately before the weight-entry tests:

```ts
test('训练主 CTA 后是今日饮食摘要，再后是今日体重', async () => {
  renderToday();

  const trainingCta = await screen.findByRole('link', { name: '开始今日训练' });
  const nutrition = screen.getByRole('region', { name: '今日饮食' });
  const weight = screen.getByText('今日体重').closest('section') as HTMLElement;
  const follows = (before: Node, after: Node) =>
    Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);

  expect(follows(trainingCta, nutrition)).toBe(true);
  expect(follows(nutrition, weight)).toBe(true);
  expect(trainingCta.className).toContain('heat');
  expect(within(nutrition).getByRole('link', { name: '进入健康' }).className).not.toContain(
    'heat',
  );
});
```

Change the first import in `src/screens/today/TodayScreen.test.tsx` to include `within`:

```ts
import { render, screen, within } from '@testing-library/react';
```

- [ ] **Step 2: Add the failing App click-through test**

Add to `src/App.test.tsx`:

```ts
test('今日页通过低强调饮食摘要进入全屏健康页', async () => {
  const user = userEvent.setup();
  await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
  render(<App />);

  const trainingCta = await screen.findByRole('link', { name: '开始今日训练' });
  const healthEntry = screen.getByRole('link', { name: '进入健康' });
  expect(trainingCta.className).toContain('heat');
  expect(healthEntry.className).not.toContain('heat');

  await user.click(healthEntry);

  expect(await screen.findByRole('heading', { name: '健康' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(window.location.hash).toBe('#/health');
});
```

- [ ] **Step 3: Run Today and App tests to verify RED**

Run:

```bash
npm test -- src/screens/today/TodayScreen.test.tsx src/App.test.tsx
```

Expected: FAIL because `TodayScreen` does not render a region named “今日饮食” or a link named “进入健康”.

- [ ] **Step 4: Import and mount the summary at the required insertion point**

Add this import to `src/screens/today/TodayScreen.tsx`:

```ts
import { TodayNutritionSummary } from './TodayNutritionSummary';
```

Replace the block immediately after the training CTA with:

```tsx
      <TodayNutritionSummary />

      <div className="etch" />
      <WeightQuickEntry today={today} />

      <div className="etch" />
      <PhotoCard date={today} />
```

The existing primary training `Link` remains unchanged above this block. Do not add a second `heat` class or primary button to the nutrition summary.

- [ ] **Step 5: Run the focused UI and route tests to verify GREEN**

Run:

```bash
npm test -- src/screens/today/TodayNutritionSummary.test.tsx src/screens/today/TodayScreen.test.tsx src/screens/health/HealthScreen.test.tsx src/App.test.tsx src/components/TabBar.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the complete Today-to-Health slice**

```bash
git add src/screens/today/TodayScreen.tsx src/screens/today/TodayScreen.test.tsx src/App.test.tsx
git commit -m "feat: open health from today summary"
```

### Task 6: Verify the complete narrow-scope story

**Files:**
- Verify: `src/screens/Onboarding.tsx`
- Verify: `src/screens/health/HealthScreen.tsx`
- Verify: `src/screens/today/TodayNutritionSummary.tsx`
- Verify: `src/screens/today/TodayScreen.tsx`
- Verify: `src/App.tsx`
- Verify: `src/lib/analytics.ts`

- [ ] **Step 1: Run all focused tests together**

Run:

```bash
npm test -- src/lib/analytics.test.ts src/components/ScreenTracker.test.tsx src/screens/Onboarding.test.tsx src/screens/health/HealthScreen.test.tsx src/screens/today/TodayNutritionSummary.test.tsx src/screens/today/TodayScreen.test.tsx src/App.test.tsx src/components/TabBar.test.tsx
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run repository-wide static and unit verification**

Run:

```bash
npm run typecheck
```

Expected: PASS.

Run:

```bash
npm test
```

Expected: PASS with zero failed tests.

Run:

```bash
npm run build
```

Expected: PASS and a production bundle written to `dist/`.

Run:

```bash
git diff --check d18245d..HEAD
```

Expected: no output and exit 0; this checks every committed change since the approved design baseline, regardless of how many review-fix commits were added.

- [ ] **Step 3: Verify the scope guard from the final diff**

Run:

```bash
git diff --name-status d18245d..HEAD
git status --short
```

Expected: the committed diff is limited to the plan document, analytics, onboarding, Health route/shell, Today summary/ordering, App integration, test helpers, and corresponding tests; `git status --short` prints nothing. There are no edits to `src/lib/db.ts`, `src/lib/types.ts`, nutrition persistence files, food assets, login code, or `PosterPanel` privacy copy.

- [ ] **Step 4: Perform real-browser mobile verification**

Run:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Expected: Vite serves the app at `http://127.0.0.1:5173/`.

At a 390×844 viewport, verify all of the following:

1. The final onboarding screen shows the primary“开始第一次打卡”button above the tertiary“暂不训练，先看看”button, both above the bottom safe area.
2. Tapping“暂不训练，先看看”opens Today without creating a training item; browser Back does not return to onboarding.
3. Today keeps“开始今日训练”as the only orange-gradient primary action.
4. The“今日饮食”summary appears between the training CTA and“今日体重”.
5. Tapping“进入健康”opens a full-screen Health shell with no bottom TabBar.
6. Refreshing on `#/health` and tapping“返回今日页”always returns to `#/`.
7. The pre-existing onboarding screen 3 still displays its original local-photo wording in this delivery.

Stop the Vite process after verification. If browser verification uncovers and fixes a defect, commit the focused repair, then rerun Task 6 Steps 1–4 from the beginning; do not reuse the pre-fix evidence.

## Plan self-review

- Spec coverage: every in-scope requirement maps to Tasks 1–6; the no-workout exit, replace navigation, App gate, full-screen route, Today ordering, low-emphasis styling, back behavior and analytics each have explicit tests.
- Scope control: nutrition DB, calculations, food records, account/login, AI upload and privacy-copy changes are explicitly excluded and absent from all code snippets.
- Type consistency: event names are exactly `onboarding_done_without_workout` and `health_opened`; route and screen names are exactly `/health` and `health`; the shared completion destination union is exactly `'/log' | '/'`.
- Placeholder scan: the plan contains no deferred implementation marker; every code-editing step includes the concrete code, exact command and expected RED or GREEN result.
- Commit cadence: Tasks 1–5 each end in one focused commit; Task 6 is verification-only.
