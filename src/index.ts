import { existsSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { BrowserConsoleListener, CONSOLE_LEVELS, type ConsoleLevel, type FrontendErrorPayload } from './browser/listener.js';
import { ErrorDeduplicator } from './utils/deduplicator.js';
import { RepairAgent } from './agent/repairAgent.js';
import { debug, LOG_LEVELS, setLogLevel, type LogLevel } from './utils/logger.js';

dotenv.config();

// "info" (default) prints only what is needed to fix an error; "debug" also prints what the app is doing
const logLevel = (process.env['log.level'] || 'info').trim().toLowerCase();
if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
  console.error(`❌ Invalid log.level: ${process.env['log.level']} (allowed values: ${LOG_LEVELS.join(', ')})`);
  process.exit(1);
}
setLogLevel(logLevel as LogLevel);

const workDirectory = process.env.WORK_DIRECTORY;
if (!workDirectory || !existsSync(workDirectory)) {
  console.error(`❌ WORK_DIRECTORY is not set or does not exist: ${workDirectory ?? '(not set)'}`);
  process.exit(1);
}
// Comma-separated console message types to capture, e.g. "error", "warning" or "error,warning" ("warn" is accepted)
const consoleTypes = (process.env.CONSOLE_TYPES || 'error')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean)
  .map((t) => (t === 'warn' ? 'warning' : t));
const invalidTypes = consoleTypes.filter((t) => !CONSOLE_LEVELS.includes(t as ConsoleLevel));
if (consoleTypes.length === 0 || invalidTypes.length > 0) {
  console.error(`❌ Invalid CONSOLE_TYPES: ${process.env.CONSOLE_TYPES} (allowed values: ${CONSOLE_LEVELS.join(', ')})`);
  process.exit(1);
}
const deduplicator = new ErrorDeduplicator(Number(process.env.DEDUP_WINDOW_MS) || 60_000);
const repairAgent = new RepairAgent(path.resolve(workDirectory));

// Run repairs one at a time so concurrent edits don't conflict
let repairQueue: Promise<void> = Promise.resolve();

function handleError(payload: FrontendErrorPayload): void {
  if (!deduplicator.shouldProcess(payload)) return;
  repairQueue = repairQueue
    .then(() => repairAgent.fixError(payload))
    .catch((err) => console.error('❌ [Agent] Repair failed, continuing to listen:', err));
}

const listener = new BrowserConsoleListener(
  {
    browserName: (process.env.BROWSER || 'chrome').toLowerCase(),
    targetUrl: process.env.TARGET_URL || 'https://127.0.0.1:8080',
    userDataDir: process.env.USER_DATA_DIR || '.browser-profile',
    consoleTypes: new Set(consoleTypes as ConsoleLevel[]),
  },
  handleError,
);

debug(`📁 Repair target project: ${path.resolve(workDirectory)}`);
listener.start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
