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

/** 纯自重：昨天俯卧撑 20+18，今天引体向上 8+6。一次重量都没填 → 容量恒为 0 */
async function seedBodyweight() {
  const today = todayStr();
  await addWorkoutItem(addDays(today, -1), 'p-pushup', [{ reps: 20 }, { reps: 18 }]);
  await addWorkoutItem(today, 'p-pullup', [{ reps: 8 }, { reps: 6 }]);
}

/**
 * 容量 = 重量 × 次数。练俯卧撑和引体向上的人从不填重量，他的容量恒为 0 ——
 * 而这一格是 42px 的战绩数字，跟「总打卡」「总组数」并排立着。
 * 他读到的不是「我没记重量」，是「我练了等于零」。这正是 D1「硬摆零」的病，
 * 数据页（hasWeightData）、今日页（volume > 0）都堵过了，唯独这一页漏了。
 *
 * 而且不能只降级成「—」：那还是「这里本该有东西但没有」。自重训练者的负荷维度
 * 本来就是次数，那一格该显示他真正挣来的数字。
 *
 * 注：这条注释原本把「海报（formatVolume → 「—」）」也算作已堵的一处——记错了。
 * 海报当时画的恰恰是上一段否掉的那个「—」，直到 poster.ts 的 loadMetric 才真堵上。
 */
test('纯自重训练者：第四格立的是「总次数」，而不是一个 42px 的 0 kg', async () => {
  await seedBodyweight();
  renderProfile();

  const reps = await statCell('总次数');
  expect(within(reps).getByText('52')).toBeInTheDocument(); // 20+18+8+6
  expect(within(reps).getByText('次')).toBeInTheDocument();

  // 容量那一格根本不该出现：0 不是成绩，是噪声
  expect(screen.queryByText('累计容量')).not.toBeInTheDocument();

  // 另外三个真实的数字照旧
  expect(within(await statCell('总打卡')).getByText('2')).toBeInTheDocument();
  expect(within(await statCell('总组数')).getByText('4')).toBeInTheDocument();
});

/** 对抗式：证明上面那条不是把容量整个删了——填过重量的人必须还看得见它 */
test('填过重量的人仍看到「累计容量」，看不到「总次数」', async () => {
  await seedTraining();
  renderProfile();

  await screen.findByText('累计容量');
  expect(screen.queryByText('总次数')).not.toBeInTheDocument();
});

/** 混合：只要有过一组带重量的记录，容量就有意义，不许被自重组挤掉 */
test('自重 + 负重混着练：容量照常显示（有一组带重量就够）', async () => {
  await seedBodyweight();
  await seedTraining(); // 卧推/深蹲带重量
  renderProfile();

  const vol = await statCell('累计容量');
  expect(within(vol).getByText('1.9')).toBeInTheDocument();
  expect(screen.queryByText('总次数')).not.toBeInTheDocument();
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
  await seedTraining();
  const { container } = renderProfile();
  await screen.findByText('总打卡');
  expect(container.innerHTML).not.toMatch(/card2|iron2/);
});

test('零数据时成就墙给引导文案，不硬摆四个 0', async () => {
  const { container } = renderProfile();

  expect(await screen.findByText(/一条铁证都还没有/)).toBeInTheDocument();
  for (const label of ['总打卡', '最长连续', '总组数', '累计容量']) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
  }
  // 大号钢印字（.display）是战绩数字的唯一载体：零数据时一个都不该立起来，
  // 更不该立四个 0 —— 那是在告诉新用户「你什么都没有」
  expect([...container.querySelectorAll('.display')]).toHaveLength(0);
});

test('有数据时成就墙照常显示数字', async () => {
  await seedTraining();
  renderProfile();

  expect(within(await statCell('总打卡')).getByText('2')).toBeInTheDocument();
  expect(screen.queryByText(/一条铁证都还没有/)).not.toBeInTheDocument();
});

test('Epley 说明在 PR 列表之前（认知形成前校正）', async () => {
  await seedTraining();
  renderProfile();

  const note = await screen.findByText(/Epley/);
  const list = screen.getByRole('list', { name: 'PR 榜' });
  // 说明必须先于列表出现在 DOM 里，否则用户滚过 12 条才看到
  expect(note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

/** Extended_Pictographic 而非 \p{Emoji}：后者连数字 0-9 都匹配 */
const EMOJI = /\p{Extended_Pictographic}/u;

test('页面里没有 emoji（有数据）', async () => {
  await seedTraining();
  const { container } = renderProfile();
  await screen.findByText('总打卡');
  expect(container.textContent ?? '').not.toMatch(EMOJI);
});

test('页面里没有 emoji（零数据）', async () => {
  const { container } = renderProfile();
  await screen.findByText(/一条铁证都还没有/);
  expect(container.textContent ?? '').not.toMatch(EMOJI);
});
