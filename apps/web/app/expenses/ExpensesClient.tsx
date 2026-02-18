'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { computeInstallmentAmounts } from '@fairsplit/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AppShell } from '../../components/AppShell';
import { MonthSelector } from '../../components/MonthSelector';
import { formatMoney } from '../../lib/currency';
import {
  Category,
  createExpense,
  deleteExpense,
  ExchangeRate,
  Expense,
  getExchangeRates,
  getExpenses,
  updateExpense,
  upsertExchangeRate,
  User,
} from '../../lib/api';

type ApplyScope = 'single' | 'future' | 'all';
type ScopeAction = 'update' | 'delete';
type ExpenseTypeFilter = 'all' | 'oneTime' | 'fixed' | 'installment';
type ExpenseSortField = 'date' | 'description' | 'category' | 'amountArs' | 'paidBy';
type SortDirection = 'asc' | 'desc';
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
const smallButtonClass =
  'rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

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

interface ExpensesClientProps {
  month: string;
  initialUsers: User[];
  initialExpenses: Expense[];
  initialWarnings: string[];
  initialCategories: Category[];
  initialExchangeRates: ExchangeRate[];
}

export function ExpensesClient({
  month,
  initialUsers,
  initialExpenses,
  initialWarnings,
  initialCategories,
  initialExchangeRates,
}: ExpensesClientProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [warnings, setWarnings] = useState<string[]>(initialWarnings);
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>(initialExchangeRates);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [scopeDialog, setScopeDialog] = useState<ScopeDialogState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFxCurrency, setNewFxCurrency] = useState<SupportedCurrencyCode>('USD');
  const [newFxRate, setNewFxRate] = useState('');
  const [pageSize, setPageSize] = useState<10 | 25 | 50>(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [selectedPaidByUserId, setSelectedPaidByUserId] = useState<string>('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<ExpenseTypeFilter>('all');
  const [sortField, setSortField] = useState<ExpenseSortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const fxCurrencies = useMemo(() => supportedCurrencyCodes.filter((code) => code !== 'ARS'), []);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.archivedAt === null),
    [categories],
  );
  const hasActiveFilters = useMemo(
    () =>
      Boolean(searchQuery.trim()) ||
      selectedCategoryId !== 'all' ||
      selectedPaidByUserId !== 'all' ||
      selectedTypeFilter !== 'all',
    [searchQuery, selectedCategoryId, selectedPaidByUserId, selectedTypeFilter],
  );
  const totalPages = useMemo(() => Math.max(1, Math.ceil(expenses.length / pageSize)), [expenses.length, pageSize]);
  const paginatedExpenses = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return expenses.slice(start, start + pageSize);
  }, [currentPage, expenses, pageSize]);
  const pageStart = expenses.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(currentPage * pageSize, expenses.length);
  const filteredSubtotalArs = useMemo(
    () => expenses.reduce((sum, expense) => sum + Number(expense.amountArs), 0),
    [expenses],
  );

  const form = useForm<ExpenseForm>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: `${month}-01`,
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
        date: `${month}-01`,
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
    [form, month],
  );

  const loadMonthData = useCallback(async () => {
    const [expenseData, rates] = await Promise.all([
      getExpenses(month, {
        search: searchQuery || undefined,
        categoryId: selectedCategoryId === 'all' ? undefined : selectedCategoryId,
        paidByUserId: selectedPaidByUserId === 'all' ? undefined : selectedPaidByUserId,
        type: selectedTypeFilter === 'all' ? undefined : selectedTypeFilter,
        sortBy: sortField,
        sortDir: sortDirection,
      }),
      getExchangeRates(month),
    ]);
    setExpenses(expenseData.expenses);
    setWarnings(expenseData.warnings);
    setExchangeRates(rates);
  }, [month, searchQuery, selectedCategoryId, selectedPaidByUserId, selectedTypeFilter, sortField, sortDirection]);

  useEffect(() => {
    setUsers(initialUsers);
    setExpenses(initialExpenses);
    setWarnings(initialWarnings);
    setCategories(initialCategories);
    setExchangeRates(initialExchangeRates);
    setError(null);
    setCurrentPage(1);
    resetForm(initialUsers[0]?.id ?? '', initialCategories.find((c) => c.archivedAt === null)?.id ?? '');
  }, [initialCategories, initialExchangeRates, initialExpenses, initialUsers, initialWarnings, resetForm]);

  useEffect(() => {
    setCurrentPage((previousPage) => Math.min(previousPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategoryId, selectedPaidByUserId, selectedTypeFilter, sortField, sortDirection]);

  useEffect(() => {
    void loadMonthData().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load expenses');
    });
  }, [loadMonthData]);

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
      resetForm(users[0]?.id ?? '', activeCategories[0]?.id ?? '');
      await loadMonthData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  });

  const startEdit = (expense: Expense) => {
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
    try {
      if (!expense.installment && !window.confirm(`Delete \"${expense.description}\"?`)) {
        return;
      }

      setSaving(true);
      setError(null);

      if (expense.installment) {
        setScopeDialog({ action: 'delete', expense });
        return;
      }

      await deleteExpense(expense.id, 'single');
      await loadMonthData();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Failed to delete expense');
    } finally {
      setSaving(false);
    }
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
      resetForm(users[0]?.id ?? '', activeCategories[0]?.id ?? '');
      await loadMonthData();
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
      await loadMonthData();
    } catch (fxError) {
      setError(fxError instanceof Error ? fxError.message : 'Failed to save FX rate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      month={month}
      title="Monthly Expenses"
      subtitle="Track each expense, category, currency and fixed templates"
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

      <div className="space-y-4">
        {warnings.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Fixed expense generation warnings</p>
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

        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <form className={`${cardClass} space-y-3`} onSubmit={submit}>
            <h2 className="text-base font-semibold text-slate-900">{editingExpenseId ? 'Edit expense' : 'Add expense'}</h2>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Date</span>
              <input className={fieldClass} type="date" {...form.register('date')} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Description</span>
              <input className={fieldClass} {...form.register('description')} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">Category</span>
              <select className={fieldClass} {...form.register('categoryId')}>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
              Fixed expense template
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
                    resetForm(users[0]?.id ?? '', activeCategories[0]?.id ?? '');
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <div className="space-y-4">
            <section className={cardClass}>
              <h3 className="text-sm font-semibold text-slate-900">Month-start FX defaults (to ARS)</h3>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_auto]">
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
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Showing {pageStart}-{pageEnd} of {expenses.length}
                    </p>
                    <p className="text-xs text-slate-500">Filtered results for this month</p>
                    <p className="text-xs font-medium text-slate-600">Subtotal (filtered): ARS {formatMoney(filteredSubtotalArs)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-slate-700" htmlFor="expense-page-size">
                      <span className="font-medium">Rows</span>
                      <select
                        className={`${compactFieldClass} min-w-20 rounded-lg px-3 py-2`}
                        id="expense-page-size"
                        onChange={(event) => {
                          setPageSize(Number(event.target.value) as 10 | 25 | 50);
                          setCurrentPage(1);
                        }}
                        value={pageSize}
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                    </label>
                    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                      <button
                        className={smallButtonClass}
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                        type="button"
                      >
                        Prev
                      </button>
                      <span className="min-w-20 text-center text-sm font-medium text-slate-700">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        className={smallButtonClass}
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                        type="button"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-4">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-12">
                  <label className="lg:col-span-5">
                    <span className={tableControlLabelClass}>Search</span>
                    <input
                      className={tableControlFieldClass}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Description, category, or payer"
                      type="search"
                      value={searchQuery}
                    />
                  </label>
                  <label className="lg:col-span-2">
                    <span className={tableControlLabelClass}>Category</span>
                    <select
                      className={tableControlFieldClass}
                      onChange={(event) => setSelectedCategoryId(event.target.value)}
                      value={selectedCategoryId}
                    >
                      <option value="all">All categories</option>
                      {activeCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="lg:col-span-2">
                    <span className={tableControlLabelClass}>Payer</span>
                    <select
                      className={tableControlFieldClass}
                      onChange={(event) => setSelectedPaidByUserId(event.target.value)}
                      value={selectedPaidByUserId}
                    >
                      <option value="all">All payers</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="lg:col-span-3">
                    <span className={tableControlLabelClass}>Type</span>
                    <select
                      className={tableControlFieldClass}
                      onChange={(event) => setSelectedTypeFilter(event.target.value as ExpenseTypeFilter)}
                      value={selectedTypeFilter}
                    >
                      <option value="all">All types</option>
                      <option value="oneTime">One-time</option>
                      <option value="fixed">Fixed</option>
                      <option value="installment">Installment</option>
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
                      {hasActiveFilters ? (
                        <button
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedCategoryId('all');
                            setSelectedPaidByUserId('all');
                            setSelectedTypeFilter('all');
                            setSortField('date');
                            setSortDirection('desc');
                            setCurrentPage(1);
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
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <caption className="sr-only">Monthly expense entries</caption>
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-medium" scope="col">
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
                    <th className="px-4 py-3 font-medium" scope="col">
                      Paid by
                    </th>
                    <th className="px-4 py-3 font-medium" scope="col">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedExpenses.map((expense) => (
                    <tr key={expense.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">{expense.date}</td>
                      <td className="px-4 py-3">
                        {expense.description}
                        <div className="text-xs text-slate-500">
                          {expense.fixed.enabled ? 'Fixed' : 'One-time'}
                          {expense.installment ? ` • Installment ${expense.installment.number}/${expense.installment.total}` : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">{expense.categoryName}</td>
                      <td className="px-4 py-3 tabular-nums">
                        <div>ARS {formatMoney(expense.amountArs)}</div>
                        {expense.currencyCode !== 'ARS' ? (
                          <div className="text-xs text-slate-500">
                            {expense.currencyCode} {formatMoney(expense.amountOriginal)} @{' '}
                            {formatFxRate(expense.fxRateUsed)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{expense.paidByUserName}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button className={smallButtonClass} onClick={() => startEdit(expense)} type="button">
                            Edit
                          </button>
                          <button className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2" onClick={() => void removeExpense(expense)} type="button">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {expenses.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={6}>
                        {hasActiveFilters ? 'No expenses match the current filters' : 'No expenses yet for this month'}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
