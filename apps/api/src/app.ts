import 'dotenv/config';
import cors from 'cors';
import Decimal from 'decimal.js';
import express, { Express, Request, Response } from 'express';
import { prisma } from '@fairsplit/db';
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
}).superRefine((value, ctx) => {
  if (value.cursor && !value.limit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cursor'],
      message: 'cursor requires limit',
    });
  }
});
const createUserSchema = z.object({ name: z.string().min(1) });
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
  authUserId: z.string().trim().min(1),
  email: z.string().trim().email(),
  householdId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
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

export const createApp = (): Express => {
  const app = express();
  const normalizeCurrencyCode = (value: string) => {
    const parsed = currencyCodeSchema.safeParse(value);
    return parsed.success ? parsed.data : 'ARS';
  };

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

    const authUserId = parsed.data.authUserId;
    const email = parsed.data.email.trim().toLowerCase();
    const householdId = parsed.data.householdId?.trim();
    const displayName = parsed.data.name?.trim() ?? defaultNameFromEmail(email);

    const toResponse = (user: {
      id: string;
      name: string;
      email: string | null;
      authUserId: string | null;
      householdId: string | null;
      createdAt: Date;
      household: { id: string; name: string; createdAt: Date } | null;
    }, created: boolean) => ({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        authUserId: user.authUserId,
        householdId: user.householdId,
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
    });

    try {
      const linkedByAuthId = await prisma.user.findUnique({
        where: { authUserId },
        include: { household: true },
      });
      if (linkedByAuthId) {
        return res.json(toResponse(linkedByAuthId, false));
      }

      const candidateWhere = householdId
        ? { email: { equals: email, mode: 'insensitive' as const }, householdId, authUserId: null }
        : { email: { equals: email, mode: 'insensitive' as const }, authUserId: null };

      const candidateMatches = await prisma.user.findMany({
        where: candidateWhere,
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

      if (householdId) {
        const existingHousehold = await prisma.household.findUnique({
          where: { id: householdId },
        });
        if (!existingHousehold) {
          return res.status(404).json({ error: 'Household not found.' });
        }

        const createdInExistingHousehold = await prisma.user.create({
          data: {
            name: displayName,
            email,
            authUserId,
            householdId: existingHousehold.id,
          },
          include: { household: true },
        });

        return res.status(201).json(toResponse(createdInExistingHousehold, true));
      }

      const created = await prisma.$transaction(async (tx) => {
        const household = await tx.household.create({
          data: {
            name: `${displayName}'s Household`,
          },
        });
        const user = await tx.user.create({
          data: {
            name: displayName,
            email,
            authUserId,
            householdId: household.id,
          },
          include: { household: true },
        });
        return user;
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

      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to link auth identity.',
      });
    }
  });

  app.get('/api/months', async (_req: Request, res: Response) => {
    const [incomeMonths, expenseMonths] = await Promise.all([
      prisma.monthlyIncome.findMany({ distinct: ['month'], select: { month: true } }),
      prisma.expense.findMany({ distinct: ['month'], select: { month: true } }),
    ]);

    const months = Array.from(new Set([...incomeMonths, ...expenseMonths].map((entry) => entry.month))).sort();
    res.json(months);
  });

  app.get('/api/users', async (_req: Request, res: Response) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(
      users.map((user) => ({
        id: user.id,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
      })),
    );
  });

  app.post('/api/users', async (req: Request, res: Response) => {
    const parsed = createUserSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const user = await prisma.user.create({ data: { name: parsed.data.name } });
    return res.status(201).json({
      id: user.id,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    });
  });

  app.get('/api/categories', async (_req: Request, res: Response) => {
    const categories = await prisma.category.findMany({
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

  app.get('/api/super-categories', async (_req: Request, res: Response) => {
    const superCategories = await prisma.superCategory.findMany({
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
    const parsed = createCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    if (parsed.data.superCategoryId) {
      const superCategory = await prisma.superCategory.findUnique({
        where: { id: parsed.data.superCategoryId },
      });
      if (!superCategory || superCategory.archivedAt) {
        return res.status(400).json({ error: 'Super category must exist and be active.' });
      }
    }

    try {
      const created = await prisma.category.create({
        data: {
          name: parsed.data.name,
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
      return res.status(409).json({ error: 'Category name already exists.' });
    }
  });

  app.put('/api/categories/:id', async (req: Request<{ id: string }>, res: Response) => {
    const parsed = renameCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
      const updated = await prisma.category.update({
        where: { id: req.params.id },
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
      return res.status(404).json({ error: 'Category not found or name already exists.' });
    }
  });

  app.put('/api/categories/:id/super-category', async (req: Request<{ id: string }>, res: Response) => {
    const parsed = assignCategorySuperCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    if (parsed.data.superCategoryId) {
      const superCategory = await prisma.superCategory.findUnique({
        where: { id: parsed.data.superCategoryId },
      });
      if (!superCategory || superCategory.archivedAt) {
        return res.status(400).json({ error: 'Super category must exist and be active.' });
      }
    }

    try {
      const updated = await prisma.category.update({
        where: { id: req.params.id },
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
    if (!sourceCategory) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const isInUse = sourceCategory._count.expenses > 0 || sourceCategory._count.expenseTemplates > 0;
    if (isInUse && !parsed.data.replacementCategoryId) {
      return res.status(400).json({
        error: 'This category has assigned expenses. Choose a replacement category before archiving.',
      });
    }

    const replacementCategory = parsed.data.replacementCategoryId
      ? await prisma.category.findUnique({
          where: { id: parsed.data.replacementCategoryId },
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
          where: { categoryId: sourceCategory.id },
          data: { categoryId: replacementCategory.id },
        });
        await tx.expenseTemplate.updateMany({
          where: { categoryId: sourceCategory.id },
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

  app.post('/api/super-categories', async (req: Request, res: Response) => {
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
      return res.status(409).json({ error: 'Super category name already exists.' });
    }
  });

  app.put('/api/super-categories/:id', async (req: Request<{ id: string }>, res: Response) => {
    const parsed = updateSuperCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ error: 'At least one field is required.' });
    }

    try {
      const updated = await prisma.superCategory.update({
        where: { id: req.params.id },
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
      return res.status(404).json({ error: 'Super category not found or name already exists.' });
    }
  });

  app.post('/api/super-categories/:id/archive', async (req: Request<{ id: string }>, res: Response) => {
    const parsed = archiveSuperCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const source = await prisma.superCategory.findUnique({
      where: { id: req.params.id },
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
      ? await prisma.superCategory.findUnique({
          where: { id: parsed.data.replacementSuperCategoryId },
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
        where: { superCategoryId: source.id },
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
    const parsed = monthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const rates = await prisma.monthlyExchangeRate.findMany({
      where: { month: parsed.data.month },
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
    const parsed = upsertMonthlyExchangeRateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const rate = await prisma.monthlyExchangeRate.upsert({
      where: {
        month_currencyCode: {
          month: parsed.data.month,
          currencyCode: parsed.data.currencyCode,
        },
      },
      update: {
        rateToArs: new Decimal(parsed.data.rateToArs).toFixed(6),
      },
      create: {
        month: parsed.data.month,
        currencyCode: parsed.data.currencyCode,
        rateToArs: new Decimal(parsed.data.rateToArs).toFixed(6),
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
    const parsed = monthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const incomes = await prisma.monthlyIncome.findMany({
      where: { month: parsed.data.month },
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
    const parsed = replaceIncomeEntriesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const existingUser = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
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
              const upsertedRate = await tx.monthlyExchangeRate.upsert({
                where: {
                  month_currencyCode: {
                    month: parsed.data.month,
                    currencyCode,
                  },
                },
                update: {
                  rateToArs: normalizedFxRate,
                },
                create: {
                  month: parsed.data.month,
                  currencyCode,
                  rateToArs: normalizedFxRate,
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
    const parsed = expenseListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const shouldHydrate = parsed.data.hydrate ?? !parsed.data.cursor;
    const shouldIncludeCount = parsed.data.includeCount ?? true;
    const generationWarnings: string[] = [];
    if (shouldHydrate) {
      generationWarnings.push(...(await ensureFixedExpensesForMonth(parsed.data.month)));
      await ensureInstallmentsForMonth(parsed.data.month);
    }

    const where: Record<string, unknown> = { month: parsed.data.month };
    if (parsed.data.search) {
      where.OR = [
        { description: { contains: parsed.data.search, mode: 'insensitive' } },
        { category: { name: { contains: parsed.data.search, mode: 'insensitive' } } },
        { paidByUser: { name: { contains: parsed.data.search, mode: 'insensitive' } } },
      ];
    }
    if (parsed.data.categoryId) {
      where.categoryId = parsed.data.categoryId;
    }
    if (parsed.data.paidByUserId) {
      where.paidByUserId = parsed.data.paidByUserId;
    }
    if (parsed.data.type === 'oneTime') {
      where.templateId = null;
      where.isInstallment = false;
    } else if (parsed.data.type === 'fixed') {
      where.templateId = { not: null };
    } else if (parsed.data.type === 'installment') {
      where.isInstallment = true;
    }

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
      const totalCount = shouldIncludeCount ? await prisma.expense.count({ where }) : null;

      const hasMore = pagedExpenses.length > parsed.data.limit;
      const expenses = hasMore ? pagedExpenses.slice(0, parsed.data.limit) : pagedExpenses;
      const nextCursor = hasMore ? expenses[expenses.length - 1]?.id ?? null : null;

      return res.json({
        month: parsed.data.month,
        warnings: generationWarnings,
        expenses: expenses.map((expense) => serializeExpense(expense)),
        pagination: {
          limit: parsed.data.limit,
          nextCursor,
          hasMore,
          totalCount,
        },
      });
    }

    const expenses = await prisma.expense.findMany(baseFindManyArgs);

    return res.json({
      month: parsed.data.month,
      warnings: generationWarnings,
      expenses: expenses.map((expense) => serializeExpense(expense)),
      pagination: null,
    });
  });

  app.post('/api/expenses', async (req: Request, res: Response) => {
    const parsed = createExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const existingUser = await prisma.user.findUnique({ where: { id: parsed.data.paidByUserId } });
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId } });
    if (!category || category.archivedAt) {
      return res.status(400).json({ error: 'Category must exist and be active.' });
    }

    const householdId = existingUser.householdId ?? category.householdId ?? null;
    if (!householdId) {
      return res.status(400).json({ error: 'User and category must belong to a household.' });
    }
    if (existingUser.householdId && category.householdId && existingUser.householdId !== category.householdId) {
      return res.status(400).json({ error: 'User and category must belong to the same household.' });
    }

    const currencyCode = parsed.data.currencyCode;
    const fxRateUsed = await resolveFxRateForMonth({
      month: parsed.data.month,
      currencyCode,
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
          householdId,
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
        householdId,
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
    const parsedBody = updateExpenseSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error.flatten() });
    }

    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    if (parsedBody.data.paidByUserId) {
      const existingUser = await prisma.user.findUnique({ where: { id: parsedBody.data.paidByUserId } });
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
    }
    if (parsedBody.data.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: parsedBody.data.categoryId } });
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
    return res.json(serializeExpense(withRelations));
  });

  app.delete('/api/expenses/:id', async (req: Request<{ id: string }>, res: Response) => {
    const parsedBody = deleteExpenseSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return res.status(400).json({ error: parsedBody.error.flatten() });
    }

    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
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
    const parsed = monthQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const month = parsed.data.month;
    const shouldHydrate = parsed.data.hydrate ?? true;

    if (shouldHydrate) {
      await ensureFixedExpensesForMonth(month);
      await ensureInstallmentsForMonth(month);
    }

    const [users, incomes, expenses] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.monthlyIncome.findMany({ where: { month } }),
      prisma.expense.findMany({ where: { month } }),
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

  return app;
};
