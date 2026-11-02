import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { baseUrl, describeFramework, detectFramework } from '../../src/browser/framework.js';

// Pages fake the markers Vue leaves on the DOM instead of loading Vue itself
const PAGES: Record<string, string> = {
  '/vue3-dev': `<div id="app"></div><script>window.__VUE_HMR_RUNTIME__ = {}; document.getElementById('app').__vue_app__ = { version: '3.4.21' };</script>`,
  '/vue3-prod-late': `<div id="app"></div><script>setTimeout(() => { document.getElementById('app').__vue_app__ = { version: '3.5.0' }; }, 300);</script>`,
  '/vue2-dev': `<div id="app"></div><script>
    function Vue() {} Vue.version = '2.7.16';
    function Sub() {} Sub.super = Vue;
    const vm = Object.create(Sub.prototype); vm.constructor = Sub; vm._renderProxy = {};
    document.getElementById('app').__vue__ = vm;</script>`,
  '/vue2-prod': `<div id="app"></div><script>
    function Vue() {} Vue.version = '2.6.14';
    const vm = Object.create(Vue.prototype); vm._renderProxy = vm;
    document.getElementById('app').__vue__ = vm;</script>`,
  '/vite-plain': `<script type="module" src="/@vite/client"></script><p>no framework</p>`,
};

let server: Server;
let origin: string;
let browser: Browser | undefined;
let page: Page;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', req.url?.endsWith('/@vite/client') ? 'text/javascript' : 'text/html');
    res.end(PAGES[req.url ?? ''] ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
  } catch {
    browser = await chromium.launch();
  }
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
  server.close();
});

async function detect(path: string) {
  await page.goto(`${origin}${path}`);
  return detectFramework(page);
}

test('detects a Vue 3 development build', async () => {
  const info = await detect('/vue3-dev');
  assert.deepEqual([info.framework, info.version, info.devMode], ['vue3', '3.4.21', true]);
  assert.equal(info.pageUrl, `${origin}/vue3-dev`);
});

test('waits for an app that mounts after the load event', async () => {
  const info = await detect('/vue3-prod-late');
  assert.deepEqual([info.framework, info.version, info.devMode], ['vue3', '3.5.0', false]);
});

test('detects Vue 2 through a component subclass, and its build mode', async () => {
  const dev = await detect('/vue2-dev');
  assert.deepEqual([dev.framework, dev.version, dev.devMode], ['vue2', '2.7.16', true]);
  const prod = await detect('/vue2-prod');
  assert.deepEqual([prod.framework, prod.version, prod.devMode], ['vue2', '2.6.14', false]);
});

test('reports an unknown framework, but still a dev server', { timeout: 15_000 }, async () => {
  const info = await detect('/vite-plain');
  assert.deepEqual([info.framework, info.version, info.devMode], ['unknown', undefined, true]);
  assert.match(describeFramework(info), /Framework: unknown \(only Vue is detected\)/);
});

test('baseUrl keeps scheme, host and port only', () => {
  assert.equal(baseUrl('http://emsdev.localhost:8080/users/1?x=1#top'), 'http://emsdev.localhost:8080');
  assert.equal(baseUrl('https://127.0.0.1:8080/'), 'https://127.0.0.1:8080');
});
