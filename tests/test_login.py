"""Verify the saved session is still valid."""
import pytest
from playwright.sync_api import Page, expect

from tests.conftest import _clerk_user_id


@pytest.mark.smoke
def test_session_is_authenticated(authenticated_page: Page) -> None:
    """The authenticated_page fixture already skips if Clerk session is expired.
    This test double-checks that the UI reflects the authenticated state."""
    page = authenticated_page

    # Clerk must know who we are (fixture already skips if not)
    assert _clerk_user_id(page), "Clerk session lost during test"

    # Image gen page shows the prompt textbox only when the app loaded properly
    expect(page.get_by_role("textbox")).to_be_visible()

    # Login / Sign-up links must be absent when authenticated
    expect(page.get_by_role("link", name="Login")).to_have_count(0)
    expect(page.get_by_role("link", name="Sign up")).to_have_count(0)
