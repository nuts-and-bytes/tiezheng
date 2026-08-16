import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { expect, test, vi } from 'vitest';
import { mealItemRow } from '../../test/nutritionFixtures';
import { MealSection } from './MealSection';

test('餐段显示不可变快照营养，只改实际数量并二次确认删除', async () => {
  const user = userEvent.setup();
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn().mockResolvedValue(undefined);
  const { container } = render(
    <MealSection
      slot="lunch"
      items={[
        mealItemRow({
          name: '熟米饭',
          preparation: '蒸煮',
          amount: 150,
          unit: 'g',
          energyKcalLow: 195,
          energyKcalHigh: 195,
          proteinGLow: 4.035,
          proteinGHigh: 4.035,
        }),
      ]}
      onAdd={vi.fn()}
      onUpdate={onUpdate}
      onRemove={onRemove}
    />,
  );
  const region = screen.getByRole('region', { name: '午餐' });
  expect(region).toHaveClass('forged-surface');
  expect(region).toHaveTextContent('做法：蒸煮 · 实际吃下：150 g');
  expect(region).toHaveTextContent('195 kcal');
  expect(region).toHaveTextContent('4 g 蛋白质');
  expect(container.querySelector('input[aria-label*="做法"]')).toBeNull();

  await user.clear(screen.getByLabelText('修改熟米饭实际吃下数量'));
  await user.type(screen.getByLabelText('修改熟米饭实际吃下数量'), '200');
  await user.click(screen.getByRole('button', { name: '保存熟米饭数量' }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.any(String), 200));
  await user.click(screen.getByRole('button', { name: '删除熟米饭' }));
  expect(onRemove).not.toHaveBeenCalled();
  const confirmation = screen.getByRole('alertdialog', { name: '确认删除熟米饭' });
  await user.click(within(confirmation).getByRole('button', { name: '确认删除熟米饭' }));
  await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
});

test('数量必须符合有限正数及 repo 上下界，保存失败后可见且可重试', async () => {
  const onUpdate = vi
    .fn()
    .mockRejectedValueOnce(new Error('本地保存失败'))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <MealSection
      slot="lunch"
      items={[mealItemRow({ name: '熟米饭', amount: 150 })]}
      onAdd={vi.fn()}
      onUpdate={onUpdate}
      onRemove={vi.fn()}
    />,
  );
  const input = screen.getByLabelText('修改熟米饭实际吃下数量');
  const save = screen.getByRole('button', { name: '保存熟米饭数量' });

  for (const invalid of ['0', '1e309', '0.001', '100001']) {
    fireEvent.change(input, { target: { value: invalid } });
    await user.click(save);
    expect(screen.getByRole('alert')).toHaveTextContent('有限且介于 0.01 到 100000');
    expect(onUpdate).not.toHaveBeenCalled();
  }

  fireEvent.change(input, { target: { value: '200' } });
  await user.click(save);
  expect(await screen.findByRole('alert')).toHaveTextContent('本地保存失败');
  await waitFor(() => expect(save).not.toBeDisabled());
  await user.click(save);
  await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
});

test('每条食物独立 pending，A/B 交错完成不会提前解锁另一条', async () => {
  let resolveRice!: () => void;
  let resolveBeef!: () => void;
  const onUpdate = vi.fn(
    (id: string) =>
      new Promise<void>((resolve) => {
        if (id === 'meal-item:rice') resolveRice = resolve;
        else resolveBeef = resolve;
      }),
  );
  const user = userEvent.setup();
  render(
    <MealSection
      slot="lunch"
      items={[
        mealItemRow({ id: 'meal-item:rice', name: '熟米饭', amount: 150 }),
        mealItemRow({ id: 'meal-item:beef', name: '熟瘦牛肉', amount: 100 }),
      ]}
      onAdd={vi.fn()}
      onUpdate={onUpdate}
      onRemove={vi.fn()}
    />,
  );
  const riceInput = screen.getByLabelText('修改熟米饭实际吃下数量');
  const beefInput = screen.getByLabelText('修改熟瘦牛肉实际吃下数量');
  fireEvent.change(riceInput, { target: { value: '180' } });
  fireEvent.change(beefInput, { target: { value: '120' } });
  const riceSave = screen.getByRole('button', { name: '保存熟米饭数量' });
  const beefSave = screen.getByRole('button', { name: '保存熟瘦牛肉数量' });
  const riceDelete = screen.getByRole('button', { name: '删除熟米饭' });
  const beefDelete = screen.getByRole('button', { name: '删除熟瘦牛肉' });

  await user.click(riceSave);
  expect(riceSave).toBeDisabled();
  expect(riceDelete).toBeDisabled();
  expect(riceInput).toBeDisabled();
  expect(beefSave).not.toBeDisabled();
  expect(beefDelete).not.toBeDisabled();
  await user.click(beefSave);
  expect(riceSave).toBeDisabled();
  expect(beefSave).toBeDisabled();

  await act(async () => resolveBeef());
  await waitFor(() => expect(beefSave).not.toBeDisabled());
  expect(riceSave).toBeDisabled();

  await act(async () => resolveRice());
  await waitFor(() => expect(riceSave).not.toBeDisabled());
  expect(onUpdate).toHaveBeenNthCalledWith(1, 'meal-item:rice', 180);
  expect(onUpdate).toHaveBeenNthCalledWith(2, 'meal-item:beef', 120);
});

test('删除失败保持二次确认、显示错误并允许同项重试', async () => {
  let rejectRemove!: (cause: Error) => void;
  const firstAttempt = new Promise<void>((_resolve, reject) => {
    rejectRemove = reject;
  });
  const onRemove = vi.fn().mockReturnValueOnce(firstAttempt).mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <MealSection
      slot="dinner"
      items={[mealItemRow({ id: 'meal-item:beef', name: '熟瘦牛肉' })]}
      onAdd={vi.fn()}
      onUpdate={vi.fn()}
      onRemove={onRemove}
    />,
  );
  const input = screen.getByLabelText('修改熟瘦牛肉实际吃下数量');
  const save = screen.getByRole('button', { name: '保存熟瘦牛肉数量' });
  const remove = screen.getByRole('button', { name: '删除熟瘦牛肉' });
  await user.click(remove);
  const confirm = screen.getByRole('button', { name: '确认删除熟瘦牛肉' });
  await user.click(confirm);
  expect(remove).toBeDisabled();
  expect(save).toBeDisabled();
  expect(input).toBeDisabled();

  await act(async () => rejectRemove(new Error('删除失败，请重试')));
  expect(await screen.findByRole('alert')).toHaveTextContent('删除失败，请重试');
  expect(screen.getByRole('alertdialog', { name: '确认删除熟瘦牛肉' })).toBeInTheDocument();
  await waitFor(() => expect(confirm).not.toBeDisabled());
  await user.click(confirm);
  await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(2));
});

test('StrictMode effect replay 后保存失败会解锁并允许成功重试', async () => {
  const onUpdate = vi
    .fn()
    .mockRejectedValueOnce(new Error('StrictMode 本地失败'))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <MealSection
        slot="lunch"
        items={[mealItemRow({ name: '熟米饭', amount: 150 })]}
        onAdd={vi.fn()}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
      />
    </StrictMode>,
  );
  const input = screen.getByLabelText('修改熟米饭实际吃下数量');
  fireEvent.change(input, { target: { value: '200' } });

  await user.click(screen.getByRole('button', { name: '保存熟米饭数量' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('StrictMode 本地失败');
  const save = screen.getByRole('button', { name: '保存熟米饭数量' });
  expect(save).not.toBeDisabled();
  await user.click(save);

  await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(2));
  expect(save).not.toBeDisabled();
});
