import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';

const app = createApp();

let householdId = '';
let userId = '';
let sourceCategoryId = '';
let alternateCategoryId = '';
let expenseId = '';
let templateId = '';

describe('Category archive API', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const household = await prisma.household.create({
      data: { name: `Category Archive HH ${suffix}` },
    });
    householdId = household.id;

    const user = await prisma.user.create({
      data: {
        name: `Category Archive User ${suffix}`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    userId = user.id;

    const sourceCategory = await prisma.category.create({
      data: {
        name: `Category Archive Source ${suffix}`,
        householdId,
      },
    });
    sourceCategoryId = sourceCategory.id;

    const alternateCategory = await prisma.category.create({
      data: {
        name: `Category Archive Alternate ${suffix}`,
        householdId,
      },
    });
    alternateCategoryId = alternateCategory.id;

    const expense = await prisma.expense.create({
      data: {
        householdId,
        month: '2099-08',
        date: new Date('2099-08-10T00:00:00.000Z'),
        description: `Archive expense ${suffix}`,
        categoryId: sourceCategoryId,
        amountOriginal: '123.45',
        amountArs: '123.45',
        currencyCode: 'ARS',
        fxRateUsed: '1',
        paidByUserId: userId,
      },
    });
    expenseId = expense.id;

    const template = await prisma.expenseTemplate.create({
      data: {
        householdId,
        description: `Archive template ${suffix}`,
        categoryId: sourceCategoryId,
        amountOriginal: '50.00',
        amountArs: '50.00',
        currencyCode: 'ARS',
        fxRate: '1',
        dayOfMonth: 5,
        paidByUserId: userId,
      },
    });
    templateId = template.id;
  });

  afterAll(async () => {
    if (expenseId) {
      await prisma.expense.deleteMany({ where: { id: expenseId } });
    }
    if (templateId) {
      await prisma.expenseTemplate.deleteMany({ where: { id: templateId } });
    }
    if (sourceCategoryId || alternateCategoryId) {
      await prisma.category.deleteMany({ where: { id: { in: [sourceCategoryId, alternateCategoryId].filter(Boolean) } } });
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (householdId) {
      await prisma.household.deleteMany({ where: { id: householdId } });
    }
    await prisma.$disconnect();
  });

  it('archives category without replacement and keeps existing links untouched', async () => {
    const response = await request(app)
      .post(`/api/categories/${sourceCategoryId}/archive`)
      .set('x-fairsplit-user-id', userId)
      .send({});

    expect(response.status).toBe(204);

    const archivedCategory = await prisma.category.findUniqueOrThrow({ where: { id: sourceCategoryId } });
    expect(archivedCategory.archivedAt).not.toBeNull();

    const expense = await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } });
    expect(expense.categoryId).toBe(sourceCategoryId);

    const template = await prisma.expenseTemplate.findUniqueOrThrow({ where: { id: templateId } });
    expect(template.categoryId).toBe(sourceCategoryId);

    const createExpenseResponse = await request(app)
      .post('/api/expenses')
      .set('x-fairsplit-user-id', userId)
      .send({
        month: '2099-08',
        date: '2099-08-11',
        description: 'Must fail on archived category',
        categoryId: sourceCategoryId,
        amount: 10,
        paidByUserId: userId,
      });
    expect(createExpenseResponse.status).toBe(400);
    expect(createExpenseResponse.body.error).toContain('active');
  });

  it('unarchives a previously archived category', async () => {
    const response = await request(app)
      .post(`/api/categories/${sourceCategoryId}/unarchive`)
      .set('x-fairsplit-user-id', userId)
      .send({});

    expect(response.status).toBe(204);

    const category = await prisma.category.findUniqueOrThrow({ where: { id: sourceCategoryId } });
    expect(category.archivedAt).toBeNull();
  });
});
