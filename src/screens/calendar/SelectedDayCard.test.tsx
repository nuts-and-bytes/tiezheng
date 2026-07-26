import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RailDaySummary } from '../../lib/calendar';
import { SelectedDayCard } from './SelectedDayCard';

const summary: RailDaySummary = {
  date: '2026-07-15',
  parts: ['chest', 'back'],
  moves: 2,
  sets: 7,
  volumeKg: 1260,
  exercises: [
    { exerciseId: 'bench', name: '卧推', sets: 4 },
    { exerciseId: 'row', name: '杠铃划船', sets: 3 },
  ],
};

function renderCard(value: RailDaySummary = summary) {
  return render(
    <MemoryRouter>
      <SelectedDayCard summary={value} today="2026-07-26" />
    </MemoryRouter>,
  );
}

test('主标题使用相对日期，副标题保留完整具体日期', () => {
  renderCard();

  expect(screen.getByRole('heading', { name: '上周三' })).toBeInTheDocument();
  expect(screen.getByText('2026年7月15日')).toBeInTheDocument();
});

test('显示全部部位、动作数、组数、容量和逐项动作', () => {
  renderCard();

  expect(screen.getByText('胸')).toBeInTheDocument();
  expect(screen.getByText('背')).toBeInTheDocument();
  expect(screen.getByText('2 个动作')).toBeInTheDocument();
  expect(screen.getByText('7 组')).toBeInTheDocument();
  expect(screen.getByText('1,260 kg')).toBeInTheDocument();
  const list = screen.getByRole('list', { name: '训练动作' });
  expect(within(list).getByText('卧推')).toBeInTheDocument();
  expect(within(list).getByText('4 组')).toBeInTheDocument();
  expect(within(list).getByText('杠铃划船')).toBeInTheDocument();
});

test('容量为空时不显示伪造 0kg，完整记录链接指向当天', () => {
  renderCard({ ...summary, volumeKg: null });

  expect(screen.queryByText(/kg$/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '查看完整记录' })).toHaveAttribute('href', '/day/2026-07-15');
});
