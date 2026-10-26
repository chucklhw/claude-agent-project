import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { describeError } from '../browser/describe.js';
import type { BrowserSession } from './browserSession.js';
import type { ErrorStore } from './errorStore.js';

// Resolves from both src/mcp and dist/mcp
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

const LOCATION_NOTE =
  'Each error has a 1-based Location line; line numbers inside the raw stack trace are 0-based. Fix the cause in the user\'s project source, never in node_modules or other third-party libraries.';

const INSTRUCTIONS = `browser-fix (the browser fixer) opens a headed browser on the user's local machine, listens to its console and collects frontend source errors, filtered and deduplicated locally. Call open_browser when the user asks to use the browser fixer on a URL, ask the user to reproduce the problem, then call get_errors and fix what it reports. ${LOCATION_NOTE}`;

function text(message: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: message }], ...(isError && { isError }) };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createMcpServer(session: BrowserSession, store: ErrorStore, defaultUrl: string): McpServer {
  const server = new McpServer({ name: 'browser-fix', version }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'open_browser',
    {
      description:
        'Open the browser (or switch the open browser) to a URL and listen for frontend errors there. Call this when the user asks to use the browser fixer/debugger on a URL, e.g. "use browser fixer for url http://emsdev.localhost:8080". Without url, uses TARGET_URL or the --url startup argument.',
      inputSchema: { url: z.url().optional() },
    },
    async ({ url }) => {
      const target = url ?? defaultUrl;
      // Errors from the previous URL would be misleading after a switch
      if (session.isOpen()) store.drain();
      try {
        const outcome = await session.open(target);
        return text(outcome === 'opened' ? `Browser opened, listening on ${target}` : `Switched to ${target}, listening for errors there`);
      } catch (e) {
        return text(
          `Failed to open browser: ${messageOf(e)}. If another browser-fix instance uses the same browser profile, close it or set USER_DATA_DIR to a different directory.`,
          true,
        );
      }
    },
  );

  server.registerTool(
    'get_errors',
    {
      description: `Return the frontend errors captured since the last call (each error is returned once). ${LOCATION_NOTE}`,
    },
    async () => {
      const { errors, dropped } = store.drain();
      if (errors.length === 0) {
        return text(session.isOpen() ? 'No new frontend errors captured since the last call.' : 'Browser is not open. Call open_browser first.');
      }
      const header = `${errors.length} new error(s):${dropped > 0 ? ` (${dropped} older errors dropped)` : ''}`;
      return text(`${header}\n\n${errors.map(describeError).join('\n\n---\n\n')}`);
    },
  );

  server.registerTool('close_browser', { description: 'Close the browser opened by open_browser.' }, async () => {
    try {
      return text((await session.close()) ? 'Browser closed' : 'Browser is not open');
    } catch (e) {
      return text(`Failed to close browser: ${messageOf(e)}`, true);
    }
  });

  return server;
}

// Opens the --url given at startup; a failure must not stop the server, open_browser can retry
export async function openOnStartup(session: BrowserSession, url: string): Promise<void> {
  try {
    await session.open(url);
  } catch (e) {
    console.error(`❌ Could not open ${url}: ${messageOf(e)}`);
  }
}
