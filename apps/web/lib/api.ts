export interface User {
  id: string;
  name: string;
  createdAt: string;
}

export interface Income {
  id: string;
  month: string;
  userId: string;
  userName: string;
  description: string;
  amount: string;
  amountOriginal: string;
  amountArs: string;
  currencyCode: string;
  fxRateUsed: string;
}

export interface Expense {
  id: string;
  month: string;
  date: string;
  description: string;
  categoryId: string;
  categoryName: string;
  superCategoryId: string | null;
  superCategoryName: string | null;
  superCategoryColor: string | null;
  amountOriginal: string;
  amountArs: string;
  currencyCode: string;
  fxRateUsed: string;
  paidByUserId: string;
  paidByUserName: string;
  fixed: {
    enabled: boolean;
    templateId: string | null;
  };
  installment: null | {
    seriesId: string;
    number: number;
    total: number;
    isGenerated: boolean;
    source?: string;
  };
}

export interface ExpenseListResponse {
  month: string;
  warnings: string[];
  expenses: Expense[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
    totalCount: number;
  } | null;
}
export interface ExpenseListQuery {
  search?: string;
  categoryId?: string;
  paidByUserId?: string;
  type?: 'oneTime' | 'fixed' | 'installment';
  sortBy?: 'date' | 'description' | 'category' | 'amountArs' | 'paidBy';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
}

export interface Category {
  id: string;
  name: string;
  archivedAt: string | null;
  expenseCount: number;
  fixedExpenseCount: number;
  superCategoryId: string | null;
  superCategoryName: string | null;
  superCategoryColor: string | null;
}

export interface SuperCategory {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string | null;
  sortOrder: number;
  isSystem: boolean;
  archivedAt: string | null;
  categoryCount: number;
}

export interface ExchangeRate {
  id: string;
  month: string;
  currencyCode: string;
  rateToArs: string;
}

export interface SettlementResponse {
  month: string;
  totalIncome: string;
  totalExpenses: string;
  expenseRatio: string;
  fairShareByUser: Record<string, string>;
  paidByUser: Record<string, string>;
  differenceByUser: Record<string, string>;
  transfer: null | { fromUserId: string; toUserId: string; amount: string };
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';
type NextRequestInit = RequestInit & { next?: { revalidate?: number; tags?: string[] } };

async function fetchFromApi(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown network error';
    throw new Error(`Unable to reach API at ${API_BASE_URL}. ${message}`);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(payload.error ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

export async function getUsers(init?: NextRequestInit): Promise<User[]> {
  const response = await fetchFromApi(`${API_BASE_URL}/users`, init ?? { cache: 'no-store' });
  return parseResponse<User[]>(response);
}

export async function getMonths(init?: NextRequestInit): Promise<string[]> {
  const response = await fetchFromApi(`${API_BASE_URL}/months`, init ?? { cache: 'no-store' });
  return parseResponse<string[]>(response);
}

export async function getIncomes(month: string, init?: NextRequestInit): Promise<Income[]> {
  const response = await fetchFromApi(
    `${API_BASE_URL}/incomes?month=${encodeURIComponent(month)}`,
    init ?? { cache: 'no-store' },
  );
  return parseResponse<Income[]>(response);
}

export async function replaceIncomesForUser(payload: {
  month: string;
  userId: string;
  entries: Array<{
    description: string;
    amount: number;
    currencyCode?: string;
    fxRate?: number;
  }>;
}): Promise<Income[]> {
  const response = await fetchFromApi(`${API_BASE_URL}/incomes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<Income[]>(response);
}

export async function getExpenses(
  month: string,
  query?: ExpenseListQuery,
  init?: NextRequestInit,
): Promise<ExpenseListResponse> {
  const params = new URLSearchParams({ month });
  if (query?.search?.trim()) {
    params.set('search', query.search.trim());
  }
  if (query?.categoryId) {
    params.set('categoryId', query.categoryId);
  }
  if (query?.paidByUserId) {
    params.set('paidByUserId', query.paidByUserId);
  }
  if (query?.type) {
    params.set('type', query.type);
  }
  if (query?.sortBy) {
    params.set('sortBy', query.sortBy);
  }
  if (query?.sortDir) {
    params.set('sortDir', query.sortDir);
  }
  if (query?.limit) {
    params.set('limit', String(query.limit));
  }
  if (query?.cursor) {
    params.set('cursor', query.cursor);
  }
  const response = await fetchFromApi(`${API_BASE_URL}/expenses?${params.toString()}`, init ?? { cache: 'no-store' });
  return parseResponse<ExpenseListResponse>(response);
}

export async function createExpense(payload: {
  month: string;
  date: string;
  description: string;
  categoryId: string;
  amount?: number;
  currencyCode?: string;
  fxRate?: number;
  paidByUserId: string;
  fixed?: {
    enabled: boolean;
  };
  installment?: {
    enabled: boolean;
    count?: number;
    entryMode?: 'perInstallment' | 'total';
    perInstallmentAmount?: number;
    totalAmount?: number;
  };
}): Promise<Expense> {
  const response = await fetchFromApi(`${API_BASE_URL}/expenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<Expense>(response);
}

export async function updateExpense(
  id: string,
  payload: Partial<{
    month: string;
    date: string;
    description: string;
    categoryId: string;
    amount: number;
    currencyCode: string;
    fxRate: number;
    paidByUserId: string;
    fixed: {
      enabled: boolean;
    };
    installment: {
      enabled: boolean;
      count?: number;
      entryMode?: 'perInstallment' | 'total';
      perInstallmentAmount?: number;
      totalAmount?: number;
    };
    applyScope: 'single' | 'future' | 'all';
    applyToFuture: boolean;
  }>,
): Promise<Expense> {
  const response = await fetchFromApi(`${API_BASE_URL}/expenses/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<Expense>(response);
}

export async function deleteExpense(id: string, applyScope?: 'single' | 'future' | 'all'): Promise<void> {
  const response = await fetchFromApi(`${API_BASE_URL}/expenses/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(applyScope ? { applyScope } : {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Delete failed' }));
    throw new Error(payload.error ?? 'Delete failed');
  }
}

export async function getCategories(init?: NextRequestInit): Promise<Category[]> {
  const response = await fetchFromApi(`${API_BASE_URL}/categories`, init ?? { cache: 'no-store' });
  return parseResponse<Category[]>(response);
}

export async function createCategory(payload: { name: string; superCategoryId?: string | null }): Promise<Category> {
  const response = await fetchFromApi(`${API_BASE_URL}/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<Category>(response);
}

export async function renameCategory(id: string, payload: { name: string }): Promise<Category> {
  const response = await fetchFromApi(`${API_BASE_URL}/categories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<Category>(response);
}

export async function archiveCategory(id: string, payload: { replacementCategoryId: string }): Promise<void> {
  const response = await fetchFromApi(`${API_BASE_URL}/categories/${id}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ error: 'Archive failed' }));
    throw new Error(errorPayload.error ?? 'Archive failed');
  }
}

export async function assignCategorySuperCategory(
  categoryId: string,
  payload: { superCategoryId: string | null },
): Promise<Category> {
  const response = await fetchFromApi(`${API_BASE_URL}/categories/${categoryId}/super-category`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<Category>(response);
}

export async function getSuperCategories(init?: NextRequestInit): Promise<SuperCategory[]> {
  const response = await fetchFromApi(`${API_BASE_URL}/super-categories`, init ?? { cache: 'no-store' });
  return parseResponse<SuperCategory[]>(response);
}

export async function createSuperCategory(payload: {
  name: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
}): Promise<SuperCategory> {
  const response = await fetchFromApi(`${API_BASE_URL}/super-categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<SuperCategory>(response);
}

export async function updateSuperCategory(
  id: string,
  payload: Partial<{ name: string; color: string; icon: string; sortOrder: number }>,
): Promise<SuperCategory> {
  const response = await fetchFromApi(`${API_BASE_URL}/super-categories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<SuperCategory>(response);
}

export async function archiveSuperCategory(
  id: string,
  payload?: { replacementSuperCategoryId?: string },
): Promise<void> {
  const response = await fetchFromApi(`${API_BASE_URL}/super-categories/${id}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({ error: 'Archive failed' }));
    throw new Error(errorPayload.error ?? 'Archive failed');
  }
}

export async function getExchangeRates(month: string, init?: NextRequestInit): Promise<ExchangeRate[]> {
  const response = await fetchFromApi(
    `${API_BASE_URL}/exchange-rates?month=${encodeURIComponent(month)}`,
    init ?? { cache: 'no-store' },
  );
  return parseResponse<ExchangeRate[]>(response);
}

export async function upsertExchangeRate(payload: {
  month: string;
  currencyCode: string;
  rateToArs: number;
}): Promise<ExchangeRate> {
  const response = await fetchFromApi(`${API_BASE_URL}/exchange-rates`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseResponse<ExchangeRate>(response);
}

export async function getSettlement(month: string, init?: NextRequestInit): Promise<SettlementResponse> {
  const response = await fetchFromApi(
    `${API_BASE_URL}/settlement?month=${encodeURIComponent(month)}`,
    init ?? { cache: 'no-store' },
  );
  return parseResponse<SettlementResponse>(response);
}
