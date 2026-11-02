"""Noise guard: short or unclear speech never acts; unclear opens need a yes first."""

import pytest
from livekit.agents.llm import ToolError

from desktop_tools import DesktopTools
from intent_guard import IntentError, IntentGuard, NeedsConfirmationError, target_words
from tools import ActionGuard, BrowserTools


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def guard_after(text: str, *, typed: bool = False) -> IntentGuard:
    g = IntentGuard(clock=Clock())
    g.note_user(text, typed=typed)
    return g


@pytest.mark.parametrize(
    "said, target",
    [
        ("open reddit", "reddit.com"),
        ("go to YouTube", "youtube.com"),
        ("can you open WhatsApp for me", "WhatsApp"),
        ("search YouTube for cats", "youtube.com"),
        ("play some music on Spotify", "open.spotify.com"),
        ("what's the weather in Delhi", "current weather in Delhi"),
        ("YouTube please", "https://www.youtube.com/"),
    ],
)
def test_clear_requests_open(said, target):
    guard_after(said).check_open(target)


@pytest.mark.parametrize(
    "said, target",
    [
        ("honest better", "reddit.com"),  # real misheard room noise from testing
        ("mm hmm", "youtube.com"),
        ("I knew control my computer", "Notepad"),
    ],
)
def test_unclear_requests_need_a_yes(said, target):
    g = guard_after(said)
    with pytest.raises(NeedsConfirmationError):
        g.check_open(target)
    g.confirm(target.split("//")[-1].removeprefix("www."))
    g.check_open(target)  # after a yes it goes through, once
    with pytest.raises(NeedsConfirmationError):
        g.check_open(target)


def test_nothing_said_recently_needs_a_yes():
    clock = Clock()
    g = IntentGuard(clock=clock)
    g.note_user("open youtube")
    clock.now += 60
    with pytest.raises(NeedsConfirmationError):
        g.check_open("youtube.com")


def test_typed_quick_commands_are_trusted():
    g = guard_after("YouTube", typed=True)
    g.check_open("youtube.com")
    g.check_action()


@pytest.mark.parametrize(
    "said",
    [
        "click",
        "double click",
        "right click",
        "scroll down",
        "drop",
        "yes",
        "press enter",
    ],
)
def test_short_commands_still_act(said):
    guard_after(said).check_action()


@pytest.mark.parametrize("said", ["hmm", "honest better", "uh huh", "okay"])
def test_short_noise_never_acts(said):
    with pytest.raises(IntentError):
        guard_after(said).check_action()


def test_target_words():
    assert target_words("https://www.reddit.com/r/x") == ["reddit"]
    assert target_words("open.spotify.com") == ["open", "spotify"]
    assert target_words("Microsoft Word") == ["microsoft", "word"]


class FakeDesktop:
    def __init__(self) -> None:
        self.calls = []

    def click(self, button, count):
        self.calls.append(("click", button, count))

    def known_app(self, name):
        return ["notepad.exe"]

    def launch(self, argv):
        self.calls.append(("launch", tuple(argv)))

    def find_window(self, name):
        return (1, "Untitled - Notepad")

    def focus_window(self, hwnd):
        pass


class FakeBrowser:
    def __init__(self) -> None:
        self.opened = []

    async def open_url(self, url):
        self.opened.append(url)
        return {"url": url, "title": url}


@pytest.mark.asyncio
async def test_noise_does_not_open_a_site_or_app_but_a_yes_does():
    intent = guard_after("honest better")
    events = []

    async def on_event(e):
        events.append(e)

    browser = FakeBrowser()
    btools = BrowserTools(
        browser, action_callback=on_event, guard=ActionGuard(), intent=intent
    )
    backend = FakeDesktop()
    dtools = DesktopTools(
        action_callback=on_event, guard=ActionGuard(), backend=backend, intent=intent
    )

    with pytest.raises(ToolError, match="Ask the user"):
        await btools.open_url(None, "reddit.com")
    with pytest.raises(ToolError, match="Ask the user"):
        await dtools.open_app(None, "Notepad")
    with pytest.raises(ToolError, match=r"(?i)not clear"):
        await dtools.click_here(None, "left")
    assert browser.opened == [] and backend.calls == []
    questions = [e.get("question") for e in events if e["type"] == "confirm_request"]
    assert questions == ["Open reddit.com?", "Open Notepad?"]

    intent.note_user("yes")  # spoken, or the dwell Yes button
    await btools.confirm_open(None, "reddit")
    await btools.open_url(None, "reddit.com")
    assert browser.opened == ["reddit.com"]


# ---- Stage findings (real run, 14 Oct) --------------------------------------------


def test_real_run_one_word_commands_act():
    guard_after("clicked").check_action()  # was refused as "heard only 'clicked'"
    guard_after("scrolling").check_action()
    guard_after("Google").check_open("google.com")  # the target was named


def test_after_the_wake_word_short_commands_are_intended():
    clock = Clock()
    g = IntentGuard(clock=clock)
    g.note_wake()
    g.note_user("next one")
    g.check_action()
    clock.now += 30
    g.note_user("mm hmm")
    with pytest.raises(IntentError):
        g.check_action()


def test_never_ask_twice_for_one_request():
    clock = Clock()
    g = IntentGuard(clock=clock)
    g.note_user("I can also close my eyes for two seconds")
    with pytest.raises(NeedsConfirmationError):
        g.check_open("web.whatsapp.com")
    clock.now += 3
    g.note_user("Sure.")
    g.check_open(
        "https://web.whatsapp.com/"
    )  # the reply answers it: no second question


def test_a_no_after_the_question_does_not_open():
    clock = Clock()
    g = IntentGuard(clock=clock)
    g.note_user("hmm whatever")
    with pytest.raises(NeedsConfirmationError):
        g.check_open("reddit.com")
    clock.now += 2
    g.note_user("No, don't.")
    with pytest.raises(IntentError):
        g.check_open("reddit.com")


@pytest.mark.asyncio
async def test_google_and_bare_domains_open_without_a_second_question():
    intent = guard_after("Google")
    browser = FakeBrowser()
    tools = BrowserTools(browser, guard=ActionGuard(), intent=intent)
    await tools.open_url(None, "google.com")
    assert browser.opened == ["google.com"]


def test_bare_domains_get_https():
    from browser import normalize_target_url

    assert normalize_target_url("web.whatsapp.com") == "https://web.whatsapp.com"
    assert (
        normalize_target_url("en.wikipedia.org/wiki/Human_eye")
        == "https://en.wikipedia.org/wiki/Human_eye"
    )
    assert normalize_target_url("https://example.com") == "https://example.com"
    assert normalize_target_url("not a url") == "not a url"


# ---- Wake gate (stage: the presenter narrates; only "Hey Vision ..." acts) -------------

from intent_guard import has_wake_word  # noqa: E402


@pytest.mark.parametrize(
    "said",
    [
        "Hey Vision, open Notepad",
        "hi vision open youtube",
        "Hey Visions, click",
        "A vision, close Notepad",
        "so now, hey Vision, open Wikipedia",
    ],
)
def test_wake_phrases(said):
    assert has_wake_word(said)


@pytest.mark.parametrize(
    "said",
    ["VISION is our project", "this is our vision for accessibility", "envision this"],
)
def test_narration_is_not_a_wake(said):
    assert not has_wake_word(said)


def test_gate_ignores_narration_and_acts_on_the_wake_word():
    clock = Clock()
    g = IntentGuard(clock=clock, wake_required=True)
    g.note_user("VISION can open any app on the computer, for example Notepad")
    assert g.ignoring
    with pytest.raises(IntentError, match="Hey Vision"):
        g.check_open("Notepad")
    with pytest.raises(IntentError, match="Hey Vision"):
        g.check_action()
    clock.now += 5
    g.note_user("Hey Vision, open Notepad and type hello from VISION")
    assert not g.ignoring
    g.check_open("Notepad")
    g.check_action()
    clock.now += 4
    g.note_user("No")  # answer to "Save changes?" inside the follow-up window
    g.check_action()
    clock.now += 30
    g.note_user("and that is how it works")
    with pytest.raises(IntentError):
        g.check_action()


def test_without_the_gate_nothing_changes():
    g = IntentGuard(clock=Clock())
    g.note_user("open Notepad please")
    assert not g.ignoring
    g.check_open("Notepad")
