import Decimal from 'decimal.js';
import { MAX_FX_RATE, MAX_MONEY_AMOUNT } from '@fairsplit/shared';

function parseFiniteDecimal(value: string | number, field: string): Decimal {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new RangeError(`${field} must be a valid finite decimal`);
  }

  if (!parsed.isFinite()) {
    throw new RangeError(`${field} must be a valid finite decimal`);
  }
  return parsed;
}

/** Converts an original-currency amount without exceeding Decimal(14, 2). */
export function computeArsAmount(amountOriginal: string | number, fxRate: string | number): string {
  const amount = parseFiniteDecimal(amountOriginal, 'amountOriginal');
  const rate = parseFiniteDecimal(fxRate, 'fxRate');

  if (amount.abs().greaterThan(MAX_MONEY_AMOUNT)) {
    throw new RangeError(`amountOriginal exceeds the supported limit of ${MAX_MONEY_AMOUNT}`);
  }
  if (rate.lessThanOrEqualTo(0) || rate.greaterThan(MAX_FX_RATE)) {
    throw new RangeError(`fxRate must be greater than 0 and at most ${MAX_FX_RATE}`);
  }

  const amountArs = amount.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  if (amountArs.abs().greaterThan(MAX_MONEY_AMOUNT)) {
    throw new RangeError(`Converted ARS amount exceeds the supported limit of ${MAX_MONEY_AMOUNT}`);
  }

  return amountArs.toFixed(2);
}
