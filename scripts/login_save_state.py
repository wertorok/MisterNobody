"""One-time helper: opens Higgsfield, lets you log in by hand, saves session.

Usage:
    python scripts/login_save_state.py

The browser stays open until you press Enter in the terminal — log in
(Google/email/whatever), pass any captcha, then come back and press Enter.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "storage_state.json"
BASE_URL = os.environ.get("HIGGSFIELD_BASE_URL", "https://higgsfield.ai")


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.goto(BASE_URL)
        print(f"Opened {BASE_URL}. Log in in the browser window.")
        input("Press Enter here once you are fully logged in... ")
        context.storage_state(path=str(STORAGE_STATE))
        print(f"Saved session to {STORAGE_STATE}")
        browser.close()


if __name__ == "__main__":
    main()
