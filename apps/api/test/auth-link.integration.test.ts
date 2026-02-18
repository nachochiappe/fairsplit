import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';

const app = createApp();
const suffix = Date.now().toString(36);
const householdId = `hh-auth-link-${suffix}`;
let candidateUserId = '';
let claimedUserId = '';
let createdUserId = '';
let createdHouseholdId = '';

describe('POST /api/auth/link', () => {
  beforeAll(async () => {
    await prisma.household.create({
      data: {
        id: householdId,
        name: `Auth Link Household ${suffix}`,
      },
    });

    const candidate = await prisma.user.create({
      data: {
        name: `Nacho ${suffix}`,
        email: `nacho.${suffix}@example.com`,
        householdId,
      },
    });
    candidateUserId = candidate.id;
  });

  afterAll(async () => {
    if (createdUserId) {
      await prisma.user.deleteMany({ where: { id: createdUserId } });
    }
    if (claimedUserId) {
      await prisma.user.deleteMany({ where: { id: claimedUserId } });
    }
    if (candidateUserId && claimedUserId !== candidateUserId) {
      await prisma.user.deleteMany({ where: { id: candidateUserId } });
    }
    if (createdHouseholdId) {
      await prisma.household.deleteMany({ where: { id: createdHouseholdId } });
    }
    await prisma.household.deleteMany({ where: { id: householdId } });
    await prisma.$disconnect();
  });

  it('claims an existing email-matched user and preserves the historical user id', async () => {
    const authUserId = `supabase-user-${suffix}`;
    const response = await request(app).post('/api/auth/link').send({
      authUserId,
      email: `nacho.${suffix}@example.com`,
    });

    expect(response.status).toBe(200);
    expect(response.body.created).toBe(false);
    expect(response.body.user.id).toBe(candidateUserId);
    expect(response.body.user.authUserId).toBe(authUserId);

    claimedUserId = response.body.user.id;

    const persisted = await prisma.user.findUniqueOrThrow({ where: { id: candidateUserId } });
    expect(persisted.authUserId).toBe(authUserId);
  });

  it('creates a new household + participant when no email mapping exists', async () => {
    const authUserId = `supabase-new-user-${suffix}`;
    const response = await request(app).post('/api/auth/link').send({
      authUserId,
      email: `brand.new.${suffix}@example.com`,
      name: 'Brand New',
    });

    expect(response.status).toBe(201);
    expect(response.body.created).toBe(true);
    expect(response.body.user.authUserId).toBe(authUserId);
    expect(response.body.household).toBeTruthy();

    createdUserId = response.body.user.id;
    createdHouseholdId = response.body.household.id;

    const createdUser = await prisma.user.findUniqueOrThrow({ where: { id: createdUserId } });
    expect(createdUser.householdId).toBe(createdHouseholdId);
    expect(createdUser.email).toBe(`brand.new.${suffix}@example.com`);
  });
});
