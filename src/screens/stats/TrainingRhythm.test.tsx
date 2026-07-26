import { render, screen } from '@testing-library/react';
import type { WeeklyRhythmPoint } from '../../lib/stats';
import { TrainingRhythm } from './TrainingRhythm';

test('最近 12 周每周都有可读柱，本周明确标记', () => {
  const points: WeeklyRhythmPoint[] = Array.from({ length: 12 }, (_, index) => ({
    weekStart: `2026-05-${String(index + 4).padStart(2, '0')}`,
    days: index % 4,
    sets: index * 3,
    current: index === 11,
  }));
  render(<TrainingRhythm points={points} />);

  expect(screen.getAllByRole('img')).toHaveLength(12);
  expect(screen.getByText('本周')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /本周.*3 天.*33 组/ })).toBeInTheDocument();
});

test('柱高按 12 周 p90 封顶，异常高周不会压扁其余柱', () => {
  const points: WeeklyRhythmPoint[] = Array.from({ length: 12 }, (_, index) => ({
    weekStart: `2026-05-${String(index + 4).padStart(2, '0')}`,
    days: 1,
    sets: index === 11 ? 100 : 10,
    current: index === 11,
  }));
  render(<TrainingRhythm points={points} />);

  expect(screen.getByTestId('rhythm-bar-0')).toHaveStyle({ height: '100%' });
  expect(screen.getByTestId('rhythm-bar-11')).toHaveStyle({ height: '100%' });
});

test('只有一周有训练时，p90 为零也不能把唯一有效柱压成零高', () => {
  const points: WeeklyRhythmPoint[] = Array.from({ length: 12 }, (_, index) => ({
    weekStart: `2026-05-${String(index + 4).padStart(2, '0')}`,
    days: index === 11 ? 1 : 0,
    sets: index === 11 ? 4 : 0,
    current: index === 11,
  }));
  render(<TrainingRhythm points={points} />);

  expect(screen.getByTestId('rhythm-bar-11')).toHaveStyle({ height: '100%' });
});
