/**
 * The area inside the AIOS window. The title bar with its minimise, maximise and close buttons is the
 * operating system's own window frame (Electron), so nothing is drawn here: a second, drawn title bar
 * would only repeat it with buttons that do nothing.
 */
export function WindowFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col bg-paper">
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  )
}
