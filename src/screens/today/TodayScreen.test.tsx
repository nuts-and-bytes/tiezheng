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

test('空状态显示开始训练 CTA 与目标环', async () => {
  renderToday();
  expect(await screen.findByText('+ 开始今日训练')).toBeInTheDocument();
  expect(screen.getByText('今天，留证。')).toBeInTheDocument();
  expect(screen.getByText('本周目标')).toBeInTheDocument();
});

test('今日已有训练时展示已练列表且 CTA 为继续加练', async () => {
  await addWorkoutItem(todayStr(), 'p-bench', [{}, {}, {}]);
  renderToday();
  expect(await screen.findByText('+ 继续加练')).toBeInTheDocument();
  expect(screen.getByText('今日已练')).toBeInTheDocument();
  expect(screen.getByText('卧推')).toBeInTheDocument();
  expect(screen.getByText('3 组')).toBeInTheDocument();
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
