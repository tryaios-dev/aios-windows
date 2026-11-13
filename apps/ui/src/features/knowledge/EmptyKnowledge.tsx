import { useState } from 'react'
import { FilePlus2, FolderOpen } from 'lucide-react'
import { ART } from '@/assets/icons'
import { ArtTile } from '@/components/ui/art'
import { READABLE_KINDS } from '@/data/knowledge'
import { Button } from '@/components/ui/button'
import { StoreDrawing } from './KnowledgeArt'

/** Under the drawing: what each side of it is. The columns line up with the folder and the store. */
function DrawingCaptions() {
  return (
    <div className="grid grid-cols-[40%_1fr_44%] text-center text-xs leading-4.5 text-ink-soft">
      <span className="px-1">Your original stays where it is</span>
      <span />
      <span className="px-1">An encrypted copy, on this computer</span>
    </div>
  )
}

const FACTS: Array<{ icon: string; title: string; line: string }> = [
  { icon: ART.addDocument, title: 'Copied, never moved', line: 'AIOS keeps an encrypted copy on this computer. Your original files stay where they are.' },
  { icon: ART.encrypted, title: 'Encrypted on this computer', line: 'Only the copy is encrypted. Your originals are not changed, and nothing leaves this computer unless you say so.' },
  { icon: ART.conversation, title: 'Used only when you ask', line: 'AIOS reads each copy once so your AI can use it. Your AI looks at the parts that matter when you ask, and not before.' },
]

/**
 * A fresh AIOS with no documents yet. The drop area is the page: what to do,
 * the two buttons that do it from the keyboard, and a drawing of what happens
 * to a file. Three plain facts sit underneath.
 */
export function EmptyKnowledge({ onChooseFolder, onAddFiles }: { onChooseFolder: () => void; onAddFiles: () => void }) {
  const [near, setNear] = useState(false)
  return (
    <div className="@container flex flex-col gap-5">
      <section
        aria-labelledby="knowledge-start"
        onPointerEnter={() => setNear(true)}
        onPointerLeave={() => setNear(false)}
        onFocus={() => setNear(true)}
        onBlur={() => setNear(false)}
        className="grid items-center gap-x-10 gap-y-7 rounded-2xl border-[1.5px] border-dashed border-line-strong bg-white p-6 transition-colors duration-(--duration-panel) ease-(--ease-out) hover:border-green/60 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] @3xl:p-9"
      >
        <div className="min-w-0">
          <h2 id="knowledge-start" className="max-w-md font-display text-3xl leading-[1.15] text-ink">
            Add the documents you want your AI to know about.
          </h2>
          <p className="mt-3.5 max-w-md text-md leading-6 text-ink-soft">Drag files or a folder anywhere on this page, or choose them here. AIOS copies them in. Nothing is moved.</p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Button variant="primary" size="lg" leading={<FolderOpen className="size-4" />} onClick={onChooseFolder}>
              Choose a folder
            </Button>
            <Button size="lg" leading={<FilePlus2 className="size-4" />} onClick={onAddFiles}>
              Add files
            </Button>
          </div>
          <p className="mt-5 max-w-md text-sm leading-5 text-ink-50">You can add {READABLE_KINDS}. Scanned pages and pictures cannot be read in this version.</p>
        </div>

        <div className="dot-grid rounded-xl border border-line-soft bg-paper-raised px-4 pb-4 pt-3">
          <StoreDrawing playing={near} />
          <DrawingCaptions />
        </div>
      </section>

      <ul className="grid gap-3 @2xl:grid-cols-3">
        {FACTS.map((fact) => (
          <li key={fact.title} className="flex items-start gap-3.5 rounded-xl border border-line-soft bg-paper-raised p-4">
            <ArtTile src={fact.icon} />
            <div className="min-w-0">
              <h3 className="text-base font-medium leading-5.5 text-ink">{fact.title}</h3>
              <p className="mt-1 text-sm leading-5 text-ink-soft">{fact.line}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
