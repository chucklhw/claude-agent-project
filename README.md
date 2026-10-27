# browser-fix

Opens a headed browser, captures frontend source errors from its console, de-duplicates them locally and helps fix them. It runs in one of two modes.

## Standalone

```sh
npx browser-fix [--url <url>]
```

Opens a Playwright browser on `--url` (or `TARGET_URL`) and runs the built-in repair agent on each captured error. Every repair is gated by console prompts. `WORK_DIRECTORY` (the project to fix) and `ANTHROPIC_API_KEY` must be set in `.env`.

## MCP server for Claude Code

Add this to your MCP configuration, e.g. `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "browser-debugger": {
      "command": "npx",
      "args": ["-y", "browser-fix", "--mcp", "--url", "http://localhost:5173"]
    }
  }
}
```

With `--url`, the browser opens on that URL as soon as Claude Code starts the server. Without it, the browser opens only when Claude calls `open_browser`. You can change the URL at any time by asking Claude, e.g. "use browser fixer for url http://emsdev.localhost:8080".

Tools:

- `open_browser { url? }` opens the browser or switches it to a new URL, and clears errors from the previous URL.
- `get_errors` returns the errors captured since the last call.
- `close_browser` closes the browser.

Claude picks a tool from what you ask in plain words, e.g. "open the browser on localhost:5173", "I reproduced it, check the errors", "close the browser". For fixed commands that don't depend on wording, use the slash commands (prompts) the server adds, named after the server key in your config:

- `/mcp__browser-debugger__open [url]` opens the browser.
- `/mcp__browser-debugger__fix_errors` fetches the captured errors and fixes them.
- `/mcp__browser-debugger__close` closes the browser.

Listening, filtering and de-duplication run locally and use no Claude tokens. Tokens are only spent when Claude calls a tool. MCP mode doesn't need `WORK_DIRECTORY` or `ANTHROPIC_API_KEY`: Claude Code makes the fixes.

`npx -y browser-fix` only works once the package is published to npm. Until then, build it (`npm run build`) and use `"command": "node", "args": ["<path to repo>/dist/cli.js", "--mcp", "--url", "<url>"]`.

## Configuration (`.env`)

`BROWSER`, `TARGET_URL`, `USER_DATA_DIR`, `CONSOLE_TYPES`, `DEDUP_WINDOW_MS`, `log.level`, and for standalone mode `WORK_DIRECTORY` and `ANTHROPIC_API_KEY`. See `CLAUDE.md` for details.

In MCP mode the server runs in your project's directory, so it reads that project's `.env`. If the project sets `BROWSER` for its own dev server (e.g. `BROWSER=none`), set `BROWSER=chrome` in the MCP server's `env` block. The browser profile defaults to `~/.browser-fix/profile`.
