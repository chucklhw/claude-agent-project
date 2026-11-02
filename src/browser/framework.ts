import { errors, type Page } from 'playwright';

export interface FrameworkInfo {
  framework: 'vue2' | 'vue3' | 'unknown';
  version: string | undefined;
  devMode: boolean;
  pageUrl: string;
  detectedAt: string;
}

interface VueDetection {
  framework: 'vue2' | 'vue3';
  version: string | null;
  devBuild: boolean;
}

// The scripts run in the page, so they are strings: the project has no DOM types and tsx would inject helpers into functions.
// Vue 3 sets __vue_app__ on the mount container (__VUE_HMR_RUNTIME__ exists only in development builds);
// Vue 2 sets __vue__ on each component's root element (development builds give each instance a separate render proxy).
const VUE_SCRIPT = `(() => {
  for (const el of document.querySelectorAll('*')) {
    const app = el.__vue_app__;
    if (app) return { framework: 'vue3', version: app.version || null, devBuild: !!window.__VUE_HMR_RUNTIME__ };
    const vm = el.__vue__;
    if (vm) {
      let ctor = vm.constructor;
      while (ctor.super) ctor = ctor.super;
      return { framework: 'vue2', version: ctor.version || (window.Vue && window.Vue.version) || null, devBuild: vm._renderProxy !== vm };
    }
  }
  return null;
})()`;

// Vite injects its client in dev; webpack's HMR runtime defines webpackHotUpdate* globals
const DEV_SERVER_SCRIPT = `!!document.querySelector('script[src*="/@vite/client"]') || Object.keys(window).some((k) => k.startsWith('webpackHotUpdate'))`;

// Apps can mount after the load event (e.g. after fetching config), so wait a little for one to appear
const MOUNT_TIMEOUT_MS = 5_000;

// The cache key for a page: scheme, host and port
export function baseUrl(url: string): string {
  return new URL(url).origin;
}

// Rejects if the page navigates away while detecting
export async function detectFramework(page: Page): Promise<FrameworkInfo> {
  const pageUrl = page.url();
  let vue: VueDetection | null = null;
  try {
    const handle = await page.waitForFunction(VUE_SCRIPT, undefined, { timeout: MOUNT_TIMEOUT_MS, polling: 250 });
    vue = (await handle.jsonValue()) as VueDetection;
  } catch (e) {
    if (!(e instanceof errors.TimeoutError)) throw e;
  }
  const devServer = (await page.evaluate(DEV_SERVER_SCRIPT)) as boolean;
  return {
    framework: vue?.framework ?? 'unknown',
    version: vue?.version ?? undefined,
    devMode: (vue?.devBuild ?? false) || devServer,
    pageUrl,
    detectedAt: new Date().toISOString(),
  };
}

export function describeFramework(info: FrameworkInfo): string {
  const framework = info.framework === 'unknown' ? 'unknown (only Vue is detected)' : `${info.framework} (${info.version ?? 'version unknown'})`;
  return [`Base URL: ${baseUrl(info.pageUrl)}`, `Page: ${info.pageUrl}`, `Framework: ${framework}`, `Dev mode: ${info.devMode ? 'yes' : 'no'}`, `Detected at: ${info.detectedAt}`].join('\n');
}
