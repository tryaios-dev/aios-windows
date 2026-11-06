import { useQuery } from "@tanstack/react-query";
import type { SearchHit } from "@/lib/types";
import { api } from "./api";
import { useStore } from "./sim/store";

const EMPTY: SearchHit[] = [];

/**
 * Message search (GET /search). Results refresh when messages change, so a new message shows
 * up while the search is open. Queries shorter than two characters return nothing.
 */
export function useSearch(q: string, enabled = true): SearchHit[] {
  const version = useStore((s) => s.messages.length + s.conversations.length);
  const { data } = useQuery({
    queryKey: ["search", q, version],
    queryFn: () => api.search(q),
    enabled: enabled && q.length >= 2,
    placeholderData: (previous) => previous,
  });
  return enabled && q.length >= 2 ? (data ?? EMPTY) : EMPTY;
}
