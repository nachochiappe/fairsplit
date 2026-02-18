import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';

const app = createApp();
const month = '2099-11';
let userId = '';
let categoryId = '';

describe('PUT /api/incomes', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const created = await prisma.user.create({
      data: { name: `Income Test ${suffix}` },
    });
    userId = created.id;

    const category = await prisma.category.create({
      data: { name: `Income FX ${suffix}` },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    if (userId) {
      await prisma.expense.deleteMany({ where: { paidByUserId: userId } });
      await prisma.monthlyIncome.deleteMany({ where: { userId } });
      await prisma.monthlyExchangeRate.deleteMany({ where: { month } });
      await prisma.user.delete({ where: { id: userId } });
    }
    if (categoryId) {
      await prisma.category.delete({ where: { id: categoryId } });
    }
    await prisma.$disconnect();
  });

  it('supports multiple income entries per user/month and replaces previous values', async () => {
    const createManyResponse = await request(app).put('/api/incomes').send({
      month,
      userId,
      entries: [
        { description: 'Sueldo', amount: 1000 },
        { description: 'Monotributo', amount: 250.5 },
      ],
    });

    expect(createManyResponse.status).toBe(200);
    expect(createManyResponse.body).toHaveLength(2);

    const firstRead = await request(app).get('/api/incomes').query({ month });
    expect(firstRead.status).toBe(200);

    const firstUserEntries = firstRead.body
      .filter((entry: { userId: string }) => entry.userId === userId)
      .map((entry: { amount: string; description: string }) => `${entry.description}:${entry.amount}`)
      .sort();

    expect(firstUserEntries).toEqual(['Monotributo:250.50', 'Sueldo:1000.00']);

    const replaceResponse = await request(app).put('/api/incomes').send({
      month,
      userId,
      entries: [{ description: 'Sueldo', amount: 500 }],
    });

    expect(replaceResponse.status).toBe(200);
    expect(replaceResponse.body).toHaveLength(1);

    const secondRead = await request(app).get('/api/incomes').query({ month });
    expect(secondRead.status).toBe(200);

    const secondUserEntries = secondRead.body
      .filter((entry: { userId: string }) => entry.userId === userId)
      .map((entry: { amount: string; description: string }) => `${entry.description}:${entry.amount}`);

    expect(secondUserEntries).toEqual(['Sueldo:500.00']);
  });

  it('uses existing month-start FX for incomes when available', async () => {
    await prisma.monthlyExchangeRate.upsert({
      where: {
        month_currencyCode: {
          month,
          currencyCode: 'USD',
        },
      },
      update: { rateToArs: '1000.000000' },
      create: { month, currencyCode: 'USD', rateToArs: '1000.000000' },
    });

    const response = await request(app).put('/api/incomes').send({
      month,
      userId,
      entries: [{ description: 'USD salary', amount: 10, currencyCode: 'USD', fxRate: 2000 }],
    });

    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      amountOriginal: '10.00',
      amountArs: '10000.00',
      currencyCode: 'USD',
      fxRateUsed: '1000.000000',
    });

    const persistedRate = await prisma.monthlyExchangeRate.findUniqueOrThrow({
      where: {
        month_currencyCode: {
          month,
          currencyCode: 'USD',
        },
      },
    });
    expect(persistedRate.rateToArs.toFixed(6)).toBe('1000.000000');
  });

  it('persists missing month-start FX from incomes and expenses reuse it', async () => {
    await prisma.monthlyExchangeRate.deleteMany({
      where: {
        month,
        currencyCode: 'EUR',
      },
    });

    const incomeResponse = await request(app).put('/api/incomes').send({
      month,
      userId,
      entries: [{ description: 'EUR consulting', amount: 5, currencyCode: 'EUR', fxRate: 1200 }],
    });

    expect(incomeResponse.status).toBe(200);
    expect(incomeResponse.body[0]).toMatchObject({
      amountOriginal: '5.00',
      amountArs: '6000.00',
      currencyCode: 'EUR',
      fxRateUsed: '1200.000000',
    });

    const createdRate = await prisma.monthlyExchangeRate.findUniqueOrThrow({
      where: {
        month_currencyCode: {
          month,
          currencyCode: 'EUR',
        },
      },
    });
    expect(createdRate.rateToArs.toFixed(6)).toBe('1200.000000');

    const expenseResponse = await request(app).post('/api/expenses').send({
      month,
      date: `${month}-05`,
      description: 'Software subscription',
      categoryId,
      amount: 3,
      currencyCode: 'EUR',
      paidByUserId: userId,
    });

    expect(expenseResponse.status).toBe(201);
    expect(expenseResponse.body.fxRateUsed).toBe('1200.000000');
    expect(expenseResponse.body.amountArs).toBe('3600.00');
  });

  it('uses existing month-start FX for USD expenses even when an explicit fxRate is provided', async () => {
    await prisma.monthlyExchangeRate.upsert({
      where: {
        month_currencyCode: {
          month,
          currencyCode: 'USD',
        },
      },
      update: { rateToArs: '1100.000000' },
      create: { month, currencyCode: 'USD', rateToArs: '1100.000000' },
    });

    const expenseResponse = await request(app).post('/api/expenses').send({
      month,
      date: `${month}-10`,
      description: 'USD service',
      categoryId,
      amount: 2,
      currencyCode: 'USD',
      fxRate: 9999,
      paidByUserId: userId,
    });

    expect(expenseResponse.status).toBe(201);
    expect(expenseResponse.body.fxRateUsed).toBe('1100.000000');
    expect(expenseResponse.body.amountArs).toBe('2200.00');
  });
});
