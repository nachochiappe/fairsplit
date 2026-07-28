import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();
const month = '2098-05';
let testUserId = '';
let testCategoryId = '';
let householdId = '';
let sessionToken = '';

async function getTotals(query: Record<string, unknown> = {}) {
  const response = await request(app)
    .get('/api/expenses')
    .set('x-fairsplit-session', sessionToken)
    .query({ month, limit: 1, hydrate: false, includeCount: false, includeTotals: true, ...query });

  expect(response.status).toBe(200);
  return response.body.totals;
}

describe('expense month totals', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const household = await prisma.household.create({ data: { name: `Totals HH ${suffix}` } });
    householdId = household.id;
    const user = await prisma.user.create({
      data: {
        name: `Totals Test ${suffix}`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    testUserId = user.id;
    sessionToken = issueSessionToken(
      {
        id: user.id,
        householdId: user.householdId,
        email: user.email,
        authUserId: user.authUserId,
        onboardingHouseholdDecisionAt: user.onboardingHouseholdDecisionAt,
      },
      process.env.FAIRSPLIT_SESSION_SECRET!,
    );
    const category = await prisma.category.create({
      data: { name: `Totals Category ${suffix}`, householdId },
    });
    testCategoryId = category.id;
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany({ where: { householdId, month } });
    await prisma.expenseTemplate.deleteMany({ where: { householdId } });
  });

  afterAll(async () => {
    if (householdId) {
      await prisma.expense.deleteMany({ where: { householdId } });
      await prisma.expenseTemplate.deleteMany({ where: { householdId } });
    }
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } });
    }
    if (testCategoryId) {
      await prisma.category.delete({ where: { id: testCategoryId } });
    }
    if (householdId) {
      await prisma.household.deleteMany({ where: { id: householdId } });
    }
    await prisma.$disconnect();
  });

  it('reports zeroed totals for a month with no expenses', async () => {
    expect(await getTotals()).toEqual({
      filteredSubtotalArs: '0.00',
      bySection: { fixedArs: '0.00', oneTimeArs: '0.00', installmentArs: '0.00' },
    });
  });

  it('splits the month subtotal across one-time, recurring and installment sections', async () => {
    // One-time.
    await prisma.expense.create({
      data: {
        month,
        date: new Date(`${month}-04T12:00:00.000Z`),
        description: 'Groceries',
        categoryId: testCategoryId,
        amountOriginal: '100.50',
        amountArs: '100.50',
        householdId,
        paidByUserId: testUserId,
      },
    });

    // Recurring, via a template.
    const template = await prisma.expenseTemplate.create({
      data: {
        description: 'Rent',
        categoryId: testCategoryId,
        amountOriginal: '1000.00',
        amountArs: '1000.00',
        fxRate: '1',
        dayOfMonth: 1,
        householdId,
        paidByUserId: testUserId,
      },
    });
    await prisma.expense.create({
      data: {
        month,
        date: new Date(`${month}-01T12:00:00.000Z`),
        description: 'Rent',
        categoryId: testCategoryId,
        amountOriginal: '1000.00',
        amountArs: '1000.00',
        householdId,
        templateId: template.id,
        paidByUserId: testUserId,
      },
    });

    // Installment.
    await prisma.expense.create({
      data: {
        month,
        date: new Date(`${month}-10T12:00:00.000Z`),
        description: 'Laptop 1/3',
        categoryId: testCategoryId,
        amountOriginal: '333.33',
        amountArs: '333.33',
        householdId,
        paidByUserId: testUserId,
        isInstallment: true,
        installmentSeriesId: `totals-series-${Date.now().toString(36)}`,
        installmentNumber: 1,
        installmentTotal: 3,
        installmentAmount: '333.33',
      },
    });

    expect(await getTotals()).toEqual({
      filteredSubtotalArs: '1433.83',
      bySection: { fixedArs: '1000.00', oneTimeArs: '100.50', installmentArs: '333.33' },
    });
  });

  it('counts a templated installment in both sections without double counting the subtotal', async () => {
    const template = await prisma.expenseTemplate.create({
      data: {
        description: 'Financed insurance',
        categoryId: testCategoryId,
        amountOriginal: '250.00',
        amountArs: '250.00',
        fxRate: '1',
        dayOfMonth: 5,
        householdId,
        paidByUserId: testUserId,
      },
    });
    await prisma.expense.create({
      data: {
        month,
        date: new Date(`${month}-05T12:00:00.000Z`),
        description: 'Financed insurance 2/6',
        categoryId: testCategoryId,
        amountOriginal: '250.00',
        amountArs: '250.00',
        householdId,
        templateId: template.id,
        paidByUserId: testUserId,
        isInstallment: true,
        installmentSeriesId: `totals-overlap-${Date.now().toString(36)}`,
        installmentNumber: 2,
        installmentTotal: 6,
        installmentAmount: '250.00',
      },
    });

    // The row is both templated and an instalment, so it lands in both sections
    // while the month subtotal still counts it once.
    expect(await getTotals()).toEqual({
      filteredSubtotalArs: '250.00',
      bySection: { fixedArs: '250.00', oneTimeArs: '0.00', installmentArs: '250.00' },
    });
  });

  it('applies the active filters to the reported subtotal', async () => {
    for (const [index, description] of ['Coffee beans', 'Train ticket'].entries()) {
      await prisma.expense.create({
        data: {
          month,
          date: new Date(`${month}-0${index + 1}T12:00:00.000Z`),
          description,
          categoryId: testCategoryId,
          amountOriginal: `${(index + 1) * 10}.00`,
          amountArs: `${(index + 1) * 10}.00`,
          householdId,
          paidByUserId: testUserId,
        },
      });
    }

    expect(await getTotals()).toEqual({
      filteredSubtotalArs: '30.00',
      bySection: { fixedArs: '0.00', oneTimeArs: '30.00', installmentArs: '0.00' },
    });

    expect(await getTotals({ search: 'coffee' })).toEqual({
      filteredSubtotalArs: '10.00',
      bySection: { fixedArs: '0.00', oneTimeArs: '10.00', installmentArs: '0.00' },
    });
  });
});
