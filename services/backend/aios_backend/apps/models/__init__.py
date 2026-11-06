"""Model manager (MVP 9.6). Backend side of apps/ui/src/features/models.

Built: the ``installed_models`` and ``hardware_profile`` tables (models.py); the catalogue
(``catalogue.py``, read from ``catalogue_dev.json`` until the signed catalogue exists); offline
import of a .gguf file, installed only if its size and SHA-256 match an entry; deletion (clears
the default model when needed); this machine's hardware and recommended tier (``hardware.py``).

Not built yet: download from the model mirror (placeholder host; answers 503
``mirror_unavailable``), the engine (llama-server), the benchmark and the chat answer source.
"""
