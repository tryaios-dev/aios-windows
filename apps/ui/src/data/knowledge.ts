/**
 * File kinds for My secure knowledge, in the words a person would use. No documents are listed here:
 * the library comes from the backend once My secure knowledge has one.
 */

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
  if (KINDS[e]) return null
  if (PICTURES.has(e)) return 'This is a picture. AIOS reads documents with text in them in this version.'
  if (e === 'zip' || e === '7z' || e === 'rar') return 'This is a zipped folder. Unzip it first, then add what is inside.'
  return 'AIOS cannot read this kind of file yet.'
}

export const READABLE_KINDS = 'PDF, Word, Excel, PowerPoint and text files'
