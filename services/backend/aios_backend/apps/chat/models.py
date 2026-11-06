"""Tables used by chat: conversations, provider_moves, messages (db/models.py).

They are shared tables because projects (copies, export) and search read them too.
After adding a table only chat uses: `uv run aios-backend makemigrations -m "..."`.
"""
