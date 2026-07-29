import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';
import { clearUserContextCache } from '../src/lib/user-context-cache';

const app = createApp();
const suffix = Date.now().toString(36);
let householdId = '';
let userId = '';
let laptopToken = '';
let phoneToken = '';

const setupStatus = (token: string) =>
  request(app).get('/api/household/setup-status').set('x-fairsplit-session', token);

describe('logout', () => {
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
  });

  beforeEach(async () => {
    // Two independent sign-ins, as if from two devices. Resetting the rows
    // directly bypasses the routes that would invalidate the request cache, so
    // clear it here too.
    await prisma.user.update({ where: { id: userId }, data: { sessionRevokedAt: null } });
    await prisma.revokedSession.deleteMany({ where: { userId } });
    clearUserContextCache();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    laptopToken = issueSessionToken(user, process.env.FAIRSPLIT_SESSION_SECRET!);
    phoneToken = issueSessionToken(user, process.env.FAIRSPLIT_SESSION_SECRET!);
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

  it('issues a distinct session id per sign-in', () => {
    const sid = (token: string) =>
      JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')).sid as string;
    expect(sid(laptopToken)).toEqual(expect.any(String));
    expect(sid(laptopToken)).not.toBe(sid(phoneToken));
  });

  describe('POST /api/auth/logout', () => {
    it('signs out the calling session and leaves other devices signed in', async () => {
      expect((await setupStatus(laptopToken)).status).toBe(200);
      expect((await setupStatus(phoneToken)).status).toBe(200);

      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('x-fairsplit-session', laptopToken)
        .send({});
      expect(logoutResponse.status).toBe(204);

      const afterLogout = await setupStatus(laptopToken);
      expect(afterLogout.status).toBe(401);
      expect(afterLogout.body.error).toBe('Invalid authentication context.');

      expect((await setupStatus(phoneToken)).status).toBe(200);
    });

    it('is idempotent when the same session logs out twice', async () => {
      expect((await request(app).post('/api/auth/logout').set('x-fairsplit-session', laptopToken).send({})).status).toBe(
        204,
      );
      // The second call is rejected because the session is already gone, and no
      // duplicate revocation row is left behind.
      expect((await request(app).post('/api/auth/logout').set('x-fairsplit-session', laptopToken).send({})).status).toBe(
        401,
      );
      expect(await prisma.revokedSession.count({ where: { userId } })).toBe(1);
    });

    it('prunes revocation rows whose tokens have expired anyway', async () => {
      await prisma.revokedSession.create({
        data: {
          userId,
          sessionId: `lapsed-${suffix}`,
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      await request(app).post('/api/auth/logout').set('x-fairsplit-session', laptopToken).send({});

      const remaining = await prisma.revokedSession.findMany({ where: { userId }, select: { sessionId: true } });
      expect(remaining.map((row) => row.sessionId)).not.toContain(`lapsed-${suffix}`);
    });
  });

  describe('POST /api/auth/logout-all', () => {
    it('signs out every device', async () => {
      const logoutResponse = await request(app)
        .post('/api/auth/logout-all')
        .set('x-fairsplit-session', laptopToken)
        .send({});
      expect(logoutResponse.status).toBe(204);

      expect((await setupStatus(laptopToken)).status).toBe(401);
      expect((await setupStatus(phoneToken)).status).toBe(401);
    });

    it('leaves a session issued afterwards usable', async () => {
      await request(app).post('/api/auth/logout-all').set('x-fairsplit-session', laptopToken).send({});

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const freshToken = issueSessionToken(user, process.env.FAIRSPLIT_SESSION_SECRET!);
      expect((await setupStatus(freshToken)).status).toBe(200);
    });
  });
});
