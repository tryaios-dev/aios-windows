"""Where the Company server is (G-06), and the rules every Company address and model name follow.

Two places can say it, and neither ever holds the key:

* ``operator.json`` (``config.company_from_file``): written by an operator, machine-wide in the
  desktop profile. When it switches Company on, it decides; ``company.json`` is not read.
* ``company.json`` in the data folder: written by ``aios-backend company set``. The backend follows
  it while it runs (``current``), so a change needs no restart.

Kept apart from ``aios_backend.company`` so that loading the settings imports nothing else.
"""

import ipaddress
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlsplit

FILE_NAME = "company.json"
# What ``aios-backend company set`` uses when no address or model is given.
DEEPSEEK_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-flash"  # DeepSeek's API lists deepseek-flash and deepseek-v4-pro
DEFAULT_CONTEXT = 65_536  # tokens
# The model id is recorded in evidence, so it may only hold what an evidence body accepts
# (db.outbox): no spaces and no "/" (serve such models under another name, e.g. vLLM's
# --served-model-name).
MODEL_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:+-]{0,99}")
_DNS_LABEL = re.compile(r"(?!-)[a-z0-9-]{1,63}(?<!-)")


@dataclass(frozen=True)
class CompanyConfig:
    base_url: str  # e.g. https://api.deepseek.com or https://gpu.example.com/v1
    model_name: str
    context_length: int = DEFAULT_CONTEXT


def server_url(value: object, *, allow_path: bool = True) -> str | None:
    """The server's address as the network allowlist accepts it (M-22, P-4), or None.

    HTTPS, a DNS name (no IP address, at least one dot), port 443, no user name or password, no
    query or fragment. A path (``/v1``) is kept when ``allow_path``. Returned without a trailing
    slash and with the host in lower case."""
    if not isinstance(value, str):
        return None
    try:
        parts = urlsplit(value.strip())
        port = parts.port
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or port not in (None, 443) or parts.username or parts.password:
        return None
    path = parts.path.rstrip("/")
    if (path and not allow_path) or parts.query or parts.fragment or " " in path:
        return None
    try:
        ipaddress.ip_address(host)
        return None  # an IP address, not a DNS name
    except ValueError:
        pass
    labels = host.split(".")
    if len(labels) < 2 or not all(_DNS_LABEL.fullmatch(label) for label in labels):
        return None
    return f"https://{host}{path}"


def valid_url(url: str) -> bool:
    return server_url(url) is not None


def valid_model_name(name: object) -> bool:
    return isinstance(name, str) and MODEL_NAME.fullmatch(name) is not None


def api_root(base_url: str) -> str:
    """Where ``/models`` and ``/chat/completions`` live. An address with a path is used as it is
    (``https://gpu.example.com/v1``); one without gets ``/v1``, which OpenAI-compatible servers
    (llama-server, vLLM, DeepSeek) all serve."""
    base = base_url.rstrip("/")
    return base if urlsplit(base).path else f"{base}/v1"


def load_config(path: Path | None) -> CompanyConfig | None:
    """The configured server, or None (no file, or anything wrong in it: the flag stays off)."""
    if path is None or not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        url, model = data["base_url"], data["model_name"]
        context = data.get("context_length", DEFAULT_CONTEXT)
    except (OSError, ValueError, KeyError, TypeError):
        return None
    base = server_url(url)
    model = model.strip() if isinstance(model, str) else model
    if base is None or not valid_model_name(model):
        return None
    if type(context) is not int or not 1024 <= context <= 2_000_000:
        return None
    return CompanyConfig(base_url=base, model_name=model, context_length=context)


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
