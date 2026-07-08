import { render, screen } from '@testing-library/react';
import App from './App';

test('渲染应用外壳', () => {
  render(<App />);
  expect(screen.getByText('铁证')).toBeInTheDocument();
});
