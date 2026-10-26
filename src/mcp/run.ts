import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BrowserConsoleListener } from '../browser/listener.js';
import { ErrorDeduplicator } from '../utils/deduplicator.js';
import type { AppConfig } from '../config.js';
import { BrowserSession } from './browserSession.js';
import { ErrorStore } from './errorStore.js';
import { createMcpServer, openOnStartup } from './server.js';

// Captures errors locally and hands them to the MCP client (Claude Code) on request; no Claude API calls here
export async function runMcp(config: AppConfig, openUrl: string | undefined): Promise<void> {
  const deduplicator = new ErrorDeduplicator(config.dedupWindowMs);
  const store = new ErrorStore();
  const session = new BrowserSession(
    (url, onClose) =>
      new BrowserConsoleListener(
        { ...config, targetUrl: url },
        (payload) => {
          if (deduplicator.shouldProcess(payload)) store.add(payload);
        },
        onClose,
      ),
  );
  const server = createMcpServer(session, store, config.targetUrl);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await session.close().catch((err) => console.error('❌ Failed to close browser:', err));
    process.exit(0);
  };
  // Claude Code exiting closes our stdin
  server.server.onclose = shutdown;
  process.stdin.on('end', shutdown);

  await server.connect(new StdioServerTransport());
  // Not awaited so a slow browser launch doesn't hold up the client
  if (openUrl) void openOnStartup(session, openUrl);
}
