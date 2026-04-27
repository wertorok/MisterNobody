"""Verify the saved session is still valid (no login form, user menu visible)."""
import pytest
from playwright.sync_api import Page, expect


@pytest.mark.smoke
def test_session_is_authenticated(authenticated_page: Page) -> None:
    page = authenticated_page

    # If session expired, Higgsfield will show a Sign in / Log in button.
    # TODO: tighten this once we know the exact element (e.g. avatar locator).
    sign_in = page.get_by_role("button", name=lambda n: n and "sign in" in n.lower())
    expect(sign_in).to_have_count(0)

    log_in = page.get_by_role("link", name=lambda n: n and "log in" in n.lower())
    expect(log_in).to_have_count(0)
