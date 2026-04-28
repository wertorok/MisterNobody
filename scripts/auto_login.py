"""Auto-login via Google OAuth for Higgsfield.ai using real Chrome."""
from __future__ import annotations
import os, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, Page, BrowserContext

ROOT    = Path(__file__).resolve().parent.parent
OUT     = ROOT / "artifacts" / "login"
OUT.mkdir(parents=True, exist_ok=True)
STORAGE = ROOT / "storage_state.json"
BASE    = os.environ.get("HIGGSFIELD_BASE_URL", "https://higgsfield.ai")
EMAIL   = os.environ.get("HIGGSFIELD_EMAIL", "beefreechange@gmail.com")
PASSWD  = os.environ.get("HIGGSFIELD_PASSWORD", "z7712551z")


def shot(page: Page, name: str) -> None:
    p = OUT / f"{name}.png"
    page.screenshot(path=str(p), full_page=False)
    print(f"  screenshot → {p.name}")


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            channel="chrome",
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                # disable WebAuthn/passkey hardware prompts — force password flow
                "--disable-features=WebAuthentication",
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
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
        page = ctx.new_page()

        # 1. open Clerk sign-in page directly
        signin_url = "https://accounts.higgsfield.ai/sign-in"
        print(f"→ {signin_url}")
        page.goto(signin_url, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_timeout(3000)
        shot(page, "01_signin_page")
        print(f"  url: {page.url}")

        # 2. click the Google OAuth provider button (Clerk uses provider buttons)
        _click_google(ctx, page)
        page.wait_for_timeout(4000)
        shot(page, "03_after_google_click")

        # detect if Google opened in a popup or same tab
        google_page = ctx.pages[-1] if len(ctx.pages) > 1 else page
        print(f"  google page url: {google_page.url}")
        shot(google_page, "04_google_page")

        # 4. fill credentials
        _fill_google(google_page)

        # 5. wait to land back on Higgsfield
        try:
            page.wait_for_url(f"{BASE}/**", timeout=30_000)
        except Exception:
            pass
        page.wait_for_timeout(3000)
        shot(page, "05_final")
        print(f"  final url: {page.url}")

        ctx.storage_state(path=str(STORAGE))
        print(f"✓ session saved → {STORAGE}")
        browser.close()


def _click_first(page: Page, *texts: str) -> bool:
    for text in texts:
        for role in ("button", "link"):
            loc = page.get_by_role(role, name=text)
            if loc.count():
                print(f"  clicking [{role}] '{text}'")
                loc.first.click()
                return True
    return False


def _click_google(ctx, page: Page) -> None:
    # Clerk's social buttons use aria-labels like "Sign in with Google"
    selectors = [
        "button[aria-label*='Google' i]",
        "button[data-provider='google']",
        "button:has-text('Google')",
        "a:has-text('Google')",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel)
            if loc.count() and loc.first.is_visible():
                print(f"  clicking google: {sel!r}")
                loc.first.click()
                return
        except Exception:
            pass
    # fallback: pick the middle of the 3 provider buttons
    provider_btns = page.locator("button").filter(has_not_text="Continue")
    if provider_btns.count() >= 3:
        print("  clicking middle provider button (assumed Google)")
        provider_btns.nth(1).click()


def _try_click(page: Page, *selectors: str) -> bool:
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

    # email
    email_input = page.locator('input[type="email"]')
    try:
        email_input.wait_for(timeout=8000)
        print("  filling email")
        email_input.fill(EMAIL)
        page.wait_for_timeout(500)
        page.keyboard.press("Enter")
        page.wait_for_timeout(5000)
        shot(page, "04b_after_email")
        print(f"  url after email: {page.url}")
    except Exception as e:
        print(f"  no email field: {e}")

    # If we landed on a passkey challenge (/challenge/pk), use Try another way → password
    if "/challenge/pk" in page.url:
        print("  passkey challenge — switching to password via Try another way")
        try:
            # Google uses jsaction handlers — plain .click() is silently dropped.
            # dispatch_event('click') triggers the jsaction handler.
            page.get_by_role("button", name="Try another way").dispatch_event("click")
            page.wait_for_url("**/challenge/selection**", timeout=10_000)
            page.wait_for_timeout(1500)
            shot(page, "04b2_after_try_another")
            print(f"  url after Try another way: {page.url}")

            page.get_by_text("Enter your password", exact=True).first.dispatch_event("click")
            page.wait_for_url("**/challenge/pwd**", timeout=10_000)
            page.wait_for_timeout(1500)
            shot(page, "04b3_after_password_option")
            print(f"  url after password option: {page.url}")
        except Exception as e:
            print(f"  failed to switch to password: {e}")

    # password
    pwd_input = page.locator('input[type="password"]')
    try:
        pwd_input.wait_for(timeout=10000)
        print("  filling password")
        pwd_input.fill(PASSWD)
        page.wait_for_timeout(500)
        page.keyboard.press("Enter")
        page.wait_for_timeout(8000)
        shot(page, "04c_after_password")
        print(f"  url after password: {page.url}")
    except Exception as e:
        print(f"  no password field: {e}")

    # 2FA: if Google now requires 2-Step Verification, prefer the phone tap method
    if "/challenge/selection" in page.url or "2-Step" in page.locator("body").inner_text():
        print()
        print("  ⚠ 2FA REQUIRED — selecting phone-tap option")
        try:
            tap_opt = page.get_by_text(re.compile(r"Tap.+Yes.+phone", re.I))
            if tap_opt.count() == 0:
                tap_opt = page.get_by_text(re.compile(r"phone.*tablet", re.I))
            if tap_opt.count() > 0:
                tap_opt.first.dispatch_event("click")
                page.wait_for_timeout(4000)
                shot(page, "04e_after_2fa_select")

            # Extract the verification number Google shows on screen
            body_text = page.locator("body").inner_text()
            num_match = re.search(r"\b(\d{1,3})\b\s*\n\s*Open the .+ app", body_text)
            if not num_match:
                # fallback: look for a standalone large number near "tap"
                num_match = re.search(r"tap\s+\*\*?(\d+)\*\*?", body_text, re.I)
            number = num_match.group(1) if num_match else "?"

            print()
            print("  ┌──────────────────────────────────────────────────────────┐")
            print("  │  ОТКРОЙ ПРИЛОЖЕНИЕ YouTube/Google НА ТЕЛЕФОНЕ            │")
            print("  │  1. Тапни 'Yes' в уведомлении                            │")
            f = f"  │  2. ВЫБЕРИ ЧИСЛО:  {number}".ljust(60) + "│"
            print(f)
            print("  │  Жду до 180 секунд...                                    │")
            print("  └──────────────────────────────────────────────────────────┘")
            print()
            # wait for redirect off Google challenge
            page.wait_for_url(lambda url: "challenge" not in url and "google" not in url.lower(), timeout=180_000)
            print(f"  ✓ 2FA подтверждён — url: {page.url}")
        except Exception as e:
            print(f"  2FA flow error: {e}")

    shot(page, "04d_google_done")


def _navigate_to_password(page: Page) -> None:
    """Handle Google's passkey/challenge page and navigate to password entry."""
    print(f"  navigating from challenge to password: {page.url}")
    page.wait_for_timeout(1000)
    shot(page, "04_challenge")

    # try "Try another way" first
    _try_click(
        page,
        "text='Try another way'",
        "button:has-text('Try another way')",
        "a:has-text('Try another way')",
        "div[role='link']:has-text('Try another way')",
        "span:has-text('Try another way')",
        "#view_container a",
    )
    page.wait_for_timeout(2000)
    shot(page, "04_after_try_another")
    print(f"  url after try-another: {page.url}")

    # now select "Enter your password" from the list
    _try_click(
        page,
        "text='Enter your password'",
        "li:has-text('password')",
        "div[data-challengetype='1']",
        "[data-challengeid='1']",
        "text='Use your password'",
        "text='Password'",
    )
    page.wait_for_timeout(2000)
    shot(page, "04_after_password_option")
    print(f"  url after password option: {page.url}")


if __name__ == "__main__":
    main()
