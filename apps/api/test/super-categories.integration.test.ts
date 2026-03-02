import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();

let categoryId = '';
let systemSuperCategoryId = '';
let customSuperCategoryAId = '';
let customSuperCategoryBId = '';
let householdId = '';
let userId = '';
let sessionToken = '';

describe('Super categories API', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const household = await prisma.household.create({
      data: { name: `SuperCat HH ${suffix}` },
    });
    householdId = household.id;

    const user = await prisma.user.create({
      data: {
        name: `SuperCat User ${suffix}`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    userId = user.id;
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
        householdId,
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
        householdId,
        color: '#0ea5e9',
        sortOrder: 820,
        isSystem: false,
      },
    });
    customSuperCategoryBId = customB.id;

    const category = await prisma.category.create({
      data: {
        name: `Mapped Category ${suffix}`,
        householdId,
        superCategoryId: customSuperCategoryAId,
      },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }

    const superCategoryIds = [systemSuperCategoryId, customSuperCategoryAId, customSuperCategoryBId].filter(Boolean);
    if (superCategoryIds.length > 0) {
      await prisma.superCategory.deleteMany({ where: { id: { in: superCategoryIds } } });
    }
    if (householdId) {
      await prisma.household.deleteMany({ where: { id: householdId } });
    }

    await prisma.$disconnect();
  });

  it('assigns and unassigns a category super category', async () => {
    const assignResponse = await request(app)
      .put(`/api/categories/${categoryId}/super-category`)
      .set('x-fairsplit-session', sessionToken)
      .send({
      superCategoryId: customSuperCategoryBId,
    });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.superCategoryId).toBe(customSuperCategoryBId);

    const unassignResponse = await request(app)
      .put(`/api/categories/${categoryId}/super-category`)
      .set('x-fairsplit-session', sessionToken)
      .send({
      superCategoryId: null,
    });

    expect(unassignResponse.status).toBe(200);
    expect(unassignResponse.body.superCategoryId).toBeNull();
  });

  it('blocks archiving system super categories', async () => {
    const response = await request(app)
      .post(`/api/super-categories/${systemSuperCategoryId}/archive`)
      .set('x-fairsplit-session', sessionToken)
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('not found');
  });

  it('archives custom super categories and reassigns categories', async () => {
    await prisma.category.update({
      where: { id: categoryId },
      data: { superCategoryId: customSuperCategoryAId },
    });

    const response = await request(app)
      .post(`/api/super-categories/${customSuperCategoryAId}/archive`)
      .set('x-fairsplit-session', sessionToken)
      .send({ replacementSuperCategoryId: customSuperCategoryBId });

    expect(response.status).toBe(204);

    const category = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
    expect(category.superCategoryId).toBe(customSuperCategoryBId);

    const archived = await prisma.superCategory.findUniqueOrThrow({ where: { id: customSuperCategoryAId } });
    expect(archived.archivedAt).not.toBeNull();
  });
});
