import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DONE_MS,
  type IslandInput,
  WAKE_MS,
  captionTail,
  currentSteps,
  faceState,
  islandView,
  lineTone,
  voiceStatus,
  windowModeFor,
} from '../lib/island.ts';

const base: IslandInput = {
  surface: 'strip',
  uiState: 'listening',
  userCaption: '',
  agentCaption: '',
  hasConfirm: false,
  hasNotice: false,
  hasSteps: false,
  fullScreen: false,
  menu: null,
  sinceActivate: 5_000,
};

test('resting, sliver and menu when voice is off', () => {
  assert.equal(islandView({ ...base, surface: 'orb' }), 'resting');
  assert.equal(islandView({ ...base, surface: 'orb', fullScreen: true }), 'sliver');
  assert.equal(islandView({ ...base, surface: 'orb', fullScreen: true, menu: 'menu' }), 'menu');
  // A voice session that ended goes back to exactly the resting view.
  assert.equal(
    islandView({ ...base, surface: 'orb', uiState: 'listening', userCaption: 'hi' }),
    'resting'
  );
});

test('wake heard first, then listening even while still connecting', () => {
  assert.equal(islandView({ ...base, sinceActivate: 0, uiState: 'thinking' }), 'wake');
  assert.equal(islandView({ ...base, sinceActivate: WAKE_MS, uiState: 'thinking' }), 'listening');
});

test('understood, acting, speaking, confirm and offline', () => {
  assert.equal(islandView({ ...base, userCaption: 'open youtube' }), 'understood');
  assert.equal(
    islandView({ ...base, uiState: 'thinking', userCaption: 'open youtube' }),
    'understood'
  );
  assert.equal(islandView({ ...base, uiState: 'acting' }), 'acting');
  assert.equal(islandView({ ...base, hasSteps: true, uiState: 'thinking' }), 'acting');
  assert.equal(
    islandView({ ...base, uiState: 'speaking', userCaption: 'x', agentCaption: 'Done.' }),
    'speaking'
  );
  // After a reply the follow-up window listens again.
  assert.equal(islandView({ ...base, userCaption: 'x', agentCaption: 'Done.' }), 'listening');
  assert.equal(islandView({ ...base, hasConfirm: true, uiState: 'speaking' }), 'confirm');
  assert.equal(islandView({ ...base, hasNotice: true }), 'offline');
});

test('main hears idle, caption or menu (only the menu takes the mouse)', () => {
  assert.equal(windowModeFor('resting'), 'idle');
  assert.equal(windowModeFor('sliver'), 'idle');
  assert.equal(windowModeFor('menu'), 'menu');
  for (const view of ['wake', 'listening', 'acting', 'confirm', 'speaking', 'offline'] as const)
    assert.equal(windowModeFor(view), 'caption');
});

test('full screen shows the line, unless voice is active', () => {
  assert.equal(islandView({ ...base, surface: 'orb', fullScreen: true }), 'sliver');
  assert.equal(islandView({ ...base, fullScreen: true }), 'listening');
});

test('voice status gives a state, a reason and an action', () => {
  const ok = {
    voiceOff: false,
    offline: false,
    micMissing: false,
    wakePhrase: 'hey-vision' as const,
  };
  assert.deepEqual(voiceStatus(ok), { on: true, text: 'Say “Hey Vision” to talk' });
  assert.equal(
    voiceStatus({ ...ok, wakePhrase: 'vision', hotkey: 'Ctrl Alt Space' }).text,
    'Say “Vision” to talk · or Ctrl Alt Space'
  );
  assert.equal(
    voiceStatus({ ...ok, voiceOff: true }).text,
    'Voice is off · Voice keys missing · Add keys'
  );
  assert.equal(voiceStatus({ ...ok, offline: true }).text.split(' · ').length, 3);
  assert.equal(voiceStatus({ ...ok, micMissing: true }).on, false);
});

test('a long caption keeps its newest words and fits one line', () => {
  assert.equal(captionTail('Done.'), 'Done.');
  const tail = captionTail(
    'It is thirty-one degrees and humid in Mumbai, with light rain likely after four.'
  );
  assert.ok(tail.startsWith('…') && tail.endsWith('after four.') && tail.length <= 52);
});

test('face state: paused wins over unseen', () => {
  assert.equal(faceState(null), 'tracking');
  assert.equal(faceState({ tracking: true, seen: true }), 'tracking');
  assert.equal(faceState({ tracking: true, seen: false }), 'unseen');
  assert.equal(faceState({ tracking: false, seen: false }), 'paused');
});

test('steps of the current request, then a short done window', () => {
  const now = 100_000;
  const activity = [
    { id: 'b', status: 'running' as const, ts: now - 500 },
    { id: 'a', status: 'done' as const, ts: now - 2_000 },
    { id: 'old', status: 'done' as const, ts: now - 60_000 },
  ];
  assert.deepEqual(
    currentSteps(activity, now - 10_000, now).map((s) => s.id),
    ['a', 'b']
  );
  const finished = [{ ...activity[0], status: 'done' as const }, activity[1]];
  assert.equal(currentSteps(finished, now - 10_000, now + DONE_MS, now).length, 0);
  assert.equal(currentSteps(finished, now - 10_000, now + 1_000, now).length, 2);
  assert.equal(currentSteps(activity, now, now).length, 0);
});

test('full-screen line colour follows the state', () => {
  const rest = { voiceOn: false, offline: false, face: 'tracking' as const, uiState: 'idle' };
  assert.equal(lineTone(rest), 'idle');
  assert.equal(lineTone({ ...rest, voiceOn: true, uiState: 'listening' }), 'accent');
  assert.equal(lineTone({ ...rest, offline: true }), 'warn');
  assert.equal(lineTone({ ...rest, face: 'unseen' }), 'warn');
  assert.equal(lineTone({ ...rest, face: 'paused' }), 'dim');
});
