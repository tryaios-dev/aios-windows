/**
 * "Allow once" (Resources page): before anything goes to a linked cloud AI model, the person sees
 * what would be sent and where, and allows it, every time. The question lives in the store and is
 * shown by GlobalDialogs; the answer comes back here.
 */
import { useStore } from './store'

let pending: ((allowed: boolean) => void) | null = null

/** Ask the person; resolves true for "Allow once", false for "Stay on this computer". */
export function askAllowOnce(conversationId: string, again = false): Promise<boolean> {
  pending?.(false) // an older question that was never answered counts as no
  useStore.setState({ allowOnce: { conversation_id: conversationId, again } })
  return new Promise((resolve) => {
    pending = resolve
  })
}

export function answerAllowOnce(allowed: boolean): void {
  useStore.setState({ allowOnce: null })
  const resolve = pending
  pending = null
  resolve?.(allowed)
}
