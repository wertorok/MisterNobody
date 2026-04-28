"""Page Object for Higgsfield photo generation."""
from __future__ import annotations

import re
from dataclasses import dataclass

import pytest
from playwright.sync_api import Locator, Page, expect

APP_IMAGE_URL = "https://higgsfield.ai/ai/image?model=nano-banana-pro"

# Selector for the Higgsfield auth modal (shown when session expires mid-flow)
_AUTH_MODAL_SEL = "text='Welcome to Higgsfield', text='Continue with Google'"


@dataclass
class GenerationResult:
    image_locator: Locator
    src: str


class HiggsfieldApp:
    GEN_TIMEOUT_MS = 180_000

    def __init__(self, page: Page) -> None:
        self.page = page

    def open_image_tool(self) -> None:
        """Navigate directly to the image generation page."""
        self.page.goto(APP_IMAGE_URL, wait_until="load", timeout=30_000)
        self.page.wait_for_timeout(2000)

    def prompt_input(self) -> Locator:
        # contenteditable div — accessible as role=textbox
        return self.page.get_by_role("textbox").first

    def submit_button(self) -> Locator:
        return self.page.get_by_role("button", name=re.compile(r"^generate\b", re.I)).first

    def generate(self, prompt: str) -> GenerationResult:
        self.prompt_input().click()
        self.prompt_input().fill(prompt)
        self.page.wait_for_timeout(300)
        self.submit_button().click()
        self._check_auth_modal()
        return self._wait_for_result()

    def _check_auth_modal(self) -> None:
        """If the auth modal appeared after clicking Generate, the session expired."""
        self.page.wait_for_timeout(1500)
        modal = self.page.get_by_text("Welcome to Higgsfield", exact=False)
        if modal.count() > 0 and modal.first.is_visible():
            pytest.skip(
                "Higgsfield auth modal appeared — session expired. "
                "Re-run `python scripts/login_save_state.py` and update storage_state.json."
            )

    def _wait_for_result(self) -> GenerationResult:
        # Wait for a generated image to appear.
        # Higgsfield serves generations via images.higgs.ai or similar CDN.
        result_img = self.page.locator(
            "img[src*='higgs.ai'], img[src*='cdn'], img[src*='blob:'], img[src*='generation']"
        ).last
        expect(result_img).to_be_visible(timeout=self.GEN_TIMEOUT_MS)
        src = result_img.get_attribute("src") or ""
        return GenerationResult(image_locator=result_img, src=src)

    def open_history(self) -> Locator:
        history = self.page.get_by_role("link", name=re.compile("^history$", re.I))
        if history.count() == 0:
            history = self.page.get_by_role(
                "button", name=re.compile("history|library", re.I)
            )
        history.first.click()
        self.page.wait_for_timeout(2000)
        return self.page.locator("img").first
