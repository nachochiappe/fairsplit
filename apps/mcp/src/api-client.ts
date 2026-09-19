export interface HouseholdUser {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  archivedAt: string | null;
  superCategoryName: string | null;
}

export interface Income {
  id: string;
  month: string;
  userId: string;
  userName?: string;
  description: string;
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
  amountOriginal: string;
  amountArs: string;
  currencyCode: string;
  fxRateUsed: string;
  paidByUserId: string;
  paidByUserName: string;
  fixed: { enabled: boolean; templateId: string | null };
  installment: Record<string, unknown> | null;
}

export interface ExpenseListResponse {
  expenses: Expense[];
  warnings: string[];
}

export class FairsplitApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: unknown,
  ) {
    super(message);
    this.name = 'FairsplitApiError';
  }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
  }
  return fallback;
}

export class FairsplitApiClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      throw new FairsplitApiError(
        `Could not reach the Fairsplit API at ${this.baseUrl}.`,
        502,
        error instanceof Error ? error.message : error,
      );
    }

    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw new FairsplitApiError(
        errorMessage(payload, `Fairsplit API request failed with status ${response.status}.`),
        response.status,
        payload,
      );
    }
    return payload as T;
  }

  listUsers(): Promise<HouseholdUser[]> {
    return this.request('/users');
  }

  listCategories(): Promise<Category[]> {
    return this.request('/categories');
  }

  listIncomes(month: string): Promise<Income[]> {
    return this.request(`/incomes?month=${encodeURIComponent(month)}`);
  }

  listExpenses(month: string): Promise<ExpenseListResponse> {
    return this.request(`/expenses?month=${encodeURIComponent(month)}`);
  }

  createIncome(input: Record<string, unknown>): Promise<Income> {
    return this.request('/incomes', { method: 'POST', body: JSON.stringify(input) });
  }

  updateIncome(id: string, input: Record<string, unknown>): Promise<Income> {
    return this.request(`/incomes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  deleteIncome(id: string): Promise<void> {
    return this.request(`/incomes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  createExpense(input: Record<string, unknown>): Promise<Expense> {
    return this.request('/expenses', { method: 'POST', body: JSON.stringify(input) });
  }

  updateExpense(id: string, input: Record<string, unknown>): Promise<Expense> {
    return this.request(`/expenses/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  deleteExpense(id: string, applyScope?: 'single' | 'future' | 'all'): Promise<void> {
    return this.request(`/expenses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify(applyScope ? { applyScope } : {}),
    });
  }
}

export function resolveNamedEntity<T extends { id: string; name: string }>(
  candidates: T[],
  reference: string,
  kind: string,
): T {
  const byId = candidates.find((candidate) => candidate.id === reference);
  if (byId) {
    return byId;
  }

  const normalized = reference.trim().toLocaleLowerCase();
  const byName = candidates.filter(
    (candidate) => candidate.name.trim().toLocaleLowerCase() === normalized,
  );
  if (byName.length === 1) {
    return byName[0];
  }
  if (byName.length > 1) {
    throw new Error(`More than one ${kind} is named "${reference}". Use its id instead.`);
  }
  throw new Error(
    `No ${kind} matched "${reference}". Call get_household_context to see valid values.`,
  );
}
