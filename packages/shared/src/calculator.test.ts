import { describe, expect, it } from 'vitest';
import { evaluateBasicCalculation } from './calculator.ts';

describe('evaluateBasicCalculation', () => {
  it('uses decimal arithmetic for monetary calculations', () => {
    expect(evaluateBasicCalculation('0.1 + 0.2')).toEqual({ ok: true, value: '0.3' });
  });

  it('respects multiplication and division precedence', () => {
    expect(evaluateBasicCalculation('10 + 4 × 2 - 6 ÷ 3')).toEqual({
      ok: true,
      value: '16',
    });
  });

  it('rounds the result to two decimal places', () => {
    expect(evaluateBasicCalculation('10 / 3')).toEqual({ ok: true, value: '3.33' });
  });

  it('reports division by zero', () => {
    expect(evaluateBasicCalculation('10 / 0')).toEqual({
      ok: false,
      reason: 'division-by-zero',
    });
  });

  it('rejects incomplete and unsupported expressions', () => {
    expect(evaluateBasicCalculation('10 +')).toEqual({
      ok: false,
      reason: 'invalid-expression',
    });
    expect(evaluateBasicCalculation('(10 + 2)')).toEqual({
      ok: false,
      reason: 'invalid-expression',
    });
  });
});
