import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';

const app = createApp();
const monthA = '2099-04';
const monthB = '2099-05';
const monthC = '2099-06';
let testUserId = '';
let testCategoryId = '';

describe('installment expenses', () => {
  beforeAll(async () => {
    const created = await prisma.user.create({
      data: { name: `Installment Test ${Date.now().toString(36)}` },
    });
    testUserId = created.id;
    const category = await prisma.category.create({
      data: { name: `Tech ${Date.now().toString(36)}` },
    });
    testCategoryId = category.id;
  });

  beforeEach(async () => {
    if (!testUserId) {
      return;
    }

    await prisma.expense.deleteMany({
      where: { paidByUserId: testUserId },
    });
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.expense.deleteMany({ where: { paidByUserId: testUserId } });
      await prisma.expenseTemplate.deleteMany({ where: { paidByUserId: testUserId } });
      await prisma.monthlyIncome.deleteMany({ where: { userId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } });
    }
    if (testCategoryId) {
      await prisma.category.delete({ where: { id: testCategoryId } });
    }
    await prisma.$disconnect();
  });

  it('creates installment rows and lazily generates upcoming months', async () => {
    const createResponse = await request(app).post('/api/expenses').send({
      month: monthA,
      date: `${monthA}-10`,
      description: 'Laptop',
      categoryId: testCategoryId,
      paidByUserId: testUserId,
      installment: {
        enabled: true,
        count: 3,
        entryMode: 'total',
        totalAmount: 100,
      },
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.amountOriginal).toBe('33.33');
    const createdSeriesId = createResponse.body.installment.seriesId as string;
    expect(createResponse.body.installment).toEqual(
      expect.objectContaining({
        number: 1,
        total: 3,
      }),
    );

    const mayResponse = await request(app).get('/api/expenses').query({ month: monthB });
    expect(mayResponse.status).toBe(200);
    const maySeriesExpense = mayResponse.body.expenses.find(
      (expense: { installment: { seriesId: string } | null }) => expense.installment?.seriesId === createdSeriesId,
    );
    expect(maySeriesExpense).toBeTruthy();
    expect(maySeriesExpense.amountOriginal).toBe('33.33');
    expect(maySeriesExpense.installment.number).toBe(2);

    const mayResponseRepeat = await request(app).get('/api/expenses').query({ month: monthB });
    expect(mayResponseRepeat.status).toBe(200);
    const repeatSeriesMatches = mayResponseRepeat.body.expenses.filter(
      (expense: { installment: { seriesId: string } | null }) => expense.installment?.seriesId === createdSeriesId,
    );
    expect(repeatSeriesMatches).toHaveLength(1);

    const juneResponse = await request(app).get('/api/expenses').query({ month: monthC });
    expect(juneResponse.status).toBe(200);
    const juneSeriesExpense = juneResponse.body.expenses.find(
      (expense: { installment: { seriesId: string } | null }) => expense.installment?.seriesId === createdSeriesId,
    );
    expect(juneSeriesExpense).toBeTruthy();
    expect(juneSeriesExpense.amountOriginal).toBe('33.34');
    expect(juneSeriesExpense.installment.number).toBe(3);
  });

  it('applies update and delete scope to future installments', async () => {
    const createResponse = await request(app).post('/api/expenses').send({
      month: monthA,
      date: `${monthA}-10`,
      description: 'Phone',
      categoryId: testCategoryId,
      paidByUserId: testUserId,
      installment: {
        enabled: true,
        count: 3,
        entryMode: 'perInstallment',
        perInstallmentAmount: 25,
      },
    });
    const createdId = createResponse.body.id as string;
    const createdSeriesId = createResponse.body.installment.seriesId as string;

    await request(app).get('/api/expenses').query({ month: monthB });
    await request(app).get('/api/expenses').query({ month: monthC });

    const updateResponse = await request(app).put(`/api/expenses/${createdId}`).send({
      description: 'Phone Updated',
      installment: {
        enabled: true,
        count: 3,
        entryMode: 'perInstallment',
        perInstallmentAmount: 30,
      },
      applyScope: 'future',
    });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.amountOriginal).toBe('30.00');

    const mayAfterUpdate = await request(app).get('/api/expenses').query({ month: monthB });
    const mayUpdated = mayAfterUpdate.body.expenses.find(
      (expense: { installment: { seriesId: string } | null }) => expense.installment?.seriesId === createdSeriesId,
    );
    expect(mayUpdated.description).toBe('Phone Updated');
    expect(mayUpdated.amountOriginal).toBe('30.00');

    const deleteResponse = await request(app).delete(`/api/expenses/${createdId}`).send({ applyScope: 'future' });
    expect(deleteResponse.status).toBe(204);

    const aprilAfterDelete = await request(app).get('/api/expenses').query({ month: monthA });
    expect(
      aprilAfterDelete.body.expenses.filter(
        (expense: { installment: { seriesId: string } | null }) => expense.installment?.seriesId === createdSeriesId,
      ),
    ).toHaveLength(0);
    const mayAfterDelete = await request(app).get('/api/expenses').query({ month: monthB });
    expect(
      mayAfterDelete.body.expenses.filter(
        (expense: { installment: { seriesId: string } | null }) => expense.installment?.seriesId === createdSeriesId,
      ),
    ).toHaveLength(0);
    const juneAfterDelete = await request(app).get('/api/expenses').query({ month: monthC });
    expect(
      juneAfterDelete.body.expenses.filter(
        (expense: { installment: { seriesId: string } | null }) => expense.installment?.seriesId === createdSeriesId,
      ),
    ).toHaveLength(0);
  });
});
