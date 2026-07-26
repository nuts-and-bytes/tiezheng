import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { seedPresets } from '../../repos/exerciseRepo';
import { addWorkoutItem } from '../../repos/workoutRepo';
import { resetDb } from '../../test/dbTestUtils';
import { CalendarScreen } from './CalendarScreen';

vi.mock('../../lib/dates', async (orig) => ({
  ...(await orig<typeof import('../../lib/dates')>()),
  todayStr: () => '2026-07-26',
}));

beforeEach(async () => {
  await resetDb();
  await seedPresets();
});

function setsOf(count: number, weight = 60) {
  return Array.from({ length: count }, () => ({ weight, reps: 8 }));
}

async function seedCalendar() {
  await addWorkoutItem('2026-06-10', 'p-squat', setsOf(2));
  await addWorkoutItem('2026-06-30', 'p-bench', setsOf(3));
  await addWorkoutItem('2026-07-03', 'p-bench', setsOf(3));
  await addWorkoutItem('2026-07-15', 'p-bench', setsOf(4));
  await addWorkoutItem('2026-07-15', 'p-pullup', setsOf(2));
  await addWorkoutItem('2026-07-25', 'p-squat', setsOf(5));
}

function renderCalendar() {
  return render(
    <MemoryRouter>
      <CalendarScreen />
    </MemoryRouter>,
  );
}

test('保留月份头、切月按钮和当月统计，以 31 个真实日期组成月度轨道', async () => {
  await seedCalendar();
  renderCalendar();

  expect(await screen.findByTestId('month-num')).toHaveTextContent('07');
  expect(screen.getByText('2026 七月')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '上个月' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下个月' })).toBeInTheDocument();

  const rail = await screen.findByTestId('month-rail');
  expect(within(rail).getAllByTestId(/^rail-day-/)).toHaveLength(31);
  const stats = screen.getByTestId('month-stats');
  expect(within(stats).getByText('3')).toBeInTheDocument();
  expect(within(stats).getByText('14')).toBeInTheDocument();
  expect(within(stats).getByText('本月打卡')).toBeInTheDocument();
  expect(within(stats).getByText('本月组数')).toBeInTheDocument();
});

test('当前月默认选今天之前最近训练日，点击另一训练柱后信息卡更新', async () => {
  const user = userEvent.setup();
  await seedCalendar();
  renderCalendar();

  expect(await screen.findByRole('heading', { name: '本周六' })).toBeInTheDocument();
  expect(screen.getByText('2026年7月25日')).toBeInTheDocument();
  expect(screen.getByText('深蹲')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /2026年7月15日/ }));

  expect(screen.getByRole('heading', { name: '上周三' })).toBeInTheDocument();
  expect(screen.getByText('卧推')).toBeInTheDocument();
  expect(screen.getByText('引体向上')).toBeInTheDocument();
  expect(screen.getByText('6 组')).toBeInTheDocument();
});

test('切到历史月后选最后训练日，空月不生成虚假信息卡', async () => {
  const user = userEvent.setup();
  await seedCalendar();
  renderCalendar();
  await screen.findByRole('heading', { name: '本周六' });

  await user.click(screen.getByRole('button', { name: '上个月' }));
  expect(await screen.findByText('2026年6月30日')).toBeInTheDocument();
  expect(screen.getByText('卧推')).toBeInTheDocument();
  expect(screen.getByTestId('month-rail').querySelectorAll('[data-testid^="rail-day-"]')).toHaveLength(30);

  await user.click(screen.getByRole('button', { name: '上个月' }));
  expect(await screen.findByTestId('month-empty')).toHaveTextContent('这个月还没有一条铁证');
  expect(screen.queryByRole('link', { name: '查看完整记录' })).toBeNull();
});

test('切月后如旧选择无效，按新月份规则重新选择', async () => {
  const user = userEvent.setup();
  await seedCalendar();
  renderCalendar();
  await screen.findByText('2026年7月25日');

  await user.click(screen.getByRole('button', { name: /2026年7月15日/ }));
  await user.click(screen.getByRole('button', { name: '上个月' }));

  await waitFor(() => expect(screen.getByText('2026年6月30日')).toBeInTheDocument());
  expect(screen.queryByText('2026年7月15日')).toBeNull();
});
