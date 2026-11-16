import { useMemo } from 'react'
import { create } from 'zustand'
import { useExtras } from '@/lib/extras'
import type { KnowledgeDoc } from '@/lib/types'

/**
 * Which documents from My secure knowledge a conversation is using, and which
 * ones each sent message was asked with. This lives in the interface only:
 * nothing is added to the message text and the conversation store is unchanged.
 * It lasts for the session, so the chips are still there after a look at another page.
 */
interface KnowledgeUseState {
  /** Conversation id to the ids of the documents it is using. The choice stays until the person changes it. */
  chosen: Record<string, string[]>
  /** Message id to the names of the documents it was asked with. Names, so a chip still reads if the document is later removed. */
  askedWith: Record<string, string[]>
  setChosen: (conversationId: string, ids: string[]) => void
  toggle: (conversationId: string, id: string) => void
  /** Note what a sent message was asked with. */
  recordSent: (messageId: string, names: string[]) => void
}

export const useKnowledgeUse = create<KnowledgeUseState>()((set) => ({
  chosen: {},
  askedWith: {},
  setChosen: (conversationId, ids) => set((s) => ({ chosen: { ...s.chosen, [conversationId]: ids } })),
  toggle: (conversationId, id) =>
    set((s) => {
      const now = s.chosen[conversationId] ?? []
      return { chosen: { ...s.chosen, [conversationId]: now.includes(id) ? now.filter((x) => x !== id) : [...now, id] } }
    }),
  recordSent: (messageId, names) => set((s) => (names.length ? { askedWith: { ...s.askedWith, [messageId]: names } } : s)),
}))

// The prototype's reset buttons start everything again, this included.
if (typeof window !== 'undefined') {
  window.addEventListener('aios:reset', () => useKnowledgeUse.setState({ chosen: {}, askedWith: {} }))
}

/** One stable empty list, so a selector never hands back a new array. */
const NONE: string[] = []

/**
 * The documents a conversation is using. Only documents AIOS has finished reading can be used,
 * so one that is removed or read again drops out of the choice by itself.
 */
export function useChosenDocuments(conversationId: string): { ready: KnowledgeDoc[]; chosen: KnowledgeDoc[]; total: number } {
  // The stored lists are selected as they are and narrowed here, never inside the selector.
  const knowledge = useExtras((s) => s.knowledge)
  const chosenIds = useKnowledgeUse((s) => s.chosen[conversationId] ?? NONE)
  return useMemo(() => {
    const ready = knowledge.filter((d) => d.status === 'ready')
    return { ready, chosen: ready.filter((d) => chosenIds.includes(d.id)), total: knowledge.length }
  }, [knowledge, chosenIds])
}

/**
 * My secure knowledge hands over "About “<document name>”: " for "Ask about this document".
 * Returns the document that text names, if it is in the library.
 */
export function documentNamedIn(text: string, docs: KnowledgeDoc[]): KnowledgeDoc | undefined {
  const opening = 'About “'
  if (!text.startsWith(opening)) return undefined
  const end = text.indexOf('”', opening.length)
  if (end < 0) return undefined
  const name = text.slice(opening.length, end).trim().toLowerCase()
  return name ? docs.find((d) => d.name.toLowerCase() === name) : undefined
}
