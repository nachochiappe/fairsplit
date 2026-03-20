import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();
const monthA = '2099-07';
const monthB = '2099-08';

let requesterHouseholdId = '';
let requesterUserId = '';
let requesterCategoryId = '';
let requesterSessionToken = '';

let otherHouseholdId = '';
let otherUserId = '';
let otherCategoryId = '';
let otherSessionToken = '';

async function cleanupHouseholdData(): Promise<void> {
  const householdIds = [requesterHouseholdId, otherHouseholdId].filter(Boolean);
  const userIds = [requesterUserId, otherUserId].filter(Boolean);
  const categoryIds = [requesterCategoryId, otherCategoryId].filter(Boolean);

  if (householdIds.length > 0) {
    await prisma.expense.deleteMany({ where: { householdId: { in: householdIds } } });
    await prisma.recurringExpenseSkipMonth.deleteMany({
      where: { template: { householdId: { in: householdIds } } },
    });
    await prisma.expenseTemplate.deleteMany({ where: { householdId: { in: householdIds } } });
    await prisma.monthlyExchangeRate.deleteMany({ where: { householdId: { in: householdIds } } });
    await prisma.monthlyIncome.deleteMany({ where: { householdId: { in: householdIds } } });
  }

  if (categoryIds.length > 0) {
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  if (householdIds.length > 0) {
    await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
  }
}

describe('tenant isolation', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);

    const requesterHousehold = await prisma.household.create({
      data: { name: `Requester HH ${suffix}` },
    });
    requesterHouseholdId = requesterHousehold.id;

    const requesterUser = await prisma.user.create({
      data: {
        name: `Requester ${suffix}`,
        householdId: requesterHouseholdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    requesterUserId = requesterUser.id;
    requesterSessionToken = issueSessionToken(
      {
        id: requesterUser.id,
        householdId: requesterUser.householdId,
        email: requesterUser.email,
        authUserId: requesterUser.authUserId,
        onboardingHouseholdDecisionAt: requesterUser.onboardingHouseholdDecisionAt,
      },
      process.env.FAIRSPLIT_SESSION_SECRET!,
    );

    const requesterCategory = await prisma.category.create({
      data: { name: `Requester Category ${suffix}`, householdId: requesterHouseholdId },
    });
    requesterCategoryId = requesterCategory.id;

    const otherHousehold = await prisma.household.create({
      data: { name: `Other HH ${suffix}` },
    });
    otherHouseholdId = otherHousehold.id;

    const otherUser = await prisma.user.create({
      data: {
        name: `Other ${suffix}`,
        householdId: otherHouseholdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    otherUserId = otherUser.id;
    otherSessionToken = issueSessionToken(
      {
        id: otherUser.id,
        householdId: otherUser.householdId,
        email: otherUser.email,
        authUserId: otherUser.authUserId,
        onboardingHouseholdDecisionAt: otherUser.onboardingHouseholdDecisionAt,
      },
      process.env.FAIRSPLIT_SESSION_SECRET!,
    );

    const otherCategory = await prisma.category.create({
      data: { name: `Other Category ${suffix}`, householdId: otherHouseholdId },
    });
    otherCategoryId = otherCategory.id;
  });

  afterEach(async () => {
    const householdIds = [requesterHouseholdId, otherHouseholdId].filter(Boolean);
    if (householdIds.length === 0) {
      return;
    }

    await prisma.expense.deleteMany({ where: { householdId: { in: householdIds } } });
    await prisma.recurringExpenseSkipMonth.deleteMany({
      where: { template: { householdId: { in: householdIds } } },
    });
    await prisma.expenseTemplate.deleteMany({ where: { householdId: { in: householdIds } } });
    await prisma.monthlyExchangeRate.deleteMany({ where: { householdId: { in: householdIds } } });
    await prisma.monthlyIncome.deleteMany({ where: { householdId: { in: householdIds } } });
    await prisma.category.update({
      where: { id: otherCategoryId },
      data: { archivedAt: null },
    });
  });

  afterAll(async () => {
    await cleanupHouseholdData();
    await prisma.$disconnect();
  });

  it('does not return recurring-expense warnings from another household', async () => {
    await prisma.expenseTemplate.create({
      data: {
        description: 'Other household confidential recurring expense',
        categoryId: otherCategoryId,
        amountOriginal: '12.00',
        amountArs: '12.00',
        currencyCode: 'ARS',
        fxRate: '1.000000',
        dayOfMonth: 5,
        isActive: true,
        householdId: otherHouseholdId,
        paidByUserId: otherUserId,
      },
    });

    await prisma.category.update({
      where: { id: otherCategoryId },
      data: { archivedAt: new Date() },
    });

    const response = await request(app)
      .get('/api/expenses')
      .set('x-fairsplit-session', requesterSessionToken)
      .query({ month: monthA });

    expect(response.status).toBe(200);
    expect(response.body.warnings).toEqual([]);
  });

  it('does not allow reading another user profile by id', async () => {
    const ownProfileResponse = await request(app)
      .get(`/api/users/${encodeURIComponent(requesterUserId)}`)
      .set('x-fairsplit-session', requesterSessionToken);
    expect(ownProfileResponse.status).toBe(200);
    expect(ownProfileResponse.body.id).toBe(requesterUserId);
    expect(ownProfileResponse.body.email).toBe(null);

    const otherProfileResponse = await request(app)
      .get(`/api/users/${encodeURIComponent(otherUserId)}`)
      .set('x-fairsplit-session', requesterSessionToken);
    expect(otherProfileResponse.status).toBe(403);
    expect(otherProfileResponse.body.error).toBe('You can only access your own profile.');
  });

  it('does not generate installment rows for another household on read', async () => {
    const createResponse = await request(app)
      .post('/api/expenses')
      .set('x-fairsplit-session', otherSessionToken)
      .send({
        month: monthA,
        date: `${monthA}-10`,
        description: 'Other household installment',
        categoryId: otherCategoryId,
        paidByUserId: otherUserId,
        installment: {
          enabled: true,
          count: 3,
          entryMode: 'perInstallment',
          perInstallmentAmount: 20,
        },
      });

    expect(createResponse.status).toBe(201);
    const seriesId = createResponse.body.installment.seriesId as string;

    const beforeCount = await prisma.expense.count({
      where: {
        householdId: otherHouseholdId,
        installmentSeriesId: seriesId,
        month: monthB,
      },
    });
    expect(beforeCount).toBe(0);

    const response = await request(app)
      .get('/api/expenses')
      .set('x-fairsplit-session', requesterSessionToken)
      .query({ month: monthB });

    expect(response.status).toBe(200);
    expect(
      response.body.expenses.find(
        (expense: { installment: { seriesId: string } | null }) => expense.installment?.seriesId === seriesId,
      ),
    ).toBeFalsy();

    const afterCount = await prisma.expense.count({
      where: {
        householdId: otherHouseholdId,
        installmentSeriesId: seriesId,
        month: monthB,
      },
    });
    expect(afterCount).toBe(0);
  });

  it('does not reuse another household monthly FX rate', async () => {
    await prisma.monthlyExchangeRate.create({
      data: {
        householdId: otherHouseholdId,
        month: monthA,
        currencyCode: 'USD',
        rateToArs: '1000.000000',
      },
    });

    const response = await request(app)
      .post('/api/expenses')
      .set('x-fairsplit-session', requesterSessionToken)
      .send({
        month: monthA,
        date: `${monthA}-12`,
        description: 'Requester USD expense',
        categoryId: requesterCategoryId,
        amount: 10,
        currencyCode: 'USD',
        paidByUserId: requesterUserId,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain(`Missing FX rate for USD in ${monthA}`);
  });
});
