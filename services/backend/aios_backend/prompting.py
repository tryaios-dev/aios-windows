"""The system prompt each provider puts in front of a conversation (G-03).

Chat calls the provider's ``prepare`` before it computes the input commitment, so evidence covers
the exact bytes the model receives. ``prepare`` may run twice on the same messages (once in chat,
once in the provider behind the gateway), so it must change nothing the second time.
"""


def with_system_prompt(prompt: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """``messages`` with ``prompt`` first, once. A note from chat (skills, documents, the summary
    of earlier messages) that is already first is kept after it, in the same system message."""
    if not messages or messages[0].get("role") != "system":
        return [{"role": "system", "content": prompt}, *messages]
    if messages[0]["content"].startswith(prompt):
        return list(messages)
    merged = f"{prompt}\n\n{messages[0]['content']}"
    return [{"role": "system", "content": merged}, *messages[1:]]
