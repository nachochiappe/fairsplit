import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';

const app = createApp();

let categoryId = '';
let systemSuperCategoryId = '';
let customSuperCategoryAId = '';
let customSuperCategoryBId = '';

describe('Super categories API', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);

    const systemSuper = await prisma.superCategory.create({
      data: {
        name: `System Group ${suffix}`,
        slug: `system-group-${suffix}`,
        color: '#334155',
        sortOrder: 800,
        isSystem: true,
      },
    });
    systemSuperCategoryId = systemSuper.id;

    const customA = await prisma.superCategory.create({
      data: {
        name: `Custom Group A ${suffix}`,
        slug: `custom-group-a-${suffix}`,
        color: '#10b981',
        sortOrder: 810,
        isSystem: false,
      },
    });
    customSuperCategoryAId = customA.id;

    const customB = await prisma.superCategory.create({
      data: {
        name: `Custom Group B ${suffix}`,
        slug: `custom-group-b-${suffix}`,
        color: '#0ea5e9',
        sortOrder: 820,
        isSystem: false,
      },
    });
    customSuperCategoryBId = customB.id;

    const category = await prisma.category.create({
      data: {
        name: `Mapped Category ${suffix}`,
        superCategoryId: customSuperCategoryAId,
      },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }

    const superCategoryIds = [systemSuperCategoryId, customSuperCategoryAId, customSuperCategoryBId].filter(Boolean);
    if (superCategoryIds.length > 0) {
      await prisma.superCategory.deleteMany({ where: { id: { in: superCategoryIds } } });
    }

    await prisma.$disconnect();
  });

  it('assigns and unassigns a category super category', async () => {
    const assignResponse = await request(app).put(`/api/categories/${categoryId}/super-category`).send({
      superCategoryId: customSuperCategoryBId,
    });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.superCategoryId).toBe(customSuperCategoryBId);

    const unassignResponse = await request(app).put(`/api/categories/${categoryId}/super-category`).send({
      superCategoryId: null,
    });

    expect(unassignResponse.status).toBe(200);
    expect(unassignResponse.body.superCategoryId).toBeNull();
  });

  it('blocks archiving system super categories', async () => {
    const response = await request(app)
      .post(`/api/super-categories/${systemSuperCategoryId}/archive`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('cannot be archived');
  });

  it('archives custom super categories and reassigns categories', async () => {
    await prisma.category.update({
      where: { id: categoryId },
      data: { superCategoryId: customSuperCategoryAId },
    });

    const response = await request(app)
      .post(`/api/super-categories/${customSuperCategoryAId}/archive`)
      .send({ replacementSuperCategoryId: customSuperCategoryBId });

    expect(response.status).toBe(204);

    const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
    expect(category.superCategoryId).toBe(customSuperCategoryBId);

    const archived = await prisma.superCategory.findUniqueOrThrow({ where: { id: customSuperCategoryAId } });
    expect(archived.archivedAt).not.toBeNull();
  });
});
