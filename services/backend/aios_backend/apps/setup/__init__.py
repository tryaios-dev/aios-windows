"""First-run setup and restore (MVP 4.1). Backend side of apps/ui/src/features/setup.

Built: the ``store_identity`` and ``setup_state`` tables (models.py); store creation (evidence
signing key, recovery key shown once, ``recovery.pkg`` per contracts/recovery-package/v1 in
``recovery_package.py``); finishing first run with the default Restricted project; and restore
from a backup with the recovery key.

Not built yet: the hardware check, model download or import and the benchmark (models app).
"""
