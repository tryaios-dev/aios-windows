"""Which cloud AI models can be linked, and where their API keys live (no HTTP, no chat imports).

Light on purpose: chat and settings read whether a resource is linked without loading the HTTP
client (``aios_backend.linked`` answers). A resource is linked exactly while its API key is in the
OS key store (invariant 3); the key is never logged, written anywhere else or returned.

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime

from aios_backend.company_config import DEEPSEEK_URL, CompanyConfig
from aios_common.keystore import delete_secret, get_secret, set_secret
from aios_common.logging import get_logger, log_event

PROVIDER = "resource"
# The cloud AI providers AIOS can link, by the id the Resources page uses
# (apps/ui/src/data/resources.ts). Each has its own address, its own key, its own network
# allowlist row (``linked-<id>``) and one or more models the person chooses between in a
# conversation (the first is the default). Most speak the OpenAI-compatible chat protocol
# (``/models`` and ``/chat/completions`` under the address); Claude speaks Anthropic's Messages API
# (``protocol="anthropic"``). The model names are checked against the provider's ``/models`` list,
# so a model the key cannot use shows as ``resource_model_not_listed``.


@dataclass(frozen=True)
class Model:
    id: str  # the provider's model name, sent with every request and kept on each answer
    name: str  # what the person reads
    context_length: int = 131_072


@dataclass(frozen=True)
class Spec:
    base_url: str
    models: tuple[Model, ...]
    protocol: str = "openai"  # "openai" or "anthropic"
    # Ask for the token counts in the stream (``stream_options``); a provider that refuses the
    # field reports them anyway.
    stream_usage: bool = True


SPECS: dict[str, Spec] = {
    "deepseek-v4": Spec(DEEPSEEK_URL, (Model("deepseek-v4-pro", "DeepSeek V4 Pro", 65_536),)),
    "gemini-3-pro": Spec(
        "https://generativelanguage.googleapis.com/v1beta/openai",
        (Model("gemini-3.1-pro-preview", "Gemini 3.1 Pro"),),
    ),
    "kimi-k2": Spec("https://api.moonshot.ai", (Model("kimi-k3", "Kimi K3"),)),
    "claude": Spec(
        "https://api.anthropic.com",
        (
            Model("claude-opus-5-5", "Claude Opus 5.5"),
            Model("claude-fable-5-2", "Claude Fable 5.2"),
            Model("claude-sonnet-5-5", "Claude Sonnet 5.5"),
            Model("claude-haiku-5-5", "Claude Haiku 5.5"),
        ),
        protocol="anthropic",
    ),
    "chatgpt": Spec(
        "https://api.openai.com",
        (
            Model("gpt-6.2-sol", "GPT-6.2 Sol"),
            Model("gpt-6.2-astra", "GPT-6.2 Astra"),
            Model("gpt-6.1-terra", "GPT-6.1 Terra"),
        ),
    ),
    "mistral": Spec(
        "https://api.mistral.ai",
        (
            Model("mistral-large-latest", "Mistral Large"),
            Model("mistral-medium-latest", "Mistral Medium"),
        ),
        stream_usage=False,
    ),
    "perplexity": Spec(
        "https://api.perplexity.ai/orchestrator/v1",
        (Model("perplexity/sonar", "Perplexity Sonar"),),
    ),
}
# Each resource with its default model, as the Company protocol client takes it.
RESOURCES: dict[str, CompanyConfig] = {
    rid: CompanyConfig(spec.base_url, spec.models[0].id, spec.models[0].context_length)
    for rid, spec in SPECS.items()
}


# The chat models each linked key can use, as the provider listed them when the resource was
# linked (``aios_backend.linked.chat_models``, kept in ``linked_resources.models``). The person picks
# from these; until a list is known, the resource's ``SPECS`` models are offered.
_LISTED: dict[str, tuple[str, ...]] = {}
DEFAULT_CONTEXT = 131_072


def set_listed(resource_id: str, ids: list[str] | tuple[str, ...] | None) -> None:
    if ids:
        _LISTED[resource_id] = tuple(ids)
    else:
        _LISTED.pop(resource_id, None)


def model_ids(resource_id: str) -> list[str]:
    """The models a person can pick at a resource, the default first: the resource's preferred
    models the key can use (``SPECS`` order), then every other chat model the key lists."""
    spec = SPECS.get(resource_id)
    if spec is None:
        return []
    preferred = [m.id for m in spec.models]
    listed = _LISTED.get(resource_id)
    if not listed:
        return preferred
    return [m for m in preferred if m in listed] + sorted(m for m in listed if m not in preferred)


def model_name(resource_id: str, model_id: str) -> str:
    """What the person reads: the name AIOS knows, else the provider's own id."""
    spec = SPECS.get(resource_id)
    found = next((m for m in spec.models if m.id == model_id), None) if spec else None
    return found.name if found else model_id


def config_for(resource_id: str, model_id: str) -> CompanyConfig | None:
    """The address and model to send to, if ``model_id`` is one of the resource's models."""
    spec = SPECS.get(resource_id)
    if spec is None or model_id not in model_ids(resource_id):
        return None
    found = next((m for m in spec.models if m.id == model_id), None)
    return CompanyConfig(
        spec.base_url, model_id, found.context_length if found else DEFAULT_CONTEXT
    )


# Video resources, made over fal.ai's queue API (``aios_backend.media.fal``): the resource id (it
# is also the model id the Images & video tab and evidence record) and the fal endpoint, "owner/app".
# The endpoint is the only fal-specific choice: a different fal video model is one line here.
FAL_QUEUE = "https://queue.fal.run"
FAL_FILE_HOSTS = frozenset({"fal.media", "v2.fal.media", "v3.fal.media", "v3b.fal.media"})
MEDIA: dict[str, str] = {"hunyuan-video": "fal-ai/hunyuan-video"}
# Seconds of video one request makes: the length ``aios_backend.media.fal._input`` asks for
# (85 frames at 24 frames a second). Usage and the monthly limit count these.
VIDEO_SECONDS: dict[str, float] = {"hunyuan-video": 85 / 24}
NAMES = {
    "deepseek-v4": "DeepSeek V4",
    "gemini-3-pro": "Gemini 3.1 Pro",
    "kimi-k2": "Kimi K3",
    "claude": "Claude",
    "chatgpt": "ChatGPT",
    "mistral": "Mistral",
    "perplexity": "Perplexity",
    "hunyuan-video": "Hunyuan Video",
}

log = get_logger("linked")
_KEY = re.compile(r"[!-~]{16,512}")  # printable, no spaces: what a bearer token can hold


def valid_key(value: str) -> bool:
    return bool(_KEY.fullmatch(value))


def key_name(resource_id: str) -> str:
    """The OS key store entry (service "AIOS") that holds a resource's API key."""
    return f"resource-{resource_id}-api-key"


def provisioned_name(resource_id: str) -> str:
    """The key store entry for a key an operator stored on this computer
    (``aios-backend resource key``): Link uses it, so the person never handles a key."""
    return f"resource-{resource_id}-provisioned-key"


def store_provisioned(resource_id: str, value: str) -> None:
    set_secret(provisioned_name(resource_id), value)


def provisioned_key(resource_id: str) -> str | None:
    try:
        return get_secret(provisioned_name(resource_id))
    except Exception as exc:  # the key store cannot be used on this machine
        log_event(log, "resource_key_unreadable", error_code=type(exc).__name__)
        return None


def remove_provisioned(resource_id: str) -> None:
    try:
        delete_secret(provisioned_name(resource_id))
    except Exception as exc:  # nothing stored, or the key store cannot be used
        log_event(log, "resource_key_not_removed", error_code=type(exc).__name__)


def store_key(resource_id: str, value: str) -> None:
    set_secret(key_name(resource_id), value)


def remove_key(resource_id: str) -> None:
    try:
        delete_secret(key_name(resource_id))
    except Exception as exc:  # nothing stored, or the key store cannot be used
        log_event(log, "resource_key_not_removed", error_code=type(exc).__name__)


def stored_key(resource_id: str) -> str | None:
    try:
        return get_secret(key_name(resource_id))
    except Exception as exc:  # the key store cannot be used on this machine
        log_event(log, "resource_key_unreadable", error_code=type(exc).__name__)
        return None


def linkable(resource_id: str) -> bool:
    """A chat resource (``RESOURCES``) or a video resource (``MEDIA``)."""
    return resource_id in RESOURCES or resource_id in MEDIA


def is_linked(resource_id: str) -> bool:
    return linkable(resource_id) and bool(stored_key(resource_id))


def resource_of_flow(flow_id: str) -> str:
    """The resource a ``linked-...`` network allowlist row belongs to: ``linked-<id>``, or
    ``linked-<id>-<host part>`` for a resource that needs more than one host."""
    rest = flow_id.removeprefix("linked-")
    return next((r for r in (*RESOURCES, *MEDIA) if rest == r or rest.startswith(f"{r}-")), rest)


def linked_ids() -> list[str]:
    """Every chat resource whose key is in the key store, in the order of ``RESOURCES``."""
    return [rid for rid in RESOURCES if stored_key(rid)]


def linked_id() -> str | None:
    """The resource a conversation uses when the person did not pick one: the first linked."""
    return next(iter(linked_ids()), None)


def resource_for(model_id: str | None) -> str | None:
    """The linked resource that serves ``model_id``; with no model, the first linked one.
    None when that resource is not linked (any more)."""
    if model_id is None:
        return linked_id()
    found = [r for r in SPECS if model_id in model_ids(r)]
    return next((r for r in found if is_linked(r)), None)


def month_start(now: datetime) -> datetime:
    """The start of the calendar month (UTC) usage and the monthly limit count from."""
    return now.astimezone(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def media_cost(seconds: float, price_per_second: float | None) -> float:
    """What the seconds of video made cost at the company's price per second; 0 with no price."""
    return seconds * (price_per_second or 0.0)


def spend(
    tokens: dict[str, tuple[int, int]],
    prices: dict[str, tuple[float | None, float | None]],
    fallback: tuple[float | None, float | None] = (None, None),
) -> float:
    """What a resource's tokens cost, model by model: ``tokens`` and ``prices`` by model id (each
    model at its own price per million tokens, else at the resource's ``fallback`` price)."""
    total = 0.0
    for model_id, (tokens_in, tokens_out) in tokens.items():
        price_in, price_out = prices.get(model_id, (None, None))
        if price_in is None and price_out is None:
            price_in, price_out = fallback
        total += cost(tokens_in, tokens_out, price_in, price_out)
    return total


def cost(tokens_in: int, tokens_out: int, price_in: float | None, price_out: float | None) -> float:
    """What the tokens cost at the company's price per million tokens; 0 while no price is set."""
    return (tokens_in * (price_in or 0.0) + tokens_out * (price_out or 0.0)) / 1_000_000
