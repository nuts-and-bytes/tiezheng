import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { seedPresets } from '../../repos/exerciseRepo';
import { setWeight } from '../../repos/weightRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { resetDb } from '../../test/dbTestUtils';
import { DayDetailScreen } from './DayDetailScreen';

beforeEach(async () => {
  await resetDb();
  await seedPresets();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderDay(date: string) {
  return render(
    <MemoryRouter initialEntries={[`/day/${date}`]}>
      <Routes>
        <Route path="/day/:date" element={<DayDetailScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('当日体重展示保留一位小数', async () => {
  await setWeight('2026-07-10', 62.456);
  renderDay('2026-07-10');
  expect(await screen.findByText('62.5 kg')).toBeInTheDocument();
});

test('删除当日唯一动作后呈现空态，重新挂载同日不白屏', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const user = userEvent.setup();
  await addWorkoutItem('2026-07-10', 'p-bench', [{ weight: 60, reps: 8 }]);

  const { unmount } = renderDay('2026-07-10');
  expect(await screen.findByText('卧推')).toBeInTheDocument();
  await user.click(screen.getByText('编辑'));
  await user.click(screen.getByText('删除'));
  expect(await screen.findByText('这天没有训练记录')).toBeInTheDocument();

  unmount();
  renderDay('2026-07-10');
  expect(await screen.findByText('这天没有训练记录')).toBeInTheDocument();
});

test('编辑保存后视图刷新为新组数（小数重量路径）', async () => {
  const user = userEvent.setup();
  await addWorkoutItem('2026-07-10', 'p-bench', [{ weight: 60, reps: 8 }]);

  renderDay('2026-07-10');
  expect(await screen.findByText('60×8')).toBeInTheDocument();
  await user.click(screen.getByText('编辑'));
  const weightInput = screen.getByPlaceholderText('重量kg');
  await user.clear(weightInput);
  await user.type(weightInput, '62.5');
  await user.click(screen.getByText('保存'));
  expect(await screen.findByText('62.5×8')).toBeInTheDocument();
  expect(screen.queryByText('60×8')).not.toBeInTheDocument();
});

test('编辑后取消丢弃修改，视图仍显示原值', async () => {
  const user = userEvent.setup();
  await addWorkoutItem('2026-07-10', 'p-bench', [{ weight: 60, reps: 8 }]);

  renderDay('2026-07-10');
  expect(await screen.findByText('60×8')).toBeInTheDocument();
  await user.click(screen.getByText('编辑'));
  const weightInput = screen.getByPlaceholderText('重量kg');
  await user.clear(weightInput);
  await user.type(weightInput, '999');
  await user.click(screen.getByText('取消'));
  expect(await screen.findByText('60×8')).toBeInTheDocument();
  expect(screen.queryByPlaceholderText('重量kg')).not.toBeInTheDocument();
});

test('非法 date 参数渲染优雅空态不崩溃', async () => {
  renderDay('garbage');
  expect(await screen.findByText('这天没有训练记录')).toBeInTheDocument();
  expect(screen.getByText('garbage')).toBeInTheDocument();
});

test('每条记录带部位图标与部位名，一眼看出练的是哪儿', async () => {
  await addWorkoutItem('2026-07-10', 'p-bench', [{ weight: 60, reps: 8 }]);
  const { container } = renderDay('2026-07-10');
  expect(await screen.findByText('卧推')).toBeInTheDocument();
  expect(container.querySelector('[data-part="chest"]')).toBeTruthy();
  expect(screen.getByText('胸')).toBeInTheDocument();
});

test('不再使用废弃别名 card2 / iron2', async () => {
  await addWorkoutItem('2026-07-10', 'p-bench', [{ weight: 60, reps: 8 }]);
  const user = userEvent.setup();
  const { container } = renderDay('2026-07-10');
  await user.click(await screen.findByText('编辑')); // 编辑态才会露出取消/删除两个按钮
  expect(container.innerHTML).not.toMatch(/card2|iron2/);
});
