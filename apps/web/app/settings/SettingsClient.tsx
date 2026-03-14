'use client';

import { ReactNode, useMemo, useState } from 'react';
import { ActionButton } from '../../components/ActionButton';
import { AppShell } from '../../components/AppShell';
import { ViewportModal } from '../../components/ViewportModal';
import {
  archiveCategory,
  archiveSuperCategory,
  assignCategorySuperCategory,
  Category,
  createCategory,
  createHouseholdInvite,
  createSuperCategory,
  getCategories,
  getSuperCategories,
  renameCategory,
  SuperCategory,
  unarchiveCategory,
  updateUser,
  updateSuperCategory,
} from '../../lib/api';

interface SettingsClientProps {
  month: string;
  initialCategories: Category[];
  initialSuperCategories: SuperCategory[];
  currentUserId: string | null;
  currentUserName: string | null;
  currentUserEmail: string | null;
}

type CategoryRenameDialogState = {
  category: Category;
  nextName: string;
};

type SuperCategoryRenameDialogState = {
  superCategory: SuperCategory;
  nextName: string;
};

type SuperCategoryArchiveDialogState = {
  superCategory: SuperCategory;
  replacementSuperCategoryId: string;
};

type CategoryArchiveDialogState = {
  category: Category;
};

function DialogFrame({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div
      aria-labelledby="settings-dialog-title"
      aria-modal="true"
      className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-900/10"
      role="dialog"
    >
      <h2 className="text-xl font-semibold text-slate-900" id="settings-dialog-title">
        {title}
      </h2>
      {children}
    </div>
  );
}

function DialogActions({
  busy,
  cancelLabel = 'Cancel',
  confirmLabel,
  onCancel,
}: {
  busy: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        onClick={onCancel}
        type="button"
      >
        {cancelLabel}
      </button>
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        type="submit"
      >
        {confirmLabel}
      </button>
    </div>
  );
}

function formatCountLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function SettingsClient({
  month,
  initialCategories,
  initialSuperCategories,
  currentUserId,
  currentUserName,
  currentUserEmail,
}: SettingsClientProps) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [superCategories, setSuperCategories] = useState<SuperCategory[]>(initialSuperCategories);
  const [categoryName, setCategoryName] = useState('');
  const [categorySuperCategoryId, setCategorySuperCategoryId] = useState<string>('unassigned');
  const [superCategoryName, setSuperCategoryName] = useState('');
  const [displayNameDraft, setDisplayNameDraft] = useState(currentUserName ?? '');
  const [resolvedCurrentUserName, setResolvedCurrentUserName] = useState(currentUserName ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [superCategoryError, setSuperCategoryError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [categoryRenameDialog, setCategoryRenameDialog] = useState<CategoryRenameDialogState | null>(null);
  const [superCategoryRenameDialog, setSuperCategoryRenameDialog] = useState<SuperCategoryRenameDialogState | null>(null);
  const [superCategoryArchiveDialog, setSuperCategoryArchiveDialog] = useState<SuperCategoryArchiveDialogState | null>(null);
  const [categoryArchiveDialog, setCategoryArchiveDialog] = useState<CategoryArchiveDialogState | null>(null);

  const activeCategories = useMemo(
    () => categories.filter((category) => category.archivedAt === null),
    [categories],
  );

  const sortedCategories = useMemo(
    () =>
      [...categories].sort((left, right) => {
        const leftArchived = left.archivedAt !== null;
        const rightArchived = right.archivedAt !== null;
        if (leftArchived !== rightArchived) {
          return leftArchived ? 1 : -1;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      }),
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

  const formatPostMutationRefreshError = (fallbackMessage: string, error: unknown): string =>
    error instanceof Error ? `${fallbackMessage} ${error.message}` : fallbackMessage;

  const onUpdateDisplayName = async () => {
    if (!currentUserId) {
      setProfileError('No active user found in session.');
      return;
    }

    const nextName = displayNameDraft.trim();
    if (!nextName) {
      setProfileError('Display name is required.');
      return;
    }

    if (nextName === resolvedCurrentUserName.trim()) {
      setProfileSuccess('Display name is already up to date.');
      setProfileError(null);
      return;
    }

    try {
      setProfileSaving(true);
      setProfileError(null);
      setProfileSuccess(null);
      const updated = await updateUser(currentUserId, { name: nextName });
      setResolvedCurrentUserName(updated.name);
      setDisplayNameDraft(updated.name);
      setProfileSuccess('Display name updated.');
    } catch (profileUpdateError) {
      setProfileError(profileUpdateError instanceof Error ? profileUpdateError.message : 'Failed to update display name');
    } finally {
      setProfileSaving(false);
    }
  };

  const onCreateInviteCode = async () => {
    try {
      setInviteLoading(true);
      setInviteError(null);
      setInviteSuccess(null);
      const invite = await createHouseholdInvite();
      setInviteCode(invite.code);
      setInviteExpiresAt(invite.expiresAt);
      setInviteSuccess('Invite code generated. Share it with your partner.');
    } catch (inviteCreateError) {
      setInviteError(inviteCreateError instanceof Error ? inviteCreateError.message : 'Failed to create invite code');
    } finally {
      setInviteLoading(false);
    }
  };

  const onCopyInviteCode = async () => {
    if (!inviteCode) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteCode);
      setInviteSuccess('Invite code copied to clipboard.');
    } catch {
      setInviteError('Unable to copy invite code. Please copy it manually.');
    }
  };

  const onCreateCategory = async () => {
    if (!categoryName.trim()) {
      return;
    }

    try {
      setSaving(true);
      setCategoryError(null);
      await createCategory({
        name: categoryName.trim(),
        superCategoryId: categorySuperCategoryId === 'unassigned' ? null : categorySuperCategoryId,
      });
      setCategoryName('');
      setCategorySuperCategoryId('unassigned');
    } catch (categoryError) {
      setCategoryError(categoryError instanceof Error ? categoryError.message : 'Failed to create category');
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(formatPostMutationRefreshError('Category created, but settings could not refresh automatically.', refreshError));
    } finally {
      setSaving(false);
    }
  };

  const onRenameCategory = async (category: Category) => {
    setCategoryRenameDialog({
      category,
      nextName: category.name,
    });
  };

  const submitRenameCategory = async () => {
    if (!categoryRenameDialog) {
      return;
    }

    const nextName = categoryRenameDialog.nextName.trim();
    if (!nextName || nextName === categoryRenameDialog.category.name) {
      setCategoryRenameDialog(null);
      return;
    }

    try {
      setSaving(true);
      setCategoryError(null);
      await renameCategory(categoryRenameDialog.category.id, { name: nextName });
      setCategoryRenameDialog(null);
    } catch (renameError) {
      setCategoryError(renameError instanceof Error ? renameError.message : 'Failed to rename category');
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(formatPostMutationRefreshError('Category renamed, but settings could not refresh automatically.', refreshError));
    } finally {
      setSaving(false);
    }
  };

  const onAssignCategory = async (category: Category, nextSuperCategoryId: string) => {
    try {
      setSaving(true);
      setCategoryError(null);
      await assignCategorySuperCategory(category.id, {
        superCategoryId: nextSuperCategoryId === 'unassigned' ? null : nextSuperCategoryId,
      });
    } catch (assignError) {
      setCategoryError(assignError instanceof Error ? assignError.message : 'Failed to assign category');
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(
        formatPostMutationRefreshError('Category updated, but settings could not refresh automatically.', refreshError),
      );
    } finally {
      setSaving(false);
    }
  };

  const onArchiveCategory = async (category: Category) => {
    if (category.archivedAt) {
      return;
    }
    setCategoryArchiveDialog({ category });
  };

  const submitArchiveCategory = async () => {
    if (!categoryArchiveDialog) {
      return;
    }

    try {
      setSaving(true);
      setCategoryError(null);
      await archiveCategory(categoryArchiveDialog.category.id);
      setCategoryArchiveDialog(null);
    } catch (archiveError) {
      setCategoryError(archiveError instanceof Error ? archiveError.message : 'Failed to archive category');
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(
        formatPostMutationRefreshError('Category archived, but settings could not refresh automatically.', refreshError),
      );
    } finally {
      setSaving(false);
    }
  };

  const onUnarchiveCategory = async (category: Category) => {
    if (!category.archivedAt) {
      return;
    }

    try {
      setSaving(true);
      setCategoryError(null);
      await unarchiveCategory(category.id);
    } catch (unarchiveError) {
      setCategoryError(unarchiveError instanceof Error ? unarchiveError.message : 'Failed to unarchive category');
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(
        formatPostMutationRefreshError('Category restored, but settings could not refresh automatically.', refreshError),
      );
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
      setSuperCategoryError(null);
      const nextSortOrder =
        sortedActiveSuperCategories.length > 0
          ? Math.max(...sortedActiveSuperCategories.map((entry) => entry.sortOrder)) + 10
          : 10;
      await createSuperCategory({
        name: superCategoryName.trim(),
        sortOrder: nextSortOrder,
      });
      setSuperCategoryName('');
    } catch (superCategoryError) {
      setSuperCategoryError(superCategoryError instanceof Error ? superCategoryError.message : 'Failed to create super category');
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setSuperCategoryError(
        formatPostMutationRefreshError('Group created, but settings could not refresh automatically.', refreshError),
      );
    } finally {
      setSaving(false);
    }
  };

  const onRenameSuperCategory = async (superCategory: SuperCategory) => {
    setSuperCategoryRenameDialog({
      superCategory,
      nextName: superCategory.name,
    });
  };

  const submitRenameSuperCategory = async () => {
    if (!superCategoryRenameDialog) {
      return;
    }

    const nextName = superCategoryRenameDialog.nextName.trim();
    if (!nextName || nextName === superCategoryRenameDialog.superCategory.name) {
      setSuperCategoryRenameDialog(null);
      return;
    }

    try {
      setSaving(true);
      setSuperCategoryError(null);
      await updateSuperCategory(superCategoryRenameDialog.superCategory.id, { name: nextName });
      setSuperCategoryRenameDialog(null);
    } catch (renameError) {
      setSuperCategoryError(renameError instanceof Error ? renameError.message : 'Failed to rename super category');
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setSuperCategoryError(
        formatPostMutationRefreshError('Group renamed, but settings could not refresh automatically.', refreshError),
      );
    } finally {
      setSaving(false);
    }
  };

  const onArchiveSuperCategory = async (superCategory: SuperCategory) => {
    if (superCategory.archivedAt || superCategory.isSystem) {
      return;
    }
    setSuperCategoryArchiveDialog({
      superCategory,
      replacementSuperCategoryId: 'unassigned',
    });
  };

  const submitArchiveSuperCategory = async () => {
    if (!superCategoryArchiveDialog) {
      return;
    }

    try {
      setSaving(true);
      setSuperCategoryError(null);
      await archiveSuperCategory(superCategoryArchiveDialog.superCategory.id, {
        replacementSuperCategoryId:
          superCategoryArchiveDialog.replacementSuperCategoryId === 'unassigned'
            ? undefined
            : superCategoryArchiveDialog.replacementSuperCategoryId,
      });
      setSuperCategoryArchiveDialog(null);
    } catch (archiveError) {
      setSuperCategoryError(archiveError instanceof Error ? archiveError.message : 'Failed to archive super category');
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setSuperCategoryError(
        formatPostMutationRefreshError('Group archived, but settings could not refresh automatically.', refreshError),
      );
    } finally {
      setSaving(false);
    }
  };

  const renderSuperCategoryIcon = (name: string) => {
    const normalizedName = name.toLowerCase();
    const iconClassName = 'h-5 w-5 text-ink-soft';

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
      {categoryRenameDialog ? (
        <ViewportModal onDismiss={() => (saving ? undefined : setCategoryRenameDialog(null))}>
          <DialogFrame title="Rename category">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitRenameCategory();
              }}
            >
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Update the label for <span className="font-semibold text-slate-900">{categoryRenameDialog.category.name}</span>.
                The new name will apply to historical records too.
              </p>
              <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="rename-category-input">
                Category name
              </label>
              <input
                autoFocus
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                id="rename-category-input"
                onChange={(event) =>
                  setCategoryRenameDialog((current) => (current ? { ...current, nextName: event.target.value } : current))
                }
                value={categoryRenameDialog.nextName}
              />
              <DialogActions busy={saving} confirmLabel={saving ? 'Saving...' : 'Save category'} onCancel={() => setCategoryRenameDialog(null)} />
            </form>
          </DialogFrame>
        </ViewportModal>
      ) : null}

      {superCategoryRenameDialog ? (
        <ViewportModal onDismiss={() => (saving ? undefined : setSuperCategoryRenameDialog(null))}>
          <DialogFrame title="Rename group">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitRenameSuperCategory();
              }}
            >
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Rename <span className="font-semibold text-slate-900">{superCategoryRenameDialog.superCategory.name}</span> to match how you organize spending.
              </p>
              <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="rename-super-category-input">
                Group name
              </label>
              <input
                autoFocus
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                id="rename-super-category-input"
                onChange={(event) =>
                  setSuperCategoryRenameDialog((current) => (current ? { ...current, nextName: event.target.value } : current))
                }
                value={superCategoryRenameDialog.nextName}
              />
              <DialogActions busy={saving} confirmLabel={saving ? 'Saving...' : 'Save group'} onCancel={() => setSuperCategoryRenameDialog(null)} />
            </form>
          </DialogFrame>
        </ViewportModal>
      ) : null}

      {superCategoryArchiveDialog ? (
        <ViewportModal onDismiss={() => (saving ? undefined : setSuperCategoryArchiveDialog(null))}>
          <DialogFrame title="Archive group">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitArchiveSuperCategory();
              }}
            >
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Archive <span className="font-semibold text-slate-900">{superCategoryArchiveDialog.superCategory.name}</span>.
                Existing categories can move to another group or become unassigned.
              </p>
              <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="archive-super-category-replacement">
                Move categories to
              </label>
              <select
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                id="archive-super-category-replacement"
                onChange={(event) =>
                  setSuperCategoryArchiveDialog((current) =>
                    current ? { ...current, replacementSuperCategoryId: event.target.value } : current,
                  )
                }
                value={superCategoryArchiveDialog.replacementSuperCategoryId}
              >
                <option value="unassigned">Unassigned</option>
                {sortedActiveSuperCategories
                  .filter((entry) => entry.id !== superCategoryArchiveDialog.superCategory.id)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
              <DialogActions busy={saving} confirmLabel={saving ? 'Archiving...' : 'Archive group'} onCancel={() => setSuperCategoryArchiveDialog(null)} />
            </form>
          </DialogFrame>
        </ViewportModal>
      ) : null}

      {categoryArchiveDialog ? (
        <ViewportModal onDismiss={() => (saving ? undefined : setCategoryArchiveDialog(null))}>
          <DialogFrame title="Archive category">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitArchiveCategory();
              }}
            >
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Archive <span className="font-semibold text-slate-900">{categoryArchiveDialog.category.name}</span>.
                It will disappear from active lists but remain available in historical records.
              </p>
              <DialogActions busy={saving} confirmLabel={saving ? 'Archiving...' : 'Archive category'} onCancel={() => setCategoryArchiveDialog(null)} />
            </form>
          </DialogFrame>
        </ViewportModal>
      ) : null}

      <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Personal Information</h2>
        <p className="mt-2 text-base text-slate-500">Your identity across the Fairsplit platform.</p>

        <div className="mt-6 rounded-xl border border-sky-300 bg-gradient-to-b from-sky-100 to-blue-100 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <h3 className="text-base font-semibold text-slate-900">Invite Someone</h3>
          <p className="mt-1 text-xs text-slate-600">Generate a one-time code so another person can join your household.</p>
          <button
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={inviteLoading}
            onClick={() => void onCreateInviteCode()}
            type="button"
          >
            {inviteLoading ? 'Generating...' : 'Generate Invite Code'}
          </button>
          {inviteCode ? (
            <div className="mt-3 rounded-lg border border-slate-300 bg-white/90 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Invite code</p>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-bold tracking-[0.15em] text-slate-900">{inviteCode}</p>
                <button
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  onClick={() => void onCopyInviteCode()}
                  type="button"
                >
                  Copy
                </button>
              </div>
              {inviteExpiresAt ? (
                <p className="mt-1 text-xs text-slate-500">Expires: {new Date(inviteExpiresAt).toLocaleString()}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {inviteError ? (
          <div aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {inviteError}
          </div>
        ) : null}
        {inviteSuccess ? (
          <div aria-live="polite" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {inviteSuccess}
          </div>
        ) : null}

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="text-xl font-semibold text-slate-700">Display Name</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  aria-label="Display name"
                  className="min-w-0 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-medium text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  onChange={(event) => setDisplayNameDraft(event.target.value)}
                  placeholder="Your name"
                  value={displayNameDraft}
                />
                <button
                  className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  disabled={profileSaving || !currentUserId}
                  onClick={() => void onUpdateDisplayName()}
                  type="button"
                >
                  {profileSaving ? 'Updating...' : 'Update'}
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-500">This is how your partner will see you in shared expenses.</p>
            </div>

            <div className="min-w-0">
              <p className="text-xl font-semibold text-slate-700">Email Address</p>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3">
                <span className="min-w-0 truncate text-base font-medium text-slate-500">
                  {currentUserEmail ?? 'No email available in this session'}
                </span>
                <svg aria-hidden="true" className="ml-3 h-6 w-6 shrink-0 text-ink-soft" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5.5 8V6a4.5 4.5 0 1 1 9 0v2h.25A2.25 2.25 0 0 1 17 10.25v5.5A2.25 2.25 0 0 1 14.75 18h-9.5A2.25 2.25 0 0 1 3 15.75v-5.5A2.25 2.25 0 0 1 5.25 8h.25Zm7.5 0V6a3 3 0 1 0-6 0v2h6Z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {profileError ? (
          <div aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {profileError}
          </div>
        ) : null}
        {profileSuccess ? (
          <div aria-live="polite" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {profileSuccess}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Super Categories</h2>
        <p className="mt-2 text-base text-slate-500">Default system groups for high-level tracking.</p>

        {superCategoryError ? (
          <div aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {superCategoryError}
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
                className="flex items-start justify-between gap-3 px-4 py-4 text-sm transition-colors hover:bg-slate-50 sm:items-center sm:px-5"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {renderSuperCategoryIcon(superCategory.name)}
                  <div className="min-w-0">
                    <p className="min-w-0 text-base font-semibold text-slate-800 sm:text-lg">
                      {superCategory.name}
                    </p>
                    <p className="text-sm font-medium text-ink-soft sm:text-base">
                      {formatCountLabel(superCategory.categoryCount, 'category', 'categories')} •{' '}
                      {superCategory.isSystem ? 'System' : 'Custom'}
                    </p>
                  </div>
                </div>

                <div className="ml-2 flex shrink-0 items-center gap-2 self-start">
                  <ActionButton
                    action="rename"
                    aria-label={`Rename ${superCategory.name}`}
                    className="h-11 w-11 sm:hidden"
                    disabled={saving}
                    onClick={() => void onRenameSuperCategory(superCategory)}
                    size="icon"
                  >
                    <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </ActionButton>
                  <ActionButton
                    action="rename"
                    className="hidden sm:inline-flex"
                    disabled={saving}
                    onClick={() => void onRenameSuperCategory(superCategory)}
                  >
                    Rename
                  </ActionButton>
                  {!superCategory.isSystem ? (
                    <ActionButton
                      action="archive"
                      aria-label={`Archive ${superCategory.name}`}
                      className="h-11 w-11 sm:hidden"
                      disabled={saving}
                      onClick={() => void onArchiveSuperCategory(superCategory)}
                      size="icon"
                    >
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M3 7h18" />
                        <path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" />
                        <path d="M9 11h6" />
                        <path d="M9 3h6l1 4H8z" />
                      </svg>
                    </ActionButton>
                  ) : null}
                  {!superCategory.isSystem ? (
                    <ActionButton
                      action="archive"
                      className="hidden sm:inline-flex"
                      disabled={saving}
                      onClick={() => void onArchiveSuperCategory(superCategory)}
                    >
                      Archive
                    </ActionButton>
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
            <h2 className="text-2xl font-semibold text-slate-900">Detailed Categories</h2>
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

        {categoryError ? (
          <div aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {categoryError}
          </div>
        ) : null}

        <div className="mt-5 space-y-4">
          {sortedCategories.map((category) => (
            <div
              key={category.id}
              className={
                category.archivedAt
                  ? 'rounded-2xl border border-slate-200 bg-slate-100/80 p-5 opacity-80'
                  : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md'
              }
            >
              <div className="flex items-start justify-between gap-3 lg:items-center">
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
                        <h3 className="text-lg font-semibold text-slate-800">{category.name}</h3>
                        {category.archivedAt ? (
                          <span className="rounded-full border border-slate-300 bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-600">
                            Archived
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-ink-soft">
                        <span className="inline-flex items-center gap-1">
                          <svg aria-hidden="true" className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M5 2.5A2.5 2.5 0 0 0 2.5 5v10A2.5 2.5 0 0 0 5 17.5h10a2.5 2.5 0 0 0 2.5-2.5V5A2.5 2.5 0 0 0 15 2.5H5Zm1 4a1 1 0 1 1 0-2h8a1 1 0 1 1 0 2H6Zm0 4a1 1 0 1 1 0-2h8a1 1 0 1 1 0 2H6Zm0 4a1 1 0 1 1 0-2h6a1 1 0 1 1 0 2H6Z" />
                          </svg>
                          {formatCountLabel(category.expenseCount, 'expense', 'expenses')}
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
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <label className="font-medium text-slate-500" htmlFor={`group-${category.id}`}>
                        Map to:
                      </label>
                      <select
                        id={`group-${category.id}`}
                        className="h-11 min-h-11 min-w-0 max-w-[180px] flex-1 rounded-[16px] border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700"
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
                  <div className="ml-2 flex shrink-0 items-center gap-2 self-start">
                    <ActionButton
                      action="rename"
                      aria-label={`Rename ${category.name}`}
                      className="h-11 w-11 lg:hidden"
                      onClick={() => void onRenameCategory(category)}
                      size="icon"
                    >
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </ActionButton>
                    <ActionButton
                      action="rename"
                      className="hidden lg:inline-flex"
                      onClick={() => void onRenameCategory(category)}
                    >
                      Rename
                    </ActionButton>
                    <ActionButton
                      action="archive"
                      aria-label={`Archive ${category.name}`}
                      className="h-11 w-11 lg:hidden"
                      onClick={() => void onArchiveCategory(category)}
                      size="icon"
                    >
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M3 7h18" />
                        <path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" />
                        <path d="M9 11h6" />
                        <path d="M9 3h6l1 4H8z" />
                      </svg>
                    </ActionButton>
                    <ActionButton
                      action="archive"
                      className="hidden lg:inline-flex"
                      onClick={() => void onArchiveCategory(category)}
                    >
                      Archive
                    </ActionButton>
                  </div>
                ) : (
                  <div className="ml-2 flex shrink-0 items-center gap-2 self-start">
                    <ActionButton
                      action="edit"
                      aria-label={`Unarchive ${category.name}`}
                      className="h-11 w-11 lg:hidden"
                      onClick={() => void onUnarchiveCategory(category)}
                      size="icon"
                    >
                      <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <path d="M7 10l5-5 5 5" />
                        <path d="M12 5v12" />
                      </svg>
                    </ActionButton>
                    <ActionButton
                      action="edit"
                      className="hidden lg:inline-flex"
                      onClick={() => void onUnarchiveCategory(category)}
                    >
                      Unarchive
                    </ActionButton>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
