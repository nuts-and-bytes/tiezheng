import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { ConfirmedModelRangeCandidate } from '../../lib/estimateConfirmation';
import { textAiCandidateFixture } from '../../test/textAiFixtures';
import {
  EstimateConfirmationEditor,
  fromEditorDraft,
  toEditorDraft,
  type EstimateConfirmationDraft,
} from './EstimateConfirmationEditor';

function confirmed(
  overrides: Partial<ConfirmedModelRangeCandidate> = {},
): ConfirmedModelRangeCandidate {
  return {
    candidate: {
      ...textAiCandidateFixture,
      assumptions: [...textAiCandidateFixture.assumptions],
    },
    confirmedAmount: 500,
    confirmedUnit: 'g',
    confirmedName: '少油牛肉面',
    confirmedPreparation: '整餐文字估算',
    confirmedAssumptions: [...textAiCandidateFixture.assumptions],
    ...overrides,
  };
}

function draft(
  overrides: Partial<EstimateConfirmationDraft> = {},
): EstimateConfirmationDraft {
  return {
    ...toEditorDraft(confirmed()),
    ...overrides,
  };
}

test('编辑器草稿用中文逗号展示说明并按中英文逗号规范化回确认数据', () => {
  const editable = toEditorDraft(
    confirmed({ confirmedAssumptions: ['按一碗估算', '不含饮料'] }),
  );

  expect(editable.assumptionsText).toBe('按一碗估算，不含饮料');

  const confirmedDraft = fromEditorDraft({
    ...editable,
    assumptionsText: ' 按一碗估算， , 不含饮料,,，少油 ',
  });
  expect(confirmedDraft.confirmedAssumptions).toEqual([
    '按一碗估算',
    '不含饮料',
    '少油',
  ]);
  expect(confirmedDraft).not.toHaveProperty('assumptionsText');
});

test('照片模式展示完整确认字段和 AI 区间但不渲染最终营养输入框', () => {
  const onChange = vi.fn();
  render(
    <EstimateConfirmationEditor
      draft={draft()}
      nutrientMode="read-only-range"
      disabled={false}
      onChange={onChange}
    />,
  );

  expect(screen.getByText('560–780 kcal')).toBeInTheDocument();
  expect(screen.getByText('28–42 g')).toBeInTheDocument();
  expect(screen.queryByLabelText('最终热量（kcal）')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('最终蛋白质（g）')).not.toBeInTheDocument();

  for (const label of ['食物名称', '处理方式', '实际数量', '单位', '确认说明']) {
    expect(screen.getByLabelText(label)).toHaveClass('min-h-11');
  }

  fireEvent.change(screen.getByLabelText('实际数量'), {
    target: { value: '' },
  });
  const changed = onChange.mock.lastCall?.[0] as EstimateConfirmationDraft;
  expect(Number.isNaN(changed.confirmedAmount)).toBe(true);
});

test('文字模式允许编辑最终营养且清空数字保留 NaN', () => {
  const onChange = vi.fn();
  render(
    <EstimateConfirmationEditor
      draft={draft({ confirmedEnergyKcal: 670, confirmedProteinG: 35 })}
      nutrientMode="editable-point"
      disabled={false}
      onChange={onChange}
    />,
  );

  const energy = screen.getByLabelText('最终热量（kcal）');
  const protein = screen.getByLabelText('最终蛋白质（g）');
  expect(energy).toHaveClass('min-h-11');
  expect(protein).toHaveClass('min-h-11');

  fireEvent.change(energy, { target: { value: '900' } });
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ confirmedEnergyKcal: 900 }),
  );

  fireEvent.change(protein, { target: { value: '' } });
  const changed = onChange.mock.lastCall?.[0] as EstimateConfirmationDraft;
  expect(Number.isNaN(changed.confirmedProteinG)).toBe(true);
});

test('禁用态会禁用全部编辑控件', () => {
  render(
    <EstimateConfirmationEditor
      draft={draft({ confirmedEnergyKcal: 670, confirmedProteinG: 35 })}
      nutrientMode="editable-point"
      disabled
      onChange={vi.fn()}
    />,
  );

  for (const label of [
    '食物名称',
    '处理方式',
    '实际数量',
    '单位',
    '确认说明',
    '最终热量（kcal）',
    '最终蛋白质（g）',
  ]) {
    expect(screen.getByLabelText(label)).toBeDisabled();
  }
});
