import type { FrontendErrorPayload } from '../browser/listener.js';

// Holds deduplicated errors until the MCP client asks for them; capped so an error loop can't grow it without bound
export class ErrorStore {
  private errors: FrontendErrorPayload[] = [];
  private dropped = 0;

  constructor(private readonly capacity = 100) {}

  add(p: FrontendErrorPayload): void {
    if (this.errors.length >= this.capacity) {
      this.errors.shift();
      this.dropped++;
    }
    this.errors.push(p);
  }

  drain(): { errors: FrontendErrorPayload[]; dropped: number } {
    const result = { errors: this.errors, dropped: this.dropped };
    this.errors = [];
    this.dropped = 0;
    return result;
  }
}
