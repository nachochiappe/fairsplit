import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';

const app = createApp();
const month = '2099-12';
let userAId = '';
let userBId = '';
let categoryHousingId = '';
let categoryFoodId = '';

describe('GET /api/settlement', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const userA = await prisma.user.create({
      data: { name: `Integration A ${suffix}` },
    });
    userAId = userA.id;

    const userB = await prisma.user.create({
      data: { name: `Integration B ${suffix}` },
    });
    userBId = userB.id;
    const housing = await prisma.category.create({ data: { name: `Housing ${suffix}` } });
    const food = await prisma.category.create({ data: { name: `Food ${suffix}` } });
    categoryHousingId = housing.id;
    categoryFoodId = food.id;

    await prisma.monthlyIncome.createMany({
      data: [
        {
          month,
          userId: userA.id,
          description: 'Salary',
          amount: '6000.00',
          amountOriginal: '6000.00',
          currencyCode: 'ARS',
          fxRateUsed: '1.000000',
        },
        {
          month,
          userId: userB.id,
          description: 'Salary',
          amount: '3000.00',
          amountOriginal: '3000.00',
          currencyCode: 'ARS',
          fxRateUsed: '1.000000',
        },
      ],
    });

    await prisma.expense.createMany({
      data: [
        {
          month,
          date: new Date('2026-02-05T12:00:00.000Z'),
          description: 'Rent',
          categoryId: categoryHousingId,
          amountOriginal: '2400.00',
          amountArs: '2400.00',
          currencyCode: 'ARS',
          fxRateUsed: '1.000000',
          paidByUserId: userA.id,
        },
        {
          month,
          date: new Date('2026-02-10T12:00:00.000Z'),
          description: 'Groceries',
          categoryId: categoryFoodId,
          amountOriginal: '900.00',
          amountArs: '900.00',
          currencyCode: 'ARS',
          fxRateUsed: '1.000000',
          paidByUserId: userB.id,
        },
      ],
    });
  });

  afterAll(async () => {
    if (userAId || userBId) {
      const userIds = [userAId, userBId].filter(Boolean);
      await prisma.expense.deleteMany({ where: { paidByUserId: { in: userIds } } });
      await prisma.expenseTemplate.deleteMany({ where: { paidByUserId: { in: userIds } } });
      await prisma.monthlyIncome.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    const categoryIds = [categoryHousingId, categoryFoodId].filter(Boolean);
    if (categoryIds.length > 0) {
      await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    }
    await prisma.$disconnect();
  });

  it('returns settlement breakdown and transfer', async () => {
    const response = await request(app).get('/api/settlement').query({ month });

    expect(response.status).toBe(200);
    expect(response.body.month).toBe(month);
    expect(response.body.totalIncome).toBe('9000.00');
    expect(response.body.totalExpenses).toBe('3300.00');
    expect(response.body.fairShareByUser[userAId]).toBe('2200.00');
    expect(response.body.fairShareByUser[userBId]).toBe('1100.00');
    expect(response.body.differenceByUser[userAId]).toBe('200.00');
    expect(response.body.differenceByUser[userBId]).toBe('-200.00');
    expect(response.body.transfer).toEqual({
      fromUserId: userBId,
      toUserId: userAId,
      amount: '200.00',
    });
  });
});
