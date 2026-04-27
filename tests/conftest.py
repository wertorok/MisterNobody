import os
import re
from pathlib import Path

import pytest
from dotenv import load_dotenv
from playwright.sync_api import Browser, BrowserContext, Page

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "storage_state.json"
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


@pytest.fixture(scope="session")
def base_url() -> str:
    return os.environ.get("HIGGSFIELD_BASE_URL", "https://higgsfield.ai")


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    args = {
        **browser_context_args,
        "viewport": {"width": 1440, "height": 900},
        "record_video_dir": str(ARTIFACTS / "video"),
        "record_video_size": {"width": 1440, "height": 900},
    }
    if STORAGE_STATE.exists():
        args["storage_state"] = str(STORAGE_STATE)
    return args


@pytest.fixture
def context(browser: Browser, browser_context_args, request) -> BrowserContext:
    ctx = browser.new_context(**browser_context_args)
    ctx.tracing.start(screenshots=True, snapshots=True, sources=True)
    yield ctx
    failed = getattr(request.node, "rep_call", None) and request.node.rep_call.failed
    trace_path = ARTIFACTS / f"trace-{request.node.name}.zip"
    ctx.tracing.stop(path=str(trace_path) if failed else None)
    ctx.close()


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    setattr(item, f"rep_{rep.when}", rep)


_DISMISS_TEXTS = re.compile(
    r"^(close|got it|skip|maybe later|no thanks|×|✕|cancel|dismiss|continue)$",
    re.I,
)


def dismiss_overlays(page: Page, max_attempts: int = 3) -> None:
    """Best-effort: click well-known dismiss controls without failing if absent."""
    for _ in range(max_attempts):
        clicked = False
        for loc in (
            page.get_by_role("button", name=_DISMISS_TEXTS),
            page.locator("[aria-label='Close']"),
            page.locator("button[data-state='open'] svg").locator(".."),
        ):
            try:
                if loc.count() > 0 and loc.first.is_visible():
                    loc.first.click(timeout=1000)
                    clicked = True
                    break
            except Exception:
                pass
        if not clicked:
            return


@pytest.fixture
def page(context: BrowserContext, base_url: str, request) -> Page:
    page = context.new_page()
    page.set_default_timeout(15_000)
    page.goto(base_url)
    dismiss_overlays(page)
    yield page

    if getattr(request.node, "rep_call", None) and request.node.rep_call.failed:
        screenshot = ARTIFACTS / f"failure-{request.node.name}.png"
        try:
            page.screenshot(path=str(screenshot), full_page=True)
        except Exception:
            pass


@pytest.fixture
def authenticated_page(page: Page) -> Page:
    if not STORAGE_STATE.exists():
        pytest.skip(
            "storage_state.json missing — run `python scripts/login_save_state.py` first"
        )
    return page
