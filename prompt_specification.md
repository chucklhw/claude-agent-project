# Requirement Specification: Browser Console Error Listener & Automated Code Repair Agent

## 1. Overview
We need to build a TypeScript-based application using **Playwright** and the **Claude Agent SDK (@anthropic-ai/sdk)**. 
The system will:
1. Launch a browser in interactive (headed) mode to let the user navigate/click manually.
2. Intercept and capture **frontend source code errors** in real time from the browser console while filtering out backend, network, and static resource errors.
3. **Deduplicate** errors to prevent triggering unnecessary Agent runs for repeated errors.
4. Pass unique, structured error logs (including error message, stack trace, and code location) to a **single Claude Agent**.
5. Enable the Claude Agent to read project source files and perform code repairs targeted for execution within an **IntelliJ IDEA workspace**.

---

## 2. Technical Stack & Environment
- **Language**: TypeScript (Node.js runtime via `tsx`)
- **Browser Automation**: Playwright (`chromium` / `firefox`)
- **AI Agent Engine**: Claude Agent SDK (`@anthropic-ai/sdk`, `anthropic-ai/claude-agent-sdk`)
- **Configuration**: `dotenv` (`.env` file containing `BROWSER`, `TARGET_URL`, `ANTHROPIC_API_KEY`, `WORK_DIRECTORY`)
- **WORK_DIRECTORY**: this environmental variable indicate the directory of the source code the agent need to inspect, investigation and make potential changes. If there is CLAUDE.md under this directory, you have to feed this to claude as the system prompt during code changing.

---

## 3. Core Requirements & Logic

### Feature 1: Browser Error Listening & Filtering (`src/index.ts`)
- Use `launchPersistentContext` with `headless: false` so user interactions, logins, and cookies are preserved.
- Listen for both unhandled page exceptions (`page.on('pageerror')`) and explicitly logged errors (`page.on('console')` where `msg.type() === 'error'`).
- **Filtering Rules**:
  - **Include**: Errors that originate from local frontend source code (e.g., contains `.tsx`, `.ts`, `.vue`, `.js` or `/src/` paths in the location/stack trace).
  - **Exclude**: Network/HTTP errors (e.g., `4xx`, `5xx`, `net::ERR_FAILED`), CORS errors, or missing static asset logs (e.g., `favicon.ico 404`).

### Feature 2: Error Deduplication Engine (`src/utils/deduplicator.ts`)
- Create an error deduplication utility class (`ErrorDeduplicator`).
- **Fingerprint Generation**: Generate a unique hash or key for each error based on:
  `Hash = SHA256(Error Name + Error Message + File Path + Line Number)`
- **Cache & Throttling**:
  - Keep track of recently processed error signatures in memory.
  - If a duplicate error occurs within a configurable time window (e.g., 60 seconds), log it as ignored/suppressed and do not forward it to the Claude Agent.
  - Optional: Keep count of suppressed duplicate occurrences for logging/metrics.
  - After the monitored page refreshes, clear up recently processed error signatures in memory.

### Feature 3: Claude Code Repair Agent (`src/agent/repairAgent.ts`)
- Utilize a **Single Agent Architecture** with Tool Calling capabilities.
- Supply the Agent with essential tools to inspect and modify local codebase files in the IntelliJ project:
  1. `read_file(filePath: string)`: Reads content of local source files.
  2. `search_code(query: string)`: Searches for code snippets or function names across the `./src` directory.
  3. `apply_code_fix(filePath: string, oldCode: string, newCode: string)`: Replaces problematic code with fixed code.
- **Agent Workflow**:
  - Receive the deduplicated `FrontendErrorPayload`.
  - Analyze the stack trace and locate the target file within the local repository.
  - Inspect the source code lines near the error position using `read_file`.
  - Reason about the root cause and generate a minimal, high-confidence patch.
  - Execute `apply_code_fix` to modify the source code directly on disk (which IntelliJ automatically picks up via file system synchronization).

### Feature 4: Main Orchestrator (`src/index.ts`)
- Initialize configurations from `.env`.
- Instantiate `ErrorDeduplicator` and `BrowserConsoleListener`.
- When a valid, unique error is intercepted:
  1. Pass through `deduplicator.shouldProcess(errorPayload)`.
  2. If `true`, trigger `repairAgent.fixError(errorPayload)`.
  3. Log status and continue listening without crashing the process.

---

## 4. Expected Code Structure To Generate
```
.
├── .env
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                 # Main entry point & workflow orchestrator
    ├── browser/
    │   └── listener.ts          # Playwright listener with strict error filtering
    ├── utils/
    │   └── deduplicator.ts      # SHA-256 fingerprint deduplication utility
    └── agent/
        ├── repairAgent.ts       # Claude Agent setup & message handling
        └── tools.ts             # File system tools (read, search, edit) for IntelliJ project
```

---

## 5. Output Expectations
Please generate production-ready TypeScript code implementing the complete workflow described above, ensuring robust error handling, detailed console logs, and clean modular code.