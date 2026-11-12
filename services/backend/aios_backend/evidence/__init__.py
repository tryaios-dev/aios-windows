"""The backend's side of the evidence writer (F-01, F-05; IPC-40 to IPC-42).

``process``: start evidence-writer.exe with the handshake and the derived token.
``client``: the writer's loopback API (append intents, checkpoints, export, backup, restore).
``pump``: send queued outbox events to the writer and keep its replies in chats.db.

Nothing here opens evidence.db; the writer owns it (invariant 5).
"""
