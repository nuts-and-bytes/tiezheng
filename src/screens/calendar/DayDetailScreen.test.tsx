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

/**
 * 写侧 sanitizeSets 保留一组的条件是 weight **或** reps 有值（validation.ts:34），
 * 而这一屏的读侧原本要求两者**同时**有值 —— 于是纯自重训练者填的次数在唯一能回看
 * 单日明细的地方全部消失，只剩一个「4 组」。他填的 12/12/10/8 和什么都没填，长得一模一样。
 */
test('只填次数的组：次数看得见，不再退化成一个「4 组」', async () => {
  await addWorkoutItem('2026-07-10', 'p-pullup', [{ reps: 12 }, { reps: 12 }, { reps: 10 }, { reps: 8 }]);
  renderDay('2026-07-10');

  expect(await screen.findByText(/12次\s+12次\s+10次\s+8次/)).toBeInTheDocument();
  expect(screen.queryByText('4 组')).not.toBeInTheDocument();
});

/** 混合场景：正文列出的项数必须等于页头的总组数，否则同一屏上两个数字打架 */
test('自重与负重混着记：四组全部可见，与页头「4 组」对得上', async () => {
  await addWorkoutItem('2026-07-10', 'p-bench', [
    { weight: 60, reps: 10 },
    { weight: 60, reps: 8 },
    { reps: 12 },
    { reps: 10 },
  ]);
  renderDay('2026-07-10');

  expect(await screen.findByText(/60×10\s+60×8\s+12次\s+10次/)).toBeInTheDocument();
});

/** 对抗式护栏：别把「只记组数、一个数字都没填」的兜底一起改坏 */
test('一个数字都没填的组仍走「3 组」兜底', async () => {
  await addWorkoutItem('2026-07-10', 'p-bench', [{}, {}, {}]);
  renderDay('2026-07-10');
  expect(await screen.findByText('3 组')).toBeInTheDocument();
});

test('编辑时输入超范围的重量：保存按钮禁用', async () => {
  const user = userEvent.setup();
  await addWorkoutItem('2026-07-10', 'p-bench', [{ weight: 60, reps: 10 }]);
  renderDay('2026-07-10');

  await user.click(await screen.findByText('编辑'));
  const weight = await screen.findByPlaceholderText('重量kg');
  await user.clear(weight);
  await user.type(weight, '9999');

  expect(screen.getByText('保存')).toBeDisabled();
  expect(await screen.findByText(/0–1000/)).toBeInTheDocument();
});
