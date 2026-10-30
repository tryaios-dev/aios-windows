import { useEffect, useRef, useState } from "react";

/**
 * Ticks through `durations` (ms per item) once on mount and reports how many
 * items are done. Pass `complete` to start finished (for example after Back).
 */
export function useSequence(durations: number[], complete = false) {
  const [done, setDone] = useState(complete ? durations.length : 0);
  const list = useRef(durations);
  useEffect(() => {
    if (complete) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      const wait = list.current[i];
      if (wait === undefined) return;
      timer = setTimeout(() => {
        i += 1;
        setDone(i);
        next();
      }, wait);
    };
    next();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [complete]);
  return { done, finished: done >= durations.length };
}
