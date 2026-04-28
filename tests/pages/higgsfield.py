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
        self._strip_overlays()

    def _strip_overlays(self) -> None:
        """Remove banners/captcha frames that intercept clicks."""
        try:
            self.page.evaluate(
                "() => { ['cookiescript_injected_wrapper','onetrust-banner-sdk',"
                "'cookiescript_injected'].forEach(id => "
                "document.getElementById(id)?.remove());"
                "document.querySelectorAll('[id^=ddChallengeContainer]').forEach(el => el.remove()); }"
            )
        except Exception:
            pass

    def prompt_input(self) -> Locator:
        # contenteditable div — accessible as role=textbox
        return self.page.get_by_role("textbox").first

    def submit_button(self) -> Locator:
        return self.page.get_by_role("button", name=re.compile(r"^generate\b", re.I)).first

    def generate(self, prompt: str) -> GenerationResult:
        # Snapshot existing image URLs so we can verify a NEW one appears.
        # Without this, the page already contains promo/banner CDN images and
        # any generic "img[src*=cdn]" locator passes trivially.
        before = set(self.page.evaluate(
            "() => Array.from(document.images).map(i => i.src)"
        ))

        self.prompt_input().click()
        self.prompt_input().fill(prompt)
        self.page.wait_for_timeout(300)
        self.submit_button().click()

        self._check_auth_modal()
        self._check_datadome()
        return self._wait_for_new_image(before)

    def _check_auth_modal(self) -> None:
        """If the auth modal appeared after clicking Generate, the session expired."""
        self.page.wait_for_timeout(1500)
        modal = self.page.get_by_text("Welcome to Higgsfield", exact=False)
        if modal.count() > 0 and modal.first.is_visible():
            pytest.skip(
                "Higgsfield auth modal appeared — session expired. "
                "Re-run `python scripts/auto_login.py` and update storage_state.json."
            )

    def _check_datadome(self) -> None:
        """DataDome anti-bot intercepts the generation API and shows a captcha."""
        if self.page.get_by_text("Verification Required", exact=True).count() > 0:
            pytest.skip(
                "DataDome anti-bot captcha blocked generation. "
                "This usually means the test IP is flagged — try a different network."
            )

    def _wait_for_new_image(self, before: set[str]) -> GenerationResult:
        """Wait for an image whose src wasn't on the page before clicking Generate."""
        deadline_ms = self.GEN_TIMEOUT_MS
        elapsed = 0
        step = 2000
        while elapsed < deadline_ms:
            self.page.wait_for_timeout(step)
            elapsed += step
            self._check_datadome()
            current = self.page.evaluate(
                "() => Array.from(document.images).map(i => "
                "({src: i.src, w: i.naturalWidth}))"
            )
            for img in current:
                src = img["src"]
                if src and src not in before and "higgs" in src and img["w"] > 200:
                    return GenerationResult(
                        image_locator=self.page.locator(f"img[src='{src}']").first,
                        src=src,
                    )
        raise AssertionError(
            f"No new generated image appeared within {self.GEN_TIMEOUT_MS}ms"
        )

    def open_history(self) -> Locator:
        """Activate History tab if not already, then return the first result image."""
        self._strip_overlays()
        history_tab = self.page.locator("button[role='tab'][id$='trigger-history']")
        if history_tab.count() and history_tab.first.get_attribute("data-state") != "active":
            history_tab.first.dispatch_event("click")
            self.page.wait_for_timeout(2000)
        return self.page.locator(
            "img[src*='higgs.ai'], img[src*='cdn'], img[src*='blob:']"
        ).first
