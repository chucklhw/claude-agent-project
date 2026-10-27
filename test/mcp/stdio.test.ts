import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Debug logging on: any log line on stdout would break the handshake
test('the --mcp server speaks MCP over stdio and exits when the client disconnects', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/cli.ts', '--mcp'],
    env: { ...(process.env as Record<string, string>), 'log.level': 'debug' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['close_browser', 'get_errors', 'open_browser']);

  const result = await client.callTool({ name: 'get_errors', arguments: {} });
  assert.deepEqual(result.content, [{ type: 'text', text: 'Browser is not open. Call open_browser first.' }]);

  const pid = transport.pid;
  assert.ok(pid);
  await client.close();
  const deadline = Date.now() + 5_000;
  while (isRunning(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  assert.equal(isRunning(pid), false);
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
