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

  it('deletes recurring expense only for the selected month', async () => {
    const createResponse = await request(app).post('/api/expenses').send({
      month: monthB,
      date: `${monthB}-10`,
      description: 'Internet bill',
      categoryId: testCategoryId,
      amount: 50,
      paidByUserId: testUserId,
      fixed: { enabled: true },
    });

    expect(createResponse.status).toBe(201);
    const templateId = createResponse.body.fixed.templateId as string;
    expect(templateId).toBeTruthy();

    const monthBBeforeDelete = await request(app).get('/api/expenses').query({ month: monthB });
    expect(monthBBeforeDelete.status).toBe(200);
    const monthBFixedExpense = monthBBeforeDelete.body.expenses.find(
      (expense: { fixed: { templateId: string | null } }) => expense.fixed.templateId === templateId,
    );
    expect(monthBFixedExpense).toBeTruthy();

    const deleteResponse = await request(app)
      .delete(`/api/expenses/${monthBFixedExpense.id}`)
      .send({ applyScope: 'single' });
    expect(deleteResponse.status).toBe(204);

    const monthBAfterDelete = await request(app).get('/api/expenses').query({ month: monthB });
    expect(monthBAfterDelete.status).toBe(200);
    const monthBRecurringRows = monthBAfterDelete.body.expenses.filter(
      (expense: { fixed: { templateId: string | null } }) => expense.fixed.templateId === templateId,
    );
    expect(monthBRecurringRows).toHaveLength(0);

    const monthCAfterDelete = await request(app).get('/api/expenses').query({ month: monthC });
    expect(monthCAfterDelete.status).toBe(200);
    const monthCRecurringRow = monthCAfterDelete.body.expenses.find(
      (expense: { fixed: { templateId: string | null } }) => expense.fixed.templateId === templateId,
    );
    expect(monthCRecurringRow).toBeTruthy();
    expect(monthCRecurringRow.date).toBe(`${monthC}-10`);
  });
});
