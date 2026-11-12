"""Project Package v1 (MVP 9.5; contracts/project-package/v1/spec.md): build and read ``.aiosproj``.

Pure functions over bytes and plain dicts; no database. Layout (MVP 9.5):

    manifest.json                         first entry, stored
    project.json
    conversations/<conversation_id>.json  messages inline
    summaries/<conversation_id>.json      that conversation's summaries
    models.json                           catalogue references only, never model files
    checksums.txt                         "<sha256>  <path>" per file, sorted by path

``manifest.checksums_sha256`` is the SHA-256 of ``checksums.txt``; any mismatch rejects the
import. Every project, conversation, message and summary carries ``classification_effective``
and ``classification_source``. Fields this version does not know are returned per item
(``extra``) so the importer can keep them and write them back on export. Files of an unknown type
are skipped with a warning. ``read`` raises ``PackageError`` with the spec's code (``P_ZIP``,
``P_FORMAT``, ``P_VERSION``, ``P_CHECKSUM``, ``P_REFERENCE``, ``P_UNLISTED``, ``P_MISSING``)
before anything is imported.
"""

import io
import json
import re
import stat
import uuid
import zipfile
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from aios_common.canonical import jcs, sha256_hex, tagged_hash, utc_time

PACKAGE_VERSION = 1
SCHEMA_VERSIONS = {"project": 1, "conversation": 1, "summaries": 1, "models": 1}
MANIFEST = "manifest.json"
CHECKSUMS = "checksums.txt"
MANIFEST_TAG = "aios/project-package/v1/manifest"
MAX_ENTRIES = 100_000
MAX_TOTAL_BYTES = 2 * 1024**3
MAX_RATIO = 100

UUID = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
_UUID = UUID[1:-1]
TIME = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
CONVERSATION_FILE = re.compile(rf"conversations/({_UUID})\.json")
SUMMARIES_FILE = re.compile(rf"summaries/({_UUID})\.json")
KNOWN_FILE = re.compile(rf"project\.json|models\.json|(conversations|summaries)/{_UUID}\.json")
# Any other entry must still be a plain, safe relative name; it is skipped with a warning.
SAFE_NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}){0,3}")
MODEL_ID = re.compile(r"[a-z0-9][a-z0-9._-]{1,63}")
CHECKSUM_LINE = re.compile(r"([0-9a-f]{64})  (\S+)")

Classification = Literal["restricted", "internal", "public"]
Source = Literal["project", "import", "review"]


class PackageError(Exception):
    def __init__(self, code: str, required_version: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.required_version = required_version


# ------------------------------------------------------------------ schemas (mirror the JSON schemas)
class _Open(BaseModel):
    """Readers keep unknown fields (MVP 9.5): ``extra`` holds them for the importer."""

    model_config = ConfigDict(extra="allow")

    @property
    def extra(self) -> dict[str, Any]:
        return dict(self.model_extra or {})


class Counts(_Open):
    conversations: int = Field(ge=0)
    messages: int = Field(ge=0)
    summaries: int = Field(default=0, ge=0)


class Manifest(_Open):
    format: Literal["aios-project-package"]
    v: int = Field(ge=1)  # package_version
    package_id: str = Field(pattern=UUID)
    created_at: str = Field(pattern=TIME)
    app_version: str = Field(min_length=1, max_length=64)
    project_id: str = Field(pattern=UUID)
    classification: Classification
    counts: Counts
    checksums_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    schema_versions: dict[str, int] | None = None
    exporting_stream_id: str | None = Field(default=None, pattern=UUID)
    export_event_id: str | None = Field(default=None, pattern=UUID)
    export_evidence_seq: int | None = Field(default=None, ge=0)


class ProjectFile(_Open):
    id: str = Field(pattern=UUID)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10_000)
    classification: Classification
    classification_source: Source = "project"
    derived_from_project_id: str | None = Field(default=None, pattern=UUID)
    created_at: str = Field(pattern=TIME)
    updated_at: str = Field(pattern=TIME)


class MessageFile(_Open):
    id: str = Field(pattern=UUID)
    role: Literal["user", "assistant", "system"]
    content: str
    classification_effective: Classification
    classification_source: Source = "project"
    created_at: str = Field(pattern=TIME)
    status: Literal["complete", "partial", "error", "stopped"] = "complete"
    provider: Literal["local", "company"] | None = None
    model_id: str | None = Field(default=None, pattern=MODEL_ID.pattern)
    prompt_tokens: int | None = Field(default=None, ge=0)
    completion_tokens: int | None = Field(default=None, ge=0)


class ConversationFile(_Open):
    id: str = Field(pattern=UUID)
    project_id: str = Field(pattern=UUID)
    title: str = Field(max_length=500)
    classification_effective: Classification
    classification_source: Source = "project"
    model_id: str | None = Field(default=None, pattern=MODEL_ID.pattern)
    created_at: str = Field(pattern=TIME)
    updated_at: str = Field(pattern=TIME)
    messages: list[MessageFile]


class SummaryFile(_Open):
    id: str = Field(pattern=UUID)
    covers_until_message_id: str = Field(pattern=UUID)
    content: str
    classification_effective: Classification
    classification_source: Source = "project"
    model_id: str = Field(max_length=100)
    provider: Literal["local", "company"]
    created_at: str = Field(pattern=TIME)


class SummariesFile(_Open):
    conversation_id: str = Field(pattern=UUID)
    summaries: list[SummaryFile]


class ModelReference(_Open):
    catalogue_entry_id: str = Field(max_length=64)
    name: str = Field(max_length=200)
    artifact_digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class ModelsFile(_Open):
    models: list[ModelReference]


@dataclass
class Package:
    manifest: Manifest
    manifest_digest: str
    project: ProjectFile
    conversations: list[ConversationFile]
    summaries: dict[str, list[SummaryFile]]  # by conversation id
    models: list[ModelReference]
    skipped: list[str] = field(default_factory=list)  # unknown files, not imported


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


def checksums_text(files: dict[str, bytes]) -> bytes:
    return "".join(f"{sha256_hex(files[p])}  {p}\n" for p in sorted(files)).encode()


def build(
    project: dict[str, Any],
    conversations: list[dict[str, Any]],
    summaries: dict[str, list[dict[str, Any]]],
    models: list[dict[str, Any]],
    app_version: str,
    *,
    exporting_stream_id: str | None = None,
    export_event_id: str | None = None,
    package_id: str | None = None,
    created_at: str | None = None,
) -> Built:
    """Every dict is already in its file shape (known fields plus kept unknown ones)."""
    files: dict[str, bytes] = {"project.json": jcs(project)}
    messages = 0
    for conv in conversations:
        files[f"conversations/{conv['id']}.json"] = jcs(conv)
        messages += len(conv["messages"])
    count_summaries = 0
    for conv_id, items in summaries.items():
        if items:
            files[f"summaries/{conv_id}.json"] = jcs(
                {"conversation_id": conv_id, "summaries": items}
            )
            count_summaries += len(items)
    files["models.json"] = jcs({"models": models})
    checksums = checksums_text(files)

    package_id = package_id or str(uuid.uuid4())
    manifest: dict[str, Any] = {
        "format": "aios-project-package",
        "v": PACKAGE_VERSION,
        "package_id": package_id,
        "created_at": created_at or utc_time(),
        "app_version": app_version,
        "schema_versions": SCHEMA_VERSIONS,
        "project_id": project["id"],
        "classification": project["classification"],
        "counts": {
            "conversations": len(conversations),
            "messages": messages,
            "summaries": count_summaries,
        },
        "checksums_sha256": sha256_hex(checksums),
    }
    if exporting_stream_id:
        manifest["exporting_stream_id"] = exporting_stream_id
    if export_event_id:
        manifest["export_event_id"] = export_event_id
    manifest_bytes = jcs(manifest)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        zf.writestr(_zip_info(MANIFEST, zipfile.ZIP_STORED), manifest_bytes)  # first, stored
        for path in sorted(files):
            zf.writestr(_zip_info(path, zipfile.ZIP_DEFLATED), files[path])
        zf.writestr(_zip_info(CHECKSUMS, zipfile.ZIP_DEFLATED), checksums)
    data = buffer.getvalue()
    return Built(
        data=data,
        package_id=package_id,
        manifest_digest=tagged_hash(MANIFEST_TAG, manifest_bytes),
        checksum=sha256_hex(data),
    )


# ------------------------------------------------------------------ reading
def _check_entry(info: zipfile.ZipInfo) -> None:
    name = info.filename
    if info.is_dir() or name.endswith("/"):
        raise PackageError("P_ZIP")
    if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
        raise PackageError("P_ZIP")
    if info.flag_bits & 0x1:  # encrypted
        raise PackageError("P_ZIP")
    # Symlinks and other special files. A file type of 0 means "not stated" (many ZIP tools).
    file_type = stat.S_IFMT(info.external_attr >> 16)
    if file_type and file_type != stat.S_IFREG:
        raise PackageError("P_ZIP")
    # covers .., /, \, drive letters, control characters
    if name not in (MANIFEST, CHECKSUMS) and not KNOWN_FILE.fullmatch(name):
        if ".." in name or not SAFE_NAME.fullmatch(name):
            raise PackageError("P_ZIP")


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


def _parse_checksums(data: bytes) -> dict[str, str]:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PackageError("P_FORMAT") from exc
    listed: dict[str, str] = {}
    for line in text.splitlines():
        match = CHECKSUM_LINE.fullmatch(line)
        if match is None or match.group(2) in listed:
            raise PackageError("P_FORMAT")
        listed[match.group(2)] = match.group(1)
    return listed


def read(data: bytes, supported_version: int = PACKAGE_VERSION) -> Package:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PackageError("P_ZIP") from exc
    with zf:
        infos = zf.infolist()
        if not infos or len(infos) > MAX_ENTRIES or infos[0].filename != MANIFEST:
            raise PackageError("P_ZIP")
        names = [i.filename for i in infos]
        if len({n.casefold() for n in names}) != len(names):
            raise PackageError("P_ZIP")
        for info in infos:
            _check_entry(info)

        # 1. manifest first, before any other entry is read; a newer package is refused
        manifest_bytes = _read_limited(zf, infos[0], 16 * 1024 * 1024)
        raw_manifest = _canonical(manifest_bytes)
        version = raw_manifest.get("v") if isinstance(raw_manifest, dict) else None
        if (
            isinstance(version, int)
            and not isinstance(version, bool)
            and version > supported_version
        ):
            raise PackageError("P_VERSION", required_version=version)
        try:
            manifest = Manifest.model_validate(raw_manifest)
        except ValidationError as exc:
            raise PackageError("P_FORMAT") from exc

        # 2. checksums.txt, then every listed file against it
        by_name = {i.filename: i for i in infos}
        if CHECKSUMS not in by_name:
            raise PackageError("P_MISSING")
        checksums_bytes = _read_limited(zf, by_name[CHECKSUMS], 64 * 1024 * 1024)
        if sha256_hex(checksums_bytes) != manifest.checksums_sha256:
            raise PackageError("P_CHECKSUM")
        listed = _parse_checksums(checksums_bytes)
        known_present = {n for n in names if KNOWN_FILE.fullmatch(n)}
        if known_present - listed.keys():
            raise PackageError("P_UNLISTED")
        missing = {p for p in listed if KNOWN_FILE.fullmatch(p)} - known_present
        if missing or "project.json" not in known_present:
            raise PackageError("P_MISSING")
        skipped = sorted(
            n for n in names if n not in known_present and n not in (MANIFEST, CHECKSUMS)
        )

        total = len(manifest_bytes) + len(checksums_bytes)
        contents: dict[str, bytes] = {}
        for name in sorted(known_present):
            info = by_name[name]
            body = _read_limited(zf, info, MAX_TOTAL_BYTES)
            total += len(body)
            if total > MAX_TOTAL_BYTES:
                raise PackageError("P_ZIP")
            if sha256_hex(body) != listed[name]:
                raise PackageError("P_CHECKSUM")
            contents[name] = body

    try:
        project = ProjectFile.model_validate(_canonical(contents.pop("project.json")))
        models = (
            ModelsFile.model_validate(_canonical(contents.pop("models.json"))).models
            if "models.json" in contents
            else []
        )
        conversations: list[ConversationFile] = []
        summaries: dict[str, list[SummaryFile]] = {}
        for name, body in contents.items():
            if (m := CONVERSATION_FILE.fullmatch(name)) is not None:
                conv = ConversationFile.model_validate(_canonical(body))
                if conv.id != m.group(1):
                    raise PackageError("P_REFERENCE")
                conversations.append(conv)
            elif (m := SUMMARIES_FILE.fullmatch(name)) is not None:
                group = SummariesFile.model_validate(_canonical(body))
                if group.conversation_id != m.group(1):
                    raise PackageError("P_REFERENCE")
                summaries[group.conversation_id] = group.summaries
    except ValidationError as exc:
        raise PackageError("P_FORMAT") from exc

    # 3. referential checks
    if project.id != manifest.project_id:
        raise PackageError("P_REFERENCE")
    conv_ids = {c.id for c in conversations}
    if len(conv_ids) != len(conversations) or not set(summaries) <= conv_ids:
        raise PackageError("P_REFERENCE")
    ids: set[str] = set()
    for conv in conversations:
        if conv.project_id != manifest.project_id:
            raise PackageError("P_REFERENCE")
        for item_id in [m.id for m in conv.messages] + [s.id for s in summaries.get(conv.id, [])]:
            if item_id in ids or item_id in conv_ids:
                raise PackageError("P_REFERENCE")
            ids.add(item_id)

    return Package(
        manifest=manifest,
        manifest_digest=tagged_hash(MANIFEST_TAG, manifest_bytes),
        project=project,
        conversations=conversations,
        summaries=summaries,
        models=models,
        skipped=skipped,
    )
