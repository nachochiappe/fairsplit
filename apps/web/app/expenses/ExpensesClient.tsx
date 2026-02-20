'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { computeInstallmentAmounts } from '@fairsplit/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AppShell } from '../../components/AppShell';
import { ActionButton } from '../../components/ActionButton';
import { MonthSelector } from '../../components/MonthSelector';
import { formatMoney } from '../../lib/currency';
import {
  DEFAULT_MAX_ROWS_PER_SECTION,
  getSectionFetchBatchSize,
  PREFETCH_AHEAD_PAGES,
  SECTION_CACHE_TTL_MS,
} from './pagination';
import {
  Category,
  createExpense,
  deleteExpense,
  ExchangeRate,
  Expense,
  getExchangeRates,
  getExpenses,
  getSettlement,
  updateExpense,
  upsertExchangeRate,
  User,
} from '../../lib/api';

type ApplyScope = 'single' | 'future' | 'all';
type ScopeAction = 'update' | 'delete';
type ExpenseSortField = 'date' | 'description' | 'category' | 'amountArs' | 'paidBy';
type SortDirection = 'asc' | 'desc';
type ExpenseSectionKey = 'fixed' | 'oneTime' | 'installment';
const supportedCurrencyCodes = ['ARS', 'USD', 'EUR'] as const;
type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number];
const currencyCodeSchema = z.enum(supportedCurrencyCodes);
const DEFAULT_CURRENCY_CODE: SupportedCurrencyCode = 'ARS';
const cardClass = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm';
const fieldClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';
const compactFieldClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';
const tableControlLabelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500';
const tableControlFieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';
const primaryButtonClass =
  'rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass =
  'rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const SEARCH_DEBOUNCE_MS = 350;
const NO_INCOME_SETTLEMENT_ERROR = 'Cannot calculate settlement when total income is non-positive';
const NO_INCOME_WARNING = 'No incomes are set for this month yet. Add incomes to calculate a fair settlement.';

function getTodayDateInputValue() {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function dateInputValueToMonth(value: string) {
  return value.slice(0, 7);
}

function toSupportedCurrencyCode(value: string): SupportedCurrencyCode {
  const normalizedValue = value.trim().toUpperCase();
  return supportedCurrencyCodes.includes(normalizedValue as SupportedCurrencyCode)
    ? (normalizedValue as SupportedCurrencyCode)
    : DEFAULT_CURRENCY_CODE;
}

const expenseSchema = z
  .object({
    date: z.string().date(),
    description: z.string().min(1),
    categoryId: z.string().min(1),
    amount: z.coerce.number().min(0).optional(),
    currencyCode: currencyCodeSchema,
    fxRate: z.coerce.number().gt(0).optional(),
    paidByUserId: z.string().min(1),
    fixedEnabled: z.boolean().default(false),
    applyToFuture: z.boolean().default(true),
    installmentEnabled: z.boolean().default(false),
    installmentCount: z.coerce.number().int().min(2).optional(),
    installmentEntryMode: z.enum(['perInstallment', 'total']).optional(),
    totalAmount: z.coerce.number().min(0).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.installmentEnabled && value.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Amount is required',
        path: ['amount'],
      });
    }

    if (!value.installmentEnabled) {
      return;
    }

    if (!value.installmentCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Installment count is required',
        path: ['installmentCount'],
      });
    }

    if (!value.installmentEntryMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Entry mode is required',
        path: ['installmentEntryMode'],
      });
      return;
    }

    if (value.installmentEntryMode === 'perInstallment' && value.amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Per-installment amount is required',
        path: ['amount'],
      });
    }

    if (value.installmentEntryMode === 'total' && value.totalAmount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Total amount is required',
        path: ['totalAmount'],
      });
    }
  });

type ExpenseForm = z.infer<typeof expenseSchema>;

interface ScopeDialogState {
  action: ScopeAction;
  expense: Expense;
  values?: ExpenseForm;
}

type ConfirmationAction = 'clone' | 'delete';

interface ConfirmationDialogState {
  action: ConfirmationAction;
  expense: Expense;
}

function ScopeDialog({
  title,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (scope: ApplyScope) => void;
}) {
  const [scope, setScope] = useState<ApplyScope>('future');

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        aria-labelledby="scope-dialog-title"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        role="dialog"
      >
        <h3 className="text-base font-semibold text-slate-900" id="scope-dialog-title">
          {title}
        </h3>
        <fieldset className="mt-3 space-y-2 text-sm text-slate-700">
          <legend className="sr-only">Select which expenses to apply this action to</legend>
          <label className="flex items-center gap-2">
            <input checked={scope === 'future'} onChange={() => setScope('future')} type="radio" />
            This and future
          </label>
          <label className="flex items-center gap-2">
            <input checked={scope === 'single'} onChange={() => setScope('single')} type="radio" />
            Only this one
          </label>
          <label className="flex items-center gap-2">
            <input checked={scope === 'all'} onChange={() => setScope('all')} type="radio" />
            Whole series
          </label>
        </fieldset>
        <div className="mt-4 flex gap-2">
          <button
            className={primaryButtonClass}
            disabled={busy}
            onClick={() => onConfirm(scope)}
            type="button"
          >
            Confirm
          </button>
          <button
            className={secondaryButtonClass}
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmationDialog({
  title,
  message,
  busy,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  busy: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        aria-labelledby="confirmation-dialog-title"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        role="dialog"
      >
        <h3 className="text-base font-semibold text-slate-900" id="confirmation-dialog-title">
          {title}
        </h3>
        <p className="mt-2 text-sm text-slate-700">{message}</p>
        <div className="mt-4 flex gap-2">
          <button
            className={primaryButtonClass}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
          <button
            className={secondaryButtonClass}
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface ExpensesClientProps {
  month: string;
  initialUsers: User[];
  initialExpenses: Expense[];
  initialWarnings: string[];
  initialSectionPagination: SectionPaginationMap;
  initialCategories: Category[];
  initialExchangeRates: ExchangeRate[];
  initialTotalExpensesArs: string;
}

interface SectionPaginationState {
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number | null;
}

type SectionPaginationMap = Record<ExpenseSectionKey, SectionPaginationState>;

const sectionTypeMap: Record<ExpenseSectionKey, 'fixed' | 'oneTime' | 'installment'> = {
  fixed: 'fixed',
  oneTime: 'oneTime',
  installment: 'installment',
};

function makeSectionTimestampMap(value: number): Record<ExpenseSectionKey, number> {
  return {
    fixed: value,
    oneTime: value,
    installment: value,
  };
}

function makeSectionPromiseMap(): Record<ExpenseSectionKey, Promise<void> | null> {
  return {
    fixed: null,
    oneTime: null,
    installment: null,
  };
}

function makeSectionPrefetchTargetMap(): Record<ExpenseSectionKey, string | null> {
  return {
    fixed: null,
    oneTime: null,
    installment: null,
  };
}

function mergeUniqueExpenses(expenses: Expense[]): Expense[] {
  const dedupedById = new Map<string, Expense>();
  for (const expense of expenses) {
    dedupedById.set(expense.id, expense);
  }
  return Array.from(dedupedById.values());
}

function sumExpensesArs(expenses: Expense[]): number {
  return expenses.reduce((sum, expense) => sum + Number(expense.amountArs), 0);
}

export function ExpensesClient({
  month,
  initialUsers,
  initialExpenses,
  initialWarnings,
  initialSectionPagination,
  initialCategories,
  initialExchangeRates,
  initialTotalExpensesArs,
}: ExpensesClientProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [warnings, setWarnings] = useState<string[]>(initialWarnings);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(initialExchangeRates);
  const [totalCombinedExpensesArs, setTotalCombinedExpensesArs] = useState<number>(Number(initialTotalExpensesArs));
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [scopeDialog, setScopeDialog] = useState<ScopeDialogState | null>(null);
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialogState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFxCurrency, setNewFxCurrency] = useState<SupportedCurrencyCode>('USD');
  const [newFxRate, setNewFxRate] = useState('');
  const [maxRowsPerSection, setMaxRowsPerSection] = useState<10 | 25 | 50>(DEFAULT_MAX_ROWS_PER_SECTION);
  const fetchBatchSize = useMemo(() => getSectionFetchBatchSize(maxRowsPerSection), [maxRowsPerSection]);
  const [sectionPages, setSectionPages] = useState<Record<ExpenseSectionKey, number>>({
    fixed: 1,
    oneTime: 1,
    installment: 1,
  });
  const [sectionPagination, setSectionPagination] = useState<SectionPaginationMap>(initialSectionPagination);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [sortField, setSortField] = useState<ExpenseSortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [isMobileFxOpen, setIsMobileFxOpen] = useState(false);
  const [isMobileAddExpenseOpen, setIsMobileAddExpenseOpen] = useState(false);
  const expensesRef = useRef(expenses);
  const warningsRef = useRef(warnings);
  const sectionPaginationRef = useRef(sectionPagination);
  const sectionFetchInFlightRef = useRef<Record<ExpenseSectionKey, Promise<void> | null>>(makeSectionPromiseMap());
  const sectionCacheFetchedAtRef = useRef<Record<ExpenseSectionKey, number>>(makeSectionTimestampMap(Date.now()));
  const sectionPrefetchTargetRef = useRef<Record<ExpenseSectionKey, string | null>>(makeSectionPrefetchTargetMap());
  const fxCurrencies = useMemo(() => supportedCurrencyCodes.filter((code) => code !== 'ARS'), []);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.archivedAt === null),
    [categories],
  );
  const sortedActiveCategories = useMemo(
    () => [...activeCategories].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [activeCategories],
  );
  const hasActiveFilters = useMemo(
    () => Boolean(searchQuery.trim()) || selectedCategoryId !== 'all',
    [searchQuery, selectedCategoryId],
  );
  const hasActiveControls = useMemo(
    () => hasActiveFilters || sortField !== 'date' || sortDirection !== 'desc',
    [hasActiveFilters, sortDirection, sortField],
  );
  const mobileControlsCount = useMemo(() => {
    let count = 0;
    if (selectedCategoryId !== 'all') count += 1;
    if (sortField !== 'date') count += 1;
    if (sortDirection !== 'desc') count += 1;
    return count;
  }, [selectedCategoryId, sortDirection, sortField]);
  const applyClientControls = useCallback(
    (list: Expense[]) => {
      const searchTerm = debouncedSearchQuery.trim().toLowerCase();
      const withFilters = list.filter((expense) => {
        if (selectedCategoryId !== 'all' && expense.categoryId !== selectedCategoryId) {
          return false;
        }
        if (!searchTerm) {
          return true;
        }
        const searchableText = `${expense.description} ${expense.categoryName} ${expense.paidByUserName}`.toLowerCase();
        return searchableText.includes(searchTerm);
      });

      const sorted = [...withFilters];
      sorted.sort((left, right) => {
        let comparison = 0;
        if (sortField === 'description') {
          comparison = left.description.localeCompare(right.description, undefined, { sensitivity: 'base' });
        } else if (sortField === 'category') {
          comparison = left.categoryName.localeCompare(right.categoryName, undefined, { sensitivity: 'base' });
        } else if (sortField === 'amountArs') {
          comparison = Number(left.amountArs) - Number(right.amountArs);
        } else if (sortField === 'paidBy') {
          comparison = left.paidByUserName.localeCompare(right.paidByUserName, undefined, { sensitivity: 'base' });
        } else {
          comparison = left.date.localeCompare(right.date);
        }

        if (comparison === 0) {
          comparison = left.id.localeCompare(right.id);
        }
        return sortDirection === 'asc' ? comparison : -comparison;
      });

      return sorted;
    },
    [debouncedSearchQuery, selectedCategoryId, sortDirection, sortField],
  );
  const visibleExpenses = useMemo(() => applyClientControls(expenses), [applyClientControls, expenses]);
  const filteredSubtotalArs = useMemo(
    () => visibleExpenses.reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const fixedSubtotalArs = useMemo(
    () => visibleExpenses.filter((expense) => expense.fixed.enabled).reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const installmentSubtotalArs = useMemo(
    () =>
      visibleExpenses
        .filter((expense) => !expense.fixed.enabled && Boolean(expense.installment))
        .reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const oneTimeSubtotalArs = useMemo(
    () =>
      visibleExpenses
        .filter((expense) => !expense.fixed.enabled && !expense.installment)
        .reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const fixedExpenses = useMemo(() => visibleExpenses.filter((expense) => expense.fixed.enabled), [visibleExpenses]);
  const installmentExpenses = useMemo(
    () => visibleExpenses.filter((expense) => !expense.fixed.enabled && Boolean(expense.installment)),
    [visibleExpenses],
  );
  const oneTimeExpenses = useMemo(
    () => visibleExpenses.filter((expense) => !expense.fixed.enabled && !expense.installment),
    [visibleExpenses],
  );

  const form = useForm<ExpenseForm>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: getTodayDateInputValue(),
      description: '',
      categoryId: initialCategories.find((category) => category.archivedAt === null)?.id ?? '',
      amount: 0,
      currencyCode: 'ARS',
      fxRate: undefined,
      paidByUserId: initialUsers[0]?.id ?? '',
      fixedEnabled: false,
      applyToFuture: true,
      installmentEnabled: false,
      installmentCount: 2,
      installmentEntryMode: 'perInstallment',
      totalAmount: undefined,
    },
  });

  const watchedInstallmentEnabled = form.watch('installmentEnabled');
  const watchedInstallmentCount = form.watch('installmentCount');
  const watchedInstallmentEntryMode = form.watch('installmentEntryMode');
  const watchedAmount = form.watch('amount');
  const watchedTotalAmount = form.watch('totalAmount');
  const watchedCurrencyCode = form.watch('currencyCode');
  const watchedFxRate = form.watch('fxRate');
  const watchedApplyToFuture = form.watch('applyToFuture');
  const previousCurrencyRef = useRef<SupportedCurrencyCode>(DEFAULT_CURRENCY_CODE);

  const monthlyRateForCurrency = useMemo(() => {
    return exchangeRates.find((rate) => rate.currencyCode === watchedCurrencyCode)?.rateToArs;
  }, [exchangeRates, watchedCurrencyCode]);

  const effectiveFxRate = watchedCurrencyCode === 'ARS' ? 1 : Number(watchedFxRate ?? monthlyRateForCurrency ?? 0);
  const formatFxRate = useCallback(
    (value: string | number) =>
      Number(value).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );

  const resetSectionPages = useCallback(() => {
    setSectionPages({
      fixed: 1,
      oneTime: 1,
      installment: 1,
    });
  }, []);

  const invalidateSectionChunkState = useCallback(() => {
    sectionFetchInFlightRef.current = makeSectionPromiseMap();
    sectionPrefetchTargetRef.current = makeSectionPrefetchTargetMap();
  }, []);

  const projectedArsAmount = useMemo(() => {
    const baseAmount = watchedInstallmentEntryMode === 'total' ? watchedTotalAmount : watchedAmount;
    if (baseAmount === undefined || Number.isNaN(baseAmount)) {
      return null;
    }
    if (!effectiveFxRate || Number.isNaN(effectiveFxRate)) {
      return null;
    }
    return Number(baseAmount) * effectiveFxRate;
  }, [effectiveFxRate, watchedAmount, watchedInstallmentEntryMode, watchedTotalAmount]);

  const installmentPreview = useMemo(() => {
    if (!watchedInstallmentEnabled || !watchedInstallmentCount || !watchedInstallmentEntryMode) {
      return null;
    }

    try {
      const schedule = computeInstallmentAmounts({
        count: watchedInstallmentCount,
        entryMode: watchedInstallmentEntryMode,
        perInstallmentAmount: watchedInstallmentEntryMode === 'perInstallment' ? watchedAmount : undefined,
        totalAmount: watchedInstallmentEntryMode === 'total' ? watchedTotalAmount : undefined,
      });
      const first = schedule.amounts[0] ?? '0.00';
      const last = schedule.amounts[schedule.amounts.length - 1] ?? first;
      return { first, last, total: schedule.totalAmount, count: watchedInstallmentCount };
    } catch {
      return null;
    }
  }, [watchedAmount, watchedInstallmentCount, watchedInstallmentEnabled, watchedInstallmentEntryMode, watchedTotalAmount]);

  const resetForm = useCallback(
    (defaultUserId: string, defaultCategoryId: string) => {
      form.reset({
        date: getTodayDateInputValue(),
        description: '',
        categoryId: defaultCategoryId,
        amount: 0,
        currencyCode: 'ARS',
        fxRate: undefined,
        paidByUserId: defaultUserId,
        fixedEnabled: false,
        applyToFuture: true,
        installmentEnabled: false,
        installmentCount: 2,
        installmentEntryMode: 'perInstallment',
        totalAmount: undefined,
      });
    },
    [form],
  );

  const fetchMonthData = useCallback(async (options?: { includeRates?: boolean; includeSettlement?: boolean }) => {
    const includeRates = options?.includeRates ?? false;
    const includeSettlement = options?.includeSettlement ?? false;
    const sharedQuery = { sortBy: 'date' as const, sortDir: 'desc' as const, limit: fetchBatchSize };
    let hasNoIncomeSettlement = false;

    const [fixedData, oneTimeData, installmentData, rates, settlement] = await Promise.all([
      getExpenses(month, { ...sharedQuery, type: 'fixed', hydrate: true, includeCount: true }),
      getExpenses(month, { ...sharedQuery, type: 'oneTime', hydrate: false, includeCount: false }),
      getExpenses(month, { ...sharedQuery, type: 'installment', hydrate: false, includeCount: false }),
      includeRates ? getExchangeRates(month) : Promise.resolve<ExchangeRate[] | null>(null),
      includeSettlement
        ? getSettlement(month, undefined, { hydrate: false }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'Failed to load settlement';
            if (message.includes(NO_INCOME_SETTLEMENT_ERROR)) {
              hasNoIncomeSettlement = true;
              return null;
            }

            throw error;
          })
        : Promise.resolve<null | { totalExpenses: string }>(null),
    ]);

    const paginationBySection: SectionPaginationMap = {
      fixed: {
        nextCursor: fixedData.pagination?.nextCursor ?? null,
        hasMore: fixedData.pagination?.hasMore ?? false,
        totalCount: fixedData.pagination?.totalCount ?? null,
      },
      oneTime: {
        nextCursor: oneTimeData.pagination?.nextCursor ?? null,
        hasMore: oneTimeData.pagination?.hasMore ?? false,
        totalCount: oneTimeData.pagination?.totalCount ?? null,
      },
      installment: {
        nextCursor: installmentData.pagination?.nextCursor ?? null,
        hasMore: installmentData.pagination?.hasMore ?? false,
        totalCount: installmentData.pagination?.totalCount ?? null,
      },
    };

    setExpenses(mergeUniqueExpenses([...fixedData.expenses, ...oneTimeData.expenses, ...installmentData.expenses]));
    const nextWarnings = Array.from(
      new Set([
        ...fixedData.warnings,
        ...oneTimeData.warnings,
        ...installmentData.warnings,
        ...(hasNoIncomeSettlement ? [NO_INCOME_WARNING] : []),
      ]),
    );
    setWarnings(nextWarnings);
    setSectionPagination(paginationBySection);
    sectionCacheFetchedAtRef.current = makeSectionTimestampMap(Date.now());
    invalidateSectionChunkState();
    if (settlement) {
      setTotalCombinedExpensesArs(Number(settlement.totalExpenses));
    } else if (hasNoIncomeSettlement) {
      const allExpensesResult = await getExpenses(month, {
        sortBy: 'date',
        sortDir: 'desc',
        hydrate: false,
        includeCount: false,
      });
      setTotalCombinedExpensesArs(sumExpensesArs(allExpensesResult.expenses));
    }
    if (rates) {
      setExchangeRates(rates);
    }
  }, [month, fetchBatchSize, invalidateSectionChunkState]);

  useEffect(() => {
    setUsers(initialUsers);
    setExpenses(initialExpenses);
    setWarnings(initialWarnings);
    setCategories(initialCategories);
    setExchangeRates(initialExchangeRates);
    setTotalCombinedExpensesArs(Number(initialTotalExpensesArs));
    setError(null);
    resetSectionPages();
    setSectionPagination(initialSectionPagination);
    sectionCacheFetchedAtRef.current = makeSectionTimestampMap(Date.now());
    invalidateSectionChunkState();
    resetForm(initialUsers[0]?.id ?? '', initialCategories.find((c) => c.archivedAt === null)?.id ?? '');
  }, [
    initialCategories,
    initialExchangeRates,
    initialExpenses,
    initialSectionPagination,
    initialTotalExpensesArs,
    initialUsers,
    initialWarnings,
    invalidateSectionChunkState,
    resetForm,
    resetSectionPages,
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    resetSectionPages();
    invalidateSectionChunkState();
  }, [debouncedSearchQuery, selectedCategoryId, sortField, sortDirection, invalidateSectionChunkState, resetSectionPages]);

  useEffect(() => {
    setSectionPages((previousPages) => ({
      fixed: Math.min(previousPages.fixed, Math.max(1, Math.ceil(fixedExpenses.length / maxRowsPerSection))),
      oneTime: Math.min(previousPages.oneTime, Math.max(1, Math.ceil(oneTimeExpenses.length / maxRowsPerSection))),
      installment: Math.min(
        previousPages.installment,
        Math.max(1, Math.ceil(installmentExpenses.length / maxRowsPerSection)),
      ),
    }));
  }, [fixedExpenses.length, oneTimeExpenses.length, installmentExpenses.length, maxRowsPerSection]);

  useEffect(() => {
    expensesRef.current = expenses;
    warningsRef.current = warnings;
    sectionPaginationRef.current = sectionPagination;
  }, [expenses, sectionPagination, warnings]);

  useEffect(() => {
    const previousCurrencyCode = previousCurrencyRef.current;
    const currencyChanged = previousCurrencyCode !== watchedCurrencyCode;
    previousCurrencyRef.current = watchedCurrencyCode;

    if (watchedCurrencyCode === 'ARS') {
      form.setValue('fxRate', 1, { shouldDirty: true });
      return;
    }

    if (monthlyRateForCurrency) {
      form.setValue('fxRate', Number(monthlyRateForCurrency), { shouldDirty: true });
      return;
    }

    if (currencyChanged && previousCurrencyCode === 'ARS' && Number(form.getValues('fxRate') ?? 0) === 1) {
      form.setValue('fxRate', undefined, { shouldDirty: true });
    }
  }, [form, monthlyRateForCurrency, watchedCurrencyCode]);

  const reloadFirstPage = useCallback(async () => {
    await fetchMonthData({ includeRates: true, includeSettlement: true });
  }, [fetchMonthData]);

  const rowsForSection = useCallback((sectionKey: ExpenseSectionKey, list: Expense[]) => {
    if (sectionKey === 'fixed') {
      return list.filter((expense) => expense.fixed.enabled);
    }
    if (sectionKey === 'installment') {
      return list.filter((expense) => !expense.fixed.enabled && Boolean(expense.installment));
    }
    return list.filter((expense) => !expense.fixed.enabled && !expense.installment);
  }, []);

  const ensureRowsForSection = useCallback(
    async (sectionKey: ExpenseSectionKey, targetPage: number) => {
      if (targetPage <= 1) {
        return;
      }

      const existingFetch = sectionFetchInFlightRef.current[sectionKey];
      if (existingFetch) {
        await existingFetch;
      }

      const run = async () => {
        let loadedExpenses = expensesRef.current;
        let paginationForSection = sectionPaginationRef.current[sectionKey];
        const requiredRows = targetPage * maxRowsPerSection;
        const type = sectionTypeMap[sectionKey];
        let latestWarnings = warningsRef.current;

        while (
          rowsForSection(sectionKey, applyClientControls(loadedExpenses)).length < requiredRows &&
          paginationForSection.hasMore &&
          paginationForSection.nextCursor
        ) {
          const page = await getExpenses(month, {
            type,
            sortBy: 'date',
            sortDir: 'desc',
            limit: fetchBatchSize,
            cursor: paginationForSection.nextCursor,
            hydrate: false,
            includeCount: false,
          });
          loadedExpenses = mergeUniqueExpenses([...loadedExpenses, ...page.expenses]);
          latestWarnings = Array.from(new Set([...latestWarnings, ...page.warnings]));
          paginationForSection = {
            nextCursor: page.pagination?.nextCursor ?? null,
            hasMore: page.pagination?.hasMore ?? false,
            totalCount: page.pagination?.totalCount ?? paginationForSection.totalCount,
          };
          sectionCacheFetchedAtRef.current[sectionKey] = Date.now();
        }

        if (loadedExpenses !== expensesRef.current) {
          setExpenses(loadedExpenses);
          expensesRef.current = loadedExpenses;
        }
        setWarnings(latestWarnings);
        warningsRef.current = latestWarnings;
        setSectionPagination((previous) => ({ ...previous, [sectionKey]: paginationForSection }));
        sectionPaginationRef.current = {
          ...sectionPaginationRef.current,
          [sectionKey]: paginationForSection,
        };
      };

      const request = run().finally(() => {
        if (sectionFetchInFlightRef.current[sectionKey] === request) {
          sectionFetchInFlightRef.current[sectionKey] = null;
        }
      });
      sectionFetchInFlightRef.current[sectionKey] = request;
      await request;
    },
    [
      maxRowsPerSection,
      applyClientControls,
      rowsForSection,
      month,
      fetchBatchSize,
    ],
  );

  const executeUpdate = async (values: ExpenseForm, scope?: ApplyScope) => {
    if (!editingExpenseId) {
      return;
    }

    const payload: Parameters<typeof updateExpense>[1] = {
      date: values.date,
      description: values.description,
      categoryId: values.categoryId,
      currencyCode: values.currencyCode,
      fxRate: values.fxRate,
      paidByUserId: values.paidByUserId,
      applyScope: scope,
      applyToFuture: values.applyToFuture,
    };

    if (!values.installmentEnabled) {
      payload.amount = values.amount ?? 0;
    } else {
      payload.installment = {
        enabled: true,
        count: values.installmentCount,
        entryMode: values.installmentEntryMode,
        perInstallmentAmount: values.installmentEntryMode === 'perInstallment' ? values.amount : undefined,
        totalAmount: values.installmentEntryMode === 'total' ? values.totalAmount : undefined,
      };
    }

    await updateExpense(editingExpenseId, payload);
  };

  const executeCreate = async (values: ExpenseForm) => {
    await createExpense({
      month,
      date: values.date,
      description: values.description,
      categoryId: values.categoryId,
      amount: values.installmentEnabled ? undefined : values.amount,
      currencyCode: values.currencyCode,
      fxRate: values.fxRate,
      paidByUserId: values.paidByUserId,
      fixed: { enabled: values.fixedEnabled },
      installment: values.installmentEnabled
        ? {
            enabled: true,
            count: values.installmentCount,
            entryMode: values.installmentEntryMode,
            perInstallmentAmount: values.installmentEntryMode === 'perInstallment' ? values.amount : undefined,
            totalAmount: values.installmentEntryMode === 'total' ? values.totalAmount : undefined,
          }
        : undefined,
    });
  };

  const submit = form.handleSubmit(async (values) => {
    const wasEditing = Boolean(editingExpenseId);

    try {
      setSaving(true);
      setError(null);

      if (editingExpenseId) {
        const current = expenses.find((expense) => expense.id === editingExpenseId);
        if (current?.installment) {
          setScopeDialog({ action: 'update', expense: current, values });
          return;
        }

        if (current?.fixed.enabled && !values.applyToFuture && !window.confirm('Update only this month?')) {
          return;
        }

        await executeUpdate(values, 'single');
      } else {
        await executeCreate(values);
      }

      setEditingExpenseId(null);
      if (!wasEditing) {
        setIsMobileAddExpenseOpen(false);
      }
      resetForm(users[0]?.id ?? '', sortedActiveCategories[0]?.id ?? '');
      await reloadFirstPage();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  });

  const startEdit = (expense: Expense) => {
    setIsMobileAddExpenseOpen(true);
    setEditingExpenseId(expense.id);
    form.reset({
      date: expense.date,
      description: expense.description,
      categoryId: expense.categoryId,
      amount: Number(expense.amountOriginal),
      currencyCode: toSupportedCurrencyCode(expense.currencyCode),
      fxRate: Number(expense.fxRateUsed),
      paidByUserId: expense.paidByUserId,
      fixedEnabled: expense.fixed.enabled,
      applyToFuture: expense.fixed.enabled,
      installmentEnabled: Boolean(expense.installment),
      installmentCount: expense.installment?.total ?? 2,
      installmentEntryMode: 'perInstallment',
      totalAmount: undefined,
    });
  };

  const removeExpense = async (expense: Expense) => {
    setConfirmationDialog({ action: 'delete', expense });
  };

  const cloneExpense = async (expense: Expense) => {
    setConfirmationDialog({ action: 'clone', expense });
  };

  const confirmCloneExpense = async (expense: Expense) => {
    try {
      setSaving(true);
      setError(null);
      const today = getTodayDateInputValue();

      await createExpense({
        month: dateInputValueToMonth(today),
        date: today,
        description: expense.description,
        categoryId: expense.categoryId,
        amount: expense.installment ? undefined : Number(expense.amountOriginal),
        currencyCode: expense.currencyCode,
        fxRate: Number(expense.fxRateUsed),
        paidByUserId: expense.paidByUserId,
        fixed: { enabled: expense.fixed.enabled },
        installment: expense.installment
          ? {
              enabled: true,
              count: expense.installment.total,
              entryMode: 'perInstallment',
              perInstallmentAmount: Number(expense.amountOriginal),
            }
          : undefined,
      });

      await reloadFirstPage();
    } catch (cloneError) {
      setError(cloneError instanceof Error ? cloneError.message : 'Failed to clone expense');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteExpense = async (expense: Expense) => {
    if (expense.installment) {
      setScopeDialog({ action: 'delete', expense });
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await deleteExpense(expense.id, 'single');
      await reloadFirstPage();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to delete expense');
    } finally {
      setSaving(false);
    }
  };

  const confirmAction = async () => {
    if (!confirmationDialog) {
      return;
    }

    const dialog = confirmationDialog;
    setConfirmationDialog(null);

    if (dialog.action === 'clone') {
      await confirmCloneExpense(dialog.expense);
      return;
    }

    await confirmDeleteExpense(dialog.expense);
  };

  const confirmScopedAction = async (scope: ApplyScope) => {
    if (!scopeDialog) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      if (scopeDialog.action === 'delete') {
        await deleteExpense(scopeDialog.expense.id, scope);
      } else if (scopeDialog.values) {
        await executeUpdate(scopeDialog.values, scope);
      }

      setScopeDialog(null);
      setEditingExpenseId(null);
      resetForm(users[0]?.id ?? '', sortedActiveCategories[0]?.id ?? '');
      await reloadFirstPage();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to apply action');
    } finally {
      setSaving(false);
    }
  };

  const onSaveExchangeRate = async () => {
    const parsedRate = Number(newFxRate);
    if (!newFxCurrency || Number.isNaN(parsedRate) || parsedRate <= 0) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await upsertExchangeRate({ month, currencyCode: newFxCurrency, rateToArs: parsedRate });
      setNewFxRate('');
      await reloadFirstPage();
    } catch (fxError) {
      setError(fxError instanceof Error ? fxError.message : 'Failed to save FX rate');
    } finally {
      setSaving(false);
    }
  };

  const sectionSummaries = useMemo(() => {
    const sectionData: Array<{
      key: ExpenseSectionKey;
      title: string;
      subtitle: string;
      subtotalArs: number;
      allRows: Expense[];
      emptyMessage: string;
    }> = [
      {
        key: 'fixed',
        title: 'Recurring expenses',
        subtitle: 'Recurring monthly costs',
        subtotalArs: fixedSubtotalArs,
        allRows: fixedExpenses,
        emptyMessage: 'No recurring expenses in the current results',
      },
      {
        key: 'oneTime',
        title: 'One-time expenses',
        subtitle: 'Variable purchases',
        subtotalArs: oneTimeSubtotalArs,
        allRows: oneTimeExpenses,
        emptyMessage: hasActiveFilters ? 'No one-time expenses match the current filters' : 'No one-time expenses yet for this month',
      },
      {
        key: 'installment',
        title: 'Installments',
        subtitle: 'Purchases paid across multiple months',
        subtotalArs: installmentSubtotalArs,
        allRows: installmentExpenses,
        emptyMessage: hasActiveFilters ? 'No installments match the current filters' : 'No installments yet for this month',
      },
    ];

    return sectionData.map((section) => {
      const totalRows = section.allRows.length;
      const currentPage = sectionPages[section.key];
      const totalPages = Math.max(1, Math.ceil(totalRows / maxRowsPerSection));
      const page = Math.min(currentPage, totalPages);
      const startIndex = (page - 1) * maxRowsPerSection;
      const rows = section.allRows.slice(startIndex, startIndex + maxRowsPerSection);
      return {
        ...section,
        rows,
        totalRows,
        currentPage: page,
        totalPages,
        showSectionPager: totalRows > maxRowsPerSection || sectionPagination[section.key].hasMore,
        canMoveNext: page < totalPages || sectionPagination[section.key].hasMore,
        hasMore: sectionPagination[section.key].hasMore,
      };
    });
  }, [
    fixedSubtotalArs,
    fixedExpenses,
    hasActiveFilters,
    installmentExpenses,
    installmentSubtotalArs,
    maxRowsPerSection,
    oneTimeExpenses,
    oneTimeSubtotalArs,
    sectionPagination,
    sectionPages,
  ]);

  useEffect(() => {
    for (const section of sectionSummaries) {
      if (!section.hasMore) {
        continue;
      }

      const rowsRemainingAfterPage = section.totalRows - section.currentPage * maxRowsPerSection;
      const cacheAgeMs = Date.now() - sectionCacheFetchedAtRef.current[section.key];
      const shouldPrefetchByProximity = rowsRemainingAfterPage <= maxRowsPerSection * PREFETCH_AHEAD_PAGES;
      const shouldPrefetchByTtl = cacheAgeMs > SECTION_CACHE_TTL_MS && section.currentPage === 1;

      if (!shouldPrefetchByProximity && !shouldPrefetchByTtl) {
        continue;
      }

      const targetPage = section.currentPage + PREFETCH_AHEAD_PAGES + 1;
      const prefetchTargetKey = `${targetPage}:${sectionPagination[section.key].nextCursor ?? 'end'}`;
      if (sectionPrefetchTargetRef.current[section.key] === prefetchTargetKey) {
        continue;
      }

      sectionPrefetchTargetRef.current[section.key] = prefetchTargetKey;
      void ensureRowsForSection(section.key, targetPage).catch(() => {
        sectionPrefetchTargetRef.current[section.key] = null;
      });
    }
  }, [ensureRowsForSection, maxRowsPerSection, sectionPagination, sectionSummaries]);

  return (
    <AppShell
      month={month}
      title="Monthly Expenses"
      subtitle="Track each expense, category, currency and recurring expenses"
      rightSlot={<MonthSelector month={month} />}
    >
      {scopeDialog ? (
        <ScopeDialog
          busy={saving}
          onCancel={() => setScopeDialog(null)}
          onConfirm={(scope) => void confirmScopedAction(scope)}
          title={scopeDialog.action === 'delete' ? 'Delete installment expense' : 'Update installment expense'}
        />
      ) : null}
      {confirmationDialog ? (
        <ConfirmationDialog
          busy={saving}
          confirmLabel={confirmationDialog.action === 'clone' ? 'Clone expense' : 'Delete expense'}
          message={
            confirmationDialog.action === 'clone'
              ? `Create a new copy of "${confirmationDialog.expense.description}" using today's date?`
              : `Delete "${confirmationDialog.expense.description}"?`
          }
          onCancel={() => setConfirmationDialog(null)}
          onConfirm={() => void confirmAction()}
          title={confirmationDialog.action === 'clone' ? 'Confirm clone' : 'Confirm delete'}
        />
      ) : null}

      <div className="space-y-4">
        {warnings.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Recurring expense generation warnings</p>
            <ul className="mt-2 list-disc pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
          <div className="min-w-0 space-y-4">
            <form className={`${cardClass} min-w-0 space-y-3`} onSubmit={submit}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  {editingExpenseId ? 'Edit expense' : 'Add expense'}
                </h2>
                <button
                  aria-controls="add-expense-panel"
                  aria-expanded={isMobileAddExpenseOpen}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:hidden"
                  onClick={() => setIsMobileAddExpenseOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    className={`h-5 w-5 transition-transform ${isMobileAddExpenseOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.2"
                    viewBox="0 0 24 24"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
              <div
                className={`${isMobileAddExpenseOpen ? 'mt-3 block' : 'hidden'} space-y-3 md:mt-3 md:block`}
                id="add-expense-panel"
              >
                <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Date</span>
                <input
                  className={`${fieldClass} leading-tight [color-scheme:light] [&::-webkit-date-and-time-value]:text-left`}
                  lang="en"
                  type="date"
                  {...form.register('date')}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Description</span>
                <input className={fieldClass} {...form.register('description')} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Category</span>
                <select className={fieldClass} {...form.register('categoryId')}>
                  {sortedActiveCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">Currency</span>
                  <select className={fieldClass} {...form.register('currencyCode')}>
                    {supportedCurrencyCodes.map((currencyCode) => (
                      <option key={currencyCode} value={currencyCode}>
                        {currencyCode}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">FX to ARS</span>
                  <input
                    className={`${fieldClass} disabled:bg-slate-100`}
                    disabled={watchedCurrencyCode === 'ARS'}
                    min="0"
                    step="0.000001"
                    type="number"
                    {...form.register('fxRate')}
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" {...form.register('fixedEnabled')} />
                Recurring expense
              </label>
              {editingExpenseId ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input checked={watchedApplyToFuture} type="checkbox" {...form.register('applyToFuture')} />
                  Apply changes to future months
                </label>
              ) : null}

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" {...form.register('installmentEnabled')} />
                Installments
              </label>

              {watchedInstallmentEnabled ? (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-700">Installment count</span>
                    <input className={fieldClass} min="2" type="number" {...form.register('installmentCount')} />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-700">Entry mode</span>
                    <select className={fieldClass} {...form.register('installmentEntryMode')}>
                      <option value="perInstallment">Per installment amount</option>
                      <option value="total">Total amount</option>
                    </select>
                  </label>
                  {watchedInstallmentEntryMode === 'total' ? (
                    <label className="block text-sm">
                      <span className="mb-1 block text-slate-700">Total amount</span>
                      <input className={fieldClass} min="0" step="0.01" type="number" {...form.register('totalAmount')} />
                    </label>
                  ) : (
                    <label className="block text-sm">
                      <span className="mb-1 block text-slate-700">Per-installment amount</span>
                      <input className={fieldClass} min="0" step="0.01" type="number" {...form.register('amount')} />
                    </label>
                  )}
                </>
              ) : (
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-700">Amount</span>
                  <input className={fieldClass} min="0" step="0.01" type="number" {...form.register('amount')} />
                </label>
              )}

              {installmentPreview ? (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {installmentPreview.count} installments: first {formatMoney(installmentPreview.first)} and last{' '}
                  {formatMoney(installmentPreview.last)} (total {formatMoney(installmentPreview.total)})
                </div>
              ) : null}

              {projectedArsAmount !== null ? (
                <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Estimated ARS amount: {formatMoney(projectedArsAmount.toFixed(2))}
                </div>
              ) : null}

              <label className="block text-sm">
                <span className="mb-1 block text-slate-700">Paid by</span>
                <select className={fieldClass} {...form.register('paidByUserId')}>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex gap-2">
                <button className={primaryButtonClass} disabled={saving} type="submit">
                  {editingExpenseId ? 'Update' : 'Add'}
                </button>
                {editingExpenseId ? (
                  <button
                    className={secondaryButtonClass}
                    type="button"
                    onClick={() => {
                      setEditingExpenseId(null);
                      resetForm(users[0]?.id ?? '', sortedActiveCategories[0]?.id ?? '');
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              </div>
            </form>

            <section className={cardClass}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900">Month-start FX defaults (to ARS)</h3>
                <button
                  aria-controls="fx-defaults-panel"
                  aria-expanded={isMobileFxOpen}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:hidden"
                  onClick={() => setIsMobileFxOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  <svg aria-hidden="true" className={`h-5 w-5 transition-transform ${isMobileFxOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>

              <div className={`${isMobileFxOpen ? 'mt-3 block' : 'hidden'} md:mt-3 md:block`} id="fx-defaults-panel">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_auto]">
                  <select
                    className={fieldClass}
                    onChange={(e) => setNewFxCurrency(e.target.value as SupportedCurrencyCode)}
                    value={newFxCurrency}
                  >
                    {fxCurrencies.map((currencyCode) => (
                      <option key={currencyCode} value={currencyCode}>
                        {currencyCode}
                      </option>
                    ))}
                  </select>
                  <input className={fieldClass} min="0" onChange={(e) => setNewFxRate(e.target.value)} placeholder="Rate" step="0.000001" type="number" value={newFxRate} />
                  <button className={primaryButtonClass} onClick={() => void onSaveExchangeRate()} type="button">
                    Save
                  </button>
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-700">
                  {exchangeRates.length === 0 ? <p>No FX defaults for this month.</p> : null}
                  {exchangeRates.map((rate) => (
                    <p key={rate.id}>
                      {rate.currencyCode}: {formatFxRate(rate.rateToArs)}
                    </p>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="min-w-0 space-y-4">
            <section className="overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-5 text-white shadow-lg">
              <p className="text-base font-semibold text-blue-100">Total Combined Expenses</p>
              <p className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">ARS {formatMoney(totalCombinedExpensesArs)}</p>
            </section>
            <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Showing {visibleExpenses.length} loaded results
                    </p>
                    <p className="text-xs text-slate-500">Filtered results for this month</p>
                    <p className="text-xs font-medium text-slate-600">Subtotal (filtered): ARS {formatMoney(filteredSubtotalArs)}</p>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                    <label className="flex items-center gap-2 text-sm text-slate-700" htmlFor="expense-max-rows-per-section">
                      <span className="font-medium">Max rows per section</span>
                      <select
                        className={`${compactFieldClass} min-w-20 rounded-lg px-3 py-2`}
                        id="expense-max-rows-per-section"
                        onChange={(event) => {
                          setMaxRowsPerSection(Number(event.target.value) as 10 | 25 | 50);
                          resetSectionPages();
                          invalidateSectionChunkState();
                        }}
                        value={maxRowsPerSection}
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
              <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-4">
                <div className="flex items-center gap-2 md:hidden">
                  <input
                    className={tableControlFieldClass}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search expenses..."
                    type="search"
                    value={searchQuery}
                  />
                  <button
                    aria-controls="expense-mobile-filters"
                    aria-expanded={isMobileFiltersOpen}
                    className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                    onClick={() => setIsMobileFiltersOpen((isOpen) => !isOpen)}
                    type="button"
                  >
                    Filters{mobileControlsCount > 0 ? ` (${mobileControlsCount})` : ''}
                  </button>
                </div>

                <div className={`${isMobileFiltersOpen ? 'mt-3 block' : 'hidden'} md:mt-0 md:block`} id="expense-mobile-filters">
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-12">
                    <label className="hidden lg:col-span-8 md:block">
                      <span className={tableControlLabelClass}>Search</span>
                      <input
                        className={tableControlFieldClass}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Description, category, or payer"
                        type="search"
                        value={searchQuery}
                      />
                    </label>
                    <label className="lg:col-span-4">
                      <span className={tableControlLabelClass}>Category</span>
                      <select
                        className={tableControlFieldClass}
                        onChange={(event) => setSelectedCategoryId(event.target.value)}
                        value={selectedCategoryId}
                      >
                        <option value="all">All categories</option>
                        {sortedActiveCategories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
                        <label className="sm:min-w-56">
                          <span className={tableControlLabelClass}>Sort by</span>
                          <select
                            className={tableControlFieldClass}
                            onChange={(event) => setSortField(event.target.value as ExpenseSortField)}
                            value={sortField}
                          >
                            <option value="date">Date</option>
                            <option value="description">Description</option>
                            <option value="category">Category</option>
                            <option value="amountArs">Amount</option>
                            <option value="paidBy">Paid by</option>
                          </select>
                        </label>
                        <label className="sm:min-w-56">
                          <span className={tableControlLabelClass}>Order</span>
                          <select
                            className={tableControlFieldClass}
                            onChange={(event) => setSortDirection(event.target.value as SortDirection)}
                            value={sortDirection}
                          >
                            <option value="desc">Newest first</option>
                            <option value="asc">Oldest first</option>
                          </select>
                        </label>
                      </div>
                      <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
                        <p className="text-xs text-slate-500">Use filters to narrow results, then sort to compare spending quickly.</p>
                        {hasActiveControls ? (
                          <button
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                            onClick={() => {
                              setSearchQuery('');
                              setSelectedCategoryId('all');
                              setSortField('date');
                              setSortDirection('desc');
                              resetSectionPages();
                            }}
                            type="button"
                          >
                            Clear filters
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-5 p-4">
                {sectionSummaries.map((section) => (
                  <section key={section.key} className="overflow-hidden rounded-xl border border-slate-200/80">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${
                            section.key === 'fixed'
                              ? 'bg-blue-100 text-blue-700'
                              : section.key === 'oneTime'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-violet-100 text-violet-700'
                          }`}
                        >
                          {section.key === 'fixed' ? (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
                              <path d="M3 12a9 9 0 0 1 15.1-6.36" />
                              <path d="M3 4v6h6" />
                              <path d="M21 12a9 9 0 0 1-15.1 6.36" />
                              <path d="M21 20v-6h-6" />
                            </svg>
                          ) : section.key === 'oneTime' ? (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.1" viewBox="0 0 24 24">
                              <rect height="14" rx="2.5" width="14" x="5" y="7" />
                              <path d="M9 7V5a3 3 0 0 1 6 0v2" />
                              <path d="M12 11v4" />
                            </svg>
                          ) : (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.1" viewBox="0 0 24 24">
                              <rect height="16" rx="2.5" width="12" x="6" y="4" />
                              <path d="M9 8h6" />
                              <path d="M9 12h6" />
                              <path d="M10 16h4" />
                            </svg>
                          )}
                        </span>
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">{section.title}</h4>
                          <p className="text-xs text-slate-500">{section.subtitle}</p>
                        </div>
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Subtotal: <span className="text-sm normal-case text-slate-900">ARS {formatMoney(section.subtotalArs)}</span>
                      </p>
                    </div>
                    <div className="w-full max-w-full overflow-x-auto">
                      <table className="w-full min-w-[840px] table-fixed divide-y divide-slate-200 text-sm">
                        <caption className="sr-only">{section.title}</caption>
                        <colgroup>
                          <col className="w-[15%]" />
                          <col className="w-[22%]" />
                          <col className="w-[14%]" />
                          <col className="w-[19%]" />
                          <col className="w-[12%]" />
                          <col className="w-[18%]" />
                        </colgroup>
                        <thead className="bg-white text-left text-slate-600">
                          <tr>
                            <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">
                              Date
                            </th>
                            <th className="px-4 py-3 font-medium" scope="col">
                              Description
                            </th>
                            <th className="px-4 py-3 font-medium" scope="col">
                              Category
                            </th>
                            <th className="px-4 py-3 font-medium" scope="col">
                              Amount
                            </th>
                            <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">
                              Paid by
                            </th>
                            <th className="whitespace-nowrap px-4 py-3 font-medium" scope="col">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {section.rows.map((expense) => (
                            <tr key={expense.id} className="hover:bg-slate-50/80">
                              <td className="whitespace-nowrap px-4 py-3">{expense.date}</td>
                              <td className="px-4 py-3">
                                <div className="truncate font-medium text-slate-900" title={expense.description}>
                                  {expense.description}
                                </div>
                                <div className="truncate text-xs text-slate-500">
                                  {expense.fixed.enabled
                                    ? 'Recurring'
                                    : expense.installment
                                      ? `Installment ${expense.installment.number}/${expense.installment.total}`
                                      : 'One-time'}
                                </div>
                              </td>
                              <td className="px-4 py-3">{expense.categoryName}</td>
                              <td className="px-4 py-3 tabular-nums">
                                <div>ARS {formatMoney(expense.amountArs)}</div>
                                {expense.currencyCode !== 'ARS' ? (
                                  <div className="text-xs text-slate-500">
                                    {expense.currencyCode} {formatMoney(expense.amountOriginal)} @ {formatFxRate(expense.fxRateUsed)}
                                  </div>
                                ) : null}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">{expense.paidByUserName}</td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <div className="flex gap-2">
                                  <ActionButton action="edit" aria-label="Edit expense" onClick={() => startEdit(expense)} size="icon">
                                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                                      <path d="M12 20h9" />
                                      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                                    </svg>
                                  </ActionButton>
                                  <ActionButton action="clone" aria-label="Clone expense" onClick={() => void cloneExpense(expense)} size="icon">
                                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                                      <rect height="13" rx="2" width="13" x="9" y="9" />
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                  </ActionButton>
                                  <ActionButton action="delete" aria-label="Delete expense" onClick={() => void removeExpense(expense)} size="icon">
                                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                                      <path d="M3 6h18" />
                                      <path d="M8 6V4h8v2" />
                                      <path d="M19 6l-1 14H6L5 6" />
                                      <path d="M10 11v6" />
                                      <path d="M14 11v6" />
                                    </svg>
                                  </ActionButton>
                                </div>
                              </td>
                            </tr>
                          ))}
                          {section.rows.length === 0 ? (
                            <tr>
                              <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={6}>
                                {section.emptyMessage}
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                    {section.showSectionPager ? (
                      <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3">
                        <p className="text-sm font-medium text-slate-600">
                          Showing {section.rows.length} of {section.totalRows}
                          {section.hasMore ? '+' : ''} results
                        </p>
                        <div className="flex items-center gap-3">
                          <button
                            aria-label={`Previous ${section.title} page`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={section.currentPage === 1}
                            onClick={() =>
                              setSectionPages((previous) => ({
                                ...previous,
                                [section.key]: Math.max(1, section.currentPage - 1),
                              }))
                            }
                            type="button"
                          >
                            <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path d="m15 18-6-6 6-6" />
                            </svg>
                          </button>
                          <button
                            aria-label={`Next ${section.title} page`}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!section.canMoveNext}
                            onClick={async () => {
                              const targetPage = section.currentPage + 1;
                              await ensureRowsForSection(section.key, targetPage);
                              setSectionPages((previous) => ({
                                ...previous,
                                [section.key]: targetPage,
                              }));
                            }}
                            type="button"
                          >
                            <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
