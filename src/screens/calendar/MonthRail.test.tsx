import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MonthRailDay } from '../../lib/calendar';
import { MonthRail } from './MonthRail';

const days: MonthRailDay[] = Array.from({ length: 31 }, (_, index) => {
  const day = index + 1;
  const date = `2026-07-${String(day).padStart(2, '0')}`;
  const trained = day === 3 || day === 15;
  return {
    date,
    day,
    trained,
    sets: day === 3 ? 6 : day === 15 ? 4 : 0,
    parts: day === 3 ? ['back', 'chest'] : day === 15 ? ['leg'] : [],
    heightPct: trained ? (day === 3 ? 100 : 60) : 8,
    ...([1, 8, 15, 22, 31].includes(day) ? { anchorLabel: String(day) } : {}),
  } as MonthRailDay;
});

test('整月有 31 个刻度，但只有训练日是可聚焦按钮', () => {
  render(<MonthRail days={days} selectedDate="2026-07-03" onSelect={() => {}} />);

  expect(screen.getAllByTestId(/rail-day-/)).toHaveLength(31);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /2026年7月3日.*背.*胸.*6 组/ })).toBeInTheDocument();
});

test('混合训练柱最多两段颜色，选中态有日号、按压状态与非颜色轮廓', () => {
  render(<MonthRail days={days} selectedDate="2026-07-03" onSelect={() => {}} />);

  const selected = screen.getByRole('button', { name: /2026年7月3日/ });
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(selected).toHaveTextContent('3');
  expect(selected.className).toContain('ring-2');
  expect(selected.querySelectorAll('[data-part-segment]')).toHaveLength(2);
});

test('点击训练柱回传日期，定位标签只显示 1/8/15/22/月末', async () => {
  const onSelect = vi.fn();
  render(<MonthRail days={days} selectedDate="2026-07-03" onSelect={onSelect} />);

  await userEvent.click(screen.getByRole('button', { name: /2026年7月15日/ }));
  expect(onSelect).toHaveBeenCalledWith('2026-07-15');
  const labels = within(screen.getByTestId('month-rail')).getAllByTestId('rail-anchor');
  expect(labels.map((label) => label.textContent)).toEqual(['1', '8', '15', '22', '31']);
});
