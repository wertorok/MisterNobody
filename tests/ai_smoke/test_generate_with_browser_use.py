"""AI-driven smoke: lets browser-use figure out the UI by itself.

Useful when modals/buttons move around and Playwright selectors break.
Skipped unless ANTHROPIC_API_KEY is set.

Run with: pytest -m ai
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import pytest

pytestmark = pytest.mark.ai


@pytest.fixture(scope="module")
def storage_state_path() -> Path:
    path = Path(__file__).resolve().parents[2] / "storage_state.json"
    if not path.exists():
        pytest.skip("storage_state.json missing — run scripts/login_save_state.py")
    return path


def _require_key() -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        pytest.skip("ANTHROPIC_API_KEY not set")
    return key


def test_ai_can_generate_a_photo(storage_state_path: Path) -> None:
    _require_key()

    from browser_use import Agent, Browser, BrowserConfig
    from langchain_anthropic import ChatAnthropic

    llm = ChatAnthropic(model="claude-sonnet-4-6", temperature=0)

    cookies_file = storage_state_path  # browser-use accepts Playwright storage_state
    browser = Browser(
        config=BrowserConfig(
            headless=True,
            cookies_file=str(cookies_file),
        )
    )

    task = (
        "Go to https://higgsfield.ai. You are already logged in. "
        "Open the image generation tool (it may be a modal). "
        "Enter the prompt: 'a serene mountain lake at sunrise, photorealistic'. "
        "Press the generate / create button. Wait until a result image appears. "
        "Return JSON: {\"image_url\": <src of the generated image>}."
    )

    async def run() -> str:
        agent = Agent(task=task, llm=llm, browser=browser)
        history = await agent.run(max_steps=25)
        return history.final_result() or ""

    final = asyncio.run(run())

    # Best-effort parse — agent is asked to return JSON.
    try:
        payload = json.loads(final)
        assert payload.get("image_url"), f"no image_url in: {final}"
    except json.JSONDecodeError:
        pytest.fail(f"agent did not return JSON: {final!r}")
