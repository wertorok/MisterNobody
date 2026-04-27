"""Page Object for Higgsfield photo generation.

Selectors are intentionally fuzzy (role + text) because Higgsfield's UI
relies heavily on overlay modals that don't change the URL. Tighten them
once we have stable test ids.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from playwright.sync_api import Locator, Page, expect


@dataclass
class GenerationResult:
    image_locator: Locator
    src: str


class HiggsfieldApp:
    GEN_TIMEOUT_MS = 180_000  # photo generation can take a while

    def __init__(self, page: Page) -> None:
        self.page = page

    # ---------- navigation ----------

    def open_image_tool(self) -> None:
        """Open the image generation surface (modal or page)."""
        # TODO: replace with the actual entry-point selector once known.
        candidates = [
            self.page.get_by_role("link", name=re.compile("image", re.I)),
            self.page.get_by_role("button", name=re.compile("create.*image|new image", re.I)),
            self.page.get_by_role("button", name=re.compile("generate", re.I)),
        ]
        for loc in candidates:
            if loc.count() > 0:
                loc.first.click()
                return
        raise AssertionError("Could not find an Image / Create entry point")

    # ---------- prompt ----------

    def prompt_input(self) -> Locator:
        # Most generators use a textarea with a 'prompt' placeholder.
        return self.page.get_by_placeholder(re.compile("prompt|describe", re.I)).first

    def submit_button(self) -> Locator:
        return self.page.get_by_role(
            "button", name=re.compile(r"^(generate|create|run)\b", re.I)
        ).first

    def generate(self, prompt: str) -> GenerationResult:
        self.prompt_input().fill(prompt)
        self.submit_button().click()
        return self._wait_for_result()

    def _wait_for_result(self) -> GenerationResult:
        # Wait for a freshly produced <img> to appear in the result area.
        # Strategy: an <img> whose src points to a CDN/blob, not a logo asset.
        result_img = self.page.locator(
            "img[src*='cdn'], img[src*='blob:'], img[src*='generations']"
        ).last
        expect(result_img).to_be_visible(timeout=self.GEN_TIMEOUT_MS)
        src = result_img.get_attribute("src") or ""
        return GenerationResult(image_locator=result_img, src=src)

    # ---------- history ----------

    def open_history(self) -> Locator:
        history = self.page.get_by_role(
            "link", name=re.compile("history|my.*generations|library", re.I)
        )
        if history.count() == 0:
            history = self.page.get_by_role(
                "button", name=re.compile("history|library", re.I)
            )
        history.first.click()
        return self.page.locator("img").first
