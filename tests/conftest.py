import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from playwright.sync_api import Browser, BrowserContext, Page

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE = ROOT / "storage_state.json"


@pytest.fixture(scope="session")
def base_url() -> str:
    return os.environ.get("HIGGSFIELD_BASE_URL", "https://higgsfield.ai")


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    args = {**browser_context_args, "viewport": {"width": 1440, "height": 900}}
    if STORAGE_STATE.exists():
        args["storage_state"] = str(STORAGE_STATE)
    return args


@pytest.fixture
def context(browser: Browser, browser_context_args) -> BrowserContext:
    ctx = browser.new_context(**browser_context_args)
    yield ctx
    ctx.close()


@pytest.fixture
def page(context: BrowserContext, base_url: str) -> Page:
    page = context.new_page()
    page.set_default_timeout(15_000)
    page.goto(base_url)
    yield page


@pytest.fixture
def authenticated_page(page: Page) -> Page:
    if not STORAGE_STATE.exists():
        pytest.skip(
            "storage_state.json missing — run `python scripts/login_save_state.py` first"
        )
    return page
