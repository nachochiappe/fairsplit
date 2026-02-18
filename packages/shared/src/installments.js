"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeInstallmentAmounts = exports.monthDiff = exports.monthToDate = exports.addMonths = void 0;
const decimal_js_1 = require("decimal.js");
function parseMonth(month) {
    const [yearToken, monthToken] = month.split('-');
    const year = Number(yearToken);
    const monthNumber = Number(monthToken);
    if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
        throw new Error(`Invalid month format: ${month}`);
    }
    return { year, month: monthNumber };
}
function addMonths(month, offset) {
    const { year, month: monthNumber } = parseMonth(month);
    const base = new Date(Date.UTC(year, monthNumber - 1, 1, 12, 0, 0));
    base.setUTCMonth(base.getUTCMonth() + offset);
    const targetYear = base.getUTCFullYear();
    const targetMonth = String(base.getUTCMonth() + 1).padStart(2, '0');
    return `${targetYear}-${targetMonth}`;
}
exports.addMonths = addMonths;
function monthToDate(month, day) {
    const { year, month: monthNumber } = parseMonth(month);
    const dayCount = new Date(Date.UTC(year, monthNumber, 0, 12, 0, 0)).getUTCDate();
    const clampedDay = Math.min(Math.max(day, 1), dayCount);
    return new Date(Date.UTC(year, monthNumber - 1, clampedDay, 12, 0, 0));
}
exports.monthToDate = monthToDate;
function monthDiff(startMonth, endMonth) {
    const start = parseMonth(startMonth);
    const end = parseMonth(endMonth);
    return (end.year - start.year) * 12 + (end.month - start.month);
}
exports.monthDiff = monthDiff;
function computeInstallmentAmounts(input) {
    const count = input.count;
    if (!Number.isInteger(count) || count < 1) {
        throw new Error('Installment count must be a positive integer');
    }
    if (input.entryMode === 'perInstallment') {
        if (input.perInstallmentAmount === undefined) {
            throw new Error('perInstallmentAmount is required in perInstallment mode');
        }
        const installmentAmount = new decimal_js_1.default(input.perInstallmentAmount).toDecimalPlaces(2, decimal_js_1.default.ROUND_HALF_UP);
        return {
            amounts: Array.from({ length: count }, () => installmentAmount.toFixed(2)),
            totalAmount: installmentAmount.mul(count).toFixed(2),
        };
    }
    if (input.totalAmount === undefined) {
        throw new Error('totalAmount is required in total mode');
    }
    const totalAmount = new decimal_js_1.default(input.totalAmount).toDecimalPlaces(2, decimal_js_1.default.ROUND_HALF_UP);
    if (count === 1) {
        return { amounts: [totalAmount.toFixed(2)], totalAmount: totalAmount.toFixed(2) };
    }
    const baseAmount = totalAmount.div(count).toDecimalPlaces(2, decimal_js_1.default.ROUND_HALF_UP);
    const amounts = Array.from({ length: count }, () => baseAmount);
    const accumulatedWithoutLast = baseAmount.mul(count - 1);
    const lastAmount = totalAmount.minus(accumulatedWithoutLast).toDecimalPlaces(2, decimal_js_1.default.ROUND_HALF_UP);
    amounts[count - 1] = lastAmount;
    return {
        amounts: amounts.map((amount) => amount.toFixed(2)),
        totalAmount: totalAmount.toFixed(2),
    };
}
exports.computeInstallmentAmounts = computeInstallmentAmounts;
