import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { todayStr } from '../../lib/dates';
import { seedPresets } from '../../repos/exerciseRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { resetDb } from '../../test/dbTestUtils';
import { useLogDraft } from '../../stores/logDraftStore';
import { TodayScreen } from './TodayScreen';

beforeEach(async () => {
  await resetDb();
  await seedPresets();
  useLogDraft.setState({ active: false, parts: [], items: [] });
  localStorage.clear();
});

function renderToday() {
  return render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );
}

test('第一屏出现品牌标识（钢印 + wordmark）', async () => {
  renderToday();
  expect(await screen.findByText('IRONPROOF')).toBeInTheDocument();
  expect(screen.getByText('铁证')).toBeInTheDocument();
});

test('空状态显示开始训练 CTA 与本周锻造环', async () => {
  renderToday();
  expect(await screen.findByText('开始今日训练')).toBeInTheDocument();
  expect(screen.getByText('今天，留证。')).toBeInTheDocument();
  // 未打卡：环显示本周进度（ForgeRing 环心文案）与还差几练
  expect(screen.getByText('/ 4 练')).toBeInTheDocument();
  expect(screen.getByText('还差 4 练')).toBeInTheDocument();
  // 未打卡 → 钢印不落下
  expect(screen.queryByRole('img', { name: '今日铁证' })).not.toBeInTheDocument();
});

test('今日已练时钢印落下，取代本周进度环', async () => {
  await addWorkoutItem(todayStr(), 'p-bench', [{}, {}, {}]);
  renderToday();
  expect(await screen.findByRole('img', { name: '今日铁证' })).toBeInTheDocument();
  expect(screen.getByText('今天，铁证已落。')).toBeInTheDocument();
  expect(screen.queryByText('/ 4 练')).not.toBeInTheDocument();
});

test('今日已有训练时展示已练摘要（部位图标 + 部位名 + 组数）且 CTA 为继续打卡', async () => {
  await addWorkoutItem(todayStr(), 'p-bench', [{}, {}, {}]);
  const { container } = renderToday();
  expect(await screen.findByText('继续打卡')).toBeInTheDocument();
  expect(screen.getByText('今日已练')).toBeInTheDocument();
  expect(screen.getByText('卧推')).toBeInTheDocument();
  expect(screen.getByTestId('today-sets')).toHaveTextContent('3组');
  // 一眼看出练的是哪个部位：部位名 + 对应部位图标
  expect(screen.getByText('胸')).toBeInTheDocument();
  expect(container.querySelector('[data-part="chest"] svg')).not.toBeNull();
});

test('同部位的多个动作合并为一行，组数累加', async () => {
  await addWorkoutItem(todayStr(), 'p-bench', [{}, {}, {}]);
  await addWorkoutItem(todayStr(), 'p-incline-bench', [{}, {}]);
  const { container } = renderToday();
  expect(await screen.findByText('卧推')).toBeInTheDocument();
  expect(screen.getByText('上斜卧推')).toBeInTheDocument();
  expect(screen.getByTestId('today-sets')).toHaveTextContent('5组');
  expect(container.querySelectorAll('[data-part="chest"]')).toHaveLength(1);
});

test('有重量数据时 meta 行只补充容量，不重复右栏已经说过的组数', async () => {
  await addWorkoutItem(todayStr(), 'p-bench', [
    { weight: 60, reps: 10 },
    { weight: 60, reps: 10 },
  ]);
  renderToday();
  const meta = await screen.findByTestId('today-meta');
  expect(meta).toHaveTextContent('1,200 kg 容量');
  // 组数是右栏大号数字的职责，meta 行重复它就是噪声
  expect(meta).not.toHaveTextContent('组');
  expect(screen.getByTestId('today-sets')).toHaveTextContent('2组');
});

test('只记组数没记重量时 meta 行整行不渲染', async () => {
  await addWorkoutItem(todayStr(), 'p-bench', [{}, {}, {}]);
  renderToday();
  expect(await screen.findByTestId('today-sets')).toHaveTextContent('3组');
  expect(screen.queryByTestId('today-meta')).not.toBeInTheDocument();
  // 也不能有残留的「3 组」文本节点（旧 meta 行的重复）
  expect(screen.queryByText('3 组')).not.toBeInTheDocument();
});

test('多部位时各自独立判断 meta 行：有容量的渲染，无容量的整行不渲染', async () => {
  await addWorkoutItem(todayStr(), 'p-bench', [{ weight: 50, reps: 10 }]);
  await addWorkoutItem(todayStr(), 'p-squat', [{}, {}]);
  renderToday();
  await screen.findByText('卧推');
  const metas = screen.getAllByTestId('today-meta');
  expect(metas).toHaveLength(1);
  expect(metas[0]).toHaveTextContent('500 kg 容量');
});

test('存在未完成草稿且今日未练时 CTA 为继续记录', async () => {
  useLogDraft.setState({ active: true, parts: ['chest'], items: [] });
  renderToday();
  expect(await screen.findByText('继续未完成的记录')).toBeInTheDocument();
});

test('体重超限提示错误', async () => {
  const user = userEvent.setup();
  renderToday();
  await user.type(await screen.findByPlaceholderText('体重 kg'), '500');
  await user.click(screen.getByText('记录'));
  expect(await screen.findByText('体重需在 20–300kg 之间')).toBeInTheDocument();
});

test('超限报错后修改输入即时清除提示', async () => {
  const user = userEvent.setup();
  renderToday();
  const input = await screen.findByPlaceholderText('体重 kg');
  await user.type(input, '500');
  await user.click(screen.getByText('记录'));
  expect(await screen.findByText('体重需在 20–300kg 之间')).toBeInTheDocument();
  await user.clear(input);
  await user.type(input, '5');
  expect(screen.queryByText('体重需在 20–300kg 之间')).not.toBeInTheDocument();
});

test('体重合法保存后展示刷新且保留一位小数', async () => {
  const user = userEvent.setup();
  renderToday();
  const input = await screen.findByPlaceholderText('体重 kg');
  await user.type(input, '62.5');
  await user.click(screen.getByText('记录'));
  expect(await screen.findByText('62.5 kg')).toBeInTheDocument();
  expect(input).toHaveValue('');
  await user.type(input, '70.123456789');
  await user.click(screen.getByText('记录'));
  expect(await screen.findByText('70.1 kg')).toBeInTheDocument();
});
