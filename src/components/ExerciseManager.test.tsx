import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRESET_EXERCISES } from '../data/presetExercises';
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

test('折叠态是一行 etch 行：动作库 + 在库总数', async () => {
  render(<ExerciseManager />);
  expect(await screen.findByText('动作库')).toBeInTheDocument();
  expect(await screen.findByText(`${PRESET_EXERCISES.length} 个`)).toBeInTheDocument();
  // 折叠时不渲染管理面板
  expect(screen.queryByPlaceholderText('新建胸动作…')).not.toBeInTheDocument();
});

test('新建后总数 +1', async () => {
  const user = userEvent.setup();
  render(<ExerciseManager />);
  await user.click(await screen.findByText('展开'));
  await user.type(screen.getByPlaceholderText('新建胸动作…'), '地板卧推');
  await user.click(screen.getByText('新建'));

  expect(await screen.findByText(`${PRESET_EXERCISES.length + 1} 个`)).toBeInTheDocument();
});

test('不再使用废弃别名 card2 / iron2', async () => {
  const user = userEvent.setup();
  const { container } = render(<ExerciseManager />);
  await user.click(await screen.findByText('展开'));
  await screen.findByPlaceholderText('新建胸动作…');
  expect(container.innerHTML).not.toMatch(/card2|iron2/);
});
