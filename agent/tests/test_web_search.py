import pytest

from tools import (
    bing_search_url,
    default_search_url,
    duckduckgo_search_url,
    google_search_url,
)


def test_google_search_url_encodes_query() -> None:
    assert (
        google_search_url("  current weather in New York  ")
        == "https://www.google.com/search?q=current+weather+in+New+York"
    )


def test_google_search_url_rejects_empty_query() -> None:
    with pytest.raises(ValueError, match="query cannot be empty"):
        google_search_url("  ")


def test_duckduckgo_search_url_encodes_query() -> None:
    assert (
        duckduckgo_search_url("  current weather in New York  ")
        == "https://duckduckgo.com/?q=current+weather+in+New+York"
    )


def test_duckduckgo_search_url_rejects_empty_query() -> None:
    with pytest.raises(ValueError, match="query cannot be empty"):
        duckduckgo_search_url("  ")


def test_bing_search_url_encodes_query() -> None:
    assert (
        bing_search_url("  current weather in New York  ")
        == "https://www.bing.com/search?q=current+weather+in+New+York"
    )


def test_bing_search_url_rejects_empty_query() -> None:
    with pytest.raises(ValueError, match="query cannot be empty"):
        bing_search_url("  ")


def test_default_search_url_uses_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("VISION_SEARCH_PROVIDER", "bing")
    assert "bing.com" in default_search_url("test")

    monkeypatch.setenv("VISION_SEARCH_PROVIDER", "google")
    assert "google.com" in default_search_url("test")

    monkeypatch.setenv("VISION_SEARCH_PROVIDER", "duckduckgo")
    assert "duckduckgo.com" in default_search_url("test")
