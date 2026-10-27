import type { FrontendErrorPayload } from '../browser/listener.js';
import { errorFingerprint } from '../utils/deduplicator.js';

export interface StoredError {
  error: FrontendErrorPayload;
  occurrences: number;
}

// Holds errors until the MCP client asks for them. Repeats are deduplicated only against what is buffered,
// so an error that recurs after the client read it (e.g. a fix that didn't work) is reported again.
// Capped so an error loop can't grow it without bound.
export class ErrorStore {
  // Map keeps insertion order, so the first key is the oldest error
  private entries = new Map<string, StoredError>();
  private dropped = 0;

  constructor(private readonly capacity = 100) {}

  add(p: FrontendErrorPayload): void {
    const key = errorFingerprint(p);
    const existing = this.entries.get(key);
    if (existing) {
      existing.occurrences++;
      return;
    }
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
      this.dropped++;
    }
    this.entries.set(key, { error: p, occurrences: 1 });
  }

  drain(): { errors: StoredError[]; dropped: number } {
    const result = { errors: [...this.entries.values()], dropped: this.dropped };
    this.entries = new Map();
    this.dropped = 0;
    return result;
  }
}
