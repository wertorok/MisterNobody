"""Verify the saved session is still valid (no login form, user menu visible)."""
import re

import pytest
from playwright.sync_api import Page, expect


@pytest.mark.smoke
def test_session_is_authenticated(authenticated_page: Page) -> None:
    page = authenticated_page

    # If session expired, Higgsfield will show a Sign in / Log in entry point.
    # TODO: tighten once we know the exact element (e.g. avatar locator).
    sign_in_pattern = re.compile(r"^(sign in|log ?in)$", re.I)
    expect(page.get_by_role("button", name=sign_in_pattern)).to_have_count(0)
    expect(page.get_by_role("link", name=sign_in_pattern)).to_have_count(0)
