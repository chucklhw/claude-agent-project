import { describeFramework } from './browser/framework.js';
import { BrowserConsoleListener, type FrontendErrorPayload } from './browser/listener.js';
import { ErrorDeduplicator } from './utils/deduplicator.js';
import { RepairAgent } from './agent/repairAgent.js';
import { debug } from './utils/logger.js';
import type { AppConfig } from './config.js';

// Captures errors and runs the built-in repair agent, gated by console prompts
export async function runStandalone(config: AppConfig, workDirectory: string): Promise<void> {
  const deduplicator = new ErrorDeduplicator(config.dedupWindowMs);
  const repairAgent = new RepairAgent(workDirectory);

  // Run repairs one at a time so concurrent edits don't conflict
  let repairQueue: Promise<void> = Promise.resolve();

  function handleError(payload: FrontendErrorPayload): void {
    if (!deduplicator.shouldProcess(payload)) return;
    repairQueue = repairQueue
      .then(() => repairAgent.fixError(payload))
      .catch((err) => console.error('❌ [Agent] Repair failed, continuing to listen:', err));
  }

  const listener = new BrowserConsoleListener(
    config,
    handleError,
    () => {
      console.log('👋 Browser closed, exiting.');
      process.exit(0);
    },
    (info) => console.log(`\n🔎 [Framework]\n${describeFramework(info)}\n`),
  );

  debug(`📁 Repair target project: ${workDirectory}`);
  await listener.start();
  console.log('\n✅ Browser ready! Interact with the page manually; frontend source errors will be captured and passed to the repair agent.\n');
}
