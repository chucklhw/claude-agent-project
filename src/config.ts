import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONSOLE_LEVELS, type ConsoleLevel } from './browser/listener.js';
import { LOG_LEVELS, type LogLevel } from './utils/logger.js';

export type Mode = 'standalone' | 'mcp';

export class ConfigError extends Error {}

export interface CliArgs {
  mode: Mode;
  url?: string;
}

export interface AppConfig {
  logLevel: LogLevel;
  browserName: string;
  targetUrl: string;
  userDataDir: string;
  consoleTypes: ReadonlySet<ConsoleLevel>;
  dedupWindowMs: number;
}

const USAGE = 'Usage: browser-fix [--mcp] [--url <url>]';

export function parseArgs(args: readonly string[]): CliArgs {
  const result: CliArgs = { mode: 'standalone' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mcp') {
      result.mode = 'mcp';
    } else if (arg === '--url') {
      const url = args[++i];
      if (!url || !URL.canParse(url)) throw new ConfigError(`Invalid --url: ${url ?? '(missing)'}\n${USAGE}`);
      result.url = url;
    } else {
      throw new ConfigError(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv, mode: Mode = 'standalone'): AppConfig {
  // "info" (default) prints only what is needed to fix an error; "debug" also prints what the app is doing
  const logLevel = (env['log.level'] || 'info').trim().toLowerCase();
  if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
    throw new ConfigError(`Invalid log.level: ${env['log.level']} (allowed values: ${LOG_LEVELS.join(', ')})`);
  }
  // Comma-separated console message types to capture, e.g. "error", "warning" or "error,warning" ("warn" is accepted)
  const consoleTypes = (env.CONSOLE_TYPES || 'error')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => (t === 'warn' ? 'warning' : t));
  const invalidTypes = consoleTypes.filter((t) => !CONSOLE_LEVELS.includes(t as ConsoleLevel));
  if (consoleTypes.length === 0 || invalidTypes.length > 0) {
    throw new ConfigError(`Invalid CONSOLE_TYPES: ${env.CONSOLE_TYPES} (allowed values: ${CONSOLE_LEVELS.join(', ')})`);
  }
  return {
    logLevel: logLevel as LogLevel,
    browserName: (env.BROWSER || 'chrome').toLowerCase(),
    targetUrl: env.TARGET_URL || 'https://127.0.0.1:8080',
    // MCP clients start the server in the user's project; keep the profile out of it
    userDataDir: env.USER_DATA_DIR || (mode === 'mcp' ? path.join(os.homedir(), '.browser-fix', 'profile') : '.browser-profile'),
    consoleTypes: new Set(consoleTypes as ConsoleLevel[]),
    dedupWindowMs: Number(env.DEDUP_WINDOW_MS) || 60_000,
  };
}

// Only standalone mode needs WORK_DIRECTORY: it is where the repair agent reads and edits source
export function loadWorkDirectory(env: NodeJS.ProcessEnv): string {
  const workDirectory = env.WORK_DIRECTORY;
  if (!workDirectory || !existsSync(workDirectory)) {
    throw new ConfigError(`WORK_DIRECTORY is not set or does not exist: ${workDirectory ?? '(not set)'}`);
  }
  return path.resolve(workDirectory);
}
