import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';

const app = createApp();
const month = '2099-07';
let testUserId = '';
let testCategoryId = '';

describe('expenses pagination', () => {
  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: `Pagination Test ${Date.now().toString(36)}` },
    });
    testUserId = user.id;

    const category = await prisma.category.create({
      data: { name: `Pagination Category ${Date.now().toString(36)}` },
    });
    testCategoryId = category.id;
  });

  beforeEach(async () => {
    if (!testUserId) {
      return;
    }

    await prisma.expense.deleteMany({
      where: { paidByUserId: testUserId, month },
    });
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.expense.deleteMany({ where: { paidByUserId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } });
    }
    if (testCategoryId) {
      await prisma.category.delete({ where: { id: testCategoryId } });
    }
    await prisma.$disconnect();
  });

  it('returns paginated expenses with next cursor metadata', async () => {
    const dates = [`${month}-01`, `${month}-02`, `${month}-03`];

    for (const [index, date] of dates.entries()) {
      const response = await request(app).post('/api/expenses').send({
        month,
        date,
        description: `Expense ${index + 1}`,
        categoryId: testCategoryId,
        amount: 100 + index,
        paidByUserId: testUserId,
      });
      expect(response.status).toBe(201);
    }

    const firstPage = await request(app).get('/api/expenses').query({
      month,
      limit: 2,
      sortBy: 'date',
      sortDir: 'asc',
    });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.expenses).toHaveLength(2);
    expect(firstPage.body.pagination).toEqual(
      expect.objectContaining({
        limit: 2,
        hasMore: true,
        totalCount: 3,
      }),
    );
    expect(firstPage.body.pagination.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app).get('/api/expenses').query({
      month,
      limit: 2,
      cursor: firstPage.body.pagination.nextCursor,
      sortBy: 'date',
      sortDir: 'asc',
    });

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.expenses).toHaveLength(1);
    expect(secondPage.body.pagination).toEqual(
      expect.objectContaining({
        limit: 2,
        hasMore: false,
        totalCount: 3,
        nextCursor: null,
      }),
    );
  });

  it('rejects cursor when limit is missing', async () => {
    const response = await request(app).get('/api/expenses').query({
      month,
      cursor: 'invalid-cursor',
    });

    expect(response.status).toBe(400);
  });
});
