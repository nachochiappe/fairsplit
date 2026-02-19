import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';

const app = createApp();
const monthA = '2099-03';
const monthB = '2099-04';
const monthC = '2099-05';
let testUserId = '';
let testCategoryId = '';

describe('fixed recurring expenses', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const created = await prisma.user.create({
      data: { name: `Fixed Test ${suffix}` },
    });
    testUserId = created.id;

    const category = await prisma.category.create({
      data: { name: `Fixed Category ${suffix}` },
    });
    testCategoryId = category.id;
  });

  beforeEach(async () => {
    if (!testUserId) {
      return;
    }
    await prisma.expense.deleteMany({ where: { paidByUserId: testUserId } });
    await prisma.expenseTemplate.deleteMany({ where: { paidByUserId: testUserId } });
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.expense.deleteMany({ where: { paidByUserId: testUserId } });
      await prisma.expenseTemplate.deleteMany({ where: { paidByUserId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } });
    }
    if (testCategoryId) {
      await prisma.category.delete({ where: { id: testCategoryId } });
    }
    await prisma.$disconnect();
  });

  it('does not backfill recurring expenses into months before the template first month', async () => {
    const createResponse = await request(app).post('/api/expenses').send({
      month: monthB,
      date: `${monthB}-15`,
      description: 'Gym membership',
      categoryId: testCategoryId,
      amount: 100,
      paidByUserId: testUserId,
      fixed: { enabled: true },
    });

    expect(createResponse.status).toBe(201);
    const templateId = createResponse.body.fixed.templateId as string;
    expect(templateId).toBeTruthy();

    const previousMonthResponse = await request(app).get('/api/expenses').query({ month: monthA });
    expect(previousMonthResponse.status).toBe(200);
    const previousMonthRecurringRows = previousMonthResponse.body.expenses.filter(
      (expense: { fixed: { templateId: string | null } }) => expense.fixed.templateId === templateId,
    );
    expect(previousMonthRecurringRows).toHaveLength(0);

    const nextMonthResponse = await request(app).get('/api/expenses').query({ month: monthC });
    expect(nextMonthResponse.status).toBe(200);
    const nextMonthRecurringRow = nextMonthResponse.body.expenses.find(
      (expense: { fixed: { templateId: string | null } }) => expense.fixed.templateId === templateId,
    );
    expect(nextMonthRecurringRow).toBeTruthy();
    expect(nextMonthRecurringRow.date).toBe(`${monthC}-15`);
  });
});
