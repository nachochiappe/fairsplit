'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { computeInstallmentAmounts } from '@fairsplit/shared';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AppShell } from '../../components/AppShell';
import { MonthSelector } from '../../components/MonthSelector';
import { ViewportModal } from '../../components/ViewportModal';
import { formatMoney } from '../../lib/currency';
import { localeTags, t, type Translation } from '../../lib/i18n';
import { addMonths } from '../../lib/month';
import {
  DEFAULT_MAX_ROWS_PER_SECTION,
  getSectionFetchBatchSize,
  PREFETCH_AHEAD_PAGES,
  SECTION_CACHE_TTL_MS,
} from './pagination';
import {
  Category,
  createOptimisticExpenseId,
  createExpense,
  deleteExpense,
  ExchangeRate,
  Expense,
  ExpenseListResponse,
  type AppLocale,
  getExchangeRates,
  getExpenses,
  getSettlement,
  materializeExpenseMonth,
  updateExpense,
  User,
} from '../../lib/api';
import {
  adjustSectionPagination,
  adjustSubtotalTotals,
  adjustTotalCombinedExpensesArs,
  createExpenseScreenSnapshot,
  ExpenseFilterState,
  ExpenseScreenSnapshot,
  ExpenseSectionKey,
  mergeUniqueExpenses,
  patchExpense,
  removeExpenseById,
  removeExpenses,
  SectionPaginationMap,
  sumExpensesArs,
  insertExpense,
} from './optimistic-expenses';
import {
  tableControlFieldClass,
  tableControlLabelClass,
  tableControlSearchFieldClass,
} from './expense-styles';
import { ExpenseComposerFields, MobileExpenseComposerFields } from './ExpenseComposerFields';
import {
  createExpenseFormDefaults,
  dateInputValueToMonth,
  expenseSchema,
  ExpenseForm,
  getTodayDateInputValue,
  toSupportedCurrencyCode,
} from './expense-form';
import { ConfirmationDialog } from './ConfirmationDialog';
import { ScopeDialog } from './ScopeDialog';
import { MobileExpenseCard } from './MobileExpenseCard';
import { DesktopExpenseRow } from './DesktopExpenseRow';

type ApplyScope = 'single' | 'future' | 'all';
type ExpenseSortField = 'date' | 'description' | 'category' | 'amountArs' | 'paidBy';
type SortDirection = 'asc' | 'desc';
type ExpenseTypeFilter = 'all' | ExpenseSectionKey;
const DEFAULT_SORT_FIELD: ExpenseSortField = 'date';
const DEFAULT_SORT_DIRECTION: SortDirection = 'desc';
const SEARCH_DEBOUNCE_MS = 350;

type ExpensesCopy = Translation['expenses'];

const SORTABLE_EXPENSE_FIELDS: readonly ExpenseSortField[] = [
  'date',
  'description',
  'category',
  'paidBy',
  'amountArs',
];

function getSortFieldLabel(copy: ExpensesCopy, sortField: ExpenseSortField): string {
  switch (sortField) {
    case 'description':
      return copy.columns.description;
    case 'category':
      return copy.columns.category;
    case 'amountArs':
      return copy.columns.amount;
    case 'paidBy':
      return copy.columns.paidBy;
    default:
      return copy.columns.date;
  }
}

const NO_INCOME_SETTLEMENT_ERROR = 'Cannot calculate settlement when total income is non-positive';

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
  kind: 'success' | 'error';
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
  locale: AppLocale;
}

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

function makeSectionOpenMap(value: boolean): Record<ExpenseSectionKey, boolean> {
  return {
    fixed: value,
    oneTime: value,
    installment: value,
  };
}

function formatMonthHeading(value: string, locale: AppLocale): string {
  const date = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(localeTags[locale], {
    month: 'long',
    year: 'numeric',
  });
}

function getDefaultSortDirection(sortField: ExpenseSortField): SortDirection {
  if (sortField === 'description' || sortField === 'category' || sortField === 'paidBy') {
    return 'asc';
  }

  return 'desc';
}

function getAriaSortValue(
  activeSortField: ExpenseSortField,
  activeSortDirection: SortDirection,
  currentField: ExpenseSortField,
): 'ascending' | 'descending' | 'none' {
  if (activeSortField !== currentField) {
    return 'none';
  }

  return activeSortDirection === 'asc' ? 'ascending' : 'descending';
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
  locale,
}: ExpensesClientProps) {
  const copy = t(locale).expenses;
  const shared = t(locale).common;
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [warnings, setWarnings] = useState<string[]>(initialWarnings);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(initialExchangeRates);
  const [totalCombinedExpensesArs, setTotalCombinedExpensesArs] = useState<number>(
    Number(initialTotalExpensesArs),
  );
  const [subtotalTotals, setSubtotalTotals] =
    useState<ExpenseListResponse['totals']>(initialTotals);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [scopeDialog, setScopeDialog] = useState<ScopeDialogState | null>(null);
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialogState | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionToast, setSubmissionToast] = useState<SubmissionToastState | null>(null);
  const [maxRowsPerSection, setMaxRowsPerSection] = useState<10 | 25 | 50>(
    DEFAULT_MAX_ROWS_PER_SECTION,
  );
  const fetchBatchSize = useMemo(
    () => getSectionFetchBatchSize(maxRowsPerSection),
    [maxRowsPerSection],
  );
  const [sectionPages, setSectionPages] = useState<Record<ExpenseSectionKey, number>>({
    fixed: 1,
    oneTime: 1,
    installment: 1,
  });
  const [sectionPagination, setSectionPagination] =
    useState<SectionPaginationMap>(initialSectionPagination);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [sortField, setSortField] = useState<ExpenseSortField>(DEFAULT_SORT_FIELD);
  const [sortDirection, setSortDirection] = useState<SortDirection>(DEFAULT_SORT_DIRECTION);
  const [selectedExpenseType, setSelectedExpenseType] = useState<ExpenseTypeFilter>('all');
  const [isMoreFiltersOpen, setIsMoreFiltersOpen] = useState(false);
  const hasSearchQuery = searchQuery.trim().length > 0;
  const [isMobileAddExpenseOpen, setIsMobileAddExpenseOpen] = useState(false);
  const [openExpenseActionMenuId, setOpenExpenseActionMenuId] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState<Record<ExpenseSectionKey, boolean>>(
    makeSectionOpenMap(true),
  );
  const [sectionLoading, setSectionLoading] = useState<Record<ExpenseSectionKey, boolean>>(
    makeSectionLoadingMap(false),
  );
  const expensesRef = useRef(expenses);
  const submissionToastTimeoutRef = useRef<number | null>(null);
  const warningsRef = useRef(warnings);
  const sectionPaginationRef = useRef(sectionPagination);
  const exchangeRatesRef = useRef(exchangeRates);
  const subtotalTotalsRef = useRef(subtotalTotals);
  const totalCombinedExpensesArsRef = useRef(totalCombinedExpensesArs);
  const sectionFetchInFlightRef =
    useRef<Record<ExpenseSectionKey, Promise<void> | null>>(makeSectionPromiseMap());
  const sectionCacheFetchedAtRef = useRef<Record<ExpenseSectionKey, number>>(
    makeSectionTimestampMap(Date.now()),
  );
  const sectionPrefetchTargetRef = useRef<Record<ExpenseSectionKey, string | null>>(
    makeSectionPrefetchTargetMap(),
  );
  const sectionLoadingCountRef = useRef<Record<ExpenseSectionKey, number>>({
    fixed: 0,
    oneTime: 0,
    installment: 0,
  });
  const fetchBatchSizeRef = useRef(fetchBatchSize);
  const expenseFormRef = useRef<HTMLFormElement | null>(null);
  const moreFiltersRef = useRef<HTMLDivElement | null>(null);
  const mutationTokenRef = useRef(0);
  const materializedMonthRef = useRef<string | null>(null);

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
    if (!isMoreFiltersOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        moreFiltersRef.current &&
        event.target instanceof Node &&
        !moreFiltersRef.current.contains(event.target)
      ) {
        setIsMoreFiltersOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMoreFiltersOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreFiltersOpen]);

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
    if (!submissionToast) {
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
    () =>
      [...activeCategories].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [activeCategories],
  );
  const hasActiveFilters = useMemo(
    () => Boolean(searchQuery.trim()) || selectedCategoryId !== 'all',
    [searchQuery, selectedCategoryId],
  );
  const handleSortChange = useCallback(
    (nextSortField: ExpenseSortField) => {
      if (nextSortField === sortField) {
        setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
        return;
      }

      setSortField(nextSortField);
      setSortDirection(getDefaultSortDirection(nextSortField));
    },
    [sortField],
  );
  const sortableColumns = useMemo(
    () =>
      SORTABLE_EXPENSE_FIELDS.map((field) => ({ field, label: getSortFieldLabel(copy, field) })),
    [copy],
  );
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
        const searchableText =
          `${expense.description} ${expense.categoryName} ${expense.paidByUserName}`.toLowerCase();
        return searchableText.includes(searchTerm);
      });

      const sorted = [...withFilters];
      sorted.sort((left, right) => {
        let comparison = 0;
        if (sortField === 'description') {
          comparison = left.description.localeCompare(right.description, undefined, {
            sensitivity: 'base',
          });
        } else if (sortField === 'category') {
          comparison = left.categoryName.localeCompare(right.categoryName, undefined, {
            sensitivity: 'base',
          });
        } else if (sortField === 'amountArs') {
          comparison = Number(left.amountArs) - Number(right.amountArs);
        } else if (sortField === 'paidBy') {
          comparison = left.paidByUserName.localeCompare(right.paidByUserName, undefined, {
            sensitivity: 'base',
          });
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
  const optimisticFilterState = useMemo<ExpenseFilterState>(
    () => ({
      searchQuery: debouncedSearchQuery,
      categoryId: selectedCategoryId,
    }),
    [debouncedSearchQuery, selectedCategoryId],
  );
  const filterQueryRef = useRef(filterQuery);
  const optimisticFilterStateRef = useRef(optimisticFilterState);
  const hasMountedFilterTotalsEffectRef = useRef(false);
  useEffect(() => {
    filterQueryRef.current = filterQuery;
  }, [filterQuery]);
  useEffect(() => {
    optimisticFilterStateRef.current = optimisticFilterState;
  }, [optimisticFilterState]);
  const visibleExpenses = useMemo(
    () => applyClientControls(expenses),
    [applyClientControls, expenses],
  );
  const loadedFilteredSubtotalArs = useMemo(
    () => visibleExpenses.reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [visibleExpenses],
  );
  const loadedFixedSubtotalArs = useMemo(
    () =>
      visibleExpenses
        .filter((expense) => expense.fixed.enabled)
        .reduce((sum, expense) => sum + Number(expense.amountArs), 0),
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
  const filteredSubtotalArs = subtotalTotals
    ? Number(subtotalTotals.filteredSubtotalArs)
    : loadedFilteredSubtotalArs;
  const fixedSubtotalArs = subtotalTotals
    ? Number(subtotalTotals.bySection.fixedArs)
    : loadedFixedSubtotalArs;
  const installmentSubtotalArs = subtotalTotals
    ? Number(subtotalTotals.bySection.installmentArs)
    : loadedInstallmentSubtotalArs;
  const oneTimeSubtotalArs = subtotalTotals
    ? Number(subtotalTotals.bySection.oneTimeArs)
    : loadedOneTimeSubtotalArs;
  const fixedExpenses = useMemo(
    () => visibleExpenses.filter((expense) => expense.fixed.enabled),
    [visibleExpenses],
  );
  const installmentExpenses = useMemo(
    () =>
      visibleExpenses.filter((expense) => !expense.fixed.enabled && Boolean(expense.installment)),
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
    defaultValues: createExpenseFormDefaults({
      categoryId: initialCategories.find((category) => category.archivedAt === null)?.id ?? '',
      paidByUserId: resolveDefaultPaidByUserId(initialUsers, currentUserId),
    }),
  });

  const formatFxRate = useCallback(
    (value: string | number) =>
      `$${Number(value).toLocaleString(localeTags[locale], {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    [locale],
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

  const resetForm = useCallback(
    (defaultCategoryId: string) => {
      form.reset(
        createExpenseFormDefaults({
          categoryId: defaultCategoryId,
          paidByUserId: defaultPaidByUserId,
        }),
      );
      form.resetField('amount', { defaultValue: undefined });
      form.resetField('totalAmount', { defaultValue: undefined });
    },
    [defaultPaidByUserId, form],
  );

  const applyExpenseScreenSnapshot = useCallback((snapshot: ExpenseScreenSnapshot) => {
    expensesRef.current = snapshot.expenses;
    warningsRef.current = snapshot.warnings;
    sectionPaginationRef.current = snapshot.sectionPagination;
    exchangeRatesRef.current = snapshot.exchangeRates;
    subtotalTotalsRef.current = snapshot.subtotalTotals;
    totalCombinedExpensesArsRef.current = snapshot.totalCombinedExpensesArs;

    startTransition(() => {
      setExpenses(snapshot.expenses);
      setWarnings(snapshot.warnings);
      setSectionPagination(snapshot.sectionPagination);
      setExchangeRates(snapshot.exchangeRates);
      setSubtotalTotals(snapshot.subtotalTotals);
      setTotalCombinedExpensesArs(snapshot.totalCombinedExpensesArs);
    });
  }, []);

  const captureExpenseScreenSnapshot = useCallback(
    () =>
      createExpenseScreenSnapshot({
        expenses: expensesRef.current,
        warnings: warningsRef.current,
        subtotalTotals: subtotalTotalsRef.current,
        totalCombinedExpensesArs: totalCombinedExpensesArsRef.current,
        sectionPagination: sectionPaginationRef.current,
        exchangeRates: exchangeRatesRef.current,
      }),
    [],
  );

  const applyExpenseMutationState = useCallback(
    (options: {
      expenses: Expense[];
      previousAffected?: Expense[];
      nextAffected?: Expense[];
      warnings?: string[];
      exchangeRates?: ExchangeRate[];
      subtotalTotals?: ExpenseListResponse['totals'];
      totalCombinedExpensesArs?: number;
      sectionPagination?: SectionPaginationMap;
    }) => {
      const previousSnapshot = captureExpenseScreenSnapshot();
      const previousAffected = options.previousAffected ?? [];
      const nextAffected = options.nextAffected ?? [];
      const nextSnapshot: ExpenseScreenSnapshot = {
        expenses: options.expenses,
        warnings: options.warnings ?? previousSnapshot.warnings,
        subtotalTotals:
          options.subtotalTotals ??
          adjustSubtotalTotals(
            previousSnapshot.subtotalTotals,
            previousAffected,
            nextAffected,
            optimisticFilterStateRef.current,
          ),
        totalCombinedExpensesArs:
          options.totalCombinedExpensesArs ??
          adjustTotalCombinedExpensesArs(
            previousSnapshot.totalCombinedExpensesArs,
            previousAffected,
            nextAffected,
          ),
        sectionPagination:
          options.sectionPagination ??
          adjustSectionPagination(
            previousSnapshot.sectionPagination,
            previousAffected,
            nextAffected,
          ),
        exchangeRates: options.exchangeRates ?? previousSnapshot.exchangeRates,
      };

      applyExpenseScreenSnapshot(nextSnapshot);
      return nextSnapshot;
    },
    [applyExpenseScreenSnapshot, captureExpenseScreenSnapshot],
  );

  const getUserName = useCallback(
    (userId: string, fallbackName: string) =>
      users.find((user) => user.id === userId)?.name ?? fallbackName,
    [users],
  );

  const getCategoryDetails = useCallback(
    (categoryId: string, fallbackExpense?: Expense) => {
      const category = categories.find((entry) => entry.id === categoryId);
      return {
        categoryName: category?.name ?? fallbackExpense?.categoryName ?? copy.uncategorized,
        superCategoryId: category?.superCategoryId ?? fallbackExpense?.superCategoryId ?? null,
        superCategoryName:
          category?.superCategoryName ?? fallbackExpense?.superCategoryName ?? null,
        superCategoryColor:
          category?.superCategoryColor ?? fallbackExpense?.superCategoryColor ?? null,
      };
    },
    [categories, copy.uncategorized],
  );

  const toAmountArsString = useCallback((amountOriginal: string, fxRateUsed: string) => {
    return (Number(amountOriginal) * Number(fxRateUsed)).toFixed(2);
  }, []);

  const buildInstallmentValues = useCallback(
    (
      options:
        | {
            installmentPayload?: Parameters<typeof createExpense>[0]['installment'];
            amount?: number;
            existingExpense?: Expense;
          }
        | {
            installmentPayload?: Parameters<typeof updateExpense>[1]['installment'];
            amount?: number;
            existingExpense?: Expense;
          },
    ) => {
      const payload = options.installmentPayload;
      const existingExpense = options.existingExpense;
      if (!payload?.enabled && !existingExpense?.installment) {
        return null;
      }

      const existingInstallment = existingExpense?.installment;
      const nextTotal = payload?.enabled
        ? (payload.count ?? existingInstallment?.total ?? 1)
        : (existingInstallment?.total ?? 1);
      const entryMode = payload?.enabled
        ? (payload.entryMode ?? (payload.totalAmount !== undefined ? 'total' : 'perInstallment'))
        : 'perInstallment';
      const perInstallmentAmount =
        payload?.enabled && entryMode === 'perInstallment'
          ? (payload.perInstallmentAmount ??
            options.amount ??
            Number(existingExpense?.amountOriginal ?? 0))
          : (options.amount ?? Number(existingExpense?.amountOriginal ?? 0));
      const totalAmount =
        payload?.enabled && entryMode === 'total'
          ? payload.totalAmount
          : existingInstallment?.source === 'manual' && existingInstallment.total > 0
            ? undefined
            : undefined;

      const schedule = computeInstallmentAmounts({
        count: nextTotal,
        entryMode,
        perInstallmentAmount,
        totalAmount,
      });
      const installmentNumber = existingInstallment?.number ?? 1;
      if (installmentNumber > nextTotal) {
        return null;
      }

      return {
        amountOriginal: schedule.amounts[installmentNumber - 1] ?? schedule.amounts[0] ?? '0.00',
        installment: {
          seriesId:
            existingInstallment?.seriesId ?? `optimistic:series:${createOptimisticExpenseId()}`,
          number: installmentNumber,
          total: nextTotal,
          isGenerated: existingInstallment?.isGenerated ?? false,
          source: existingInstallment?.source ?? 'manual',
        },
      };
    },
    [],
  );

  const buildOptimisticCreateExpense = useCallback(
    (
      payload: Parameters<typeof createExpense>[0],
      source: NonNullable<Expense['optimisticSource']>,
      existingExpense?: Expense,
    ): Expense | null => {
      if (payload.month !== month) {
        return null;
      }

      const fxRateUsed =
        (payload.currencyCode ?? 'ARS') === 'ARS'
          ? '1.000000'
          : Number(payload.fxRate ?? 0).toFixed(6);
      const installmentValues = buildInstallmentValues({
        installmentPayload: payload.installment,
        amount: payload.amount,
        existingExpense,
      });
      const amountOriginal =
        installmentValues?.amountOriginal ?? Number(payload.amount ?? 0).toFixed(2);
      const categoryDetails = getCategoryDetails(payload.categoryId, existingExpense);

      return {
        id: createOptimisticExpenseId(),
        isOptimistic: true,
        optimisticSource: source,
        month: payload.month,
        date: payload.date,
        description: payload.description,
        categoryId: payload.categoryId,
        categoryName: categoryDetails.categoryName,
        superCategoryId: categoryDetails.superCategoryId,
        superCategoryName: categoryDetails.superCategoryName,
        superCategoryColor: categoryDetails.superCategoryColor,
        amountOriginal,
        amountArs: toAmountArsString(amountOriginal, fxRateUsed),
        currencyCode: payload.currencyCode ?? 'ARS',
        fxRateUsed,
        paidByUserId: payload.paidByUserId,
        paidByUserName: getUserName(
          payload.paidByUserId,
          existingExpense?.paidByUserName ?? copy.unknownUser,
        ),
        fixed: {
          enabled: Boolean(payload.fixed?.enabled),
          templateId: payload.fixed?.enabled
            ? `optimistic:template:${createOptimisticExpenseId()}`
            : null,
        },
        installment: installmentValues?.installment ?? null,
      };
    },
    [
      buildInstallmentValues,
      copy.unknownUser,
      getCategoryDetails,
      getUserName,
      month,
      toAmountArsString,
    ],
  );

  const buildOptimisticUpdatedExpense = useCallback(
    (existingExpense: Expense, payload: Parameters<typeof updateExpense>[1]): Expense | null => {
      const nextMonthValue = payload.month ?? existingExpense.month;
      if (nextMonthValue !== month) {
        return null;
      }

      const nextCurrencyCode = payload.currencyCode ?? existingExpense.currencyCode;
      const nextFxRateUsed =
        nextCurrencyCode === 'ARS'
          ? '1.000000'
          : payload.fxRate !== undefined
            ? Number(payload.fxRate).toFixed(6)
            : existingExpense.fxRateUsed;
      const nextInstallmentValues = buildInstallmentValues({
        installmentPayload: payload.installment,
        amount: payload.amount,
        existingExpense,
      });
      if (existingExpense.installment && nextInstallmentValues === null) {
        return null;
      }

      const amountOriginal =
        nextInstallmentValues?.amountOriginal ??
        (payload.amount !== undefined
          ? Number(payload.amount).toFixed(2)
          : existingExpense.amountOriginal);
      const nextCategoryId = payload.categoryId ?? existingExpense.categoryId;
      const categoryDetails = getCategoryDetails(nextCategoryId, existingExpense);
      const nextPaidByUserId = payload.paidByUserId ?? existingExpense.paidByUserId;

      return {
        ...existingExpense,
        isOptimistic: true,
        optimisticSource: 'update',
        month: nextMonthValue,
        date: payload.date ?? existingExpense.date,
        description: payload.description ?? existingExpense.description,
        categoryId: nextCategoryId,
        categoryName: categoryDetails.categoryName,
        superCategoryId: categoryDetails.superCategoryId,
        superCategoryName: categoryDetails.superCategoryName,
        superCategoryColor: categoryDetails.superCategoryColor,
        amountOriginal,
        amountArs: toAmountArsString(amountOriginal, nextFxRateUsed),
        currencyCode: nextCurrencyCode,
        fxRateUsed: nextFxRateUsed,
        paidByUserId: nextPaidByUserId,
        paidByUserName: getUserName(nextPaidByUserId, existingExpense.paidByUserName),
        installment: nextInstallmentValues?.installment ?? existingExpense.installment,
      };
    },
    [buildInstallmentValues, getCategoryDetails, getUserName, month, toAmountArsString],
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

  const cancelEdit = useCallback(() => {
    setEditingExpenseId(null);
    resetForm(sortedActiveCategories[0]?.id ?? '');
    setIsMobileAddExpenseOpen(false);
  }, [resetForm, sortedActiveCategories]);

  const resetExpenseComposer = useCallback(
    (options?: { closeMobile?: boolean }) => {
      setEditingExpenseId(null);
      resetForm(sortedActiveCategories[0]?.id ?? '');
      if (options?.closeMobile ?? true) {
        setIsMobileAddExpenseOpen(false);
      }
    },
    [resetForm, sortedActiveCategories],
  );

  // Reconciliation keeps the current ledger interactive by default. Callers must
  // opt into a blocking state only when the currently rendered rows are unusable.
  const reconcileMonthData = useCallback(
    async (options?: {
      includeRates?: boolean;
      includeSettlement?: boolean;
      mutationToken?: number;
      showSectionLoading?: boolean;
    }) => {
      const allSectionKeys: ExpenseSectionKey[] = ['fixed', 'oneTime', 'installment'];
      const showSectionLoading = options?.showSectionLoading ?? false;
      if (showSectionLoading) {
        beginSectionLoading(allSectionKeys);
      }

      try {
        const includeRates = options?.includeRates ?? false;
        const includeSettlement = options?.includeSettlement ?? false;
        const mutationToken = options?.mutationToken;
        const sharedQuery = {
          sortBy: 'date' as const,
          sortDir: 'desc' as const,
          limit: fetchBatchSizeRef.current,
        };
        let hasNoIncomeSettlement = false;

        const materialization = await materializeExpenseMonth(month);
        const [fixedData, oneTimeData, installmentData, totalsData, rates, settlement] =
          await Promise.all([
            getExpenses(month, {
              ...sharedQuery,
              type: 'fixed',
              includeCount: true,
            }),
            getExpenses(month, {
              ...sharedQuery,
              type: 'oneTime',
              includeCount: false,
            }),
            getExpenses(month, {
              ...sharedQuery,
              type: 'installment',
              includeCount: false,
            }),
            getExpenses(month, {
              ...filterQueryRef.current,
              sortBy: 'date',
              sortDir: 'desc',
              limit: 1,
              includeCount: false,
              includeTotals: true,
            }),
            includeRates ? getExchangeRates(month) : Promise.resolve<ExchangeRate[] | null>(null),
            includeSettlement
              ? getSettlement(month).catch((error: unknown) => {
                  const message =
                    error instanceof Error ? error.message : copy.settlementLoadFailed;
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

        if (mutationToken !== undefined && mutationToken !== mutationTokenRef.current) {
          return;
        }

        const mergedExpenses = mergeUniqueExpenses([
          ...fixedData.expenses,
          ...oneTimeData.expenses,
          ...installmentData.expenses,
        ]);
        const nextWarnings = Array.from(
          new Set([
            ...materialization.warnings,
            ...fixedData.warnings,
            ...oneTimeData.warnings,
            ...installmentData.warnings,
            ...(hasNoIncomeSettlement ? [copy.noIncomeWarning] : []),
          ]),
        );

        let nextTotalExpensesArs = settlement
          ? Number(settlement.totalExpenses)
          : totalCombinedExpensesArsRef.current;
        if (hasNoIncomeSettlement) {
          const allExpensesResult = await getExpenses(month, {
            sortBy: 'date',
            sortDir: 'desc',
            includeCount: false,
          });
          nextTotalExpensesArs = sumExpensesArs(allExpensesResult.expenses);
        }

        if (mutationToken !== undefined && mutationToken !== mutationTokenRef.current) {
          return;
        }

        applyExpenseScreenSnapshot({
          expenses: mergedExpenses,
          warnings: nextWarnings,
          sectionPagination: paginationBySection,
          subtotalTotals: totalsData.totals,
          totalCombinedExpensesArs: nextTotalExpensesArs,
          exchangeRates: rates ?? exchangeRatesRef.current,
        });
        sectionCacheFetchedAtRef.current = makeSectionTimestampMap(Date.now());
        invalidateSectionChunkState();
      } finally {
        if (showSectionLoading) {
          endSectionLoading(allSectionKeys);
        }
      }
    },
    [
      applyExpenseScreenSnapshot,
      beginSectionLoading,
      copy.noIncomeWarning,
      copy.settlementLoadFailed,
      endSectionLoading,
      invalidateSectionChunkState,
      month,
    ],
  );

  const runBackgroundRefresh = useCallback(
    async (
      mutationToken: number,
      options: { includeRates?: boolean; includeSettlement?: boolean },
      failureMessage: string,
    ) => {
      try {
        await reconcileMonthData({ ...options, mutationToken, showSectionLoading: false });
      } catch (refreshError) {
        if (mutationToken !== mutationTokenRef.current) {
          return;
        }
        setError(
          refreshError instanceof Error
            ? `${failureMessage} ${refreshError.message}`
            : failureMessage,
        );
      }
    },
    [reconcileMonthData],
  );

  useEffect(() => {
    setUsers(initialUsers);
    setCategories(initialCategories);
    applyExpenseScreenSnapshot({
      expenses: initialExpenses,
      warnings: initialWarnings,
      sectionPagination: initialSectionPagination,
      exchangeRates: initialExchangeRates,
      totalCombinedExpensesArs: Number(initialTotalExpensesArs),
      subtotalTotals: initialTotals,
    });
    setError(null);
    resetSectionPages();
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
    applyExpenseScreenSnapshot,
    invalidateSectionChunkState,
    resetForm,
    resetSectionPages,
  ]);

  useEffect(() => {
    if (materializedMonthRef.current === month) {
      return;
    }
    materializedMonthRef.current = month;

    let cancelled = false;

    void reconcileMonthData({
      includeRates: false,
      includeSettlement: true,
      mutationToken: mutationTokenRef.current,
      showSectionLoading: false,
    }).catch((loadError) => {
      if (!cancelled) {
        materializedMonthRef.current = null;
        setError(loadError instanceof Error ? loadError.message : copy.settlementLoadFailed);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [copy.settlementLoadFailed, month, reconcileMonthData]);

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
  }, [
    debouncedSearchQuery,
    selectedCategoryId,
    sortField,
    sortDirection,
    invalidateSectionChunkState,
    resetSectionPages,
  ]);

  useEffect(() => {
    setSectionPages((previousPages) => ({
      fixed: Math.min(
        previousPages.fixed,
        Math.max(1, Math.ceil(fixedExpenses.length / maxRowsPerSection)),
      ),
      oneTime: Math.min(
        previousPages.oneTime,
        Math.max(1, Math.ceil(oneTimeExpenses.length / maxRowsPerSection)),
      ),
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
    exchangeRatesRef.current = exchangeRates;
    subtotalTotalsRef.current = subtotalTotals;
    totalCombinedExpensesArsRef.current = totalCombinedExpensesArs;
  }, [
    exchangeRates,
    expenses,
    sectionPagination,
    subtotalTotals,
    totalCombinedExpensesArs,
    warnings,
  ]);

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

  const mapScopedExpenses = useCallback(
    (
      list: Expense[],
      predicate: (expense: Expense) => boolean,
      mapper: (expense: Expense) => Expense | null,
    ) => {
      const previousAffected = list.filter(predicate);
      const nextAffected = previousAffected
        .map(mapper)
        .filter((expense): expense is Expense => expense !== null);

      return {
        expenses: mergeUniqueExpenses([
          ...nextAffected,
          ...list.filter((expense) => !predicate(expense)),
        ]),
        previousAffected,
        nextAffected,
      };
    },
    [],
  );

  const buildUpdatePayload = useCallback(
    (values: ExpenseForm, scope?: ApplyScope) => {
      const applyToFuture =
        values.fixedEnabled && !values.installmentEnabled ? values.applyToFuture : false;
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
          perInstallmentAmount:
            values.installmentEntryMode === 'perInstallment' ? values.amount : undefined,
          totalAmount: values.installmentEntryMode === 'total' ? values.totalAmount : undefined,
        };
      }

      return payload;
    },
    [month],
  );

  const buildCreatePayload = useCallback(
    (values: ExpenseForm) => {
      const issuedMonth = values.nextMonthExpense ? addMonths(month, 1) : month;
      return {
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
              perInstallmentAmount:
                values.installmentEntryMode === 'perInstallment' ? values.amount : undefined,
              totalAmount: values.installmentEntryMode === 'total' ? values.totalAmount : undefined,
            }
          : undefined,
      };
    },
    [month],
  );

  const runOptimisticMutation = useCallback(
    async <T,>(options: {
      successTitle: string;
      successMessage: string;
      errorTitle: string;
      errorFallbackMessage: string;
      applyOptimistic?: () => void;
      execute: () => Promise<T>;
      reconcile?: (result: T) => void;
      onSuccess?: (result: T, mutationToken: number) => void;
    }) => {
      const mutationToken = mutationTokenRef.current + 1;
      mutationTokenRef.current = mutationToken;
      const snapshot = captureExpenseScreenSnapshot();

      setSaving(true);
      setError(null);
      options.applyOptimistic?.();

      try {
        const result = await options.execute();
        if (mutationToken !== mutationTokenRef.current) {
          return;
        }

        options.reconcile?.(result);
        options.onSuccess?.(result, mutationToken);
        setSubmissionToast({
          id: Date.now(),
          kind: 'success',
          title: options.successTitle,
          message: options.successMessage,
        });
      } catch (mutationError) {
        if (mutationToken !== mutationTokenRef.current) {
          return;
        }

        applyExpenseScreenSnapshot(snapshot);
        const message =
          mutationError instanceof Error ? mutationError.message : options.errorFallbackMessage;
        setError(message);
        setSubmissionToast({
          id: Date.now(),
          kind: 'error',
          title: options.errorTitle,
          message,
        });
      } finally {
        if (mutationToken === mutationTokenRef.current) {
          setSaving(false);
        }
      }
    },
    [applyExpenseScreenSnapshot, captureExpenseScreenSnapshot],
  );

  const submit = form.handleSubmit(async (values) => {
    const wasEditing = Boolean(editingExpenseId);

    if (editingExpenseId) {
      const current = expensesRef.current.find((expense) => expense.id === editingExpenseId);
      if (!current) {
        setError(copy.expenseNotFound);
        return;
      }

      const scope: ApplyScope = current.installment
        ? 'all'
        : current.fixed.enabled
          ? values.applyToFuture
            ? 'future'
            : 'single'
          : 'single';
      const payload = buildUpdatePayload(values, scope);
      const scopedPredicate = current.installment?.seriesId
        ? (expense: Expense) => expense.installment?.seriesId === current.installment?.seriesId
        : current.fixed.templateId
          ? (expense: Expense) => expense.fixed.templateId === current.fixed.templateId
          : (expense: Expense) => expense.id === current.id;

      await runOptimisticMutation({
        successTitle: copy.toasts.expenseUpdated,
        successMessage: copy.toasts.changesSaved,
        errorTitle: copy.toasts.couldNotUpdate,
        errorFallbackMessage: copy.toasts.saveFailed,
        applyOptimistic: () => {
          const updateResult =
            scope === 'single'
              ? patchExpense(expensesRef.current, current.id, (expense) => {
                  const nextExpense = buildOptimisticUpdatedExpense(expense, payload);
                  return nextExpense ?? expense;
                })
              : mapScopedExpenses(expensesRef.current, scopedPredicate, (expense) =>
                  buildOptimisticUpdatedExpense(expense, payload),
                );
          applyExpenseMutationState(updateResult);
          resetExpenseComposer();
        },
        execute: () => updateExpense(current.id, payload),
        reconcile: (updatedExpense) => {
          const currentExpenses = expensesRef.current;
          const currentRow = currentExpenses.find((expense) => expense.id === current.id);

          if (updatedExpense.month !== month) {
            if (!currentRow) {
              return;
            }
            const removal = removeExpenseById(currentExpenses, current.id);
            applyExpenseMutationState(removal);
            return;
          }

          if (currentRow) {
            const replacement = patchExpense(currentExpenses, current.id, () => ({
              ...updatedExpense,
              isOptimistic: false,
              optimisticSource: undefined,
            }));
            applyExpenseMutationState(replacement);
            return;
          }

          const insertion = insertExpense(currentExpenses, {
            ...updatedExpense,
            isOptimistic: false,
            optimisticSource: undefined,
          });
          applyExpenseMutationState(insertion);
        },
        onSuccess: (_result, mutationToken) => {
          if (current.installment || (current.fixed.enabled && scope !== 'single')) {
            void runBackgroundRefresh(
              mutationToken,
              { includeRates: false, includeSettlement: true },
              copy.updatedNoRefresh,
            );
          }
        },
      });
      return;
    }

    const payload = buildCreatePayload(values);
    const optimisticExpense = buildOptimisticCreateExpense(payload, 'create');
    const optimisticExpenseId = optimisticExpense?.id ?? null;

    await runOptimisticMutation({
      successTitle: copy.toasts.expenseAdded,
      successMessage: copy.toasts.addedSuccessfully,
      errorTitle: copy.toasts.couldNotAdd,
      errorFallbackMessage: copy.toasts.saveFailed,
      applyOptimistic: () => {
        if (!optimisticExpense) {
          resetExpenseComposer({ closeMobile: !wasEditing });
          return;
        }
        const insertion = insertExpense(expensesRef.current, optimisticExpense);
        applyExpenseMutationState(insertion);
        resetExpenseComposer({ closeMobile: !wasEditing });
      },
      execute: () => createExpense(payload),
      reconcile: (createdExpense) => {
        if (!optimisticExpenseId) {
          return;
        }

        const currentExpenses = expensesRef.current;
        const previousAffected = currentExpenses.filter(
          (expense) => expense.id === optimisticExpenseId,
        );
        const nextExpenses = mergeUniqueExpenses([
          { ...createdExpense, isOptimistic: false, optimisticSource: undefined },
          ...currentExpenses.filter((expense) => expense.id !== optimisticExpenseId),
        ]);
        applyExpenseMutationState({
          expenses: nextExpenses,
          previousAffected,
          nextAffected: createdExpense.month === month ? [createdExpense] : [],
        });
      },
    });
  });

  const jumpToExpenseEditor = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        expenseFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        form.setFocus('description');
      });
    });
  }, [form]);

  const startEdit = useCallback(
    (expense: Expense) => {
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
    },
    [form, jumpToExpenseEditor],
  );

  const removeExpense = useCallback((expense: Expense) => {
    setConfirmationDialog({ action: 'delete', expense });
  }, []);

  const cloneExpense = useCallback((expense: Expense) => {
    setConfirmationDialog({ action: 'clone', expense });
  }, []);

  // Stable per-row handlers. Rows are memoized, so allocating a fresh closure per
  // row on every render would make the memo a no-op.
  const handleRowMenuOpenChange = useCallback((expense: Expense, nextOpen: boolean) => {
    setOpenExpenseActionMenuId(nextOpen ? expense.id : null);
  }, []);

  // The desktop menu closes itself before invoking these; the mobile swipe rail
  // does not, so its variants dismiss the open row first.
  const handleRowEdit = startEdit;
  const handleRowClone = cloneExpense;
  const handleRowDelete = removeExpense;

  const handleRowEditAndDismiss = useCallback(
    (expense: Expense) => {
      setOpenExpenseActionMenuId(null);
      startEdit(expense);
    },
    [startEdit],
  );
  const handleRowCloneAndDismiss = useCallback(
    (expense: Expense) => {
      setOpenExpenseActionMenuId(null);
      cloneExpense(expense);
    },
    [cloneExpense],
  );
  const handleRowDeleteAndDismiss = useCallback(
    (expense: Expense) => {
      setOpenExpenseActionMenuId(null);
      removeExpense(expense);
    },
    [removeExpense],
  );

  const confirmCloneExpense = async (expense: Expense) => {
    const today = getTodayDateInputValue();
    const payload: Parameters<typeof createExpense>[0] = {
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
    };
    const optimisticExpense = buildOptimisticCreateExpense(payload, 'clone', expense);
    const optimisticExpenseId = optimisticExpense?.id ?? null;

    await runOptimisticMutation({
      successTitle: copy.toasts.expenseAdded,
      successMessage: copy.toasts.addedSuccessfully,
      errorTitle: copy.toasts.couldNotClone,
      errorFallbackMessage: copy.toasts.cloneFailed,
      applyOptimistic: () => {
        if (!optimisticExpense) {
          return;
        }
        const insertion = insertExpense(expensesRef.current, optimisticExpense);
        applyExpenseMutationState(insertion);
      },
      execute: () => createExpense(payload),
      reconcile: (createdExpense) => {
        if (!optimisticExpenseId) {
          return;
        }
        const currentExpenses = expensesRef.current;
        const previousAffected = currentExpenses.filter(
          (entry) => entry.id === optimisticExpenseId,
        );
        const nextExpenses = mergeUniqueExpenses([
          { ...createdExpense, isOptimistic: false, optimisticSource: undefined },
          ...currentExpenses.filter((entry) => entry.id !== optimisticExpenseId),
        ]);
        applyExpenseMutationState({
          expenses: nextExpenses,
          previousAffected,
          nextAffected: createdExpense.month === month ? [createdExpense] : [],
        });
      },
    });
  };

  const confirmDeleteExpense = async (expense: Expense) => {
    if (expense.installment || expense.fixed.enabled) {
      setScopeDialog({ expense });
      return;
    }

    await runOptimisticMutation({
      successTitle: copy.toasts.expenseDeleted,
      successMessage: copy.toasts.deletedSuccessfully,
      errorTitle: copy.toasts.couldNotDelete,
      errorFallbackMessage: copy.toasts.deleteFailed,
      applyOptimistic: () => {
        const removal = removeExpenseById(expensesRef.current, expense.id);
        applyExpenseMutationState(removal);
      },
      execute: () => deleteExpense(expense.id, 'single'),
      onSuccess: () => {
        if (editingExpenseId === expense.id) {
          setEditingExpenseId(null);
          resetForm(sortedActiveCategories[0]?.id ?? '');
        }
      },
    });
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
    const scopedExpense = scopeDialog.expense;
    const predicate = scopedExpense.installment?.seriesId
      ? (expense: Expense) => expense.installment?.seriesId === scopedExpense.installment?.seriesId
      : scopedExpense.fixed.templateId
        ? (expense: Expense) => expense.fixed.templateId === scopedExpense.fixed.templateId
        : (expense: Expense) => expense.id === scopedExpense.id;

    await runOptimisticMutation({
      successTitle: copy.toasts.expenseDeleted,
      successMessage: copy.toasts.deletedSuccessfully,
      errorTitle: copy.toasts.couldNotDelete,
      errorFallbackMessage: copy.toasts.applyActionFailed,
      applyOptimistic: () => {
        const removal = removeExpenses(expensesRef.current, predicate);
        applyExpenseMutationState(removal);
      },
      execute: () => deleteExpense(scopedExpense.id, scope),
      onSuccess: (_result, mutationToken) => {
        setScopeDialog(null);
        setEditingExpenseId(null);
        resetForm(sortedActiveCategories[0]?.id ?? '');
        void runBackgroundRefresh(
          mutationToken,
          { includeRates: false, includeSettlement: true },
          copy.deletedNoRefresh,
        );
      },
    });
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
        title: copy.sections.fixedTitle,
        subtitle: copy.sections.fixedSubtitle,
        subtotalArs: fixedSubtotalArs,
        allRows: fixedExpenses,
        emptyMessage: copy.sections.fixedEmpty,
      },
      {
        key: 'oneTime',
        title: copy.sections.oneTimeTitle,
        subtitle: copy.sections.oneTimeSubtitle,
        subtotalArs: oneTimeSubtotalArs,
        allRows: oneTimeExpenses,
        emptyMessage: hasActiveFilters
          ? copy.sections.oneTimeEmptyFiltered
          : copy.sections.oneTimeEmpty,
      },
      {
        key: 'installment',
        title: copy.sections.installmentTitle,
        subtitle: copy.sections.installmentSubtitle,
        subtotalArs: installmentSubtotalArs,
        allRows: installmentExpenses,
        emptyMessage: hasActiveFilters
          ? copy.sections.installmentEmptyFiltered
          : copy.sections.installmentEmpty,
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
    copy,
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

  const visibleSectionSummaries = useMemo(
    () =>
      selectedExpenseType === 'all'
        ? sectionSummaries
        : sectionSummaries.filter((section) => section.key === selectedExpenseType),
    [sectionSummaries, selectedExpenseType],
  );
  const visibleExpenseCount = useMemo(
    () => visibleSectionSummaries.reduce((total, section) => total + section.totalRows, 0),
    [visibleSectionSummaries],
  );
  const visibleFilteredSubtotalArs = useMemo(
    () =>
      selectedExpenseType === 'all'
        ? filteredSubtotalArs
        : (visibleSectionSummaries[0]?.subtotalArs ?? 0),
    [filteredSubtotalArs, selectedExpenseType, visibleSectionSummaries],
  );
  const expenseTypeFilters = useMemo<Array<{ key: ExpenseTypeFilter; label: string }>>(
    () => [
      { key: 'all', label: copy.allExpenseTypes },
      { key: 'oneTime', label: copy.kindOneTime },
      { key: 'fixed', label: copy.kindRecurring },
      { key: 'installment', label: copy.sections.installmentTitle },
    ],
    [copy],
  );
  const mobileSortOptions = useMemo(
    () => [
      {
        value: 'date:desc',
        label: `${copy.columns.date}: ${copy.sortDirection.newestFirst}`,
      },
      {
        value: 'date:asc',
        label: `${copy.columns.date}: ${copy.sortDirection.oldestFirst}`,
      },
      {
        value: 'description:asc',
        label: `${copy.columns.description}: ${copy.sortDirection.aToZ}`,
      },
      {
        value: 'description:desc',
        label: `${copy.columns.description}: ${copy.sortDirection.zToA}`,
      },
      {
        value: 'category:asc',
        label: `${copy.columns.category}: ${copy.sortDirection.aToZ}`,
      },
      {
        value: 'category:desc',
        label: `${copy.columns.category}: ${copy.sortDirection.zToA}`,
      },
      {
        value: 'paidBy:asc',
        label: `${copy.columns.paidBy}: ${copy.sortDirection.aToZ}`,
      },
      {
        value: 'paidBy:desc',
        label: `${copy.columns.paidBy}: ${copy.sortDirection.zToA}`,
      },
      {
        value: 'amountArs:desc',
        label: `${copy.columns.amount}: ${copy.sortDirection.highestFirst}`,
      },
      {
        value: 'amountArs:asc',
        label: `${copy.columns.amount}: ${copy.sortDirection.lowestFirst}`,
      },
    ],
    [copy],
  );
  const moreFiltersActive =
    selectedCategoryId !== 'all' || maxRowsPerSection !== DEFAULT_MAX_ROWS_PER_SECTION;
  const mobileMoreFiltersActive =
    moreFiltersActive ||
    selectedExpenseType !== 'all' ||
    sortField !== DEFAULT_SORT_FIELD ||
    sortDirection !== DEFAULT_SORT_DIRECTION;

  const selectExpenseType = useCallback((nextType: ExpenseTypeFilter) => {
    setSelectedExpenseType(nextType);
    if (nextType !== 'all') {
      setSectionOpen((previous) => ({ ...previous, [nextType]: true }));
    }
  }, []);

  useEffect(() => {
    for (const section of sectionSummaries) {
      if (!section.hasMore) {
        continue;
      }

      const rowsRemainingAfterPage = section.totalRows - section.currentPage * maxRowsPerSection;
      const cacheAgeMs = Date.now() - sectionCacheFetchedAtRef.current[section.key];
      const shouldPrefetchByProximity =
        rowsRemainingAfterPage <= maxRowsPerSection * PREFETCH_AHEAD_PAGES;
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
      compact
      month={month}
      title={copy.title}
      subtitle={copy.subtitle}
      locale={locale}
      rightSlot={<MonthSelector month={month} locale={locale} />}
      unframed
    >
      {scopeDialog ? (
        <ScopeDialog
          busy={saving}
          onCancel={() => setScopeDialog(null)}
          onConfirm={(scope) => void confirmScopedAction(scope)}
          locale={locale}
          title={
            scopeDialog.expense.installment
              ? copy.dialogs.deleteInstallmentExpense
              : copy.dialogs.deleteRecurringExpense
          }
        />
      ) : null}
      {confirmationDialog ? (
        <ConfirmationDialog
          busy={saving}
          cancelLabel={shared.cancel}
          confirmLabel={
            confirmationDialog.action === 'clone'
              ? copy.dialogs.cloneExpense
              : copy.dialogs.deleteExpense
          }
          message={
            confirmationDialog.action === 'clone'
              ? copy.dialogs.cloneMessage(confirmationDialog.expense.description)
              : copy.dialogs.deleteMessage(confirmationDialog.expense.description)
          }
          onCancel={() => setConfirmationDialog(null)}
          onConfirm={() => void confirmAction()}
          title={
            confirmationDialog.action === 'clone'
              ? copy.dialogs.confirmClone
              : copy.dialogs.confirmDelete
          }
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
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.2"
                    viewBox="0 0 24 24"
                  >
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold text-slate-900">
                    {editingExpenseId ? copy.form.editExpense : copy.form.addExpense}
                  </p>
                  <p className="text-sm text-slate-500">{formatMonthHeading(month, locale)}</p>
                </div>
              </div>
            </div>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit} ref={expenseFormRef}>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
                <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4">
                  <MobileExpenseComposerFields
                    categories={sortedActiveCategories}
                    copy={copy}
                    editingExpenseId={editingExpenseId}
                    exchangeRates={exchangeRates}
                    form={form}
                    locale={locale}
                    onCancel={closeMobileComposer}
                    shared={shared}
                    users={users}
                  />
                </div>
              </div>
            </form>
          </div>
        </ViewportModal>
      ) : null}
      <div className="space-y-4">
        {warnings.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">{copy.warningsHeading}</p>
            <ul className="mt-2 list-disc pl-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div
            aria-live="assertive"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <section className="rounded-[1.75rem] border border-brand-100 bg-white p-5 shadow-sm md:p-6 lg:hidden">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">
            {copy.thisMonth}
          </p>
          <p className="mt-1 text-base font-semibold text-ink-muted">
            {copy.totalCombinedExpenses}
          </p>
          <p className="mt-3 text-[clamp(2rem,10vw,3.25rem)] font-bold leading-none tracking-[-0.04em] text-ink-strong tabular-nums">
            <span className="mr-2 text-sm font-bold tracking-normal text-ink-soft">ARS</span>
            {formatMoney(totalCombinedExpensesArs, locale)}
          </p>
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="hidden min-w-0 space-y-4 md:block lg:sticky lg:top-0 lg:max-h-[100dvh] lg:overflow-y-auto">
            {!isMobileAddExpenseOpen ? (
              <form
                className="hidden min-w-0 space-y-4 rounded-[1.6rem] border border-stroke bg-white p-5 shadow-sm md:block"
                onSubmit={submit}
                ref={expenseFormRef}
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">
                    {copy.quickAdd}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-strong">
                    {editingExpenseId ? copy.form.editExpense : copy.form.addExpense}
                  </h2>
                </div>
                <div className="space-y-4" id="add-expense-panel">
                  <ExpenseComposerFields
                    categories={sortedActiveCategories}
                    copy={copy}
                    editingExpenseId={editingExpenseId}
                    exchangeRates={exchangeRates}
                    form={form}
                    locale={locale}
                    onCancel={cancelEdit}
                    shared={shared}
                    users={users}
                  />
                </div>
              </form>
            ) : null}
          </aside>

          <div className="min-w-0 space-y-4">
            <section className="hidden rounded-[1.75rem] border border-brand-100 bg-white p-5 shadow-sm md:p-6 lg:block">
              <div className="flex items-end justify-between gap-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-700">
                    {copy.thisMonth}
                  </p>
                  <p className="mt-1 text-base font-semibold text-ink-muted">
                    {copy.totalCombinedExpenses}
                  </p>
                </div>
                <p className="text-[clamp(2rem,5vw,3.25rem)] font-bold leading-none tracking-[-0.04em] text-ink-strong tabular-nums">
                  <span className="mr-2 text-sm font-bold tracking-normal text-ink-soft">ARS</span>
                  {formatMoney(totalCombinedExpensesArs, locale)}
                </p>
              </div>
            </section>
            <section className="min-w-0 space-y-4">
              <div
                className="relative rounded-[1.5rem] border border-stroke bg-white px-3 py-3 shadow-sm md:px-4 md:py-4"
                ref={moreFiltersRef}
              >
                <div className="flex min-w-0 items-center gap-2 md:gap-3">
                  <div className="relative min-w-0 flex-1">
                    <svg
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.4-3.4" />
                    </svg>
                    <input
                      aria-label={copy.searchExpenses}
                      className={`${tableControlSearchFieldClass} min-h-11 pl-10 placeholder:text-xs md:placeholder:text-sm ${hasSearchQuery ? '!bg-white' : '!border-slate-200 !bg-slate-50'}`}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={copy.searchPlaceholderDesktop}
                      type="search"
                      value={searchQuery}
                    />
                    {hasSearchQuery ? (
                      <button
                        aria-label={copy.clearSearch}
                        className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                        onClick={() => setSearchQuery('')}
                        type="button"
                      >
                        <svg
                          aria-hidden="true"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeWidth="2.2"
                          viewBox="0 0 24 24"
                        >
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </button>
                    ) : null}
                  </div>

                  <div className="hidden shrink-0 items-center gap-1 md:flex">
                    {expenseTypeFilters.map((filter) => {
                      const isActive = selectedExpenseType === filter.key;
                      return (
                        <button
                          key={filter.key}
                          aria-pressed={isActive}
                          className={`inline-flex min-h-11 items-center rounded-full px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                            isActive
                              ? 'bg-brand-50 text-brand-700'
                              : 'text-ink-muted hover:bg-slate-50 hover:text-ink-strong'
                          }`}
                          onClick={() => selectExpenseType(filter.key)}
                          type="button"
                        >
                          {filter.label}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    aria-expanded={isMoreFiltersOpen}
                    aria-label={copy.moreFilters}
                    className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:hidden ${
                      isMoreFiltersOpen || mobileMoreFiltersActive
                        ? 'border-brand-200 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-ink-muted hover:bg-brand-50 hover:text-brand-700'
                    }`}
                    onClick={() => setIsMoreFiltersOpen((current) => !current)}
                    title={copy.moreFilters}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M4 7h16" />
                      <path d="M7 12h10" />
                      <path d="M10 17h4" />
                    </svg>
                    {mobileMoreFiltersActive ? (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-600 ring-2 ring-brand-50" />
                    ) : null}
                  </button>

                  <button
                    aria-expanded={isMoreFiltersOpen}
                    aria-label={copy.moreFilters}
                    className={`relative hidden h-11 w-11 shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:inline-flex ${
                      isMoreFiltersOpen || moreFiltersActive
                        ? 'border-brand-200 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-white text-ink-muted hover:bg-brand-50 hover:text-brand-700'
                    }`}
                    onClick={() => setIsMoreFiltersOpen((current) => !current)}
                    title={copy.moreFilters}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M4 7h16" />
                      <path d="M7 12h10" />
                      <path d="M10 17h4" />
                    </svg>
                    {moreFiltersActive ? (
                      <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-brand-600 ring-2 ring-brand-50" />
                    ) : null}
                  </button>
                </div>

                {isMoreFiltersOpen ? (
                  <div className="absolute inset-x-3 top-full z-50 mt-2 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl md:left-auto md:right-4 md:w-80">
                    <p className="text-sm font-bold text-ink-strong">{copy.moreFilters}</p>
                    <fieldset className="md:hidden">
                      <legend className={tableControlLabelClass}>{copy.expenseTypeFilter}</legend>
                      <div className="grid grid-cols-2 gap-2">
                        {expenseTypeFilters.map((filter) => {
                          const isActive = selectedExpenseType === filter.key;
                          return (
                            <button
                              key={filter.key}
                              aria-pressed={isActive}
                              className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
                                isActive
                                  ? 'border-brand-200 bg-brand-50 text-brand-700'
                                  : 'border-slate-200 bg-white text-ink-muted'
                              }`}
                              onClick={() => selectExpenseType(filter.key)}
                              type="button"
                            >
                              {filter.label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                    <label className="block">
                      <span className={tableControlLabelClass}>{copy.columns.category}</span>
                      <select
                        className={tableControlFieldClass}
                        onChange={(event) => {
                          setSelectedCategoryId(event.target.value);
                          resetSectionPages();
                        }}
                        value={selectedCategoryId}
                      >
                        <option value="all">{copy.allCategories}</option>
                        {sortedActiveCategories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block md:hidden">
                      <span className={tableControlLabelClass}>{copy.sortByLabel}</span>
                      <select
                        className={tableControlFieldClass}
                        onChange={(event) => {
                          const [nextField, nextDirection] = event.target.value.split(':') as [
                            ExpenseSortField,
                            SortDirection,
                          ];
                          setSortField(nextField);
                          setSortDirection(nextDirection);
                        }}
                        value={`${sortField}:${sortDirection}`}
                      >
                        {mobileSortOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block" htmlFor="expense-max-rows-per-section">
                      <span className={tableControlLabelClass}>{copy.maxRowsPerSection}</span>
                      <select
                        className={tableControlFieldClass}
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
                    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                      {mobileMoreFiltersActive ? (
                        <button
                          className="inline-flex min-h-11 items-center rounded-xl px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:hidden"
                          onClick={() => {
                            setSelectedExpenseType('all');
                            setSelectedCategoryId('all');
                            setMaxRowsPerSection(DEFAULT_MAX_ROWS_PER_SECTION);
                            setSortField(DEFAULT_SORT_FIELD);
                            setSortDirection(DEFAULT_SORT_DIRECTION);
                            resetSectionPages();
                            invalidateSectionChunkState();
                          }}
                          type="button"
                        >
                          {shared.clear}
                        </button>
                      ) : null}
                      {moreFiltersActive ? (
                        <button
                          className="hidden min-h-11 items-center rounded-xl px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 md:inline-flex"
                          onClick={() => {
                            setSelectedCategoryId('all');
                            setMaxRowsPerSection(DEFAULT_MAX_ROWS_PER_SECTION);
                            resetSectionPages();
                            invalidateSectionChunkState();
                          }}
                          type="button"
                        >
                          {shared.clear}
                        </button>
                      ) : null}
                      {!mobileMoreFiltersActive ? <span className="md:hidden" /> : null}
                      {!moreFiltersActive ? <span className="hidden md:block" /> : null}
                      <button
                        className="inline-flex min-h-11 items-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                        onClick={() => setIsMoreFiltersOpen(false)}
                        type="button"
                      >
                        {shared.done}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="space-y-5 rounded-[1.75rem] border border-stroke bg-white p-4 shadow-sm md:p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">
                      {formatMonthHeading(month, locale)}
                    </p>
                    <h2 className="mt-1 text-xl font-bold text-ink-strong">{copy.ledgerHeading}</h2>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-ink-muted">
                      {copy.showingLoaded(visibleExpenseCount)}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {copy.filteredSubtotal(formatMoney(visibleFilteredSubtotalArs, locale))}
                    </p>
                  </div>
                </div>
                {visibleSectionSummaries.map((section) => (
                  <section
                    key={section.key}
                    aria-busy={sectionLoading[section.key]}
                    className="rounded-[1.35rem] border border-slate-200/80"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-[1.35rem] border-b border-slate-200 bg-surface-muted px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                            section.key === 'fixed'
                              ? 'bg-blue-100 text-blue-700'
                              : section.key === 'oneTime'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-violet-100 text-violet-700'
                          }`}
                        >
                          {section.key === 'fixed' ? (
                            <svg
                              className="h-5 w-5"
                              fill="none"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2.2"
                              viewBox="0 0 24 24"
                            >
                              <path d="M3 12a9 9 0 0 1 15.1-6.36" />
                              <path d="M3 4v6h6" />
                              <path d="M21 12a9 9 0 0 1-15.1 6.36" />
                              <path d="M21 20v-6h-6" />
                            </svg>
                          ) : section.key === 'oneTime' ? (
                            <svg
                              className="h-5 w-5"
                              fill="none"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2.1"
                              viewBox="0 0 24 24"
                            >
                              <rect height="14" rx="2.5" width="14" x="5" y="7" />
                              <path d="M9 7V5a3 3 0 0 1 6 0v2" />
                              <path d="M12 11v4" />
                            </svg>
                          ) : (
                            <svg
                              className="h-5 w-5"
                              fill="none"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="2.1"
                              viewBox="0 0 24 24"
                            >
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
                      <div className="flex items-center gap-3">
                        <p className="text-xs font-semibold text-ink-muted">
                          {copy.subtotal}:{' '}
                          <span className="text-base text-ink-strong tabular-nums">
                            ARS {formatMoney(section.subtotalArs, locale)}
                          </span>
                        </p>
                        <button
                          aria-controls={`${section.key}-expenses-panel`}
                          aria-expanded={sectionOpen[section.key]}
                          aria-label={
                            sectionOpen[section.key]
                              ? copy.collapseSection(section.title)
                              : copy.expandSection(section.title)
                          }
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                          onClick={() =>
                            setSectionOpen((previous) => ({
                              ...previous,
                              [section.key]: !previous[section.key],
                            }))
                          }
                          type="button"
                        >
                          <svg
                            aria-hidden="true"
                            className={`h-4 w-4 transition-transform ${sectionOpen[section.key] ? 'rotate-180' : 'rotate-0'}`}
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
                    </div>
                    <div
                      className={sectionOpen[section.key] ? 'block' : 'hidden'}
                      id={`${section.key}-expenses-panel`}
                    >
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
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-90"
                                  d="M22 12a10 10 0 0 0-10-10"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeWidth="4"
                                />
                              </svg>
                              {shared.loading}
                            </div>
                          </div>
                        ) : null}
                        <div
                          className={`space-y-3 p-3 md:hidden ${sectionLoading[section.key] ? 'opacity-60' : 'opacity-100'}`}
                        >
                          {section.rows.map((expense) => (
                            <MobileExpenseCard
                              key={expense.id}
                              expense={expense}
                              formatFxRate={formatFxRate}
                              locale={locale}
                              isOpen={openExpenseActionMenuId === expense.id}
                              onClone={handleRowCloneAndDismiss}
                              onDelete={handleRowDeleteAndDismiss}
                              onEdit={handleRowEditAndDismiss}
                              onOpenChange={handleRowMenuOpenChange}
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
                              <col className="w-[25%]" />
                              <col className="w-[16%]" />
                              <col className="w-[15%]" />
                              <col className="w-[20%]" />
                              <col className="w-[10%]" />
                            </colgroup>
                            <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-[0.12em] text-ink-soft">
                              <tr>
                                {sortableColumns.map((column) => {
                                  const isActive = sortField === column.field;
                                  const ariaSort = getAriaSortValue(
                                    sortField,
                                    sortDirection,
                                    column.field,
                                  );
                                  return (
                                    <th
                                      key={column.field}
                                      aria-sort={ariaSort}
                                      className={`px-4 py-3 font-bold ${column.field === 'date' || column.field === 'paidBy' ? 'whitespace-nowrap' : ''} ${column.field === 'amountArs' ? 'text-right' : ''}`}
                                      scope="col"
                                    >
                                      <button
                                        aria-label={copy.sortBy(column.label)}
                                        className={`inline-flex items-center gap-1.5 rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${column.field === 'amountArs' ? 'ml-auto' : ''} ${
                                          isActive
                                            ? 'text-slate-900'
                                            : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                        onClick={() => handleSortChange(column.field)}
                                        type="button"
                                      >
                                        <span>
                                          {column.label.toLocaleUpperCase(localeTags[locale])}
                                        </span>
                                        {isActive ? (
                                          <svg
                                            aria-hidden="true"
                                            className="h-3.5 w-3.5"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth="2.2"
                                            viewBox="0 0 24 24"
                                          >
                                            {sortDirection === 'asc' ? (
                                              <path d="m6 14 6-6 6 6" />
                                            ) : (
                                              <path d="m6 10 6 6 6-6" />
                                            )}
                                          </svg>
                                        ) : null}
                                      </button>
                                    </th>
                                  );
                                })}
                                <th
                                  className="whitespace-nowrap px-4 py-3 text-right font-medium"
                                  scope="col"
                                >
                                  <span className="sr-only">{shared.actions}</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {section.rows.map((expense) => (
                                <DesktopExpenseRow
                                  key={expense.id}
                                  copy={copy}
                                  expense={expense}
                                  formatFxRate={formatFxRate}
                                  isOpen={openExpenseActionMenuId === expense.id}
                                  locale={locale}
                                  onClone={handleRowClone}
                                  onDelete={handleRowDelete}
                                  onEdit={handleRowEdit}
                                  onOpenChange={handleRowMenuOpenChange}
                                />
                              ))}
                              {section.rows.length === 0 ? (
                                <tr>
                                  <td
                                    className="px-4 py-6 text-center text-sm text-slate-500"
                                    colSpan={6}
                                  >
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
                            {copy.pageRange(
                              section.pageStart,
                              section.pageEnd,
                              section.totalRows,
                              section.hasMore,
                            )}
                          </p>
                          <div className="flex items-center gap-3">
                            <button
                              aria-label={copy.previousPage(section.title)}
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
                              <svg
                                aria-hidden="true"
                                className="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2.5"
                                viewBox="0 0 24 24"
                              >
                                <path d="m15 18-6-6 6-6" />
                              </svg>
                            </button>
                            <button
                              aria-label={copy.nextPage(section.title)}
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
                              <svg
                                aria-hidden="true"
                                className="h-5 w-5"
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2.5"
                                viewBox="0 0 24 24"
                              >
                                <path d="m9 18 6-6-6-6" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
      {!isMobileAddExpenseOpen && !isMoreFiltersOpen ? (
        <button
          aria-label={copy.form.addExpense}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+6.75rem)] right-5 z-30 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.35)] transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:translate-y-0.5 md:hidden"
          onClick={openMobileComposer}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      ) : null}
      {submissionToast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
          <div
            aria-live={submissionToast.kind === 'error' ? 'assertive' : 'polite'}
            className={`pointer-events-auto relative flex w-full max-w-md items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-sm font-semibold shadow-xl ${
              submissionToast.kind === 'success'
                ? 'border-emerald-200 bg-white text-emerald-800'
                : 'border-rose-200 bg-white text-rose-800'
            }`}
            role={submissionToast.kind === 'error' ? 'alert' : 'status'}
          >
            {submissionToast.kind === 'success' ? (
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
            <span className="truncate">{submissionToast.message ?? submissionToast.title}</span>
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/5">
              <span
                className={`submission-toast-progress block h-full ${
                  submissionToast.kind === 'success' ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
                style={
                  { '--toast-duration': `${SUBMISSION_TOAST_VISIBLE_MS}ms` } as Record<
                    string,
                    string
                  >
                }
              />
            </span>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
