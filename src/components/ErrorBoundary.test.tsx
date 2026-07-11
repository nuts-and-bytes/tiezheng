import { render, screen } from '@testing-library/react';
import { readLogs } from '../lib/logger';
import { ErrorBoundary } from './ErrorBoundary';

function Boom(): never {
  throw new Error('boom-test');
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('渲染错误时展示 fallback', () => {
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByText('出了点问题')).toBeInTheDocument();
  expect(screen.getByText('你的数据都在本地，不会丢失。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新载入' })).toBeInTheDocument();
});

test('崩溃页展示错误信息本身，便于截图定位', () => {
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  expect(screen.getByText(/boom-test/)).toBeInTheDocument();
});

test('渲染错误写入环形日志', () => {
  render(
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>,
  );
  const logs = readLogs();
  expect(logs.some((entry) => entry.includes('ErrorBoundary: boom-test'))).toBe(true);
});
