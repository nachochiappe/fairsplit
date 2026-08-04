import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();
const month = '2097-03';
let primaryUserId = '';
let secondaryUserId = '';
let foodCategoryId = '';
let transportCategoryId = '';
let superCategoryId = '';
let householdId = '';
let sessionToken = '';

async function createExpense(overrides: {
  description: string;
  categoryId: string;
  amountArs: string;
  paidByUserId: string;
  day: string;
}) {
  await prisma.expense.create({
    data: {
      month,
      date: new Date(`${month}-${overrides.day}T12:00:00.000Z`),
      description: overrides.description,
      categoryId: overrides.categoryId,
      amountOriginal: overrides.amountArs,
      amountArs: overrides.amountArs,
      householdId,
      paidByUserId: overrides.paidByUserId,
    },
  });
}

describe('GET /api/expense-totals', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const household = await prisma.household.create({ data: { name: `Totals Agg HH ${suffix}` } });
    householdId = household.id;

    const primary = await prisma.user.create({
      data: { name: `Agg Primary ${suffix}`, householdId, onboardingHouseholdDecisionAt: new Date() },
    });
    primaryUserId = primary.id;
    const secondary = await prisma.user.create({
      data: { name: `Agg Secondary ${suffix}`, householdId, onboardingHouseholdDecisionAt: new Date() },
    });
    secondaryUserId = secondary.id;

    sessionToken = issueSessionToken(
      {
        id: primary.id,
        householdId: primary.householdId,
        email: primary.email,
        authUserId: primary.authUserId,
        onboardingHouseholdDecisionAt: primary.onboardingHouseholdDecisionAt,
      },
      process.env.FAIRSPLIT_SESSION_SECRET!,
    );

    const superCategory = await prisma.superCategory.create({
      data: { name: `Essentials ${suffix}`, slug: `essentials-${suffix}`, color: '#123456', householdId },
    });
    superCategoryId = superCategory.id;

    const food = await prisma.category.create({
      data: { name: `Food ${suffix}`, householdId, superCategoryId },
    });
    foodCategoryId = food.id;
    const transport = await prisma.category.create({
      data: { name: `Transport ${suffix}`, householdId },
    });
    transportCategoryId = transport.id;
  });

  beforeEach(async () => {
    await prisma.expense.deleteMany({ where: { householdId } });
  });

  afterAll(async () => {
    if (householdId) {
      await prisma.expense.deleteMany({ where: { householdId } });
      await prisma.category.deleteMany({ where: { householdId } });
      await prisma.superCategory.deleteMany({ where: { householdId } });
      await prisma.user.deleteMany({ where: { householdId } });
      await prisma.household.deleteMany({ where: { id: householdId } });
    }
    await prisma.$disconnect();
  });

  it('returns empty aggregates for a month with no expenses', async () => {
    const response = await request(app)
      .get('/api/expense-totals')
      .set('x-fairsplit-session', sessionToken)
      .query({ month });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      month,
      warnings: [],
      totalArs: '0.00',
      byCategory: [],
      byUser: {},
    });
  });

  it('aggregates by category and by payer, ordered by size', async () => {
    await createExpense({ description: 'Market', categoryId: foodCategoryId, amountArs: '500.00', paidByUserId: primaryUserId, day: '02' });
    await createExpense({ description: 'Dinner', categoryId: foodCategoryId, amountArs: '250.50', paidByUserId: secondaryUserId, day: '03' });
    await createExpense({ description: 'Bus', categoryId: transportCategoryId, amountArs: '80.00', paidByUserId: primaryUserId, day: '04' });

    const response = await request(app)
      .get('/api/expense-totals')
      .set('x-fairsplit-session', sessionToken)
      .query({ month });

    expect(response.status).toBe(200);
    expect(response.body.totalArs).toBe('830.50');

    // Largest category first, with the super-category metadata the pie chart needs.
    expect(response.body.byCategory).toHaveLength(2);
    expect(response.body.byCategory[0]).toEqual(
      expect.objectContaining({
        categoryId: foodCategoryId,
        totalArs: '750.50',
        superCategoryId,
        superCategoryColor: '#123456',
      }),
    );
    expect(response.body.byCategory[1]).toEqual(
      expect.objectContaining({
        categoryId: transportCategoryId,
        totalArs: '80.00',
        superCategoryId: null,
        superCategoryColor: null,
      }),
    );

    expect(response.body.byUser).toEqual({
      [primaryUserId]: '580.00',
      [secondaryUserId]: '250.50',
    });
  });

  it('keeps every GET side-effect free and materializes a fresh month only through POST', async () => {
    const template = await prisma.expenseTemplate.create({
      data: {
        description: 'Streaming',
        categoryId: foodCategoryId,
        amountOriginal: '42.00',
        amountArs: '42.00',
        fxRate: '1',
        dayOfMonth: 9,
        householdId,
        paidByUserId: primaryUserId,
      },
    });

    try {
      for (const path of ['/api/expenses', '/api/expense-totals', '/api/settlement']) {
        const read = await request(app)
          .get(path)
          .set('x-fairsplit-session', sessionToken)
          .query({ month });
        expect(read.status).toBe(200);
      }
      expect(await prisma.expense.count({ where: { householdId, month, templateId: template.id } })).toBe(0);

      const legacyHydration = await request(app)
        .get('/api/expense-totals')
        .set('x-fairsplit-session', sessionToken)
        .query({ month, hydrate: true });
      expect(legacyHydration.status).toBe(400);

      const materialized = await request(app)
        .post('/api/expenses/materialize')
        .set('x-fairsplit-session', sessionToken)
        .send({ month });
      expect(materialized.status).toBe(200);
      expect(materialized.body).toEqual({ month, warnings: [] });

      const totals = await request(app)
        .get('/api/expense-totals')
        .set('x-fairsplit-session', sessionToken)
        .query({ month });
      expect(totals.status).toBe(200);
      expect(totals.body.totalArs).toBe('42.00');
      expect(totals.body.byUser).toEqual({ [primaryUserId]: '42.00' });
    } finally {
      await prisma.expense.deleteMany({ where: { templateId: template.id } });
      await prisma.expenseTemplate.delete({ where: { id: template.id } });
    }
  });

  it('rejects a request without a session', async () => {
    const response = await request(app).get('/api/expense-totals').query({ month });
    expect(response.status).toBe(401);
  });

  it('rejects an invalid month', async () => {
    const response = await request(app)
      .get('/api/expense-totals')
      .set('x-fairsplit-session', sessionToken)
      .query({ month: 'not-a-month' });
    expect(response.status).toBe(400);
  });
});
