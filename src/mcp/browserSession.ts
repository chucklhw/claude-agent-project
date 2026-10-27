export interface BrowserControl {
  start(): Promise<void>;
  goto(url: string): Promise<void>;
  stop(): Promise<void>;
}

// Keeps at most one browser open; the user may close its window at any time
export class BrowserSession {
  private browser: BrowserControl | undefined;
  // Set while a launch is in progress; open() and close() wait for it so they act on a started browser
  private starting: Promise<void> | undefined;

  constructor(private readonly createBrowser: (url: string, onClose: () => void) => BrowserControl) {}

  isOpen(): boolean {
    return this.browser !== undefined;
  }

  async open(url: string): Promise<'opened' | 'navigated'> {
    // Only await when a launch is running: awaiting undefined would yield and let a concurrent call race ahead
    if (this.starting) await this.starting.catch(() => {});
    if (this.browser) {
      await this.browser.goto(url);
      return 'navigated';
    }
    const browser = this.createBrowser(url, () => {
      // Ignore late close events from a browser that has already been replaced
      if (this.browser === browser) this.browser = undefined;
    });
    this.browser = browser;
    const starting = browser.start();
    this.starting = starting;
    try {
      await starting;
    } catch (e) {
      if (this.browser === browser) this.browser = undefined;
      // The launch can fail after the window opened (e.g. navigation); close it so it doesn't hold the profile
      await browser.stop().catch(() => {});
      throw e;
    } finally {
      if (this.starting === starting) this.starting = undefined;
    }
    return 'opened';
  }

  async close(): Promise<boolean> {
    // Only await when a launch is running: awaiting undefined would yield and let a concurrent call race ahead
    if (this.starting) await this.starting.catch(() => {});
    const browser = this.browser;
    if (!browser) return false;
    this.browser = undefined;
    await browser.stop();
    return true;
  }
}
