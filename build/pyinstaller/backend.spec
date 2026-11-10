# PyInstaller spec for backend.exe (one-folder).
# Alembic loads env.py and the numbered migration files from disk, so they ship as data files.
# The model catalogue (catalogue_dev.json until the signed one exists) is read from disk too.
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

hidden = (collect_submodules("aios_backend") + collect_submodules("db") + collect_submodules("uvicorn")
          + collect_submodules("aios_common") + collect_submodules("keyring.backends")
          + ["sqlcipher3", "sqlcipher3.dbapi2"])
datas = (collect_data_files("db", include_py_files=True, includes=["migrations/**/*"])
         + collect_data_files("aios_backend", includes=["apps/models/*.json"]))

a = Analysis(["../../services/backend/aios_backend/__main__.py"],
             pathex=["../../services/backend", "../../packages/py/aios-common/src"],
             hiddenimports=hidden, datas=datas)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="backend", console=False)
coll = COLLECT(exe, a.binaries, a.datas, name="backend")
