import Decimal from 'decimal.js';

export type BasicCalculationResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'division-by-zero' | 'invalid-expression' };

const OPERATOR_PRECEDENCE: Record<string, number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
};

function applyOperator(values: Decimal[], operator: string): BasicCalculationResult | null {
  const right = values.pop();
  const left = values.pop();

  if (!left || !right) {
    return { ok: false, reason: 'invalid-expression' };
  }

  if (operator === '/' && right.isZero()) {
    return { ok: false, reason: 'division-by-zero' };
  }

  const nextValue =
    operator === '+'
      ? left.plus(right)
      : operator === '-'
        ? left.minus(right)
        : operator === '*'
          ? left.times(right)
          : left.dividedBy(right);

  values.push(nextValue);
  return null;
}

/**
 * Evaluates a deliberately small calculator grammar using Decimal.js so money
 * calculations never inherit JavaScript floating-point rounding errors.
 */
export function evaluateBasicCalculation(expression: string): BasicCalculationResult {
  const normalized = expression.replaceAll('×', '*').replaceAll('÷', '/').replace(/\s+/g, '');
  const tokens = normalized.match(/(?:\d+(?:\.\d*)?|\.\d+|[+\-*/])/g);

  if (!tokens || tokens.join('') !== normalized || tokens.length === 0) {
    return { ok: false, reason: 'invalid-expression' };
  }

  const values: Decimal[] = [];
  const operators: string[] = [];
  let expectsNumber = true;

  try {
    for (const token of tokens) {
      if (token in OPERATOR_PRECEDENCE) {
        if (expectsNumber) {
          return { ok: false, reason: 'invalid-expression' };
        }

        while (
          operators.length > 0 &&
          OPERATOR_PRECEDENCE[operators[operators.length - 1]] >= OPERATOR_PRECEDENCE[token]
        ) {
          const error = applyOperator(values, operators.pop()!);
          if (error) {
            return error;
          }
        }

        operators.push(token);
        expectsNumber = true;
      } else {
        if (!expectsNumber) {
          return { ok: false, reason: 'invalid-expression' };
        }
        values.push(new Decimal(token));
        expectsNumber = false;
      }
    }

    if (expectsNumber) {
      return { ok: false, reason: 'invalid-expression' };
    }

    while (operators.length > 0) {
      const error = applyOperator(values, operators.pop()!);
      if (error) {
        return error;
      }
    }
  } catch {
    return { ok: false, reason: 'invalid-expression' };
  }

  if (values.length !== 1 || !values[0].isFinite()) {
    return { ok: false, reason: 'invalid-expression' };
  }

  return {
    ok: true,
    value: values[0].toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
  };
}
