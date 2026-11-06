"""Chat. Conversations and messages (MVP 4.2, 9.3). Backend side of apps/ui/src/features/chat.

Built: conversations (create, rename, archive, delete, model), moving between Local and
Company with the confirmation rules (M-09), sending and regenerating with the context-size
refusal, partial answers, hiding commitments and the ``inference_completed`` evidence event.

Not built yet: the answer source (``answers.py``) is empty until the local model module and
the gateway exist, so sending answers ``409 no_model``. Streaming over server-sent events,
stop, summaries and "continue locally" come with it.
"""
