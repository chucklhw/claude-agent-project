export type LogLevel = 'info' | 'debug';
export const LOG_LEVELS: readonly LogLevel[] = ['info', 'debug'];

let debugEnabled = false;

export function setLogLevel(level: LogLevel): void {
  debugEnabled = level === 'debug';
}

// Progress details printed only when log.level=debug; logs needed to fix an error use console directly
export function debug(...args: unknown[]): void {
  if (debugEnabled) console.log(...args);
}
