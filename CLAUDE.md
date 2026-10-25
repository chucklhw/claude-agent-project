# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — run `src/index.ts` directly via `tsx` (opens a headed browser)
- `npm run build` — compile with `tsc` to `dist/`
- `npm start` — run compiled `dist/index.js`
- `npx tsc --noEmit` — type-check only

There is no test runner or linter configured (`npm test` is a placeholder that exits 1).

## Configuration

Runtime config is read from `.env` via `dotenv`:
- `BROWSER` — `chrome` (default, uses system Chrome channel), `chromium`, `firefox`, `webkit`/`safari`
- `TARGET_URL` — initial page to open (default `https://127.0.0.1:8080`)
- `ANTHROPIC_API_KEY` — used by the repair agent
- `WORK_DIRECTORY` — required; the source directory the agent inspects and edits (its `cwd`). The app exits on startup if it's unset or missing
- `DEDUP_WINDOW_MS` — duplicate-suppression window (default `60000`)
- `USER_DATA_DIR` — persistent browser profile directory (default `.browser-profile`, git-ignored)
- `CONSOLE_TYPES` — comma-separated console message types to capture: `error` (default), `warning` (or `warn`), or `error,warning`. The app exits on startup if a value is invalid
- `log.level` — `info` (default) prints only what is needed to fix an error: the captured error, prompts, the proposal and the outcome. `debug` also prints progress (browser launch/navigation, filtered errors, dedup, agent tool calls and cost) via `debug()` in `src/utils/logger.ts`. The app exits on startup if the value is invalid

## Architecture

`prompt_specification.md` is the requirements spec. The app is a single pipeline:

1. **Listener** (`src/browser/listener.ts`) — `BrowserConsoleListener` opens a headed persistent context and captures `pageerror` and `console` errors on every page. Errors only pass if they reference frontend source (`/src/` or `.ts`/`.tsx`/`.js`/`.jsx`/`.vue`, ignoring `node_modules` frames) and don't match the network, CORS or favicon exclusions. Playwright reports 0-based line numbers; the payload's `line` is converted to 1-based, but the raw `stack` is not.
2. **Deduplicator** (`src/utils/deduplicator.ts`) — `ErrorDeduplicator.shouldProcess()` fingerprints `SHA256(name|message|filePath|line)` and suppresses repeats within the window, counting how many were suppressed.
3. **Repair agent** (`src/agent/repairAgent.ts`) — runs `@anthropic-ai/claude-agent-sdk`'s `query()` with `cwd: WORK_DIRECTORY`, read-only `Read`/`Grep`/`Glob` to propose a fix, then resumes the same session with `Edit` added to apply it once approved (see Console commands), `permissionMode: 'acceptEdits'` and `settingSources: []`. A `PreToolUse` hook denies any `Edit` outside `WORK_DIRECTORY` or inside `node_modules`; the prompt also tells the agent not to touch third-party libraries (no user or project settings are loaded). On every run it re-reads `WORK_DIRECTORY/CLAUDE.md`, if there is one, and appends it to the custom system prompt.
4. **Orchestrator** (`src/index.ts`) — connects the three. Repairs are queued and run one at a time, and a failed repair is logged without stopping the listener.

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
