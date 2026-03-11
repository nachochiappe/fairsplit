'use client';

import { createContext, ReactNode, useContext, useMemo, useState } from 'react';

interface MonthNavigationPendingContextValue {
  isPending: boolean;
  setIsPending: (nextValue: boolean) => void;
}

const MonthNavigationPendingContext = createContext<MonthNavigationPendingContextValue | null>(null);

export function MonthNavigationPendingProvider({ children }: { children: ReactNode }) {
  const [isPending, setIsPending] = useState(false);
  const value = useMemo(() => ({ isPending, setIsPending }), [isPending]);

  return <MonthNavigationPendingContext.Provider value={value}>{children}</MonthNavigationPendingContext.Provider>;
}

export function useMonthNavigationPending(): MonthNavigationPendingContextValue {
  const context = useContext(MonthNavigationPendingContext);

  if (!context) {
    return {
      isPending: false,
      setIsPending: () => {},
    };
  }

  return context;
}
