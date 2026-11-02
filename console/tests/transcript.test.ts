import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTurns, latestTurn } from '../lib/transcript.ts';

const user = { isLocal: true };
const agent = { isLocal: false };

test('interim updates with the same id replace text in place', () => {
  const turns = buildTurns([
    { id: 's1', type: 'agentTranscript', message: 'Hi', from: agent },
    { id: 's1', type: 'agentTranscript', message: 'Hi, I am', from: agent },
    { id: 's1', type: 'agentTranscript', message: 'Hi, I am VISION.', from: agent },
  ]);
  assert.deepEqual(
    turns.map((t) => t.text),
    ['Hi, I am VISION.']
  );
});

test('never appends the same text twice', () => {
  const turns = buildTurns([
    { id: 'a', type: 'userTranscript', message: 'open youtube', from: user },
    // Same utterance arriving over a second transport with a different id.
    { id: 'b', type: 'userTranscript', message: 'open  youtube ', from: user },
    { id: 'c', type: 'agentTranscript', message: 'Opening it.', from: agent },
  ]);
  assert.deepEqual(
    turns.map((t) => `${t.speaker}:${t.text}`),
    ['user:open youtube', 'agent:Opening it.']
  );
});

test('keeps first-seen order and drops empty segments', () => {
  const turns = buildTurns([
    { id: 'u1', type: 'userTranscript', message: 'hello', from: user },
    { id: 'a1', type: 'agentTranscript', message: '', from: agent },
    { id: 'a1', type: 'agentTranscript', message: 'Hey.', from: agent },
    { id: 'u2', type: 'userTranscript', message: 'scroll down', from: user },
    { id: 'u1', type: 'userTranscript', message: 'hello there', from: user },
  ]);
  assert.deepEqual(
    turns.map((t) => t.text),
    ['hello there', 'Hey.', 'scroll down']
  );
  assert.equal(latestTurn(turns, 'agent')?.text, 'Hey.');
  assert.equal(latestTurn(turns, 'user')?.text, 'scroll down');
});

test('typed chat messages use the sender to pick the speaker', () => {
  const turns = buildTurns([
    { id: 'c1', type: 'chatMessage', message: 'Open YouTube', from: user },
    { id: 'c2', type: 'chatMessage', message: 'Done.', from: agent },
  ]);
  assert.deepEqual(
    turns.map((t) => t.speaker),
    ['user', 'agent']
  );
});
