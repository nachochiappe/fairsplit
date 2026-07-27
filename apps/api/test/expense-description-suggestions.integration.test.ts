import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();
let householdId = '';
let otherHouseholdId = '';
let userId = '';
let otherUserId = '';
let categoryId = '';
let otherCategoryId = '';
let sessionToken = '';

async function createExpense(
  description: string,
  date: string,
  household: string,
  user: string,
  category: string,
) {
  return prisma.expense.create({
    data: {
      month: date.slice(0, 7),
      date: new Date(`${date}T00:00:00.000Z`),
      description,
      householdId: household,
      categoryId: category,
      amountOriginal: 100,
      amountArs: 100,
      paidByUserId: user,
    },
  });
}

describe('expense description suggestions', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const household = await prisma.household.create({ data: { name: `Suggestions HH ${suffix}` } });
    const otherHousehold = await prisma.household.create({
      data: { name: `Other Suggestions HH ${suffix}` },
    });
    householdId = household.id;
    otherHouseholdId = otherHousehold.id;

    const user = await prisma.user.create({
      data: {
        name: `Suggestions Test ${suffix}`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    const otherUser = await prisma.user.create({
      data: {
        name: `Other Suggestions Test ${suffix}`,
        householdId: otherHouseholdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    userId = user.id;
    otherUserId = otherUser.id;

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
      data: { name: `Suggestions Category ${suffix}`, householdId },
    });
    const otherCategory = await prisma.category.create({
      data: { name: `Other Suggestions Category ${suffix}`, householdId: otherHouseholdId },
    });
    categoryId = category.id;
    otherCategoryId = otherCategory.id;

    await createExpense('Super Market', '2099-01-02', householdId, userId, categoryId);
    await createExpense('Pharmacy market run', '2099-01-03', householdId, userId, categoryId);
    await createExpense('super market', '2099-01-04', householdId, userId, categoryId);
    await createExpense(
      'Market from another household',
      '2099-01-05',
      otherHouseholdId,
      otherUserId,
      otherCategoryId,
    );
  });

  afterAll(async () => {
    await prisma.expense.deleteMany({
      where: { householdId: { in: [householdId, otherHouseholdId].filter(Boolean) } },
    });
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
    if (otherUserId) {
      await prisma.user.delete({ where: { id: otherUserId } });
    }
    if (categoryId) {
      await prisma.category.delete({ where: { id: categoryId } });
    }
    if (otherCategoryId) {
      await prisma.category.delete({ where: { id: otherCategoryId } });
    }
    await prisma.household.deleteMany({
      where: { id: { in: [householdId, otherHouseholdId].filter(Boolean) } },
    });
    await prisma.$disconnect();
  });

  it('returns recent deduped descriptions for the authenticated household', async () => {
    const response = await request(app)
      .get('/api/expense-description-suggestions')
      .set('x-fairsplit-session', sessionToken)
      .query({ q: 'market', limit: 5 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(['super market', 'Pharmacy market run']);
  });

  it('honors the requested limit', async () => {
    const response = await request(app)
      .get('/api/expense-description-suggestions')
      .set('x-fairsplit-session', sessionToken)
      .query({ q: 'market', limit: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(['super market']);
  });
});
