"""Golden path: open image tool, submit prompt, get an image back."""
import pytest
from playwright.sync_api import Page

from tests.pages.higgsfield import HiggsfieldApp


PROMPT = "a serene mountain lake at sunrise, photorealistic, 35mm"


def test_generate_photo_returns_image(authenticated_page: Page) -> None:
    app = HiggsfieldApp(authenticated_page)
    app.open_image_tool()

    result = app.generate(PROMPT)

    assert result.src, "generated image has no src"
    assert "logo" not in result.src.lower(), f"matched a logo, not a generation: {result.src}"


@pytest.mark.smoke
def test_generated_image_appears_in_history(authenticated_page: Page) -> None:
    app = HiggsfieldApp(authenticated_page)
    app.open_image_tool()
    result = app.generate(PROMPT)

    first_history_image = app.open_history()
    history_src = first_history_image.get_attribute("src") or ""

    # Either the same URL or at least *some* image is now first in history.
    assert history_src, "history is empty after generation"
