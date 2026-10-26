import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FrontendErrorPayload } from '../../src/browser/listener.js';
import { ErrorStore } from '../../src/mcp/errorStore.js';

function payload(message: string): FrontendErrorPayload {
  return {
    source: 'pageerror',
    name: 'TypeError',
    message,
    stack: undefined,
    filePath: undefined,
    line: undefined,
    column: undefined,
    pageUrl: 'http://localhost:5173/',
    timestamp: new Date(0).toISOString(),
  };
}

test('drain returns errors in insertion order and empties the store', () => {
  const store = new ErrorStore();
  for (const m of ['a', 'b', 'c']) store.add(payload(m));
  const first = store.drain();
  assert.deepEqual(first.errors.map((e) => e.error.message), ['a', 'b', 'c']);
  assert.equal(first.dropped, 0);
  assert.deepEqual(store.drain(), { errors: [], dropped: 0 });
});

test('a full store drops the oldest errors and counts them', () => {
  const store = new ErrorStore(100);
  for (let i = 0; i < 105; i++) store.add(payload(String(i)));
  const { errors, dropped } = store.drain();
  assert.equal(errors.length, 100);
  assert.equal(errors[0]?.error.message, '5');
  assert.equal(errors[99]?.error.message, '104');
  assert.equal(dropped, 5);
  assert.equal(store.drain().dropped, 0);
});

test('repeats of a buffered error are counted, not stored again', () => {
  const store = new ErrorStore();
  for (let i = 0; i < 3; i++) store.add(payload('same'));
  store.add(payload('other'));
  const { errors } = store.drain();
  assert.deepEqual(errors.map((e) => [e.error.message, e.occurrences]), [['same', 3], ['other', 1]]);
});

test('an error that recurs after a drain is reported again', () => {
  const store = new ErrorStore();
  store.add(payload('same'));
  store.drain();
  store.add(payload('same'));
  assert.equal(store.drain().errors.length, 1);
});
