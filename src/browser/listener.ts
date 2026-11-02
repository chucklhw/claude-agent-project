import { chromium, firefox, webkit, type BrowserContext, type BrowserType, type ConsoleMessage, type Page } from 'playwright';
import { debug } from '../utils/logger.js';
import { detectFramework, type FrameworkInfo } from './framework.js';

export interface FrontendErrorPayload {
  source: 'pageerror' | 'console';
  name: string;
  message: string;
  stack: string | undefined;
  filePath: string | undefined;
  line: number | undefined;
  column: number | undefined;
  pageUrl: string;
  timestamp: string;
}

export interface ListenerOptions {
  browserName: string;
  targetUrl: string;
  userDataDir: string;
  consoleTypes: ReadonlySet<ConsoleLevel>;
}

export type ConsoleLevel = 'error' | 'warning';
export const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['error', 'warning'];

const SOURCE_PATTERN = /\/src\/|\.(tsx?|jsx?|vue)(\?|:|$|\s|\))/;
const EXCLUDE_PATTERNS = [
  /net::ERR_/,
  /Failed to load resource/i,
  /status of [45]\d\d/,
  /\b[45]\d\d \((Not Found|Internal Server Error|Bad Request|Unauthorized|Forbidden|Bad Gateway|Service Unavailable)/i,
  /CORS/i,
  /Access-Control-Allow-Origin/i,
  /favicon\.ico/i,
];
// Playwright reports 0-based line numbers. Matches "url:line:col" in Chrome ("at fn (url:1:2)") and Firefox ("fn@url:1:2") frames.
const FRAME_PATTERN = /((?:https?|file|webpack):\/\/[^\s()@]+|\/[^\s()@:]+):(\d+):(\d+)/;

function getBrowserType(browserName: string): BrowserType {
  switch (browserName) {
    case 'firefox':
      return firefox;
    case 'webkit':
    case 'safari':
      return webkit;
    default:
      return chromium;
  }
}

function withoutNodeModules(text: string): string {
  return text
    .split('\n')
    .filter((l) => !l.includes('node_modules'))
    .join('\n');
}

function isFrontendSourceError(message: string, locationText: string): boolean {
  if (EXCLUDE_PATTERNS.some((p) => p.test(message) || p.test(locationText))) return false;
  return SOURCE_PATTERN.test(withoutNodeModules(locationText));
}

function firstSourceFrame(stack: string): { filePath: string; line: number; column: number } | undefined {
  for (const line of withoutNodeModules(stack).split('\n')) {
    const m = FRAME_PATTERN.exec(line);
    if (m?.[1] && m[2] && m[3]) return { filePath: m[1], line: Number(m[2]), column: Number(m[3]) };
  }
  return undefined;
}

export class BrowserConsoleListener {
  private context: BrowserContext | undefined;

  constructor(
    private readonly options: ListenerOptions,
    private readonly onError: (payload: FrontendErrorPayload) => void,
    private readonly onClose: () => void,
    private readonly onFramework: (info: FrameworkInfo) => void,
  ) {}

  async start(): Promise<void> {
    const { browserName, targetUrl, userDataDir } = this.options;
    debug(`🚀 Launching browser: ${browserName} (headed, profile directory: ${userDataDir})...`);

    const context = await getBrowserType(browserName).launchPersistentContext(userDataDir, {
      headless: false,
      // Use the real window size instead of Playwright's fixed 1280x720 viewport
      viewport: null,
      ...(browserName === 'chrome' ? { channel: 'chrome' } : {}),
    });
    this.context = context;
    context.on('page', (page) => this.attach(page));
    context.on('close', () => {
      this.context = undefined;
      this.onClose();
    });

    const page = context.pages()[0] ?? (await context.newPage());
    this.attach(page);
    await this.goto(targetUrl);
  }

  // Navigates the first page; new pages are created when the user closed them all
  async goto(url: string): Promise<void> {
    if (!this.context) throw new Error('Browser is not open');
    const page = this.context.pages()[0] ?? (await this.context.newPage());
    debug(`🔗 Navigating to: ${url}`);
    await page.goto(url);
  }

  // Closing the context fires onClose
  async stop(): Promise<void> {
    await this.context?.close();
  }

  private attach(page: Page): void {
    page.on('console', (msg) => this.handleConsole(page, msg));
    // Fires on every navigation and reload of the page
    page.on('load', () => void this.detect(page));
    page.on('pageerror', (error) => {
      const stack = error.stack ?? '';
      if (!isFrontendSourceError(error.message, stack)) {
        debug(`[Filtered][pageerror] ${error.message}`);
        return;
      }
      const frame = firstSourceFrame(stack);
      this.emit({
        source: 'pageerror',
        name: error.name || 'Error',
        message: error.message,
        stack: error.stack,
        filePath: frame?.filePath,
        line: frame && frame.line + 1,
        column: frame?.column,
        pageUrl: page.url(),
        timestamp: new Date().toISOString(),
      });
    });
  }

  private handleConsole(page: Page, msg: ConsoleMessage): void {
    const type = msg.type();
    if (!this.options.consoleTypes.has(type as ConsoleLevel)) return;
    const text = msg.text();
    const loc = msg.location();
    const locationText = loc.url ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : '';

    // console.error text often embeds the stack, so check both
    if (!isFrontendSourceError(text, `${locationText}\n${text}`)) {
      debug(`[Filtered][console.${type}] ${text.split('\n')[0]}`);
      return;
    }
    const frame = firstSourceFrame(text) ?? (loc.url ? { filePath: loc.url, line: loc.lineNumber, column: loc.columnNumber } : undefined);
    this.emit({
      source: 'console',
      name: type === 'warning' ? 'ConsoleWarning' : 'ConsoleError',
      message: text,
      stack: undefined,
      filePath: frame?.filePath,
      line: frame && frame.line + 1,
      column: frame?.column,
      pageUrl: page.url(),
      timestamp: new Date().toISOString(),
    });
  }

  private async detect(page: Page): Promise<void> {
    if (!/^https?:/.test(page.url())) return;
    try {
      this.onFramework(await detectFramework(page));
    } catch (e) {
      // A newer load replaces this one and runs its own detection
      debug(`[Framework] Detection on ${page.url()} interrupted: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private emit(payload: FrontendErrorPayload): void {
    const where = payload.filePath ? ` @ ${payload.filePath}:${payload.line}:${payload.column}` : '';
    debug(`❌ [Frontend error][${payload.source}] ${payload.name}: ${payload.message.split('\n')[0]}${where}`);
    this.onError(payload);
  }
}
