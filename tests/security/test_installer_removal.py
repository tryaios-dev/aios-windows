"""The uninstaller removes only what the installer put there (report 16 Nov, "uninstall clean-up").

The install folder can be any folder the user chose (allowToChangeInstallationDirectory). Removing
"everything in it except models" would delete the user's own files if they picked a folder that
was not empty, so customRemoveFiles names each entry the installer ships and nothing else.
"""

import re
from pathlib import Path

NSH = Path(__file__).resolve().parents[2] / "build" / "installer" / "installer.nsh"


def _remove_files_macro() -> str:
    text = NSH.read_text(encoding="utf-8")
    match = re.search(r"!macro customRemoveFiles(.*?)!macroend", text, re.S)
    assert match, "customRemoveFiles is missing"
    return match.group(1)


def test_removal_never_walks_the_folder_or_uses_wildcards() -> None:
    body = _remove_files_macro()
    assert "FindFirst" not in body
    assert "*" not in body


def test_removal_names_what_the_installer_ships() -> None:
    body = _remove_files_macro()
    for name in ("resources", "locales", "${APP_EXECUTABLE_FILENAME}", "${UNINSTALL_FILENAME}"):
        assert name in body
    # The folder itself goes only when it is empty: user files and a kept models folder stay.
    assert 'RMDir "$INSTDIR"' in body
    assert 'RMDir /r "$INSTDIR"' not in body
