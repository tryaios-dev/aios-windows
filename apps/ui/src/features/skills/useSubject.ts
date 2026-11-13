import { useCallback, useState } from 'react'

/**
 * A dialog about one thing. The thing stays in place while the dialog closes,
 * so its words do not vanish during the closing movement, and `run` counts
 * each opening so a dialog can start afresh every time.
 */
export function useSubject<T>() {
  const [state, setState] = useState<{ open: boolean; subject: T | null; run: number }>({ open: false, subject: null, run: 0 })
  const show = useCallback((subject: T) => setState((s) => ({ open: true, subject, run: s.run + 1 })), [])
  const setOpen = useCallback((open: boolean) => setState((s) => ({ ...s, open })), [])
  return { ...state, show, setOpen }
}
