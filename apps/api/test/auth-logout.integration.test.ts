import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

const app = createApp();
const suffix = Date.now().toString(36);
let householdId = '';
let userId = '';
let sessionToken = '';

describe('POST /api/auth/logout', () => {
  beforeAll(async () => {
    const household = await prisma.household.create({
      data: {
        name: `Auth Logout HH ${suffix}`,
      },
    });
    householdId = household.id;

    const user = await prisma.user.create({
      data: {
        name: `Auth Logout User ${suffix}`,
        email: `auth.logout.${suffix}@example.com`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    userId = user.id;

    sessionToken = issueSessionToken(user, process.env.FAIRSPLIT_SESSION_SECRET!);
  });

  afterAll(async () => {
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    if (householdId) {
      await prisma.household.deleteMany({ where: { id: householdId } });
    }
    await prisma.$disconnect();
  });

  it('revokes active session tokens for the user', async () => {
    const beforeLogout = await request(app)
      .get('/api/household/setup-status')
      .set('x-fairsplit-session', sessionToken);
    expect(beforeLogout.status).toBe(200);

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .set('x-fairsplit-session', sessionToken)
      .send({});
    expect(logoutResponse.status).toBe(204);

    const afterLogout = await request(app)
      .get('/api/household/setup-status')
      .set('x-fairsplit-session', sessionToken);
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.error).toBe('Invalid authentication context.');
  });
});
