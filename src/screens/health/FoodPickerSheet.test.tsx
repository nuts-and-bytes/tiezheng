import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ComponentProps } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PRESET_FOODS } from '../../data/presetFoods';
import { scaleFood } from '../../lib/nutritionStats';
import { saveCustomFood } from '../../repos/foodRepo';
import { resetDb } from '../../test/dbTestUtils';
import { FoodPickerSheet } from './FoodPickerSheet';

const FIRST_OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_OPERATION_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

function picker(overrides: Partial<ComponentProps<typeof FoodPickerSheet>> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue(undefined);
  const view = render(
    <FoodPickerSheet
      slot="lunch"
      foods={PRESET_FOODS}
      onClose={onClose}
      onCreateCustomFood={saveCustomFood}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { ...view, onClose, onSave };
}

async function selectRice(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '熟米饭' }));
  return screen.getByLabelText('实际克数');
}

async function openManualFoodForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '手动添加食物' }));
  await user.type(screen.getByLabelText('食物名称'), '包装豆奶');
  await user.type(screen.getByLabelText('处理方式'), '即饮');
  await user.type(screen.getByLabelText('原始能量'), '188.28');
  await user.type(screen.getByLabelText('原始蛋白质（克）'), '3.2');
  await user.type(screen.getByLabelText('换算说明'), '包装标签每 100 mL');
}

test('真实图目录、本地名称和别名搜索、单位提示均可用且不发网络请求', async () => {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const { container } = picker();

  const dialog = screen.getByRole('dialog', { name: '选择食物' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveClass('motion-reduce:transition-none');
  expect(dialog).toHaveClass('forged-surface');
  const images = [...container.querySelectorAll('img')];
  expect(images).toHaveLength(3);
  expect(new Set(images.map((image) => image.getAttribute('src'))).size).toBe(3);
  expect(images.every((image) => image.getAttribute('src')?.endsWith('.webp'))).toBe(true);
  expect(images.every((image) => image.className.includes('object-cover'))).toBe(true);

  await user.type(screen.getByLabelText('搜索食物'), '米饭');
  expect(screen.getByRole('button', { name: '熟米饭' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '熟鸡胸肉' })).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('搜索食物'));
  await user.type(screen.getByLabelText('搜索食物'), '鸡胸肉');
  expect(screen.getByRole('button', { name: '熟鸡胸肉' })).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('实际数量严格拒绝非有限值和 repo 边界外值，150 g 才提交', async () => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(FIRST_OPERATION_ID);
  const user = userEvent.setup();
  const { onSave } = picker();
  const input = await selectRice(user);
  const submit = screen.getByRole('button', { name: '加入午餐' });

  for (const invalid of ['0', '1e309', '0.001', '100001']) {
    fireEvent.change(input, { target: { value: invalid } });
    await user.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('有限且介于 0.01 到 100000');
    expect(onSave).not.toHaveBeenCalled();
  }

  await user.clear(input);
  await user.type(input, '150');
  await user.click(submit);
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      operationId: FIRST_OPERATION_ID,
      food: PRESET_FOODS[0],
      amount: 150,
    }),
  );
});

test('手动 mL/kJ 标签经真实 repo 标准化，保留可食部、密度和换算说明', async () => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(FIRST_OPERATION_ID);
  const user = userEvent.setup();
  const { container, onSave } = picker();
  await openManualFoodForm(user);

  expect(screen.getByLabelText('能量单位')).toContainHTML('<option value="kcal">kcal</option>');
  await user.selectOptions(screen.getByLabelText('原始单位'), 'mL');
  await user.selectOptions(screen.getByLabelText('能量单位'), 'kJ');
  await user.clear(screen.getByLabelText('可食部比例'));
  await user.type(screen.getByLabelText('可食部比例'), '0.8');
  await user.type(screen.getByLabelText('密度 g/mL（可空）'), '1.03');
  await user.clear(screen.getByLabelText('实际毫升'));
  await user.type(screen.getByLabelText('实际毫升'), '200');
  expect(container.querySelector('[name="normalizedBasisAmount"]')).toBeNull();
  expect(container.querySelector('[name="normalizedBasisUnit"]')).toBeNull();

  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  const saved = vi.mocked(onSave).mock.calls[0][0];
  expect(saved.food).toMatchObject({
    basisAmount: 100,
    basisUnit: 'mL',
    originalEnergyUnit: 'kJ',
    proteinG: 3.2,
    ediblePortionRatio: 0.8,
    densityGPerMl: 1.03,
  });
  expect(saved.food.energyKcal).toBeCloseTo(45, 8);
  expect(saved.food.conversionAssumptions).toContain('包装标签每 100 mL');
  expect(scaleFood(saved.food, 200).energyKcal).toBeCloseTo(90, 8);
  expect(saved.food).not.toHaveProperty('normalizedBasisAmount');
});

test('手动标签的营养数据超过仓储上限时拒绝并显示可重试错误', async () => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(FIRST_OPERATION_ID);
  const user = userEvent.setup();
  const { onSave } = picker();
  await openManualFoodForm(user);
  fireEvent.change(screen.getByLabelText('原始能量'), { target: { value: '1000001' } });

  fireEvent.submit(screen.getByRole('button', { name: '加入午餐' }).closest('form')!);

  expect(await screen.findByRole('alert')).toHaveTextContent('originalEnergyValue');
  expect(onSave).not.toHaveBeenCalled();
});

test('手动标签必填原始文本为空时在写库前拒绝', async () => {
  const onCreateCustomFood = vi.fn().mockResolvedValue(PRESET_FOODS[0]);
  const onSave = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  picker({ onCreateCustomFood, onSave });

  await user.click(screen.getByRole('button', { name: '手动添加食物' }));
  await user.type(screen.getByLabelText('食物名称'), '空营养标签');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));

  expect(screen.getByRole('alert')).toHaveTextContent('请完整填写标签必填项');
  expect(onCreateCustomFood).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText('处理方式'), '即食');
  await user.type(screen.getByLabelText('原始能量'), '120');
  await user.type(screen.getByLabelText('原始蛋白质（克）'), '5');
  await user.type(screen.getByLabelText('换算说明'), '包装标签每 100 g');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));

  await waitFor(() => expect(onCreateCustomFood).toHaveBeenCalledTimes(1));
  expect(onSave).toHaveBeenCalledTimes(1);
});

test('自定义食物没有 manifest 行时显示明确占位而不渲染破图', () => {
  const custom = {
    ...PRESET_FOODS[0],
    id: 'food:custom:homemade-rice',
    name: '自制米饭',
    aliases: [],
    preset: false,
  };
  const { container } = picker({ foods: [custom] });

  expect(screen.getByRole('img', { name: '自制米饭暂无图片' })).toHaveTextContent('暂无图片');
  expect(container.querySelector('img')).toBeNull();
});

test('一次失败尝试保持 operationId，useRef latch 防双击，成功后才轮换', async () => {
  vi.spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValueOnce(FIRST_OPERATION_ID)
    .mockReturnValueOnce(SECOND_OPERATION_ID)
    .mockReturnValue('33333333-3333-4333-8333-333333333333');
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error('餐项保存失败'))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  picker({ onSave });
  await selectRice(user);
  fireEvent.change(screen.getByLabelText('实际克数'), { target: { value: '150' } });
  const form = screen.getByRole('button', { name: '加入午餐' }).closest('form')!;

  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole('alert')).toHaveTextContent('餐项保存失败');

  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[0][0].operationId).toBe(FIRST_OPERATION_ID);
  expect(onSave.mock.calls[1][0].operationId).toBe(FIRST_OPERATION_ID);

  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
  expect(onSave.mock.calls[2][0].operationId).toBe(SECOND_OPERATION_ID);
});

test('自定义食物已保存但餐项失败时，同 operationId 重试保持幂等', async () => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(FIRST_OPERATION_ID);
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error('餐项保存失败'))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  picker({ onSave });
  await openManualFoodForm(user);

  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('餐项保存失败');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));

  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[0][0].operationId).toBe(FIRST_OPERATION_ID);
  expect(onSave.mock.calls[1][0].operationId).toBe(FIRST_OPERATION_ID);
  expect(onSave.mock.calls[1][0].food.id).toBe(onSave.mock.calls[0][0].food.id);
});

test('首个 await 前快照全部 FormData、食物和实际数量', async () => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(FIRST_OPERATION_ID);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onCreateCustomFood = vi.fn(async (operationId, input) => {
    await gate;
    return saveCustomFood(operationId, input);
  });
  const onSave = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  picker({ onCreateCustomFood, onSave });
  await openManualFoodForm(user);
  await user.selectOptions(screen.getByLabelText('原始单位'), 'mL');
  await user.clear(screen.getByLabelText('实际毫升'));
  await user.type(screen.getByLabelText('实际毫升'), '200');
  fireEvent.submit(screen.getByRole('button', { name: '加入午餐' }).closest('form')!);

  fireEvent.change(screen.getByLabelText('食物名称'), { target: { value: '提交后篡改' } });
  fireEvent.change(screen.getByLabelText('实际毫升'), { target: { value: '300' } });
  await act(async () => release());

  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onCreateCustomFood).toHaveBeenCalledWith(
    FIRST_OPERATION_ID,
    expect.objectContaining({ name: '包装豆奶', originalBasisUnit: 'mL' }),
  );
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ operationId: FIRST_OPERATION_ID, amount: 200 }),
  );
});

test('dialog 锁滚动、过滤隐藏/禁用控件、Tab 环、Escape 和卸载恢复完整', async () => {
  const user = userEvent.setup();
  const opener = document.createElement('button');
  opener.textContent = 'opener';
  document.body.append(opener);
  opener.focus();
  document.body.style.overflow = 'clip';
  const { unmount, onClose } = picker();
  const dialog = screen.getByRole('dialog', { name: '选择食物' });
  const invisible = document.createElement('button');
  invisible.textContent = '不可见按钮';
  invisible.style.display = 'none';
  const disabled = document.createElement('button');
  disabled.textContent = '禁用按钮';
  disabled.disabled = true;
  dialog.append(invisible, disabled);

  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.getByRole('button', { name: '关闭选择食物' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: '加入午餐' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: '关闭选择食物' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);

  unmount();
  expect(document.body.style.overflow).toBe('clip');
  expect(opener).toHaveFocus();
  opener.remove();
});

test('StrictMode effect replay 后失败仍显示错误并可成功重试关闭', async () => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(FIRST_OPERATION_ID);
  const onClose = vi.fn();
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error('StrictMode 保存失败'))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <StrictMode>
      <FoodPickerSheet
        slot="lunch"
        foods={PRESET_FOODS}
        onClose={onClose}
        onCreateCustomFood={saveCustomFood}
        onSave={onSave}
      />
    </StrictMode>,
  );
  await selectRice(user);

  await user.click(screen.getByRole('button', { name: '加入午餐' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('StrictMode 保存失败');
  await user.click(screen.getByRole('button', { name: '加入午餐' }));

  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onClose).toHaveBeenCalledTimes(1);
});
