import Decimal from 'decimal.js';

export const toMoneyString = (value: { toString(): string } | string | number): string =>
  new Decimal(value.toString()).toFixed(2);
