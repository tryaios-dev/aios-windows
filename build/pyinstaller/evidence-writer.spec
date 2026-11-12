# PyInstaller spec for evidence-writer.exe (one-folder), the only program that opens evidence.db.
# It shares no code with backend.exe beyond aios_common (handshake, auth, canonical JSON, logging).
from PyInstaller.utils.hooks import collect_submodules

hidden = (collect_submodules("aios_evidence_writer") + collect_submodules("uvicorn")
          + collect_submodules("aios_common") + collect_submodules("keyring.backends"))

a = Analysis(["../../services/evidence-writer/aios_evidence_writer/__main__.py"],
             pathex=["../../services/evidence-writer", "../../packages/py/aios-common/src"],
             hiddenimports=hidden)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="evidence-writer", console=False)
coll = COLLECT(exe, a.binaries, a.datas, name="evidence-writer")
