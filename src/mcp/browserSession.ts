export interface BrowserControl {
  start(): Promise<void>;
  goto(url: string): Promise<void>;
  stop(): Promise<void>;
}

// Keeps at most one browser open; the user may close its window at any time
export class BrowserSession {
  private browser: BrowserControl | undefined;

  constructor(private readonly createBrowser: (url: string, onClose: () => void) => BrowserControl) {}

  isOpen(): boolean {
    return this.browser !== undefined;
  }

  async open(url: string): Promise<'opened' | 'navigated'> {
    if (this.browser) {
      await this.browser.goto(url);
      return 'navigated';
    }
    const browser = this.createBrowser(url, () => {
      // Ignore late close events from a browser that has already been replaced
      if (this.browser === browser) this.browser = undefined;
    });
    this.browser = browser;
    try {
      await browser.start();
    } catch (e) {
      if (this.browser === browser) this.browser = undefined;
      throw e;
    }
    return 'opened';
  }

  async close(): Promise<boolean> {
    const browser = this.browser;
    if (!browser) return false;
    this.browser = undefined;
    await browser.stop();
    return true;
  }
}
