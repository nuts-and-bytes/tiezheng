export interface FoodNormalizationInput {
  originalEnergyValue: number;
  originalEnergyUnit: 'kcal' | 'kJ';
  originalProteinG: number;
  originalBasisAmount: number;
  originalBasisUnit: 'g' | 'mL';
  normalizedBasisAmount: number;
  normalizedBasisUnit: 'g' | 'mL';
  ediblePortionRatio: number;
  densityGPerMl: number | null;
  conversionAssumptions: string[];
}

export interface NormalizedFoodNutrients {
  basisAmount: number;
  basisUnit: 'g' | 'mL';
  energyKcal: number;
  proteinG: number;
  conversionAssumptions: string[];
}

function assertFiniteNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be finite and non-negative`);
  }
}

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be finite and positive`);
  }
}

function stableNutrientValue(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_000_000) / 1_000_000_000_000;
}

export function normalizeFoodNutrients(
  input: FoodNormalizationInput,
): NormalizedFoodNutrients {
  assertFiniteNonNegative(input.originalEnergyValue, 'originalEnergyValue');
  assertFiniteNonNegative(input.originalProteinG, 'originalProteinG');
  assertFinitePositive(input.originalBasisAmount, 'originalBasisAmount');
  assertFinitePositive(input.normalizedBasisAmount, 'normalizedBasisAmount');
  if (
    !Number.isFinite(input.ediblePortionRatio) ||
    input.ediblePortionRatio <= 0 ||
    input.ediblePortionRatio > 1
  ) {
    throw new Error('ediblePortionRatio must be in (0, 1]');
  }
  if (input.originalEnergyUnit !== 'kcal' && input.originalEnergyUnit !== 'kJ') {
    throw new Error('originalEnergyUnit must be kcal or kJ');
  }
  if (input.originalBasisUnit !== 'g' && input.originalBasisUnit !== 'mL') {
    throw new Error('originalBasisUnit must be g or mL');
  }
  if (input.normalizedBasisUnit !== 'g' && input.normalizedBasisUnit !== 'mL') {
    throw new Error('normalizedBasisUnit must be g or mL');
  }
  if (
    input.densityGPerMl !== null &&
    (!Number.isFinite(input.densityGPerMl) || input.densityGPerMl <= 0)
  ) {
    throw new Error('densityGPerMl must be null or a finite positive density');
  }
  if (
    !Array.isArray(input.conversionAssumptions) ||
    input.conversionAssumptions.some(
      (assumption) => typeof assumption !== 'string' || assumption.trim() === '',
    )
  ) {
    throw new Error('conversion assumption must be a non-blank string');
  }

  const conversionAssumptions = [...input.conversionAssumptions];
  const energyKcal =
    input.originalEnergyUnit === 'kJ'
      ? input.originalEnergyValue / 4.184
      : input.originalEnergyValue;
  if (input.originalEnergyUnit === 'kJ') {
    conversionAssumptions.push(
      'energy converted from kJ using 1 kcal = 4.184 kJ',
    );
  }

  let normalizedAmountInOriginalUnit = input.normalizedBasisAmount;

  if (input.originalBasisUnit !== input.normalizedBasisUnit) {
    const density = input.densityGPerMl;
    if (density === null || !Number.isFinite(density) || density <= 0) {
      throw new Error('a finite positive density is required for g/mL conversion');
    }
    if (input.originalBasisUnit === 'g') {
      normalizedAmountInOriginalUnit = input.normalizedBasisAmount * density;
      conversionAssumptions.push(
        `${input.normalizedBasisAmount} mL converted to ${normalizedAmountInOriginalUnit} g using density ${density} g/mL`,
      );
    } else {
      normalizedAmountInOriginalUnit = input.normalizedBasisAmount / density;
      conversionAssumptions.push(
        `${input.normalizedBasisAmount} g converted to ${normalizedAmountInOriginalUnit} mL using density ${density} g/mL`,
      );
    }
  }

  const factor = normalizedAmountInOriginalUnit / input.originalBasisAmount;
  const normalizedEnergyKcal = energyKcal * factor;
  const normalizedProteinG = input.originalProteinG * factor;
  assertFiniteNonNegative(normalizedEnergyKcal, 'normalized energyKcal');
  assertFiniteNonNegative(normalizedProteinG, 'normalized proteinG');
  const stableEnergyKcal = stableNutrientValue(normalizedEnergyKcal);
  const stableProteinG = stableNutrientValue(normalizedProteinG);
  assertFiniteNonNegative(stableEnergyKcal, 'stable energyKcal');
  assertFiniteNonNegative(stableProteinG, 'stable proteinG');
  return {
    basisAmount: input.normalizedBasisAmount,
    basisUnit: input.normalizedBasisUnit,
    energyKcal: stableEnergyKcal,
    proteinG: stableProteinG,
    conversionAssumptions,
  };
}
