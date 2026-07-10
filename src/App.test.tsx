import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { db } from './lib/db';
import { seedPresets } from './repos/exerciseRepo';
import { resetDb } from './test/dbTestUtils';

beforeEach(async () => {
  window.location.hash = '';
  await resetDb();
  await seedPresets();
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

test('未引导用户直连 #/log 仍被引导门拦截', async () => {
  window.location.hash = '#/log';
  try {
    render(<App />);
    expect(await screen.findByText('开始第一次打卡')).toBeInTheDocument();
    expect(screen.queryByText('今天练哪儿？')).not.toBeInTheDocument();
  } finally {
    window.location.hash = '';
  }
});

test('点击「开始第一次打卡」落库 onboarded 并进入记录流', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByText('开始第一次打卡'));
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
