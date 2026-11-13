import type { KnowledgeDoc } from '@/lib/types'

/**
 * Sample documents for My secure knowledge. All of it is made up. In the
 * real application these lists come from the file dialogs and from the
 * knowledge store; here they let the prototype show a believable library.
 */

const DAY = 86_400_000
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString()

/** What "Choose a folder" offers in the prototype, in place of the Windows folder dialog. */
export interface SampleFolder {
  path: string
  name: string
  files: Array<{ name: string; size_bytes: number; pages?: number }>
}

export const SAMPLE_FOLDERS: SampleFolder[] = [
  {
    path: 'C:\\Users\\you\\Documents\\Supplier quotes',
    name: 'Supplier quotes',
    files: [
      { name: 'Brightway Cleaning quote.pdf', size_bytes: 284_000, pages: 3 },
      { name: 'Harper & Lowe quote.pdf', size_bytes: 312_000, pages: 4 },
      { name: 'ClearView Services quote.pdf', size_bytes: 256_000, pages: 3 },
      { name: 'Quote comparison.xlsx', size_bytes: 48_000 },
      { name: 'Signed order form (scan).pdf', size_bytes: 2_140_000, pages: 2 },
    ],
  },
  {
    path: 'C:\\Users\\you\\Documents\\HR policies',
    name: 'HR policies',
    files: [
      { name: 'Annual leave policy.docx', size_bytes: 86_000, pages: 6 },
      { name: 'Expenses policy 2026.docx', size_bytes: 74_000, pages: 5 },
      { name: 'Code of conduct.pdf', size_bytes: 420_000, pages: 12 },
      { name: 'Working from home guide.pdf', size_bytes: 388_000, pages: 9 },
      { name: 'New starter checklist.docx', size_bytes: 52_000, pages: 2 },
      { name: 'Policy logos.zip', size_bytes: 5_600_000 },
    ],
  },
  {
    path: 'C:\\Users\\you\\Desktop\\Launch plan',
    name: 'Launch plan',
    files: [
      { name: 'Launch timeline.xlsx', size_bytes: 64_000 },
      { name: 'Press release draft.docx', size_bytes: 41_000, pages: 2 },
      { name: 'Launch deck.pptx', size_bytes: 3_800_000, pages: 22 },
      { name: 'Customer FAQ.md', size_bytes: 9_000 },
    ],
  },
]

/** What "Add files" picks in the prototype, in place of the Windows file dialog. Each press takes the next pair. */
export const SAMPLE_FILES: Array<{ name: string; size_bytes: number; pages?: number; origin: string }> = [
  { name: 'Board minutes November.pdf', size_bytes: 512_000, pages: 8, origin: 'C:\\Users\\you\\Downloads' },
  { name: 'Insurance renewal letter.pdf', size_bytes: 198_000, pages: 2, origin: 'C:\\Users\\you\\Downloads' },
  { name: 'Customer survey results.csv', size_bytes: 126_000, origin: 'C:\\Users\\you\\Documents' },
  { name: 'Office move plan.docx', size_bytes: 58_000, pages: 4, origin: 'C:\\Users\\you\\Documents' },
  { name: 'Photo of whiteboard.jpg', size_bytes: 2_900_000, origin: 'C:\\Users\\you\\Pictures' },
  { name: 'Year-end accounts summary.pdf', size_bytes: 1_240_000, pages: 16, origin: 'C:\\Users\\you\\Documents' },
]

/** The library a seeded prototype opens with. */
export const SEED_KNOWLEDGE: KnowledgeDoc[] = [
  { id: 'kd-lease', name: 'Harbourline lease draft v3.pdf', kind: 'PDF', size_bytes: 1_840_000, pages: 24, collection: 'Client contracts', origin: 'C:\\Users\\you\\Documents\\Client contracts', added_at: ago(9, 3), status: 'ready' },
  { id: 'kd-tender', name: 'Northgate tender response.docx', kind: 'Word', size_bytes: 412_000, pages: 18, collection: 'Client contracts', origin: 'C:\\Users\\you\\Documents\\Client contracts', added_at: ago(9, 3), status: 'ready' },
  { id: 'kd-policy', name: 'Insurance policy schedule.pdf', kind: 'PDF', size_bytes: 1_120_000, pages: 14, collection: 'Client contracts', origin: 'C:\\Users\\you\\Documents\\Client contracts', added_at: ago(9, 3), status: 'ready' },
  { id: 'kd-prices', name: 'Supplier price list 2026.xlsx', kind: 'Excel', size_bytes: 96_000, collection: 'Client contracts', origin: 'C:\\Users\\you\\Documents\\Client contracts', added_at: ago(9, 3), status: 'ready' },
  { id: 'kd-plan', name: 'Site plan (scan).pdf', kind: 'PDF', size_bytes: 3_420_000, pages: 1, collection: 'Client contracts', origin: 'C:\\Users\\you\\Documents\\Client contracts', added_at: ago(9, 3), status: 'failed', problem: 'This PDF is a scanned picture with no text in it, so there is nothing for AIOS to read yet.' },
  { id: 'kd-handbook', name: 'Staff handbook 2026.pdf', kind: 'PDF', size_bytes: 3_180_000, pages: 64, collection: 'Team handbook', origin: 'C:\\Users\\you\\Documents\\Team handbook', added_at: ago(6, 5), status: 'ready' },
  { id: 'kd-expenses', name: 'Expenses policy 2026.docx', kind: 'Word', size_bytes: 74_000, pages: 5, collection: 'Team handbook', origin: 'C:\\Users\\you\\Documents\\Team handbook', added_at: ago(6, 5), status: 'ready' },
  { id: 'kd-minutes', name: 'Board minutes October.pdf', kind: 'PDF', size_bytes: 540_000, pages: 9, collection: 'Added one by one', origin: 'C:\\Users\\you\\Downloads', added_at: ago(2, 1), status: 'ready' },
  { id: 'kd-notes', name: 'Planning meeting notes 14 Oct.md', kind: 'Text', size_bytes: 12_000, collection: 'Added one by one', origin: 'C:\\Users\\you\\Documents', added_at: ago(2, 1), status: 'ready' },
]

/** File endings AIOS can read, and how each is named on screen. */
const KINDS: Record<string, string> = {
  pdf: 'PDF',
  doc: 'Word',
  docx: 'Word',
  rtf: 'Word',
  xls: 'Excel',
  xlsx: 'Excel',
  csv: 'Table',
  ppt: 'PowerPoint',
  pptx: 'PowerPoint',
  txt: 'Text',
  md: 'Text',
  html: 'Web page',
  htm: 'Web page',
}

const PICTURES = new Set(['jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'bmp', 'tif', 'tiff'])

export function fileEnding(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** "PDF", "Word"... or "Picture" / "File" for things AIOS cannot read. */
export function kindOf(name: string): string {
  const e = fileEnding(name)
  return KINDS[e] ?? (PICTURES.has(e) ? 'Picture' : 'File')
}

/** Why a file cannot be read, in a sentence, or null when it can. */
export function unreadableReason(name: string): string | null {
  const e = fileEnding(name)
  if (KINDS[e]) {
    if (/\bscan(ned)?\b/i.test(name)) return 'This PDF is a scanned picture with no text in it, so there is nothing for AIOS to read yet.'
    return null
  }
  if (PICTURES.has(e)) return 'This is a picture. AIOS reads documents with text in them in this version.'
  if (e === 'zip' || e === '7z' || e === 'rar') return 'This is a zipped folder. Unzip it first, then add what is inside.'
  return 'AIOS cannot read this kind of file yet.'
}

export const READABLE_KINDS = 'PDF, Word, Excel, PowerPoint and text files'
