import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { ConfigError, loadConfig, loadWorkDirectory, parseArgs } from '../src/config.js';

const USAGE = /Usage: browser-fix \[--mcp\] \[--url <url>\]/;

test('parseArgs defaults to standalone without a url', () => {
  assert.deepEqual(parseArgs([]), { mode: 'standalone' });
});

test('parseArgs selects mcp mode', () => {
  assert.deepEqual(parseArgs(['--mcp']), { mode: 'mcp' });
});

test('parseArgs accepts --url in any order', () => {
  assert.deepEqual(parseArgs(['--url', 'http://localhost:5173', '--mcp']), { mode: 'mcp', url: 'http://localhost:5173' });
});

test('parseArgs rejects unknown arguments, a missing url and an invalid url', () => {
  for (const args of [['--foo'], ['--mcp', 'x'], ['--url'], ['--url', 'not a url']]) {
    assert.throws(() => parseArgs(args), (e: unknown) => e instanceof ConfigError && USAGE.test(e.message), args.join(' '));
  }
});

test('loadConfig applies defaults', () => {
  const config = loadConfig({});
  assert.equal(config.logLevel, 'info');
  assert.equal(config.browserName, 'chrome');
  assert.equal(config.targetUrl, 'https://127.0.0.1:8080');
  assert.equal(config.userDataDir, '.browser-profile');
  assert.equal(config.dedupWindowMs, 60_000);
  assert.deepEqual(config.consoleTypes, new Set(['error']));
});

test('loadConfig normalises CONSOLE_TYPES', () => {
  assert.deepEqual(loadConfig({ CONSOLE_TYPES: 'Error, warn' }).consoleTypes, new Set(['error', 'warning']));
});

test('loadConfig rejects invalid CONSOLE_TYPES and log.level', () => {
  assert.throws(() => loadConfig({ CONSOLE_TYPES: 'info' }), ConfigError);
  assert.throws(() => loadConfig({ 'log.level': 'trace' }), ConfigError);
});

test('loadConfig does not require WORK_DIRECTORY', () => {
  assert.doesNotThrow(() => loadConfig({}));
});

test('loadWorkDirectory rejects an unset or missing directory', () => {
  assert.throws(() => loadWorkDirectory({}), ConfigError);
  assert.throws(() => loadWorkDirectory({ WORK_DIRECTORY: path.join(os.tmpdir(), 'does-not-exist-browser-fix') }), ConfigError);
});

test('loadWorkDirectory resolves an existing directory', () => {
  assert.equal(loadWorkDirectory({ WORK_DIRECTORY: os.tmpdir() }), path.resolve(os.tmpdir()));
});
