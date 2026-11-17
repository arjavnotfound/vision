import assert from 'node:assert/strict';
import { test } from 'node:test';
import { helpFromEvent } from '../lib/confirm.ts';
import { type IslandInput, islandView } from '../lib/island.ts';
import { PROBLEM_TEXT, clearProblem, reportProblem } from '../lib/problems.ts';

const base: IslandInput = {
  surface: 'strip',
  uiState: 'speaking',
  userCaption: 'what can I say',
  agentCaption: 'On YouTube you can say play or pause.',
  hasConfirm: false,
  hasNotice: false,
  hasSteps: false,
  fullScreen: false,
  menu: null,
  sinceActivate: 5_000,
};

test('the help card shows while voice is on; a yes/no question wins', () => {
  assert.equal(islandView({ ...base, hasHelp: true }), 'help');
  assert.equal(islandView({ ...base, hasHelp: true, hasConfirm: true }), 'confirm');
  assert.equal(islandView({ ...base, hasHelp: true, surface: 'orb' }), 'resting');
});

test('help events are checked and trimmed', () => {
  assert.deepEqual(helpFromEvent({ type: 'help', app: 'YouTube', phrases: ['Play', '', 3] }), {
    app: 'YouTube',
    phrases: ['Play'],
  });
  assert.equal(helpFromEvent({ type: 'help', phrases: [] }), null);
  assert.equal(helpFromEvent({ type: 'action_start' }), null);
  assert.equal(helpFromEvent({ type: 'help', phrases: Array(30).fill('x') })?.phrases.length, 10);
});

test('a problem is said once while it lasts, and again after it clears', () => {
  const said: string[] = [];
  const say = (text: string) => said.push(text);
  assert.equal(reportProblem('mic', say), true);
  assert.equal(reportProblem('mic', say), false);
  assert.equal(reportProblem('voice', say), true);
  clearProblem('mic');
  assert.equal(reportProblem('mic', say), true);
  assert.deepEqual(said, [PROBLEM_TEXT.mic, PROBLEM_TEXT.voice, PROBLEM_TEXT.mic]);
  clearProblem('mic');
  clearProblem('voice');
});
