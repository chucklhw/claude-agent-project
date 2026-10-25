import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { query, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { FrontendErrorPayload } from '../browser/listener.js';
import { debug } from '../utils/logger.js';

const REPAIR_PROMPT = `You fix frontend runtime errors in a local project that the developer has open in IntelliJ IDEA. Your working directory is the project root.

You receive one browser error: its message, stack trace and location. The Location line is 1-based; line numbers inside the raw stack trace are 0-based. Locations are browser URLs (e.g. http://localhost:5173/src/components/Foo.tsx?t=123:42:7); map the URL path to a file in the project, and use Grep/Glob when the mapping is unclear or the code is bundled.

Workflow:
1. Locate the source file and read the code around the reported line.
2. Determine the root cause.
3. Propose the smallest correct fix. Do not edit anything until the developer approves the proposal.
4. Once approved, apply exactly the proposed fix with Edit. Do not refactor, reformat or change unrelated code.

Rules:
- Only change source code of the working project. Never edit third-party libraries (node_modules or any other vendored/installed dependency) or files outside the working directory; such edits are blocked. If the root cause is in a third-party library, say so and propose a change in the project's own code (e.g. a workaround or a corrected usage) instead, or propose no change.`;

const PROPOSAL_PROMPTS = {
  fe: 'Propose a frontend code fix: the root cause, the file(s) to change and the exact change (before/after). If the cause is outside the frontend source (backend, environment, third-party library) or you are not confident, say so and propose no change.',
  data: 'The developer believes the cause is wrong database data. You cannot access the database, so base your analysis on the code: propose the data fix with the root cause, the table/record/field that likely needs changing and the SQL you would run.',
} as const;

type FixTarget = keyof typeof PROPOSAL_PROMPTS;

const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const EDIT_TOOLS = [...READ_TOOLS, 'Edit'];

// Edits are only allowed in the working project's own source, never in third-party libraries
function isProjectSource(workDirectory: string, filePath: string): boolean {
  const relative = path.relative(workDirectory, path.resolve(workDirectory, filePath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  return !relative.split(path.sep).includes('node_modules');
}

function describeError(p: FrontendErrorPayload): string {
  return [
    `Source: ${p.source}`,
    `Page: ${p.pageUrl}`,
    `Error: ${p.name}: ${p.message}`,
    p.filePath ? `Location: ${p.filePath}:${p.line}:${p.column}` : 'Location: unknown',
    p.stack ? `Stack trace:\n${p.stack}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// Wait for a single y/n keypress; other keys are ignored
function confirm(question: string): Promise<boolean> {
  const { stdin } = process;
  process.stdout.write(question);
  return new Promise((resolve) => {
    const onData = (data: Buffer) => {
      const key = data.toString().trim().toLowerCase();
      // Raw mode swallows Ctrl+C, so exit manually
      if (key === '\u0003') process.exit(130);
      if (key !== 'y' && key !== 'n') return;
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write(`${key}\n`);
      resolve(key === 'y');
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

// Ask until the user types "fe" or "data" (case-insensitive)
async function chooseFixTarget(): Promise<FixTarget> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Without a listener, readline swallows Ctrl+C
  rl.on('SIGINT', () => process.exit(130));
  try {
    for (;;) {
      const answer = (await rl.question('🛠️  Fix type? [fe=frontend code / data=database data] ')).trim().toLowerCase();
      if (answer === 'fe' || answer === 'data') return answer;
    }
  } finally {
    rl.close();
  }
}

export class RepairAgent {
  constructor(private readonly workDirectory: string) {}

  private readonly guardEdit: HookCallback = async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const filePath = (input.tool_input as { file_path?: unknown }).file_path;
    if (typeof filePath === 'string' && isProjectSource(this.workDirectory, filePath)) return {};
    console.warn(`🚫 [Agent] Blocked edit outside the project source: ${String(filePath)}`);
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Only files in the working project may be edited; third-party libraries (node_modules) and files outside the working directory are off limits.',
      },
    };
  };

  // Re-read on every run so edits to CLAUDE.md apply without a restart
  private async buildSystemPrompt(): Promise<string> {
    try {
      const claudeMd = await readFile(path.join(this.workDirectory, 'CLAUDE.md'), 'utf8');
      debug('📄 [Agent] Loaded WORK_DIRECTORY/CLAUDE.md as system prompt');
      return `${REPAIR_PROMPT}\n\n# Project instructions (from CLAUDE.md)\n\n${claudeMd}`;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      return REPAIR_PROMPT;
    }
  }

  // Returns undefined when the run does not finish successfully
  private async run(prompt: string, tools: string[], resume?: string): Promise<{ sessionId: string; result: string } | undefined> {
    for await (const message of query({
      prompt,
      options: {
        cwd: this.workDirectory,
        systemPrompt: await this.buildSystemPrompt(),
        // Isolation: CLAUDE.md is injected above, so don't load filesystem settings
        settingSources: [],
        tools,
        allowedTools: tools,
        permissionMode: 'acceptEdits',
        hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [this.guardEdit] }] },
        model: 'claude-opus-5-5',
        effort: 'high',
        maxTurns: 30,
        ...(resume && { resume }),
      },
    })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') debug(`   🔧 ${block.name} ${JSON.stringify(block.input).slice(0, 200)}`);
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          debug(`✅ [Agent] Done (${message.num_turns} turns, $${message.total_cost_usd.toFixed(4)})`);
          return { sessionId: message.session_id, result: message.result };
        }
        console.warn(`⚠️  [Agent] Not completed: ${message.subtype} ${message.errors.join('; ')}`);
      }
    }
    return undefined;
  }

  async fixError(payload: FrontendErrorPayload): Promise<void> {
    const description = describeError(payload);
    console.log(`\n🐞 [Browser console]\n${description}`);
    if (!(await confirm('❓ Fix this error? [y/n] '))) {
      console.log('⏭️  [Agent] Skipped\n');
      return;
    }
    const target = await chooseFixTarget();

    console.log(`🤖 [Agent] Analysing: ${payload.name}: ${payload.message.split('\n')[0]}`);
    // Read-only tools: the agent can only propose until the plan is approved
    const proposal = await this.run(`${description}\n\n${PROPOSAL_PROMPTS[target]}`, READ_TOOLS);
    if (!proposal) return;

    console.log(`\n📋 [Agent] Proposed fix:\n${proposal.result}\n`);
    if (!(await confirm('❓ Approve this proposal? [y/n] '))) {
      console.log('⏭️  [Agent] Proposal not approved, skipped\n');
      return;
    }
    if (target === 'data') {
      // TODO: connect to the database and apply the approved data fix once DB tools are available
      console.log('🗄️  [Agent] Database repair not yet implemented, skipped\n');
      return;
    }

    console.log('🔧 [Agent] Applying fix');
    const applied = await this.run('Approved. Apply exactly the proposed fix now.', EDIT_TOOLS, proposal.sessionId);
    if (applied) console.log(`${applied.result}\n`);
  }
}
