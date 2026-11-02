import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ActivityItem,
  applyActionEvent,
  domainOf,
  parseActionEvent,
  relativeTime,
} from '../lib/activity.ts';

let n = 0;
const id = () => `id${n++}`;

test('start then done completes the same row', () => {
  let items: ActivityItem[] = [];
  items = applyActionEvent(
    items,
    { type: 'action_start', action: 'open_url', target: 'youtube.com', ts: 1 },
    id
  );
  items = applyActionEvent(
    items,
    {
      type: 'action_done',
      action: 'open_url',
      target: 'youtube.com',
      url: 'https://www.youtube.com/',
      title: 'YouTube',
      ts: 2,
    },
    id
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'done');
  assert.equal(items[0].title, 'YouTube');
  assert.equal(domainOf(items[0]), 'youtube.com');
});

test('errors mark the running row and newest is first', () => {
  let items: ActivityItem[] = [];
  items = applyActionEvent(items, { type: 'action_start', action: 'scroll', target: 'down' }, id);
  items = applyActionEvent(items, { type: 'action_start', action: 'click', target: 'Go' }, id);
  items = applyActionEvent(
    items,
    { type: 'action_error', action: 'click', target: 'Go', error: 'missing' },
    id
  );
  assert.deepEqual(
    items.map((i) => `${i.action}:${i.status}`),
    ['click:error', 'scroll:running']
  );
});

test('parseActionEvent rejects junk and legacy payloads', () => {
  assert.equal(parseActionEvent(null), null);
  assert.equal(parseActionEvent({ type: 'vision_action', action: 'x' }), null);
  assert.equal(parseActionEvent({ type: 'action_done' }), null);
  assert.equal(parseActionEvent({ type: 'action_done', action: 'go_back' })?.target, '');
});

test('relativeTime is compact', () => {
  assert.equal(relativeTime(0, 2_000), 'now');
  assert.equal(relativeTime(0, 42_000), '42s');
  assert.equal(relativeTime(0, 5 * 60_000), '5m');
});
