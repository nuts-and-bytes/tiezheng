import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { seedPresets } from '../../repos/exerciseRepo';
import { resetDb } from '../../test/dbTestUtils';
import { useLogDraft } from '../../stores/logDraftStore';
import { LogFlow } from './LogFlow';

beforeEach(async () => {
  localStorage.clear();
  useLogDraft.setState({ active: false, parts: [], items: [] });
  await resetDb();
  await seedPresets();
});

test('第一步展示 7 个部位，选中后可进下一步', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <LogFlow />
    </MemoryRouter>,
  );
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
