import { useEffect, useRef, useState } from 'react';

/**
 * Debounce a changing value (log filter text, #66) so large logs re-filter at
 * most once per pause in typing instead of on every keystroke. `delayMs` of 0
 * disables debouncing and returns the value as-is (still referentially stable
 * per render input).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value), delayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delayMs]);

  return debounced;
}
