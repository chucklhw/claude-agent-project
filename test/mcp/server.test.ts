import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FrontendErrorPayload } from '../../src/browser/listener.js';
import { BrowserSession, type BrowserControl } from '../../src/mcp/browserSession.js';
import { ErrorStore } from '../../src/mcp/errorStore.js';
import { createMcpServer, openOnStartup } from '../../src/mcp/server.js';

function payload(message: string): FrontendErrorPayload {
  return {
    source: 'pageerror',
    name: 'TypeError',
    message,
    stack: undefined,
    filePath: 'http://localhost:5173/src/App.tsx',
    line: 12,
    column: 3,
    pageUrl: 'http://localhost:5173/',
    timestamp: new Date(0).toISOString(),
  };
}

// Each created browser fails to start while `failStart` is set, and to navigate while `failGoto` is set
function fakeBrowsers() {
  const state = { failStart: undefined as Error | undefined, failGoto: undefined as Error | undefined, starts: 0, gotos: [] as string[] };
  const factory = (_url: string, onClose: () => void): BrowserControl => ({
    async start() {
      state.starts++;
      if (state.failStart) throw state.failStart;
    },
    async goto(url) {
      if (state.failGoto) throw state.failGoto;
      state.gotos.push(url);
    },
    async stop() {
      onClose();
    },
  });
  return { state, factory };
}

async function connect() {
  const { state, factory } = fakeBrowsers();
  const session = new BrowserSession(factory);
  const store = new ErrorStore();
  const server = createMcpServer(session, store, 'https://127.0.0.1:8080');
  const client = new Client({ name: 'test', version: '0.0.0' });
  const notifications: unknown[] = [];
  client.fallbackNotificationHandler = async (n) => {
    notifications.push(n);
  };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { state, session, store, client, notifications };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { text: content.map((c) => c.text).join('\n'), isError: result.isError === true };
}

test('lists the three tools', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['close_browser', 'get_errors', 'open_browser']);
});

test('lists the slash-command prompts', async () => {
  const { client } = await connect();
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), ['close', 'fix_errors', 'open']);
});

async function promptText(client: Client, name: string, args: Record<string, string> = {}) {
  const { messages } = await client.getPrompt({ name, arguments: args });
  return messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');
}

test('prompts tell Claude which tool to call', async () => {
  const { client } = await connect();
  assert.match(await promptText(client, 'open', { url: 'http://localhost:5173' }), /open_browser tool with url http:\/\/localhost:5173/);
  assert.doesNotMatch(await promptText(client, 'open'), /with url/);
  assert.match(await promptText(client, 'fix_errors'), /get_errors tool/);
  assert.match(await promptText(client, 'fix_errors'), /wait for the user to approve/);
  assert.match(await promptText(client, 'close'), /close_browser tool/);
});

test('get_errors reports a closed browser', async () => {
  const { client } = await connect();
  assert.equal((await call(client, 'get_errors')).text, 'Browser is not open. Call open_browser first.');
});

test('get_errors returns captured errors once', async () => {
  const { client, store } = await connect();
  await call(client, 'open_browser');
  store.add(payload('first boom'));
  store.add(payload('second boom'));
  const { text } = await call(client, 'get_errors');
  assert.match(text, /^2 new error\(s\):/);
  assert.match(text, /first boom/);
  assert.match(text, /second boom/);
  assert.equal((await call(client, 'get_errors')).text, 'No new frontend errors captured since the last call.');
});

test('get_errors reports dropped errors', async () => {
  const { client, store } = await connect();
  await call(client, 'open_browser');
  for (let i = 0; i < 103; i++) store.add(payload(`boom ${i}`));
  assert.match((await call(client, 'get_errors')).text, /\(3 older errors dropped\)/);
});

test('captured errors are never pushed to the client', async () => {
  const { client, store, notifications } = await connect();
  await call(client, 'open_browser');
  for (let i = 0; i < 5; i++) store.add(payload(`boom ${i}`));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(notifications, []);
});

test('open_browser switches the open browser to a new url and clears old errors', async () => {
  const { client, store, state } = await connect();
  assert.match((await call(client, 'open_browser', { url: 'http://localhost:5173' })).text, /^Browser opened/);
  store.add(payload('old boom'));
  const switched = await call(client, 'open_browser', { url: 'http://emsdev.localhost:8080' });
  assert.equal(switched.text, 'Switched to http://emsdev.localhost:8080, listening for errors there');
  assert.equal(state.starts, 1);
  assert.deepEqual(state.gotos, ['http://emsdev.localhost:8080']);
  assert.equal((await call(client, 'get_errors')).text, 'No new frontend errors captured since the last call.');
});

test('open_browser rejects an invalid url', async () => {
  const { client } = await connect();
  assert.equal((await call(client, 'open_browser', { url: 'not a url' })).isError, true);
});

test('open_browser reports a launch failure and the server keeps running', async () => {
  const { client, state } = await connect();
  state.failStart = new Error('profile in use');
  const result = await call(client, 'open_browser');
  assert.equal(result.isError, true);
  assert.match(result.text, /profile in use/);
  assert.match(result.text, /USER_DATA_DIR/);
  assert.equal((await call(client, 'get_errors')).text, 'Browser is not open. Call open_browser first.');
});

test('close_browser reports whether a browser was open', async () => {
  const { client } = await connect();
  assert.equal((await call(client, 'close_browser')).text, 'Browser is not open');
  await call(client, 'open_browser');
  assert.equal((await call(client, 'close_browser')).text, 'Browser closed');
});

test('openOnStartup never rejects, and open_browser can retry', async () => {
  const { client, session, state } = await connect();
  state.failStart = new Error('connection refused');
  await openOnStartup(session, 'http://localhost:5173');
  assert.equal(session.isOpen(), false);
  state.failStart = undefined;
  assert.match((await call(client, 'open_browser')).text, /^Browser opened, listening on https:\/\/127\.0\.0\.1:8080/);
});

test('get_errors shows how often a buffered error repeated', async () => {
  const { client, store } = await connect();
  await call(client, 'open_browser');
  for (let i = 0; i < 3; i++) store.add(payload('repeated boom'));
  const { text } = await call(client, 'get_errors');
  assert.match(text, /^1 new error\(s\):/);
  assert.match(text, /Occurrences: 3/);
});

test('a failed URL switch reports a navigation failure and keeps the browser open', async () => {
  const { client, session, state } = await connect();
  await call(client, 'open_browser');
  state.failGoto = new Error('net::ERR_NAME_NOT_RESOLVED');
  const result = await call(client, 'open_browser', { url: 'http://unreachable.test' });
  assert.equal(result.isError, true);
  assert.match(result.text, /^Browser is open, but navigation to http:\/\/unreachable\.test failed: net::ERR_NAME_NOT_RESOLVED/);
  assert.doesNotMatch(result.text, /USER_DATA_DIR/);
  assert.equal(session.isOpen(), true);
});
