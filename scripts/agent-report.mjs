#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HANDOFF_DIR = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff");
const RUN_STATUS = path.join(HANDOFF_DIR, "RUN_STATUS.md");

const args = process.argv.slice(2);
const options = new Map();
const positional = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (!arg.startsWith("--")) {
    positional.push(arg);
    continue;
  }

  const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
  if (inlineValue !== undefined) {
    options.set(rawKey, inlineValue);
    continue;
  }

  const next = args[index + 1];
  if (next && !next.startsWith("--")) {
    options.set(rawKey, next);
    index += 1;
  } else {
    options.set(rawKey, "true");
  }
}

const summary = (options.get("summary") || positional.join(" ")).trim();

if (!summary) {
  console.error('usage: pnpm agent:report -- "작업 요약"');
  console.error('   or: pnpm agent:report -- --status completed --summary "작업 요약" --verify "pnpm validate"');
  process.exit(1);
}

const status = options.get("status") || "completed";
const verification = options.get("verify") || options.get("verification") || "not recorded";
const git = options.get("git") || "not recorded";
const next = options.get("next") || "See tools/agent-orchestrator/handoff/NEXT_TASK.md";
const decisions = options.get("decisions") || "none";

const entry = `
## ${new Date().toISOString()}

- Status: ${status}
- Summary: ${summary}
- Verification: ${verification}
- Git: ${git}
- Decisions: ${decisions}
- Next: ${next}
`;

await mkdir(HANDOFF_DIR, { recursive: true });
await appendFile(RUN_STATUS, entry, "utf8");
console.log(`reported=${RUN_STATUS}`);
