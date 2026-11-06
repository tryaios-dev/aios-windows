import { useEffect, useState } from "react";

/** True when the media query matches. Re-evaluates on resize. */
export function useMediaQuery(query: string): boolean {
  // matchMedia is missing outside a browser (for example in the test DOM).
  const get = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Breakpoints the shell responds to (assumption A-08 in the design brief). */
export const BP = {
  /** Below this the sidebar becomes a rail. */
  rail: "(max-width: 1099px)",
  /** Below this the sidebar hides behind a top bar and the list/chat columns swap. */
  compact: "(max-width: 760px)",
  /** Below this the conversation list and the chat pane take turns. */
  singleColumn: "(max-width: 900px)",
};
