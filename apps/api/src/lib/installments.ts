import crypto from 'node:crypto';
import Decimal from 'decimal.js';
import {
  addMonths,
  ApplyScope,
  computeInstallmentAmounts,
  currencyCodeSchema,
  CreateExpenseInput,
  monthDiff,
  UpdateExpenseInput,
} from '@fairsplit/shared';
import { prisma } from '@fairsplit/db';

type ExpenseRow = Awaited<ReturnType<typeof prisma.expense.findFirstOrThrow>>;
type ExpenseWithPaidBy = any;

function toArsAmount(amountOriginal: string, fxRate: string): string {
  return new Decimal(amountOriginal).mul(fxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function normalizeCurrencyCode(value: string) {
  const parsed = currencyCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'ARS';
}

export interface ExpenseInstallmentDto {
  seriesId: string;
  number: number;
  total: number;
  isGenerated: boolean;
  source?: string;
}

export function toExpenseInstallmentDto(expense: ExpenseRow): ExpenseInstallmentDto | null {
  if (!expense.isInstallment || !expense.installmentSeriesId || !expense.installmentNumber || !expense.installmentTotal) {
    return null;
  }

  return {
    seriesId: expense.installmentSeriesId,
    number: expense.installmentNumber,
    total: expense.installmentTotal,
    isGenerated: expense.createdFromSeries,
    source: expense.installmentSource ?? undefined,
  };
}

export function getEffectiveApplyScope(expense: ExpenseRow, applyScope?: ApplyScope): ApplyScope {
  if (applyScope) {
    return applyScope;
  }
  return expense.isInstallment ? 'future' : 'single';
}

function buildScheduleFromSeries(row: ExpenseRow): string[] {
  const total = row.installmentTotal ?? row.installmentNumber ?? 1;
  if (total < 1) {
    throw new Error('Invalid installment total');
  }

  if (row.originalTotalAmount) {
    return computeInstallmentAmounts({
      count: total,
      entryMode: 'total',
      totalAmount: row.originalTotalAmount.toFixed(2),
    }).amounts;
  }

  const perInstallmentAmount = row.installmentAmount?.toFixed(2) ?? row.amountOriginal.toFixed(2);
  return computeInstallmentAmounts({
    count: total,
    entryMode: 'perInstallment',
    perInstallmentAmount,
  }).amounts;
}

function getFirstSeriesRow(rows: ExpenseRow[]): ExpenseRow | null {
  if (rows.length === 0) {
    return null;
  }
  return [...rows].sort((a, b) => a.month.localeCompare(b.month) || a.id.localeCompare(b.id))[0];
}

export async function ensureInstallmentsForMonth(month: string): Promise<void> {
  const rows = await prisma.expense.findMany({
    where: {
      month: { lte: month },
      isInstallment: true,
      installmentSeriesId: { not: null },
    },
    orderBy: [{ installmentSeriesId: 'asc' }, { month: 'asc' }, { id: 'asc' }],
  });

  const bySeries = new Map<string, ExpenseRow[]>();
  for (const row of rows) {
    if (!row.installmentSeriesId) {
      continue;
    }

    const bucket = bySeries.get(row.installmentSeriesId);
    if (bucket) {
      bucket.push(row);
    } else {
      bySeries.set(row.installmentSeriesId, [row]);
    }
  }

  for (const [seriesId, seriesRows] of bySeries.entries()) {
    const anchor = getFirstSeriesRow(seriesRows);
    if (!anchor || !anchor.installmentNumber || !anchor.installmentTotal) {
      continue;
    }

    const installmentOffset = monthDiff(anchor.month, month);
    const targetInstallmentNumber = anchor.installmentNumber + installmentOffset;
    if (targetInstallmentNumber < 1 || targetInstallmentNumber > anchor.installmentTotal) {
      continue;
    }

    const alreadyExists = seriesRows.some((row) => row.month === month);
    if (alreadyExists) {
      continue;
    }

    const latestPrior = [...seriesRows]
      .filter((row) => row.month < month)
      .sort((a, b) => b.month.localeCompare(a.month) || b.id.localeCompare(a.id))[0];

    const sourceRow = latestPrior ?? anchor;
    if (!sourceRow.householdId) {
      continue;
    }
    const date = anchor.date;
    const schedule = buildScheduleFromSeries(anchor);
    const amountOriginal = schedule[targetInstallmentNumber - 1];
    const fxRateUsed = sourceRow.fxRateUsed.toFixed(6);
    const amountArs = toArsAmount(amountOriginal, fxRateUsed);

    await prisma.expense.createMany({
      data: [
        {
          month,
          date,
          description: sourceRow.description,
          categoryId: sourceRow.categoryId,
          amountOriginal,
          amountArs,
          currencyCode: sourceRow.currencyCode,
          fxRateUsed,
          householdId: sourceRow.householdId,
          paidByUserId: sourceRow.paidByUserId,
          isInstallment: true,
          installmentSeriesId: seriesId,
          installmentNumber: targetInstallmentNumber,
          installmentTotal: anchor.installmentTotal,
          installmentAmount: amountOriginal,
          installmentSource: sourceRow.installmentSource ?? anchor.installmentSource ?? 'manual',
          originalTotalAmount: anchor.originalTotalAmount?.toFixed(2),
          createdFromSeries: true,
        },
      ],
      skipDuplicates: true,
    });
  }
}

export function resolveCreateExpenseAmount(input: CreateExpenseInput): {
  amountOriginal: string;
  isInstallment: boolean;
  installmentSeriesId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  installmentAmount: string | null;
  installmentSource: string | null;
  originalTotalAmount: string | null;
  createdFromSeries: boolean;
} {
  if (!input.installment?.enabled) {
    if (input.amount === undefined) {
      throw new Error('amount is required when installment is disabled');
    }

    return {
      amountOriginal: new Decimal(input.amount).toFixed(2),
      isInstallment: false,
      installmentSeriesId: null,
      installmentNumber: null,
      installmentTotal: null,
      installmentAmount: null,
      installmentSource: null,
      originalTotalAmount: null,
      createdFromSeries: false,
    };
  }

  const count = input.installment.count ?? 1;
  const entryMode = input.installment.entryMode ?? 'perInstallment';
  const perInstallmentAmount =
    input.installment.perInstallmentAmount !== undefined ? input.installment.perInstallmentAmount : input.amount;

  const schedule = computeInstallmentAmounts({
    count,
    entryMode,
    perInstallmentAmount,
    totalAmount: input.installment.totalAmount,
  });
  const seriesId = `ser_${crypto.randomUUID()}`;

  return {
    amountOriginal: schedule.amounts[0],
    isInstallment: true,
    installmentSeriesId: seriesId,
    installmentNumber: 1,
    installmentTotal: count,
    installmentAmount: schedule.amounts[0],
    installmentSource: 'manual',
    originalTotalAmount:
      entryMode === 'total' && input.installment.totalAmount !== undefined
        ? new Decimal(input.installment.totalAmount).toFixed(2)
        : null,
    createdFromSeries: false,
  };
}

export async function propagateInstallmentUpdate(existing: ExpenseRow, payload: UpdateExpenseInput): Promise<ExpenseWithPaidBy> {
  const applyScope = getEffectiveApplyScope(existing, payload.applyScope);

  if (!existing.isInstallment || !existing.installmentSeriesId || applyScope === 'single') {
    return prisma.expense.update({
      where: { id: existing.id },
      data: toSingleExpenseUpdateData(existing, payload),
      include: { paidByUser: true },
    });
  }

  if (payload.month && payload.month !== existing.month) {
    throw new Error('Changing month is only supported with applyScope=single');
  }

  if (payload.installment && payload.installment.enabled === false) {
    throw new Error('Disabling installments is only supported with applyScope=single');
  }

  const scopeFilter =
    applyScope === 'all'
      ? {}
      : {
          month: {
            gte: existing.month,
          },
        };

  const seriesRows = await prisma.expense.findMany({
    where: {
      installmentSeriesId: existing.installmentSeriesId,
      ...scopeFilter,
    },
    orderBy: [{ installmentNumber: 'asc' }, { month: 'asc' }],
  });

  const newTotal = payload.installment?.enabled
    ? (payload.installment.count ?? existing.installmentTotal ?? 1)
    : (existing.installmentTotal ?? 1);
  const sourceEntryMode = payload.installment?.entryMode;
  const sourcePerAmount =
    payload.installment?.perInstallmentAmount !== undefined
      ? payload.installment.perInstallmentAmount
      : payload.amount !== undefined
        ? payload.amount
        : existing.installmentAmount?.toFixed(2) ?? existing.amountOriginal.toFixed(2);
  const sourceTotalAmount =
    payload.installment?.entryMode === 'total'
      ? payload.installment.totalAmount
      : existing.originalTotalAmount?.toFixed(2);

  const schedule = computeInstallmentAmounts({
    count: newTotal,
    entryMode:
      sourceEntryMode ??
      (sourceTotalAmount !== undefined && sourceTotalAmount !== null ? 'total' : 'perInstallment'),
    perInstallmentAmount: sourcePerAmount,
    totalAmount: sourceTotalAmount ?? undefined,
  }).amounts;

  const seriesDate = payload.date ? new Date(`${payload.date}T12:00:00.000Z`) : null;
  const nextFxRate = payload.fxRate !== undefined ? new Decimal(payload.fxRate).toFixed(6) : null;
  const nextCurrencyCode = payload.currencyCode ?? null;

  await prisma.$transaction(async (tx) => {
    for (const row of seriesRows) {
      if (!row.installmentNumber) {
        continue;
      }

      if (row.installmentNumber > newTotal) {
        await tx.expense.delete({ where: { id: row.id } });
        continue;
      }

      const amountOriginal = schedule[row.installmentNumber - 1];
      const fxRateUsed = nextFxRate ?? row.fxRateUsed.toFixed(6);
      const currencyCode = nextCurrencyCode ?? row.currencyCode;
      const amountArs = toArsAmount(amountOriginal, fxRateUsed);
      await tx.expense.update({
        where: { id: row.id },
        data: {
          ...(payload.description ? { description: payload.description } : {}),
          ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
          ...(payload.paidByUserId ? { paidByUserId: payload.paidByUserId } : {}),
          ...(nextCurrencyCode ? { currencyCode: nextCurrencyCode } : {}),
          ...(nextFxRate ? { fxRateUsed: nextFxRate } : {}),
          ...(seriesDate ? { date: seriesDate } : {}),
          amountOriginal,
          amountArs,
          installmentAmount: amountOriginal,
          installmentTotal: newTotal,
          originalTotalAmount:
            sourceEntryMode === 'total' && sourceTotalAmount !== undefined
              ? new Decimal(sourceTotalAmount).toFixed(2)
              : sourceEntryMode === 'perInstallment'
                ? null
                : row.originalTotalAmount,
          installmentSource: 'manual',
          createdFromSeries: row.createdFromSeries,
        },
      });
    }
  });

  return prisma.expense.findUniqueOrThrow({
    where: { id: existing.id },
    include: { paidByUser: true },
  });
}

export async function propagateInstallmentDelete(existing: ExpenseRow, applyScope?: ApplyScope): Promise<void> {
  const resolvedScope = getEffectiveApplyScope(existing, applyScope);

  if (!existing.isInstallment || !existing.installmentSeriesId || resolvedScope === 'single') {
    await prisma.expense.delete({ where: { id: existing.id } });
    return;
  }

  if (resolvedScope === 'all') {
    await prisma.expense.deleteMany({ where: { installmentSeriesId: existing.installmentSeriesId } });
    return;
  }

  await prisma.expense.deleteMany({
    where: {
      installmentSeriesId: existing.installmentSeriesId,
      month: { gte: existing.month },
    },
  });
}

function toSingleExpenseUpdateData(existing: ExpenseRow, payload: UpdateExpenseInput) {
  const nextInstallment = payload.installment?.enabled
    ? resolveCreateExpenseAmount({
        month: payload.month ?? existing.month,
        date: payload.date ?? existing.date.toISOString().slice(0, 10),
        description: payload.description ?? existing.description,
        categoryId: payload.categoryId ?? existing.categoryId,
        paidByUserId: payload.paidByUserId ?? existing.paidByUserId,
        amount: payload.amount ?? undefined,
        currencyCode: payload.currencyCode ?? normalizeCurrencyCode(existing.currencyCode),
        fxRate: payload.fxRate ?? Number(existing.fxRateUsed),
        installment: payload.installment,
      })
    : null;

  return {
    ...(payload.month ? { month: payload.month } : {}),
    ...(payload.date ? { date: new Date(`${payload.date}T12:00:00.000Z`) } : {}),
    ...(payload.description ? { description: payload.description } : {}),
    ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
    ...(payload.amount !== undefined && !payload.installment?.enabled
      ? {
          amountOriginal: new Decimal(payload.amount).toFixed(2),
          amountArs: toArsAmount(
            new Decimal(payload.amount).toFixed(2),
            payload.fxRate !== undefined ? new Decimal(payload.fxRate).toFixed(6) : existing.fxRateUsed.toFixed(6),
          ),
        }
      : {}),
    ...(payload.amount === undefined &&
    payload.fxRate !== undefined &&
    !payload.installment?.enabled
      ? {
          amountArs: toArsAmount(existing.amountOriginal.toFixed(2), new Decimal(payload.fxRate).toFixed(6)),
        }
      : {}),
    ...(payload.paidByUserId ? { paidByUserId: payload.paidByUserId } : {}),
    ...(payload.currencyCode ? { currencyCode: payload.currencyCode } : {}),
    ...(payload.fxRate !== undefined ? { fxRateUsed: new Decimal(payload.fxRate).toFixed(6) } : {}),
    ...(nextInstallment
      ? {
          amountOriginal: nextInstallment.amountOriginal,
          amountArs: toArsAmount(
            nextInstallment.amountOriginal,
            payload.fxRate !== undefined ? new Decimal(payload.fxRate).toFixed(6) : existing.fxRateUsed.toFixed(6),
          ),
          isInstallment: nextInstallment.isInstallment,
          installmentSeriesId: nextInstallment.installmentSeriesId,
          installmentNumber: nextInstallment.installmentNumber,
          installmentTotal: nextInstallment.installmentTotal,
          installmentAmount: nextInstallment.installmentAmount,
          installmentSource: nextInstallment.installmentSource,
          originalTotalAmount: nextInstallment.originalTotalAmount,
          createdFromSeries: nextInstallment.createdFromSeries,
        }
      : {}),
  };
}

export function inferNextInstallmentMonth(expense: ExpenseRow): string | null {
  if (!expense.isInstallment || !expense.installmentNumber || !expense.installmentTotal) {
    return null;
  }
  if (expense.installmentNumber >= expense.installmentTotal) {
    return null;
  }
  return addMonths(expense.month, 1);
}
