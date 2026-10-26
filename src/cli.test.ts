import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('cli prints usage and exits 1 on an unknown argument', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--foo'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: browser-fix \[--mcp\] \[--url <url>\]/);
  assert.equal(result.stdout, '');
});
