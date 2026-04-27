"""Launch Playwright codegen against Higgsfield with the saved session.

Click around the UI; codegen prints Python locator code you can paste into
tests/pages/higgsfield.py to replace the TODO selectors.

Usage:
    python scripts/codegen.py
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "storage_state.json"
BASE_URL = os.environ.get("HIGGSFIELD_BASE_URL", "https://higgsfield.ai")


def main() -> None:
    if not STORAGE_STATE.exists():
        print("storage_state.json missing — run scripts/login_save_state.py first")
        sys.exit(1)

    cmd = [
        sys.executable,
        "-m",
        "playwright",
        "codegen",
        "--target",
        "python",
        "--load-storage",
        str(STORAGE_STATE),
        "--viewport-size",
        "1440,900",
        BASE_URL,
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, check=False)


if __name__ == "__main__":
    main()
