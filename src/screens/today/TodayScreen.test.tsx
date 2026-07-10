import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { resetDb } from '../../test/dbTestUtils';
import { useLogDraft } from '../../stores/logDraftStore';
import { TodayScreen } from './TodayScreen';

beforeEach(async () => {
  await resetDb();
  useLogDraft.setState({ active: false, parts: [], items: [] });
  localStorage.clear();
});

test('空状态显示开始训练 CTA 与目标环', async () => {
  render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );
  expect(await screen.findByText('+ 开始今日训练')).toBeInTheDocument();
  expect(screen.getByText('今天，留证。')).toBeInTheDocument();
  expect(screen.getByText('本周目标')).toBeInTheDocument();
});

test('体重超限提示错误', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );
  await user.type(await screen.findByPlaceholderText('体重 kg'), '500');
  await user.click(screen.getByText('记录'));
  expect(await screen.findByText('体重需在 20–300kg 之间')).toBeInTheDocument();
});
