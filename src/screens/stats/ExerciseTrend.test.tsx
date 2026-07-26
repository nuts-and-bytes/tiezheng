import { render, screen } from '@testing-library/react';
import type { ExerciseTrend as ExerciseTrendData } from '../../lib/stats';
import type { Exercise } from '../../lib/types';
import { ExerciseTrend } from './ExerciseTrend';

vi.mock('react-chartjs-2', () => ({
  Line: ({ options }: { options?: { scales?: { y?: { reverse?: boolean } } } }) => (
    <div data-testid="trend-chart" data-reverse={String(options?.scales?.y?.reverse ?? false)} />
  ),
  Radar: () => null,
  Chart: () => null,
}));

const assisted: Exercise = {
  id: 'assisted', name: '辅助引体向上', bodyPart: 'back', loadMode: 'assistance',
  preset: true, updatedAt: 0, deletedAt: null,
};

test('辅助趋势反转纵轴并解释越低越强', () => {
  const trend: ExerciseTrendData = {
    kind: 'assistance', unit: 'kg', inverse: true,
    points: [{ date: '2026-07-01', value: 35 }, { date: '2026-07-08', value: 30 }],
  };
  render(<ExerciseTrend exercise={assisted} trend={trend} />);

  expect(screen.getByText('辅助越少，表现越强')).toBeInTheDocument();
  expect(screen.getByTestId('trend-chart')).toHaveAttribute('data-reverse', 'true');
});

test('只有一个点时直接显示数字，不画 canvas', () => {
  const trend: ExerciseTrendData = {
    kind: 'reps', unit: '次', inverse: false,
    points: [{ date: '2026-07-08', value: 12 }],
  };
  render(<ExerciseTrend exercise={{ ...assisted, loadMode: 'external', name: '引体向上' }} trend={trend} />);

  expect(screen.getByText('12')).toBeInTheDocument();
  expect(screen.getByText('次')).toBeInTheDocument();
  expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();
});
