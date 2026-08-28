'use client';

import { inferCategoryIcon, type CategoryIconKey } from '@fairsplit/shared';
import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActionButton } from '../../components/ActionButton';
import { AppShell } from '../../components/AppShell';
import { CategoryIcon } from '../../components/CategoryIcon';
import { CategoryIconPicker } from '../../components/CategoryIconPicker';
import { ViewportModal } from '../../components/ViewportModal';
import {
  archiveCategory,
  archiveSuperCategory,
  assignCategorySuperCategory,
  Category,
  createCategory,
  createHouseholdInvite,
  joinHouseholdWithCode,
  createSuperCategory,
  getCategories,
  getSuperCategories,
  updateCategory,
  type Passkey,
  type HouseholdSplitPolicy,
  SuperCategory,
  unarchiveCategory,
  updateUser,
  updateSuperCategory,
  type AppLocale,
} from '../../lib/api';
import { formatCountLabel, localeLabels, localeTags, resolveLocale, t } from '../../lib/i18n';
import { useRouter } from 'next/navigation';
import { PasskeysCard } from './PasskeysCard';
import { SplitPolicyCard } from './SplitPolicyCard';

interface SettingsClientProps {
  month: string;
  initialCategories: Category[];
  initialSuperCategories: SuperCategory[];
  currentUserId: string | null;
  currentUserName: string | null;
  currentUserEmail: string | null;
  currentUserLocale: AppLocale;
  initialPasskeys: Passkey[];
  initialSplitPolicy: HouseholdSplitPolicy;
  passkeysConfigured: boolean;
  /** Joining another household is only offered while nobody else is here. */
  isOnlyHouseholdMember: boolean;
}

type CategoryRenameDialogState = {
  category: Category;
  nextIcon: CategoryIconKey;
  nextName: string;
};

type SuperCategoryRenameDialogState = {
  superCategory: SuperCategory;
  nextIcon: CategoryIconKey;
  nextName: string;
};

type SuperCategoryArchiveDialogState = {
  superCategory: SuperCategory;
  replacementSuperCategoryId: string;
};

type CategoryArchiveDialogState = {
  category: Category;
};

type SettingsTabId = 'profile' | 'household' | 'split-policy' | 'categories' | 'security';
const SETTINGS_TAB_IDS: SettingsTabId[] = [
  'profile',
  'household',
  'split-policy',
  'categories',
  'security',
];

interface SettingsTab {
  id: SettingsTabId;
  label: string;
}

function SettingsTabs({
  activeTab,
  label,
  onChange,
  tabs,
}: {
  activeTab: SettingsTabId;
  label: string;
  onChange: (tab: SettingsTabId) => void;
  tabs: SettingsTab[];
}) {
  const pillRef = useRef<HTMLSpanElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<SettingsTabId, HTMLButtonElement>());
  const activeTabRef = useRef(activeTab);
  const hasPositionedPill = useRef(false);
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  const positionPill = useCallback((tabId: SettingsTabId, animate: boolean) => {
    const pill = pillRef.current;
    const tab = tabRefs.current.get(tabId);
    if (!pill || !tab) {
      return;
    }

    if (!animate) {
      pill.style.transition = 'none';
    }
    pill.style.width = `${tab.offsetWidth}px`;
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;

    if (!animate) {
      void pill.offsetWidth;
      pill.style.removeProperty('transition');
    }
  }, []);

  useLayoutEffect(() => {
    activeTabRef.current = activeTab;
    positionPill(activeTab, hasPositionedPill.current);
    hasPositionedPill.current = true;
  }, [activeTab, positionPill]);

  useEffect(() => {
    const scrollViewport = scrollViewportRef.current;
    const tabList = tabListRef.current;
    if (!scrollViewport || !tabList) {
      return;
    }

    const updateScrollEdges = () => {
      const maxScrollLeft = scrollViewport.scrollWidth - scrollViewport.clientWidth;
      const nextEdges = {
        left: scrollViewport.scrollLeft > 1,
        right: scrollViewport.scrollLeft < maxScrollLeft - 1,
      };
      setScrollEdges((current) =>
        current.left === nextEdges.left && current.right === nextEdges.right ? current : nextEdges,
      );
    };
    const updateLayout = () => {
      positionPill(activeTabRef.current, false);
      updateScrollEdges();
    };
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateLayout);
    resizeObserver?.observe(tabList);
    resizeObserver?.observe(scrollViewport);
    scrollViewport.addEventListener('scroll', updateScrollEdges, { passive: true });
    window.addEventListener('resize', updateLayout);
    updateScrollEdges();

    return () => {
      resizeObserver?.disconnect();
      scrollViewport.removeEventListener('scroll', updateScrollEdges);
      window.removeEventListener('resize', updateLayout);
    };
  }, [positionPill]);

  const selectTab = (tabId: SettingsTabId, focus = false) => {
    onChange(tabId);
    window.history.replaceState(null, '', `#settings-${tabId}`);
    if (focus) {
      tabRefs.current.get(tabId)?.focus();
    }
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tabIndex: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIndex = (tabIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex !== null) {
      event.preventDefault();
      selectTab(tabs[nextIndex].id, true);
    }
  };

  const scrollMaskImage = scrollEdges.left
    ? scrollEdges.right
      ? 'linear-gradient(to right, transparent 0, black 2rem, black calc(100% - 2rem), transparent 100%)'
      : 'linear-gradient(to right, transparent 0, black 2rem, black 100%)'
    : scrollEdges.right
      ? 'linear-gradient(to right, black 0, black calc(100% - 2rem), transparent 100%)'
      : undefined;

  return (
    <div
      className="mb-6 overflow-x-auto pb-1"
      ref={scrollViewportRef}
      style={
        scrollMaskImage
          ? { WebkitMaskImage: scrollMaskImage, maskImage: scrollMaskImage }
          : undefined
      }
    >
      <div
        aria-label={label}
        className="relative inline-flex min-w-full items-center gap-1 rounded-xl border border-stroke bg-surface-muted p-1"
        ref={tabListRef}
        role="tablist"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 left-0 z-0 rounded-lg bg-brand-600 shadow-sm transition-[transform,width] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          ref={pillRef}
        />
        {tabs.map((tab, index) => {
          const selected = activeTab === tab.id;
          return (
            <button
              aria-controls={`settings-${tab.id}-panel`}
              aria-selected={selected}
              className={`relative z-10 min-h-11 flex-1 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-muted motion-reduce:transition-none ${
                selected ? 'text-white' : 'text-ink-muted hover:text-ink-strong'
              }`}
              id={`settings-${tab.id}-tab`}
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              ref={(node) => {
                if (node) {
                  tabRefs.current.set(tab.id, node);
                } else {
                  tabRefs.current.delete(tab.id);
                }
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DialogFrame({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div
      aria-labelledby="settings-dialog-title"
      aria-modal="true"
      className="w-full max-w-lg rounded-3xl border border-stroke bg-surface p-6 shadow-2xl shadow-ink-strong/10"
      role="dialog"
    >
      <h2 className="text-xl font-semibold text-ink-strong" id="settings-dialog-title">
        {title}
      </h2>
      {children}
    </div>
  );
}

function DialogActions({
  busy,
  cancelLabel,
  confirmLabel,
  onCancel,
}: {
  busy: boolean;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink-base hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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

export function SettingsClient({
  month,
  initialCategories,
  initialSuperCategories,
  currentUserId,
  currentUserName,
  currentUserEmail,
  currentUserLocale,
  initialPasskeys,
  initialSplitPolicy,
  passkeysConfigured,
  isOnlyHouseholdMember,
}: SettingsClientProps) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [superCategories, setSuperCategories] = useState<SuperCategory[]>(initialSuperCategories);
  const [categoryName, setCategoryName] = useState('');
  const [categoryIconOverride, setCategoryIconOverride] = useState<CategoryIconKey | null>(null);
  const [showCategoryIcons, setShowCategoryIcons] = useState(false);
  const [categorySuperCategoryId, setCategorySuperCategoryId] = useState<string>('unassigned');
  const [superCategoryName, setSuperCategoryName] = useState('');
  const [superCategoryIconOverride, setSuperCategoryIconOverride] =
    useState<CategoryIconKey | null>(null);
  const [showSuperCategoryIcons, setShowSuperCategoryIcons] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(currentUserName ?? '');
  const [localeDraft, setLocaleDraft] = useState<AppLocale>(currentUserLocale);
  const [resolvedCurrentUserName, setResolvedCurrentUserName] = useState(currentUserName ?? '');
  const [resolvedLocale, setResolvedLocale] = useState<AppLocale>(currentUserLocale);
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
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('profile');
  const router = useRouter();
  const [categoryRenameDialog, setCategoryRenameDialog] =
    useState<CategoryRenameDialogState | null>(null);
  const [superCategoryRenameDialog, setSuperCategoryRenameDialog] =
    useState<SuperCategoryRenameDialogState | null>(null);
  const [superCategoryArchiveDialog, setSuperCategoryArchiveDialog] =
    useState<SuperCategoryArchiveDialogState | null>(null);
  const [categoryArchiveDialog, setCategoryArchiveDialog] =
    useState<CategoryArchiveDialogState | null>(null);
  const copy = t(resolvedLocale).settings;
  const shared = t(resolvedLocale).common;
  const settingsTabs: SettingsTab[] = [
    { id: 'profile', label: copy.profile },
    { id: 'household', label: copy.household },
    { id: 'split-policy', label: copy.splitPolicy.title },
    { id: 'categories', label: copy.categories },
    { id: 'security', label: copy.security },
  ];
  const suggestedCategoryIcon = inferCategoryIcon(categoryName);
  const selectedCategoryIcon = categoryIconOverride ?? suggestedCategoryIcon;
  const suggestedSuperCategoryIcon = inferCategoryIcon(superCategoryName);
  const selectedSuperCategoryIcon = superCategoryIconOverride ?? suggestedSuperCategoryIcon;

  useEffect(() => {
    const syncTabFromHash = () => {
      const hashTab = window.location.hash.replace('#settings-', '') as SettingsTabId;
      if (SETTINGS_TAB_IDS.includes(hashTab)) {
        setActiveTab(hashTab);
      }
    };

    syncTabFromHash();
    window.addEventListener('hashchange', syncTabFromHash);
    return () => window.removeEventListener('hashchange', syncTabFromHash);
  }, []);

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
    () =>
      [...activeSuperCategories].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    [activeSuperCategories],
  );

  const activeSuperCategoryById = useMemo(
    () => new Map(activeSuperCategories.map((superCategory) => [superCategory.id, superCategory])),
    [activeSuperCategories],
  );

  const unassignedCategoryCount = useMemo(
    () => activeCategories.filter((category) => category.superCategoryId === null).length,
    [activeCategories],
  );

  const loadSettings = async () => {
    const [nextCategories, nextSuperCategories] = await Promise.all([
      getCategories(),
      getSuperCategories(),
    ]);
    setCategories(nextCategories);
    setSuperCategories(nextSuperCategories);
  };

  const formatPostMutationRefreshError = (fallbackMessage: string, error: unknown): string =>
    error instanceof Error ? `${fallbackMessage} ${error.message}` : fallbackMessage;

  const onUpdateDisplayName = async () => {
    if (!currentUserId) {
      setProfileError(copy.noActiveUser);
      return;
    }

    const nextName = displayNameDraft.trim();
    if (!nextName) {
      setProfileError(copy.displayNameRequired);
      return;
    }

    if (nextName === resolvedCurrentUserName.trim() && localeDraft === resolvedLocale) {
      setProfileSuccess(copy.profileAlreadyUpdated);
      setProfileError(null);
      return;
    }

    try {
      setProfileSaving(true);
      setProfileError(null);
      setProfileSuccess(null);
      const updated = await updateUser(currentUserId, { name: nextName, locale: localeDraft });
      // An API that predates the locale column omits it from the response.
      const updatedLocale = resolveLocale(updated);
      setResolvedCurrentUserName(updated.name);
      setDisplayNameDraft(updated.name);
      setResolvedLocale(updatedLocale);
      setLocaleDraft(updatedLocale);
      setProfileSuccess(t(updatedLocale).settings.profileUpdated);
    } catch (profileUpdateError) {
      setProfileError(
        profileUpdateError instanceof Error ? profileUpdateError.message : copy.profileUpdateFailed,
      );
    } finally {
      setProfileSaving(false);
    }
  };

  /**
   * The API refuses this once the household holds expenses or income, or once
   * someone else is in it, and says why — so the failure is surfaced rather than
   * pre-empted here.
   */
  const onJoinHousehold = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedCode = joinCode.trim();
    if (!normalizedCode) {
      setJoinError(copy.joinCodeRequired);
      return;
    }
    try {
      setJoinLoading(true);
      setJoinError(null);
      await joinHouseholdWithCode(normalizedCode);
      router.replace('/dashboard');
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : copy.joinFailed);
    } finally {
      setJoinLoading(false);
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
      setInviteSuccess(copy.inviteGenerated);
    } catch (inviteCreateError) {
      setInviteError(
        inviteCreateError instanceof Error ? inviteCreateError.message : copy.inviteCreateFailed,
      );
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
      setInviteSuccess(copy.inviteCopied);
    } catch {
      setInviteError(copy.inviteCopyFailed);
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
        icon: selectedCategoryIcon,
        superCategoryId: categorySuperCategoryId === 'unassigned' ? null : categorySuperCategoryId,
      });
      setCategoryName('');
      setCategoryIconOverride(null);
      setShowCategoryIcons(false);
      setCategorySuperCategoryId('unassigned');
    } catch (categoryError) {
      setCategoryError(
        categoryError instanceof Error ? categoryError.message : copy.errors.createCategory,
      );
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(
        formatPostMutationRefreshError(copy.refreshErrors.categoryCreated, refreshError),
      );
    } finally {
      setSaving(false);
    }
  };

  const onRenameCategory = async (category: Category) => {
    setCategoryRenameDialog({
      category,
      nextIcon: category.icon,
      nextName: category.name,
    });
  };

  const submitRenameCategory = async () => {
    if (!categoryRenameDialog) {
      return;
    }

    const nextName = categoryRenameDialog.nextName.trim();
    const unchanged =
      nextName === categoryRenameDialog.category.name &&
      categoryRenameDialog.nextIcon === categoryRenameDialog.category.icon;
    if (!nextName || unchanged) {
      setCategoryRenameDialog(null);
      return;
    }

    try {
      setSaving(true);
      setCategoryError(null);
      await updateCategory(categoryRenameDialog.category.id, {
        name: nextName,
        icon: categoryRenameDialog.nextIcon,
      });
      setCategoryRenameDialog(null);
    } catch (renameError) {
      setCategoryError(
        renameError instanceof Error ? renameError.message : copy.errors.renameCategory,
      );
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(
        formatPostMutationRefreshError(copy.refreshErrors.categoryRenamed, refreshError),
      );
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
      setCategoryError(
        assignError instanceof Error ? assignError.message : copy.errors.assignCategory,
      );
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(
        formatPostMutationRefreshError(copy.refreshErrors.categoryUpdated, refreshError),
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
      setCategoryError(
        archiveError instanceof Error ? archiveError.message : copy.errors.archiveCategory,
      );
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(
        formatPostMutationRefreshError(copy.refreshErrors.categoryArchived, refreshError),
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
      setCategoryError(
        unarchiveError instanceof Error ? unarchiveError.message : copy.errors.unarchiveCategory,
      );
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setCategoryError(
        formatPostMutationRefreshError(copy.refreshErrors.categoryRestored, refreshError),
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
        icon: selectedSuperCategoryIcon,
        sortOrder: nextSortOrder,
      });
      setSuperCategoryName('');
      setSuperCategoryIconOverride(null);
      setShowSuperCategoryIcons(false);
    } catch (superCategoryError) {
      setSuperCategoryError(
        superCategoryError instanceof Error ? superCategoryError.message : copy.errors.createGroup,
      );
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setSuperCategoryError(
        formatPostMutationRefreshError(copy.refreshErrors.groupCreated, refreshError),
      );
    } finally {
      setSaving(false);
    }
  };

  const onRenameSuperCategory = async (superCategory: SuperCategory) => {
    // System super categories are shared by every household, so nobody edits them.
    if (superCategory.isSystem) {
      return;
    }
    setSuperCategoryRenameDialog({
      superCategory,
      nextIcon: superCategory.icon,
      nextName: superCategory.name,
    });
  };

  const submitRenameSuperCategory = async () => {
    if (!superCategoryRenameDialog) {
      return;
    }

    const nextName = superCategoryRenameDialog.nextName.trim();
    const unchanged =
      nextName === superCategoryRenameDialog.superCategory.name &&
      superCategoryRenameDialog.nextIcon === superCategoryRenameDialog.superCategory.icon;
    if (!nextName || unchanged) {
      setSuperCategoryRenameDialog(null);
      return;
    }

    try {
      setSaving(true);
      setSuperCategoryError(null);
      await updateSuperCategory(superCategoryRenameDialog.superCategory.id, {
        name: nextName,
        icon: superCategoryRenameDialog.nextIcon,
      });
      setSuperCategoryRenameDialog(null);
    } catch (renameError) {
      setSuperCategoryError(
        renameError instanceof Error ? renameError.message : copy.errors.renameGroup,
      );
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setSuperCategoryError(
        formatPostMutationRefreshError(copy.refreshErrors.groupRenamed, refreshError),
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
      setSuperCategoryError(
        archiveError instanceof Error ? archiveError.message : copy.errors.archiveGroup,
      );
      return;
    }

    try {
      await loadSettings();
    } catch (refreshError) {
      setSuperCategoryError(
        formatPostMutationRefreshError(copy.refreshErrors.groupArchived, refreshError),
      );
    } finally {
      setSaving(false);
    }
  };

  const getSuperCategoryToneClasses = (name: string) => {
    const normalizedName = name.toLowerCase();

    if (
      normalizedName.includes('hous') ||
      normalizedName.includes('rent') ||
      normalizedName.includes('home')
    ) {
      return 'bg-blue-100 text-blue-600';
    }
    if (
      normalizedName.includes('essent') ||
      normalizedName.includes('grocer') ||
      normalizedName.includes('shop')
    ) {
      return 'bg-emerald-100 text-emerald-600';
    }
    if (
      normalizedName.includes('mobil') ||
      normalizedName.includes('car') ||
      normalizedName.includes('transport')
    ) {
      return 'bg-orange-100 text-orange-600';
    }
    if (
      normalizedName.includes('lifest') ||
      normalizedName.includes('fun') ||
      normalizedName.includes('entertain')
    ) {
      return 'bg-pink-100 text-pink-600';
    }
    if (normalizedName.includes('financ') || normalizedName.includes('money')) {
      return 'bg-violet-100 text-violet-600';
    }

    return 'bg-slate-100 text-slate-600';
  };

  const getCategoryIconClasses = (category: Category) => {
    if (category.archivedAt) {
      return 'bg-stroke text-ink-soft';
    }
    return getSuperCategoryToneClasses(category.superCategoryName ?? '');
  };

  return (
    <AppShell
      compact
      mobileTitle={t(resolvedLocale).nav.settings}
      month={month}
      title={copy.shellTitle}
      subtitle={copy.shellSubtitle}
      locale={resolvedLocale}
    >
      {categoryRenameDialog ? (
        <ViewportModal onDismiss={() => (saving ? undefined : setCategoryRenameDialog(null))}>
          <DialogFrame title={copy.renameCategoryTitle}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitRenameCategory();
              }}
            >
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                {copy.renameCategoryBefore}
                <span className="font-semibold text-ink-strong">
                  {categoryRenameDialog.category.name}
                </span>
                {copy.renameCategoryAfter}
              </p>
              <label
                className="mt-4 block text-sm font-medium text-ink-base"
                htmlFor="rename-category-input"
              >
                {copy.categoryNameLabel}
              </label>
              <input
                autoFocus
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-ink-strong00 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                id="rename-category-input"
                onChange={(event) =>
                  setCategoryRenameDialog((current) =>
                    current ? { ...current, nextName: event.target.value } : current,
                  )
                }
                value={categoryRenameDialog.nextName}
              />
              <div className="mt-4">
                <CategoryIconPicker
                  iconLabels={copy.iconNames}
                  label={copy.iconLabel}
                  onChange={(nextIcon) =>
                    setCategoryRenameDialog((current) =>
                      current ? { ...current, nextIcon } : current,
                    )
                  }
                  onUseSuggestion={() =>
                    setCategoryRenameDialog((current) =>
                      current
                        ? { ...current, nextIcon: inferCategoryIcon(current.nextName) }
                        : current,
                    )
                  }
                  suggestedIcon={inferCategoryIcon(categoryRenameDialog.nextName)}
                  suggestionLabel={copy.suggestedIcon}
                  useSuggestionLabel={copy.useSuggestedIcon}
                  value={categoryRenameDialog.nextIcon}
                />
              </div>
              <DialogActions
                busy={saving}
                cancelLabel={shared.cancel}
                confirmLabel={saving ? shared.saving : copy.saveCategory}
                onCancel={() => setCategoryRenameDialog(null)}
              />
            </form>
          </DialogFrame>
        </ViewportModal>
      ) : null}

      {superCategoryRenameDialog ? (
        <ViewportModal onDismiss={() => (saving ? undefined : setSuperCategoryRenameDialog(null))}>
          <DialogFrame title={copy.renameGroupTitle}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitRenameSuperCategory();
              }}
            >
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                {copy.renameGroupBefore}
                <span className="font-semibold text-ink-strong">
                  {superCategoryRenameDialog.superCategory.name}
                </span>
                {copy.renameGroupAfter}
              </p>
              <label
                className="mt-4 block text-sm font-medium text-ink-base"
                htmlFor="rename-super-category-input"
              >
                {copy.groupNameLabel}
              </label>
              <input
                autoFocus
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-ink-strong00 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                id="rename-super-category-input"
                onChange={(event) =>
                  setSuperCategoryRenameDialog((current) =>
                    current ? { ...current, nextName: event.target.value } : current,
                  )
                }
                value={superCategoryRenameDialog.nextName}
              />
              <div className="mt-4">
                <CategoryIconPicker
                  iconLabels={copy.iconNames}
                  label={copy.iconLabel}
                  onChange={(nextIcon) =>
                    setSuperCategoryRenameDialog((current) =>
                      current ? { ...current, nextIcon } : current,
                    )
                  }
                  onUseSuggestion={() =>
                    setSuperCategoryRenameDialog((current) =>
                      current
                        ? { ...current, nextIcon: inferCategoryIcon(current.nextName) }
                        : current,
                    )
                  }
                  suggestedIcon={inferCategoryIcon(superCategoryRenameDialog.nextName)}
                  suggestionLabel={copy.suggestedIcon}
                  useSuggestionLabel={copy.useSuggestedIcon}
                  value={superCategoryRenameDialog.nextIcon}
                />
              </div>
              <DialogActions
                busy={saving}
                cancelLabel={shared.cancel}
                confirmLabel={saving ? shared.saving : copy.saveGroup}
                onCancel={() => setSuperCategoryRenameDialog(null)}
              />
            </form>
          </DialogFrame>
        </ViewportModal>
      ) : null}

      {superCategoryArchiveDialog ? (
        <ViewportModal onDismiss={() => (saving ? undefined : setSuperCategoryArchiveDialog(null))}>
          <DialogFrame title={copy.archiveGroupTitle}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitArchiveSuperCategory();
              }}
            >
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                {copy.archiveGroupBefore}
                <span className="font-semibold text-ink-strong">
                  {superCategoryArchiveDialog.superCategory.name}
                </span>
                {copy.archiveGroupAfter}
              </p>
              <label
                className="mt-4 block text-sm font-medium text-ink-base"
                htmlFor="archive-super-category-replacement"
              >
                {copy.moveCategoriesTo}
              </label>
              <select
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-ink-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                id="archive-super-category-replacement"
                onChange={(event) =>
                  setSuperCategoryArchiveDialog((current) =>
                    current
                      ? { ...current, replacementSuperCategoryId: event.target.value }
                      : current,
                  )
                }
                value={superCategoryArchiveDialog.replacementSuperCategoryId}
              >
                <option value="unassigned">{shared.unassigned}</option>
                {sortedActiveSuperCategories
                  .filter((entry) => entry.id !== superCategoryArchiveDialog.superCategory.id)
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
              </select>
              <DialogActions
                busy={saving}
                cancelLabel={shared.cancel}
                confirmLabel={saving ? shared.archiving : copy.archiveGroupTitle}
                onCancel={() => setSuperCategoryArchiveDialog(null)}
              />
            </form>
          </DialogFrame>
        </ViewportModal>
      ) : null}

      {categoryArchiveDialog ? (
        <ViewportModal onDismiss={() => (saving ? undefined : setCategoryArchiveDialog(null))}>
          <DialogFrame title={copy.archiveCategoryTitle}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitArchiveCategory();
              }}
            >
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                {copy.archiveCategoryBefore}
                <span className="font-semibold text-ink-strong">
                  {categoryArchiveDialog.category.name}
                </span>
                {copy.archiveCategoryAfter}
              </p>
              <DialogActions
                busy={saving}
                cancelLabel={shared.cancel}
                confirmLabel={saving ? shared.archiving : copy.archiveCategoryTitle}
                onCancel={() => setCategoryArchiveDialog(null)}
              />
            </form>
          </DialogFrame>
        </ViewportModal>
      ) : null}

      <SettingsTabs
        activeTab={activeTab}
        label={copy.settingsSectionsLabel}
        onChange={setActiveTab}
        tabs={settingsTabs}
      />

      <section
        aria-labelledby="settings-household-tab"
        className="mb-6"
        hidden={activeTab !== 'household'}
        id="settings-household-panel"
        role="tabpanel"
      >
        <div className="rounded-2xl border border-sky-300 bg-gradient-to-b from-sky-100 to-blue-100 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:p-6">
          <h2 className="text-lg font-semibold text-ink-strong">{copy.inviteSomeone}</h2>
          <p className="mt-1 text-xs text-ink-muted">{copy.inviteDescription}</p>
          <button
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={inviteLoading}
            onClick={() => void onCreateInviteCode()}
            type="button"
          >
            <span className="truncate">{inviteLoading ? copy.generating : copy.generateCode}</span>
          </button>
          {inviteCode ? (
            <div className="mt-3 rounded-lg border border-slate-300 bg-white/90 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft00">
                {copy.inviteCode}
              </p>
              <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-bold tracking-[0.15em] text-ink-strong">{inviteCode}</p>
                <button
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-ink-base hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  onClick={() => void onCopyInviteCode()}
                  type="button"
                >
                  {copy.copy}
                </button>
              </div>
              {inviteExpiresAt ? (
                <p className="mt-1 text-xs text-ink-soft00">
                  {copy.expires}:{' '}
                  {new Date(inviteExpiresAt).toLocaleString(localeTags[resolvedLocale])}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {isOnlyHouseholdMember ? (
          <div className="mt-4 rounded-2xl border border-stroke/80 bg-surface-soft p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-ink-strong">{copy.joinHousehold}</h2>
            <p className="mt-1 text-xs text-ink-muted">{copy.joinDescription}</p>
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => void onJoinHousehold(event)}
            >
              <label className="sr-only" htmlFor="join-household-code">
                {copy.inviteCode}
              </label>
              <input
                id="join-household-code"
                autoComplete="off"
                className="min-h-11 w-full rounded-md border border-stroke bg-surface px-3 py-2 text-sm text-ink-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder={copy.joinCodePlaceholder}
                value={joinCode}
              />
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-stroke bg-surface px-4 py-2.5 text-sm font-semibold text-ink-base shadow-sm hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:shrink-0"
                disabled={joinLoading}
                type="submit"
              >
                <span className="truncate">{joinLoading ? copy.joining : copy.joinAction}</span>
              </button>
            </form>
            {joinError ? (
              <div
                aria-live="assertive"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                {joinError}
              </div>
            ) : null}
          </div>
        ) : null}

        {inviteError ? (
          <div
            aria-live="assertive"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {inviteError}
          </div>
        ) : null}
        {inviteSuccess ? (
          <div
            aria-live="polite"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
          >
            {inviteSuccess}
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="settings-profile-tab"
        className="mb-6"
        hidden={activeTab !== 'profile'}
        id="settings-profile-panel"
        role="tabpanel"
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-ink-base" htmlFor="display-name">
                {copy.displayName}
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  className="min-w-0 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-medium text-ink-strong00 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  id="display-name"
                  onChange={(event) => setDisplayNameDraft(event.target.value)}
                  placeholder={copy.yourName}
                  value={displayNameDraft}
                />
              </div>
              <p className="mt-3 text-sm text-ink-soft00">{copy.displayNameHelp}</p>
            </div>

            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-base">{shared.email}</p>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-stroke bg-surface-muted px-4 py-3">
                <span className="min-w-0 truncate text-base font-medium text-ink-soft00">
                  {currentUserEmail ?? copy.emailUnavailable}
                </span>
                <svg
                  aria-hidden="true"
                  className="ml-3 h-6 w-6 shrink-0 text-ink-soft"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M5.5 8V6a4.5 4.5 0 1 1 9 0v2h.25A2.25 2.25 0 0 1 17 10.25v5.5A2.25 2.25 0 0 1 14.75 18h-9.5A2.25 2.25 0 0 1 3 15.75v-5.5A2.25 2.25 0 0 1 5.25 8h.25Zm7.5 0V6a3 3 0 1 0-6 0v2h6Z" />
                </svg>
              </div>
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="block text-sm font-medium text-ink-base" htmlFor="locale">
              {copy.language}
              <select
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-ink-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                id="locale"
                onChange={(event) => setLocaleDraft(event.target.value as AppLocale)}
                value={localeDraft}
              >
                {Object.entries(localeLabels).map(([locale, label]) => (
                  <option key={locale} value={locale}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-600 px-6 text-base font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              disabled={profileSaving || !currentUserId}
              onClick={() => void onUpdateDisplayName()}
              type="button"
            >
              <span className="truncate">{profileSaving ? copy.updating : copy.saveProfile}</span>
            </button>
          </div>
        </div>

        {profileError ? (
          <div
            aria-live="assertive"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {profileError}
          </div>
        ) : null}
        {profileSuccess ? (
          <div
            aria-live="polite"
            className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
          >
            {profileSuccess}
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="settings-security-tab"
        className="mb-6"
        hidden={activeTab !== 'security'}
        id="settings-security-panel"
        role="tabpanel"
      >
        <PasskeysCard
          configured={passkeysConfigured}
          initialPasskeys={initialPasskeys}
          locale={resolvedLocale}
        />

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink-strong">{copy.session}</h2>
              <p className="mt-1 text-sm text-ink-soft00">{copy.sessionHelp}</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <form action="/logout" className="w-full sm:w-auto" method="post">
                <button
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-ink-base hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto"
                  type="submit"
                >
                  {copy.logout}
                </button>
              </form>
              <form action="/logout" className="w-full sm:w-auto" method="post">
                <input name="scope" type="hidden" value="all" />
                <button
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 py-3 text-base font-semibold text-ink-soft underline decoration-slate-300 underline-offset-4 hover:text-ink-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 sm:w-auto"
                  type="submit"
                >
                  {copy.logoutEverywhere}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      <div
        aria-labelledby="settings-split-policy-tab"
        hidden={activeTab !== 'split-policy'}
        id="settings-split-policy-panel"
        role="tabpanel"
      >
        <SplitPolicyCard initialPolicy={initialSplitPolicy} locale={resolvedLocale} />
      </div>

      <section
        aria-label={`${copy.superCategories} — ${copy.detailedCategories}`}
        className={
          activeTab === 'categories'
            ? 'mb-6 overflow-hidden rounded-2xl border border-stroke bg-surface shadow-sm xl:grid xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,2.18fr)]'
            : 'hidden'
        }
        hidden={activeTab !== 'categories'}
        id="settings-categories-panel"
        role="tabpanel"
      >
        <div className="border-b border-stroke bg-brand-50 p-4 sm:p-5 xl:border-b-0 xl:border-r">
          <div>
            <h2
              className="text-xl font-semibold tracking-tight text-ink-strong"
              id="super-categories-heading"
            >
              {copy.superCategories}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              {copy.superCategoriesDescription}
            </p>
          </div>

          <form
            className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void onCreateSuperCategory();
            }}
          >
            <button
              aria-expanded={showSuperCategoryIcons}
              aria-label={copy.editIconAria(superCategoryName)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-ink-muted shadow-sm hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              onClick={() => setShowSuperCategoryIcons((current) => !current)}
              title={copy.editIconAria(superCategoryName)}
              type="button"
            >
              <CategoryIcon icon={selectedSuperCategoryIcon} />
            </button>
            <label className="sr-only" htmlFor="new-super-category">
              {copy.newSuperCategoryLabel}
            </label>
            <input
              id="new-super-category"
              className="h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-ink-base placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
              onChange={(event) => setSuperCategoryName(event.target.value)}
              placeholder={copy.newSuperCategoryPlaceholder}
              value={superCategoryName}
            />
            <button
              aria-label={shared.add}
              className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-brand-200 bg-white px-3 text-sm font-semibold text-brand-700 shadow-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              title={shared.add}
              type="submit"
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="hidden sm:inline xl:hidden 2xl:inline">{shared.add}</span>
            </button>
            {showSuperCategoryIcons ? (
              <div className="col-span-full rounded-xl border border-stroke bg-white p-3 shadow-sm">
                <CategoryIconPicker
                  iconLabels={copy.iconNames}
                  label={copy.iconLabel}
                  onChange={setSuperCategoryIconOverride}
                  onUseSuggestion={() => setSuperCategoryIconOverride(null)}
                  suggestedIcon={suggestedSuperCategoryIcon}
                  suggestionLabel={copy.suggestedIcon}
                  useSuggestionLabel={copy.useSuggestedIcon}
                  value={selectedSuperCategoryIcon}
                />
              </div>
            ) : null}
          </form>

          {superCategoryError ? (
            <div
              aria-live="assertive"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {superCategoryError}
            </div>
          ) : null}

          <ul className="mt-4 space-y-2">
            {sortedActiveSuperCategories.map((superCategory) => (
              <li
                key={superCategory.id}
                className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-stroke bg-white px-3 py-2 shadow-[0_1px_1px_rgba(15,23,42,0.03)] transition-colors hover:border-slate-300"
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${getSuperCategoryToneClasses(superCategory.name)}`}
                >
                  <CategoryIcon icon={superCategory.icon} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-strong sm:text-base">
                    {superCategory.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-medium text-ink-soft">
                    {superCategory.isSystem ? copy.system : copy.custom}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-0.5">
                  <span
                    aria-label={formatCountLabel(
                      resolvedLocale,
                      superCategory.categoryCount,
                      copy.categorySingular,
                      copy.categoryPlural,
                    )}
                    className="inline-flex min-w-8 items-center justify-center rounded-md border border-stroke bg-surface px-2 py-1 text-xs font-semibold tabular-nums text-ink-base"
                    title={formatCountLabel(
                      resolvedLocale,
                      superCategory.categoryCount,
                      copy.categorySingular,
                      copy.categoryPlural,
                    )}
                  >
                    {superCategory.categoryCount}
                  </span>

                  {!superCategory.isSystem ? (
                    <ActionButton
                      action="rename"
                      aria-label={copy.renameAria(superCategory.name)}
                      className="!h-11 !w-11 border-transparent !bg-transparent"
                      disabled={saving}
                      onClick={() => void onRenameSuperCategory(superCategory)}
                      size="icon"
                      title={copy.renameAria(superCategory.name)}
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
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </ActionButton>
                  ) : null}
                  {!superCategory.isSystem ? (
                    <ActionButton
                      action="archive"
                      aria-label={copy.archiveAria(superCategory.name)}
                      className="!h-11 !w-11 border-transparent !bg-transparent"
                      disabled={saving}
                      onClick={() => void onArchiveSuperCategory(superCategory)}
                      size="icon"
                      title={copy.archiveAria(superCategory.name)}
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
                        <path d="M3 7h18" />
                        <path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" />
                        <path d="M9 11h6" />
                        <path d="M9 3h6l1 4H8z" />
                      </svg>
                    </ActionButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 bg-surface">
          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2
                  className="text-xl font-semibold tracking-tight text-ink-strong"
                  id="detailed-categories-heading"
                >
                  {copy.detailedCategories}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  {copy.detailedCategoriesDescription}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
                {copy.unassignedBadge(unassignedCategoryCount)}
              </span>
            </div>

            <form
              className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(180px,220px)_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateCategory();
              }}
            >
              <div className="flex min-w-0 gap-2">
                <button
                  aria-expanded={showCategoryIcons}
                  aria-label={copy.editIconAria(categoryName)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-ink-muted shadow-sm hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  onClick={() => setShowCategoryIcons((current) => !current)}
                  title={copy.editIconAria(categoryName)}
                  type="button"
                >
                  <CategoryIcon icon={selectedCategoryIcon} />
                </button>
                <label className="sr-only" htmlFor="new-category-name">
                  {copy.categoryNameLabel}
                </label>
                <input
                  id="new-category-name"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-ink-base placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder={copy.categoryNamePlaceholder}
                  value={categoryName}
                />
              </div>
              <div>
                <label className="sr-only" htmlFor="new-category-super-category">
                  {copy.groupForNewCategory}
                </label>
                <select
                  id="new-category-super-category"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-ink-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                  onChange={(event) => setCategorySuperCategoryId(event.target.value)}
                  value={categorySuperCategoryId}
                >
                  <option value="unassigned">{shared.unassigned}</option>
                  {sortedActiveSuperCategories.map((superCategory) => (
                    <option key={superCategory.id} value={superCategory.id}>
                      {superCategory.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="inline-flex h-11 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving}
                type="submit"
              >
                {copy.addLabel}
              </button>
              {showCategoryIcons ? (
                <div className="rounded-xl border border-stroke bg-surface-muted/60 p-3 md:col-span-full">
                  <CategoryIconPicker
                    iconLabels={copy.iconNames}
                    label={copy.iconLabel}
                    onChange={setCategoryIconOverride}
                    onUseSuggestion={() => setCategoryIconOverride(null)}
                    suggestedIcon={suggestedCategoryIcon}
                    suggestionLabel={copy.suggestedIcon}
                    useSuggestionLabel={copy.useSuggestedIcon}
                    value={selectedCategoryIcon}
                  />
                </div>
              ) : null}
            </form>

            {categoryError ? (
              <div
                aria-live="assertive"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                {categoryError}
              </div>
            ) : null}
          </div>

          <div className="border-t border-stroke">
            <div className="hidden grid-cols-[minmax(180px,1fr)_minmax(140px,0.72fr)_minmax(170px,220px)_96px] gap-x-4 border-b border-stroke bg-surface-muted/60 px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-soft md:grid">
              <span>{copy.categorySingular}</span>
              <span>{copy.usageColumn}</span>
              <span>{copy.mappedToColumn}</span>
              <span className="text-right">{copy.actionsColumn}</span>
            </div>

            <div className="divide-y divide-stroke">
              {sortedCategories.map((category) => (
                <div
                  key={category.id}
                  className={
                    category.archivedAt
                      ? 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 bg-surface-muted/70 px-4 py-3 opacity-80 md:grid-cols-[minmax(180px,1fr)_minmax(140px,0.72fr)_minmax(170px,220px)_96px] md:items-center md:gap-x-4 md:px-5'
                      : 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 px-4 py-3 transition-colors hover:bg-surface-muted/50 md:grid-cols-[minmax(180px,1fr)_minmax(140px,0.72fr)_minmax(170px,220px)_96px] md:items-center md:gap-x-4 md:px-5'
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${getCategoryIconClasses(category)}`}
                    >
                      <CategoryIcon icon={category.icon} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink-strong sm:text-base">
                          {category.name}
                        </h3>
                        {category.archivedAt ? (
                          <span className="rounded-full border border-stroke bg-white px-2 py-0.5 text-xs font-semibold text-ink-muted">
                            {copy.archived}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink-soft md:hidden">
                        <span>
                          {formatCountLabel(
                            resolvedLocale,
                            category.expenseCount,
                            copy.expenseSingular,
                            copy.expensePlural,
                          )}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{copy.fixedCount(category.fixedExpenseCount)}</span>
                      </div>
                    </div>
                  </div>

                  <p className="hidden text-sm font-medium tabular-nums text-ink-muted md:block">
                    {formatCountLabel(
                      resolvedLocale,
                      category.expenseCount,
                      copy.expenseSingular,
                      copy.expensePlural,
                    )}
                    {' · '}
                    {copy.fixedCount(category.fixedExpenseCount)}
                  </p>

                  {!category.archivedAt ? (
                    <div className="relative col-span-2 md:col-span-1">
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2"
                      >
                        <CategoryIcon
                          className="h-4 w-4 text-ink-soft"
                          icon={
                            category.superCategoryId
                              ? (activeSuperCategoryById.get(category.superCategoryId)?.icon ??
                                'dots')
                              : 'dots'
                          }
                        />
                      </span>
                      <label className="sr-only" htmlFor={`group-${category.id}`}>
                        {copy.groupForCategory(category.name)}
                      </label>
                      <select
                        id={`group-${category.id}`}
                        className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm font-medium text-ink-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                        disabled={saving}
                        onChange={(event) => void onAssignCategory(category, event.target.value)}
                        value={category.superCategoryId ?? 'unassigned'}
                        aria-label={copy.groupForCategory(category.name)}
                      >
                        <option value="unassigned">{shared.unassigned}</option>
                        {sortedActiveSuperCategories.map((superCategory) => (
                          <option key={superCategory.id} value={superCategory.id}>
                            {superCategory.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="col-span-2 flex min-h-11 items-center text-sm font-medium text-ink-muted md:col-span-1">
                      {copy.groupValue(category.superCategoryName ?? shared.unassigned)}
                    </p>
                  )}

                  {!category.archivedAt ? (
                    <div className="col-start-2 row-start-1 flex shrink-0 items-center justify-end gap-1 md:col-start-4">
                      <ActionButton
                        action="rename"
                        aria-label={copy.renameAria(category.name)}
                        className="!h-11 !w-11 border-transparent !bg-transparent"
                        disabled={saving}
                        onClick={() => void onRenameCategory(category)}
                        size="icon"
                        title={copy.renameAria(category.name)}
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
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </ActionButton>
                      <ActionButton
                        action="archive"
                        aria-label={copy.archiveAria(category.name)}
                        className="!h-11 !w-11 border-transparent !bg-transparent"
                        disabled={saving}
                        onClick={() => void onArchiveCategory(category)}
                        size="icon"
                        title={copy.archiveAria(category.name)}
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
                          <path d="M3 7h18" />
                          <path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7" />
                          <path d="M9 11h6" />
                          <path d="M9 3h6l1 4H8z" />
                        </svg>
                      </ActionButton>
                    </div>
                  ) : (
                    <div className="col-start-2 row-start-1 flex shrink-0 items-center justify-end md:col-start-4">
                      <ActionButton
                        action="edit"
                        aria-label={copy.unarchiveAria(category.name)}
                        className="!h-11 !w-11 border-transparent !bg-transparent"
                        disabled={saving}
                        onClick={() => void onUnarchiveCategory(category)}
                        size="icon"
                        title={copy.unarchiveAria(category.name)}
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
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <path d="M7 10l5-5 5 5" />
                          <path d="M12 5v12" />
                        </svg>
                      </ActionButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
