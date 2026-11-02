import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmFromEvent } from '../lib/confirm.ts';
import { buildTurns } from '../lib/transcript.ts';

test('a confirm_request becomes a yes/no question for the overlay', () => {
  assert.deepEqual(
    confirmFromEvent({
      type: 'confirm_request',
      action: 'close_window',
      target: 'Notes',
      question: 'Close Notes?',
      ts: 5,
    }),
    { id: '5', question: 'Close Notes?' }
  );
  assert.equal(
    confirmFromEvent({ type: 'confirm_request', action: 'click', target: 'Buy now', ts: 6 })
      ?.question,
    'Click “Buy now”?'
  );
  assert.equal(confirmFromEvent({ type: 'action_start', action: 'click', target: 'x' }), null);
  assert.equal(confirmFromEvent('nope'), null);
});

test('the caption never shows streamed text twice', () => {
  const agent = { isLocal: false };
  // Interim segment, then the final arrives under a new id with the full sentence.
  const turns = buildTurns([
    { id: 'seg-a', type: 'agentTranscript', message: 'Opening YouTube for', from: agent },
    { id: 'seg-b', type: 'agentTranscript', message: 'Opening YouTube for you now.', from: agent },
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, 'Opening YouTube for you now.');
  // Two genuinely different replies stay separate.
  const two = buildTurns([
    { id: 'a', type: 'agentTranscript', message: 'Done.', from: agent },
    { id: 'b', type: 'agentTranscript', message: 'Anything else?', from: agent },
  ]);
  assert.equal(two.length, 2);
});
