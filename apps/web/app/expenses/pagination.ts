export const DEFAULT_MAX_ROWS_PER_SECTION = 10;
export const PREFETCH_CHUNK_MULTIPLIER = 4;
export const PREFETCH_CHUNK_MIN = 30;
export const PREFETCH_CHUNK_MAX = 100;
export const PREFETCH_AHEAD_PAGES = 1;
export const SECTION_CACHE_TTL_MS = 60_000;

export function getSectionFetchBatchSize(maxRowsPerSection: number): number {
  return Math.min(
    PREFETCH_CHUNK_MAX,
    Math.max(PREFETCH_CHUNK_MIN, maxRowsPerSection * PREFETCH_CHUNK_MULTIPLIER),
  );
}
