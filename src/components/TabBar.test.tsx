import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TabBar } from './TabBar';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar />
    </MemoryRouter>,
  );
}

/** 跨 agent 字符串契约：App.test.tsx 用 getByText 断言这四个标签，一个都不能少 */
test('四个 Tab 的文字标签都能被 getByText 拿到', () => {
  renderAt('/');
  for (const label of ['今日', '日历', '数据', '我的']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

test('每个 Tab 都带一枚 NavGlyph 图标', () => {
  const { container } = renderAt('/');
  expect(container.querySelectorAll('a svg')).toHaveLength(4);
});

test('选中态 text-iron + aria-current，未选中 text-mute', () => {
  renderAt('/calendar');
  const active = screen.getByText('日历').closest('a')!;
  const idle = screen.getByText('今日').closest('a')!;
  expect(active).toHaveAttribute('aria-current', 'page');
  expect(active.className).toContain('text-iron');
  expect(idle.className).toContain('text-mute');
  expect(idle).not.toHaveAttribute('aria-current');
});

test('「今日」只在根路径高亮（end 匹配，不被 /calendar 命中）', () => {
  renderAt('/calendar');
  expect(screen.getByText('今日').closest('a')!.className).not.toContain('text-iron');
});
