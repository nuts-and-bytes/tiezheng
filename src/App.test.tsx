import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { db } from './lib/db';
import { seedPresets } from './repos/exerciseRepo';
import { resetDb } from './test/dbTestUtils';
import { completeOnboarding, reachOnboardingGoal } from './test/helpers';
import { savePhotoAiIntent, takePhotoAiIntent } from './lib/photoAiIntent';
import { textAiSessionSuccessFixture } from './test/textAiFixtures';

const appTextClient = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  session: vi.fn(),
  estimate: vi.fn(),
  estimateWithOutcome: vi.fn(),
}));

vi.mock('./lib/textAiClient', () => ({
  createTextAiClient: () => appTextClient,
}));

/**
 * 这个文件只管**引导门与路由**：没引导过的人能不能绕过引导。
 * 引导内部那四屏怎么走、落库什么，归 screens/Onboarding.test.tsx —— 不要在这里重复断言，
 * 否则引导每改一次文案，这里就跟着红一次（上一轮就是这么炸的）。
 */

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
  window.location.hash = '';
  sessionStorage.clear();
  localStorage.clear();
  appTextClient.session.mockReset().mockResolvedValue(textAiSessionSuccessFixture);
  appTextClient.login.mockReset().mockResolvedValue({ ok: true });
  appTextClient.logout.mockReset().mockResolvedValue({ ok: true });
  appTextClient.estimate.mockReset();
  appTextClient.estimateWithOutcome.mockReset();
  await resetDb();
  await seedPresets();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  window.location.hash = '';
});

/**
 * 安装提示是个 fixed / z-40 的浮条，钉在底部安全区 +80px —— 正好压在引导页的 CTA 上。
 * 它原本挂在 OnboardingGate **之外**无条件渲染：iPhone Safari 上第一次打开 app，
 * 用户看到的第一屏是「你练过的，都有铁证。」和一条催他「添加到主屏幕」的浮条同屏打架，
 * 而他连这 app 是干什么的都还没看到。
 *
 * 催安装的正确时机是他决定留下来之后，不是他刚进门的时候。所以这条提示归引导门管：
 * 引导没走完，它一个字都不许出现。
 */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

test('引导期间不许弹安装提示 —— 它会压在引导的 CTA 上', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
  try {
    render(<App />);
    expect(await screen.findByText('你练过的，都有铁证。')).toBeInTheDocument();
    expect(screen.queryByText(/添加到主屏幕/)).not.toBeInTheDocument();
  } finally {
    vi.restoreAllMocks();
  }
});

test('引导走完之后，安装提示才出来', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
  try {
    await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
    render(<App />);
    expect(await screen.findByText(/添加到主屏幕/)).toBeInTheDocument();
  } finally {
    vi.restoreAllMocks();
  }
});

test('新用户先看到首次引导', async () => {
  render(<App />);
  expect(await screen.findByText('你练过的，都有铁证。')).toBeInTheDocument();
  // 引导期间不该露出主界面的 Tab 栏
  expect(screen.queryByText('日历')).not.toBeInTheDocument();
});

test('已引导用户直接进 4 Tab 主界面', async () => {
  await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
  render(<App />);
  expect(await screen.findByText('今日')).toBeInTheDocument();
  expect(screen.getByText('日历')).toBeInTheDocument();
  expect(screen.getByText('数据')).toBeInTheDocument();
  expect(screen.getByText('我的')).toBeInTheDocument();
});

test('未引导用户直连 #/log 仍被引导门拦截', async () => {
  window.location.hash = '#/log';
  try {
    render(<App />);
    expect(await screen.findByText('你练过的，都有铁证。')).toBeInTheDocument();
    expect(screen.queryByText('今天练哪儿？')).not.toBeInTheDocument();
  } finally {
    window.location.hash = '';
  }
});

test('已引导用户直连 #/health 显示全屏健康页，没有底栏', async () => {
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

test('登录服务回到无 hash 的固定健康地址时，桥接 HashRouter 并恢复照片识别', async () => {
  await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
  vi.stubEnv('VITE_ENABLE_PHOTO_AI', 'true');
  savePhotoAiIntent('2026-08-13', 'dinner');
  window.history.replaceState(null, '', '/health?keep=1&photoAi=resume');

  try {
    render(<App />);

    expect(await screen.findByRole('heading', { name: '健康' })).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: '拍照识别晚餐' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/health?keep=1'));
    expect(takePhotoAiIntent()).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
    window.history.replaceState(null, '', '/');
  }
});

test('无 hash 的旧文字 resume 地址不再桥接或恢复文字面板', async () => {
  await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
  vi.stubEnv('VITE_ENABLE_TEXT_AI', 'true');
  window.history.replaceState(null, '', '/health?keep=1&textAi=resume');
  const replaceState = vi.spyOn(window.history, 'replaceState');

  render(<App />);

  expect(await screen.findByText('今日')).toBeInTheDocument();
  expect(window.location.hash).toBe('');
  expect(window.location.pathname).toBe('/health');
  expect(window.location.search).toBe('?keep=1&textAi=resume');
  expect(replaceState.mock.calls.some((call) => String(call[2] ?? '').includes('#/health')))
    .toBe(false);
  expect(screen.queryByRole('dialog', { name: /AI 估算/ })).not.toBeInTheDocument();
  expect(appTextClient.session).not.toHaveBeenCalled();
});

test('从今日饮食入口进入健康页，且没有底栏', async () => {
  const user = userEvent.setup();
  await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
  render(<App />);

  const training = await screen.findByRole('link', { name: '开始今日训练' });
  const healthEntry = screen.getByRole('link', { name: '进入健康' });
  expect(training).toHaveClass('heat');
  expect(healthEntry).not.toHaveClass('heat');

  await user.click(healthEntry);

  expect(await screen.findByRole('heading', { name: '健康' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  expect(window.location.hash).toBe('#/health');
});

test('未引导用户直连 #/health 仍被引导门拦截', async () => {
  window.location.hash = '#/health';
  try {
    render(<App />);
    expect(await screen.findByText('你练过的，都有铁证。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '健康' })).not.toBeInTheDocument();
  } finally {
    window.location.hash = '';
  }
});

test('走完引导后落库 onboarded 并进入记录流', async () => {
  const user = userEvent.setup();
  render(<App />);
  await completeOnboarding(user);
  expect(await screen.findByText('今天练哪儿？')).toBeInTheDocument();
  const profile = await db.profile.get('me');
  expect(profile?.onboarded).toBe(true);
  expect(profile?.weeklyGoal).toBe(4);
});

test('暂不训练完成引导后进入今日页，且不创建训练', async () => {
  const user = userEvent.setup();
  render(<App />);

  await reachOnboardingGoal(user);
  await user.click(screen.getByRole('button', { name: '暂不训练，先看看' }));
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

  expect(await screen.findByRole('heading', { name: '今天，留证。' })).toBeInTheDocument();
  expect(await screen.findByText('记录今天吃了什么')).toBeInTheDocument();
  expect(screen.getByRole('navigation')).toBeInTheDocument();
  expect(window.location.hash).toBe('#/');
  expect(await db.workouts.count()).toBe(0);
  expect(await db.profile.get('me')).toMatchObject({ onboarded: true, weeklyGoal: 4 });
});

test('未知路由回退到今日页（已引导）', async () => {
  await db.profile.put({ id: 'me', weeklyGoal: 4, onboarded: true, updatedAt: Date.now() });
  window.location.hash = '#/does-not-exist';
  try {
    render(<App />);
    expect(await screen.findByText('今日')).toBeInTheDocument();
    expect(screen.getByText('日历')).toBeInTheDocument();
  } finally {
    window.location.hash = '';
  }
});
