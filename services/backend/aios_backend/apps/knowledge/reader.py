"""Read the text of a document (My secure knowledge). Offline, pure Python; nothing is logged.

Kinds and the reasons a file cannot be read use the words the UI shows
(``apps/ui/src/data/knowledge.ts``): PDF, Word, Excel, PowerPoint, text and web pages are read;
pictures, zipped folders and other files are kept in the list with the reason in a sentence.
"""

import csv
import html
import io
import re
from dataclasses import dataclass

KINDS = {
    "pdf": "PDF",
    "doc": "Word",
    "docx": "Word",
    "rtf": "Word",
    "xls": "Excel",
    "xlsx": "Excel",
    "csv": "Table",
    "ppt": "PowerPoint",
    "pptx": "PowerPoint",
    "txt": "Text",
    "md": "Text",
    "html": "Web page",
    "htm": "Web page",
}
PICTURES = {"jpg", "jpeg", "png", "gif", "heic", "webp", "bmp", "tif", "tiff"}
ARCHIVES = {"zip", "7z", "rar"}
MAX_BYTES = 50 * 1024 * 1024

PICTURE = "This is a picture. AIOS reads documents with text in them in this version."
ZIPPED = "This is a zipped folder. Unzip it first, then add what is inside."
UNKNOWN = "AIOS cannot read this kind of file yet."
TOO_LARGE = "This file is larger than 50 MB, so AIOS did not copy it."
NO_TEXT = (
    "This file has no text in it (it may be a scanned picture), so there is nothing for AIOS "
    "to read yet."
)
DAMAGED = "AIOS could not open this file. It may be damaged or protected with a password."
OLD_FORMAT = "This is an older {kind} format. Save it as {modern} from {kind}, then add it again."


class Unreadable(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Read:
    text: str
    pages: int | None = None


def ending(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def kind_of(name: str) -> str:
    e = ending(name)
    return KINDS.get(e) or ("Picture" if e in PICTURES else "File")


def reason_by_name(name: str, size_bytes: int = 0) -> str | None:
    """Why a file will not be read, judged from its name and size alone; None when it may be."""
    e = ending(name)
    if size_bytes > MAX_BYTES:
        return TOO_LARGE
    if e in PICTURES:
        return PICTURE
    if e in ARCHIVES:
        return ZIPPED
    if e not in KINDS:
        return UNKNOWN
    old = {"doc": ("Word", ".docx"), "xls": ("Excel", ".xlsx"), "ppt": ("PowerPoint", ".pptx")}
    if e in old:
        return OLD_FORMAT.format(kind=old[e][0], modern=old[e][1])
    return None


def read(name: str, data: bytes) -> Read:
    """The text of the file, or ``Unreadable`` with the reason in plain words."""
    e = ending(name)
    if e in PICTURES:
        raise Unreadable(PICTURE)
    if e in ARCHIVES:
        raise Unreadable(ZIPPED)
    if e not in KINDS:
        raise Unreadable(UNKNOWN)
    if e == "doc":
        raise Unreadable(OLD_FORMAT.format(kind="Word", modern=".docx"))
    if e == "xls":
        raise Unreadable(OLD_FORMAT.format(kind="Excel", modern=".xlsx"))
    if e == "ppt":
        raise Unreadable(OLD_FORMAT.format(kind="PowerPoint", modern=".pptx"))
    try:
        result = _READERS[e](data)
    except Unreadable:
        raise
    except Exception as exc:
        raise Unreadable(DAMAGED) from exc
    if not result.text.strip():
        raise Unreadable(NO_TEXT)
    return result


def _text(data: bytes) -> Read:
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return Read(data.decode(encoding))
        except UnicodeDecodeError:
            continue
    return Read(data.decode("utf-8", errors="replace"))


def _csv(data: bytes) -> Read:
    rows = csv.reader(io.StringIO(_text(data).text))
    return Read("\n".join(", ".join(cell for cell in row) for row in rows))


def _html(data: bytes) -> Read:
    raw = _text(data).text
    raw = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return Read(re.sub(r"[ \t]+", " ", html.unescape(raw)).strip())


def _rtf(data: bytes) -> Read:
    raw = _text(data).text
    raw = re.sub(r"\\par[d]?", "\n", raw)
    raw = re.sub(r"\\'[0-9a-fA-F]{2}|\\[a-zA-Z]+-?\d* ?|[{}]", "", raw)
    return Read(raw.strip())


def _pdf(data: bytes) -> Read:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise Unreadable(DAMAGED)
    pages = [page.extract_text() or "" for page in reader.pages]
    return Read("\n\n".join(pages), pages=len(reader.pages))


def _docx(data: bytes) -> Read:
    import docx

    document = docx.Document(io.BytesIO(data))
    parts = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return Read("\n".join(parts))


def _xlsx(data: bytes) -> Read:
    import openpyxl

    book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts = []
    for sheet in book.worksheets:
        parts.append(f"Sheet: {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in row]
            if any(cells):
                parts.append(", ".join(cells))
    book.close()
    return Read("\n".join(parts))


def _pptx(data: bytes) -> Read:
    import pptx

    deck = pptx.Presentation(io.BytesIO(data))
    parts = []
    for number, slide in enumerate(deck.slides, start=1):
        parts.append(f"Slide {number}")
        for shape in slide.shapes:
            if shape.has_text_frame:
                parts.append(shape.text_frame.text)
    return Read("\n".join(parts), pages=len(deck.slides))


_READERS = {
    "pdf": _pdf,
    "docx": _docx,
    "rtf": _rtf,
    "xlsx": _xlsx,
    "csv": _csv,
    "pptx": _pptx,
    "txt": _text,
    "md": _text,
    "html": _html,
    "htm": _html,
}
