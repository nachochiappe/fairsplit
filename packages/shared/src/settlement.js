"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSettlement = calculateSettlement;
const decimal_js_1 = __importDefault(require("decimal.js"));
const toRoundedMoneyString = (value) => value.toDecimalPlaces(2).toFixed(2);
function calculateSettlement(input) {
    const userIds = Array.from(new Set([...Object.keys(input.incomesByUser), ...Object.keys(input.paidByUser)]));
    const incomes = {};
    const paid = {};
    for (const userId of userIds) {
        incomes[userId] = new decimal_js_1.default(input.incomesByUser[userId] ?? 0);
        paid[userId] = new decimal_js_1.default(input.paidByUser[userId] ?? 0);
    }
    const totalIncome = Object.values(incomes).reduce((acc, value) => acc.plus(value), new decimal_js_1.default(0));
    const totalExpenses = Object.values(paid).reduce((acc, value) => acc.plus(value), new decimal_js_1.default(0));
    if (totalIncome.lte(0) && totalExpenses.gt(0)) {
        throw new Error('Cannot calculate settlement when total income is non-positive and expenses are non-zero.');
    }
    const expenseRatio = totalIncome.eq(0) ? new decimal_js_1.default(0) : totalExpenses.div(totalIncome);
    const fairShareByUser = {};
    const differenceByUser = {};
    for (const userId of userIds) {
        fairShareByUser[userId] = incomes[userId].mul(expenseRatio);
        differenceByUser[userId] = paid[userId].minus(fairShareByUser[userId]);
    }
    const roundedDifferenceByUser = {};
    for (const userId of userIds) {
        roundedDifferenceByUser[userId] = differenceByUser[userId].toDecimalPlaces(2);
    }
    let transfer = null;
    const senders = userIds
        .filter((id) => roundedDifferenceByUser[id].lt(0))
        .sort((a, b) => roundedDifferenceByUser[a].comparedTo(roundedDifferenceByUser[b]));
    const receivers = userIds
        .filter((id) => roundedDifferenceByUser[id].gt(0))
        .sort((a, b) => roundedDifferenceByUser[b].comparedTo(roundedDifferenceByUser[a]));
    if (senders.length > 0 && receivers.length > 0) {
        const senderId = senders[0];
        const receiverId = receivers[0];
        const amount = decimal_js_1.default.min(roundedDifferenceByUser[senderId].abs(), roundedDifferenceByUser[receiverId]);
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
        fairShareByUser: Object.fromEntries(userIds.map((id) => [id, toRoundedMoneyString(fairShareByUser[id])])),
        paidByUser: Object.fromEntries(userIds.map((id) => [id, toRoundedMoneyString(paid[id])])),
        differenceByUser: Object.fromEntries(userIds.map((id) => [id, toRoundedMoneyString(roundedDifferenceByUser[id])])),
        transfer,
    };
}
