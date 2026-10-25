import { createHash } from 'node:crypto';
import type { FrontendErrorPayload } from '../browser/listener.js';
import { debug } from './logger.js';

interface Entry {
  lastProcessed: number;
  suppressed: number;
}

export class ErrorDeduplicator {
  private readonly seen = new Map<string, Entry>();

  constructor(private readonly windowMs = 60_000) {}

  fingerprint(p: FrontendErrorPayload): string {
    return createHash('sha256')
      .update(`${p.name}|${p.message}|${p.filePath ?? ''}|${p.line ?? ''}`)
      .digest('hex');
  }

  shouldProcess(p: FrontendErrorPayload): boolean {
    const key = this.fingerprint(p);
    const now = Date.now();
    const entry = this.seen.get(key);

    if (entry && now - entry.lastProcessed < this.windowMs) {
      entry.suppressed++;
      debug(`🔁 [Dedup] Ignored duplicate error (${key.slice(0, 12)}), ${entry.suppressed} suppressed in this window`);
      return false;
    }

    if (entry?.suppressed) {
      debug(`📊 [Dedup] Error ${key.slice(0, 12)} was suppressed ${entry.suppressed} times in the previous window`);
    }
    this.seen.set(key, { lastProcessed: now, suppressed: 0 });
    return true;
  }
}
