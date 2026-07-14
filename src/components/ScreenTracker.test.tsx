import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { ScreenTracker } from './ScreenTracker';
import { trackScreen } from '../lib/analytics';

vi.mock('../lib/analytics', async (orig) => ({
  ...(await orig<typeof import('../lib/analytics')>()),
  trackScreen: vi.fn(),
}));

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ScreenTracker />
    </MemoryRouter>,
  );

beforeEach(() => vi.mocked(trackScreen).mockClear());

/* 这条是隐私边界在路由层的落点：真实路径带着训练日期，上报出去的必须只是 'day' */
test('停在 /day/2026-07-14 时上报 day —— 日期不出境', () => {
  at('/day/2026-07-14');
  expect(trackScreen).toHaveBeenCalledWith('day');
  expect(trackScreen).toHaveBeenCalledTimes(1);
});

test('停在 / 时上报 today', () => {
  at('/');
  expect(trackScreen).toHaveBeenCalledWith('today');
});

test('认不出的路径不上报 —— 宁可少一条记录，也不把未知字符串发出去', () => {
  at('/nonsense/x');
  expect(trackScreen).not.toHaveBeenCalled();
});

test('不渲染任何东西', () => {
  const { container } = at('/stats');
  expect(container).toBeEmptyDOMElement();
});
