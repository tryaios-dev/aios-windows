"""Settings. Installation settings (MVP 9.3). Backend side of apps/ui/src/features/settings.

Built: the ``settings`` table (models.py), reading and changing settings (update and catalogue
checks, Safe mode, default model), recording update-check results from Electron main, and the
network allowlist, kept equal to contracts/network-allowlist/v1.

Not here: the update check runs in Electron main (electron-updater); the catalogue check and
hardware belong to the models app.
"""
