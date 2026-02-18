'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import {
  archiveCategory,
  archiveSuperCategory,
  assignCategorySuperCategory,
  Category,
  createCategory,
  createSuperCategory,
  getCategories,
  getSuperCategories,
  renameCategory,
  SuperCategory,
  updateSuperCategory,
} from '../../lib/api';

interface SettingsClientProps {
  month: string;
  initialCategories: Category[];
  initialSuperCategories: SuperCategory[];
}

export function SettingsClient({ month, initialCategories, initialSuperCategories }: SettingsClientProps) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [superCategories, setSuperCategories] = useState<SuperCategory[]>(initialSuperCategories);
  const [categoryName, setCategoryName] = useState('');
  const [categorySuperCategoryId, setCategorySuperCategoryId] = useState<string>('unassigned');
  const [superCategoryName, setSuperCategoryName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.archivedAt === null),
    [categories],
  );

  const activeSuperCategories = useMemo(
    () => superCategories.filter((superCategory) => superCategory.archivedAt === null),
    [superCategories],
  );

  const sortedActiveSuperCategories = useMemo(
    () => [...activeSuperCategories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [activeSuperCategories],
  );

  const unassignedCategoryCount = useMemo(
    () => activeCategories.filter((category) => category.superCategoryId === null).length,
    [activeCategories],
  );

  const loadSettings = async () => {
    const [nextCategories, nextSuperCategories] = await Promise.all([getCategories(), getSuperCategories()]);
    setCategories(nextCategories);
    setSuperCategories(nextSuperCategories);
  };

  const onCreateCategory = async () => {
    if (!categoryName.trim()) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await createCategory({
        name: categoryName.trim(),
        superCategoryId: categorySuperCategoryId === 'unassigned' ? null : categorySuperCategoryId,
      });
      setCategoryName('');
      setCategorySuperCategoryId('unassigned');
      await loadSettings();
    } catch (categoryError) {
      setError(categoryError instanceof Error ? categoryError.message : 'Failed to create category');
    } finally {
      setSaving(false);
    }
  };

  const onRenameCategory = async (category: Category) => {
    const nextName = window.prompt(`Rename category "${category.name}"`, category.name)?.trim();
    if (!nextName || nextName === category.name) {
      return;
    }

    if (!window.confirm('Renaming will affect all historical records. Continue?')) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await renameCategory(category.id, { name: nextName });
      await loadSettings();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Failed to rename category');
    } finally {
      setSaving(false);
    }
  };

  const onAssignCategory = async (category: Category, nextSuperCategoryId: string) => {
    try {
      setSaving(true);
      setError(null);
      await assignCategorySuperCategory(category.id, {
        superCategoryId: nextSuperCategoryId === 'unassigned' ? null : nextSuperCategoryId,
      });
      await loadSettings();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Failed to assign category');
    } finally {
      setSaving(false);
    }
  };

  const onArchiveCategory = async (category: Category) => {
    if (category.archivedAt) {
      return;
    }

    const replacements = activeCategories.filter((entry) => entry.id !== category.id);
    if (replacements.length === 0) {
      setError('At least one active replacement category is required before archiving.');
      return;
    }

    const replacementName = window
      .prompt(
        `Type replacement category name before archiving: ${replacements.map((c) => c.name).join(', ')}`,
      )
      ?.trim();

    if (!replacementName) {
      return;
    }

    const replacement = replacements.find((entry) => entry.name.toLowerCase() === replacementName.toLowerCase());
    if (!replacement) {
      setError('Replacement category not found.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await archiveCategory(category.id, { replacementCategoryId: replacement.id });
      await loadSettings();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Failed to archive category');
    } finally {
      setSaving(false);
    }
  };

  const onCreateSuperCategory = async () => {
    if (!superCategoryName.trim()) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const nextSortOrder =
        sortedActiveSuperCategories.length > 0
          ? Math.max(...sortedActiveSuperCategories.map((entry) => entry.sortOrder)) + 10
          : 10;
      await createSuperCategory({
        name: superCategoryName.trim(),
        sortOrder: nextSortOrder,
      });
      setSuperCategoryName('');
      await loadSettings();
    } catch (superCategoryError) {
      setError(superCategoryError instanceof Error ? superCategoryError.message : 'Failed to create super category');
    } finally {
      setSaving(false);
    }
  };

  const onRenameSuperCategory = async (superCategory: SuperCategory) => {
    const nextName = window.prompt(`Rename group "${superCategory.name}"`, superCategory.name)?.trim();
    if (!nextName || nextName === superCategory.name) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await updateSuperCategory(superCategory.id, { name: nextName });
      await loadSettings();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Failed to rename super category');
    } finally {
      setSaving(false);
    }
  };

  const onArchiveSuperCategory = async (superCategory: SuperCategory) => {
    if (superCategory.archivedAt || superCategory.isSystem) {
      return;
    }

    const replacements = sortedActiveSuperCategories.filter((entry) => entry.id !== superCategory.id);
    const replacementName = window
      .prompt(
        `Optional: type replacement group name. Leave empty to move categories to Unassigned. Available: ${replacements
          .map((entry) => entry.name)
          .join(', ')}`,
      )
      ?.trim();

    const replacement = replacementName
      ? replacements.find((entry) => entry.name.toLowerCase() === replacementName.toLowerCase())
      : undefined;

    if (replacementName && !replacement) {
      setError('Replacement super category not found.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await archiveSuperCategory(superCategory.id, {
        replacementSuperCategoryId: replacement?.id,
      });
      await loadSettings();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Failed to archive super category');
    } finally {
      setSaving(false);
    }
  };

  const renderSuperCategoryIcon = (name: string) => {
    const normalizedName = name.toLowerCase();
    const iconClassName = 'h-5 w-5 text-slate-400';

    if (normalizedName.includes('hous') || normalizedName.includes('rent') || normalizedName.includes('home')) {
      return (
        <svg aria-hidden="true" className={iconClassName} fill="currentColor" viewBox="0 0 20 20">
          <path d="M10.75 2.9a1.2 1.2 0 0 0-1.5 0l-6 5A1.2 1.2 0 0 0 4 10h1v5.25A1.75 1.75 0 0 0 6.75 17h1.5A1.75 1.75 0 0 0 10 15.25V13h0v2.25A1.75 1.75 0 0 0 11.75 17h1.5A1.75 1.75 0 0 0 15 15.25V10h1a1.2 1.2 0 0 0 .75-2.1l-6-5Z" />
        </svg>
      );
    }

    if (normalizedName.includes('essent') || normalizedName.includes('grocer') || normalizedName.includes('shop')) {
      return (
        <svg aria-hidden="true" className={iconClassName} fill="currentColor" viewBox="0 0 20 20">
          <path d="M3.5 4.5a1 1 0 1 1 0-2h1.2c.46 0 .87.31.97.77l.4 1.73h9.18a1 1 0 0 1 .97 1.24l-1.13 4.8a1 1 0 0 1-.97.76H7.14l.23 1h7.13a1 1 0 1 1 0 2H6.56a1 1 0 0 1-.97-.77L4.14 6.5H3.5Zm3 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
        </svg>
      );
    }

    if (normalizedName.includes('mobil') || normalizedName.includes('car') || normalizedName.includes('transport')) {
      return (
        <svg aria-hidden="true" className={iconClassName} fill="currentColor" viewBox="0 0 20 20">
          <path d="M4.8 5.5A2 2 0 0 1 6.72 4h6.56a2 2 0 0 1 1.92 1.5l1.15 4.6a2.5 2.5 0 0 1 .15.9V14a1 1 0 0 1-1 1h-1a2 2 0 1 1-4 0h-1a2 2 0 1 1-4 0h-1a1 1 0 0 1-1-1v-3a2.5 2.5 0 0 1 .15-.9L4.8 5.5ZM5.9 9h8.2l-.75-3h-6.7l-.75 3Z" />
        </svg>
      );
    }

    if (normalizedName.includes('lifest') || normalizedName.includes('fun') || normalizedName.includes('entertain')) {
      return (
        <svg aria-hidden="true" className={iconClassName} fill="currentColor" viewBox="0 0 20 20">
          <path d="m10 2.3 1.91 3.87 4.27.62-3.09 3.01.73 4.26L10 12.05l-3.82 2.01.73-4.26-3.09-3.01 4.27-.62L10 2.3Z" />
        </svg>
      );
    }

    return (
      <svg aria-hidden="true" className={iconClassName} fill="currentColor" viewBox="0 0 20 20">
        <path d="M4.75 2.5h10.5A2.25 2.25 0 0 1 17.5 4.75v10.5a2.25 2.25 0 0 1-2.25 2.25H4.75A2.25 2.25 0 0 1 2.5 15.25V4.75A2.25 2.25 0 0 1 4.75 2.5Zm1.75 3a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2h-7Zm0 4a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2h-7Z" />
      </svg>
    );
  };

  const getCategoryIconClasses = (category: Category) => {
    if (category.archivedAt) {
      return 'bg-slate-200 text-slate-500';
    }
    const normalizedGroup = (category.superCategoryName ?? '').toLowerCase();
    if (normalizedGroup.includes('hous') || normalizedGroup.includes('home')) {
      return 'bg-blue-100 text-blue-600';
    }
    if (normalizedGroup.includes('essent') || normalizedGroup.includes('grocer')) {
      return 'bg-emerald-100 text-emerald-600';
    }
    if (normalizedGroup.includes('mobil') || normalizedGroup.includes('transport')) {
      return 'bg-violet-100 text-violet-600';
    }
    if (normalizedGroup.includes('lifest') || normalizedGroup.includes('fun') || normalizedGroup.includes('entertain')) {
      return 'bg-amber-100 text-amber-600';
    }
    return 'bg-slate-100 text-slate-600';
  };

  const renderMappedCategoryIcon = (superCategoryName: string | null, archived: boolean) => {
    const normalizedName = (superCategoryName ?? '').toLowerCase();

    if (archived) {
      return (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4.75 2.5h10.5A2.25 2.25 0 0 1 17.5 4.75v10.5a2.25 2.25 0 0 1-2.25 2.25H4.75A2.25 2.25 0 0 1 2.5 15.25V4.75A2.25 2.25 0 0 1 4.75 2.5Zm1.75 3a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2h-7Zm0 4a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2h-7Z" />
        </svg>
      );
    }

    if (normalizedName.includes('hous') || normalizedName.includes('home') || normalizedName.includes('rent')) {
      return (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10.75 2.9a1.2 1.2 0 0 0-1.5 0l-6 5A1.2 1.2 0 0 0 4 10h1v5.25A1.75 1.75 0 0 0 6.75 17h1.5A1.75 1.75 0 0 0 10 15.25V13h0v2.25A1.75 1.75 0 0 0 11.75 17h1.5A1.75 1.75 0 0 0 15 15.25V10h1a1.2 1.2 0 0 0 .75-2.1l-6-5Z" />
        </svg>
      );
    }

    if (
      normalizedName.includes('essent') ||
      normalizedName.includes('grocer') ||
      normalizedName.includes('shop') ||
      normalizedName.includes('super')
    ) {
      return (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M3.5 4.5a1 1 0 1 1 0-2h1.2c.46 0 .87.31.97.77l.4 1.73h9.18a1 1 0 0 1 .97 1.24l-1.13 4.8a1 1 0 0 1-.97.76H7.14l.23 1h7.13a1 1 0 1 1 0 2H6.56a1 1 0 0 1-.97-.77L4.14 6.5H3.5Zm3 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
        </svg>
      );
    }

    if (normalizedName.includes('mobil') || normalizedName.includes('transport') || normalizedName.includes('car')) {
      return (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4.8 5.5A2 2 0 0 1 6.72 4h6.56a2 2 0 0 1 1.92 1.5l1.15 4.6a2.5 2.5 0 0 1 .15.9V14a1 1 0 0 1-1 1h-1a2 2 0 1 1-4 0h-1a2 2 0 1 1-4 0h-1a1 1 0 0 1-1-1v-3a2.5 2.5 0 0 1 .15-.9L4.8 5.5ZM5.9 9h8.2l-.75-3h-6.7l-.75 3Z" />
        </svg>
      );
    }

    if (normalizedName.includes('lifest') || normalizedName.includes('fun') || normalizedName.includes('entertain')) {
      return (
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="m10 2.3 1.91 3.87 4.27.62-3.09 3.01.73 4.26L10 12.05l-3.82 2.01.73-4.26-3.09-3.01 4.27-.62L10 2.3Z" />
        </svg>
      );
    }

    return (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M4.75 2.5h10.5A2.25 2.25 0 0 1 17.5 4.75v10.5a2.25 2.25 0 0 1-2.25 2.25H4.75A2.25 2.25 0 0 1 2.5 15.25V4.75A2.25 2.25 0 0 1 4.75 2.5Zm1.75 3a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2h-7Zm0 4a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2h-7Z" />
      </svg>
    );
  };

  return (
    <AppShell month={month} title="Settings" subtitle="Manage categories and super categories used for monthly expenses">
      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <h2 className="text-3xl font-semibold text-slate-900">Super Categories</h2>
        <p className="mt-2 text-base text-slate-500">Default system groups for high-level tracking.</p>

        {error ? (
          <div aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <label className="sr-only" htmlFor="new-super-category">
                  New super category name
                </label>
                <input
                  id="new-super-category"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  onChange={(event) => setSuperCategoryName(event.target.value)}
                  placeholder="New super category name..."
                  value={superCategoryName}
                />
              </div>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
                disabled={saving}
                onClick={() => void onCreateSuperCategory()}
                type="button"
              >
                <span aria-hidden="true" className="text-xl leading-none">
                  +
                </span>
                Add
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-200">
            {sortedActiveSuperCategories.map((superCategory) => (
              <div
                key={superCategory.id}
                className="flex flex-col gap-4 px-4 py-5 text-sm transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {renderSuperCategoryIcon(superCategory.name)}
                  <p className="min-w-0 text-xl font-semibold text-slate-800">
                    {superCategory.name}
                    <span className="ml-3 text-base font-medium text-slate-400">
                      {superCategory.categoryCount} categories • {superCategory.isSystem ? 'System' : 'Custom'}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-60"
                    disabled={saving}
                    onClick={() => void onRenameSuperCategory(superCategory)}
                    type="button"
                  >
                    Rename
                  </button>
                  {!superCategory.isSystem ? (
                    <button
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                      disabled={saving}
                      onClick={() => void onArchiveSuperCategory(superCategory)}
                      type="button"
                    >
                      Archive
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-3xl font-semibold text-slate-900">Detailed Categories</h2>
            <p className="mt-2 text-base text-slate-500">Map specific spending labels to your super categories.</p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">
            {unassignedCategoryCount} UNASSIGNED
          </span>
        </div>

        <div className="mt-7 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr),220px,auto]">
            <div>
              <label className="sr-only" htmlFor="new-category-name">
                Category name
              </label>
              <input
                id="new-category-name"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="Category name (e.g. Internet, Groceries)"
                value={categoryName}
              />
            </div>
            <div>
              <label className="sr-only" htmlFor="new-category-super-category">
                Group for new category
              </label>
              <select
                id="new-category-super-category"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                onChange={(event) => setCategorySuperCategoryId(event.target.value)}
                value={categorySuperCategoryId}
              >
                <option value="unassigned">Unassigned</option>
                {sortedActiveSuperCategories.map((superCategory) => (
                  <option key={superCategory.id} value={superCategory.id}>
                    {superCategory.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="rounded-xl bg-brand-600 px-5 py-3 text-base font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-60"
              disabled={saving}
              onClick={() => void onCreateCategory()}
              type="button"
            >
              Add Label
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {categories.map((category) => (
            <div
              key={category.id}
              className={
                category.archivedAt
                  ? 'rounded-2xl border border-slate-200 bg-slate-100/80 p-5 opacity-80'
                  : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md'
              }
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${getCategoryIconClasses(category)}`}
                    >
                      {renderMappedCategoryIcon(category.superCategoryName, Boolean(category.archivedAt))}
                    </span>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-semibold text-slate-800">{category.name}</h3>
                        {category.archivedAt ? (
                          <span className="rounded-full border border-slate-300 bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-600">
                            Archived
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M5 2.5A2.5 2.5 0 0 0 2.5 5v10A2.5 2.5 0 0 0 5 17.5h10a2.5 2.5 0 0 0 2.5-2.5V5A2.5 2.5 0 0 0 15 2.5H5Zm1 4a1 1 0 1 1 0-2h8a1 1 0 1 1 0 2H6Zm0 4a1 1 0 1 1 0-2h8a1 1 0 1 1 0 2H6Zm0 4a1 1 0 1 1 0-2h6a1 1 0 1 1 0 2H6Z" />
                          </svg>
                          {category.expenseCount.toLocaleString()} expenses
                        </span>
                        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-slate-300" />
                        <span className="inline-flex items-center gap-1">
                          <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M7 2.5a1 1 0 0 0 0 2h.5v4.07L4.56 12.4a1 1 0 0 0 .74 1.75H9v3.35a1 1 0 1 0 2 0V14.15h3.7a1 1 0 0 0 .74-1.75L12.5 8.57V4.5h.5a1 1 0 1 0 0-2H7Z" />
                          </svg>
                          {category.fixedExpenseCount} fixed
                        </span>
                      </div>
                    </div>
                  </div>
                  {!category.archivedAt ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                      <label className="font-medium text-slate-500" htmlFor={`group-${category.id}`}>
                        Map to:
                      </label>
                      <select
                        id={`group-${category.id}`}
                        className="h-7 min-h-7 min-w-[116px] rounded-[16px] border border-slate-300 bg-slate-50 px-2 text-xs text-slate-700"
                        disabled={saving}
                        onChange={(event) => void onAssignCategory(category, event.target.value)}
                        value={category.superCategoryId ?? 'unassigned'}
                        aria-label={`Group for ${category.name}`}
                      >
                        <option value="unassigned">Unassigned</option>
                        {sortedActiveSuperCategories.map((superCategory) => (
                          <option key={superCategory.id} value={superCategory.id}>
                            {superCategory.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">Group: {category.superCategoryName ?? 'Unassigned'}</p>
                  )}
                </div>

                {!category.archivedAt ? (
                  <div className="flex flex-wrap items-center gap-2 lg:self-start">
                    <button
                      className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                      onClick={() => void onRenameCategory(category)}
                      type="button"
                    >
                      Rename
                    </button>
                    <button
                      className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                      onClick={() => void onArchiveCategory(category)}
                      type="button"
                    >
                      Archive
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
