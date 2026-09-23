'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useExport(lockMs = 2000) {
  const [exporting, setExporting] = useState(false);
  const [locked, setLocked] = useState(false);
  const runningRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const run = useCallback(
    async (task: () => Promise<unknown> | void) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setExporting(true);
      try {
        await task();
      } finally {
        setExporting(false);
        setLocked(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setLocked(false);
          runningRef.current = false;
        }, lockMs);
      }
    },
    [lockMs]
  );

  const busy = exporting || locked;

  return { exporting, locked, busy, run } as const;
}