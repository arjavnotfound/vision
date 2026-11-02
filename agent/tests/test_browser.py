import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import browser as browser_module
from browser import BrowserError, BrowserManager
from tools import BrowserTools


def test_validate_url_accepts_http_urls() -> None:
    # A bare domain gets https:// (stage finding: web.whatsapp.com failed).
    BrowserManager._validate_url("example.com")
    BrowserManager._validate_url("https://example.com/path")
    BrowserManager._validate_url("http://localhost:3000")


@pytest.mark.parametrize(
    "url",
    [
        "file:///tmp/page.html",
        "javascript:alert(1)",
        "https://user:password@example.com",
    ],
)
def test_validate_url_rejects_unsafe_urls(url: str) -> None:
    with pytest.raises(BrowserError):
        BrowserManager._validate_url(url)


def test_consequential_controls_require_confirmation() -> None:
    assert BrowserTools._requires_confirmation("Submit order")
    assert BrowserTools._requires_confirmation("Delete account")
    assert not BrowserTools._requires_confirmation("Search")


def test_direct_navigation_is_prioritized_over_fallback_search() -> None:
    tools = BrowserTools(BrowserManager(headless=True)).tools

    assert [tool.id for tool in tools[:2]] == ["open_url", "search_the_web"]


@pytest.mark.asyncio
async def test_visible_browser_window_is_brought_to_front(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakePage:
        def __init__(self) -> None:
            self.titles: list[str] = []
            self.was_brought_to_front = False

        async def title(self) -> str:
            return "Original title"

        async def evaluate(self, expression: str, title: str) -> None:
            self.titles.append(title)

        async def bring_to_front(self) -> None:
            self.was_brought_to_front = True

    focused_titles: list[str] = []
    monkeypatch.setattr(
        browser_module,
        "_focus_window_with_title",
        lambda title: focused_titles.append(title) or True,
    )
    page = FakePage()

    await browser_module._bring_page_window_to_front(page)

    assert page.was_brought_to_front
    assert len(focused_titles) == 1
    assert focused_titles[0].startswith("VISION Browser ")
    assert page.titles == [focused_titles[0], "Original title"]


class _TestPageHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = b"""
        <html>
          <body>
            <label for="search">Search</label>
            <input id="search" type="search" placeholder="Search the site">
            <button>Go</button>
          </body>
        </html>
        """
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, message_format: str, *args: object) -> None:
        return


@pytest.mark.asyncio
async def test_inspect_and_interact_with_local_page() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _TestPageHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    manager = BrowserManager(headless=True)

    try:
        await manager.open_url(f"http://127.0.0.1:{server.server_port}")
        inspected = await manager.inspect_page()
        elements = inspected["elements"]

        assert isinstance(elements, list)
        assert any(element["name"] == "Search" for element in elements)
        assert any(element["name"] == "Go" for element in elements)

        await manager.type_text("Search", "LiveKit")
        await manager.click("Go")
    finally:
        await manager.close()
        server.shutdown()
        thread.join(timeout=2)


def test_normalize_url_spotify_and_known_sites() -> None:
    assert browser_module.normalize_target_url("spotify") == "https://open.spotify.com"
    assert browser_module.normalize_target_url("open.spotify.com") == "https://open.spotify.com"
    assert browser_module.normalize_target_url("youtube") == "https://www.youtube.com"
    assert browser_module.normalize_target_url("github") == "https://github.com"
    assert browser_module.normalize_target_url("https://example.com") == "https://example.com"


def test_normalize_keyboard_keys_and_shortcuts() -> None:
    assert browser_module.normalize_key_stroke("enter") == "Enter"
    assert browser_module.normalize_key_stroke("esc") == "Escape"
    assert browser_module.normalize_key_stroke("escape") == "Escape"
    assert browser_module.normalize_key_stroke("tab") == "Tab"
    assert browser_module.normalize_key_stroke("backspace") == "Backspace"
    assert browser_module.normalize_key_stroke("space") == "Space"
    assert browser_module.normalize_key_stroke("ctrl+a") == "Control+a"
    assert browser_module.normalize_key_stroke("Control+A") == "Control+a"
    assert browser_module.normalize_key_stroke("ctrl+c") == "Control+c"
    assert browser_module.normalize_key_stroke("shift+tab") == "Shift+Tab"
    assert browser_module.normalize_key_stroke("arrowdown") == "ArrowDown"


@pytest.mark.asyncio
async def test_keyboard_press_and_type_execution() -> None:
    class _KeyTestPageHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            body = b"""
            <html>
              <body>
                <input id="test-input" type="text" autofocus>
                <div id="status">initial</div>
                <script>
                  document.getElementById('test-input').addEventListener('keydown', (e) => {
                    document.getElementById('status').innerText = 'key:' + e.key;
                  });
                </script>
              </body>
            </html>
            """
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, message_format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), _KeyTestPageHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    manager = BrowserManager(headless=True)

    try:
        url = f"http://127.0.0.1:{server.server_port}"
        res1 = await manager.open_url(url)
        assert res1["url"].rstrip('/') == url.rstrip('/')

        # Test idempotency: calling open_url again returns already_open without reload
        res2 = await manager.open_url(url)
        assert res2.get("status") == "already_open"

        # Type text
        await manager.type_text("test-input", "VISION")

        # Press Enter key
        key_res = await manager.press_key("Enter")
        assert key_res["key"] == "Enter"

        # Press Escape key
        esc_res = await manager.press_key("Escape")
        assert esc_res["key"] == "Escape"

        # Press Ctrl+A
        ctrl_res = await manager.press_key("ctrl+a")
        assert ctrl_res["key"] == "Control+a"

        # Verify page content
        read_res = await manager.read_page()
        assert "key:a" in str(read_res["text"]) or "key:" in str(read_res["text"])
    finally:
        await manager.close()
        server.shutdown()
        thread.join(timeout=2)



@pytest.mark.asyncio
async def test_open_url_reuses_single_page_and_survives_closed_tab() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _TestPageHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    manager = BrowserManager(headless=True)
    base = f"http://127.0.0.1:{server.server_port}"

    try:
        await manager.open_url(f"{base}/a")
        first_page = manager._page
        await manager.open_url(f"{base}/b")
        # Same path, different query must navigate (it used to be a silent no-op).
        res = await manager.open_url(f"{base}/b?q=two")
        assert res.get("status") != "already_open"
        assert manager._page is first_page
        assert len(manager._context.pages) == 1

        # A tab closed by the user is replaced inside the same context.
        context = manager._context
        await first_page.close()
        await manager.open_url(f"{base}/c")
        assert manager._context is context
        assert len(context.pages) == 1
        assert manager._page.url.endswith("/c")
    finally:
        await manager.close()
        server.shutdown()
        thread.join(timeout=2)


@pytest.mark.asyncio
async def test_popups_are_folded_into_the_main_page() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _TestPageHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    manager = BrowserManager(headless=True)
    base = f"http://127.0.0.1:{server.server_port}"

    try:
        await manager.open_url(f"{base}/start")
        page = manager._page
        await page.evaluate(f"window.open('{base}/popup', '_blank')")
        await page.wait_for_url("**/popup", timeout=5_000)
        assert len(manager._context.pages) == 1
    finally:
        await manager.close()
        server.shutdown()
        thread.join(timeout=2)
