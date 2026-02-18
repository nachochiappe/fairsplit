export const formatMoney = (value: string | number): string => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
};

export const formatPercent = (value: string | number): string => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return `${(numeric * 100).toFixed(2)}%`;
};
