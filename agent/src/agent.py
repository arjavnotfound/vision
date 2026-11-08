import contextlib
import json
import logging

from dotenv import load_dotenv
from google.genai import types as genai_types
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    TurnHandlingOptions,
    cli,
    llm,
    room_io,
)
from livekit.agents.beta.tools import EndCallTool
from livekit.plugins import ai_coustics, google

from browser import BrowserManager
from desktop_tools import DesktopTools
from intent_guard import IntentGuard
from prompts import AGENT_INSTRUCTIONS
from tools import ActionCallback, BrowserTools
from voice_settings import load_voice_settings

load_dotenv(".env.local")
logger = logging.getLogger("vision.agent")


async def text_input_cb(sess: AgentSession, ev: room_io.TextInputEvent) -> None:
    """Route typed text and Quick Commands (topic ``lk.chat``) to the model.

    Gemini 3.1 Live has an immutable chat context, so the framework's default
    (``generate_reply(user_input=...)``) is silently ignored. For such models we send
    the text as realtime input, which Gemini treats like a spoken user turn.
    """
    text = (ev.text or "").strip()
    if not text:
        return
    # Typed text and Quick Commands are deliberate: the noise guard trusts them.
    try:
        intent = getattr(sess.current_agent, "intent", None)
    except RuntimeError:
        intent = None
    if intent is not None:
        intent.note_user(text, typed=True)
    try:
        rt_session = sess.current_agent.realtime_llm_session
    except RuntimeError:
        rt_session = None

    if (
        rt_session is None
        or rt_session.realtime_model.capabilities.mutable_chat_context
    ):
        await room_io.types._default_text_input_cb(sess, ev)
        return

    with contextlib.suppress(Exception):
        await sess.interrupt()
    rt_session._send_client_event(genai_types.LiveClientRealtimeInput(text=text))


class Assistant(Agent):
    def __init__(
        self,
        browser: BrowserManager | None = None,
        on_tool_action: ActionCallback | None = None,
        llm_override: llm.LLM | llm.RealtimeModel | None = None,
    ) -> None:
        self.browser = browser or BrowserManager(headless=True)
        # Noise guard shared by every tool: what the user actually said, and whether it
        # was clear enough to act on (see intent_guard.py).
        self.intent = IntentGuard()
        self.browser_tools = BrowserTools(
            self.browser, action_callback=on_tool_action, intent=self.intent
        )
        # Desktop: voice mouse at the cursor, apps/windows, dictation, keys, VISION control.
        self.desktop_tools = DesktopTools(
            action_callback=on_tool_action, intent=self.intent
        )
        self._end_call_tool = EndCallTool(
            extra_description=(
                "Only end the call after the user clearly says they are finished, "
                "says goodbye, or directly asks to end the call."
            ),
            end_instructions=(
                "Give VISION's brief, polite farewell, then end the call."
            ),
        )

        # Read per session: a voice / language change applies to the next session.
        self.voice_settings = load_voice_settings()
        logger.info(
            "VISION voice session settings: voice=%s language=%s",
            self.voice_settings.voice,
            self.voice_settings.language,
        )
        language_kwargs = (
            {"language": self.voice_settings.language_code}
            if self.voice_settings.language_code
            else {}
        )

        super().__init__(
            # Tests pass a text LLM via llm_override: the Live model cannot run
            # text-only eval turns (generate_reply is unsupported on 3.1 Live).
            llm=llm_override
            or google.beta.realtime.RealtimeModel(
                model="gemini-3.1-flash-live-preview",
                voice=self.voice_settings.voice,
                **language_kwargs,
                tool_response_scheduling=genai_types.FunctionResponseScheduling.WHEN_IDLE,
                # Keeps a session within Gemini Live limits; the plugin already resumes
                # with its session handle after a server GoAway.
                context_window_compression=genai_types.ContextWindowCompressionConfig(
                    sliding_window=genai_types.SlidingWindow(),
                ),
            ),
            instructions=AGENT_INSTRUCTIONS + self.voice_settings.language_rule,
            tools=[
                *self.browser_tools.tools,
                *self.desktop_tools.tools,
                *self._end_call_tool.tools,
            ],
        )


# Production mode (`start`): keep ONE job process warm, so the first command after
# a wake is not slow (dev mode had 0: 'no warmed process available'), and never
# report the worker as full - Face Control's tracking can push CPU past the default
# 70 % threshold, which would stop voice jobs being dispatched.
# Health server on loopback only, any free port: no Windows Firewall prompt.
server = AgentServer(
    num_idle_processes=1, load_threshold=10.0, host="127.0.0.1", port=0
)


@server.rtc_session(agent_name="my-agent")
async def my_agent(ctx: JobContext):
    # Logging setup
    # Add any other context you want in all log entries here
    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    browser = BrowserManager(headless=False)
    ctx.add_shutdown_callback(browser.close)

    # Gemini realtime handles the voice input and output and decides when a turn ends.
    session = AgentSession(
        turn_handling=TurnHandlingOptions(
            # Start the reply while the end of the turn is still being confirmed.
            preemptive_generation={"enabled": True},
        ),
    )

    async def on_tool_action(event: dict) -> None:
        # action_start / action_done / action_error with {action, target, url?, title?, ts}
        try:
            payload = json.dumps(event, separators=(",", ":")).encode("utf-8")
            if ctx.room and ctx.room.local_participant:
                await ctx.room.local_participant.publish_data(
                    payload, topic="vision_events", reliable=True
                )
        except Exception:
            pass

    assistant = Assistant(browser, on_tool_action=on_tool_action)

    async def release_held_buttons() -> None:
        # Never leave a mouse button held by a voice drag when the session ends.
        assistant.desktop_tools.release_all()

    ctx.add_shutdown_callback(release_held_buttons)

    # One clear log line per voice session problem / end (sessions are short-lived: the
    # overlay closes each one after the command; the next wake opens a fresh one).
    @session.on("error")
    def _on_error(ev) -> None:
        err = getattr(ev, "error", ev)
        logger.warning(
            "VISION voice session error (recoverable=%s): %s",
            getattr(err, "recoverable", "?"),
            str(err).splitlines()[0][:200],
        )

    @session.on("close")
    def _on_close(ev) -> None:
        error = getattr(ev, "error", None)
        logger.info(
            "VISION voice session closed: reason=%s%s",
            getattr(ev, "reason", "?"),
            f" error={str(error).splitlines()[0][:200]}" if error else "",
        )

    # Every user turn passes here once.
    last_heard = {"text": ""}

    def _heard(text: str) -> None:
        text = text.strip()
        if not text or text == last_heard["text"]:
            return
        last_heard["text"] = text
        assistant.intent.note_user(text)

    # Noise guard: remember what the user actually said (final transcripts).
    @session.on("user_input_transcribed")
    def _on_transcript(ev) -> None:
        if getattr(ev, "is_final", True):
            _heard(getattr(ev, "transcript", "") or "")

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        item = getattr(ev, "item", None)
        if getattr(item, "role", None) == "user":
            text = getattr(item, "text_content", None) or ""
            if text:
                _heard(text)

    # Start the session, which initializes the voice pipeline and warms up the models
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_options=room_io.RoomOptions(
            # Nothing consumes camera frames, so don't stream video to the model.
            video_input=False,
            text_input=room_io.TextInputOptions(text_input_cb=text_input_cb),
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=ai_coustics.audio_enhancement(
                    model=ai_coustics.EnhancerModel.QUAIL_VF_S
                ),
            ),
        ),
    )

    # Join the room and connect to the user
    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
