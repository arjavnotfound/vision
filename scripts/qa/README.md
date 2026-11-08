# QA tools

Run from the repo root. Each writes only to the folder you give it.

## capture-face

Every Face Control screen and state, with the mocked engine (no camera, no mouse control,
throwaway profile):

    node scripts/qa/capture-face.js <dir>

## capture-console

Every console surface (orb, strip, console states and tabs, onboarding) from the
`/preview` route, in a throwaway Google Chrome via Playwright. It starts `next dev` on
port 3999 and stops it when done (first compile takes about a minute):

    cd agent
    uv run python ../scripts/qa/capture-console.py <dir> [--theme paper]

The shipped static export has no `/preview`. A QA build can include it with
`VISION_ENABLE_PREVIEW=1 pnpm build` in `console/` (read at build time).

## probe-windows

How VISION's windows behave next to another app. Start VISION first, then:

    powershell -ExecutionPolicy Bypass -File scripts\qa\probe-windows.ps1 -Out <file> -Edge -Points "768,432;768,736" -Seconds 30

It writes each VISION window's rect and style flags (TOPMOST, click-through, NOACTIVATE),
which window a click at each point would hit, and every foreground change during the
watch. `-Edge` puts a Microsoft Edge window with a throwaway profile in front and closes it
at the end. Do not probe with Notepad: it restores the owner's own tabs into screenshots.

For a live run that never moves the real mouse, start the app with
`VISION_FAKE_INPUT=<log>`, `VISION_USER_DATA_DIR=<temp dir>` and `--synthetic-face`, as
`synthetic-e2e.js` does.

## synthetic-e2e

    node scripts/qa/synthetic-e2e.js

Face Control end to end with a scripted face and a logging mouse driver. Results go to
`last-run.json` (not tracked).
