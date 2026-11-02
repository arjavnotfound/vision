# Privacy

This describes what VISION does with your data. It was written against the code in this
repository; if you find something that does not match, please open an issue.

## Face control

- The camera picture is processed on your computer, frame by frame, to find your face.
- Camera frames are never sent anywhere and never saved to disk.
- Face control works fully offline and needs no account or key.

## Voice assistant

The assistant is optional. It only runs after you add voice keys in Settings.

- Your microphone audio goes online only while the assistant is listening: when the
  strip or console is open and the microphone is not muted. When VISION is collapsed to
  the orb, the microphone is off.
  - Exception: if you turn on wake-word mode ("Hey Vision"), VISION keeps listening while
    it is on, so audio is sent continuously.
  - The experimental browser wake word in Settings (off by default) uses Chromium's speech
    recognition, which sends audio to Google while it is on.
- Audio travels over LiveKit (WebRTC) to Google's Gemini Live API, which understands it
  and speaks the reply. These services are run by LiveKit and Google under their own terms,
  using the accounts whose keys you entered.
- What the assistant can send to Gemini, besides your voice: text of web pages it opens
  for you, the titles of your open windows when you ask it to switch, close or find a
  window, and what you dictate.
- Your keys are stored on your computer, encrypted with Windows data protection
  (Electron `safeStorage`). They are only sent to LiveKit and Google to sign in.
- Web tasks run in a separate Microsoft Edge instance with a fresh, temporary profile. It
  does not use your own Edge profile, cookies or passwords.

## What VISION does not do

- No telemetry, analytics or crash reports.
- No account with VISION; there is no VISION server.

## Updates

The installed app (not the Microsoft Store version) checks GitHub Releases for a new
version when it starts. This request goes to GitHub and contains no personal data beyond
what any web request contains (your IP address).

## Local files

- Settings: `%APPDATA%\VISION`.
- Logs: `%APPDATA%\VISION\logs` (`main.log`, `agent.log`). They stay on your computer. The
  agent log can contain what you asked for, so check it before sharing it in a bug report.
