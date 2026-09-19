import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();
const month = '2099-12';
let categoryId = '';
let householdId = '';
let integrationToken = '';
let integrationTokenId = '';
let sessionToken = '';
let userId = '';

describe('transaction integration tokens', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const household = await prisma.household.create({
      data: { name: `Integration HH ${suffix}` },
    });
    householdId = household.id;
    const user = await prisma.user.create({
      data: {
        name: `Integration User ${suffix}`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    userId = user.id;
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
      data: { name: `Integration Category ${suffix}`, householdId },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.expense.deleteMany({ where: { householdId } });
    await prisma.monthlyIncome.deleteMany({ where: { householdId } });
    await prisma.integrationToken.deleteMany({ where: { userId } });
    if (categoryId) {
      await prisma.category.delete({ where: { id: categoryId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
    if (householdId) {
      await prisma.household.delete({ where: { id: householdId } });
    }
    await prisma.$disconnect();
  });

  it('issues a plaintext token once and lists only its safe metadata', async () => {
    const createResponse = await request(app)
      .post('/api/integration-tokens')
      .set('x-fairsplit-session', sessionToken)
      .send({ name: 'Claude Code' });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.token).toMatch(/^fsp_[A-Za-z0-9_-]{43}$/);
    integrationToken = createResponse.body.token;
    integrationTokenId = createResponse.body.id;

    const listResponse = await request(app)
      .get('/api/integration-tokens')
      .set('x-fairsplit-session', sessionToken);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual([
      expect.objectContaining({
        id: integrationTokenId,
        name: 'Claude Code',
        tokenPrefix: integrationToken.slice(0, 12),
      }),
    ]);
    expect(listResponse.body[0]).not.toHaveProperty('token');
  });

  it('allows income and expense CRUD through the transaction token', async () => {
    const authorization = `Bearer ${integrationToken}`;

    const usersResponse = await request(app).get('/api/users').set('Authorization', authorization);
    expect(usersResponse.status).toBe(200);
    expect(usersResponse.body).toEqual([
      expect.objectContaining({ id: userId, email: null }),
    ]);

    const createIncomeResponse = await request(app)
      .post('/api/incomes')
      .set('Authorization', authorization)
      .send({
        month,
        userId,
        description: 'Salary',
        amount: 1000,
        currencyCode: 'ARS',
      });
    expect(createIncomeResponse.status).toBe(201);
    expect(createIncomeResponse.body).toMatchObject({
      amountOriginal: '1000.00',
      description: 'Salary',
    });

    const incomeId = createIncomeResponse.body.id as string;
    const updateIncomeResponse = await request(app)
      .put(`/api/incomes/${incomeId}`)
      .set('Authorization', authorization)
      .send({ amount: 1250 });
    expect(updateIncomeResponse.status).toBe(200);
    expect(updateIncomeResponse.body.amountOriginal).toBe('1250.00');

    const createExpenseResponse = await request(app)
      .post('/api/expenses')
      .set('Authorization', authorization)
      .send({
        month,
        date: `${month}-10`,
        description: 'Groceries',
        categoryId,
        amount: 200,
        paidByUserId: userId,
      });
    expect(createExpenseResponse.status).toBe(201);
    const expenseId = createExpenseResponse.body.id as string;

    const listResponse = await request(app)
      .get('/api/expenses')
      .set('Authorization', authorization)
      .query({ month });
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.expenses).toEqual([
      expect.objectContaining({ id: expenseId, description: 'Groceries' }),
    ]);

    expect(
      (await request(app).delete(`/api/incomes/${incomeId}`).set('Authorization', authorization))
        .status,
    ).toBe(204);
    expect(
      (await request(app).delete(`/api/expenses/${expenseId}`).set('Authorization', authorization))
        .status,
    ).toBe(204);
  });

  it('cannot use a transaction token on account-security routes and stops working after revocation', async () => {
    const authorization = `Bearer ${integrationToken}`;
    const securityResponse = await request(app)
      .get('/api/integration-tokens')
      .set('Authorization', authorization);
    expect(securityResponse.status).toBe(401);

    const revokeResponse = await request(app)
      .delete(`/api/integration-tokens/${integrationTokenId}`)
      .set('x-fairsplit-session', sessionToken);
    expect(revokeResponse.status).toBe(204);

    const deniedResponse = await request(app).get('/api/users').set('Authorization', authorization);
    expect(deniedResponse.status).toBe(401);
  });
});
