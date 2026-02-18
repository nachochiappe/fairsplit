import Decimal from 'decimal.js';

export interface SettlementInput {
  incomesByUser: Record<string, Decimal.Value>;
  paidByUser: Record<string, Decimal.Value>;
}

export interface SettlementOutput {
  totalIncome: string;
  totalExpenses: string;
  expenseRatio: string;
  fairShareByUser: Record<string, string>;
  paidByUser: Record<string, string>;
  differenceByUser: Record<string, string>;
  transfer: null | {
    fromUserId: string;
    toUserId: string;
    amount: string;
  };
}

const toRoundedMoneyString = (value: Decimal): string => value.toDecimalPlaces(2).toFixed(2);

export function calculateSettlement(input: SettlementInput): SettlementOutput {
  const userIds = Array.from(new Set([...Object.keys(input.incomesByUser), ...Object.keys(input.paidByUser)]));

  const incomes: Record<string, Decimal> = {};
  const paid: Record<string, Decimal> = {};

  for (const userId of userIds) {
    incomes[userId] = new Decimal(input.incomesByUser[userId] ?? 0);
    paid[userId] = new Decimal(input.paidByUser[userId] ?? 0);
  }

  const totalIncome = Object.values(incomes).reduce((acc, value) => acc.plus(value), new Decimal(0));
  const totalExpenses = Object.values(paid).reduce((acc, value) => acc.plus(value), new Decimal(0));

  if (totalIncome.lte(0) && totalExpenses.gt(0)) {
    throw new Error('Cannot calculate settlement when total income is non-positive and expenses are non-zero.');
  }

  const expenseRatio = totalIncome.eq(0) ? new Decimal(0) : totalExpenses.div(totalIncome);

  const fairShareByUser: Record<string, Decimal> = {};
  const differenceByUser: Record<string, Decimal> = {};

  for (const userId of userIds) {
    fairShareByUser[userId] = incomes[userId].mul(expenseRatio);
    differenceByUser[userId] = paid[userId].minus(fairShareByUser[userId]);
  }

  const roundedDifferenceByUser: Record<string, Decimal> = {};
  for (const userId of userIds) {
    roundedDifferenceByUser[userId] = differenceByUser[userId].toDecimalPlaces(2);
  }

  let transfer: SettlementOutput['transfer'] = null;
  const senders = userIds
    .filter((id) => roundedDifferenceByUser[id].lt(0))
    .sort((a, b) => roundedDifferenceByUser[a].comparedTo(roundedDifferenceByUser[b]));
  const receivers = userIds
    .filter((id) => roundedDifferenceByUser[id].gt(0))
    .sort((a, b) => roundedDifferenceByUser[b].comparedTo(roundedDifferenceByUser[a]));

  if (senders.length > 0 && receivers.length > 0) {
    const senderId = senders[0];
    const receiverId = receivers[0];
    const amount = Decimal.min(
      roundedDifferenceByUser[senderId].abs(),
      roundedDifferenceByUser[receiverId],
    );

    if (amount.gt(0)) {
      transfer = {
        fromUserId: senderId,
        toUserId: receiverId,
        amount: toRoundedMoneyString(amount),
      };
    }
  }

  return {
    totalIncome: toRoundedMoneyString(totalIncome),
    totalExpenses: toRoundedMoneyString(totalExpenses),
    expenseRatio: expenseRatio.toDecimalPlaces(6).toString(),
    fairShareByUser: Object.fromEntries(
      userIds.map((id) => [id, toRoundedMoneyString(fairShareByUser[id])]),
    ),
    paidByUser: Object.fromEntries(userIds.map((id) => [id, toRoundedMoneyString(paid[id])])),
    differenceByUser: Object.fromEntries(
      userIds.map((id) => [id, toRoundedMoneyString(roundedDifferenceByUser[id])]),
    ),
    transfer,
  };
}
