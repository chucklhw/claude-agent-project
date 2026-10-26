#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { ConfigError, loadConfig, loadWorkDirectory, parseArgs } from './config.js';
import { runStandalone } from './standalone.js';
import { setLogLevel } from './utils/logger.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  dotenv.config({ quiet: true });
  const config = { ...loadConfig(process.env), ...(args.url && { targetUrl: args.url }) };
  setLogLevel(config.logLevel);

  if (args.mode === 'mcp') throw new ConfigError('MCP mode not implemented');
  await runStandalone(config, loadWorkDirectory(process.env));
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`❌ ${err.message}`);
  } else {
    console.error('Startup failed:', err);
  }
  process.exit(1);
});
