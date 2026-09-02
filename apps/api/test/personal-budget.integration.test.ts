import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();
const month = '2099-09';
let householdId = '';
let categoryId = '';
let userAId = '';
let userBId = '';
let userAToken = '';
let userBToken = '';

function tokenFor(user: {
  id: string;
  householdId: string | null;
  email: string | null;
  authUserId: string | null;
  onboardingHouseholdDecisionAt: Date | null;
}) {
  return issueSessionToken(user, process.env.FAIRSPLIT_SESSION_SECRET!);
}

describe('personal budget forecast', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const household = await prisma.household.create({
      data: { name: `Personal budget ${suffix}` },
    });
    householdId = household.id;
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: {
          name: `Private plan A ${suffix}`,
          householdId,
          onboardingHouseholdDecisionAt: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          name: `Private plan B ${suffix}`,
          householdId,
          onboardingHouseholdDecisionAt: new Date(),
        },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userAToken = tokenFor(userA);
    userBToken = tokenFor(userB);

    const category = await prisma.category.create({
      data: { name: `Shared spending ${suffix}`, householdId },
    });
    categoryId = category.id;

    await prisma.monthlyIncome.createMany({
      data: [
        {
          month,
          householdId,
          userId: userAId,
          description: 'Salary',
          amount: '2500.00',
          amountOriginal: '2500.00',
          currencyCode: 'ARS',
          fxRateUsed: '1.000000',
        },
        {
          month,
          householdId,
          userId: userBId,
          description: 'Salary',
          amount: '1500.00',
          amountOriginal: '1500.00',
          currencyCode: 'ARS',
          fxRateUsed: '1.000000',
        },
      ],
    });

    const expenses = [
      { month: '2099-06', amount: '1000.00', paidByUserId: userAId },
      { month: '2099-07', amount: '1200.00', paidByUserId: userBId },
      { month: '2099-08', amount: '1400.00', paidByUserId: userAId },
      { month, amount: '300.00', paidByUserId: userAId },
      { month, amount: '500.00', paidByUserId: userBId },
    ];
    await prisma.expense.createMany({
      data: expenses.map((expense, index) => ({
        month: expense.month,
        householdId,
        date: new Date(`2099-${String(index + 1).padStart(2, '0')}-05T12:00:00.000Z`),
        description: `Shared ${index + 1}`,
        categoryId,
        amountOriginal: expense.amount,
        amountArs: expense.amount,
        currencyCode: 'ARS',
        fxRateUsed: '1.000000',
        paidByUserId: expense.paidByUserId,
      })),
    });
  });

  afterAll(async () => {
    const userIds = [userAId, userBId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.expense.deleteMany({ where: { paidByUserId: { in: userIds } } });
      await prisma.monthlyIncome.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    if (householdId) {
      await prisma.household.deleteMany({ where: { id: householdId } });
    }
    await prisma.$disconnect();
  });

  it('stores private planning totals and returns an explainable estimate', async () => {
    const update = await request(app).put('/api/personal-budget').set('x-fairsplit-session', userAToken).send({
      enabled: true,
      fixedCommitments: 280,
      savingsTarget: 200,
      safetyBuffer: 100,
      averagingMonths: 3,
    });

    expect(update.status).toBe(200);
    expect(update.body).toEqual({
      enabled: true,
      fixedCommitments: '280.00',
      savingsTarget: '200.00',
      safetyBuffer: '100.00',
      averagingMonths: 3,
    });

    const forecast = await request(app)
      .get('/api/personal-budget')
      .set('x-fairsplit-session', userAToken)
      .query({ month });

    expect(forecast.status).toBe(200);
    expect(forecast.body).toMatchObject({
      configured: true,
      monthlyIncome: '2500.00',
      historicalAverageSharedExpenses: '1200.00',
      projectedSharedExpenses: '1200.00',
      splitPercentage: '62.50',
      projectedFairShare: '750.00',
      alreadyPaid: '300.00',
      remainingSharedReserve: '450.00',
      availableForPersonalUse: '1170.00',
      historyMonthsRequested: 3,
      historyMonthsUsed: 3,
      confidence: 'high',
    });
  });

  it('does not expose one partner’s private plan to the other', async () => {
    const partnerForecast = await request(app)
      .get('/api/personal-budget')
      .set('x-fairsplit-session', userBToken)
      .query({ month });

    expect(partnerForecast.status).toBe(200);
    expect(partnerForecast.body.configured).toBe(false);
    expect(partnerForecast.body.settings).toEqual({
      enabled: true,
      fixedCommitments: '0.00',
      savingsTarget: '0.00',
      safetyBuffer: '0.00',
      averagingMonths: 3,
    });
  });

  it('rejects invalid planning values', async () => {
    const response = await request(app).put('/api/personal-budget').set('x-fairsplit-session', userAToken).send({
      enabled: true,
      fixedCommitments: -1,
      savingsTarget: 0,
      safetyBuffer: 0,
      averagingMonths: 13,
    });

    expect(response.status).toBe(400);
  });

  it('can disable the feature without deleting private planning values', async () => {
    const response = await request(app).put('/api/personal-budget').set('x-fairsplit-session', userAToken).send({
      enabled: false,
      fixedCommitments: 280,
      savingsTarget: 200,
      safetyBuffer: 100,
      averagingMonths: 3,
    });

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);

    const forecast = await request(app)
      .get('/api/personal-budget')
      .set('x-fairsplit-session', userAToken)
      .query({ month });

    expect(forecast.body.settings).toMatchObject({
      enabled: false,
      fixedCommitments: '280.00',
      savingsTarget: '200.00',
      safetyBuffer: '100.00',
    });
  });
});
