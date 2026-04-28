"""Auto-login via Google OAuth for Higgsfield.ai."""
from __future__ import annotations
import os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, Page

ROOT    = Path(__file__).resolve().parent.parent
OUT     = ROOT / "artifacts" / "login"
OUT.mkdir(parents=True, exist_ok=True)
STORAGE = ROOT / "storage_state.json"
BASE    = os.environ.get("HIGGSFIELD_BASE_URL", "https://higgsfield.ai")
EMAIL   = os.environ.get("HIGGSFIELD_EMAIL", "")
PASSWD  = os.environ.get("HIGGSFIELD_PASSWORD", "")

def shot(page: Page, name: str) -> None:
    p = OUT / f"{name}.png"
    page.screenshot(path=str(p), full_page=False)
    print(f"  screenshot → {p.name}")

def click_first(page: Page, *texts: str) -> bool:
    for text in texts:
        for role in ("button", "link"):
            loc = page.get_by_role(role, name=text)
            if loc.count():
                print(f"  clicking [{role}] '{text}'")
                loc.first.click()
                return True
    return False

def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--ignore-certificate-errors",
                "--no-sandbox",
            ],
        )
        ctx = browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 1440, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = ctx.new_page()
        page.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")

        # ── 1. home page ─────────────────────────────────────────────────────
        print(f"→ {BASE}")
        page.goto(BASE, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_timeout(2000)
        shot(page, "01_home")
        print(f"  url: {page.url}")

        # ── 2. open sign-in modal/page ────────────────────────────────────────
        clicked = click_first(page, "Sign in", "Log in", "Get started", "Sign In", "Login")
        if clicked:
            page.wait_for_timeout(2000)
            shot(page, "02_signin_opened")
            print(f"  url: {page.url}")

        # ── 3. click Google ───────────────────────────────────────────────────
        # Google button may open same tab or a popup
        all_pages_before = len(ctx.pages)
        clicked_google = click_first(
            page,
            "Continue with Google", "Sign in with Google",
            "Continue With Google", "Google",
        )
        if not clicked_google:
            # try by text content
            loc = page.locator("button:has-text('Google'), a:has-text('Google')")
            if loc.count():
                print("  clicking google via text locator")
                loc.first.click()
                clicked_google = True

        page.wait_for_timeout(3000)
        shot(page, "03_after_google_click")

        # detect if a new popup appeared
        if len(ctx.pages) > all_pages_before:
            google_page = ctx.pages[-1]
            print(f"  popup detected: {google_page.url}")
        else:
            google_page = page
            print(f"  same-tab navigation: {page.url}")

        shot(google_page, "04_google_page")

        # ── 4. fill Google credentials ────────────────────────────────────────
        _fill_google(google_page)

        # ── 5. wait to land back on Higgsfield ───────────────────────────────
        target = page if google_page is page else page
        try:
            target.wait_for_url(f"{BASE}/**", timeout=30_000)
        except Exception:
            pass
        page.wait_for_timeout(3000)
        shot(page, "05_final")
        print(f"  final url: {page.url}")

        ctx.storage_state(path=str(STORAGE))
        print(f"✓ session saved → {STORAGE}")
        browser.close()


def _try_click(page: Page, *selectors: str) -> bool:
    """Try multiple CSS/text selectors; return True if any clicked."""
    for sel in selectors:
        try:
            loc = page.locator(sel)
            if loc.count() and loc.first.is_visible():
                print(f"  clicking: {sel!r}")
                loc.first.click()
                return True
        except Exception:
            pass
    return False


def _fill_google(page: Page) -> None:
    print(f"  Google page: {page.url}")

    # ── email ────────────────────────────────────────────────────────────────
    email_input = page.locator('input[type="email"]')
    try:
        email_input.wait_for(timeout=8000)
        print("  filling email")
        email_input.fill(EMAIL)
        page.wait_for_timeout(500)
        page.keyboard.press("Enter")
        page.wait_for_timeout(4000)
        shot(page, "04b_after_email")
        print(f"  url: {page.url}")
    except Exception as e:
        print(f"  no email field: {e}")

    # ── dismiss passkey / "Try another way" ──────────────────────────────────
    _try_click(
        page,
        "text='Try another way'",
        "[data-action='try-another-way']",
        "a:has-text('Try another way')",
        "button:has-text('Try another way')",
        "span:has-text('Try another way')",
        "div[role='link']:has-text('Try another way')",
        "#view_container a",   # last resort: first link in container
    )
    page.wait_for_timeout(2000)
    shot(page, "04b2_after_try_another")
    print(f"  url: {page.url}")

    # ── choose "Enter your password" option if a list appeared ───────────────
    _try_click(
        page,
        "text='Enter your password'",
        "li:has-text('password')",
        "div[data-challengetype='1']",   # Google internal: password challenge
        "[data-challengeid='1']",
        "text='Use your password'",
    )
    page.wait_for_timeout(2000)
    shot(page, "04b3_after_password_option")

    # ── password ─────────────────────────────────────────────────────────────
    pwd_input = page.locator('input[type="password"]')
    try:
        pwd_input.wait_for(timeout=10000)
        print("  filling password")
        pwd_input.fill(PASSWD)
        page.wait_for_timeout(500)
        page.keyboard.press("Enter")
        page.wait_for_timeout(6000)
        shot(page, "04c_after_password")
        print(f"  url: {page.url}")
    except Exception as e:
        print(f"  no password field: {e}")

    shot(page, "04d_google_done")


if __name__ == "__main__":
    main()
