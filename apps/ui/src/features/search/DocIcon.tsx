import { File, FileSpreadsheet, FileText, Presentation } from 'lucide-react'

/** One small line icon for the kind of file a document is: "PDF", "Word", "Excel" and so on. */
export function DocIcon({ kind, className, strokeWidth = 1.75 }: { kind: string; className?: string; strokeWidth?: number }) {
  const props = { className, strokeWidth, 'aria-hidden': true }
  switch (kind) {
    case 'PDF':
    case 'Word':
    case 'Text':
    case 'Web page':
      return <FileText {...props} />
    case 'Excel':
    case 'Table':
      return <FileSpreadsheet {...props} />
    case 'PowerPoint':
      return <Presentation {...props} />
    default:
      return <File {...props} />
  }
}
