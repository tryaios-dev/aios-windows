"""``aios-backend`` - developer commands.

    uv run aios-backend serve                     # API on http://127.0.0.1:8765 (/health, /docs)
    uv run aios-backend migrate | downgrade -1 | showmigrations | check
    uv run aios-backend makemigrations -m "add tags"
    uv run aios-backend sql "SELECT * FROM settings" | reset-db --yes
    uv run aios-backend routes | openapi [--check]
    uv run aios-backend serve-e2e --data DIR      # end-to-end tests only (token over stdin)
    uv run aios-backend company set               # DeepSeek; asks for the key (--url, --model)
    uv run aios-backend company key | check | clear   # Company provider (G-06)

Works on the dev profile (services/backend/.dev/) or the test profile, never on the desktop
profile: real user data is only touched by backend.exe itself. The one exception is ``company``:
it writes the Company server's address (company.json, no key) and puts the API key in the OS key
store, for the profile the app uses (default desktop). It never opens chats.db.
"""

import argparse
import asyncio
import contextlib
import getpass
import json
import secrets
import sys
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import text

from aios_backend import company
from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.config import Profile, Settings, company_file, load
from db import migrate
from db.session import Database

ROOT = Path(__file__).resolve().parents[3]
OPENAPI_FILE = ROOT / "contracts" / "local-api" / "openapi.json"


def _db(args: argparse.Namespace) -> Database:
    return Database(load(args.profile))


# ------------------------------------------------------------------ database
def cmd_migrate(args: argparse.Namespace) -> int:
    db = _db(args)
    migrate.upgrade(db, args.revision)
    print(f"{db.settings.chats_db}: at {migrate.current(db)}")
    return 0


def cmd_downgrade(args: argparse.Namespace) -> int:
    db = _db(args)
    migrate.downgrade(db, args.revision)
    print(f"{db.settings.chats_db}: at {migrate.current(db) or 'base (empty)'}")
    return 0


def cmd_makemigrations(args: argparse.Namespace) -> int:
    db = _db(args)
    if migrate.pending(db):
        print("database is not at head: run `aios-backend migrate` first", file=sys.stderr)
        return 1
    migrate.make_migration(db, args.message, autogenerate=not args.empty)
    print("new file in services/backend/db/migrations/versions/ - review it")
    return 0


def cmd_showmigrations(args: argparse.Namespace) -> int:
    current = migrate.current(_db(args))
    applied = current is not None
    for line in migrate.history():
        print(f"{'[X]' if applied else '[ ]'} {line}")
        if line.split()[0] == current:
            applied = False
    return 0


def cmd_rebuild_search(args: argparse.Namespace) -> int:
    from db import search_index

    count = search_index.rebuild(_db(args))
    print(f"search index rebuilt from {count} message(s)")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    db = _db(args)
    print(f"profile   {db.settings.profile}")
    print(f"database  {db.settings.chats_db}")
    with db.engine.connect() as conn:
        cipher = conn.execute(text("PRAGMA cipher_version")).scalar()
    print(f"sqlcipher {cipher}")
    current, head = migrate.current(db), migrate.head()
    print(f"migration {current} (head {head})")
    if current != head:
        print("NOT at head: run `aios-backend migrate`", file=sys.stderr)
        return 1
    migrate.check(db)  # raises if models changed without a migration
    print("models    in sync with migrations")
    return 0


def cmd_reset_db(args: argparse.Namespace) -> int:
    settings = load(args.profile)
    if not args.yes:
        print(f"this deletes {settings.chats_db}; add --yes to confirm", file=sys.stderr)
        return 1
    settings.chats_db.unlink(missing_ok=True)
    print(f"deleted {settings.chats_db}; run `aios-backend migrate` to recreate it")
    return 0


def cmd_sql(args: argparse.Namespace) -> int:
    with _db(args).engine.begin() as conn:
        result = conn.execute(text(args.query))
        if result.returns_rows:
            print(" | ".join(result.keys()))
            for row in result:
                print(" | ".join(str(v) for v in row))
        else:
            print(f"{result.rowcount} row(s) affected")
    return 0


# ------------------------------------------------------------------ server and API
def cmd_serve(args: argparse.Namespace) -> int:
    from aios_backend.__main__ import serve
    from aios_backend.main import configure_logging
    from aios_common.handshake import set_token_for_tests

    settings = load(Profile.DEV)
    token = secrets.token_urlsafe(32)  # dev only; backend.exe gets its token over stdin
    set_token_for_tests(token)
    configure_logging(settings)
    db = Database(settings)
    migrate.upgrade(db)

    base = f"http://127.0.0.1:{args.port}"
    print(f"API      {base}   (dev profile, database {settings.chats_db})")
    print(f"browser  {base}/health   {base}/docs")
    print(f"token    Authorization: Bearer {token}")
    asyncio.run(serve(settings, db, args.port))
    return 0


class EchoAnswers:
    """End-to-end tests only (``serve-e2e --echo``): answers by repeating the question, so chat,
    evidence and search can be tested before the local engine exists. Never used by backend.exe.
    The model id ``e2e-removed`` stands for an AI model that is no longer installed."""

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        if provider != "local" or model_id == "e2e-removed":
            return None
        return ModelInfo(model_id=model_id or "e2e-echo", context_length=4096, runtime="e2e-echo")

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        question = messages[-1]["content"] if messages else ""
        yield "You said: "
        yield question


def cmd_serve_e2e(args: argparse.Namespace) -> int:
    """Throw-away backend for end-to-end tests: test profile (fixed test keys, no keystore) in
    ``--data``, launch token over stdin and a READY line, exactly like backend.exe."""
    import dataclasses

    from aios_backend.__main__ import serve
    from aios_backend.main import configure_logging
    from aios_common.handshake import read_handshake

    hs = read_handshake()
    data = Path(args.data).resolve()
    settings = dataclasses.replace(
        load(Profile.TEST),
        chats_db=data / "chats.db",
        backups_dir=data / "backups",
        recovery_pkg=data / "recovery.pkg",
        models_dir=data / "models",
        log_file=data / "logs" / "backend.log",  # Settings > Health makes a support bundle of it
    )
    data.mkdir(parents=True, exist_ok=True)
    configure_logging(settings)  # content-free, as in backend.exe
    db = Database(settings)
    migrate.upgrade(db)
    answers = EchoAnswers() if args.echo else None
    asyncio.run(serve(settings, db, hs.api_port, answers=answers, local=False))
    return 0


def openapi_schema() -> str:
    from aios_backend.main import create_app

    app = create_app(load(Profile.DEV))
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


def cmd_openapi(args: argparse.Namespace) -> int:
    schema = openapi_schema()
    if args.check:
        if not OPENAPI_FILE.exists() or OPENAPI_FILE.read_text("utf-8") != schema:
            print("contracts/local-api/openapi.json is out of date: run `aios-backend openapi`")
            return 1
        print("openapi.json up to date")
        return 0
    OPENAPI_FILE.parent.mkdir(parents=True, exist_ok=True)
    OPENAPI_FILE.write_text(schema, "utf-8")
    print(f"wrote {OPENAPI_FILE.relative_to(ROOT)}")
    return 0


def cmd_routes(args: argparse.Namespace) -> int:
    from aios_backend.main import create_app

    for path, ops in create_app(load(Profile.DEV)).openapi().get("paths", {}).items():
        for method, op in ops.items():
            print(f"{method.upper():7} {path:30} {op.get('summary', '')}")
    return 0


# ------------------------------------------------------------------ parser
# ------------------------------------------------------------------ Company AI server (G-06)
def _company_file(profile: str) -> Path:
    path = company_file(Profile(profile))
    if path is None:
        raise SystemExit("the test profile has no Company provider")
    return path


def company_models(settings: Settings) -> company.CompanyModels:
    return company.CompanyModels(settings)


def _typed_or_piped_key() -> str:
    """The key from stdin, or typed without echo. Never an argument, an environment variable or
    a file AIOS reads (invariant 3)."""
    if sys.stdin.isatty():
        value = getpass.getpass("API key of the Company AI server (not shown): ")
    else:
        value = sys.stdin.readline()
    # Windows PowerShell 5.1 puts a byte-order mark in front of text it pipes to a program.
    return value.strip().lstrip("\ufeff").strip()


def cmd_company_set(args: argparse.Namespace) -> int:
    """Configure the Company server (G-06) in company.json. The key is typed, not shown, and goes
    to the key store only: never an argument, an environment variable or a file (FR-30)."""
    if not company.valid_url(args.url):
        print(
            "The address must be https:// with a DNS name, port 443 and no user name or password."
        )
        return 2
    model = args.model.strip()
    if not company.valid_model_name(model):
        print("The model name may hold letters, digits and . _ : + - only (no spaces or /).")
        return 2
    key = getpass.getpass("API key (it is not shown while you type): ").strip()
    if not company.valid_key(key):
        print("No usable key entered (16-512 printable characters, no spaces); nothing changed.")
        return 2
    company.store_key(key)
    path = _company_file(args.profile)
    config = company.CompanyConfig(company.server_url(args.url) or args.url, model, args.context)
    company.save_config(path, config)
    print(f"Company server saved: {config.base_url} (model {config.model_name}).")
    # Enough to spot a key pasted twice or cut short, never the key itself.
    print(f"Key saved in the key store of this computer: {len(key)} characters, ends ...{key[-4:]}")
    if args.check:
        return cmd_company_check(args)
    print("AIOS uses it within a few seconds; turn on Company AI in a project's settings.")
    return 0


def cmd_company_key(args: argparse.Namespace) -> int:
    """Store the company server's API key in the OS key store (invariant 3). The key is read
    from stdin or typed without echo, never taken as an argument, and never printed."""
    value = _typed_or_piped_key()
    if not company.valid_key(value):
        print("refused: the key must be 16-512 printable characters, no spaces", file=sys.stderr)
        return 1
    company.store_key(value)
    print(f"stored in the OS key store (service AIOS, entry {company.KEY_NAME})")
    return 0


def cmd_resource_key(args: argparse.Namespace) -> int:
    """Store the API key for a linkable resource on this computer (operator, invariant 3): the
    person then only presses Link. Checked with the provider first; never printed."""
    from aios_backend import linked, linked_config

    if args.id not in linked_config.RESOURCES:
        print(f"unknown resource: {args.id} (known: {', '.join(linked_config.RESOURCES)})")
        return 1
    value = _typed_or_piped_key()
    if not linked_config.valid_key(value):
        print("refused: the key must be 16-512 printable characters, no spaces", file=sys.stderr)
        return 1
    if not args.check:
        problem = None
    else:
        problem = linked.check(args.id, value)
    if problem is not None:
        print(f"not stored: {problem} (resource_key_rejected = wrong key)", file=sys.stderr)
        return 1
    linked_config.store_provisioned(args.id, value)
    print(
        f"stored for {linked_config.NAMES.get(args.id, args.id)}: {len(value)} characters, "
        f"ends ...{value[-4:]}. In AIOS: Add resources to my AI, press Link."
    )
    return 0


def cmd_resource_clear(args: argparse.Namespace) -> int:
    """Remove the operator's key for a resource (a link the person made keeps its own key)."""
    from aios_backend import linked_config

    linked_config.remove_provisioned(args.id)
    print(f"removed the stored key for {args.id}")
    return 0


HINTS = {
    "company_key_missing": "no key in the key store: run aios-backend company key",
    "company_key_rejected": "the server refused the key: store the current one again",
    "company_model_not_listed": "the server does not offer this model name",
    "company_unreachable": "no answer from the server (address, network or server down)",
}


def cmd_company_check(args: argparse.Namespace) -> int:
    """Is the Company AI server set up and answering? Asks its model list (no answer is
    generated, so it costs nothing) and prints the reason when it is not."""
    settings = load(args.profile)
    if not settings.company_ai:
        print(
            "Company AI is off: no valid operator.json or company.json "
            "(run aios-backend company set, or see docs/operations/company-server.md)"
        )
        return 2
    source = "company.json" if settings.company_file is not None else "operator.json"
    models = company_models(settings)
    info = models.recheck()
    if info is None:
        code = models.last_error or "company_unreachable"
        hint = HINTS.get(code, "")
        print(f"not reachable: {settings.company_base_url}  ({code}{': ' + hint if hint else ''})")
        return 1
    print(
        f"reachable: {settings.company_base_url}  model {info.model_id}  "
        f"context {info.context_length} tokens  (from {source})"
    )
    return 0


def cmd_company_clear(args: argparse.Namespace) -> int:
    path = _company_file(args.profile)
    path.unlink(missing_ok=True)
    with contextlib.suppress(Exception):  # no key stored
        company.delete_secret(company.KEY_NAME)
    print("Company server and key removed (operator.json, if any, is left as it is).")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aios-backend", description="Backend developer commands.")
    parser.add_argument(
        "--profile",
        choices=[Profile.DEV.value, Profile.TEST.value],
        default=None,
        help="database to use (default: $AIOS_ENV, else dev)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("migrate", help="apply migrations (backs up chats.db first)")
    p.add_argument("revision", nargs="?", default="head")
    p.set_defaults(func=cmd_migrate)

    p = sub.add_parser("downgrade", help="roll back to a revision, e.g. -1, 0001 or base")
    p.add_argument("revision")
    p.set_defaults(func=cmd_downgrade)

    p = sub.add_parser("makemigrations", help="write the next numbered migration from models")
    p.add_argument("-m", "--message", required=True)
    p.add_argument("--empty", action="store_true", help="blank migration for hand-written SQL")
    p.set_defaults(func=cmd_makemigrations)

    sub.add_parser("showmigrations", help="list migrations, [X] = applied").set_defaults(
        func=cmd_showmigrations
    )
    sub.add_parser("check", help="DB opens, at head, models match migrations").set_defaults(
        func=cmd_check
    )

    p = sub.add_parser("reset-db", help="delete the dev/test database")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_reset_db)

    p = sub.add_parser("sql", help="run one SQL statement against the dev/test database")
    p.add_argument("query")
    p.set_defaults(func=cmd_sql)

    p = sub.add_parser("serve", help="run the API for development (dev profile)")
    p.add_argument("--port", type=int, default=8765)
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("serve-e2e", help="throw-away backend for end-to-end tests (test profile)")
    p.add_argument("--data", required=True, help="empty folder for the test database and files")
    p.add_argument("--echo", action="store_true", help="answer messages by echoing them (no model)")
    p.set_defaults(func=cmd_serve_e2e)

    p = sub.add_parser("openapi", help="write contracts/local-api/openapi.json")
    p.add_argument("--check", action="store_true", help="fail if the committed file is out of date")
    p.set_defaults(func=cmd_openapi)

    sub.add_parser("routes", help="list every route").set_defaults(func=cmd_routes)

    p = sub.add_parser("company", help="Company provider (G-06): server address and API key")
    csub = p.add_subparsers(dest="company_command", required=True)
    profiles = [Profile.DESKTOP.value, Profile.DEV.value]
    c = csub.add_parser("set", help="save the server address and model; asks for the key")
    c.add_argument("--url", default=company.DEEPSEEK_URL, help="default: DeepSeek")
    c.add_argument("--model", default=company.DEEPSEEK_MODEL, help="default: deepseek-flash")
    c.add_argument("--context", type=int, default=company.DEFAULT_CONTEXT, help="tokens")
    c.add_argument("--profile", choices=profiles, default=Profile.DESKTOP.value)
    c.add_argument("--no-check", dest="check", action="store_false", help="do not test the server")
    c.set_defaults(func=cmd_company_set)
    c = csub.add_parser("key", help="store only the API key in the OS key store (stdin or typed)")
    c.set_defaults(func=cmd_company_key)
    c = csub.add_parser("check", help="check that the configured server answers (its model list)")
    c.add_argument("--profile", choices=profiles, default=Profile.DESKTOP.value)
    c.set_defaults(func=cmd_company_check)
    c = csub.add_parser("clear", help="remove the server address and the key")
    c.add_argument("--profile", choices=profiles, default=Profile.DESKTOP.value)
    c.set_defaults(func=cmd_company_clear)
    p = sub.add_parser("resource", help="linked resources (Resources page): the operator's API key")
    rsub = p.add_subparsers(dest="resource_command", required=True)
    c = rsub.add_parser("key", help="store the API key on this computer (stdin or typed)")
    c.add_argument("--id", default="deepseek-v4", help="default: deepseek-v4")
    c.add_argument("--no-check", dest="check", action="store_false", help="do not ask the provider")
    c.set_defaults(func=cmd_resource_key)
    c = rsub.add_parser("clear", help="remove the stored API key")
    c.add_argument("--id", default="deepseek-v4", help="default: deepseek-v4")
    c.set_defaults(func=cmd_resource_clear)
    sub.add_parser(
        "rebuild-search", help="rebuild the full-text search index from the messages (H-02)"
    ).set_defaults(func=cmd_rebuild_search)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
