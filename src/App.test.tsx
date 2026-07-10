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
