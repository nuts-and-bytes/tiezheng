import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildWorkoutCsv } from '../../lib/exportData';
import { seedPresets } from '../../repos/exerciseRepo';
import { resetDb } from '../../test/dbTestUtils';
import { ProfileScreen } from './ProfileScreen';

vi.mock('../../lib/exportData', { spy: true });

beforeEach(async () => {
  await resetDb();
  await seedPresets();
  vi.clearAllMocks();
});

test('导出 CSV 失败时显示错误文案（无 unhandled rejection）', async () => {
  vi.mocked(buildWorkoutCsv).mockRejectedValueOnce(new Error('boom'));
  const user = userEvent.setup();
  render(<ProfileScreen />);
  await user.click(await screen.findByText('导出 CSV'));
  expect(await screen.findByText('导出失败，请重试')).toBeInTheDocument();
});
