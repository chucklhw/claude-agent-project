import { existsSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { BrowserConsoleListener, type FrontendErrorPayload } from './browser/listener.js';
import { ErrorDeduplicator } from './utils/deduplicator.js';
import { RepairAgent } from './agent/repairAgent.js';

dotenv.config();

const workDirectory = process.env.WORK_DIRECTORY;
if (!workDirectory || !existsSync(workDirectory)) {
  console.error(`❌ WORK_DIRECTORY 未设置或目录不存在: ${workDirectory ?? '(未设置)'}`);
  process.exit(1);
}
const deduplicator = new ErrorDeduplicator(Number(process.env.DEDUP_WINDOW_MS) || 60_000);
const repairAgent = new RepairAgent(path.resolve(workDirectory));

// Run repairs one at a time so concurrent edits don't conflict
let repairQueue: Promise<void> = Promise.resolve();

function handleError(payload: FrontendErrorPayload): void {
  if (!deduplicator.shouldProcess(payload)) return;
  repairQueue = repairQueue
    .then(() => repairAgent.fixError(payload))
    .catch((err) => console.error('❌ [Agent] 修复失败，继续监听:', err));
}

const listener = new BrowserConsoleListener(
  {
    browserName: (process.env.BROWSER || 'chrome').toLowerCase(),
    targetUrl: process.env.TARGET_URL || 'https://127.0.0.1:8080',
    userDataDir: process.env.USER_DATA_DIR || '.browser-profile',
  },
  handleError,
);

console.log(`📁 修复目标项目: ${path.resolve(workDirectory)}`);
listener.start().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
