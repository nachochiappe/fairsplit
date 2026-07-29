import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';

/**
 * Both endpoints here were unreachable for five months. `User.householdId` was
 * made NOT NULL by a hand-run script, so a user could not exist before having a
 * household; the link endpoint compensated by creating one inline, which meant
 * every caller tripped the "setup has already been completed" guard on the way
 * in. Invite codes could not be redeemed at all. These tests pin the
 * pre-onboarding state that makes the flow work.
 */
const app = createApp();

const suffix = Date.now().toString(36);
let inviterHouseholdId = '';
let inviterUserId = '';
let seq = 0;
const createdUserIds: string[] = [];
const createdHouseholdIds: string[] = [];

function sessionFor(user: {
  id: string;
  householdId: string | null;
  onboardingHouseholdDecisionAt: Date | null;
}): string {
  return issueSessionToken(user, process.env.FAIRSPLIT_SESSION_SECRET!);
}

/** A user mid-onboarding: authenticated, but yet to choose a household. */
async function createPendingUser(label: string) {
  seq += 1;
  const user = await prisma.user.create({
    data: {
      name: `${label} ${suffix}`,
      email: `${label}.${seq}.${suffix}@example.com`.toLowerCase(),
      authUserId: `auth-${label}-${suffix}-${seq}`,
      householdId: null,
      onboardingHouseholdDecisionAt: null,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createInvite(options: { expiresAt?: Date; isRevoked?: boolean } = {}) {
  seq += 1;
  return prisma.householdInvite.create({
    data: {
      code: `TST${seq}${suffix.toUpperCase()}`.replace(/[^A-Z0-9]/g, '').slice(0, 8),
      householdId: inviterHouseholdId,
      createdByUserId: inviterUserId,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      isRevoked: options.isRevoked ?? false,
    },
  });
}

describe('Household onboarding', () => {
  beforeEach(async () => {
    seq += 1;
    const household = await prisma.household.create({
      data: { name: `Inviter HH ${suffix}` },
    });
    inviterHouseholdId = household.id;
    createdHouseholdIds.push(household.id);

    const inviter = await prisma.user.create({
      data: {
        name: `Inviter ${suffix}`,
        authUserId: `auth-inviter-${suffix}-${seq}`,
        householdId: household.id,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    inviterUserId = inviter.id;
    createdUserIds.push(inviter.id);
  });

  // Order matters. Every householdId here is NOT NULL behind an ON DELETE SET NULL
  // foreign key, so deleting a household that still owns rows raises a not-null
  // violation instead of cascading.
  afterAll(async () => {
    const where = { householdId: { in: createdHouseholdIds } };
    await prisma.householdInvite.deleteMany({ where });
    await prisma.expense.deleteMany({ where });
    await prisma.monthlyIncome.deleteMany({ where });
    await prisma.expenseTemplate.deleteMany({ where });
    await prisma.monthlyExchangeRate.deleteMany({ where });
    await prisma.category.deleteMany({ where });
    await prisma.superCategory.deleteMany({ where });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
    await prisma.$disconnect();
  });

  describe('POST /api/household/join-with-code', () => {
    it('puts a pending user into the inviting household and consumes the code', async () => {
      const invite = await createInvite();
      const joiner = await createPendingUser('joiner');

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(joiner))
        .send({ code: invite.code });

      expect(response.status).toBe(200);
      expect(response.body.user.householdId).toBe(inviterHouseholdId);
      expect(response.body.household.id).toBe(inviterHouseholdId);
      expect(response.body.needsHouseholdSetup).toBe(false);

      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: joiner.id } });
      expect(persisted.householdId).toBe(inviterHouseholdId);
      expect(persisted.onboardingHouseholdDecisionAt).not.toBeNull();

      const consumed = await prisma.householdInvite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(consumed.consumedAt).not.toBeNull();
      expect(consumed.consumedByUserId).toBe(joiner.id);
    });

    it('accepts a lowercase, punctuated code', async () => {
      const invite = await createInvite();
      const joiner = await createPendingUser('sloppy');

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(joiner))
        .send({ code: ` ${invite.code.toLowerCase().slice(0, 4)}-${invite.code.toLowerCase().slice(4)} ` });

      expect(response.status).toBe(200);
      expect(response.body.user.householdId).toBe(inviterHouseholdId);
    });

    it('refuses a code for the household the caller is already in', async () => {
      const invite = await createInvite();
      const settled = await prisma.user.create({
        data: {
          name: `Settled ${suffix}`,
          authUserId: `auth-settled-${suffix}`,
          householdId: inviterHouseholdId,
          onboardingHouseholdDecisionAt: new Date(),
        },
      });
      createdUserIds.push(settled.id);

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(settled))
        .send({ code: invite.code });

      expect(response.status).toBe(409);

      const untouched = await prisma.householdInvite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(untouched.consumedAt).toBeNull();
    });

    it('reports an unknown code as not found', async () => {
      const joiner = await createPendingUser('unknown-code');

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(joiner))
        .send({ code: 'ZZZZZZZZ' });

      expect(response.status).toBe(404);
      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: joiner.id } });
      expect(persisted.householdId).toBeNull();
    });

    it('rejects an expired code and leaves the user pending', async () => {
      const invite = await createInvite({ expiresAt: new Date(Date.now() - 1000) });
      const joiner = await createPendingUser('expired');

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(joiner))
        .send({ code: invite.code });

      expect(response.status).toBe(410);
      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: joiner.id } });
      expect(persisted.householdId).toBeNull();
      expect(persisted.onboardingHouseholdDecisionAt).toBeNull();
    });

    it('rejects a revoked code', async () => {
      const invite = await createInvite({ isRevoked: true });
      const joiner = await createPendingUser('revoked');

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(joiner))
        .send({ code: invite.code });

      expect(response.status).toBe(410);
    });
  });

  /**
   * Both partners signing up separately, before either thought to send a code, is
   * the ordinary way a couple arrives here. Refusing that made invite codes
   * usable only in the window before the second person's first sign-in.
   */
  describe('joining from a household of one', () => {
    async function createSoloUser(label: string) {
      seq += 1;
      const household = await prisma.household.create({ data: { name: `${label} HH ${suffix}` } });
      createdHouseholdIds.push(household.id);
      const user = await prisma.user.create({
        data: {
          name: `${label} ${suffix}`,
          authUserId: `auth-${label}-${suffix}-${seq}`,
          householdId: household.id,
          onboardingHouseholdDecisionAt: new Date(),
        },
      });
      createdUserIds.push(user.id);
      return { user, household };
    }

    it('moves the user across and removes the household they left', async () => {
      const invite = await createInvite();
      const { user, household } = await createSoloUser('solo-joiner');

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(user))
        .send({ code: invite.code });

      expect(response.status).toBe(200);
      expect(response.body.user.householdId).toBe(inviterHouseholdId);
      expect(await prisma.household.count({ where: { id: household.id } })).toBe(0);
    });

    it('deletes the vacated household\'s super categories rather than making them global', async () => {
      const invite = await createInvite();
      const { user, household } = await createSoloUser('solo-config');
      const own = await prisma.superCategory.create({
        data: { name: `Mine ${suffix}`, slug: `mine-${suffix}`, householdId: household.id, isSystem: false },
      });
      await prisma.category.create({
        data: { name: `Cat ${suffix}`, householdId: household.id },
      });

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(user))
        .send({ code: invite.code });

      expect(response.status).toBe(200);
      // The foreign key is ON DELETE SET NULL and the column is nullable, so
      // deleting the household without clearing this first would null the owner —
      // and a null householdId is what marks a super category global to everyone.
      expect(await prisma.superCategory.count({ where: { id: own.id } })).toBe(0);
      expect(
        await prisma.superCategory.count({ where: { householdId: null, isSystem: false } }),
      ).toBe(0);
      expect(await prisma.category.count({ where: { householdId: household.id } })).toBe(0);
    });

    it('refuses when the household has expenses, leaving everything untouched', async () => {
      const invite = await createInvite();
      const { user, household } = await createSoloUser('solo-with-data');
      const category = await prisma.category.create({
        data: { name: `Cat ${suffix}-x`, householdId: household.id },
      });
      await prisma.expense.create({
        data: {
          householdId: household.id,
          categoryId: category.id,
          paidByUserId: user.id,
          description: 'Coffee',
          month: '2026-07',
          date: new Date(),
          amountOriginal: '10.00',
          amountArs: '10.00',
        },
      });

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(user))
        .send({ code: invite.code });

      expect(response.status).toBe(409);
      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(persisted.householdId).toBe(household.id);
      expect(await prisma.household.count({ where: { id: household.id } })).toBe(1);
      const untouched = await prisma.householdInvite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(untouched.consumedAt).toBeNull();
    });

    it('refuses when someone else is in the household', async () => {
      const invite = await createInvite();
      const { user, household } = await createSoloUser('solo-with-partner');
      seq += 1;
      const partner = await prisma.user.create({
        data: {
          name: `Partner ${suffix}`,
          authUserId: `auth-partner-${suffix}-${seq}`,
          householdId: household.id,
          onboardingHouseholdDecisionAt: new Date(),
        },
      });
      createdUserIds.push(partner.id);

      const response = await request(app)
        .post('/api/household/join-with-code')
        .set('x-fairsplit-session', sessionFor(user))
        .send({ code: invite.code });

      expect(response.status).toBe(409);
      expect(await prisma.household.count({ where: { id: household.id } })).toBe(1);
    });
  });

  describe('POST /api/household/skip-setup', () => {
    it('gives a pending user a household of their own', async () => {
      const solo = await createPendingUser('solo');

      const response = await request(app)
        .post('/api/household/skip-setup')
        .set('x-fairsplit-session', sessionFor(solo))
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.household).toBeTruthy();
      expect(response.body.household.id).not.toBe(inviterHouseholdId);
      expect(response.body.needsHouseholdSetup).toBe(false);
      createdHouseholdIds.push(response.body.household.id);

      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: solo.id } });
      expect(persisted.householdId).toBe(response.body.household.id);
      expect(persisted.onboardingHouseholdDecisionAt).not.toBeNull();
    });

    it('refuses a second call once setup is settled', async () => {
      const solo = await createPendingUser('solo-twice');

      const first = await request(app)
        .post('/api/household/skip-setup')
        .set('x-fairsplit-session', sessionFor(solo))
        .send({});
      expect(first.status).toBe(200);
      createdHouseholdIds.push(first.body.household.id);

      // The stale pre-onboarding session is exactly what a real client would
      // still be holding, so the guard has to reject on stored state, not claims.
      const second = await request(app)
        .post('/api/household/skip-setup')
        .set('x-fairsplit-session', sessionFor(solo))
        .send({});

      expect(second.status).toBe(409);
      expect(await prisma.household.count({ where: { id: first.body.household.id } })).toBe(1);
    });
  });

  describe('data endpoints', () => {
    it('stay closed to a pending user until they have a household', async () => {
      const pending = await createPendingUser('gated');

      const response = await request(app)
        .get('/api/months')
        .set('x-fairsplit-session', sessionFor(pending));

      expect(response.status).toBe(403);
    });
  });
});
