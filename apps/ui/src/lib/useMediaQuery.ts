import { useEffect, useState } from "react";

const matches = (query: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;

/** True when the media query matches. Re-evaluates on resize. */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setValue(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return value;
}

/** Breakpoints the shell responds to (design brief assumption A-08). */
export const BP = {
  /** Below this the sidebar becomes a rail. */
  rail: "(max-width: 1099px)",
  /** Below this the conversation list and the main pane take turns. */
  singleColumn: "(max-width: 900px)",
};
