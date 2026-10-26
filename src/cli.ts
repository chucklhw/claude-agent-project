#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { ConfigError, loadConfig, loadWorkDirectory, parseArgs } from './config.js';
import { setLogLevel } from './utils/logger.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // In MCP mode stdout carries the MCP protocol, so all logging goes to stderr
  if (args.mode === 'mcp') console.log = console.info = console.debug = console.error;
  dotenv.config({ quiet: true });
  const config = { ...loadConfig(process.env), ...(args.url && { targetUrl: args.url }) };
  setLogLevel(config.logLevel);

  // Imported per mode so MCP mode doesn't load the repair agent
  if (args.mode === 'mcp') {
    const { runMcp } = await import('./mcp/run.js');
    await runMcp(config, args.url);
  } else {
    const { runStandalone } = await import('./standalone.js');
    await runStandalone(config, loadWorkDirectory(process.env));
  }
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`❌ ${err.message}`);
  } else {
    console.error('Startup failed:', err);
  }
  process.exit(1);
});
