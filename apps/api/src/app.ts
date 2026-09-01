import 'dotenv/config';
import 'express-async-errors';
import { randomBytes } from 'node:crypto';
import Decimal from 'decimal.js';
import express, { type ErrorRequestHandler, Express, Request, Response } from 'express';
import { prisma } from '@fairsplit/db';
import type { Logger } from '@fairsplit/logging';
import {
  applyScopeSchema,
  calculateSettlement,
  CATEGORY_ICON_KEYS,
  currencyCodeSchema,
  createExpenseSchema,
  fxRateInputSchema,
  inferCategoryIcon,
  MAX_DESCRIPTION_LENGTH,
  MAX_ENTITY_ID_LENGTH,
  monthSchema,
  replaceIncomeEntriesSchema,
  resolveCategoryIcon,
  updateHouseholdSplitPolicySchema,
  updateExpenseSchema,
} from '@fairsplit/shared';
import { z } from 'zod';
import { toMoneyString } from './lib/serializers';
import {
  ensureInstallmentsForMonth,
  propagateInstallmentDelete,
  propagateInstallmentUpdate,
  resolveCreateExpenseAmount,
  toExpenseInstallmentDto,
} from './lib/installments';
import {
  applyTemplateValuesToFutureMonths,
  deleteFixedExpense,
  ensureFixedExpensesForMonth,
  resolveFxRateForMonth,
} from './lib/fixed-expenses';
import { computeArsAmount } from './lib/money';
import { createApiHttpLogger, createApiLogger } from './lib/logger';
import { getSessionSecret, issueSessionToken, verifySessionToken, type SessionClaims } from './lib/session';
import {
  getCachedUserContext,
  invalidateUserContext,
  setCachedUserContext,
  type CachedUserContext,
} from './lib/user-context-cache';
import { verifySupabaseAccessToken } from './lib/supabase-auth';
import { createRateLimit, hashedRateLimitKey, requestIpKey } from './lib/rate-limit';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  MAX_PASSKEYS_PER_USER,
  PASSKEY_LABEL_MAX_LENGTH,
  consumeChallenge,
  defaultPasskeyLabel,
  getWebAuthnConfig,
  isPasskeysConfigured,
  sanitizeTransports,
  storeChallenge,
  toCredentialPublicKey,
  userHandleToUserId,
  userIdToUserHandle,
} from './lib/webauthn';

export const API_FIELD_LIMITS = {
  accessToken: 8_192,
  color: 32,
  name: 120,
  search: MAX_DESCRIPTION_LENGTH,
  sortOrder: 1_000_000,
  webauthnCredential: 4_096,
  webauthnRecordKeys: 64,
} as const;

export const entityIdSchema = z.string().min(1).max(MAX_ENTITY_ID_LENGTH);
const nameSchema = z.string().trim().min(1).max(API_FIELD_LIMITS.name);
const categoryIconSchema = z.enum(CATEGORY_ICON_KEYS);
const boundedWebauthnRecordSchema = z
  .record(z.unknown())
  .refine((value) => Object.keys(value).length <= API_FIELD_LIMITS.webauthnRecordKeys, {
    message: `record must contain at most ${API_FIELD_LIMITS.webauthnRecordKeys} fields`,
  });

export const monthQuerySchema = z.object({ month: monthSchema });
const expenseMonthQuerySchema = monthQuerySchema.strict();
const materializeExpenseMonthSchema = z.object({ month: monthSchema }).strict();
export const expenseListQuerySchema = z.object({
  month: monthSchema,
  search: z.string().trim().min(1).max(API_FIELD_LIMITS.search).optional(),
  categoryId: entityIdSchema.optional(),
  paidByUserId: entityIdSchema.optional(),
  type: z.enum(['oneTime', 'fixed', 'installment']).optional(),
  sortBy: z.enum(['date', 'description', 'category', 'amountArs', 'paidBy']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: entityIdSchema.optional(),
  includeCount: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
  includeTotals: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
}).strict().superRefine((value, ctx) => {
  if (value.cursor && !value.limit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cursor'],
      message: 'cursor requires limit',
    });
  }
});
export const expenseDescriptionSuggestionQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

function withExpenseTypeConstraint(
  baseWhere: Record<string, unknown>,
  type?: 'oneTime' | 'fixed' | 'installment',
): Record<string, unknown> {
  const where = { ...baseWhere };
  if (type === 'oneTime') {
    where.templateId = null;
    where.isInstallment = false;
  } else if (type === 'fixed') {
    where.templateId = { not: null };
  } else if (type === 'installment') {
    where.isInstallment = true;
  }
  return where;
}
const localeSchema = z.enum(['es', 'en']);
export const createUserSchema = z.object({ name: nameSchema, locale: localeSchema.optional() });
export const updateUserSchema = z.object({
  name: nameSchema.optional(),
  locale: localeSchema.optional(),
}).refine((value) => value.name !== undefined || value.locale !== undefined, {
  message: 'At least one profile field is required.',
});
export const deleteExpenseSchema = z.object({ applyScope: applyScopeSchema.optional() });
export const createCategorySchema = z.object({
  name: nameSchema,
  icon: categoryIconSchema.optional(),
  superCategoryId: entityIdSchema.nullable().optional(),
});
export const updateCategorySchema = z
  .object({
    name: nameSchema.optional(),
    icon: categoryIconSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.icon !== undefined, {
    message: 'At least one category field is required.',
  });
export const archiveCategorySchema = z.object({ replacementCategoryId: entityIdSchema.optional() });
export const createSuperCategorySchema = z.object({
  name: nameSchema,
  color: z.string().trim().min(1).max(API_FIELD_LIMITS.color).optional(),
  icon: categoryIconSchema.optional(),
  sortOrder: z.coerce
    .number()
    .int()
    .min(-API_FIELD_LIMITS.sortOrder)
    .max(API_FIELD_LIMITS.sortOrder)
    .optional(),
});
export const updateSuperCategorySchema = z.object({
  name: nameSchema.optional(),
  color: z.string().trim().min(1).max(API_FIELD_LIMITS.color).optional(),
  icon: categoryIconSchema.optional(),
  sortOrder: z.coerce
    .number()
    .int()
    .min(-API_FIELD_LIMITS.sortOrder)
    .max(API_FIELD_LIMITS.sortOrder)
    .optional(),
});
export const archiveSuperCategorySchema = z.object({
  replacementSuperCategoryId: entityIdSchema.optional(),
});
export const assignCategorySuperCategorySchema = z.object({ superCategoryId: entityIdSchema.nullable() });
export const upsertMonthlyExchangeRateSchema = z.object({
  month: monthSchema,
  currencyCode: currencyCodeSchema,
  rateToArs: fxRateInputSchema,
});
export const authLinkSchema = z.object({
  accessToken: z.string().trim().min(1).max(API_FIELD_LIMITS.accessToken),
  name: nameSchema.optional(),
});
export const joinHouseholdWithCodeSchema = z.object({
  code: z.string().trim().min(4).max(64),
});
// The WebAuthn response envelopes are validated by @simplewebauthn/server, so
// Zod only has to confirm we were handed an object of the right rough shape.
export const webauthnResponseSchema = z.object({
  id: z.string().min(1).max(API_FIELD_LIMITS.webauthnCredential),
  rawId: z.string().min(1).max(API_FIELD_LIMITS.webauthnCredential),
  type: z.literal('public-key'),
  response: boundedWebauthnRecordSchema,
  clientExtensionResults: boundedWebauthnRecordSchema.optional(),
  authenticatorAttachment: z.string().max(32).optional(),
});
export const passkeyRegistrationVerifySchema = z.object({
  response: webauthnResponseSchema,
  label: z.string().trim().min(1).max(PASSKEY_LABEL_MAX_LENGTH).optional(),
});
export const passkeyAuthenticationVerifySchema = z.object({
  response: webauthnResponseSchema,
});

type ExpenseWithRelations = Awaited<
  ReturnType<typeof prisma.expense.findFirstOrThrow>
> & {
  paidByUser: {
    id: string;
    name: string;
  };
  category: {
    id: string;
    name: string;
    superCategory: {
      id: string;
      name: string;
      color: string;
    } | null;
  };
};

function serializeExpense(expense: ExpenseWithRelations) {
  return {
    id: expense.id,
    month: expense.month,
    date: expense.date.toISOString().slice(0, 10),
    description: expense.description,
    categoryId: expense.categoryId,
    categoryName: expense.category.name,
    superCategoryId: expense.category.superCategory?.id ?? null,
    superCategoryName: expense.category.superCategory?.name ?? null,
    superCategoryColor: expense.category.superCategory?.color ?? null,
    amountOriginal: toMoneyString(expense.amountOriginal),
    amountArs: toMoneyString(expense.amountArs),
    currencyCode: expense.currencyCode,
    fxRateUsed: expense.fxRateUsed.toFixed(6),
    paidByUserId: expense.paidByUserId,
    paidByUserName: expense.paidByUser.name,
    fixed: {
      enabled: Boolean(expense.templateId),
      templateId: expense.templateId,
    },
    installment: toExpenseInstallmentDto(expense),
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function getPrismaErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string' ? candidate.code : null;
}

function serializeCategory(
  category: {
    id: string;
    name: string;
    icon: string;
    archivedAt: Date | null;
    superCategoryId: string | null;
    superCategory: { id: string; name: string; color: string } | null;
    _count: { expenses: number; expenseTemplates: number };
  },
) {
  return {
    id: category.id,
    name: category.name,
    icon: resolveCategoryIcon(category.icon, category.name),
    archivedAt: category.archivedAt?.toISOString() ?? null,
    expenseCount: category._count.expenses,
    fixedExpenseCount: category._count.expenseTemplates,
    superCategoryId: category.superCategoryId,
    superCategoryName: category.superCategory?.name ?? null,
    superCategoryColor: category.superCategory?.color ?? null,
  };
}

function serializeSuperCategory(
  superCategory: {
    id: string;
    name: string;
    slug: string;
    color: string;
    icon: string;
    sortOrder: number;
    isSystem: boolean;
    archivedAt: Date | null;
    _count: { categories: number };
  },
) {
  return {
    id: superCategory.id,
    name: superCategory.name,
    slug: superCategory.slug,
    color: superCategory.color,
    icon: resolveCategoryIcon(superCategory.icon, superCategory.name),
    sortOrder: superCategory.sortOrder,
    isSystem: superCategory.isSystem,
    archivedAt: superCategory.archivedAt?.toISOString() ?? null,
    categoryCount: superCategory._count.categories,
  };
}

function defaultNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? 'User';
  const cleaned = localPart.replace(/[._-]+/g, ' ').trim();
  if (cleaned.length === 0) {
    return 'User';
  }
  return cleaned
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface AuthSessionUser {
  id: string;
  name: string;
  email: string | null;
  authUserId: string | null;
  locale: string;
  householdId: string | null;
  onboardingHouseholdDecisionAt: Date | null;
  sessionRevokedAt?: Date | null;
  createdAt: Date;
  household: { id: string; name: string; createdAt: Date } | null;
}

/**
 * Shared by every sign-in path (magic link and passkey) so both hand the web
 * layer the same payload and the same freshly minted session token.
 */
function buildAuthSessionResponse(user: AuthSessionUser, created: boolean, sessionSecret: string) {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      authUserId: user.authUserId,
      locale: user.locale,
      householdId: user.householdId,
      onboardingHouseholdDecisionAt: user.onboardingHouseholdDecisionAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    },
    household: user.household
      ? {
          id: user.household.id,
          name: user.household.name,
          createdAt: user.household.createdAt.toISOString(),
        }
      : null,
    created,
    needsHouseholdSetup: user.householdId === null && user.onboardingHouseholdDecisionAt === null,
    sessionToken: issueSessionToken(user, sessionSecret),
  };
}

interface RequestAuthContext {
  userId: string;
  householdId: string;
}

interface RequestUserContext {
  userId: string;
  householdId: string | null;
  onboardingHouseholdDecisionAt: Date | null;
  /** `sid` of the session that made this request, so logout can revoke just it. */
  sessionId: string;
  /** When that session's token expires, which bounds how long a revocation row matters. */
  sessionExpiresAt: Date;
}

interface CreateAppOptions {
  configureApp?: (app: Express) => void;
  logger?: Logger;
}

function disableAutoRequestLog(res: Response): void {
  res.locals.disableAutoRequestLog = true;
}

function logWarnAndDisableAutoLog(req: Request, res: Response, message: string, extra?: Record<string, unknown>): void {
  disableAutoRequestLog(res);
  req.log.warn(
    {
      statusCode: res.statusCode,
      ...(extra ?? {}),
    },
    message,
  );
}

function logErrorAndDisableAutoLog(req: Request, res: Response, error: unknown, message: string): void {
  disableAutoRequestLog(res);
  req.log.error(
    {
      err: error,
      statusCode: res.statusCode,
    },
    message,
  );
}

/** Reads the revocation-relevant user state and refreshes the cache entry. */
async function loadUserContext(userId: string): Promise<CachedUserContext | null> {
  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      householdId: true,
      onboardingHouseholdDecisionAt: true,
      sessionRevokedAt: true,
      // Lapsed rows are ignored here rather than relied on being pruned: the
      // token they revoke has expired on its own by then.
      revokedSessions: {
        where: { expiresAt: { gt: new Date() } },
        select: { sessionId: true },
      },
    },
  });
  const context: CachedUserContext | null = record
    ? {
        id: record.id,
        householdId: record.householdId,
        onboardingHouseholdDecisionAt: record.onboardingHouseholdDecisionAt,
        sessionRevokedAt: record.sessionRevokedAt,
        revokedSessionIds: record.revokedSessions.map((revoked) => revoked.sessionId),
      }
    : null;
  setCachedUserContext(userId, context);
  return context;
}

/**
 * Returns the log message for why this session is no longer valid, or null when
 * it still is. Two independent mechanisms: `sid` for the device that signed out,
 * `sessionRevokedAt` for a whole-account sign-out.
 */
function findRevocation(user: CachedUserContext, session: SessionClaims): string | null {
  if (user.revokedSessionIds.includes(session.sid)) {
    return 'Rejected API request for a signed-out session';
  }
  const revokedAt = user.sessionRevokedAt ? Math.floor(user.sessionRevokedAt.getTime() / 1000) : null;
  if (revokedAt !== null && session.iat <= revokedAt) {
    return 'Rejected API request for revoked session';
  }
  return null;
}

async function requireUserContext(req: Request, res: Response): Promise<RequestUserContext | null> {
  let sessionSecret: string;
  try {
    sessionSecret = getSessionSecret();
  } catch (error) {
    res.status(500);
    logErrorAndDisableAutoLog(req, res, error, 'Session secret is missing or invalid');
    res.status(500).json({ error: error instanceof Error ? error.message : 'Missing session secret.' });
    return null;
  }

  const rawSessionToken = req.header('x-fairsplit-session')?.trim();
  if (!rawSessionToken) {
    res.status(401).json({ error: 'Missing authentication context.' });
    return null;
  }

  const session = verifySessionToken(rawSessionToken, sessionSecret);
  if (!session) {
    res.status(401);
    logWarnAndDisableAutoLog(req, res, 'Rejected API request with invalid session token');
    res.status(401).json({ error: 'Invalid authentication context.' });
    return null;
  }

  // A single page load fans out into several authenticated calls, each of which
  // would otherwise repeat this identical lookup. See user-context-cache for the
  // revocation-staleness bound this accepts.
  const cached = getCachedUserContext(session.userId);
  let user = cached === undefined ? await loadUserContext(session.userId) : cached;
  if (!user) {
    res.status(401);
    logWarnAndDisableAutoLog(req, res, 'Rejected API request for missing user');
    res.status(401).json({ error: 'Invalid authentication context.' });
    return null;
  }

  let rejection = findRevocation(user, session);
  // A cached entry can be stale in the direction that matters here: a session
  // signed in moments ago on one instance looks revoked to another instance still
  // holding pre-sign-in state. Confirm against the database before rejecting,
  // which costs a query only on the path that was about to fail anyway.
  if (rejection && cached !== undefined) {
    user = await loadUserContext(session.userId);
    if (!user) {
      res.status(401);
      logWarnAndDisableAutoLog(req, res, 'Rejected API request for missing user');
      res.status(401).json({ error: 'Invalid authentication context.' });
      return null;
    }
    rejection = findRevocation(user, session);
  }
  if (rejection) {
    res.status(401);
    logWarnAndDisableAutoLog(req, res, rejection);
    res.status(401).json({ error: 'Invalid authentication context.' });
    return null;
  }

  return {
    userId: user.id,
    householdId: user.householdId,
    onboardingHouseholdDecisionAt: user.onboardingHouseholdDecisionAt,
    sessionId: session.sid,
    sessionExpiresAt: new Date(session.exp * 1000),
  };
}

async function requireAuthContext(req: Request, res: Response): Promise<RequestAuthContext | null> {
  const user = await requireUserContext(req, res);
  if (!user) {
    return null;
  }
  if (!user.householdId) {
    res.status(403).json({ error: 'Authenticated user is not linked to a household.' });
    return null;
  }
  if (!user.onboardingHouseholdDecisionAt) {
    res.status(403).json({ error: 'Household setup is required before accessing this endpoint.' });
    return null;
  }

  return { userId: user.userId, householdId: user.householdId };
}

function normalizeInviteCode(rawCode: string): string {
  return rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const AUTH_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 30;
const AUTH_TOKEN_RATE_LIMIT_MAX = 5;
const PASSKEY_CREDENTIAL_RATE_LIMIT_MAX = 10;
const AUTHENTICATED_SECURITY_RATE_LIMIT_MAX = 20;
const INVITE_CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const INVITE_CREATE_RATE_LIMIT_MAX = 10;
const INVITE_JOIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const INVITE_JOIN_RATE_LIMIT_MAX = 10;

function generateInviteCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += INVITE_CODE_ALPHABET[bytes[index] % INVITE_CODE_ALPHABET.length];
  }
  return code;
}

export const createApp = (options: CreateAppOptions = {}): Express => {
  const app = express();
  const logger = options.logger ?? createApiLogger();
  const normalizeCurrencyCode = (value: string) => {
    const parsed = currencyCodeSchema.safeParse(value);
    return parsed.success ? parsed.data : 'ARS';
  };

  app.use(createApiHttpLogger(logger));
  app.use(express.json());
  app.param('id', (_req, res, next, id) => {
    if (!entityIdSchema.safeParse(id).success) {
      return res.status(400).json({ error: `Resource id must be at most ${MAX_ENTITY_ID_LENGTH} characters.` });
    }
    return next();
  });

  // Browser traffic reaches the API through the same-origin Next.js BFF. The
  // API deliberately emits no CORS headers, so browsers cannot call it from an
  // arbitrary origin even if the API's network endpoint is publicly reachable.
  const authLinkIpLimit = createRateLimit({
    limit: AUTH_RATE_LIMIT_MAX,
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    key: requestIpKey,
  });
  const authLinkTokenLimit = createRateLimit({
    limit: AUTH_TOKEN_RATE_LIMIT_MAX,
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    key: (request) => hashedRateLimitKey(
      'auth-token',
      typeof request.body?.accessToken === 'string' ? request.body.accessToken : undefined,
      requestIpKey(request),
    ),
  });
  const passkeyLoginIpLimit = createRateLimit({
    limit: AUTH_RATE_LIMIT_MAX,
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    key: requestIpKey,
  });
  const passkeyCredentialLimit = createRateLimit({
    limit: PASSKEY_CREDENTIAL_RATE_LIMIT_MAX,
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    key: (request) => hashedRateLimitKey(
      'passkey-credential',
      typeof request.body?.response?.id === 'string' ? request.body.response.id : undefined,
      requestIpKey(request),
    ),
  });
  const passkeyRegistrationLimit = createRateLimit({
    limit: AUTHENTICATED_SECURITY_RATE_LIMIT_MAX,
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    key: (request) => hashedRateLimitKey(
      'session',
      request.get('x-fairsplit-session'),
      requestIpKey(request),
    ),
  });
  const inviteCreateLimit = createRateLimit({
    limit: INVITE_CREATE_RATE_LIMIT_MAX,
    windowMs: INVITE_CREATE_RATE_LIMIT_WINDOW_MS,
    key: (request) => hashedRateLimitKey(
      'session',
      request.get('x-fairsplit-session'),
      requestIpKey(request),
    ),
  });
  const inviteJoinLimit = createRateLimit({
    limit: INVITE_JOIN_RATE_LIMIT_MAX,
    windowMs: INVITE_JOIN_RATE_LIMIT_WINDOW_MS,
    key: (request) => hashedRateLimitKey(
      'session',
      request.get('x-fairsplit-session'),
      requestIpKey(request),
    ),
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/link', authLinkIpLimit, authLinkTokenLimit, async (req: Request, res: Response) => {
    const parsed = authLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const identity = await verifySupabaseAccessToken(parsed.data.accessToken).catch(() => null);
    if (!identity) {
      res.status(401);
      logWarnAndDisableAutoLog(req, res, 'Rejected auth link request with invalid access token');
      return res.status(401).json({ error: 'Invalid access token.' });
    }

    const authUserId = identity.authUserId;
    const email = identity.email;
    const displayName = parsed.data.name?.trim() ?? defaultNameFromEmail(identity.email);
    let sessionSecret: string;
    try {
      sessionSecret = getSessionSecret();
    } catch (error) {
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Session secret is missing or invalid during auth link');
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Missing session secret.' });
    }

    const toResponse = (user: AuthSessionUser, created: boolean) =>
      buildAuthSessionResponse(user, created, sessionSecret);

    try {
      const linkedByAuthId = await prisma.user.findUnique({
        where: { authUserId },
        include: { household: true },
      });
      if (linkedByAuthId) {
        return res.json(toResponse(linkedByAuthId, false));
      }

      const candidateMatches = await prisma.user.findMany({
        where: { email: { equals: email, mode: 'insensitive' as const }, authUserId: null },
        include: { household: true },
        take: 2,
      });

      if (candidateMatches.length > 1) {
        return res.status(409).json({
          error: 'Ambiguous email mapping for this account. Manual remap required before linking.',
        });
      }

      if (candidateMatches.length === 1) {
        const matched = candidateMatches[0];
        const claimed = await prisma.user.updateMany({
          where: {
            id: matched.id,
            authUserId: null,
          },
          data: {
            authUserId,
            email,
          },
        });

        if (claimed.count === 0) {
          const winner = await prisma.user.findUnique({
            where: { authUserId },
            include: { household: true },
          });
          if (!winner) {
            return res.status(409).json({ error: 'Failed to claim user account. Please retry.' });
          }
          return res.json(toResponse(winner, false));
        }

        const linked = await prisma.user.findUniqueOrThrow({
          where: { id: matched.id },
          include: { household: true },
        });
        return res.json(toResponse(linked, false));
      }

      // Deliberately left without a household: `needsHouseholdSetup` turns true,
      // the web middleware routes to `/onboarding/household`, and the user picks
      // between redeeming an invite code and starting their own household. Creating
      // one here instead would decide for them and make invite codes unredeemable,
      // since both onboarding endpoints refuse a user who already has a household.
      const created = await prisma.user.create({
        data: {
          name: displayName,
          email,
          authUserId,
          householdId: null,
          onboardingHouseholdDecisionAt: null,
        },
        include: { household: true },
      });

      return res.status(201).json(toResponse(created, true));
    } catch (error) {
      const knownError = error as { code?: string; meta?: { target?: unknown } };
      if (knownError.code === 'P2002') {
        const target = Array.isArray(knownError.meta?.target) ? knownError.meta?.target : [];
        if (target.includes('authUserId')) {
          const winner = await prisma.user.findUnique({
            where: { authUserId },
            include: { household: true },
          });
          if (winner) {
            return res.json(toResponse(winner, false));
          }
        }
      }

      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Failed to link auth identity');
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to link auth identity.',
      });
    }
  });

  /**
   * Signs out the calling device only. The user's other sessions — phone,
   * partner's tablet, another browser — keep working, which is what people
   * expect of a logout link. `/api/auth/logout-all` is the account-wide option.
   */
  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const user = await requireUserContext(req, res);
    if (!user) {
      return;
    }

    await prisma.revokedSession.upsert({
      where: { sessionId: user.sessionId },
      create: {
        userId: user.userId,
        sessionId: user.sessionId,
        expiresAt: user.sessionExpiresAt,
      },
      update: {},
    });
    // Opportunistic pruning, scoped to this user so it rides the
    // (userId, expiresAt) index: rows stop mattering once the token they revoke
    // would have expired anyway.
    await prisma.revokedSession.deleteMany({
      where: { userId: user.userId, expiresAt: { lte: new Date() } },
    });
    // Revocation has to take effect on the very next request, not after the TTL.
    invalidateUserContext(user.userId);

    res.status(204).send();
  });

  /**
   * Signs out every device, for a lost or stolen one. `sessionRevokedAt` kills
   * every token issued up to now in a single write, which makes the per-session
   * rows redundant.
   */
  app.post('/api/auth/logout-all', async (req: Request, res: Response) => {
    const user = await requireUserContext(req, res);
    if (!user) {
      return;
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.userId },
        // A sign-in landing in this same second would otherwise receive a token
        // the next request rejects; `issueSessionToken` advances `iat` past it.
        data: { sessionRevokedAt: new Date(Date.now() + 1000) },
      }),
      prisma.revokedSession.deleteMany({ where: { userId: user.userId } }),
    ]);
    invalidateUserContext(user.userId);

    res.status(204).send();
  });

  const resolveWebAuthnConfig = (req: Request, res: Response) => {
    try {
      return getWebAuthnConfig();
    } catch (error) {
      res.status(503);
      logErrorAndDisableAutoLog(req, res, error, 'Passkeys are not configured');
      res.status(503).json({ error: 'Passkey sign-in is not configured on this server.' });
      return null;
    }
  };

  app.get('/api/auth/passkeys', async (req: Request, res: Response) => {
    const user = await requireUserContext(req, res);
    if (!user) {
      return;
    }

    const passkeys = await prisma.userPasskey.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        label: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return res.json({
      configured: isPasskeysConfigured(),
      passkeys: passkeys.map((passkey) => ({
        id: passkey.id,
        label: passkey.label,
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        createdAt: passkey.createdAt.toISOString(),
        lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
      })),
    });
  });

  app.post('/api/auth/passkeys/registration/options', passkeyRegistrationLimit, async (req: Request, res: Response) => {
    const user = await requireUserContext(req, res);
    if (!user) {
      return;
    }
    const config = resolveWebAuthnConfig(req, res);
    if (!config) {
      return;
    }

    const record = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, name: true, email: true },
    });
    if (!record) {
      return res.status(401).json({ error: 'Invalid authentication context.' });
    }

    const existing = await prisma.userPasskey.findMany({
      where: { userId: user.userId },
      select: { credentialId: true, transports: true },
    });
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      return res.status(409).json({ error: 'Passkey limit reached. Remove one before adding another.' });
    }

    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: record.email ?? record.name,
      userDisplayName: record.name,
      userID: userIdToUserHandle(record.id),
      attestationType: 'none',
      // Stops the same authenticator from being enrolled twice.
      excludeCredentials: existing.map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        // A discoverable credential is what makes the usernameless sign-in
        // button work: the browser can offer the account without an email.
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    await storeChallenge(options.challenge, 'registration', user.userId);
    return res.json(options);
  });

  app.post('/api/auth/passkeys/registration/verify', passkeyRegistrationLimit, async (req: Request, res: Response) => {
    const user = await requireUserContext(req, res);
    if (!user) {
      return;
    }
    const parsed = passkeyRegistrationVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const config = resolveWebAuthnConfig(req, res);
    if (!config) {
      return;
    }

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data.response as unknown as RegistrationResponseJSON,
        expectedChallenge: (challenge) => consumeChallenge(challenge, 'registration', user.userId),
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        requireUserVerification: true,
      });
    } catch (error) {
      res.status(400);
      logWarnAndDisableAutoLog(req, res, 'Rejected passkey registration', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return res.status(400).json({ error: 'Could not verify this passkey. Please try again.' });
    }

    if (!verification.verified) {
      res.status(400);
      logWarnAndDisableAutoLog(req, res, 'Rejected unverified passkey registration');
      return res.status(400).json({ error: 'Could not verify this passkey. Please try again.' });
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const label = parsed.data.label ?? defaultPasskeyLabel(credentialDeviceType);

    try {
      const created = await prisma.userPasskey.create({
        data: {
          userId: user.userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: sanitizeTransports(credential.transports),
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          label,
        },
        select: {
          id: true,
          label: true,
          deviceType: true,
          backedUp: true,
          createdAt: true,
          lastUsedAt: true,
        },
      });

      return res.status(201).json({
        id: created.id,
        label: created.label,
        deviceType: created.deviceType,
        backedUp: created.backedUp,
        createdAt: created.createdAt.toISOString(),
        lastUsedAt: created.lastUsedAt?.toISOString() ?? null,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        return res.status(409).json({ error: 'This passkey is already registered.' });
      }
      throw error;
    }
  });

  app.delete('/api/auth/passkeys/:id', async (req: Request, res: Response) => {
    const user = await requireUserContext(req, res);
    if (!user) {
      return;
    }

    const rawPasskeyId = req.params.id;
    const passkeyId = Array.isArray(rawPasskeyId) ? rawPasskeyId[0]?.trim() : rawPasskeyId?.trim();
    if (!passkeyId) {
      return res.status(400).json({ error: 'Passkey id is required' });
    }

    // Scoped by userId so one household member cannot delete another's passkey.
    const deleted = await prisma.userPasskey.deleteMany({
      where: { id: passkeyId, userId: user.userId },
    });
    if (deleted.count === 0) {
      return res.status(404).json({ error: 'Passkey not found.' });
    }

    return res.status(204).send();
  });

  app.post('/api/auth/passkeys/authentication/options', passkeyLoginIpLimit, async (req: Request, res: Response) => {
    const config = resolveWebAuthnConfig(req, res);
    if (!config) {
      return;
    }

    // No `allowCredentials`: the browser picks a discoverable credential, which
    // keeps the flow usernameless and avoids revealing whether an account or a
    // passkey exists for any given email.
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      userVerification: 'required',
    });

    await storeChallenge(options.challenge, 'authentication', null);
    return res.json(options);
  });

  app.post(
    '/api/auth/passkeys/authentication/verify',
    passkeyLoginIpLimit,
    passkeyCredentialLimit,
    async (req: Request, res: Response) => {
    const parsed = passkeyAuthenticationVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const config = resolveWebAuthnConfig(req, res);
    if (!config) {
      return;
    }
    let sessionSecret: string;
    try {
      sessionSecret = getSessionSecret();
    } catch (error) {
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Session secret is missing or invalid during passkey sign-in');
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Missing session secret.' });
    }

    const response = parsed.data.response as unknown as AuthenticationResponseJSON;
    const rejectSignIn = (reason: string) => {
      res.status(401);
      logWarnAndDisableAutoLog(req, res, 'Rejected passkey sign-in', { reason });
      return res.status(401).json({ error: 'Could not sign in with this passkey.' });
    };

    const passkey = await prisma.userPasskey.findUnique({
      where: { credentialId: response.id },
      include: { user: { include: { household: true } } },
    });
    if (!passkey) {
      return rejectSignIn('unknown-credential');
    }

    // The user handle is the account the authenticator believes this credential
    // belongs to. If it disagrees with our record, something is wrong.
    const userHandle = response.response.userHandle;
    if (userHandle && userHandleToUserId(userHandle) !== passkey.userId) {
      return rejectSignIn('user-handle-mismatch');
    }

    const storedCounter = Number(passkey.counter);
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: (challenge) => consumeChallenge(challenge, 'authentication', null),
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialId,
          publicKey: toCredentialPublicKey(passkey.publicKey),
          counter: storedCounter,
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
      });
    } catch (error) {
      return rejectSignIn(error instanceof Error ? error.message : 'verification-threw');
    }

    if (!verification.verified) {
      return rejectSignIn('unverified');
    }

    const { newCounter, credentialBackedUp, credentialDeviceType } = verification.authenticationInfo;
    // Authenticators that keep a signature counter must advance it. A counter
    // that stands still or goes backwards suggests a cloned credential. Many
    // passkeys report 0 forever, which is why 0 is exempt.
    if (newCounter > 0 && newCounter <= storedCounter) {
      return rejectSignIn('counter-did-not-advance');
    }

    await prisma.userPasskey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(newCounter),
        backedUp: credentialBackedUp,
        deviceType: credentialDeviceType,
        lastUsedAt: new Date(),
      },
    });

    return res.json(buildAuthSessionResponse(passkey.user, false, sessionSecret));
    },
  );

  app.get('/api/household/setup-status', async (req: Request, res: Response) => {
    const auth = await requireUserContext(req, res);
    if (!auth) {
      return;
    }

    const needsHouseholdSetup = auth.householdId === null && auth.onboardingHouseholdDecisionAt === null;
    return res.json({
      needsHouseholdSetup,
      decisionLocked: auth.onboardingHouseholdDecisionAt !== null,
    });
  });

  app.get('/api/household/split-policy', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const household = await prisma.household.findUniqueOrThrow({
      where: { id: auth.householdId },
      select: {
        splitMethod: true,
        users: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        },
        splitShares: {
          select: { userId: true, percentage: true },
        },
      },
    });
    const savedPercentages = new Map(
      household.splitShares.map((share) => [share.userId, share.percentage.toFixed(2)]),
    );
    const defaultHundredths = Math.floor(10_000 / Math.max(household.users.length, 1));
    const defaultRemainder = 10_000 - defaultHundredths * household.users.length;
    const hasSavedShares = household.splitShares.length > 0;

    return res.json({
      method: household.splitMethod,
      shares: household.users.map((user, index) => ({
        userId: user.id,
        userName: user.name,
        percentage: hasSavedShares
          ? (savedPercentages.get(user.id) ?? '0.00')
          : ((defaultHundredths + (index < defaultRemainder ? 1 : 0)) / 100).toFixed(2),
      })),
    });
  });

  app.put('/api/household/split-policy', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = updateHouseholdSplitPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const householdUsers = await prisma.user.findMany({
      where: { householdId: auth.householdId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    });

    if (parsed.data.method === 'custom') {
      const currentUserIds = new Set(householdUsers.map((user) => user.id));
      const submittedUserIds = new Set(parsed.data.shares.map((share) => share.userId));
      const coversHousehold =
        currentUserIds.size === submittedUserIds.size &&
        [...currentUserIds].every((userId) => submittedUserIds.has(userId));
      if (!coversHousehold) {
        return res.status(400).json({
          error: 'Custom split percentages must include every current household member.',
        });
      }
    }

    await prisma.$transaction(async (tx) => {
      if (parsed.data.method === 'custom') {
        await tx.householdSplitShare.deleteMany({ where: { householdId: auth.householdId } });
        await tx.householdSplitShare.createMany({
          data: parsed.data.shares.map((share) => ({
            householdId: auth.householdId,
            userId: share.userId,
            percentage: new Decimal(share.percentage).toFixed(2),
          })),
        });
      }

      await tx.household.update({
        where: { id: auth.householdId },
        data: { splitMethod: parsed.data.method },
      });
    });

    const storedShares = await prisma.householdSplitShare.findMany({
      where: { householdId: auth.householdId },
      select: { userId: true, percentage: true },
    });
    const percentagesByUser = new Map(
      storedShares.map((share) => [share.userId, share.percentage.toFixed(2)]),
    );
    return res.json({
      method: parsed.data.method,
      shares: householdUsers.map((user) => ({
        userId: user.id,
        userName: user.name,
        percentage: percentagesByUser.get(user.id) ?? '0.00',
      })),
    });
  });

  app.post('/api/household/invites', inviteCreateLimit, async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = generateInviteCode(8);
      try {
        const invite = await prisma.householdInvite.create({
          data: {
            householdId: auth.householdId,
            code,
            createdByUserId: auth.userId,
            expiresAt,
          },
        });

        return res.status(201).json({
          code: invite.code,
          expiresAt: invite.expiresAt.toISOString(),
        });
      } catch (error) {
        if (getPrismaErrorCode(error) !== 'P2002') {
          res.status(500);
          logErrorAndDisableAutoLog(req, res, error, 'Failed to create household invite code');
          return res.status(500).json({ error: 'Failed to create invite code.' });
        }
      }
    }

    res.status(500);
    logErrorAndDisableAutoLog(req, res, null, 'Failed to create household invite code after repeated collisions');
    return res.status(500).json({ error: 'Failed to create invite code. Please retry.' });
  });

  app.post('/api/household/join-with-code', inviteJoinLimit, async (req: Request, res: Response) => {
    const auth = await requireUserContext(req, res);
    if (!auth) {
      return;
    }
    const parsed = joinHouseholdWithCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    // A user may redeem a code either before choosing a household at all, or from
    // a household they are alone in and have not put anything into. Both people
    // signing up separately before either thought to send a code is the ordinary
    // way a couple arrives here, and refusing that left the invite feature usable
    // only in the window before the second person's first sign-in.
    const joiner = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, householdId: true },
    });
    if (!joiner) {
      return res.status(404).json({ error: 'User not found.' });
    }

    if (joiner.householdId) {
      const [members, expenses, incomes, templates] = await Promise.all([
        prisma.user.count({ where: { householdId: joiner.householdId } }),
        prisma.expense.count({ where: { householdId: joiner.householdId } }),
        prisma.monthlyIncome.count({ where: { householdId: joiner.householdId } }),
        prisma.expenseTemplate.count({ where: { householdId: joiner.householdId } }),
      ]);
      if (members > 1) {
        return res.status(409).json({
          error: 'Leave your current household before joining another one.',
        });
      }
      if (expenses > 0 || incomes > 0 || templates > 0) {
        return res.status(409).json({
          error:
            'Your household already has expenses or income recorded. Joining another household would leave them behind.',
        });
      }
    }

    const normalizedCode = normalizeInviteCode(parsed.data.code);
    const invite = await prisma.householdInvite.findUnique({
      where: { code: normalizedCode },
      include: { household: true },
    });
    if (!invite) {
      return res.status(404).json({ error: 'Invite code not found.' });
    }
    if (invite.isRevoked || invite.consumedAt || invite.expiresAt.getTime() <= Date.now()) {
      return res.status(410).json({ error: 'Invite code is no longer valid.' });
    }
    if (invite.householdId === joiner.householdId) {
      return res.status(409).json({ error: 'You are already in that household.' });
    }

    const decisionAt = new Date();
    const vacatedHouseholdId = joiner.householdId;
    const result = await prisma.$transaction(async (tx) => {
      // Matching on the household read a moment ago keeps this safe against a
      // concurrent second attempt: whichever transaction lands first moves the
      // user, and the other one sees no rows and gives up.
      const updatedUser = await tx.user.updateMany({
        where: {
          id: auth.userId,
          householdId: vacatedHouseholdId,
        },
        data: {
          householdId: invite.householdId,
          onboardingHouseholdDecisionAt: decisionAt,
        },
      });
      if (updatedUser.count !== 1) {
        throw new Error('Household setup has already been completed.');
      }

      const consumed = await tx.householdInvite.updateMany({
        where: {
          id: invite.id,
          consumedAt: null,
          isRevoked: false,
        },
        data: {
          consumedAt: decisionAt,
          consumedByUserId: auth.userId,
        },
      });
      if (consumed.count !== 1) {
        throw new Error('Invite code is no longer valid.');
      }

      if (vacatedHouseholdId) {
        // Every dependent row has to go explicitly. The foreign keys say
        // `ON DELETE SET NULL` while the columns are NOT NULL, so deleting the
        // household outright would raise a not-null violation — and for
        // `SuperCategory`, whose column *is* nullable, it would silently null the
        // owner and promote a private super category to a global system one.
        // Expenses, income and templates cannot exist here: joining is refused
        // above when any are present.
        await tx.monthlyExchangeRate.deleteMany({ where: { householdId: vacatedHouseholdId } });
        await tx.category.deleteMany({ where: { householdId: vacatedHouseholdId } });
        await tx.superCategory.deleteMany({ where: { householdId: vacatedHouseholdId } });
        await tx.household.delete({ where: { id: vacatedHouseholdId } });
      }

      return tx.user.findUniqueOrThrow({
        where: { id: auth.userId },
        include: { household: true },
      });
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes('Invite code')) {
        return null;
      }
      if (error instanceof Error && error.message.includes('setup has already')) {
        return 'LOCKED' as const;
      }
      throw error;
    });

    if (result === null) {
      return res.status(410).json({ error: 'Invite code is no longer valid.' });
    }
    if (result === 'LOCKED') {
      return res.status(409).json({ error: 'Household setup has already been completed.' });
    }
    // The user just gained a household, so the cached pre-onboarding context is stale.
    invalidateUserContext(auth.userId);

    let sessionSecret: string;
    try {
      sessionSecret = getSessionSecret();
    } catch (error) {
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Session secret is missing or invalid during household join');
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Missing session secret.' });
    }

    return res.json({
      user: {
        id: result.id,
        name: result.name,
        email: result.email,
        authUserId: result.authUserId,
        locale: result.locale,
        householdId: result.householdId,
        onboardingHouseholdDecisionAt: result.onboardingHouseholdDecisionAt?.toISOString() ?? null,
        createdAt: result.createdAt.toISOString(),
      },
      household: result.household
        ? {
            id: result.household.id,
            name: result.household.name,
            createdAt: result.household.createdAt.toISOString(),
          }
        : null,
      needsHouseholdSetup: false,
      sessionToken: issueSessionToken(result, sessionSecret),
    });
  });

  app.post('/api/household/skip-setup', async (req: Request, res: Response) => {
    const auth = await requireUserContext(req, res);
    if (!auth) {
      return;
    }
    if (auth.householdId || auth.onboardingHouseholdDecisionAt) {
      return res.status(409).json({ error: 'Household setup has already been completed.' });
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true, authUserId: true, createdAt: true },
    });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const decisionAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const household = await tx.household.create({
        data: {
          name: `${existingUser.name}'s Household`,
        },
      });

      const updated = await tx.user.updateMany({
        where: {
          id: auth.userId,
          householdId: null,
          onboardingHouseholdDecisionAt: null,
        },
        data: {
          householdId: household.id,
          onboardingHouseholdDecisionAt: decisionAt,
        },
      });
      if (updated.count !== 1) {
        throw new Error('Household setup has already been completed.');
      }

      return tx.user.findUniqueOrThrow({
        where: { id: auth.userId },
        include: { household: true },
      });
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes('setup has already')) {
        return null;
      }
      throw error;
    });

    if (!result) {
      return res.status(409).json({ error: 'Household setup has already been completed.' });
    }
    // The user just gained a household, so the cached pre-onboarding context is stale.
    invalidateUserContext(auth.userId);

    let sessionSecret: string;
    try {
      sessionSecret = getSessionSecret();
    } catch (error) {
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Session secret is missing or invalid during household setup skip');
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Missing session secret.' });
    }

    return res.json({
      user: {
        id: result.id,
        name: result.name,
        email: result.email,
        authUserId: result.authUserId,
        locale: result.locale,
        householdId: result.householdId,
        onboardingHouseholdDecisionAt: result.onboardingHouseholdDecisionAt?.toISOString() ?? null,
        createdAt: result.createdAt.toISOString(),
      },
      household: result.household
        ? {
            id: result.household.id,
            name: result.household.name,
            createdAt: result.household.createdAt.toISOString(),
          }
        : null,
      needsHouseholdSetup: false,
      sessionToken: issueSessionToken(result, sessionSecret),
    });
  });

  app.get('/api/months', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const [incomeMonths, expenseMonths] = await Promise.all([
      prisma.monthlyIncome.findMany({
        where: { householdId: auth.householdId },
        distinct: ['month'],
        select: { month: true },
      }),
      prisma.expense.findMany({
        where: { householdId: auth.householdId },
        distinct: ['month'],
        select: { month: true },
      }),
    ]);

    const months = Array.from(new Set([...incomeMonths, ...expenseMonths].map((entry) => entry.month))).sort();
    res.json(months);
  });

  app.get('/api/users', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const users = await prisma.user.findMany({
      where: { householdId: auth.householdId },
      orderBy: { createdAt: 'asc' },
    });
    res.json(
      users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.id === auth.userId ? user.email : null,
        locale: user.locale,
        createdAt: user.createdAt.toISOString(),
      })),
    );
  });

  app.get('/api/users/:id', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const rawUserId = req.params.id;
    const userId = Array.isArray(rawUserId) ? rawUserId[0]?.trim() : rawUserId?.trim();
    if (!userId) {
      return res.status(400).json({ error: 'User id is required' });
    }
    if (userId !== auth.userId) {
      return res.status(403).json({ error: 'You can only access your own profile.' });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, householdId: auth.householdId },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    });
  });

  app.post('/api/users', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = createUserSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const user = await prisma.user.create({
      data: { name: parsed.data.name, locale: parsed.data.locale ?? 'en', householdId: auth.householdId },
    });
    return res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    });
  });

  app.patch('/api/users/:id', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const rawUserId = req.params.id;
    const userId = Array.isArray(rawUserId) ? rawUserId[0]?.trim() : rawUserId?.trim();
    if (!userId) {
      return res.status(400).json({ error: 'User id is required' });
    }
    if (userId !== auth.userId) {
      return res.status(403).json({ error: 'You can only update your own profile.' });
    }

    const existing = await prisma.user.findFirst({
      where: { id: userId, householdId: auth.householdId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.locale !== undefined ? { locale: parsed.data.locale } : {}),
      },
    });

    return res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      locale: updated.locale,
      createdAt: updated.createdAt.toISOString(),
    });
  });

  app.get('/api/categories', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const categories = await prisma.category.findMany({
      where: { householdId: auth.householdId },
      orderBy: [{ archivedAt: 'asc' }, { superCategory: { sortOrder: 'asc' } }, { name: 'asc' }],
      include: {
        superCategory: {
          select: { id: true, name: true, color: true },
        },
        _count: {
          select: {
            expenses: true,
            expenseTemplates: true,
          },
        },
      },
    });

    return res.json(categories.map((category) => serializeCategory(category)));
  });

  app.get('/api/super-categories', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const superCategories = await prisma.superCategory.findMany({
      where: {
        OR: [
          { householdId: auth.householdId },
          { householdId: null, isSystem: true },
        ],
      },
      orderBy: [{ archivedAt: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            categories: true,
          },
        },
      },
    });

    return res.json(superCategories.map((superCategory) => serializeSuperCategory(superCategory)));
  });

  app.post('/api/categories', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    if (parsed.data.superCategoryId) {
      const superCategory = await prisma.superCategory.findFirst({
        where: {
          id: parsed.data.superCategoryId,
          archivedAt: null,
          OR: [{ householdId: auth.householdId }, { householdId: null, isSystem: true }],
        },
      });
      if (!superCategory) {
        return res.status(400).json({ error: 'Super category must exist and be active.' });
      }
    }

    try {
      const created = await prisma.category.create({
        data: {
          name: parsed.data.name,
          icon: parsed.data.icon ?? inferCategoryIcon(parsed.data.name),
          householdId: auth.householdId,
          superCategoryId: parsed.data.superCategoryId ?? null,
        },
        include: {
          superCategory: {
            select: { id: true, name: true, color: true },
          },
          _count: {
            select: {
              expenses: true,
              expenseTemplates: true,
            },
          },
        },
      });
      return res.status(201).json(serializeCategory(created));
    } catch (error) {
      const code = getPrismaErrorCode(error);
      if (code === 'P2002') {
        return res.status(409).json({ error: 'Category name already exists.' });
      }
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Failed to create category');
      return res.status(500).json({ error: 'Failed to create category.' });
    }
  });

  app.put('/api/categories/:id', async (req: Request<{ id: string }>, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = updateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const category = await prisma.category.findFirst({
      where: { id: req.params.id, householdId: auth.householdId },
      select: { id: true },
    });
    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    try {
      const updated = await prisma.category.update({
        where: { id: category.id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon } : {}),
        },
        include: {
          superCategory: {
            select: { id: true, name: true, color: true },
          },
          _count: {
            select: {
              expenses: true,
              expenseTemplates: true,
            },
          },
        },
      });
      return res.json(serializeCategory(updated));
    } catch (error) {
      const code = getPrismaErrorCode(error);
      if (code === 'P2025') {
        return res.status(404).json({ error: 'Category not found.' });
      }
      if (code === 'P2002') {
        return res.status(409).json({ error: 'Category name already exists.' });
      }
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Failed to update category');
      return res.status(500).json({ error: 'Failed to update category.' });
    }
  });

  app.put('/api/categories/:id/super-category', async (req: Request<{ id: string }>, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = assignCategorySuperCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    if (parsed.data.superCategoryId) {
      const superCategory = await prisma.superCategory.findFirst({
        where: {
          id: parsed.data.superCategoryId,
          archivedAt: null,
          OR: [{ householdId: auth.householdId }, { householdId: null, isSystem: true }],
        },
      });
      if (!superCategory) {
        return res.status(400).json({ error: 'Super category must exist and be active.' });
      }
    }

    try {
      const category = await prisma.category.findFirst({
        where: { id: req.params.id, householdId: auth.householdId },
        select: { id: true },
      });
      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }
      const updated = await prisma.category.update({
        where: { id: category.id },
        data: { superCategoryId: parsed.data.superCategoryId },
        include: {
          superCategory: {
            select: { id: true, name: true, color: true },
          },
          _count: {
            select: {
              expenses: true,
              expenseTemplates: true,
            },
          },
        },
      });
      return res.json(serializeCategory(updated));
    } catch (error) {
      return res.status(404).json({ error: 'Category not found.' });
    }
  });

  app.post('/api/categories/:id/archive', async (req: Request<{ id: string }>, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = archiveCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const sourceCategory = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: { expenses: true, expenseTemplates: true },
        },
      },
    });
    if (!sourceCategory || sourceCategory.householdId !== auth.householdId) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const replacementCategory = parsed.data.replacementCategoryId
      ? await prisma.category.findFirst({
          where: { id: parsed.data.replacementCategoryId, householdId: auth.householdId },
        })
      : null;
    if (parsed.data.replacementCategoryId && (!replacementCategory || replacementCategory.archivedAt)) {
      return res.status(400).json({ error: 'Replacement category must exist and be active.' });
    }
    if (replacementCategory && replacementCategory.id === sourceCategory.id) {
      return res.status(400).json({ error: 'Replacement category must be different.' });
    }

    await prisma.$transaction(async (tx) => {
      if (replacementCategory) {
        await tx.expense.updateMany({
          where: { categoryId: sourceCategory.id, householdId: auth.householdId },
          data: { categoryId: replacementCategory.id },
        });
        await tx.expenseTemplate.updateMany({
          where: { categoryId: sourceCategory.id, householdId: auth.householdId },
          data: { categoryId: replacementCategory.id },
        });
      }
      await tx.category.update({
        where: { id: sourceCategory.id },
        data: { archivedAt: new Date() },
      });
    });

    return res.status(204).send();
  });

  app.post('/api/categories/:id/unarchive', async (req: Request<{ id: string }>, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const category = await prisma.category.findFirst({
      where: {
        id: req.params.id,
        householdId: auth.householdId,
      },
      select: {
        id: true,
        archivedAt: true,
      },
    });
    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    if (!category.archivedAt) {
      return res.status(204).send();
    }

    await prisma.category.update({
      where: { id: category.id },
      data: { archivedAt: null },
    });

    return res.status(204).send();
  });

  app.post('/api/super-categories', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = createSuperCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const slugBase = slugify(parsed.data.name);
    const slug = slugBase.length > 0 ? slugBase : 'group';

    try {
      const created = await prisma.superCategory.create({
        data: {
          name: parsed.data.name,
          slug,
          householdId: auth.householdId,
          color: parsed.data.color ?? '#64748b',
          icon: parsed.data.icon ?? inferCategoryIcon(parsed.data.name),
          sortOrder: parsed.data.sortOrder ?? 1000,
          isSystem: false,
        },
        include: {
          _count: {
            select: { categories: true },
          },
        },
      });
      return res.status(201).json(serializeSuperCategory(created));
    } catch (error) {
      const code = getPrismaErrorCode(error);
      if (code === 'P2002') {
        return res.status(409).json({ error: 'Super category name already exists.' });
      }
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Failed to create super category');
      return res.status(500).json({ error: 'Failed to create super category.' });
    }
  });

  app.put('/api/super-categories/:id', async (req: Request<{ id: string }>, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = updateSuperCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ error: 'At least one field is required.' });
    }

    // Deliberately looks at the same set the read paths return — the household's
    // own plus the global system ones — so that editing a system super category is
    // refused on its own terms rather than reported as missing. Scoping the lookup
    // to the household alone would also refuse it, but only by accident: a system
    // super category has no `householdId`, and the day someone widens this query to
    // match the reads, renaming one would start succeeding and rename it for every
    // household at once.
    const superCategory = await prisma.superCategory.findFirst({
      where: {
        id: req.params.id,
        OR: [{ householdId: auth.householdId }, { householdId: null, isSystem: true }],
      },
      select: { id: true, isSystem: true },
    });
    if (!superCategory) {
      return res.status(404).json({ error: 'Super category not found.' });
    }
    if (superCategory.isSystem) {
      return res.status(400).json({ error: 'System super categories cannot be edited.' });
    }

    try {
      const updated = await prisma.superCategory.update({
        where: { id: superCategory.id },
        data: {
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.color ? { color: parsed.data.color } : {}),
          ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon } : {}),
          ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
        },
        include: {
          _count: {
            select: { categories: true },
          },
        },
      });
      return res.json(serializeSuperCategory(updated));
    } catch (error) {
      const code = getPrismaErrorCode(error);
      if (code === 'P2025') {
        return res.status(404).json({ error: 'Super category not found.' });
      }
      if (code === 'P2002') {
        return res.status(409).json({ error: 'Super category name already exists.' });
      }
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Failed to update super category');
      return res.status(500).json({ error: 'Failed to update super category.' });
    }
  });

  app.post('/api/super-categories/:id/archive', async (req: Request<{ id: string }>, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = archiveSuperCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    // Same widening as the edit route, for the same reason: the `isSystem` refusal
    // below should be what stops this, not the household scoping happening to miss.
    const source = await prisma.superCategory.findFirst({
      where: {
        id: req.params.id,
        OR: [{ householdId: auth.householdId }, { householdId: null, isSystem: true }],
      },
      include: {
        _count: {
          select: { categories: true },
        },
      },
    });
    if (!source) {
      return res.status(404).json({ error: 'Super category not found.' });
    }
    if (source.isSystem) {
      return res.status(400).json({ error: 'System super categories cannot be archived.' });
    }

    const replacement = parsed.data.replacementSuperCategoryId
      ? await prisma.superCategory.findFirst({
          where: {
            id: parsed.data.replacementSuperCategoryId,
            OR: [{ householdId: auth.householdId }, { householdId: null, isSystem: true }],
          },
        })
      : null;
    if (parsed.data.replacementSuperCategoryId && (!replacement || replacement.archivedAt)) {
      return res.status(400).json({ error: 'Replacement super category must exist and be active.' });
    }
    if (replacement && replacement.id === source.id) {
      return res.status(400).json({ error: 'Replacement super category must be different.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.category.updateMany({
        where: { superCategoryId: source.id, householdId: auth.householdId },
        data: { superCategoryId: replacement?.id ?? null },
      });
      await tx.superCategory.update({
        where: { id: source.id },
        data: { archivedAt: new Date() },
      });
    });

    return res.status(204).send();
  });

  app.get('/api/exchange-rates', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = monthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const rates = await prisma.monthlyExchangeRate.findMany({
      where: { month: parsed.data.month, householdId: auth.householdId },
      orderBy: { currencyCode: 'asc' },
    });

    return res.json(
      rates.map((rate) => ({
        id: rate.id,
        month: rate.month,
        currencyCode: rate.currencyCode,
        rateToArs: rate.rateToArs.toFixed(6),
      })),
    );
  });

  app.put('/api/exchange-rates', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = upsertMonthlyExchangeRateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const normalizedRate = new Decimal(parsed.data.rateToArs).toFixed(6);
    const existing = await prisma.monthlyExchangeRate.findFirst({
      where: {
        month: parsed.data.month,
        currencyCode: parsed.data.currencyCode,
        householdId: auth.householdId,
      },
      select: { id: true },
    });
    const rate = existing
      ? await prisma.monthlyExchangeRate.update({
          where: { id: existing.id },
          data: { rateToArs: normalizedRate },
        })
      : await prisma.monthlyExchangeRate.create({
          data: {
            month: parsed.data.month,
            currencyCode: parsed.data.currencyCode,
            rateToArs: normalizedRate,
            householdId: auth.householdId,
          },
        });

    return res.json({
      id: rate.id,
      month: rate.month,
      currencyCode: rate.currencyCode,
      rateToArs: rate.rateToArs.toFixed(6),
    });
  });

  app.get('/api/incomes', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = monthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const incomes = await prisma.monthlyIncome.findMany({
      where: { month: parsed.data.month, householdId: auth.householdId },
      orderBy: [{ user: { createdAt: 'asc' } }, { id: 'asc' }],
      include: { user: true },
    });

    return res.json(
      incomes.map((income) => ({
        id: income.id,
        month: income.month,
        userId: income.userId,
        userName: income.user.name,
        description: income.description,
        amount: toMoneyString(income.amountOriginal),
        amountOriginal: toMoneyString(income.amountOriginal),
        amountArs: toMoneyString(income.amount),
        currencyCode: income.currencyCode,
        fxRateUsed: income.fxRateUsed.toFixed(6),
      })),
    );
  });

  app.put('/api/incomes', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = replaceIncomeEntriesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const existingUser = await prisma.user.findFirst({
      where: { id: parsed.data.userId, householdId: auth.householdId },
    });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    let incomes;
    try {
      incomes = await prisma.$transaction(async (tx) => {
        const requestedCurrencies = Array.from(
          new Set(parsed.data.entries.map((entry) => entry.currencyCode.toUpperCase()).filter((code) => code !== 'ARS')),
        );
        const monthlyRates = requestedCurrencies.length
          ? await tx.monthlyExchangeRate.findMany({
              where: {
                householdId: auth.householdId,
                month: parsed.data.month,
                currencyCode: { in: requestedCurrencies },
              },
            })
          : [];
        const monthRateByCurrency = new Map(monthlyRates.map((rate) => [rate.currencyCode, rate.rateToArs.toFixed(6)]));

        await tx.monthlyIncome.deleteMany({
          where: {
            month: parsed.data.month,
            userId: parsed.data.userId,
            householdId: auth.householdId,
          },
        });

        const createdIncomes = [];
        for (const entry of parsed.data.entries) {
          const currencyCode = entry.currencyCode.toUpperCase();

          let fxRateUsed = '1.000000';
          if (currencyCode !== 'ARS') {
            const monthRate = monthRateByCurrency.get(currencyCode);
            if (entry.fxRate !== undefined) {
              const normalizedFxRate = new Decimal(entry.fxRate).toFixed(6);
              fxRateUsed = normalizedFxRate;

              if (!monthRate) {
                const createdRate = await tx.monthlyExchangeRate.create({
                    data: {
                      month: parsed.data.month,
                      currencyCode,
                      rateToArs: normalizedFxRate,
                      householdId: auth.householdId,
                    },
                  });
                monthRateByCurrency.set(currencyCode, createdRate.rateToArs.toFixed(6));
              }
            } else if (monthRate) {
              fxRateUsed = monthRate;
            } else {
              throw new Error(
                `Missing exchange rate for ${currencyCode} in ${parsed.data.month}. Configure a monthly exchange rate or provide an override.`,
              );
            }
          }

          const amountOriginal = new Decimal(entry.amount).toFixed(2);
          const amountArs = computeArsAmount(amountOriginal, fxRateUsed);

          const created = await tx.monthlyIncome.create({
            data: {
              month: parsed.data.month,
              userId: parsed.data.userId,
              householdId: auth.householdId,
              description: entry.description,
              amount: amountArs,
              amountOriginal,
              currencyCode,
              fxRateUsed,
            },
          });
          createdIncomes.push(created);
        }

        return createdIncomes;
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Missing exchange rate')) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof RangeError) {
        return res.status(400).json({ error: error.message });
      }
      res.status(500);
      logErrorAndDisableAutoLog(req, res, error, 'Failed to save incomes');
      return res.status(500).json({ error: 'Failed to save incomes.' });
    }

    return res.json(
      incomes.map((income) => ({
        id: income.id,
        month: income.month,
        userId: income.userId,
        description: income.description,
        amount: toMoneyString(income.amountOriginal),
        amountOriginal: toMoneyString(income.amountOriginal),
        amountArs: toMoneyString(income.amount),
        currencyCode: income.currencyCode,
        fxRateUsed: income.fxRateUsed.toFixed(6),
      })),
    );
  });

  app.get('/api/expenses', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = expenseListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const shouldIncludeCount = parsed.data.includeCount ?? true;

    const baseWhere: Record<string, unknown> = { month: parsed.data.month, householdId: auth.householdId };
    if (parsed.data.search) {
      baseWhere.OR = [
        { description: { contains: parsed.data.search, mode: 'insensitive' } },
        { category: { name: { contains: parsed.data.search, mode: 'insensitive' } } },
        { paidByUser: { name: { contains: parsed.data.search, mode: 'insensitive' } } },
      ];
    }
    if (parsed.data.categoryId) {
      baseWhere.categoryId = parsed.data.categoryId;
    }
    if (parsed.data.paidByUserId) {
      baseWhere.paidByUserId = parsed.data.paidByUserId;
    }
    const where = withExpenseTypeConstraint(baseWhere, parsed.data.type);

    const sortBy = parsed.data.sortBy ?? 'date';
    const sortDir = parsed.data.sortDir ?? 'desc';
    const orderBy: Record<string, unknown>[] = [];
    if (sortBy === 'description') {
      orderBy.push({ description: sortDir });
    } else if (sortBy === 'category') {
      orderBy.push({ category: { name: sortDir } });
    } else if (sortBy === 'amountArs') {
      orderBy.push({ amountArs: sortDir });
    } else if (sortBy === 'paidBy') {
      orderBy.push({ paidByUser: { name: sortDir } });
    } else {
      orderBy.push({ date: sortDir });
    }
    if (sortBy !== 'date') {
      orderBy.push({ date: 'desc' });
    }
    orderBy.push({ id: 'desc' });

    const baseFindManyArgs = {
      where,
      orderBy,
      include: { paidByUser: true, category: { include: { superCategory: true } } },
    } as const;
    const shouldIncludeTotals = parsed.data.includeTotals ?? false;
    // One grouped scan instead of four overlapping aggregates. Section membership
    // mirrors withExpenseTypeConstraint: "fixed" is any templated row and
    // "installment" is any instalment row, so a row can belong to both. Each
    // bucket is therefore summed independently rather than derived from the others.
    const totalsPromise = shouldIncludeTotals
      ? prisma.expense
          .groupBy({
            by: ['templateId', 'isInstallment'],
            where: baseWhere,
            _sum: { amountArs: true },
          })
          .then((groups) => {
            let filtered = new Decimal(0);
            let fixed = new Decimal(0);
            let oneTime = new Decimal(0);
            let installment = new Decimal(0);

            for (const group of groups) {
              const groupSum = new Decimal((group._sum.amountArs ?? 0).toString());
              filtered = filtered.plus(groupSum);
              if (group.templateId !== null) {
                fixed = fixed.plus(groupSum);
              }
              if (group.isInstallment) {
                installment = installment.plus(groupSum);
              }
              if (group.templateId === null && !group.isInstallment) {
                oneTime = oneTime.plus(groupSum);
              }
            }

            return {
              filteredSubtotalArs: toMoneyString(filtered),
              bySection: {
                fixedArs: toMoneyString(fixed),
                oneTimeArs: toMoneyString(oneTime),
                installmentArs: toMoneyString(installment),
              },
            };
          })
      : Promise.resolve(null);

    if (parsed.data.limit) {
      if (parsed.data.cursor) {
        const cursorExpense = await prisma.expense.findFirst({
          where: { AND: [where, { id: parsed.data.cursor }] },
          select: { id: true },
        });
        if (!cursorExpense) {
          return res.status(400).json({ error: 'Invalid cursor' });
        }
      }

      const pagedExpenses = await prisma.expense.findMany({
        ...baseFindManyArgs,
        take: parsed.data.limit + 1,
        ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
      });
      const [totals, totalCount] = await Promise.all([
        totalsPromise,
        shouldIncludeCount ? prisma.expense.count({ where }) : Promise.resolve(null),
      ]);
      const hasMore = pagedExpenses.length > parsed.data.limit;
      const expenses = hasMore ? pagedExpenses.slice(0, parsed.data.limit) : pagedExpenses;
      const nextCursor = hasMore ? expenses[expenses.length - 1]?.id ?? null : null;

      return res.json({
        month: parsed.data.month,
        warnings: [],
        expenses: expenses.map((expense) => serializeExpense(expense)),
        totals,
        pagination: {
          limit: parsed.data.limit,
          nextCursor,
          hasMore,
          totalCount,
        },
      });
    }

    const [expenses, totals] = await Promise.all([prisma.expense.findMany(baseFindManyArgs), totalsPromise]);

    return res.json({
      month: parsed.data.month,
      warnings: [],
      expenses: expenses.map((expense) => serializeExpense(expense)),
      totals,
      pagination: null,
    });
  });

  app.get('/api/expense-description-suggestions', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = expenseDescriptionSuggestionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const rows = await prisma.expense.findMany({
      where: {
        householdId: auth.householdId,
        description: { contains: parsed.data.q, mode: 'insensitive' },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      select: { description: true },
      take: Math.min(parsed.data.limit * 8, 100),
    });

    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const row of rows) {
      const description = row.description.trim();
      const key = description.toLocaleLowerCase().replace(/\s+/g, ' ');
      if (key.length === 0 || seen.has(key)) {
        continue;
      }
      seen.add(key);
      suggestions.push(description);
      if (suggestions.length >= parsed.data.limit) {
        break;
      }
    }

    return res.json(suggestions);
  });

  app.post('/api/expenses/materialize', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = materializeExpenseMonthSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const warnings = await ensureFixedExpensesForMonth(parsed.data.month, auth.householdId);
    await ensureInstallmentsForMonth(parsed.data.month, auth.householdId);

    return res.json({ month: parsed.data.month, warnings });
  });

  app.post('/api/expenses', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = createExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const existingUser = await prisma.user.findFirst({
      where: { id: parsed.data.paidByUserId, householdId: auth.householdId },
    });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    const category = await prisma.category.findFirst({
      where: { id: parsed.data.categoryId, householdId: auth.householdId },
    });
    if (!category || category.archivedAt) {
      return res.status(400).json({ error: 'Category must exist and be active.' });
    }

    const currencyCode = parsed.data.currencyCode;
    const fxRateUsed = await resolveFxRateForMonth({
      month: parsed.data.month,
      currencyCode,
      householdId: auth.householdId,
      explicitFxRate: parsed.data.fxRate,
    });
    if (!fxRateUsed) {
      return res.status(400).json({
        error: `Missing exchange rate for ${currencyCode} in ${parsed.data.month}. Configure a monthly exchange rate or provide an override.`,
      });
    }

    const installmentPayload = resolveCreateExpenseAmount(parsed.data);
    let amountArs: string;
    try {
      amountArs = computeArsAmount(installmentPayload.amountOriginal, fxRateUsed);
    } catch (error) {
      if (error instanceof RangeError) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    let templateId: string | null = null;
    if (parsed.data.fixed?.enabled) {
      const dayOfMonth = new Date(`${parsed.data.date}T12:00:00.000Z`).getUTCDate();
      const template = await prisma.expenseTemplate.create({
        data: {
          description: parsed.data.description,
          categoryId: parsed.data.categoryId,
          amountOriginal: installmentPayload.amountOriginal,
          amountArs,
          currencyCode,
          fxRate: fxRateUsed,
          paidByUserId: parsed.data.paidByUserId,
          householdId: auth.householdId,
          dayOfMonth,
          isActive: true,
        },
      });
      templateId = template.id;
    }

    const created = await prisma.expense.create({
      data: {
        month: parsed.data.month,
        date: new Date(`${parsed.data.date}T12:00:00.000Z`),
        description: parsed.data.description,
        categoryId: parsed.data.categoryId,
        amountOriginal: installmentPayload.amountOriginal,
        amountArs,
        currencyCode,
        fxRateUsed,
        householdId: auth.householdId,
        templateId,
        paidByUserId: parsed.data.paidByUserId,
        isInstallment: installmentPayload.isInstallment,
        installmentSeriesId: installmentPayload.installmentSeriesId,
        installmentNumber: installmentPayload.installmentNumber,
        installmentTotal: installmentPayload.installmentTotal,
        installmentAmount: installmentPayload.installmentAmount,
        installmentSource: installmentPayload.installmentSource,
        originalTotalAmount: installmentPayload.originalTotalAmount,
        createdFromSeries: installmentPayload.createdFromSeries,
      },
      include: { paidByUser: true, category: { include: { superCategory: true } } },
    });

    return res.status(201).json(serializeExpense(created));
  });

  app.put('/api/expenses/:id', async (req: Request<{ id: string }>, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsedBody = updateExpenseSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error.flatten() });
    }

    const existing = await prisma.expense.findFirst({
      where: { id: req.params.id, householdId: auth.householdId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (parsedBody.data.paidByUserId) {
      const existingUser = await prisma.user.findFirst({
        where: { id: parsedBody.data.paidByUserId, householdId: auth.householdId },
      });
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
    }
    if (parsedBody.data.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: parsedBody.data.categoryId, householdId: auth.householdId },
      });
      if (!category || category.archivedAt) {
        return res.status(400).json({ error: 'Category must exist and be active.' });
      }
    }

    let payload = parsedBody.data;
    if (parsedBody.data.currencyCode || parsedBody.data.fxRate !== undefined) {
      const resolvedCurrencyCode = parsedBody.data.currencyCode ?? normalizeCurrencyCode(existing.currencyCode);
      const resolvedFxRate = await resolveFxRateForMonth({
        month: existing.month,
        currencyCode: resolvedCurrencyCode,
        householdId: auth.householdId,
        explicitFxRate: parsedBody.data.fxRate,
      });
      if (!resolvedFxRate) {
        return res.status(400).json({
          error: `Missing exchange rate for ${resolvedCurrencyCode} in ${existing.month}. Configure a monthly exchange rate or provide an override.`,
        });
      }
      payload = {
        ...payload,
        currencyCode: resolvedCurrencyCode,
        fxRate: Number(resolvedFxRate),
      };
    }

    let updated;
    try {
      updated = await propagateInstallmentUpdate(existing, payload);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to update installment expense.',
      });
    }

    if (parsedBody.data.applyToFuture && updated.templateId) {
      const fxRateUsed = updated.fxRateUsed.toFixed(6);
      await applyTemplateValuesToFutureMonths({
        templateId: updated.templateId,
        householdId: auth.householdId,
        fromMonth: updated.month,
        description: updated.description,
        categoryId: updated.categoryId,
        amountOriginal: updated.amountOriginal.toFixed(2),
        amountArs: updated.amountArs.toFixed(2),
        currencyCode: updated.currencyCode,
        fxRateUsed,
        paidByUserId: updated.paidByUserId,
        dayOfMonth: updated.date.getUTCDate(),
      });
    }

    const withRelations = await prisma.expense.findUniqueOrThrow({
      where: { id: updated.id },
      include: { paidByUser: true, category: { include: { superCategory: true } } },
    });
    if (withRelations.householdId !== auth.householdId) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    return res.json(serializeExpense(withRelations));
  });

  app.delete('/api/expenses/:id', async (req: Request<{ id: string }>, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsedBody = deleteExpenseSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error.flatten() });
    }

    const existing = await prisma.expense.findFirst({
      where: { id: req.params.id, householdId: auth.householdId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (existing.isInstallment) {
      await propagateInstallmentDelete(existing, parsedBody.data.applyScope);
      return res.status(204).send();
    }

    if (existing.templateId) {
      await deleteFixedExpense(existing, parsedBody.data.applyScope);
      return res.status(204).send();
    }

    await prisma.expense.delete({ where: { id: existing.id } });
    return res.status(204).send();
  });

  // Aggregates for the dashboard, which needs per-category and per-user sums but
  // not the rows themselves. Fetching the whole month's expenses just to reduce
  // them in the page grows with account age; these sums do not.
  app.get('/api/expense-totals', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = expenseMonthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const month = parsed.data.month;
    const where = { month, householdId: auth.householdId };
    const [categoryGroups, userGroups] = await Promise.all([
      prisma.expense.groupBy({ by: ['categoryId'], where, _sum: { amountArs: true } }),
      prisma.expense.groupBy({ by: ['paidByUserId'], where, _sum: { amountArs: true } }),
    ]);

    const categories = categoryGroups.length
      ? await prisma.category.findMany({
          where: { id: { in: categoryGroups.map((group) => group.categoryId) } },
          select: {
            id: true,
            name: true,
            superCategory: { select: { id: true, name: true, color: true, icon: true } },
          },
        })
      : [];
    const categoryById = new Map(categories.map((category) => [category.id, category]));

    let total = new Decimal(0);
    const byCategory = categoryGroups
      .map((group) => {
        const groupSum = new Decimal((group._sum.amountArs ?? 0).toString());
        total = total.plus(groupSum);
        const category = categoryById.get(group.categoryId);
        return {
          categoryId: group.categoryId,
          categoryName: category?.name ?? '',
          superCategoryId: category?.superCategory?.id ?? null,
          superCategoryName: category?.superCategory?.name ?? null,
          superCategoryColor: category?.superCategory?.color ?? null,
          superCategoryIcon: category?.superCategory
            ? resolveCategoryIcon(category.superCategory.icon, category.superCategory.name)
            : null,
          totalArs: toMoneyString(groupSum),
        };
      })
      .sort((a, b) => Number(b.totalArs) - Number(a.totalArs));

    const byUser: Record<string, string> = {};
    for (const group of userGroups) {
      byUser[group.paidByUserId] = toMoneyString(group._sum.amountArs ?? 0);
    }

    return res.json({
      month,
      warnings: [],
      totalArs: toMoneyString(total),
      byCategory,
      byUser,
    });
  });

  app.get('/api/settlement', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = expenseMonthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const month = parsed.data.month;
    const [users, incomes, expenses, household] = await Promise.all([
      prisma.user.findMany({ where: { householdId: auth.householdId }, orderBy: { createdAt: 'asc' } }),
      prisma.monthlyIncome.findMany({ where: { month, householdId: auth.householdId } }),
      prisma.expense.findMany({ where: { month, householdId: auth.householdId } }),
      prisma.household.findUniqueOrThrow({
        where: { id: auth.householdId },
        select: {
          splitMethod: true,
          splitShares: { select: { userId: true, percentage: true } },
        },
      }),
    ]);

    const incomesByUser: Record<string, string> = {};
    const paidByUser: Record<string, string> = {};

    for (const user of users) {
      incomesByUser[user.id] = '0';
      paidByUser[user.id] = '0';
    }

    for (const income of incomes) {
      incomesByUser[income.userId] = new Decimal(incomesByUser[income.userId]).plus(income.amount).toString();
    }

    for (const expense of expenses) {
      paidByUser[expense.paidByUserId] = new Decimal(paidByUser[expense.paidByUserId])
        .plus(expense.amountArs)
        .toString();
    }

    try {
      const customPercentagesByUser =
        household.splitMethod === 'custom'
          ? Object.fromEntries(
              household.splitShares.map((share) => [share.userId, share.percentage.toString()]),
            )
          : undefined;
      const settlement = calculateSettlement({
        incomesByUser,
        paidByUser,
        customPercentagesByUser,
      });

      return res.json({
        month,
        splitMethod: settlement.splitMethod,
        totalIncome: settlement.totalIncome,
        totalExpenses: settlement.totalExpenses,
        expenseRatio: settlement.expenseRatio,
        splitPercentageByUser: settlement.splitPercentageByUser,
        fairShareByUser: settlement.fairShareByUser,
        paidByUser: settlement.paidByUser,
        differenceByUser: settlement.differenceByUser,
        transfer: settlement.transfer,
      });
    } catch (error) {
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : 'Unable to calculate settlement for the provided month.',
      });
    }
  });

  options.configureApp?.(app);

  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (res.headersSent) {
      req.log.error({ err: error }, 'Unhandled API error after headers were sent');
      return;
    }

    res.status(500);
    logErrorAndDisableAutoLog(req, res, error, 'Unhandled API request failure');
    res.status(500).json({ error: 'Internal server error.' });
  };

  app.use(errorHandler);

  return app;
};
