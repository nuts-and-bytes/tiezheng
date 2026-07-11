import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetDb } from '../../test/dbTestUtils';
import { todayStr } from '../../lib/dates';
import { CalendarScreen } from './CalendarScreen';

beforeEach(resetDb);

test('渲染当月标题与星期行', async () => {
  render(
    <MemoryRouter>
      <CalendarScreen />
    </MemoryRouter>,
  );
  const [y, m] = todayStr().split('-');
  expect(await screen.findByText(`${y}年${Number(m)}月`)).toBeInTheDocument();
  expect(screen.getByText('一')).toBeInTheDocument();
  expect(screen.getByLabelText('上个月')).toBeInTheDocument();
});
