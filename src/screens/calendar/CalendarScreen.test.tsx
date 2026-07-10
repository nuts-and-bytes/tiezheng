import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { resetDb } from '../../test/dbTestUtils';
import { CalendarScreen } from './CalendarScreen';

beforeEach(resetDb);

test('渲染当月标题与星期行', async () => {
  render(
    <MemoryRouter>
      <CalendarScreen />
    </MemoryRouter>,
  );
  expect(await screen.findByText('2026年7月')).toBeInTheDocument();
  expect(screen.getByText('一')).toBeInTheDocument();
  expect(screen.getByLabelText('上个月')).toBeInTheDocument();
});
