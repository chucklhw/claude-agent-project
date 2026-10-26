import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSession, type BrowserControl } from '../../src/mcp/browserSession.js';

interface FakeBrowser extends BrowserControl {
  url: string;
  starts: number;
  stops: number;
  gotos: string[];
  close(): void;
}

// Records calls; close() simulates the user closing the window. `startGate` holds start() open until resolved.
// Like BrowserConsoleListener, the browser exists once start() has launched it, even if start() then fails.
function fakeFactory(options: { startError?: Error; startGate?: Promise<void> } = {}) {
  const created: FakeBrowser[] = [];
  const factory = (url: string, onClose: () => void): BrowserControl => {
    let launched = false;
    const browser: FakeBrowser = {
      url,
      starts: 0,
      stops: 0,
      gotos: [],
      async start() {
        browser.starts++;
        await options.startGate;
        launched = true;
        if (options.startError) throw options.startError;
      },
      async goto(u) {
        if (!launched) throw new Error('Browser is not open');
        browser.gotos.push(u);
      },
      async stop() {
        if (!launched) return;
        browser.stops++;
        onClose();
      },
      close: onClose,
    };
    created.push(browser);
    return browser;
  };
  return { created, factory };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

test('open starts a browser, then navigates the open one', async () => {
  const { created, factory } = fakeFactory();
  const session = new BrowserSession(factory);
  assert.equal(await session.open('http://a.test/'), 'opened');
  assert.equal(await session.open('http://b.test/'), 'navigated');
  assert.equal(created.length, 1);
  assert.equal(created[0]?.url, 'http://a.test/');
  assert.equal(created[0]?.starts, 1);
  assert.deepEqual(created[0]?.gotos, ['http://b.test/']);
  assert.equal(session.isOpen(), true);
});

test('after the user closes the window, open relaunches', async () => {
  const { created, factory } = fakeFactory();
  const session = new BrowserSession(factory);
  await session.open('http://a.test/');
  created[0]?.close();
  assert.equal(session.isOpen(), false);
  assert.equal(await session.open('http://a.test/'), 'opened');
  assert.equal(created.length, 2);
});

test('a failed start leaves the session closed and rethrows', async () => {
  const { factory } = fakeFactory({ startError: new Error('profile in use') });
  const session = new BrowserSession(factory);
  await assert.rejects(session.open('http://a.test/'), /profile in use/);
  assert.equal(session.isOpen(), false);
});

test('a failed start stops the half-started browser so it does not hold the profile', async () => {
  const { created, factory } = fakeFactory({ startError: new Error('net::ERR_CONNECTION_REFUSED') });
  const session = new BrowserSession(factory);
  await assert.rejects(session.open('http://a.test/'));
  assert.equal(created[0]?.stops, 1);
});

test('open during a launch waits for it, then navigates', async () => {
  const gate = deferred();
  const { created, factory } = fakeFactory({ startGate: gate.promise });
  const session = new BrowserSession(factory);
  const first = session.open('http://a.test/');
  const second = session.open('http://b.test/');
  gate.resolve();
  assert.equal(await first, 'opened');
  assert.equal(await second, 'navigated');
  assert.equal(created.length, 1);
  assert.deepEqual(created[0]?.gotos, ['http://b.test/']);
});

test('close during a launch stops the browser once it has started', async () => {
  const gate = deferred();
  const { created, factory } = fakeFactory({ startGate: gate.promise });
  const session = new BrowserSession(factory);
  const opening = session.open('http://a.test/');
  const closing = session.close();
  gate.resolve();
  await opening.catch(() => {});
  assert.equal(await closing, true);
  assert.equal(created[0]?.stops, 1);
  assert.equal(session.isOpen(), false);
});

test('close reports whether a browser was open', async () => {
  const { factory } = fakeFactory();
  const session = new BrowserSession(factory);
  assert.equal(await session.close(), false);
  await session.open('http://a.test/');
  assert.equal(await session.close(), true);
  assert.equal(session.isOpen(), false);
});
