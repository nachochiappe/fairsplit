import 'dotenv/config';
import 'express-async-errors';
import { randomBytes } from 'node:crypto';
import cors from 'cors';
import Decimal from 'decimal.js';
import express, { type ErrorRequestHandler, Express, Request, Response } from 'express';
import { prisma } from '@fairsplit/db';
import type { Logger } from '@fairsplit/logging';
import {
  applyScopeSchema,
  calculateSettlement,
  currencyCodeSchema,
  createExpenseSchema,
  monthSchema,
  replaceIncomeEntriesSchema,
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
  computeArsAmount,
  deleteFixedExpense,
  ensureFixedExpensesForMonth,
  resolveFxRateForMonth,
} from './lib/fixed-expenses';
import { createApiHttpLogger, createApiLogger } from './lib/logger';
import { getSessionSecret, issueSessionToken, verifySessionToken } from './lib/session';
import { verifySupabaseAccessToken } from './lib/supabase-auth';

const monthQuerySchema = z.object({
  month: monthSchema,
  hydrate: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
});
const expenseListQuerySchema = z.object({
  month: monthSchema,
  search: z.string().trim().min(1).optional(),
  categoryId: z.string().min(1).optional(),
  paidByUserId: z.string().min(1).optional(),
  type: z.enum(['oneTime', 'fixed', 'installment']).optional(),
  sortBy: z.enum(['date', 'description', 'category', 'amountArs', 'paidBy']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
  hydrate: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
  includeCount: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
  includeTotals: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
}).superRefine((value, ctx) => {
  if (value.cursor && !value.limit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cursor'],
      message: 'cursor requires limit',
    });
  }
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
const createUserSchema = z.object({ name: z.string().min(1) });
const updateUserSchema = z.object({ name: z.string().trim().min(1) });
const deleteExpenseSchema = z.object({ applyScope: applyScopeSchema.optional() });
const createCategorySchema = z.object({
  name: z.string().trim().min(1),
  superCategoryId: z.string().min(1).nullable().optional(),
});
const renameCategorySchema = z.object({ name: z.string().trim().min(1) });
const archiveCategorySchema = z.object({ replacementCategoryId: z.string().min(1).optional() });
const createSuperCategorySchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().min(1).optional(),
  icon: z.string().trim().min(1).optional(),
  sortOrder: z.coerce.number().int().optional(),
});
const updateSuperCategorySchema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z.string().trim().min(1).optional(),
  icon: z.string().trim().min(1).optional(),
  sortOrder: z.coerce.number().int().optional(),
});
const archiveSuperCategorySchema = z.object({ replacementSuperCategoryId: z.string().min(1).optional() });
const assignCategorySuperCategorySchema = z.object({ superCategoryId: z.string().min(1).nullable() });
const upsertMonthlyExchangeRateSchema = z.object({
  month: monthSchema,
  currencyCode: currencyCodeSchema,
  rateToArs: z.coerce.number().gt(0),
});
const authLinkSchema = z.object({
  accessToken: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
});
const joinHouseholdWithCodeSchema = z.object({
  code: z.string().trim().min(4).max(64),
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
    archivedAt: Date | null;
    superCategoryId: string | null;
    superCategory: { id: string; name: string; color: string } | null;
    _count: { expenses: number; expenseTemplates: number };
  },
) {
  return {
    id: category.id,
    name: category.name,
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
    icon: string | null;
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
    icon: superCategory.icon,
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

interface RequestAuthContext {
  userId: string;
  householdId: string;
}

interface RequestUserContext {
  userId: string;
  householdId: string | null;
  onboardingHouseholdDecisionAt: Date | null;
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

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      householdId: true,
      onboardingHouseholdDecisionAt: true,
      sessionRevokedAt: true,
    },
  });
  if (!user) {
    res.status(401);
    logWarnAndDisableAutoLog(req, res, 'Rejected API request for missing user');
    res.status(401).json({ error: 'Invalid authentication context.' });
    return null;
  }
  const revokedAt = user.sessionRevokedAt ? Math.floor(user.sessionRevokedAt.getTime() / 1000) : null;
  if (revokedAt !== null && session.iat <= revokedAt) {
    res.status(401);
    logWarnAndDisableAutoLog(req, res, 'Rejected API request for revoked session');
    res.status(401).json({ error: 'Invalid authentication context.' });
    return null;
  }

  return {
    userId: user.id,
    householdId: user.householdId,
    onboardingHouseholdDecisionAt: user.onboardingHouseholdDecisionAt,
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
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/link', async (req: Request, res: Response) => {
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

    const toResponse = (user: {
      id: string;
      name: string;
      email: string | null;
      authUserId: string | null;
      householdId: string | null;
      onboardingHouseholdDecisionAt: Date | null;
      createdAt: Date;
      household: { id: string; name: string; createdAt: Date } | null;
    }, created: boolean) => ({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        authUserId: user.authUserId,
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
    });

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

      const decisionAt = new Date();
      const created = await prisma.$transaction(async (tx) => {
        const household = await tx.household.create({
          data: {
            name: `${displayName}'s Household`,
          },
        });

        return tx.user.create({
          data: {
            name: displayName,
            email,
            authUserId,
            householdId: household.id,
            onboardingHouseholdDecisionAt: decisionAt,
          },
          include: { household: true },
        });
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

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    const user = await requireUserContext(req, res);
    if (!user) {
      return;
    }

    await prisma.user.update({
      where: { id: user.userId },
      data: { sessionRevokedAt: new Date(Date.now() + 1000) },
    });

    res.status(204).send();
  });

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

  app.post('/api/household/invites', async (req: Request, res: Response) => {
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

  app.post('/api/household/join-with-code', async (req: Request, res: Response) => {
    const auth = await requireUserContext(req, res);
    if (!auth) {
      return;
    }
    if (auth.householdId || auth.onboardingHouseholdDecisionAt) {
      return res.status(409).json({ error: 'Household setup has already been completed.' });
    }

    const parsed = joinHouseholdWithCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
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

    const decisionAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.updateMany({
        where: {
          id: auth.userId,
          householdId: null,
          onboardingHouseholdDecisionAt: null,
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
      data: { name: parsed.data.name, householdId: auth.householdId },
    });
    return res.status(201).json({
      id: user.id,
      name: user.name,
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
      data: { name: parsed.data.name },
    });

    return res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
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

    const parsed = renameCategorySchema.safeParse(req.body);
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
        data: { name: parsed.data.name },
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
      logErrorAndDisableAutoLog(req, res, error, 'Failed to rename category');
      return res.status(500).json({ error: 'Failed to rename category.' });
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
          icon: parsed.data.icon ?? null,
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

    const superCategory = await prisma.superCategory.findFirst({
      where: { id: req.params.id, householdId: auth.householdId },
      select: { id: true },
    });
    if (!superCategory) {
      return res.status(404).json({ error: 'Super category not found.' });
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

    const source = await prisma.superCategory.findFirst({
      where: { id: req.params.id, householdId: auth.householdId },
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
            if (monthRate) {
              fxRateUsed = monthRate;
            } else if (entry.fxRate !== undefined) {
              const normalizedFxRate = new Decimal(entry.fxRate).toFixed(6);
              const existingRate = await tx.monthlyExchangeRate.findFirst({
                where: {
                  householdId: auth.householdId,
                  month: parsed.data.month,
                  currencyCode,
                },
                select: { id: true },
              });
              const upsertedRate = existingRate
                ? await tx.monthlyExchangeRate.update({
                    where: { id: existingRate.id },
                    data: { rateToArs: normalizedFxRate },
                  })
                : await tx.monthlyExchangeRate.create({
                    data: {
                      month: parsed.data.month,
                      currencyCode,
                      rateToArs: normalizedFxRate,
                      householdId: auth.householdId,
                    },
                  });
              fxRateUsed = upsertedRate.rateToArs.toFixed(6);
              monthRateByCurrency.set(currencyCode, fxRateUsed);
            } else {
              throw new Error(
                `Missing FX rate for ${currencyCode} in ${parsed.data.month}. Configure monthly FX or provide an override.`,
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
      if (error instanceof Error && error.message.startsWith('Missing FX rate')) {
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

    const shouldHydrate = parsed.data.hydrate ?? !parsed.data.cursor;
    const shouldIncludeCount = parsed.data.includeCount ?? true;
    const generationWarnings: string[] = [];
    if (shouldHydrate) {
      generationWarnings.push(...(await ensureFixedExpensesForMonth(parsed.data.month, auth.householdId)));
      await ensureInstallmentsForMonth(parsed.data.month, auth.householdId);
    }

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
    const totalsPromise = shouldIncludeTotals
      ? Promise.all([
          prisma.expense.aggregate({ where: baseWhere, _sum: { amountArs: true } }),
          prisma.expense.aggregate({
            where: withExpenseTypeConstraint(baseWhere, 'fixed'),
            _sum: { amountArs: true },
          }),
          prisma.expense.aggregate({
            where: withExpenseTypeConstraint(baseWhere, 'oneTime'),
            _sum: { amountArs: true },
          }),
          prisma.expense.aggregate({
            where: withExpenseTypeConstraint(baseWhere, 'installment'),
            _sum: { amountArs: true },
          }),
        ]).then(([filteredTotal, fixedTotal, oneTimeTotal, installmentTotal]) => ({
          filteredSubtotalArs: toMoneyString(filteredTotal._sum.amountArs ?? 0),
          bySection: {
            fixedArs: toMoneyString(fixedTotal._sum.amountArs ?? 0),
            oneTimeArs: toMoneyString(oneTimeTotal._sum.amountArs ?? 0),
            installmentArs: toMoneyString(installmentTotal._sum.amountArs ?? 0),
          },
        }))
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
        warnings: generationWarnings,
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
      warnings: generationWarnings,
      expenses: expenses.map((expense) => serializeExpense(expense)),
      totals,
      pagination: null,
    });
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
        error: `Missing FX rate for ${currencyCode} in ${parsed.data.month}. Configure monthly FX or provide an override.`,
      });
    }

    const installmentPayload = resolveCreateExpenseAmount(parsed.data);
    const amountArs = computeArsAmount(installmentPayload.amountOriginal, fxRateUsed);

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
          error: `Missing FX rate for ${resolvedCurrencyCode} in ${existing.month}. Configure monthly FX or provide an override.`,
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

  app.get('/api/settlement', async (req: Request, res: Response) => {
    const auth = await requireAuthContext(req, res);
    if (!auth) {
      return;
    }

    const parsed = monthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const month = parsed.data.month;
    const shouldHydrate = parsed.data.hydrate ?? true;

    if (shouldHydrate) {
      await ensureFixedExpensesForMonth(month, auth.householdId);
      await ensureInstallmentsForMonth(month, auth.householdId);
    }

    const [users, incomes, expenses] = await Promise.all([
      prisma.user.findMany({ where: { householdId: auth.householdId }, orderBy: { createdAt: 'asc' } }),
      prisma.monthlyIncome.findMany({ where: { month, householdId: auth.householdId } }),
      prisma.expense.findMany({ where: { month, householdId: auth.householdId } }),
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
      const settlement = calculateSettlement({ incomesByUser, paidByUser });

      return res.json({
        month,
        totalIncome: settlement.totalIncome,
        totalExpenses: settlement.totalExpenses,
        expenseRatio: settlement.expenseRatio,
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
