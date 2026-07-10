import { render, screen } from '@testing-library/react';
import App from './App';
import { resetDb } from './test/dbTestUtils';

beforeEach(async () => {
  window.location.hash = '';
  await resetDb();
});

test('渲染 4 个底部 Tab', async () => {
  render(<App />);
  const tabLabels = await screen.findAllByText('今日');
  expect(tabLabels.length).toBeGreaterThan(0);
  expect(screen.getByText('日历')).toBeInTheDocument();
  expect(screen.getByText('数据')).toBeInTheDocument();
  expect(screen.getByText('我的')).toBeInTheDocument();
});
