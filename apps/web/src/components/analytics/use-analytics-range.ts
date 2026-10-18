'use client';

import { useCallback, useState } from 'react';
import type { AnalyticsQuery } from '@/lib/api';

/// Shared range state for the analytics views. Kept as a hook so every page
/// starts from the same default window and passes an identical query shape to
/// the API client.
export function useAnalyticsRange(initial: Partial<AnalyticsQuery> = {}) {
  const [query, setQuery] = useState<AnalyticsQuery>({ period: '30d', ...initial });

  const setFilter = useCallback((patch: Partial<AnalyticsQuery>) => {
    setQuery((current) => ({ ...current, ...patch }));
  }, []);

  return { query, setQuery, setFilter };
}
