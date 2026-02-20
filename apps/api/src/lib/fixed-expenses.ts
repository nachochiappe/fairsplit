import Decimal from 'decimal.js';
import { ApplyScope, monthToDate } from '@fairsplit/shared';
import { prisma } from '@fairsplit/db';

function toArsAmount(amountOriginal: string, fxRate: string): string {
  return new Decimal(amountOriginal).mul(fxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

export async function resolveFxRateForMonth(options: {
  month: string;
  currencyCode: string;
  explicitFxRate?: number;
}): Promise<string | null> {
  const currencyCode = options.currencyCode.toUpperCase();
  if (currencyCode === 'ARS') {
    return '1.000000';
  }

  if (currencyCode === 'USD' || currencyCode === 'EUR') {
    const monthlyRate = await prisma.monthlyExchangeRate.findUnique({
      where: {
        month_currencyCode: {
          month: options.month,
          currencyCode,
        },
      },
    });
    if (monthlyRate) {
      return monthlyRate.rateToArs.toFixed(6);
    }
  }

  return options.explicitFxRate !== undefined ? new Decimal(options.explicitFxRate).toFixed(6) : null;
}

export async function ensureFixedExpensesForMonth(month: string): Promise<string[]> {
  const warnings: string[] = [];
  const templates = await prisma.expenseTemplate.findMany({
    where: { isActive: true },
    include: { category: true, paidByUser: { select: { householdId: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const templateIds = templates.map((template) => template.id);
  const templateExpenseRows =
    templateIds.length > 0
      ? await prisma.expense.findMany({
          where: { templateId: { in: templateIds } },
          select: { templateId: true, month: true },
        })
      : [];
  const skippedTemplateIds =
    templateIds.length > 0
      ? new Set(
          (
            await prisma.recurringExpenseSkipMonth.findMany({
              where: { templateId: { in: templateIds }, month },
              select: { templateId: true },
            })
          ).map((row) => row.templateId),
        )
      : new Set<string>();

  const existingTemplateIds = new Set<string>();
  const firstMonthByTemplateId = new Map<string, string>();
  for (const row of templateExpenseRows) {
    if (!row.templateId) {
      continue;
    }
    if (row.month === month) {
      existingTemplateIds.add(row.templateId);
    }
    const currentFirstMonth = firstMonthByTemplateId.get(row.templateId);
    if (!currentFirstMonth || row.month < currentFirstMonth) {
      firstMonthByTemplateId.set(row.templateId, row.month);
    }
  }

  const currencies = Array.from(
    new Set(
      templates
        .filter((template) => template.currencyCode !== 'ARS')
        .map((template) => template.currencyCode),
    ),
  );
  const monthlyRatesByCurrency =
    currencies.length > 0
      ? new Map(
          (
            await prisma.monthlyExchangeRate.findMany({
              where: {
                month,
                currencyCode: { in: currencies },
              },
              select: { currencyCode: true, rateToArs: true },
            })
          ).map((rate) => [rate.currencyCode, rate.rateToArs.toFixed(6)]),
        )
      : new Map<string, string>();

  for (const template of templates) {
    if (template.category.archivedAt) {
      warnings.push(
        `Recurring expense \"${template.description}\" was skipped because category \"${template.category.name}\" is archived.`,
      );
      continue;
    }

    const firstMonth = firstMonthByTemplateId.get(template.id);
    if (firstMonth && month < firstMonth) {
      continue;
    }

    if (existingTemplateIds.has(template.id)) {
      continue;
    }
    if (skippedTemplateIds.has(template.id)) {
      continue;
    }

    const monthRate = template.currencyCode === 'ARS' ? '1.000000' : monthlyRatesByCurrency.get(template.currencyCode);

    const fxRateUsed = monthRate ?? template.fxRate.toFixed(6);
    const amountOriginal = template.amountOriginal.toFixed(2);
    const amountArs = toArsAmount(amountOriginal, fxRateUsed);
    const householdId = template.householdId ?? template.paidByUser.householdId;
    if (!householdId) {
      warnings.push(`Recurring expense \"${template.description}\" was skipped because it has no household context.`);
      continue;
    }

    try {
      await prisma.expense.create({
        data: {
          month,
          date: monthToDate(month, template.dayOfMonth),
          description: template.description,
          categoryId: template.categoryId,
          amountOriginal,
          amountArs,
          currencyCode: template.currencyCode,
          fxRateUsed,
          householdId,
          templateId: template.id,
          paidByUserId: template.paidByUserId,
          isInstallment: false,
          createdFromSeries: false,
        },
      });
    } catch (error) {
      warnings.push(
        `Recurring expense \"${template.description}\" could not be generated (${error instanceof Error ? error.message : 'unknown error'}).`,
      );
    }
  }

  return warnings;
}

type ExpenseRow = Awaited<ReturnType<typeof prisma.expense.findFirstOrThrow>>;

export async function deleteFixedExpense(existing: ExpenseRow, applyScope?: ApplyScope): Promise<void> {
  const scope = applyScope ?? 'single';
  if (!existing.templateId) {
    await prisma.expense.delete({ where: { id: existing.id } });
    return;
  }

  if (scope === 'single') {
    await prisma.$transaction(async (tx) => {
      await tx.recurringExpenseSkipMonth.upsert({
        where: { templateId_month: { templateId: existing.templateId!, month: existing.month } },
        create: { templateId: existing.templateId!, month: existing.month },
        update: {},
      });
      await tx.expense.delete({ where: { id: existing.id } });
    });
    return;
  }

  if (scope === 'future') {
    await prisma.$transaction(async (tx) => {
      await tx.expenseTemplate.update({ where: { id: existing.templateId! }, data: { isActive: false } });
      await tx.expense.deleteMany({
        where: {
          templateId: existing.templateId!,
          month: { gte: existing.month },
        },
      });
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.expenseTemplate.update({ where: { id: existing.templateId! }, data: { isActive: false } });
    await tx.expense.deleteMany({ where: { templateId: existing.templateId! } });
  });
}

export async function applyTemplateValuesToFutureMonths(options: {
  templateId: string;
  fromMonth: string;
  description: string;
  categoryId: string;
  amountOriginal: string;
  amountArs: string;
  currencyCode: string;
  fxRateUsed: string;
  paidByUserId: string;
  dayOfMonth: number;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.expenseTemplate.update({
      where: { id: options.templateId },
      data: {
        description: options.description,
        categoryId: options.categoryId,
        amountOriginal: options.amountOriginal,
        amountArs: options.amountArs,
        currencyCode: options.currencyCode,
        fxRate: options.fxRateUsed,
        paidByUserId: options.paidByUserId,
        dayOfMonth: options.dayOfMonth,
      },
    });

    const futureExpenses = await tx.expense.findMany({
      where: {
        templateId: options.templateId,
        month: { gt: options.fromMonth },
      },
      select: { id: true, month: true },
    });

    for (const expense of futureExpenses) {
      await tx.expense.update({
        where: { id: expense.id },
        data: {
          description: options.description,
          categoryId: options.categoryId,
          amountOriginal: options.amountOriginal,
          amountArs: options.amountArs,
          currencyCode: options.currencyCode,
          fxRateUsed: options.fxRateUsed,
          paidByUserId: options.paidByUserId,
          date: monthToDate(expense.month, options.dayOfMonth),
        },
      });
    }
  });
}

export function computeArsAmount(amountOriginal: number | string, fxRate: string): string {
  return toArsAmount(new Decimal(amountOriginal).toFixed(2), fxRate);
}
