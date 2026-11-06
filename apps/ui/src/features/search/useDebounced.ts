import { useEffect, useState } from "react";

/** Returns `value` once it has stopped changing for `delay` ms. */
export function useDebounced<T>(value: T, delay = 120): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
