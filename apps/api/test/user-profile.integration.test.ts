import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();

let householdId = '';
let userId = '';
let partnerUserId = '';
let sessionToken = '';

describe('User profile API', () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const household = await prisma.household.create({
      data: { name: `Profile HH ${suffix}` },
    });
    householdId = household.id;

    const user = await prisma.user.create({
      data: {
        name: `Profile User ${suffix}`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    userId = user.id;

    const partner = await prisma.user.create({
      data: {
        name: `Profile Partner ${suffix}`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    partnerUserId = partner.id;

    sessionToken = issueSessionToken(
      {
        id: user.id,
        householdId: user.householdId,
        email: null,
        authUserId: user.authUserId,
        onboardingHouseholdDecisionAt: user.onboardingHouseholdDecisionAt,
      },
      process.env.FAIRSPLIT_SESSION_SECRET!,
    );
  });

  afterAll(async () => {
    if (userId || partnerUserId) {
      await prisma.user.deleteMany({
        where: { id: { in: [userId, partnerUserId].filter(Boolean) } },
      });
    }
    if (householdId) {
      await prisma.household.deleteMany({ where: { id: householdId } });
    }

    await prisma.$disconnect();
  });

  it('defaults new users to the English locale', async () => {
    const response = await request(app)
      .get(`/api/users/${userId}`)
      .set('x-fairsplit-session', sessionToken);

    expect(response.status).toBe(200);
    expect(response.body.locale).toBe('en');
  });

  it('updates the locale without touching the display name', async () => {
    const response = await request(app)
      .patch(`/api/users/${userId}`)
      .set('x-fairsplit-session', sessionToken)
      .send({ locale: 'es' });

    expect(response.status).toBe(200);
    expect(response.body.locale).toBe('es');

    const persisted = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(persisted.locale).toBe('es');
    expect(persisted.name).toContain('Profile User');
  });

  it('updates the display name without resetting the locale', async () => {
    const response = await request(app)
      .patch(`/api/users/${userId}`)
      .set('x-fairsplit-session', sessionToken)
      .send({ name: 'Renamed Profile User' });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Renamed Profile User');
    expect(response.body.locale).toBe('es');
  });

  it('rejects an empty profile update', async () => {
    const response = await request(app)
      .patch(`/api/users/${userId}`)
      .set('x-fairsplit-session', sessionToken)
      .send({});

    expect(response.status).toBe(400);
  });

  it('rejects an unsupported locale', async () => {
    const response = await request(app)
      .patch(`/api/users/${userId}`)
      .set('x-fairsplit-session', sessionToken)
      .send({ locale: 'fr' });

    expect(response.status).toBe(400);
  });

  it('refuses to update another household member profile', async () => {
    const response = await request(app)
      .patch(`/api/users/${partnerUserId}`)
      .set('x-fairsplit-session', sessionToken)
      .send({ locale: 'es' });

    expect(response.status).toBe(403);
  });

  it('exposes locale for every household member in the list', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('x-fairsplit-session', sessionToken);

    expect(response.status).toBe(200);
    const listed = (response.body as Array<{ id: string; locale: string }>).filter((entry) =>
      [userId, partnerUserId].includes(entry.id),
    );
    expect(listed).toHaveLength(2);
    expect(listed.every((entry) => typeof entry.locale === 'string')).toBe(true);
  });
});
