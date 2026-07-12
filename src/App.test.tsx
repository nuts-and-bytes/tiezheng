import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { db } from './lib/db';
import { seedPresets } from './repos/exerciseRepo';
import { resetDb } from './test/dbTestUtils';
import { completeOnboarding } from './test/helpers';

/**
 * 这个文件只管**引导门与路由**：没引导过的人能不能绕过引导。
 * 引导内部那四屏怎么走、落库什么，归 screens/Onboarding.test.tsx —— 不要在这里重复断言，
 * 否则引导每改一次文案，这里就跟着红一次（上一轮就是这么炸的）。
 */

beforeEach(async () => {
  window.location.hash = '';
  await resetDb();
  await seedPresets();
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

test('走完引导后落库 onboarded 并进入记录流', async () => {
  const user = userEvent.setup();
  render(<App />);
  await completeOnboarding(user);
  expect(await screen.findByText('今天练哪儿？')).toBeInTheDocument();
  const profile = await db.profile.get('me');
  expect(profile?.onboarded).toBe(true);
  expect(profile?.weeklyGoal).toBe(4);
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
