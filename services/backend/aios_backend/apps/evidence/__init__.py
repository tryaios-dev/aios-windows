"""Evidence. The evidence log as the app shows it (MVP 9.2). Backend side of apps/ui/src/features/evidence.

Built: the list of recorded events (all, or per project) and the writer status. Every app
queues its events in the outbox (``db/outbox.py``) inside its own transaction; the evidence
writer appends them to the hash chain. This app never opens the evidence database
(CLAUDE.md invariant 5).

Not built yet: the evidence writer itself (services/evidence-writer), so events stay pending
and export answers ``503 writer_unavailable``.
"""
