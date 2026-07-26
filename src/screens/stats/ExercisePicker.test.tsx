import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExerciseActivityGroup } from '../../lib/stats';
import { ExercisePicker } from './ExercisePicker';

const groups: ExerciseActivityGroup[] = [
  {
    bodyPart: 'chest',
    exercises: [
      {
        exercise: { id: 'bench', name: '卧推', bodyPart: 'chest', preset: true, updatedAt: 0, deletedAt: null },
        lastDate: '2026-07-26',
        trainedToday: true,
      },
      {
        exercise: { id: 'fly', name: '飞鸟', bodyPart: 'chest', preset: true, updatedAt: 0, deletedAt: null },
        lastDate: '2026-07-20',
        trainedToday: false,
      },
    ],
  },
  {
    bodyPart: 'back',
    exercises: [{
      exercise: { id: 'row', name: '杠铃划船', bodyPart: 'back', preset: true, updatedAt: 0, deletedAt: null },
      lastDate: '2026-07-18',
      trainedToday: false,
    }],
  },
];

test('显示全部历史动作并按部位分组，今日动作有文字状态', () => {
  render(<ExercisePicker groups={groups} activeId="bench" onPick={() => {}} />);

  expect(screen.getByRole('heading', { name: '胸' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '背' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /卧推.*今日/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '飞鸟' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '杠铃划船' })).toBeInTheDocument();
});

test('选择动作时回传唯一 id', async () => {
  const onPick = vi.fn();
  render(<ExercisePicker groups={groups} activeId="bench" onPick={onPick} />);

  await userEvent.click(screen.getByRole('button', { name: '杠铃划船' }));
  expect(onPick).toHaveBeenCalledWith('row');
});
