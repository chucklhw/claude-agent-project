import { createHash } from 'node:crypto';
import type { FrontendErrorPayload } from '../browser/listener.js';

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
      console.log(`🔁 [去重] 已忽略重复错误 (${key.slice(0, 12)}), 窗口内累计 ${entry.suppressed} 次`);
      return false;
    }

    if (entry?.suppressed) {
      console.log(`📊 [去重] 错误 ${key.slice(0, 12)} 上个窗口内被忽略 ${entry.suppressed} 次`);
    }
    this.seen.set(key, { lastProcessed: now, suppressed: 0 });
    return true;
  }
}
