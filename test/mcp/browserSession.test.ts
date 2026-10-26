import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSession, type BrowserControl } from '../../src/mcp/browserSession.js';

interface FakeBrowser extends BrowserControl {
  url: string;
  starts: number;
  gotos: string[];
  close(): void;
}

// Records calls; close() simulates the user closing the window
function fakeFactory(startError?: Error) {
  const created: FakeBrowser[] = [];
  const factory = (url: string, onClose: () => void): BrowserControl => {
    const browser: FakeBrowser = {
      url,
      starts: 0,
      gotos: [],
      async start() {
        browser.starts++;
        if (startError) throw startError;
      },
      async goto(u) {
        browser.gotos.push(u);
      },
      async stop() {
        onClose();
      },
      close: onClose,
    };
    created.push(browser);
    return browser;
  };
  return { created, factory };
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
  const { factory } = fakeFactory(new Error('profile in use'));
  const session = new BrowserSession(factory);
  await assert.rejects(session.open('http://a.test/'), /profile in use/);
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
