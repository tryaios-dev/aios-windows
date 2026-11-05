"""Project Package v1 (contracts/project-package/v1/spec.md): build and read ``.aiosproj`` files.

Pure functions over bytes and plain dicts; no database. ``build`` writes exactly the layout of
section 3; ``read`` applies every rule of sections 5 and 6.1-6.3 and raises ``PackageError``
with the spec's code (``P_ZIP``, ``P_FORMAT``, ``P_CHECKSUM``, ``P_REFERENCE``, ``P_UNLISTED``,
``P_MISSING``) before anything is imported.
"""

import io
import json
import re
import stat
import uuid
import zipfile
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from aios_common.canonical import jcs, sha256_hex, tagged_hash, utc_time

MANIFEST = "manifest.json"
MANIFEST_TAG = "aios/project-package/v1/manifest"
MAX_ENTRIES = 100_000
MAX_TOTAL_BYTES = 2 * 1024**3
MAX_RATIO = 100

UUID = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
TIME = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
FILE_PATH = re.compile(
    r"project\.json|conversations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json"
)
MODEL_ID = re.compile(r"[a-z0-9][a-z0-9._-]{1,63}")

Classification = Literal["restricted", "internal", "public"]


class PackageError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


# ------------------------------------------------------------------ schemas (mirror the JSON schemas)
class _Open(BaseModel):
    model_config = ConfigDict(extra="allow")  # readers ignore unknown fields


class FileEntry(_Open):
    path: str = Field(pattern=FILE_PATH.pattern)
    size_bytes: int = Field(ge=0, le=MAX_TOTAL_BYTES)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class Counts(_Open):
    conversations: int = Field(ge=0)
    messages: int = Field(ge=0)


class Manifest(_Open):
    format: Literal["aios-project-package"]
    v: Literal[1]
    package_id: str = Field(pattern=UUID)
    created_at: str = Field(pattern=TIME)
    app_version: str = Field(min_length=1, max_length=64)
    project_id: str = Field(pattern=UUID)
    classification: Classification
    counts: Counts
    files: list[FileEntry] = Field(min_length=1, max_length=99_999)


class ProjectFile(_Open):
    id: str = Field(pattern=UUID)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(max_length=10_000)
    classification: Classification
    created_at: str = Field(pattern=TIME)
    updated_at: str = Field(pattern=TIME)


class MessageFile(_Open):
    id: str = Field(pattern=UUID)
    role: Literal["user", "assistant", "system"]
    content: str
    classification: Classification
    created_at: str = Field(pattern=TIME)
    provider: Literal["local", "company"] | None = None
    model_id: str | None = Field(default=None, pattern=MODEL_ID.pattern)
    status: Literal["ok", "cancelled", "error"] | None = None
    tokens_in: int | None = Field(default=None, ge=0)
    tokens_out: int | None = Field(default=None, ge=0)


class SummaryFile(_Open):
    id: str = Field(pattern=UUID)
    covers_to_message_id: str = Field(pattern=UUID)
    content: str
    classification: Classification
    created_at: str = Field(pattern=TIME)


class ConversationFile(_Open):
    id: str = Field(pattern=UUID)
    project_id: str = Field(pattern=UUID)
    title: str = Field(max_length=500)
    classification: Classification
    created_at: str = Field(pattern=TIME)
    updated_at: str = Field(pattern=TIME)
    messages: list[MessageFile]
    summaries: list[SummaryFile]


@dataclass
class Package:
    manifest: Manifest
    manifest_digest: str
    project: ProjectFile
    conversations: list[ConversationFile]


@dataclass
class Built:
    data: bytes
    package_id: str
    manifest_digest: str
    checksum: str  # SHA-256 of the whole file, shown to the user


# ------------------------------------------------------------------ writing
def _zip_info(name: str, method: int) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = method
    info.flag_bits |= 0x800  # UTF-8 names
    info.external_attr = (stat.S_IFREG | 0o644) << 16
    return info


def build(project: dict[str, Any], conversations: list[dict[str, Any]], app_version: str) -> Built:
    """``project`` and ``conversations`` are already in the file shapes of section 4."""
    files: dict[str, bytes] = {"project.json": jcs(project)}
    messages = 0
    for conv in conversations:
        files[f"conversations/{conv['id']}.json"] = jcs(conv)
        messages += len(conv["messages"])

    package_id = str(uuid.uuid4())
    manifest = {
        "format": "aios-project-package",
        "v": 1,
        "package_id": package_id,
        "created_at": utc_time(),
        "app_version": app_version,
        "project_id": project["id"],
        "classification": project["classification"],
        "counts": {"conversations": len(conversations), "messages": messages},
        "files": [
            {"path": path, "size_bytes": len(data), "sha256": sha256_hex(data)}
            for path, data in files.items()
        ],
    }
    manifest_bytes = jcs(manifest)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr(_zip_info(MANIFEST, zipfile.ZIP_STORED), manifest_bytes)  # first, stored
        for path, data in files.items():
            zf.writestr(_zip_info(path, zipfile.ZIP_DEFLATED), data)
    data = buffer.getvalue()
    return Built(
        data=data,
        package_id=package_id,
        manifest_digest=tagged_hash(MANIFEST_TAG, manifest_bytes),
        checksum=sha256_hex(data),
    )


# ------------------------------------------------------------------ reading
def _check_entry(info: zipfile.ZipInfo) -> None:
    if info.is_dir() or info.filename.endswith("/"):
        raise PackageError("P_ZIP")
    if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise PackageError("P_ZIP")
    if info.flag_bits & 0x1:  # encrypted
        raise PackageError("P_ZIP")
    mode = info.external_attr >> 16
    if mode and not stat.S_ISREG(mode):  # symlinks and other special files
        raise PackageError("P_ZIP")
    if info.filename != MANIFEST and not FILE_PATH.fullmatch(info.filename):
        raise PackageError("P_ZIP")  # covers .., /, \\, drive letters, control characters


def _read_limited(zf: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    """Inflate at most ``limit`` bytes; sizes are checked while reading, not trusted from headers."""
    with zf.open(info) as f:
        data = f.read(limit + 1)
    if len(data) > limit:
        raise PackageError("P_ZIP")
    if info.compress_size and len(data) > MAX_RATIO * info.compress_size:
        raise PackageError("P_ZIP")
    return data


def _canonical(data: bytes) -> Any:
    try:
        value = json.loads(data.decode("utf-8"))
        if jcs(value) != data:
            raise PackageError("P_FORMAT")
    except (UnicodeDecodeError, ValueError, TypeError) as exc:
        raise PackageError("P_FORMAT") from exc
    return value


def read(data: bytes) -> Package:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PackageError("P_ZIP") from exc
    with zf:
        infos = zf.infolist()
        if not infos or len(infos) > MAX_ENTRIES or infos[0].filename != MANIFEST:
            raise PackageError("P_ZIP")
        names = [i.filename for i in infos]
        folded = {n.casefold() for n in names}
        if len(folded) != len(names):
            raise PackageError("P_ZIP")
        for info in infos:
            _check_entry(info)

        # 1. manifest first, before any other entry is read
        manifest_bytes = _read_limited(zf, infos[0], 16 * 1024 * 1024)
        try:
            manifest = Manifest.model_validate(_canonical(manifest_bytes))
        except ValidationError as exc:
            raise PackageError("P_FORMAT") from exc

        listed = {f.path: f for f in manifest.files}
        present = set(names[1:])
        if present - listed.keys():
            raise PackageError("P_UNLISTED")
        if listed.keys() - present or "project.json" not in listed:
            raise PackageError("P_MISSING")

        # 2. sizes and checksums, then schema and canonical form
        total = len(manifest_bytes)
        contents: dict[str, bytes] = {}
        for info in infos[1:]:
            entry = listed[info.filename]
            total += entry.size_bytes
            if total > MAX_TOTAL_BYTES:
                raise PackageError("P_ZIP")
            body = _read_limited(zf, info, entry.size_bytes)
            if len(body) != entry.size_bytes or sha256_hex(body) != entry.sha256:
                raise PackageError("P_CHECKSUM")
            contents[info.filename] = body

    try:
        project = ProjectFile.model_validate(_canonical(contents.pop("project.json")))
        conversations = [
            ConversationFile.model_validate(_canonical(body)) for body in contents.values()
        ]
    except ValidationError as exc:
        raise PackageError("P_FORMAT") from exc

    # 3. referential checks
    if project.id != manifest.project_id:
        raise PackageError("P_REFERENCE")
    ids: set[str] = set()
    for conv in conversations:
        if conv.project_id != manifest.project_id:
            raise PackageError("P_REFERENCE")
        for item_id in [m.id for m in conv.messages] + [s.id for s in conv.summaries]:
            if item_id in ids:
                raise PackageError("P_REFERENCE")
            ids.add(item_id)

    return Package(
        manifest=manifest,
        manifest_digest=tagged_hash(MANIFEST_TAG, manifest_bytes),
        project=project,
        conversations=conversations,
    )
