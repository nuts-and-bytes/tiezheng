import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRESET_EXERCISES } from '../data/presetExercises';
import { db } from '../lib/db';
import type { Exercise } from '../lib/types';
import { addCustomExercise, seedPresets, setExerciseLoadMode } from '../repos/exerciseRepo';
import { resetDb } from '../test/dbTestUtils';
import { ExerciseManager } from './ExerciseManager';

vi.mock('../repos/exerciseRepo', { spy: true });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  await seedPresets();
});

afterEach(() => {
  if (vi.isMockFunction(window.confirm)) vi.mocked(window.confirm).mockRestore();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function openManager() {
  const user = userEvent.setup();
  render(<ExerciseManager />);
  await user.click(await screen.findByText('展开'));
  return user;
}

test('选择辅助重量后创建并落库，随后重置名称和重量类型', async () => {
  const user = await openManager();
  const nameInput = screen.getByPlaceholderText('新建胸动作…');
  const loadModeSelect = screen.getByLabelText('重量类型');

  await user.type(nameInput, '辅助俯卧撑');
  await user.selectOptions(loadModeSelect, 'assistance');
  await user.click(screen.getByText('新建'));

  await waitFor(async () => {
    const created = await db.exercises.filter((exercise) => exercise.name === '辅助俯卧撑').first();
    expect(created?.loadMode).toBe('assistance');
  });
  expect(addCustomExercise).toHaveBeenCalledWith('辅助俯卧撑', 'chest', 'assistance');
  expect(nameInput).toHaveValue('');
  expect(loadModeSelect).toHaveValue('external');
});

test('历史缺少重量类型的动作显示为普通负重', async () => {
  const bench = await db.exercises.get('p-bench');
  if (!bench) throw new Error('测试预置动作不存在');
  delete bench.loadMode;
  await db.exercises.put(bench);

  await openManager();

  const row = (await screen.findByText('卧推')).closest('li');
  expect(row).not.toBeNull();
  expect(within(row!).getByText('普通负重')).toBeInTheDocument();
});

test('取消改类型确认时不写库', async () => {
  const user = await openManager();
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const row = (await screen.findByText('辅助双杠臂屈伸')).closest('li');
  expect(row).not.toBeNull();

  await user.click(within(row!).getByRole('button', { name: '将辅助双杠臂屈伸改为普通负重' }));

  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('历史趋势与纪录会重新解释'));
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('原始组数据不变'));
  expect(setExerciseLoadMode).not.toHaveBeenCalled();
  expect((await db.exercises.get('p-assisted-dip'))?.loadMode).toBe('assistance');
});

test('预置动作确认改类型后更新标签和数据库', async () => {
  const user = await openManager();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const row = (await screen.findByText('卧推')).closest('li');
  expect(row).not.toBeNull();
  expect(within(row!).getByText('预置')).toBeInTheDocument();

  await user.click(within(row!).getByRole('button', { name: '将卧推改为辅助重量' }));

  await waitFor(async () => {
    expect((await db.exercises.get('p-bench'))?.loadMode).toBe('assistance');
  });
  expect(setExerciseLoadMode).toHaveBeenCalledWith('p-bench', 'assistance');
  expect(await within(row!).findByText('辅助重量')).toBeInTheDocument();
});

test('辅助重量动作确认后可改回普通负重并真实写库', async () => {
  const user = await openManager();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const row = (await screen.findByText('辅助双杠臂屈伸')).closest('li');
  expect(row).not.toBeNull();

  await user.click(within(row!).getByRole('button', {
    name: '将辅助双杠臂屈伸改为普通负重',
  }));

  await waitFor(async () => {
    expect((await db.exercises.get('p-assisted-dip'))?.loadMode).toBe('external');
  });
  expect(setExerciseLoadMode).toHaveBeenCalledWith('p-assisted-dip', 'external');
  expect(await within(row!).findByText('普通负重')).toBeInTheDocument();
});

test('改类型按钮同 tick 双击只写入一次', async () => {
  await openManager();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const row = (await screen.findByText('卧推')).closest('li');
  expect(row).not.toBeNull();
  const button = within(row!).getByRole('button', { name: '将卧推改为辅助重量' });

  fireEvent.click(button);
  fireEvent.click(button);

  expect(setExerciseLoadMode).toHaveBeenCalledTimes(1);
  await waitFor(async () => {
    expect((await db.exercises.get('p-bench'))?.loadMode).toBe('assistance');
  });
});

test('自定义动作保留改类型、改名和删除权限', async () => {
  await addCustomExercise('自定义卧推', 'chest');
  await openManager();
  const row = (await screen.findByText('自定义卧推')).closest('li');
  expect(row).not.toBeNull();

  expect(within(row!).getByRole('button', { name: '将自定义卧推改为辅助重量' })).toBeEnabled();
  expect(within(row!).getByRole('button', { name: '改名' })).toBeEnabled();
  expect(within(row!).getByRole('button', { name: '删除' })).toBeEnabled();
});

test('创建写入期间暴露 busy 并禁用所有写操作和表单', async () => {
  const custom = await addCustomExercise('自定义卧推', 'chest');
  const pending = deferred<Exercise>();
  vi.mocked(addCustomExercise).mockReturnValueOnce(pending.promise);
  const user = await openManager();
  await user.type(screen.getByPlaceholderText('新建胸动作…'), '等待写入');

  fireEvent.click(screen.getByRole('button', { name: '新建' }));

  const manager = screen.getByText('动作库').closest('[aria-busy]');
  expect(manager).not.toBeNull();
  await waitFor(() => expect(manager).toHaveAttribute('aria-busy', 'true'));
  expect(screen.getByPlaceholderText('新建胸动作…')).toBeDisabled();
  expect(screen.getByLabelText('重量类型')).toBeDisabled();
  expect(screen.getByRole('button', { name: '新建' })).toBeDisabled();
  expect(screen.getAllByText('改类型').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

  const customRow = screen.getByText('自定义卧推').closest('li');
  expect(customRow).not.toBeNull();
  expect(within(customRow!).getByRole('button', { name: '改名' })).toBeDisabled();
  expect(within(customRow!).getByRole('button', { name: '删除' })).toBeDisabled();

  await act(async () => pending.resolve(custom));
  await waitFor(() => expect(manager).toHaveAttribute('aria-busy', 'false'));
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

test('新建动作表单在窄屏使用两行网格并允许字段收缩', async () => {
  await openManager();
  const form = screen.getByTestId('new-exercise-form');
  expect(form.className).toContain('grid');
  expect(screen.getByPlaceholderText('新建胸动作…').className).toContain('min-w-0');
});
