import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@fairsplit/db';
import { createApp } from '../src/app';
import { issueSessionToken } from '../src/lib/session';
import { SoftwareAuthenticator } from './helpers/software-authenticator';

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:3000';
process.env.FAIRSPLIT_WEBAUTHN_RP_ID = RP_ID;
process.env.FAIRSPLIT_WEBAUTHN_ORIGINS = ORIGIN;

const app = createApp();
const suffix = Date.now().toString(36);

let householdId = '';
let userId = '';
let otherUserId = '';
let sessionToken = '';
let otherSessionToken = '';

async function requestRegistrationOptions(token: string) {
  return request(app).post('/api/auth/passkeys/registration/options').set('x-fairsplit-session', token).send({});
}

async function requestAuthenticationOptions() {
  return request(app).post('/api/auth/passkeys/authentication/options').send({});
}

/** Runs a full enrolment ceremony and returns the created passkey record id. */
async function enrol(authenticator: SoftwareAuthenticator, token: string, label?: string): Promise<string> {
  const options = await requestRegistrationOptions(token);
  expect(options.status).toBe(200);

  const verified = await request(app)
    .post('/api/auth/passkeys/registration/verify')
    .set('x-fairsplit-session', token)
    .send({
      response: authenticator.createAttestationResponse(options.body.challenge, RP_ID, ORIGIN),
      ...(label ? { label } : {}),
    });
  expect(verified.status).toBe(201);
  return verified.body.id as string;
}

describe('passkey sign-in', () => {
  beforeAll(async () => {
    const household = await prisma.household.create({ data: { name: `Passkey HH ${suffix}` } });
    householdId = household.id;

    const user = await prisma.user.create({
      data: {
        name: `Passkey User ${suffix}`,
        email: `passkey.${suffix}@example.com`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    userId = user.id;
    sessionToken = issueSessionToken(user, process.env.FAIRSPLIT_SESSION_SECRET!);

    const otherUser = await prisma.user.create({
      data: {
        name: `Passkey Other ${suffix}`,
        email: `passkey.other.${suffix}@example.com`,
        householdId,
        onboardingHouseholdDecisionAt: new Date(),
      },
    });
    otherUserId = otherUser.id;
    otherSessionToken = issueSessionToken(otherUser, process.env.FAIRSPLIT_SESSION_SECRET!);
  });

  afterAll(async () => {
    await prisma.webAuthnChallenge.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    if (householdId) {
      await prisma.household.deleteMany({ where: { id: householdId } });
    }
    await prisma.$disconnect();
  });

  it('enrols a passkey and then signs in with it', async () => {
    const authenticator = new SoftwareAuthenticator();
    await enrol(authenticator, sessionToken, 'Test laptop');

    const listed = await request(app).get('/api/auth/passkeys').set('x-fairsplit-session', sessionToken);
    expect(listed.status).toBe(200);
    expect(listed.body.configured).toBe(true);
    expect(listed.body.passkeys).toHaveLength(1);
    expect(listed.body.passkeys[0].label).toBe('Test laptop');
    expect(listed.body.passkeys[0].lastUsedAt).toBeNull();

    const options = await requestAuthenticationOptions();
    expect(options.status).toBe(200);
    // Usernameless: the challenge must not enumerate the account's credentials.
    expect(options.body.allowCredentials ?? []).toEqual([]);

    const signIn = await request(app)
      .post('/api/auth/passkeys/authentication/verify')
      .send({ response: authenticator.createAssertionResponse(options.body.challenge, RP_ID, ORIGIN, userId) });
    expect(signIn.status).toBe(200);
    expect(signIn.body.user.id).toBe(userId);
    expect(signIn.body.needsHouseholdSetup).toBe(false);
    expect(typeof signIn.body.sessionToken).toBe('string');

    // The issued token has to be usable immediately.
    const authenticated = await request(app)
      .get('/api/household/setup-status')
      .set('x-fairsplit-session', signIn.body.sessionToken);
    expect(authenticated.status).toBe(200);

    const afterSignIn = await request(app).get('/api/auth/passkeys').set('x-fairsplit-session', sessionToken);
    expect(afterSignIn.body.passkeys[0].lastUsedAt).not.toBeNull();
  });

  it('issues a working session even when a logout was just recorded', async () => {
    const authenticator = new SoftwareAuthenticator();
    await enrol(authenticator, sessionToken);

    // Logout revokes sessions issued at or before `sessionRevokedAt`, which sits
    // slightly in the future. Signing straight back in must not be dead on arrival.
    const loggedOut = await request(app).post('/api/auth/logout').set('x-fairsplit-session', sessionToken).send({});
    expect(loggedOut.status).toBe(204);

    const options = await requestAuthenticationOptions();
    const signIn = await request(app)
      .post('/api/auth/passkeys/authentication/verify')
      .send({ response: authenticator.createAssertionResponse(options.body.challenge, RP_ID, ORIGIN, userId) });
    expect(signIn.status).toBe(200);

    const authenticated = await request(app)
      .get('/api/household/setup-status')
      .set('x-fairsplit-session', signIn.body.sessionToken);
    expect(authenticated.status).toBe(200);

    // Restore the session used by the rest of the suite.
    await prisma.user.update({ where: { id: userId }, data: { sessionRevokedAt: null } });
    sessionToken = signIn.body.sessionToken;
  });

  it('rejects a replayed assertion because the challenge is single-use', async () => {
    const authenticator = new SoftwareAuthenticator();
    await enrol(authenticator, sessionToken);

    const options = await requestAuthenticationOptions();
    const assertion = authenticator.createAssertionResponse(options.body.challenge, RP_ID, ORIGIN, userId);

    const first = await request(app).post('/api/auth/passkeys/authentication/verify').send({ response: assertion });
    expect(first.status).toBe(200);

    const replay = await request(app).post('/api/auth/passkeys/authentication/verify').send({ response: assertion });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('Could not sign in with this passkey.');
  });

  it('rejects an assertion whose user handle disagrees with the stored credential', async () => {
    const authenticator = new SoftwareAuthenticator();
    await enrol(authenticator, sessionToken);

    const options = await requestAuthenticationOptions();
    const signIn = await request(app)
      .post('/api/auth/passkeys/authentication/verify')
      .send({ response: authenticator.createAssertionResponse(options.body.challenge, RP_ID, ORIGIN, otherUserId) });
    expect(signIn.status).toBe(401);
  });

  it('rejects an assertion signed for a different origin', async () => {
    const authenticator = new SoftwareAuthenticator();
    await enrol(authenticator, sessionToken);

    const options = await requestAuthenticationOptions();
    const signIn = await request(app)
      .post('/api/auth/passkeys/authentication/verify')
      .send({
        response: authenticator.createAssertionResponse(options.body.challenge, RP_ID, 'https://evil.example', userId),
      });
    expect(signIn.status).toBe(401);
  });

  it('rejects an unknown credential', async () => {
    const stranger = new SoftwareAuthenticator();
    const options = await requestAuthenticationOptions();
    const signIn = await request(app)
      .post('/api/auth/passkeys/authentication/verify')
      .send({ response: stranger.createAssertionResponse(options.body.challenge, RP_ID, ORIGIN, userId) });
    expect(signIn.status).toBe(401);
  });

  it('rejects a signature counter that fails to advance', async () => {
    const authenticator = new SoftwareAuthenticator({ useSignCounter: true });
    await enrol(authenticator, sessionToken);

    const firstOptions = await requestAuthenticationOptions();
    const first = await request(app)
      .post('/api/auth/passkeys/authentication/verify')
      .send({ response: authenticator.createAssertionResponse(firstOptions.body.challenge, RP_ID, ORIGIN, userId) });
    expect(first.status).toBe(200);

    authenticator.rewindSignCounter();
    const secondOptions = await requestAuthenticationOptions();
    const cloned = await request(app)
      .post('/api/auth/passkeys/authentication/verify')
      .send({ response: authenticator.createAssertionResponse(secondOptions.body.challenge, RP_ID, ORIGIN, userId) });
    expect(cloned.status).toBe(401);
  });

  it('stops working once the passkey is removed', async () => {
    const authenticator = new SoftwareAuthenticator();
    const passkeyId = await enrol(authenticator, sessionToken);

    const removed = await request(app)
      .delete(`/api/auth/passkeys/${passkeyId}`)
      .set('x-fairsplit-session', sessionToken);
    expect(removed.status).toBe(204);

    const options = await requestAuthenticationOptions();
    const signIn = await request(app)
      .post('/api/auth/passkeys/authentication/verify')
      .send({ response: authenticator.createAssertionResponse(options.body.challenge, RP_ID, ORIGIN, userId) });
    expect(signIn.status).toBe(401);
  });

  it('does not let one household member remove another member\'s passkey', async () => {
    const authenticator = new SoftwareAuthenticator();
    const passkeyId = await enrol(authenticator, sessionToken);

    const attempt = await request(app)
      .delete(`/api/auth/passkeys/${passkeyId}`)
      .set('x-fairsplit-session', otherSessionToken);
    expect(attempt.status).toBe(404);

    const stillListed = await request(app).get('/api/auth/passkeys').set('x-fairsplit-session', sessionToken);
    expect(stillListed.body.passkeys.some((passkey: { id: string }) => passkey.id === passkeyId)).toBe(true);
  });

  it('requires a session to enrol or list passkeys', async () => {
    const optionsWithoutSession = await request(app).post('/api/auth/passkeys/registration/options').send({});
    expect(optionsWithoutSession.status).toBe(401);

    const listWithoutSession = await request(app).get('/api/auth/passkeys');
    expect(listWithoutSession.status).toBe(401);
  });

  it('refuses to enrol the same authenticator twice', async () => {
    const authenticator = new SoftwareAuthenticator();
    await enrol(authenticator, sessionToken);

    const options = await requestRegistrationOptions(sessionToken);
    // A real browser would refuse via excludeCredentials; assert the server does too.
    expect(options.body.excludeCredentials.map((entry: { id: string }) => entry.id)).toContain(
      authenticator.credentialIdBase64Url,
    );

    const duplicate = await request(app)
      .post('/api/auth/passkeys/registration/verify')
      .set('x-fairsplit-session', sessionToken)
      .send({ response: authenticator.createAttestationResponse(options.body.challenge, RP_ID, ORIGIN) });
    expect(duplicate.status).toBe(409);
  });

  it('tolerates a trailing slash in the configured origin', async () => {
    process.env.FAIRSPLIT_WEBAUTHN_ORIGINS = `${ORIGIN}/`;
    try {
      const authenticator = new SoftwareAuthenticator();
      await enrol(authenticator, sessionToken);

      const options = await requestAuthenticationOptions();
      const signIn = await request(app)
        .post('/api/auth/passkeys/authentication/verify')
        .send({ response: authenticator.createAssertionResponse(options.body.challenge, RP_ID, ORIGIN, userId) });
      expect(signIn.status).toBe(200);
    } finally {
      process.env.FAIRSPLIT_WEBAUTHN_ORIGINS = ORIGIN;
    }
  });

  it('rejects a registration bound to a challenge issued for another user', async () => {
    const authenticator = new SoftwareAuthenticator();
    const otherOptions = await requestRegistrationOptions(otherSessionToken);
    expect(otherOptions.status).toBe(200);

    const stolen = await request(app)
      .post('/api/auth/passkeys/registration/verify')
      .set('x-fairsplit-session', sessionToken)
      .send({ response: authenticator.createAttestationResponse(otherOptions.body.challenge, RP_ID, ORIGIN) });
    expect(stolen.status).toBe(400);
  });
});
