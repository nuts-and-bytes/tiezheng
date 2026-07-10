import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '../lib/db';
import { addCustomExercise, seedPresets } from '../repos/exerciseRepo';
import { resetDb } from '../test/dbTestUtils';
import { ExerciseManager } from './ExerciseManager';

vi.mock('../repos/exerciseRepo', { spy: true });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  await seedPresets();
});

test('新建按钮同 tick 双击只产生 1 条记录', async () => {
  const user = userEvent.setup();
  render(<ExerciseManager />);
  await user.click(screen.getByText('展开'));
  await user.type(screen.getByPlaceholderText('新建胸动作…'), '史密斯上斜推');

  // 同 tick 双击：两次 click 之间无微任务间隙，复现 iOS 快速连点（LogFlow 判例）
  const btn = screen.getByText('新建');
  fireEvent.click(btn);
  fireEvent.click(btn);

  expect(addCustomExercise).toHaveBeenCalledTimes(1);
  await waitFor(async () => {
    const customs = (await db.exercises.toArray()).filter((e) => !e.preset);
    expect(customs).toHaveLength(1);
  });
});
