# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — run `src/cli.ts` in standalone mode via `tsx` (opens a headed browser); pass `-- --url <url>` to override `TARGET_URL`
- `npm run dev:mcp` — run `src/cli.ts --mcp` (stdio MCP server)
- `npm run build` — compile with `tsc` to `dist/`
- `npm start` — run compiled `dist/cli.js`
- `npm test` — run `test/**/*.test.ts` with `node:test` via `tsx` (tests live in `test/`, mirroring `src/`)
- `npx tsc --noEmit` — type-check `src/` only

There is no linter configured.

## Modes

The package is the CLI `browser-fix [--mcp] [--url <url>]` (`src/cli.ts`); the mode comes only from the flag, not from `.env`. `--url` overrides `TARGET_URL`.

- **Standalone** (no `--mcp`, `src/standalone.ts`): the pipeline below, with the built-in repair agent and the console gates.
- **MCP** (`--mcp`, `src/mcp/`): a stdio MCP server for Claude Code. It exposes `open_browser { url? }` (opens or switches the browser and clears errors from the previous URL), `get_errors` (drains the buffered errors), `get_framework_info { url? }` (the detected framework per base URL, or all of them) and `close_browser`, plus the prompts `open`, `fix_errors`, `framework_info` and `close`, which Claude Code shows as slash commands that tell Claude to call those tools. Claude Code fixes the errors itself in the user's project; `fix_errors` and the server `instructions` tell it to propose each fix and wait for approval before editing, and not to assume error locations map directly to source files. Tool descriptions and the server `instructions` list example user phrases; they are how Claude decides when to call each tool, so keep them in step with the tools. With `--url` the browser opens at startup; without it, only on `open_browser`. `BrowserSession` serialises open/close against an in-progress launch and closes a browser whose launch failed, so it never holds the profile lock. `ErrorStore` deduplicates only against what is buffered (counting occurrences), so an error that recurs after `get_errors` is reported again; `DEDUP_WINDOW_MS` applies to standalone only. `USER_DATA_DIR` defaults to `~/.browser-fix/profile` in MCP mode, because the client starts the server in the user's project. Capture, filtering and dedup run locally; the server never calls the Claude API or pushes notifications, so tokens are only spent when Claude calls a tool. Nothing may be written to stdout except protocol messages: `cli.ts` redirects `console.log` to stderr and loads dotenv with `quiet: true`. `WORK_DIRECTORY` is not needed. Framework detections are cached in a map keyed by base URL (`origin`: scheme, host and port), kept for the server's lifetime; a later load on the same base URL replaces the entry.

## Configuration

Runtime config is read from `.env` via `dotenv`:
- `BROWSER` — `chrome` (default, uses system Chrome channel), `chromium`, `firefox`, `webkit`/`safari`
- `TARGET_URL` — initial page to open (default `https://127.0.0.1:8080`)
- `ANTHROPIC_API_KEY` — used by the repair agent
- `WORK_DIRECTORY` — required in standalone mode; the source directory the agent inspects and edits (its `cwd`). Standalone mode exits on startup if it's unset or missing
- `DEDUP_WINDOW_MS` — duplicate-suppression window (default `60000`)
- `USER_DATA_DIR` — persistent browser profile directory (default `.browser-profile`, git-ignored)
- `CONSOLE_TYPES` — comma-separated console message types to capture: `error` (default), `warning` (or `warn`), or `error,warning`. The app exits on startup if a value is invalid
- `log.level` — `info` (default) prints only what is needed to fix an error: the captured error, prompts, the proposal and the outcome. `debug` also prints progress (browser launch/navigation, filtered errors, dedup, agent tool calls and cost) via `debug()` in `src/utils/logger.ts`. The app exits on startup if the value is invalid

## Architecture

`prompt_specification.md` is the requirements spec. Config parsing lives in `src/config.ts`. Standalone mode is a single pipeline:

1. **Listener** (`src/browser/listener.ts`) — `BrowserConsoleListener` opens a headed persistent context and captures `pageerror` and `console` errors on every page. Closing the window calls the `onClose` callback (standalone exits; MCP mode keeps running). Errors only pass if they reference frontend source (`/src/` or `.ts`/`.tsx`/`.js`/`.jsx`/`.vue`, ignoring `node_modules` frames) and don't match the network, CORS or favicon exclusions. Playwright reports 0-based line numbers; the payload's `line` is converted to 1-based, but the raw `stack` is not. On every page `load` (new URL or refresh) it calls `onFramework` with `detectFramework()` (`src/browser/framework.ts`): Vue 3 via `__vue_app__`, Vue 2 via `__vue__` (waiting up to 5 s for the app to mount), and dev mode from a development Vue build or a Vite/webpack dev server. Only Vue is detected; anything else is `unknown`. Standalone prints the result; MCP mode caches it.
2. **Deduplicator** (`src/utils/deduplicator.ts`) — `ErrorDeduplicator.shouldProcess()` fingerprints `SHA256(name|message|filePath|line)` and suppresses repeats within the window, counting how many were suppressed.
3. **Repair agent** (`src/agent/repairAgent.ts`) — runs `@anthropic-ai/claude-agent-sdk`'s `query()` with `cwd: WORK_DIRECTORY`, read-only `Read`/`Grep`/`Glob` to propose a fix, then resumes the same session with `Edit` added to apply it once approved (see Console commands), `permissionMode: 'acceptEdits'` and `settingSources: []`. A `PreToolUse` hook denies any `Edit` outside `WORK_DIRECTORY` or inside `node_modules`; the prompt also tells the agent not to touch third-party libraries (no user or project settings are loaded). On every run it re-reads `WORK_DIRECTORY/CLAUDE.md`, if there is one, and appends it to the custom system prompt.
4. **Orchestrator** (`src/standalone.ts`) — connects the three. Repairs are queued and run one at a time, and a failed repair is logged without stopping the listener.

## Console commands

Every captured error needs user input before anything changes; keep these gates when changing the repair flow:

1. `y`/`n` (single keypress) — fix this error or skip it.
2. `fe`/`data` + Enter (case-insensitive) — fix frontend code or database data.
3. `y`/`n` (single keypress) — approve the printed proposal or skip it.

An approved `fe` fix is applied; an approved `data` fix is a placeholder (`TODO`) until database tools exist. `Ctrl+C` exits at any prompt. Run in an interactive terminal; without a TTY, `y`/`n` also needs Enter.

## TypeScript notes

- ESM project (`"type": "module"`, `module: nodenext`): relative imports need explicit `.js` extensions.
- `verbatimModuleSyntax` is on: use `import { type X }` / `import type` for type-only imports.
- `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on: indexed access returns `T | undefined`, and optional properties cannot be assigned `undefined` explicitly.
- Code comments and log messages are in English.
