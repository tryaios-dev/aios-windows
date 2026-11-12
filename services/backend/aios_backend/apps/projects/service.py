"""Project rules: classification (M-04), the Company AI default (M-09) and Project Package v1.

Every change that the evidence log covers queues its event in the same transaction
(``db.outbox``). Event bodies hold ids, classes and counts only, never names.
"""

import json
import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from aios_backend.apps.projects import package
from aios_backend.apps.projects import repository as repo
from aios_backend.apps.projects.models import ProjectPackage
from aios_backend.apps.projects.schemas import (
    ExportOut,
    ImportOut,
    PackageRecordOut,
    ProjectOut,
    ReclassifyOut,
)
from aios_backend.config import APP_VERSION, Settings
from aios_backend.errors import AppError, not_found
from aios_common.canonical import sha256_hex, utc_time
from db.models import Conversation, Message, Project, Summary

CLASS_ORDER = {"restricted": 0, "internal": 1, "public": 2}
LABEL = {"restricted": "Restricted", "internal": "Internal", "public": "Public"}
UNTITLED = "Untitled project"
# chats.db status -> Project Package status, and back
STATUS_OUT = {"complete": "ok", "partial": "cancelled", "stopped": "cancelled", "error": "error"}
STATUS_IN = {"ok": "complete", "cancelled": "stopped", "error": "error"}


def _new_id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(UTC)


def is_lowering(current: str, to: str) -> bool:
    return CLASS_ORDER[to] > CLASS_ORDER[current]


def _get(session: Session, project_id: str) -> Project:
    project = repo.get_project(session, project_id)
    if project is None:
        raise not_found("project")
    return project


def list_projects(session: Session, archived: bool | None = None) -> list[Project]:
    return list(repo.list_projects(session, archived))


def get_project(session: Session, project_id: str) -> Project:
    return _get(session, project_id)


def create_project(session: Session, name: str, classification: str) -> Project:
    project = Project(
        id=_new_id(),
        name=name.strip() or UNTITLED,
        classification=classification,
        classification_source="project",
        company_ai_enabled=False,
        archived=False,
    )
    repo.add(session, project)
    repo.record_event(
        session,
        "project_created",
        project_id=project.id,
        body={"project_id": project.id, "classification": classification},
    )
    return project


def update_project(
    session: Session, project_id: str, name: str | None, archived: bool | None
) -> Project:
    project = _get(session, project_id)
    if name is not None:
        project.name = name.strip() or UNTITLED
    if archived is not None:
        project.archived = archived
    project.updated_at = _now()
    session.flush()
    return project


def delete_project(session: Session, project_id: str) -> None:
    project = _get(session, project_id)
    count = len(repo.conversations(session, project_id))
    repo.delete_project(session, project)
    repo.record_event(
        session,
        "project_deleted",
        project_id=project_id,
        body={"project_id": project_id, "conversations": count},
    )


def reclassify(session: Session, project_id: str, to: str) -> ReclassifyOut:
    original = _get(session, project_id)
    current = original.classification
    if current == to:
        return ReclassifyOut(project=ProjectOut.model_validate(original), reviewed_copy=False)

    if not is_lowering(current, to):
        # Raising is safe in place (question 4): a stricter class never under-protects, so every
        # conversation, message and summary of the project follows it.
        original.classification = to
        original.updated_at = _now()
        for conv in repo.conversations(session, project_id):
            conv.classification_effective = to
            for message in repo.messages(session, conv.id):
                message.classification_effective = to
            for summary in repo.summaries(session, conv.id):
                summary.classification_effective = to
        session.flush()
        repo.record_event(
            session,
            "project_reclassified",
            project_id=project_id,
            body={
                "project_id": project_id,
                "from_class": current,
                "to_class": to,
                "in_place": True,
            },
        )
        return ReclassifyOut(project=ProjectOut.model_validate(original), reviewed_copy=False)

    # Lowering: a reviewed copy with provenance; the original stays as it is.
    copy = Project(
        id=_new_id(),
        name=f"{original.name} ({LABEL[to]} copy)"[:200],
        description=original.description,
        classification=to,
        classification_source="review",
        derived_from_project_id=original.id,
        company_ai_enabled=False,
        archived=False,
    )
    repo.add(session, copy)
    convs = repo.conversations(session, project_id)
    for conv in convs:
        new_conv = Conversation(
            id=_new_id(),
            project_id=copy.id,
            title=conv.title,
            classification_effective=to,
            classification_source="review",
            provider_mode=conv.provider_mode,
            current_provider=conv.current_provider,
            model_id=conv.model_id,
            archived=conv.archived,
            last_message_preview=conv.last_message_preview,
        )
        repo.add(session, new_conv)
        id_map: dict[str, str] = {}
        for m in repo.messages(session, conv.id):
            id_map[m.id] = _new_id()
            repo.add(
                session,
                Message(
                    id=id_map[m.id],
                    conversation_id=new_conv.id,
                    position=m.position,
                    role=m.role,
                    content=m.content,
                    classification_effective=to,
                    classification_source="review",
                    status=m.status,
                    provider=m.provider,
                    model_id=m.model_id,
                    prompt_tokens=m.prompt_tokens,
                    completion_tokens=m.completion_tokens,
                    created_at=m.created_at,
                    previous_versions=m.previous_versions,
                ),
            )
        for s in repo.summaries(session, conv.id):
            repo.add(
                session,
                Summary(
                    id=_new_id(),
                    conversation_id=new_conv.id,
                    covers_until_message_id=id_map.get(
                        s.covers_until_message_id, s.covers_until_message_id
                    ),
                    content=s.content,
                    classification_effective=to,
                    classification_source="review",
                    model_id=s.model_id,
                    provider=s.provider,
                    created_at=s.created_at,
                ),
            )
    repo.record_event(
        session,
        "project_reclassified",
        project_id=copy.id,
        body={
            "project_id": copy.id,
            "from_class": current,
            "to_class": to,
            "derived_from_project_id": original.id,
            "reviewed_copy": True,
            "conversations": len(convs),
        },
    )
    return ReclassifyOut(project=ProjectOut.model_validate(copy), reviewed_copy=True)


def set_company_ai(
    session: Session, settings: Settings, project_id: str, enabled: bool, confirmed: bool
) -> Project:
    project = _get(session, project_id)
    if enabled and not settings.company_ai:
        raise AppError("company_provider_disabled", 409)
    if enabled and not confirmed:
        raise AppError("confirmation_required", 400)
    if project.company_ai_enabled == enabled:
        return project
    project.company_ai_enabled = enabled
    project.updated_at = _now()
    session.flush()
    repo.record_event(
        session,
        "provider_changed",
        project_id=project_id,
        body={
            "project_id": project_id,
            "scope": "project_default",
            "provider": "company" if enabled else "local",
            "enabled": enabled,
        },
    )
    return project


# ------------------------------------------------------------------ Project Package v1 (MVP 9.5)
def _package_model_id(model_id: str | None) -> str | None:
    """Model ids in packages follow the schema pattern; anything else is left out."""
    value = (model_id or "").lower().replace(":", "-")
    return value if package.MODEL_ID.fullmatch(value) else None


def _extensions(raw: str | None) -> dict[str, object]:
    try:
        value = json.loads(raw or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _with_kept_fields(item: dict[str, object], extensions: str | None) -> dict[str, object]:
    """Unknown fields kept from an import go back out unchanged; known fields always win."""
    kept = _extensions(extensions).get("fields")
    if isinstance(kept, dict):
        return {**{k: v for k, v in kept.items() if k not in item}, **item}
    return item


def _message_file(m: Message) -> dict[str, object]:
    data: dict[str, object] = {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "classification_effective": m.classification_effective,
        "classification_source": m.classification_source,
        "status": m.status,
        "created_at": utc_time(m.created_at),
    }
    if m.role == "assistant":
        data["provider"] = m.provider
        model = _package_model_id(m.model_id)
        if model:
            data["model_id"] = model
        data["prompt_tokens"] = m.prompt_tokens
        data["completion_tokens"] = m.completion_tokens
    return _with_kept_fields(data, m.extensions)


def _check_path(raw: str, suffix: str) -> Path:
    path = Path(raw)
    if not path.is_absolute() or path.suffix.lower() != suffix:
        raise AppError("invalid_path", 400)
    return path


def export_project(session: Session, project_id: str, raw_path: str, confirmed: bool) -> ExportOut:
    project = _get(session, project_id)
    if project.classification == "restricted" and not confirmed:
        raise AppError("confirmation_required", 400)
    path = _check_path(raw_path, ".aiosproj")
    if not path.parent.is_dir():
        raise AppError("invalid_path", 400)

    project_file = _with_kept_fields(
        {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "classification": project.classification,
            "classification_source": project.classification_source,
            "derived_from_project_id": project.derived_from_project_id,
            "created_at": utc_time(project.created_at),
            "updated_at": utc_time(project.updated_at),
        },
        project.extensions,
    )
    conv_files: list[dict[str, object]] = []
    summary_files: dict[str, list[dict[str, object]]] = {}
    model_ids: set[str] = set()
    message_count = 0
    for conv in repo.conversations(session, project.id):
        msgs = repo.messages(session, conv.id)
        message_count += len(msgs)
        model_ids |= {m.model_id for m in msgs if m.model_id}
        if conv.model_id:
            model_ids.add(conv.model_id)
        data: dict[str, object] = {
            "id": conv.id,
            "project_id": project.id,
            "title": conv.title,
            "classification_effective": conv.classification_effective,
            "classification_source": conv.classification_source,
            "created_at": utc_time(conv.created_at),
            "updated_at": utc_time(conv.updated_at),
            "messages": [_message_file(m) for m in msgs],
        }
        model = _package_model_id(conv.model_id)
        if model:
            data["model_id"] = model
        conv_files.append(_with_kept_fields(data, conv.extensions))
        summary_files[conv.id] = [
            _with_kept_fields(
                {
                    "id": s.id,
                    "covers_until_message_id": s.covers_until_message_id,
                    "content": s.content,
                    "classification_effective": s.classification_effective,
                    "classification_source": s.classification_source,
                    "model_id": s.model_id,
                    "provider": s.provider,
                    "created_at": utc_time(s.created_at),
                },
                s.extensions,
            )
            for s in repo.summaries(session, conv.id)
        ]
    models = []
    for model_id in sorted(model_ids):
        found = repo.model_reference(session, model_id)
        if found is not None:  # references only; model files never travel (MVP 9.5)
            models.append(
                {"catalogue_entry_id": found[0], "name": found[1], "artifact_digest": found[2]}
            )

    event_id = _new_id()
    built = package.build(
        project_file,
        conv_files,
        summary_files,
        models,
        APP_VERSION,
        exporting_stream_id=repo.stream_id(session),
        export_event_id=event_id,
    )

    # Atomic write: temp file in the same folder, flush, rename.
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(built.data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

    event = repo.record_event(
        session,
        "project_exported",
        project_id=project.id,
        body={
            "project_id": project.id,
            "package_id": built.package_id,
            "manifest_digest": built.manifest_digest,
        },
        event_id=event_id,
    )
    repo.add(
        session,
        ProjectPackage(
            project_id=project.id,
            direction="export",
            package_id=built.package_id,
            file_name=path.name[:255],
            size_bytes=len(built.data),
            checksum=built.checksum,
            conversations=len(conv_files),
            messages=message_count,
            summaries=sum(len(v) for v in summary_files.values()),
            evidence_outbox_id=event.id,
        ),
    )
    return ExportOut(
        file_name=path.name,
        path=str(path),
        size_bytes=len(built.data),
        checksum=built.checksum,
        package_id=built.package_id,
        evidence_seq=event.seq,
    )


def _parse_time(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)


def _kept(extra: dict[str, object], source: str, original_id: str | None) -> str:
    """The ``extensions`` of an imported item: its unknown fields, where its class came from in
    the exporting store, and its id there when it had to be given a new one."""
    data: dict[str, object] = {"imported_classification_source": source}
    if extra:
        data["fields"] = extra
    if original_id is not None:
        data["original_id"] = original_id
    return json.dumps(data, sort_keys=True, separators=(",", ":"))


def import_project(session: Session, raw_path: str) -> ImportOut:
    path = _check_path(raw_path, ".aiosproj")
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise AppError("file_not_readable", 400) from exc
    try:
        pkg = package.read(data)
    except package.PackageError as exc:
        if exc.code == "P_VERSION":  # "needs a newer version of AIOS" (MVP 9.5)
            raise AppError(f"p_version_{exc.required_version}", 422) from exc
        raise AppError(exc.code.lower(), 422) from exc  # nothing was imported

    # Identifiers travel unchanged (MVP 9.5). If any of them already exists here (the same package
    # imported twice, or a copy of a local project), every identifier gets a new value and the
    # original is kept in provenance (question 13): two independent projects, nothing shared.
    conv_ids = {c.id for c in pkg.conversations}
    item_ids = {m.id for c in pkg.conversations for m in c.messages}
    item_ids |= {s.id for group in pkg.summaries.values() for s in group}
    remap = repo.any_id_exists(session, pkg.project.id, conv_ids, item_ids)

    def new_id(original: str) -> str:
        return _new_id() if remap else original

    def original(value: str) -> str | None:
        return value if remap else None

    # All-or-nothing: everything below runs in the request's single transaction.
    seen_before = repo.imported_before(session, pkg.manifest.package_id)
    name = pkg.project.name
    renamed = repo.name_taken(session, name)
    if renamed:
        name = f"{name[:189]} (imported)"
    project = Project(
        id=new_id(pkg.project.id),
        name=name,
        description=pkg.project.description,
        classification=pkg.project.classification,  # imported unchanged, never lowered
        classification_source="import",
        derived_from_project_id=pkg.project.derived_from_project_id,
        imported_project_id=pkg.project.id,
        imported_package_id=pkg.manifest.package_id,
        company_ai_enabled=False,
        archived=False,
        created_at=_parse_time(pkg.project.created_at),
        extensions=_kept(pkg.project.extra, pkg.project.classification_source, None),
    )
    repo.add(session, project)

    default_model = repo.default_model_id(session)
    warnings: list[str] = [f"Skipped an unknown file: {name}" for name in pkg.skipped]
    if remap:
        warnings.append(
            "Some identifiers already existed here, so the project was imported with new ones."
        )
    messages = summaries = skipped_system = 0
    for conv in pkg.conversations:
        last_model = next(
            (m.model_id for m in reversed(conv.messages) if m.role == "assistant" and m.model_id),
            None,
        )
        new_conv = Conversation(
            id=new_id(conv.id),
            project_id=project.id,
            title=conv.title or "Untitled conversation",
            classification_effective=conv.classification_effective,
            classification_source="import",
            provider_mode="local",
            current_provider="local",
            model_id=default_model or conv.model_id or last_model,
            archived=False,
            created_at=_parse_time(conv.created_at),
            updated_at=_parse_time(conv.updated_at),
            extensions=_kept(conv.extra, conv.classification_source, original(conv.id)),
        )
        repo.add(session, new_conv)
        id_map: dict[str, str] = {}
        position = 0
        for m in conv.messages:
            if m.role == "system":
                skipped_system += 1
                continue
            id_map[m.id] = new_id(m.id)
            repo.add(
                session,
                Message(
                    id=id_map[m.id],
                    conversation_id=new_conv.id,
                    position=position,
                    role=m.role,
                    content=m.content,
                    classification_effective=m.classification_effective,
                    classification_source="import",
                    status=m.status,
                    provider="local" if m.role == "user" else (m.provider or "local"),
                    model_id=m.model_id,
                    prompt_tokens=m.prompt_tokens or 0,
                    completion_tokens=m.completion_tokens or 0,
                    created_at=_parse_time(m.created_at),
                    extensions=_kept(m.extra, m.classification_source, original(m.id)),
                ),
            )
            position += 1
            messages += 1
        if conv.messages:
            new_conv.last_message_preview = conv.messages[-1].content[:140]
        for s in pkg.summaries.get(conv.id, []):
            repo.add(
                session,
                Summary(
                    id=new_id(s.id),
                    conversation_id=new_conv.id,
                    covers_until_message_id=id_map.get(
                        s.covers_until_message_id, s.covers_until_message_id
                    ),
                    content=s.content,
                    classification_effective=s.classification_effective,
                    classification_source="import",
                    model_id=s.model_id,
                    provider=s.provider,
                    created_at=_parse_time(s.created_at),
                    extensions=_kept(s.extra, s.classification_source, original(s.id)),
                ),
            )
            summaries += 1
    if skipped_system:
        warnings.append(f"Skipped {skipped_system} system message(s); they are not stored.")
    if seen_before:
        warnings.append("This package was imported before; it was added again as a new project.")
    event = repo.record_event(
        session,
        "project_imported",
        project_id=project.id,
        body={
            "project_id": project.id,
            "package_id": pkg.manifest.package_id,
            "manifest_digest": pkg.manifest_digest,
        },
    )
    repo.add(
        session,
        ProjectPackage(
            project_id=project.id,
            direction="import",
            package_id=pkg.manifest.package_id,
            file_name=path.name[:255],
            size_bytes=len(data),
            checksum=sha256_hex(data),
            conversations=len(pkg.conversations),
            messages=messages,
            summaries=summaries,
            evidence_outbox_id=event.id,
        ),
    )
    return ImportOut(
        project_id=project.id,
        project_name=project.name,
        conversations=len(pkg.conversations),
        messages=messages,
        summaries=summaries,
        warnings=warnings,
        remapped=renamed or remap,
    )


def package_history(session: Session, project_id: str) -> list[PackageRecordOut]:
    """Packages written from or read into this project, newest first."""
    _get(session, project_id)
    return [PackageRecordOut.model_validate(p) for p in repo.packages(session, project_id)]
