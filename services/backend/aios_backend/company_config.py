"""Where the Company server is (G-06): ``company.json`` in the data folder. No key, ever.

Kept apart from ``aios_backend.company`` so that loading the settings imports nothing else.
"""

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit

FILE_NAME = "company.json"
# What ``aios-backend company set`` uses when no address or model is given.
DEEPSEEK_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"
DEFAULT_CONTEXT = 65_536  # tokens


@dataclass(frozen=True)
class CompanyConfig:
    base_url: str  # e.g. https://api.deepseek.com or https://gpu.example.com/v1
    model_name: str
    context_length: int = DEFAULT_CONTEXT


def valid_url(url: str) -> bool:
    """HTTPS, a host, no user name or password in the address."""
    try:
        parts = urlsplit(url)
        _ = parts.port  # raises on a bad port
    except ValueError:
        return False
    return (
        parts.scheme == "https"
        and bool(parts.hostname)
        and parts.username is None
        and parts.password is None
    )


def load_config(path: Path | None) -> CompanyConfig | None:
    """The configured server, or None (no file, or anything wrong in it: the flag stays off)."""
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        url, model = data["base_url"], data["model_name"]
        context = data.get("context_length", DEFAULT_CONTEXT)
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if not (isinstance(url, str) and valid_url(url)):
        return None
    if not (isinstance(model, str) and 0 < len(model.strip()) <= 100):
        return None
    if not (isinstance(context, int) and 1024 <= context <= 2_000_000):
        return None
    return CompanyConfig(base_url=url, model_name=model.strip(), context_length=context)


def save_config(path: Path, config: CompanyConfig) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(config), indent=2) + "\n", encoding="utf-8")


load_company_config = load_config

# path -> (file stamp, what it said). Read again only when the file changes, so the backend
# follows ``aios-backend company set`` / ``clear`` while it runs, without a restart.
_seen: dict[Path, tuple[tuple[int, int] | None, CompanyConfig | None]] = {}


def current(path: Path | None) -> CompanyConfig | None:
    """The configured server as the file says now (cheap: one stat unless the file changed)."""
    if path is None:
        return None
    try:
        info = path.stat()
        stamp: tuple[int, int] | None = (info.st_mtime_ns, info.st_size)
    except OSError:
        stamp = None
    seen = _seen.get(path)
    if seen is not None and seen[0] == stamp:
        return seen[1]
    found = load_config(path) if stamp is not None else None
    _seen[path] = (stamp, found)
    return found
