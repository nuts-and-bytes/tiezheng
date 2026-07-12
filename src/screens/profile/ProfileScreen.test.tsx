import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { addDays, todayStr } from '../../lib/dates';
import { buildWorkoutCsv } from '../../lib/exportData';
import { listByPart, seedPresets } from '../../repos/exerciseRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { resetDb } from '../../test/dbTestUtils';
import { ProfileScreen } from './ProfileScreen';

vi.mock('../../lib/exportData', { spy: true });

beforeEach(async () => {
  await resetDb();
  await seedPresets();
  vi.clearAllMocks();
});

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/poster" element={<h1>海报页</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 昨天：卧推 100×5 + 80×10；今天：深蹲 60×10
 *  → 2 天 / 3 组 / 100×5 + 80×10 + 60×10 = 1900kg / 最长连续 2 */
async function seedTraining() {
  const today = todayStr();
  const [bench] = await listByPart('chest'); // 卧推
  const [squat] = await listByPart('leg'); // 深蹲
  await addWorkoutItem(addDays(today, -1), bench.id, [
    { weight: 100, reps: 5 },
    { weight: 80, reps: 10 },
  ]);
  await addWorkoutItem(today, squat.id, [{ weight: 60, reps: 10 }]);
}

/** 战绩格：标签所在的那一格 */
async function statCell(label: string): Promise<HTMLElement> {
  const el = await screen.findByText(label);
  return el.closest('div') as HTMLElement;
}

test('顶部战绩：总打卡 / 最长连续 / 总组数 / 累计容量', async () => {
  await seedTraining();
  renderProfile();

  expect(within(await statCell('总打卡')).getByText('2')).toBeInTheDocument();
  expect(within(await statCell('最长连续')).getByText('2')).toBeInTheDocument();
  expect(within(await statCell('总组数')).getByText('3')).toBeInTheDocument();
  const vol = await statCell('累计容量');
  expect(within(vol).getByText('1.9')).toBeInTheDocument();
  expect(within(vol).getByText('t')).toBeInTheDocument();
});

test('.display 里不许出现中文（Anton 无中日韩字形）', async () => {
  await seedTraining();
  const { container } = renderProfile();
  await screen.findByText('总打卡');

  const displays = [...container.querySelectorAll('.display')];
  expect(displays.length).toBeGreaterThan(0);
  for (const el of displays) {
    expect(el.textContent ?? '').not.toMatch(/[一-鿿]/);
  }
});

test('PR 榜按预估 1RM 降序，带部位图标', async () => {
  await seedTraining();
  renderProfile();

  const list = await screen.findByRole('list', { name: 'PR 榜' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  // 卧推 100×5 → e1RM 117；深蹲 60×10 → e1RM 80
  expect(rows[0]).toHaveTextContent('卧推');
  expect(rows[0]).toHaveTextContent('117');
  expect(rows[1]).toHaveTextContent('深蹲');
  expect(rows[1]).toHaveTextContent('80');
  expect(list.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
});

test('没有带重量的组时 PR 榜显示空态', async () => {
  renderProfile();
  expect(await screen.findByText(/还没有纪录/)).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'PR 榜' })).not.toBeInTheDocument();
});

test('点「导出训练海报」跳到 /poster', async () => {
  const user = userEvent.setup();
  renderProfile();
  await user.click(await screen.findByRole('button', { name: '导出训练海报' }));
  expect(await screen.findByText('海报页')).toBeInTheDocument();
});

test('周目标 ± 按钮仍可调整', async () => {
  const user = userEvent.setup();
  renderProfile();
  expect(await screen.findByText('4 练/周')).toBeInTheDocument(); // 默认 4
  await user.click(screen.getByLabelText('增加目标'));
  expect(await screen.findByText('5 练/周')).toBeInTheDocument();
});

test('导出 CSV 失败时显示错误文案（无 unhandled rejection）', async () => {
  vi.mocked(buildWorkoutCsv).mockRejectedValueOnce(new Error('boom'));
  const user = userEvent.setup();
  renderProfile();
  await user.click(await screen.findByText('导出 CSV'));
  expect(await screen.findByText('导出失败，请重试')).toBeInTheDocument();
});

test('不再使用废弃别名 card2 / iron2', async () => {
  const { container } = renderProfile();
  await screen.findByText('总打卡');
  expect(container.innerHTML).not.toMatch(/card2|iron2/);
});
