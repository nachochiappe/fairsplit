'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { computeInstallmentAmounts } from '@fairsplit/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { AppShell } from '../../components/AppShell';
import { MonthSelector } from '../../components/MonthSelector';
import { ViewportModal } from '../../components/ViewportModal';
import { formatMoney } from '../../lib/currency';
import { addMonths } from '../../lib/month';
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
  ExpenseListResponse,
  getExchangeRates,
  getExpenses,
  getSettlement,
  updateExpense,
  upsertExchangeRate,
  User,
} from '../../lib/api';
import {
  cardClass,
  compactFieldClass,
  fieldClass,
  moneyInputClass,
  pillToggleThumbClass,
  pillToggleTrackClass,
  primaryButtonClass,
  secondaryButtonClass,
  tableControlFieldClass,
  tableControlLabelClass,
  tableControlSearchFieldClass,
} from './expense-styles';
import { ConfirmationDialog } from './ConfirmationDialog';
import { ScopeDialog } from './ScopeDialog';
import { MobileExpenseCard } from './MobileExpenseCard';
import { DesktopExpenseActionMenu } from './DesktopExpenseActionMenu';

type ApplyScope = 'single' | 'future' | 'all';
type ExpenseSortField = 'date' | 'description' | 'category' | 'amountArs' | 'paidBy';
type SortDirection = 'asc' | 'desc';
type ExpenseSectionKey = 'fixed' | 'oneTime' | 'installment';
const supportedCurrencyCodes = ['ARS', 'USD', 'EUR'] as const;
type SupportedCurrencyCode = (typeof supportedCurrencyCodes)[number];
const currencyCodeSchema = z.enum(supportedCurrencyCodes);
const DEFAULT_CURRENCY_CODE: SupportedCurrencyCode = 'ARS';
const SEARCH_DEBOUNCE_MS = 350;

function getExpenseKindLabel(expense: Expense): string {
  if (expense.fixed.enabled) {
    return 'Recurring';
  }
  if (expense.installment) {
    return `Installment ${expense.installment.number}/${expense.installment.total}`;
  }
  return 'One-time';
}

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
    nextMonthExpense: z.boolean().default(false),
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
  expense: Expense;
}

type ConfirmationAction = 'clone' | 'delete';

interface ConfirmationDialogState {
  action: ConfirmationAction;
  expense: Expense;
}

interface SubmissionToastState {
  id: number;
  kind: 'loading' | 'success' | 'error';
  title: string;
  message?: string;
}

const SUBMISSION_TOAST_VISIBLE_MS = 6000;


interface ExpensesClientProps {
  currentUserId: string | null;
  month: string;
  initialUsers: User[];
  initialExpenses: Expense[];
  initialWarnings: string[];
  initialSectionPagination: SectionPaginationMap;
  initialCategories: Category[];
  initialExchangeRates: ExchangeRate[];
  initialTotalExpensesArs: string;
  initialTotals: ExpenseListResponse['totals'];
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

function makeSectionLoadingMap(value: boolean): Record<ExpenseSectionKey, boolean> {
  return {
    fixed: value,
    oneTime: value,
    installment: value,
  };
}


function formatOrdinalDayFromDateInput(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return 'scheduled day';
  }

  const day = date.getDate();
  const mod10 = day % 10;
  const mod100 = day % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${day}st`;
  }
  if (mod10 === 2 && mod100 !== 12) {
    return `${day}nd`;
  }
  if (mod10 === 3 && mod100 !== 13) {
    return `${day}rd`;
  }
  return `${day}th`;
}

function formatMonthHeading(value: string): string {
  const date = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function getSortFieldLabel(sortField: ExpenseSortField): string {
  if (sortField === 'amountArs') {
    return 'Amount';
  }
  if (sortField === 'paidBy') {
    return 'Paid by';
  }
  return sortField.charAt(0).toUpperCase() + sortField.slice(1);
}


function getExpenseKindPillClasses(expense: Expense): string {
  if (expense.fixed.enabled) {
    return 'border-blue-200 bg-blue-100 text-blue-700';
  }

  if (expense.installment) {
    return 'border-violet-200 bg-violet-100 text-violet-700';
  }

  return 'border-orange-200 bg-orange-100 text-orange-700';
}

function getExpenseCategoryPillClasses(): string {
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function getExpensePayerPillClasses(): string {
  return 'border-amber-200 bg-amber-50 text-amber-800';
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

function resolveDefaultPaidByUserId(users: User[], currentUserId: string | null): string {
  if (currentUserId) {
    const currentUser = users.find((user) => user.id === currentUserId);
    if (currentUser) {
      return currentUser.id;
    }
  }
  return users[0]?.id ?? '';
}

export function ExpensesClient({
  currentUserId,
  month,
  initialUsers,
  initialExpenses,
  initialWarnings,
  initialSectionPagination,
  initialCategories,
  initialExchangeRates,
  initialTotalExpensesArs,
  initialTotals,
}: ExpensesClientProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [warnings, setWarnings] = useState<string[]>(initialWarnings);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(initialExchangeRates);
  const [totalCombinedExpensesArs, setTotalCombinedExpensesArs] = useState<number>(Number(initialTotalExpensesArs));
  const [subtotalTotals, setSubtotalTotals] = useState<ExpenseListResponse['totals']>(initialTotals);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [scopeDialog, setScopeDialog] = useState<ScopeDialogState | null>(null);
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialogState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionToast, setSubmissionToast] = useState<SubmissionToastState | null>(null);
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
  const hasSearchQuery = searchQuery.trim().length > 0;
  const [isMobileFxOpen, setIsMobileFxOpen] = useState(false);
  const [isDesktopFxEditing, setIsDesktopFxEditing] = useState(false);
  const [isMobileAddExpenseOpen, setIsMobileAddExpenseOpen] = useState(false);
  const [openExpenseActionMenuId, setOpenExpenseActionMenuId] = useState<string | null>(null);
  const [sectionLoading, setSectionLoading] = useState<Record<ExpenseSectionKey, boolean>>(makeSectionLoadingMap(false));
  const expensesRef = useRef(expenses);
  const submissionToastTimeoutRef = useRef<number | null>(null);
  const warningsRef = useRef(warnings);
  const sectionPaginationRef = useRef(sectionPagination);
  const sectionFetchInFlightRef = useRef<Record<ExpenseSectionKey, Promise<void> | null>>(makeSectionPromiseMap());
  const sectionCacheFetchedAtRef = useRef<Record<ExpenseSectionKey, number>>(makeSectionTimestampMap(Date.now()));
  const sectionPrefetchTargetRef = useRef<Record<ExpenseSectionKey, string | null>>(makeSectionPrefetchTargetMap());
  const sectionLoadingCountRef = useRef<Record<ExpenseSectionKey, number>>({
    fixed: 0,
    oneTime: 0,
    installment: 0,
  });
  const fetchBatchSizeRef = useRef(fetchBatchSize);
  const expenseFormRef = useRef<HTMLFormElement | null>(null);
  const fxCurrencies = useMemo(() => supportedCurrencyCodes.filter((code) => code !== 'ARS'), []);

  useEffect(() => {
    fetchBatchSizeRef.current = fetchBatchSize;
  }, [fetchBatchSize]);

  useEffect(() => {
    if (!openExpenseActionMenuId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest('[data-expense-actions]')) {
        return;
      }

      setOpenExpenseActionMenuId(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [openExpenseActionMenuId]);

  useEffect(() => {
    if (!openExpenseActionMenuId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenExpenseActionMenuId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openExpenseActionMenuId]);

  useEffect(() => {
    if (!submissionToast || submissionToast.kind === 'loading') {
      return;
    }

    if (submissionToastTimeoutRef.current) {
      window.clearTimeout(submissionToastTimeoutRef.current);
    }

    submissionToastTimeoutRef.current = window.setTimeout(() => {
      setSubmissionToast(null);
      submissionToastTimeoutRef.current = null;
    }, SUBMISSION_TOAST_VISIBLE_MS);

    return () => {
      if (submissionToastTimeoutRef.current) {
        window.clearTimeout(submissionToastTimeoutRef.current);
        submissionToastTimeoutRef.current = null;
      }
    };
  }, [submissionToast]);

  const beginSectionLoading = useCallback((keys: ExpenseSectionKey[]) => {
    setSectionLoading((previous) => {
      const next = { ...previous };
      for (const key of keys) {
        sectionLoadingCountRef.current[key] += 1;
        next[key] = true;
      }
      return next;
    });
  }, []);

  const endSectionLoading = useCallback((keys: ExpenseSectionKey[]) => {
    setSectionLoading((previous) => {
      const next = { ...previous };
      for (const key of keys) {
        sectionLoadingCountRef.current[key] = Math.max(0, sectionLoadingCountRef.current[key] - 1);
        next[key] = sectionLoadingCountRef.current[key] > 0;
      }
      return next;
    });
  }, []);

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
  const mobileControlChips = useMemo(() => {
    const chips: string[] = [];

    if (selectedCategoryId !== 'all') {
      const category = sortedActiveCategories.find((entry) => entry.id === selectedCategoryId);
      if (category) {
        chips.push(category.name);
      }
    }
    if (sortField !== 'date') {
      chips.push(getSortFieldLabel(sortField));
    }
    if (sortDirection !== 'desc') {
      chips.push('Oldest');
    }

    return chips;
  }, [selectedCategoryId, sortDirection, sortField, sortedActiveCategories]);
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
  const filterQuery = useMemo(
    () => ({
      ...(debouncedSearchQuery.trim() ? { search: debouncedSearchQuery.trim() } : {}),
      ...(selectedCategoryId !== 'all' ? { categoryId: selectedCategoryId } : {}),
    }),
    [debouncedSearchQuery, selectedCategoryId],
  );
  const filterQueryRef = useRef(filterQuery);
  const hasMountedFilterTotalsEffectRef = useRef(false);
  useEffect(() => {
    filterQueryRef.current = filterQuery;
  }, [filterQuery]);
  const visibleExpenses = useMemo(() => applyClientControls(expenses), [applyClientControls, expenses]);
  const loadedFilteredSubtotalArs = useMemo(
    () => visibleExpenses.reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const loadedFixedSubtotalArs = useMemo(
    () => visibleExpenses.filter((expense) => expense.fixed.enabled).reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const loadedInstallmentSubtotalArs = useMemo(
    () =>
      visibleExpenses
        .filter((expense) => !expense.fixed.enabled && Boolean(expense.installment))
        .reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const loadedOneTimeSubtotalArs = useMemo(
    () =>
      visibleExpenses
        .filter((expense) => !expense.fixed.enabled && !expense.installment)
        .reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const filteredSubtotalArs = subtotalTotals ? Number(subtotalTotals.filteredSubtotalArs) : loadedFilteredSubtotalArs;
  const fixedSubtotalArs = subtotalTotals ? Number(subtotalTotals.bySection.fixedArs) : loadedFixedSubtotalArs;
  const installmentSubtotalArs = subtotalTotals ? Number(subtotalTotals.bySection.installmentArs) : loadedInstallmentSubtotalArs;
  const oneTimeSubtotalArs = subtotalTotals ? Number(subtotalTotals.bySection.oneTimeArs) : loadedOneTimeSubtotalArs;
  const fixedExpenses = useMemo(() => visibleExpenses.filter((expense) => expense.fixed.enabled), [visibleExpenses]);
  const installmentExpenses = useMemo(
    () => visibleExpenses.filter((expense) => !expense.fixed.enabled && Boolean(expense.installment)),
    [visibleExpenses],
  );
  const oneTimeExpenses = useMemo(
    () => visibleExpenses.filter((expense) => !expense.fixed.enabled && !expense.installment),
    [visibleExpenses],
  );
  const defaultPaidByUserId = useMemo(
    () => resolveDefaultPaidByUserId(users, currentUserId),
    [users, currentUserId],
  );

  const form = useForm<ExpenseForm>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: getTodayDateInputValue(),
      description: '',
      categoryId: initialCategories.find((category) => category.archivedAt === null)?.id ?? '',
      amount: undefined,
      currencyCode: 'ARS',
      fxRate: undefined,
      paidByUserId: resolveDefaultPaidByUserId(initialUsers, currentUserId),
      fixedEnabled: false,
      nextMonthExpense: false,
      applyToFuture: true,
      installmentEnabled: false,
      installmentCount: 2,
      installmentEntryMode: 'perInstallment',
      totalAmount: undefined,
    },
  });

  const watchedInstallmentEnabled = useWatch({ control: form.control, name: 'installmentEnabled' });
  const watchedInstallmentCount = useWatch({ control: form.control, name: 'installmentCount' });
  const watchedInstallmentEntryMode = useWatch({ control: form.control, name: 'installmentEntryMode' });
  const watchedAmount = useWatch({ control: form.control, name: 'amount' });
  const watchedTotalAmount = useWatch({ control: form.control, name: 'totalAmount' });
  const watchedCurrencyCode = useWatch({ control: form.control, name: 'currencyCode' });
  const watchedFxRate = useWatch({ control: form.control, name: 'fxRate' });
  const watchedApplyToFuture = useWatch({ control: form.control, name: 'applyToFuture' });
  const watchedFixedEnabled = useWatch({ control: form.control, name: 'fixedEnabled' });
  const watchedNextMonthExpense = useWatch({ control: form.control, name: 'nextMonthExpense' });
  const watchedDate = useWatch({ control: form.control, name: 'date' });
  const watchedPaidByUserId = useWatch({ control: form.control, name: 'paidByUserId' });

  useEffect(() => {
    if (watchedInstallmentEnabled) {
      return;
    }

    form.setValue('installmentCount', 2);
    form.setValue('installmentEntryMode', 'perInstallment');
    form.setValue('totalAmount', undefined);
  }, [form, watchedInstallmentEnabled]);
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
    (defaultCategoryId: string) => {
      form.reset({
        date: getTodayDateInputValue(),
        description: '',
        categoryId: defaultCategoryId,
        amount: undefined,
        currencyCode: 'ARS',
        fxRate: undefined,
        paidByUserId: defaultPaidByUserId,
        fixedEnabled: false,
        nextMonthExpense: false,
        applyToFuture: true,
        installmentEnabled: false,
        installmentCount: 2,
        installmentEntryMode: 'perInstallment',
        totalAmount: undefined,
      });
      form.resetField('amount', { defaultValue: undefined });
      form.resetField('totalAmount', { defaultValue: undefined });
    },
    [defaultPaidByUserId, form],
  );

  const openMobileComposer = useCallback(() => {
    setEditingExpenseId(null);
    resetForm(sortedActiveCategories[0]?.id ?? '');
    setIsMobileAddExpenseOpen(true);
  }, [resetForm, sortedActiveCategories]);

  const closeMobileComposer = useCallback(() => {
    setEditingExpenseId(null);
    setIsMobileAddExpenseOpen(false);
    resetForm(sortedActiveCategories[0]?.id ?? '');
  }, [resetForm, sortedActiveCategories]);

  const fetchMonthData = useCallback(async (options?: { includeRates?: boolean; includeSettlement?: boolean }) => {
    const allSectionKeys: ExpenseSectionKey[] = ['fixed', 'oneTime', 'installment'];
    beginSectionLoading(allSectionKeys);

    try {
    const includeRates = options?.includeRates ?? false;
    const includeSettlement = options?.includeSettlement ?? false;
    const sharedQuery = { sortBy: 'date' as const, sortDir: 'desc' as const, limit: fetchBatchSizeRef.current };
    let hasNoIncomeSettlement = false;

    const [fixedData, oneTimeData, installmentData, totalsData, rates, settlement] = await Promise.all([
      getExpenses(month, { ...sharedQuery, type: 'fixed', hydrate: true, includeCount: true }),
      getExpenses(month, { ...sharedQuery, type: 'oneTime', hydrate: false, includeCount: false }),
      getExpenses(month, { ...sharedQuery, type: 'installment', hydrate: false, includeCount: false }),
      getExpenses(month, {
        ...filterQueryRef.current,
        sortBy: 'date',
        sortDir: 'desc',
        limit: 1,
        hydrate: false,
        includeCount: false,
        includeTotals: true,
      }),
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
    setSubtotalTotals(totalsData.totals);
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
    } finally {
      endSectionLoading(allSectionKeys);
    }
  }, [month, invalidateSectionChunkState, beginSectionLoading, endSectionLoading]);

  useEffect(() => {
    setUsers(initialUsers);
    setExpenses(initialExpenses);
    setWarnings(initialWarnings);
    setCategories(initialCategories);
    setExchangeRates(initialExchangeRates);
    setTotalCombinedExpensesArs(Number(initialTotalExpensesArs));
    setSubtotalTotals(initialTotals);
    setError(null);
    resetSectionPages();
    setSectionPagination(initialSectionPagination);
    sectionCacheFetchedAtRef.current = makeSectionTimestampMap(Date.now());
    invalidateSectionChunkState();
    resetForm(initialCategories.find((c) => c.archivedAt === null)?.id ?? '');
  }, [
    initialCategories,
    initialExchangeRates,
    initialExpenses,
    initialSectionPagination,
    initialTotalExpensesArs,
    initialTotals,
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
    if (!hasMountedFilterTotalsEffectRef.current) {
      hasMountedFilterTotalsEffectRef.current = true;
      return;
    }

    let cancelled = false;

    const refreshTotalsForFilters = async () => {
      try {
        const totalsResult = await getExpenses(month, {
          ...filterQuery,
          sortBy: 'date',
          sortDir: 'desc',
          limit: 1,
          hydrate: false,
          includeCount: false,
          includeTotals: true,
        });
        if (!cancelled) {
          setSubtotalTotals(totalsResult.totals);
        }
      } catch {
        // Keep last known totals and fallback rendering if this request fails.
      }
    };

    void refreshTotalsForFilters();

    return () => {
      cancelled = true;
    };
  }, [month, filterQuery]);

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
        beginSectionLoading([sectionKey]);
        try {
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
        } finally {
          endSectionLoading([sectionKey]);
        }
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
      beginSectionLoading,
      endSectionLoading,
    ],
  );

  const executeUpdate = async (values: ExpenseForm, scope?: ApplyScope) => {
    if (!editingExpenseId) {
      return;
    }

    const applyToFuture = values.fixedEnabled && !values.installmentEnabled ? values.applyToFuture : false;
    const payload: Parameters<typeof updateExpense>[1] = {
      month: values.nextMonthExpense ? addMonths(month, 1) : month,
      date: values.date,
      description: values.description,
      categoryId: values.categoryId,
      currencyCode: values.currencyCode,
      fxRate: values.fxRate,
      paidByUserId: values.paidByUserId,
      applyScope: scope,
      applyToFuture,
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
    const issuedMonth = values.nextMonthExpense ? addMonths(month, 1) : month;
    await createExpense({
      month: issuedMonth,
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
    const loadingToastId = Date.now();

    try {
      setSaving(true);
      setError(null);

      if (editingExpenseId) {
        const current = expenses.find((expense) => expense.id === editingExpenseId);
        setSubmissionToast({
          id: loadingToastId,
          kind: 'loading',
          title: 'Updating expense...',
        });

        if (current?.installment) {
          await executeUpdate(values, 'all');
        } else if (current?.fixed.enabled) {
          await executeUpdate(values, values.applyToFuture ? 'future' : 'single');
        } else {
          await executeUpdate(values, 'single');
        }
      } else {
        setSubmissionToast({
          id: loadingToastId,
          kind: 'loading',
          title: 'Adding expense...',
        });
        await executeCreate(values);
      }

      setEditingExpenseId(null);
      if (!wasEditing) {
        setIsMobileAddExpenseOpen(false);
      }
      resetForm(sortedActiveCategories[0]?.id ?? '');
      await reloadFirstPage();
      setSubmissionToast({
        id: loadingToastId,
        kind: 'success',
        title: wasEditing ? 'Expense updated' : 'Expense added',
        message: wasEditing ? 'Your changes were saved successfully.' : 'Expense added successfully.',
      });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to save expense';
      setError(message);
      setSubmissionToast({
        id: Date.now(),
        kind: 'error',
        title: wasEditing ? 'Could not update expense' : 'Could not add expense',
        message,
      });
    } finally {
      setSaving(false);
    }
  });

  const jumpToExpenseEditor = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        expenseFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        form.setFocus('description');
      });
    });
  }, [form]);

  const startEdit = (expense: Expense) => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setIsMobileAddExpenseOpen(true);
    }
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
      nextMonthExpense: false,
      applyToFuture: expense.fixed.enabled,
      installmentEnabled: Boolean(expense.installment),
      installmentCount: expense.installment?.total ?? 2,
      installmentEntryMode: 'perInstallment',
      totalAmount: undefined,
    });
    jumpToExpenseEditor();
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
    if (expense.installment || expense.fixed.enabled) {
      setScopeDialog({ expense });
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await deleteExpense(expense.id, 'single');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to delete expense');
      return;
    }

    try {
      await reloadFirstPage();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? `Expense deleted, but the page could not refresh automatically. ${refreshError.message}`
          : 'Expense deleted, but the page could not refresh automatically.',
      );
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
      await deleteExpense(scopeDialog.expense.id, scope);

      setScopeDialog(null);
      setEditingExpenseId(null);
      resetForm(sortedActiveCategories[0]?.id ?? '');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Failed to apply action');
      return;
    }

    try {
      await reloadFirstPage();
    } catch (refreshError) {
      const fallbackMessage = 'Expense deleted, but the page could not refresh automatically.';
      setError(refreshError instanceof Error ? `${fallbackMessage} ${refreshError.message}` : fallbackMessage);
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

  const expenseFormFields = (
    <>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-600">Date</span>
        <input
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 [color-scheme:light] [&::-webkit-date-and-time-value]:text-left"
          lang="en"
          type="date"
          {...form.register('date')}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-600">Description</span>
        <input
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          {...form.register('description')}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-600">Category</span>
        <select
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          {...form.register('categoryId')}
        >
          {sortedActiveCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Currency</span>
          <select
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            {...form.register('currencyCode')}
          >
            {supportedCurrencyCodes.map((currencyCode) => (
              <option key={currencyCode} value={currencyCode}>
                {currencyCode}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">FX to ARS</span>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-slate-500">
              $
            </span>
            <input
              className={`${moneyInputClass} rounded-lg disabled:bg-slate-100`}
              disabled={watchedCurrencyCode === 'ARS'}
              min="0"
              step="0.000001"
              type="number"
              {...form.register('fxRate')}
            />
          </div>
        </label>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-200 hover:bg-slate-50">
          <span>Recurring expense</span>
          <span className="relative inline-flex items-center">
            <input
              checked={watchedFixedEnabled}
              className="peer sr-only"
              onChange={(event) => {
                form.setValue('fixedEnabled', event.target.checked, { shouldDirty: true, shouldTouch: true });
              }}
              type="checkbox"
            />
            <span aria-hidden="true" className={pillToggleTrackClass} />
            <span aria-hidden="true" className={pillToggleThumbClass} />
          </span>
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-200 hover:bg-slate-50">
          <span>Next-month expense</span>
          <span className="relative inline-flex items-center">
            <input
              checked={watchedNextMonthExpense}
              className="peer sr-only"
              onChange={(event) => {
                form.setValue('nextMonthExpense', event.target.checked, { shouldDirty: true, shouldTouch: true });
              }}
              type="checkbox"
            />
            <span aria-hidden="true" className={pillToggleTrackClass} />
            <span aria-hidden="true" className={pillToggleThumbClass} />
          </span>
        </label>
        {editingExpenseId && watchedFixedEnabled && !watchedInstallmentEnabled ? (
          <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-200 hover:bg-slate-50">
            <span>Apply changes to future months</span>
            <span className="relative inline-flex items-center">
              <input
                checked={watchedApplyToFuture}
                className="peer sr-only"
                onChange={(event) => {
                  form.setValue('applyToFuture', event.target.checked, { shouldDirty: true, shouldTouch: true });
                }}
                type="checkbox"
              />
              <span aria-hidden="true" className={pillToggleTrackClass} />
              <span aria-hidden="true" className={pillToggleThumbClass} />
            </span>
          </label>
        ) : null}
        <label className="flex items-center justify-between gap-3 rounded-lg border border-transparent px-2 py-1 text-sm text-slate-700 transition hover:border-slate-200 hover:bg-slate-50">
          <span>Installments</span>
          <span className="relative inline-flex items-center">
            <input
              checked={watchedInstallmentEnabled}
              className="peer sr-only"
              onChange={(event) => {
                form.setValue('installmentEnabled', event.target.checked, { shouldDirty: true, shouldTouch: true });
              }}
              type="checkbox"
            />
            <span aria-hidden="true" className={pillToggleTrackClass} />
            <span aria-hidden="true" className={pillToggleThumbClass} />
          </span>
        </label>
      </div>

      {watchedInstallmentEnabled ? (
        <>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Installment count</span>
            <input className={fieldClass} min="2" type="number" {...form.register('installmentCount')} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Entry mode</span>
            <select className={fieldClass} {...form.register('installmentEntryMode')}>
              <option value="perInstallment">Per installment amount</option>
              <option value="total">Total amount</option>
            </select>
          </label>
          {watchedInstallmentEntryMode === 'total' ? (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Total amount</span>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-slate-500">
                  $
                </span>
                <Controller
                  control={form.control}
                  name="totalAmount"
                  render={({ field }) => (
                    <input
                      className={moneyInputClass}
                      min="0"
                      step="0.01"
                      type="number"
                      value={field.value ?? ''}
                      onBlur={field.onBlur}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        field.onChange(nextValue === '' ? undefined : Number(nextValue));
                      }}
                      name={field.name}
                      ref={field.ref}
                    />
                  )}
                />
              </div>
            </label>
          ) : (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Per-installment amount</span>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-slate-500">
                  $
                </span>
                <Controller
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <input
                      className={moneyInputClass}
                      min="0"
                      step="0.01"
                      type="number"
                      value={field.value ?? ''}
                      onBlur={field.onBlur}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        field.onChange(nextValue === '' ? undefined : Number(nextValue));
                      }}
                      name={field.name}
                      ref={field.ref}
                    />
                  )}
                />
              </div>
            </label>
          )}
        </>
      ) : (
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Amount</span>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-slate-500">
              $
            </span>
            <Controller
              control={form.control}
              name="amount"
              render={({ field }) => (
                <input
                  className={moneyInputClass}
                  min="0"
                  step="0.01"
                  type="number"
                  value={field.value ?? ''}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    field.onChange(nextValue === '' ? undefined : Number(nextValue));
                  }}
                  name={field.name}
                  ref={field.ref}
                />
              )}
            />
          </div>
        </label>
      )}

      {installmentPreview ? (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
          {installmentPreview.count} installments: first {formatMoney(installmentPreview.first)} and last{' '}
          {formatMoney(installmentPreview.last)} (total {formatMoney(installmentPreview.total)})
        </div>
      ) : null}

      {watchedCurrencyCode !== 'ARS' && projectedArsAmount !== null ? (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Estimated ARS amount: {formatMoney(projectedArsAmount.toFixed(2))}
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-slate-600">Paid by</span>
        <select
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
          {...form.register('paidByUserId')}
        >
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        {!editingExpenseId && submissionToast ? (
          <div
            aria-live={submissionToast.kind === 'error' ? 'assertive' : 'polite'}
            className={`relative inline-flex min-h-[44px] min-w-[128px] flex-1 items-center gap-2 overflow-hidden rounded-lg border px-4 py-2.5 text-sm font-semibold shadow-sm ${
              submissionToast.kind === 'loading'
                ? 'border-slate-300 bg-white text-slate-800'
                : submissionToast.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
            role={submissionToast.kind === 'error' ? 'alert' : 'status'}
          >
            {submissionToast.kind === 'loading' ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-400/70 border-t-slate-700"
              />
            ) : submissionToast.kind === 'success' ? (
              <svg
                aria-hidden="true"
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.6"
                viewBox="0 0 24 24"
              >
                <path d="m5 13 4 4L19 7" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.6"
                viewBox="0 0 24 24"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            )}
            <span className="truncate">
              {submissionToast.message ?? submissionToast.title}
            </span>
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/5">
              <span
                className={`block h-full ${
                  submissionToast.kind === 'loading'
                    ? 'animate-pulse bg-slate-500/80'
                    : submissionToast.kind === 'success'
                      ? 'submission-toast-progress bg-emerald-600'
                      : 'submission-toast-progress bg-rose-600'
                }`}
                style={
                  submissionToast.kind === 'loading'
                    ? undefined
                    : ({ '--toast-duration': `${SUBMISSION_TOAST_VISIBLE_MS}ms` } as Record<string, string>)
                }
              />
            </span>
          </div>
        ) : (
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-600 to-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
            type="submit"
          >
            <span aria-hidden="true" className="text-base leading-none">+</span>
            {!editingExpenseId && saving ? (
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-white"
              />
            ) : null}
            {editingExpenseId ? 'Update' : saving ? 'Adding...' : 'Add'}
          </button>
        )}
        {editingExpenseId ? (
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={() => {
              setEditingExpenseId(null);
              resetForm(sortedActiveCategories[0]?.id ?? '');
              setIsMobileAddExpenseOpen(false);
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </>
  );

  const mobileSectionClass =
    'space-y-3.5 rounded-[24px] border border-slate-300/20 bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.05)]';
  const mobileFieldLabelClass =
    'mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500';
  const mobileInputClass =
    'w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2';
  const mobileToggleRowClass =
    'flex min-h-[50px] items-center justify-between gap-3 rounded-2xl border border-slate-300/20 bg-slate-50/70 px-4 py-3 text-sm text-slate-800';

  const mobileExpenseFormFields = (
    <>
      <section className={mobileSectionClass}>
        <h3 className="text-[18px] font-semibold text-slate-900">Expense details</h3>

        <label className="block text-sm">
          <span className={mobileFieldLabelClass}>Date</span>
          <div className="w-full overflow-hidden">
            <input
              className={`${mobileInputClass} [color-scheme:light] [&::-webkit-date-and-time-value]:text-left`}
              lang="en"
              type="date"
              {...form.register('date')}
            />
          </div>
        </label>

        <label className="block text-sm">
          <span className={mobileFieldLabelClass}>Description</span>
          <input className={mobileInputClass} {...form.register('description')} />
        </label>

        <label className="block text-sm">
          <span className={mobileFieldLabelClass}>Category</span>
          <select className={mobileInputClass} {...form.register('categoryId')}>
            {sortedActiveCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-[8.75rem_minmax(0,1fr)] gap-3">
          <label className="block text-sm">
            <span className={mobileFieldLabelClass}>Currency</span>
            <select className={mobileInputClass} {...form.register('currencyCode')}>
              {supportedCurrencyCodes.map((currencyCode) => (
                <option key={currencyCode} value={currencyCode}>
                  {currencyCode}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className={mobileFieldLabelClass}>Amount</span>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 inline-flex items-center text-slate-500">
                $
              </span>
              <Controller
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <input
                    className={`${mobileInputClass} pl-9 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                    min="0"
                    step="0.01"
                    type="number"
                    value={field.value ?? ''}
                    onBlur={field.onBlur}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      field.onChange(nextValue === '' ? undefined : Number(nextValue));
                    }}
                    name={field.name}
                    ref={field.ref}
                  />
                )}
              />
            </div>
          </label>
        </div>

        {watchedCurrencyCode !== 'ARS' ? (
          <label className="block text-sm">
            <span className={mobileFieldLabelClass}>FX to ARS</span>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 inline-flex items-center text-slate-500">
                $
              </span>
              <input
                className={`${mobileInputClass} pl-9 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                min="0"
                step="0.000001"
                type="number"
                {...form.register('fxRate')}
              />
            </div>
          </label>
        ) : null}

        {watchedCurrencyCode !== 'ARS' && projectedArsAmount !== null ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Estimated ARS amount: {formatMoney(projectedArsAmount.toFixed(2))}
          </div>
        ) : null}

        <label className="block text-sm">
          <div className="flex min-h-[50px] items-center justify-between gap-3 rounded-2xl border border-slate-300/20 bg-slate-50/70 px-4 py-3">
            <div className="min-w-0">
              <span className="block font-semibold text-slate-900">Paid by</span>
              <span className="block text-[13px] leading-4 text-slate-500">Who covered this expense</span>
            </div>
            <div className="relative shrink-0">
              <select
                className="rounded-full border border-slate-300/50 bg-white px-4 py-2 text-[13px] font-bold text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                {...form.register('paidByUserId')}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </label>
      </section>

      <section className={mobileSectionClass}>
        <h3 className="text-[18px] font-semibold text-slate-900">Behavior</h3>
        <div className="space-y-2.5">
          <label className={mobileToggleRowClass}>
            <span className="font-medium">Recurring expense</span>
            <span className="relative inline-flex items-center">
              <input
                checked={watchedFixedEnabled}
                className="peer sr-only"
                onChange={(event) => {
                  form.setValue('fixedEnabled', event.target.checked, { shouldDirty: true, shouldTouch: true });
                }}
                type="checkbox"
              />
              <span aria-hidden="true" className={pillToggleTrackClass} />
              <span aria-hidden="true" className={pillToggleThumbClass} />
            </span>
          </label>

          <label className={mobileToggleRowClass}>
            <span className="font-medium">Next-month expense</span>
            <span className="relative inline-flex items-center">
              <input
                checked={watchedNextMonthExpense}
                className="peer sr-only"
                onChange={(event) => {
                  form.setValue('nextMonthExpense', event.target.checked, { shouldDirty: true, shouldTouch: true });
                }}
                type="checkbox"
              />
              <span aria-hidden="true" className={pillToggleTrackClass} />
              <span aria-hidden="true" className={pillToggleThumbClass} />
            </span>
          </label>

          <label className={mobileToggleRowClass}>
            <span className="min-w-0">
              <span className="block font-medium">Installments</span>
              <span className="block text-[13px] leading-4 text-slate-500">Split into multiple monthly charges</span>
            </span>
            <span className="relative inline-flex items-center">
              <input
                checked={watchedInstallmentEnabled}
                className="peer sr-only"
                onChange={(event) => {
                  form.setValue('installmentEnabled', event.target.checked, { shouldDirty: true, shouldTouch: true });
                }}
                type="checkbox"
              />
              <span aria-hidden="true" className={pillToggleTrackClass} />
              <span aria-hidden="true" className={pillToggleThumbClass} />
            </span>
          </label>
        </div>
      </section>

      {watchedInstallmentEnabled ? (
        <section className={mobileSectionClass}>
          <h3 className="text-[18px] font-semibold text-slate-900">Installment setup</h3>
          <label className="block text-sm">
            <span className={mobileFieldLabelClass}>Installment count</span>
            <input className={mobileInputClass} min="2" type="number" {...form.register('installmentCount')} />
          </label>
          <label className="block text-sm">
            <span className={mobileFieldLabelClass}>Entry mode</span>
            <select className={mobileInputClass} {...form.register('installmentEntryMode')}>
              <option value="perInstallment">Per installment amount</option>
              <option value="total">Total amount</option>
            </select>
          </label>
          {watchedInstallmentEntryMode === 'total' ? (
            <label className="block text-sm">
              <span className={mobileFieldLabelClass}>Total amount</span>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 inline-flex items-center text-slate-500">
                  $
                </span>
                <Controller
                  control={form.control}
                  name="totalAmount"
                  render={({ field }) => (
                    <input
                      className={`${mobileInputClass} pl-9 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                      min="0"
                      step="0.01"
                      type="number"
                      value={field.value ?? ''}
                      onBlur={field.onBlur}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        field.onChange(nextValue === '' ? undefined : Number(nextValue));
                      }}
                      name={field.name}
                      ref={field.ref}
                    />
                  )}
                />
              </div>
            </label>
          ) : null}
          {installmentPreview ? (
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {installmentPreview.count} installments: first {formatMoney(installmentPreview.first)} and last {formatMoney(installmentPreview.last)} (total {formatMoney(installmentPreview.total)})
            </div>
          ) : null}
        </section>
      ) : null}

      {watchedFixedEnabled ? (
        <section className="space-y-3 rounded-[24px] border border-indigo-200/30 bg-gradient-to-br from-slate-50 to-indigo-50/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[18px] font-semibold text-slate-900">Recurring schedule</h3>
              <p className="text-[14px] leading-5 text-slate-600">
                This will repeat every month on the {formatOrdinalDayFromDateInput(watchedDate ?? getTodayDateInputValue())}.
              </p>
            </div>
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm">↺</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 shadow-sm">Starts this month</span>
            <span className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 shadow-sm">Editable later</span>
          </div>
        </section>
      ) : null}

      {!editingExpenseId && submissionToast ? (
        <div
          aria-live={submissionToast.kind === 'error' ? 'assertive' : 'polite'}
          className={`relative inline-flex min-h-[44px] w-full items-center gap-2 overflow-hidden rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm ${
            submissionToast.kind === 'loading'
              ? 'border-slate-300 bg-white text-slate-800'
              : submissionToast.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
          role={submissionToast.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="truncate">{submissionToast.message ?? submissionToast.title}</span>
        </div>
      ) : null}

      <div className="space-y-2.5">
        <button
          className="inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[18px] bg-gradient-to-r from-brand-600 to-violet-500 px-4 py-3 text-base font-extrabold text-white shadow-[0_14px_28px_rgba(99,102,241,0.25)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          {!editingExpenseId && saving ? (
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/70 border-t-white" />
          ) : null}
          {editingExpenseId ? 'Save changes' : saving ? 'Saving...' : 'Save expense'}
        </button>
        <button
          className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-300/40 bg-white px-4 py-3 text-sm font-bold text-slate-700"
          onClick={closeMobileComposer}
          type="button"
        >
          Cancel
        </button>
      </div>
    </>
  );

  const fxRatePills = (
    <div className="mt-2 flex flex-wrap gap-2">
      {exchangeRates.length === 0 ? (
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
          No rates yet
        </span>
      ) : (
        exchangeRates.map((rate) => (
          <span
            key={rate.id}
            className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
          >
            {rate.currencyCode} {formatFxRate(rate.rateToArs)}
          </span>
        ))
      )}
    </div>
  );

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
      const pageStart = rows.length === 0 ? 0 : startIndex + 1;
      const pageEnd = rows.length === 0 ? 0 : startIndex + rows.length;
      return {
        ...section,
        rows,
        totalRows,
        currentPage: page,
        totalPages,
        pageStart,
        pageEnd,
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
          title={scopeDialog.expense.installment ? 'Delete installment expense' : 'Delete recurring expense'}
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
      {isMobileAddExpenseOpen ? (
        <ViewportModal onDismiss={closeMobileComposer} presentation="page">
          <div className="flex h-full w-full max-w-none flex-col bg-slate-100 md:hidden">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-4 shadow-[0_1px_0_rgba(226,232,240,0.9)] backdrop-blur">
              <div className="mx-auto flex w-full max-w-[30rem] items-center justify-between gap-3">
              <button
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600"
                onClick={closeMobileComposer}
                type="button"
              >
                <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-slate-900">{editingExpenseId ? 'Edit expense' : 'Add expense'}</p>
                <p className="text-sm text-slate-500">{formatMonthHeading(month)}</p>
              </div>
              </div>
            </div>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} ref={expenseFormRef}>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
                <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4">
                  {mobileExpenseFormFields}
                </div>
              </div>
            </form>
          </div>
        </ViewportModal>
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
            <div className="md:hidden">
              <button
                className="flex w-full items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm"
                onClick={openMobileComposer}
                type="button"
              >
                <div>
                  <p className="text-base font-semibold text-slate-900">{editingExpenseId ? 'Continue editing expense' : 'Add a new expense'}</p>
                </div>
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-violet-500 text-2xl font-semibold text-white shadow-lg shadow-brand-200/70">
                  +
                </span>
              </button>
            </div>

            {!isMobileAddExpenseOpen ? (
              <form
                className="hidden min-w-0 space-y-4 md:block"
                onSubmit={submit}
                ref={expenseFormRef}
              >
                <div className="px-1">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {editingExpenseId ? 'Edit expense' : 'Add expense'}
                  </h2>
                </div>
                <div className="space-y-4" id="add-expense-panel">
                  {expenseFormFields}
                </div>
              </form>
            ) : null}

            <section className={cardClass}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-slate-900">Default FX rates</h3>
                  {fxRatePills}
                </div>
                <button
                  aria-controls="fx-defaults-panel"
                  aria-expanded={isMobileFxOpen}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:hidden"
                  onClick={() => setIsMobileFxOpen((isOpen) => !isOpen)}
                  type="button"
                >
                  {isMobileFxOpen ? 'Close' : 'Edit'}
                </button>
                <button
                  aria-controls="fx-defaults-panel"
                  aria-expanded={isDesktopFxEditing}
                  className="hidden min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:inline-flex"
                  onClick={() => setIsDesktopFxEditing((isEditing) => !isEditing)}
                  type="button"
                >
                  {isDesktopFxEditing ? 'Close' : 'Edit'}
                </button>
              </div>

              <div
                className={`${isMobileFxOpen || isDesktopFxEditing ? 'mt-3 block' : 'hidden'}`}
                id="fx-defaults-panel"
              >
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
                  <div className="relative">
                    <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center text-slate-500">
                      $
                    </span>
                    <input
                      className={moneyInputClass}
                      min="0"
                      onChange={(e) => setNewFxRate(e.target.value)}
                      placeholder="Rate"
                      step="0.000001"
                      type="number"
                      value={newFxRate}
                    />
                  </div>
                  <button className={primaryButtonClass} onClick={() => void onSaveExchangeRate()} type="button">
                    Save
                  </button>
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
                  <div className="hidden w-full flex-col gap-2 sm:w-auto sm:items-end md:flex">
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
                <div className="md:hidden">
                  <div className="flex items-center gap-2">
                    <div className="relative min-w-0 flex-1">
                      <input
                        aria-label="Search expenses"
                        className={tableControlSearchFieldClass}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search expenses..."
                        type="search"
                        value={searchQuery}
                      />
                      {hasSearchQuery ? (
                        <button
                          aria-label="Clear expense search"
                          className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                          onClick={() => setSearchQuery('')}
                          type="button"
                        >
                          X
                        </button>
                      ) : null}
                    </div>
                    <button
                      aria-label="Open expense filters"
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                      onClick={() => setIsMobileFiltersOpen((current) => !current)}
                      type="button"
                    >
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M4 7h16" />
                        <path d="M7 12h10" />
                        <path d="M10 17h4" />
                      </svg>
                    </button>
                  </div>
                  {isMobileFiltersOpen ? (
                    <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <label className="block">
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
                      <div className="grid grid-cols-2 gap-3">
                        <label>
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
                        <label>
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
                      <div className="flex items-center justify-between gap-3">
                        <button
                          className="text-sm font-semibold text-slate-500"
                          onClick={() => setIsMobileFiltersOpen(false)}
                          type="button"
                        >
                          Done
                        </button>
                        <button
                          className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedCategoryId('all');
                            setSortField('date');
                            setSortDirection('desc');
                            resetSectionPages();
                            setIsMobileFiltersOpen(false);
                          }}
                          type="button"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {mobileControlChips.length > 0 || hasActiveControls ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {mobileControlChips.map((chip) => (
                        <span
                          key={chip}
                          className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200"
                        >
                          {chip}
                        </span>
                      ))}
                      {hasActiveControls ? (
                        <button
                          className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedCategoryId('all');
                            setSortField('date');
                            setSortDirection('desc');
                            resetSectionPages();
                          }}
                          type="button"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="hidden md:block" id="expense-mobile-filters">
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-12">
                    <label className="hidden lg:col-span-8 md:block">
                      <span className={tableControlLabelClass}>Search</span>
                      <div className="relative">
                        <input
                          className={tableControlSearchFieldClass}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Description, category, or payer"
                          type="search"
                          value={searchQuery}
                        />
                        {hasSearchQuery ? (
                          <button
                            aria-label="Clear expense search"
                            className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                            onClick={() => setSearchQuery('')}
                            type="button"
                          >
                            X
                          </button>
                        ) : null}
                      </div>
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
                            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
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
                  <section
                    key={section.key}
                    aria-busy={sectionLoading[section.key]}
                    className="overflow-hidden rounded-xl border border-slate-200/80"
                  >
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
                    <div className="relative">
                      {sectionLoading[section.key] ? (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
                          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
                            <svg
                              aria-hidden="true"
                              className="h-4 w-4 animate-spin text-brand-600"
                              fill="none"
                              viewBox="0 0 24 24"
                            >
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-90" d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
                            </svg>
                            Loading...
                          </div>
                        </div>
                      ) : null}
                      <div className={`space-y-3 p-3 md:hidden ${sectionLoading[section.key] ? 'opacity-60' : 'opacity-100'}`}>
                        {section.rows.map((expense) => (
                          <MobileExpenseCard
                            key={expense.id}
                            expense={expense}
                            formatFxRate={formatFxRate}
                            isOpen={openExpenseActionMenuId === expense.id}
                            onClone={() => {
                              setOpenExpenseActionMenuId(null);
                              void cloneExpense(expense);
                            }}
                            onDelete={() => {
                              setOpenExpenseActionMenuId(null);
                              void removeExpense(expense);
                            }}
                            onEdit={() => {
                              setOpenExpenseActionMenuId(null);
                              startEdit(expense);
                            }}
                            onOpenChange={(nextOpen) => setOpenExpenseActionMenuId(nextOpen ? expense.id : null)}
                          />
                        ))}
                        {section.rows.length === 0 ? (
                          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                            {section.emptyMessage}
                          </p>
                        ) : null}
                      </div>
                      <div className="hidden w-full max-w-full overflow-x-auto md:block">
                        <table
                          className={`w-full min-w-[840px] table-fixed divide-y divide-slate-200 text-sm transition-opacity ${
                            sectionLoading[section.key] ? 'opacity-60' : 'opacity-100'
                          }`}
                        >
                          <caption className="sr-only">{section.title}</caption>
                          <colgroup>
                            <col className="w-[14%]" />
                            <col className="w-[24%]" />
                            <col className="w-[14%]" />
                            <col className="w-[22%]" />
                            <col className="w-[16%]" />
                            <col className="w-[10%]" />
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
                              <th className="whitespace-nowrap px-4 py-3 text-right font-medium" scope="col">
                                <span className="sr-only">Actions</span>
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
                                  <div className="truncate text-xs text-slate-500">{getExpenseKindLabel(expense)}</div>
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
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                  <DesktopExpenseActionMenu
                                    expenseId={expense.id}
                                    isOpen={openExpenseActionMenuId === expense.id}
                                    onClone={() => void cloneExpense(expense)}
                                    onDelete={() => void removeExpense(expense)}
                                    onEdit={() => startEdit(expense)}
                                    onOpenChange={(nextOpen) => setOpenExpenseActionMenuId(nextOpen ? expense.id : null)}
                                  />
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
                    </div>
                    {section.showSectionPager ? (
                      <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-medium text-slate-600">
                          Showing {section.pageStart}-{section.pageEnd} of {section.totalRows}
                          {section.hasMore ? '+' : ''} results
                        </p>
                        <div className="flex items-center gap-3">
                          <button
                            aria-label={`Previous ${section.title} page`}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={section.currentPage === 1 || sectionLoading[section.key]}
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
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                            disabled={!section.canMoveNext || sectionLoading[section.key]}
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
