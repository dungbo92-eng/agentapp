#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKERS = path.join(REPO_ROOT, "tools", "agent-orchestrator", "workers.example.yaml");
const NEXT_TASK = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "NEXT_TASK.md");
const OUTPUT_DIR = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "worker-prompts");

const HELP = `Usage:
  pnpm agent:prompt -- --worker codex
  pnpm agent:prompt -- --worker claude-code --write
  pnpm agent:prompt -- --all --write
  pnpm agent:prompt -- --all --json

Generates worker-specific start prompts from workers.example.yaml and NEXT_TASK.md.
`;

function parseArgs(argv) {
  const options = {
    worker: "",
    all: false,
    write: false,
    json: false,
    out: OUTPUT_DIR,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--worker") {
      options.worker = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--out") {
      options.out = path.resolve(REPO_ROOT, argv[index + 1] || "");
      index += 1;
    } else if (!arg.startsWith("--") && !options.worker) {
      options.worker = arg;
    }
  }

  return options;
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseListItem(line) {
  const match = line.match(/^\s*-\s+(.+?)\s*$/);
  return match ? unquote(match[1]) : null;
}

function parseWorkers(text) {
  const workers = [];
  let inWorkers = false;
  let current = null;
  let section = "";
  let routingLevel = "";

  for (const line of text.split(/\r?\n/)) {
    if (line === "workers:") {
      inWorkers = true;
      continue;
    }
    if (!inWorkers) continue;
    if (/^[a-z_]+:/.test(line)) break;

    const workerMatch = line.match(/^  - id:\s*(.+?)\s*$/);
    if (workerMatch) {
      current = {
        id: unquote(workerMatch[1]),
        kind: "",
        display_name: "",
        workspace: "",
        launch_instructions: [],
        model_routing: {},
      };
      workers.push(current);
      section = "";
      routingLevel = "";
      continue;
    }
    if (!current) continue;

    const sectionMatch = line.match(/^    ([a-z_]+):\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      routingLevel = "";
      continue;
    }

    const fieldMatch = line.match(/^    ([a-z_]+):\s*(.+?)\s*$/);
    if (fieldMatch) {
      const [, key, rawValue] = fieldMatch;
      if (["kind", "display_name", "workspace", "status", "auth"].includes(key)) {
        current[key] = unquote(rawValue);
      }
      section = key;
      routingLevel = "";
      continue;
    }

    const nestedSection = line.match(/^      ([a-z_]+):\s*$/);
    if (nestedSection) {
      if (section === "model_routing") routingLevel = nestedSection[1];
      section = section === "model_routing" ? "model_routing" : nestedSection[1];
      continue;
    }

    if (section === "instructions") {
      const item = parseListItem(line);
      if (item) current.launch_instructions.push(item);
      continue;
    }

    if (section === "launch" && line.match(/^      instructions:\s*$/)) {
      section = "instructions";
      continue;
    }

    if (section === "model_routing" && routingLevel) {
      const routeMatch = line.match(/^        ([a-z_]+):\s*(.+?)\s*$/);
      if (routeMatch) {
        current.model_routing[routingLevel] ||= {};
        current.model_routing[routingLevel][routeMatch[1]] = unquote(routeMatch[2]);
      }
    }
  }

  return workers;
}

function parseNextTask(markdown) {
  const get = (label) => markdown.match(new RegExp(`^- ${label}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
  const prompt = markdown.match(/## Agent Prompt\n\n([\s\S]*?)(?=\n## |\n?$)/)?.[1]?.trim() || "";
  return {
    generated: get("Generated"),
    selected: get("Selected task"),
    source: get("Selection source"),
    task_id: get("Task id"),
    priority: get("Task priority"),
    prompt,
  };
}

function routingSummary(worker) {
  const entries = Object.entries(worker.model_routing || {});
  if (entries.length === 0) return "- Run `pnpm agent:route` before spending scarce weekly usage.";
  return entries
    .map(([level, route]) => `- ${level}: ${route.model_tier || "n/a"} / ${route.reasoning_effort || "n/a"}`)
    .join("\n");
}

function workerSpecificNotes(worker) {
  if (worker.kind === "claude-code") {
    return "- Claude Code loads `CLAUDE.md` automatically, but still read `AGENTS.md` for shared policy.";
  }
  if (worker.kind === "codex") {
    return "- Codex should start from `AGENTS.md`, then use `NEXT_TASK.md` as the handoff source.";
  }
  if (worker.kind === "cursor") {
    return "- Paste this prompt into Cursor with `E:\\agentApp` opened as the workspace.";
  }
  if (worker.kind === "gemini-cli") {
    return "- Start Gemini CLI from `E:\\agentApp`, then paste this prompt as the working instruction.";
  }
  return "- Use the normal user-authenticated session for this worker.";
}

function buildPrompt(worker, nextTask) {
  const launchInstructions =
    worker.launch_instructions.length > 0
      ? worker.launch_instructions.map((item) => `- ${item}`).join("\n")
      : "- Start the worker manually from the repository root.";

  return `# ${worker.display_name || worker.id} Start Prompt

Workspace: ${worker.workspace || "E:\\agentApp"}
Worker id: ${worker.id}
Worker kind: ${worker.kind}
Auth: user-managed only

## Launch

${launchInstructions}

${workerSpecificNotes(worker)}

## Required Reads

1. AGENTS.md
2. .claude-sync/memory/project_state.md
3. .claude-sync/plans/agent-orchestrator-roadmap.md
4. tools/agent-orchestrator/approval-policy.yaml
5. docs/usage-budget-model-routing.md
6. docs/handoff-completion-protocol.md
7. tools/agent-orchestrator/task-queue.json
8. tools/agent-orchestrator/handoff/NEXT_TASK.md

## Current Task

- Selected task: ${nextTask.selected || "See NEXT_TASK.md"}
- Task id: ${nextTask.task_id || "n/a"}
- Priority: ${nextTask.priority || "n/a"}
- Generated: ${nextTask.generated || "n/a"}

${nextTask.prompt || "Read tools/agent-orchestrator/handoff/NEXT_TASK.md and continue the selected task."}

## Model Routing

Quality is first. Use efficient models for routine reading, setup, and simple docs. Use the best available model and high reasoning for architecture, trading logic, AI integration, security, or irreversible design work.

${routingSummary(worker)}

Before heavy work, run:

\`\`\`bash
pnpm agent:route -- --task "${(nextTask.selected || "작업").replace(/"/g, '\\"')}"
\`\`\`

## Safety Rules

- Do not automate login, account switching, approvals, captcha, MFA, billing, or quota bypass.
- Do not store secrets, credentials, cookies, tokens, or account identifiers in repo files or logs.
- Continue local implementation, docs, tests, validation, handoff updates, commit, and approved remote push without asking.
- For uncertain operations, classify first:

\`\`\`bash
pnpm agent:dry-run -- --operation "<operation>"
\`\`\`

## Completion

Run the completion sequence when meaningful work is done:

\`\`\`bash
pnpm validate
pnpm agent:doctor
pnpm agent:progress
pnpm agent:next
pnpm agent:sync
git status --short
\`\`\`

Then commit verified changes and push to the configured approved remote.
`;
}

async function writePrompt(outDir, workerId, prompt) {
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${workerId}.md`);
  await writeFile(file, prompt, "utf8");
  return file;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

const workers = parseWorkers(await readFile(WORKERS, "utf8"));
const nextTask = parseNextTask(await readFile(NEXT_TASK, "utf8"));
const selectedWorkers = options.all ? workers : workers.filter((worker) => worker.id === (options.worker || "codex"));

if (selectedWorkers.length === 0) {
  console.error(`[agent-worker-prompt] unknown worker: ${options.worker || "codex"}`);
  console.error(`known=${workers.map((worker) => worker.id).join(",")}`);
  process.exit(1);
}

const results = [];
for (const worker of selectedWorkers) {
  const prompt = buildPrompt(worker, nextTask);
  const written = options.write ? await writePrompt(options.out, worker.id, prompt) : "";
  results.push({ worker: worker.id, path: written, prompt });
}

if (options.json) {
  console.log(JSON.stringify(results, null, 2));
} else if (options.write) {
  for (const result of results) {
    console.log(`written=${result.path}`);
  }
} else {
  console.log(results.map((result) => result.prompt).join("\n\n---\n\n"));
}
