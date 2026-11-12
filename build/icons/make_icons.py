"""Make the Windows app icons from the AIOS Soft Square brand pack.

    python build/icons/make_icons.py <path to AIOS-Soft-Square-Brand>

Reads 03-app-icons/aios-app-icon-512.png (the dark A on a white rounded tile) and writes:
- icon.ico: AIOS.exe, the installer, the uninstaller and shortcuts (electron-builder.yml)
- icon.png: the window icon when AIOS runs from source (apps/desktop/src/main/window.ts)
"""

import sys
from pathlib import Path

from PIL import Image

SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def main() -> None:
    pack = Path(sys.argv[1])
    out = Path(__file__).parent
    im = Image.open(pack / "03-app-icons" / "aios-app-icon-512.png").convert("RGBA")
    if im.size != (512, 512):
        raise SystemExit(f"expected a 512 x 512 app icon, got {im.size}")
    im.save(out / "icon.ico", sizes=[(s, s) for s in SIZES])
    im.resize((256, 256), Image.Resampling.LANCZOS).save(out / "icon.png")


if __name__ == "__main__":
    main()
