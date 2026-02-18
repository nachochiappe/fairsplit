import { getCategories, getSuperCategories } from '../../lib/api';
import { getCurrentMonth } from '../../lib/month';
import { SettingsClient } from './SettingsClient';

interface SettingsPageProps {
  searchParams?: Promise<{ month?: string }>;
}

const SERVER_READ_CACHE = { next: { revalidate: 15 } } as const;

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const resolvedSearchParams = await searchParams;
  const month = resolvedSearchParams?.month ?? getCurrentMonth();
  const [categories, superCategories] = await Promise.all([
    getCategories(SERVER_READ_CACHE),
    getSuperCategories(SERVER_READ_CACHE),
  ]);

  return <SettingsClient initialCategories={categories} initialSuperCategories={superCategories} month={month} />;
}
