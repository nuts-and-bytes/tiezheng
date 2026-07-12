import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../../lib/db';
import { todayStr } from '../../lib/dates';
import { vibrate } from '../../lib/platform';
import { addCustomExercise, seedPresets } from '../../repos/exerciseRepo';
import { resetDb } from '../../test/dbTestUtils';
import { useLogDraft } from '../../stores/logDraftStore';
import { LogFlow } from './LogFlow';

vi.mock('../../repos/exerciseRepo', { spy: true });
vi.mock('../../lib/platform', { spy: true });

beforeEach(async () => {
  localStorage.clear();
  useLogDraft.setState({ active: false, parts: [], items: [] });
  await resetDb();
  vi.clearAllMocks();
  await seedPresets();
});

function renderFlow() {
  return render(
    <MemoryRouter>
      <LogFlow />
    </MemoryRouter>,
  );
}

/** 预置草稿到 step2（记组数）：active 必须为 true，否则挂载时 start() 会清空 */
function presetDraftAtStep2(sets: { weight?: number; reps?: number }[] = [{}, {}, {}]) {
  useLogDraft.setState({
    active: true,
    parts: ['chest'],
    items: [{ exerciseId: 'p-bench', sets }],
  });
}

async function activeWorkoutRows() {
  const workouts = (await db.workouts.toArray()).filter((w) => w.deletedAt === null);
  const items = (await db.workoutItems.toArray()).filter((i) => i.deletedAt === null);
  return { workouts, items };
}

test('第一步展示 7 个部位，选中后可进下一步', async () => {
  const user = userEvent.setup();
  renderFlow();
  expect(await screen.findByText('今天练哪儿？')).toBeInTheDocument();
  expect(screen.getByText('胸')).toBeInTheDocument();
  expect(screen.getByText('有氧')).toBeInTheDocument();

  const next = screen.getByText('下一步 · 选动作');
  expect(next).toBeDisabled();
  await user.click(screen.getByText('胸'));
  await waitFor(() => {
    expect(screen.getByText('下一步 · 选动作')).toBeEnabled();
  });
});

test('每个部位按钮都带一枚 PartIcon 图形', async () => {
  const { container } = renderFlow();
  await screen.findByText('今天练哪儿？');

  const partButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
    ['胸', '肩', '背', '腿', '手臂', '核心', '有氧'].includes(b.textContent?.trim() ?? ''),
  );
  expect(partButtons).toHaveLength(7);
  for (const btn of partButtons) {
    expect(btn.querySelector('svg')).not.toBeNull();
  }
});

test('记组数步骤用 etch 线分隔，不再一动作一张卡片', async () => {
  presetDraftAtStep2([{ weight: 60, reps: 10 }]);
  const { container } = renderFlow();

  await screen.findByText('记组数');
  expect(container.querySelectorAll('.bg-card')).toHaveLength(0);
  expect(container.querySelectorAll('.etch').length).toBeGreaterThan(0);
});

test('完成打卡落下钢印并震动（打卡 = 盖钢印）', async () => {
  presetDraftAtStep2([{ weight: 60, reps: 10 }]);
  renderFlow();

  fireEvent.click(await screen.findByText('完成打卡'));

  expect(await screen.findByRole('img', { name: '铁证' })).toBeInTheDocument();
  expect(vibrate).toHaveBeenCalledWith(200);
});

test('记录流端到端主链路：选部位→选动作→记组数→完成落库', async () => {
  const user = userEvent.setup();
  renderFlow();

  await user.click(await screen.findByText('胸'));
  await user.click(screen.getByText('下一步 · 选动作'));

  await user.click(await screen.findByText('卧推'));
  await user.click(screen.getByText('下一步 · 记组数（1）'));

  expect(await screen.findByText('记组数')).toBeInTheDocument();
  await user.type(screen.getAllByPlaceholderText('重量kg')[0], '60');
  await user.type(screen.getAllByPlaceholderText('次数')[0], '10');
  await user.click(screen.getByText('完成打卡'));

  expect(await screen.findByText('已留下铁证')).toBeInTheDocument();
  const { workouts, items } = await activeWorkoutRows();
  expect(workouts).toHaveLength(1);
  expect(workouts[0].date).toBe(todayStr());
  expect(items).toHaveLength(1);
  expect(items[0].exerciseId).toBe('p-bench');
  // 默认三行中未填的空行不入库（sanitizeSets 丢弃空组）
  expect(items[0].sets).toEqual([{ weight: 60, reps: 10 }]);
});

test('草稿有动作时挂载直接恢复到记组数步骤', async () => {
  presetDraftAtStep2();
  renderFlow();

  expect(await screen.findByText('记组数')).toBeInTheDocument();
  expect(screen.queryByText('今天练哪儿？')).toBeNull();
  expect(screen.getByText('完成打卡')).toBeInTheDocument();
});

test('连点完成打卡只落库一次', async () => {
  presetDraftAtStep2([{ weight: 60, reps: 10 }]);
  renderFlow();

  // 同 tick 双击：两次 click 之间无微任务间隙，复现 iOS 快速连点
  const finishBtn = await screen.findByText('完成打卡');
  fireEvent.click(finishBtn);
  fireEvent.click(finishBtn);

  expect(await screen.findByText('已留下铁证')).toBeInTheDocument();
  const { workouts, items } = await activeWorkoutRows();
  expect(workouts).toHaveLength(1);
  expect(items).toHaveLength(1);
});

test('重量支持小数输入（62.5 不被吃成 625）', async () => {
  const user = userEvent.setup();
  presetDraftAtStep2([{}]);
  renderFlow();

  const weightInput = await screen.findByPlaceholderText('重量kg');
  await user.type(weightInput, '62.5');

  expect(useLogDraft.getState().items[0].sets[0].weight).toBe(62.5);
});

test('输入一位数字后焦点保持在同一输入框', async () => {
  const user = userEvent.setup();
  presetDraftAtStep2([{}]);
  renderFlow();

  const weightInput = await screen.findByPlaceholderText('重量kg');
  await user.click(weightInput);
  await user.keyboard('5');

  expect(weightInput).toBeInTheDocument();
  expect(document.activeElement).toBe(weightInput);
});

test('选动作步骤内新建动作按钮同 tick 双击只产生 1 条记录', async () => {
  const user = userEvent.setup();
  renderFlow();

  await user.click(await screen.findByText('胸'));
  await user.click(screen.getByText('下一步 · 选动作'));
  await user.type(await screen.findByPlaceholderText('新建胸动作…'), '史密斯上斜推');

  // 同 tick 双击：两次 click 之间无微任务间隙，复现 iOS 快速连点（ExerciseManager 判例）
  const btn = screen.getByText('新建');
  fireEvent.click(btn);
  fireEvent.click(btn);

  expect(addCustomExercise).toHaveBeenCalledTimes(1);
  await waitFor(async () => {
    const customs = (await db.exercises.toArray()).filter((e) => !e.preset);
    expect(customs).toHaveLength(1);
  });
});
