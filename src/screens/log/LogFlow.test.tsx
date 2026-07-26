import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../../lib/db';
import { todayStr } from '../../lib/dates';
import { vibrate } from '../../lib/platform';
import { addCustomExercise, seedPresets } from '../../repos/exerciseRepo';
import { commitDraft } from '../../repos/workoutRepo';
import { resetDb } from '../../test/dbTestUtils';
import { useLogDraft } from '../../stores/logDraftStore';
import { LogFlow } from './LogFlow';

vi.mock('../../repos/exerciseRepo', { spy: true });
vi.mock('../../repos/workoutRepo', { spy: true });
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

function renderFlowWithHistory() {
  return render(
    <MemoryRouter initialEntries={['/before', '/log']} initialIndex={1}>
      <Routes>
        <Route path="/before" element={<p>上一页</p>} />
        <Route path="/log" element={<LogFlow />} />
      </Routes>
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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

test('部位和动作选择链路在单视口内可收缩，动作列表独立滚动且底部操作保留安全区', async () => {
  const user = userEvent.setup();
  renderFlow();

  const partsStep = (await screen.findByRole('heading', { name: '今天练哪儿？' })).parentElement;
  expect(partsStep).toHaveClass('min-h-0', 'flex-1');
  expect(partsStep?.className).toContain('safe-area-inset-bottom');

  await user.click(screen.getByText('胸'));
  await user.click(screen.getByText('下一步 · 选动作'));

  const exercisesStep = (await screen.findByRole('heading', { name: '选动作' })).parentElement;
  expect(exercisesStep).toHaveClass('min-h-0', 'flex-1');
  const exerciseList = screen.getByRole('region', { name: '动作选择列表' });
  expect(exerciseList).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
  const footer = screen.getByText('下一步 · 记组数（0）').parentElement;
  expect(footer).toHaveClass('shrink-0');
  expect(footer?.className).toContain('safe-area-inset-bottom');
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
  // 默认四行中未填的空行不入库（sanitizeSets 丢弃空组）
  expect(items[0].sets).toEqual([{ weight: 60, reps: 10 }]);
});

test('草稿有动作时挂载直接恢复到记组数步骤', async () => {
  presetDraftAtStep2();
  renderFlow();

  expect(await screen.findByText('记组数')).toBeInTheDocument();
  expect(screen.queryByText('今天练哪儿？')).toBeNull();
  expect(screen.getByText('完成打卡')).toBeInTheDocument();
});

test('旧三组草稿恢复后仍只渲染三组，不被四组默认值补齐', async () => {
  presetDraftAtStep2([{}, {}, {}]);
  renderFlow();

  expect(await screen.findByText('3 组')).toBeInTheDocument();
  expect(screen.getAllByPlaceholderText('重量kg')).toHaveLength(3);
});

test('辅助预设在记组数页使用辅助重量输入与强弱提示', async () => {
  useLogDraft.setState({
    active: true,
    parts: ['chest'],
    items: [{ exerciseId: 'p-assisted-dip', sets: [{}, {}, {}, {}] }],
  });
  renderFlow();

  expect(await screen.findByText('辅助双杠臂屈伸')).toBeInTheDocument();
  expect(screen.getAllByPlaceholderText('辅助 kg')).toHaveLength(4);
  expect(screen.getByText('辅助越少，表现越强')).toBeInTheDocument();
  expect(screen.getByLabelText('第 1 组 辅助重量（公斤）')).toBeInTheDocument();
});

test('继续添加同部位动作会保留部位、已选动作和输入值，且第二个动作默认四组', async () => {
  const user = userEvent.setup();
  renderFlow();

  await user.click(await screen.findByText('胸'));
  await user.click(screen.getByText('下一步 · 选动作'));
  await user.click(await screen.findByText('卧推'));
  await user.click(screen.getByText('下一步 · 记组数（1）'));

  expect(await screen.findAllByPlaceholderText('重量kg')).toHaveLength(4);
  await user.type(screen.getByLabelText('第 1 组 重量（公斤）'), '60');
  await user.type(screen.getByLabelText('第 1 组 次数'), '10');
  await user.click(screen.getByText('继续添加动作'));

  expect(await screen.findByText('选动作')).toBeInTheDocument();
  expect(screen.getByText('卧推')).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByText('上斜卧推'));
  await user.click(screen.getByText('下一步 · 记组数（2）'));

  const weights = await screen.findAllByLabelText('第 1 组 重量（公斤）');
  const reps = screen.getAllByLabelText('第 1 组 次数');
  expect(weights).toHaveLength(2);
  expect(weights[0]).toHaveValue('60');
  expect(reps[0]).toHaveValue('10');
  expect(weights[1]).toHaveValue('');
  expect(screen.getAllByPlaceholderText('重量kg')).toHaveLength(8);
  expect(useLogDraft.getState()).toMatchObject({ parts: ['chest'] });
  expect(useLogDraft.getState().items.map((item) => item.sets.length)).toEqual([4, 4]);
});

test('记组数页锁定单视口，组列表独立滚动，安全区操作栏是不滚动的底部 footer', async () => {
  presetDraftAtStep2();
  renderFlow();

  const root = await screen.findByRole('main', { name: '记录训练' });
  expect(root).toHaveClass('h-dvh', 'overflow-hidden', 'flex', 'flex-col');
  expect(root).not.toHaveClass('min-h-dvh');
  expect(screen.getByRole('banner')).toHaveClass('shrink-0');

  const editor = screen.getByRole('group', { name: '编辑训练组' });
  expect(editor).toHaveClass('flex-1', 'min-h-0', 'flex', 'flex-col');

  const scroller = await screen.findByRole('region', { name: '动作组数' });
  expect(scroller).toHaveClass('flex-1', 'min-h-0', 'overflow-y-auto', 'pb-8');

  const toolbar = screen.getByRole('toolbar', { name: '记组数操作' });
  expect(toolbar).toHaveClass('shrink-0');
  expect(toolbar).not.toHaveClass('sticky');
  expect(toolbar.className).toContain('safe-area-inset-bottom');
  expect(within(toolbar).getByText('继续添加动作')).toBeInTheDocument();
  expect(within(toolbar).getByText('完成打卡')).toBeInTheDocument();
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

test('提交挂起时冻结关闭、继续添加、移除、组输入和加减组，完成后只提交一次并重置', async () => {
  const user = userEvent.setup();
  const pending = deferred<void>();
  vi.mocked(commitDraft).mockReturnValueOnce(pending.promise);
  presetDraftAtStep2([{ weight: 60, reps: 10 }, {}, {}, {}]);
  renderFlowWithHistory();

  const finish = await screen.findByText('完成打卡');
  fireEvent.click(finish);

  await waitFor(() => expect(commitDraft).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('main', { name: '记录训练' })).toHaveAttribute('aria-busy', 'true');
  expect(commitDraft).toHaveBeenCalledWith(
    [{ exerciseId: 'p-bench', sets: [{ weight: 60, reps: 10 }] }],
    todayStr(),
  );

  const close = screen.getByText('关闭');
  const continueAdding = screen.getByText('继续添加动作');
  const remove = screen.getByText('移除');
  const weight = screen.getByLabelText('第 1 组 重量（公斤）');
  const subtractSet = screen.getByLabelText('减一组');
  const addSet = screen.getByLabelText('加一组');
  for (const control of [close, continueAdding, remove, weight, subtractSet, addSet, finish]) {
    expect(control).toBeDisabled();
  }

  const before = useLogDraft.getState().items;
  await user.click(close);
  await user.click(continueAdding);
  await user.click(remove);
  await user.click(subtractSet);
  await user.click(addSet);
  await user.type(weight, '9');
  fireEvent.click(finish);

  expect(screen.queryByText('上一页')).toBeNull();
  expect(screen.getByText('记组数')).toBeInTheDocument();
  expect(weight).toHaveValue('60');
  expect(useLogDraft.getState().items).toEqual(before);
  expect(commitDraft).toHaveBeenCalledTimes(1);

  pending.resolve();
  expect(await screen.findByText('已留下铁证')).toBeInTheDocument();
  expect(useLogDraft.getState()).toMatchObject({ active: false, parts: [], items: [] });
  expect(commitDraft).toHaveBeenCalledTimes(1);
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

test('新建辅助动作会传递重量类型并真实写入数据库，成功后重置类型', async () => {
  const user = userEvent.setup();
  renderFlow();

  await user.click(await screen.findByText('胸'));
  await user.click(screen.getByText('下一步 · 选动作'));
  const loadMode = await screen.findByLabelText('新动作重量类型');
  await user.selectOptions(loadMode, 'assistance');
  await user.type(screen.getByPlaceholderText('新建胸动作…'), '辅助俯卧撑');
  await user.click(screen.getByText('新建'));

  await waitFor(async () => {
    const created = await db.exercises.filter((exercise) => exercise.name === '辅助俯卧撑').first();
    expect(created?.loadMode).toBe('assistance');
  });
  expect(addCustomExercise).toHaveBeenCalledWith('辅助俯卧撑', 'chest', 'assistance');
  expect(loadMode).toHaveValue('external');
  expect(screen.getByPlaceholderText('新建胸动作…')).toHaveValue('');
});

test('新建动作期间名称、类型和按钮全部禁用', async () => {
  const user = userEvent.setup();
  let resolveCreate!: (exercise: Awaited<ReturnType<typeof addCustomExercise>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof addCustomExercise>>>((resolve) => {
    resolveCreate = resolve;
  });
  vi.mocked(addCustomExercise).mockReturnValueOnce(pending);
  renderFlow();

  await user.click(await screen.findByText('胸'));
  await user.click(screen.getByText('下一步 · 选动作'));
  const name = await screen.findByPlaceholderText('新建胸动作…');
  const loadMode = screen.getByLabelText('新动作重量类型');
  const create = screen.getByText('新建');
  await user.type(name, '等待落库');
  await user.click(create);

  expect(name).toBeDisabled();
  expect(loadMode).toBeDisabled();
  expect(create).toBeDisabled();

  resolveCreate({
    id: 'custom-pending',
    name: '等待落库',
    bodyPart: 'chest',
    loadMode: 'external',
    preset: false,
    updatedAt: Date.now(),
    deletedAt: null,
  });
  await waitFor(() => expect(name).toBeEnabled());
});

/**
 * 静默丢弃是最坏的失败模式：用户输了 20260710（日期串进重量栏），按下「完成打卡」，
 * sanitizeSets 把 weight 剥掉，落库的是一组只有次数的记录 —— 而 app 从头到尾
 * 没有告诉他任何事。他要在几天后翻日历时才发现那一栏是空的。
 * 拦在保存之前，让他改对。
 */
test('超范围的重量：完成打卡按钮禁用，不许静默丢弃', async () => {
  const user = userEvent.setup();
  presetDraftAtStep2();
  renderFlow();

  const finish = await screen.findByText('完成打卡');
  expect(finish).toBeEnabled();

  await user.type(screen.getAllByPlaceholderText('重量kg')[0], '20260710');
  expect(screen.getByText('完成打卡')).toBeDisabled();
  expect(await screen.findByText(/0–1000/)).toBeInTheDocument();
});

/** 对抗式护栏：改回合法值后必须能救回来，不能一错就锁死 */
test('把超范围的值改回合法后，完成打卡重新可用', async () => {
  const user = userEvent.setup();
  presetDraftAtStep2();
  renderFlow();

  const weight = (await screen.findAllByPlaceholderText('重量kg'))[0];
  await user.type(weight, '9999');
  expect(screen.getByText('完成打卡')).toBeDisabled();

  await user.clear(weight);
  await user.type(weight, '560'); // 腿举机，真实值
  expect(screen.getByText('完成打卡')).toBeEnabled();
});
