#!/usr/bin/env node

import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HANDOFF_DIR = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff");
const RUN_STATES_DIR = path.join(HANDOFF_DIR, "run-states");
const NEXT_TASK = path.join(HANDOFF_DIR, "NEXT_TASK.md");
const RUN_STATUS = path.join(HANDOFF_DIR, "RUN_STATUS.md");
const HANDOFF_ONLY = path.join(HANDOFF_DIR, "HANDOFF_ONLY.md");

const STATUSES = new Set([
  "queued",
  "running",
  "completed",
  "interrupted",
  "blocked",
  "failed",
  "quota_limited",
  "needs_user",
]);
const REASONS = new Set([
  "not_started",
  "in_progress",
  "completed",
  "user_stopped",
  "session_timeout",
  "quota_exhausted",
  "missing_credentials",
  "hold_for_user",
  "deny_policy",
  "validation_failed",
  "tool_error",
  "merge_conflict",
  "unknown",
]);
const POLICY_ACTIONS = new Set(["auto_allowed", "hold_for_user", "deny"]);
const WORKER_KINDS = new Map([
  ["codex", "codex"],
  ["claude-code", "claude-code"],
  ["cursor", "cursor"],
  ["gemini-cli", "gemini-cli"],
]);
const PROVIDERS = new Map([
  ["codex", "codex"],
  ["claude-code", "claude"],
  ["cursor", "cursor"],
  ["gemini-cli", "gemini"],
]);

const HELP = `Usage:
  pnpm agent:fallback -- --worker codex --reason tool_error --summary "Cannot run tool here"
  pnpm agent:fallback -- --worker claude-code --status quota_limited --reason quota_exhausted --summary "Weekly budget is exhausted"
  pnpm agent:fallback -- --worker cursor --summary "IDE is unavailable" --dry-run --json

Writes a handoff-only run state without executing the worker.
`;

function parseArgs(argv) {
  const options = {
    worker: "codex",
    status: "blocked",
    reason: "tool_error",
    summary: "",
    "next-step": "Continue from tools/agent-orchestrator/handoff/NEXT_TASK.md with another available worker.",
    "policy-action": "hold_for_user",
    "decision-id": "",
    "verification-result": "not_run",
    "dry-run": false,
    json: false,
    help: false,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options["dry-run"] = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      options[key] = argv[index + 1] || "";
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  if (!options.summary && positional.length > 0) {
    options.summary = positional.join(" ");
  }

  return options;
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function runId(worker, date = new Date()) {
  return `run-${timestamp(date)}-${worker}`.toLowerCase().replace(/[^a-z0-9-tz-]/g, "-");
}

function parseNextTask(markdown) {
  const get = (label) => markdown.match(new RegExp(`^- ${label}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
  return {
    id: get("Task id") || "n/a",
    title: get("Selected task") || "See NEXT_TASK.md",
    source: get("Selection source") || "handoff",
  };
}

function assertSafeText(value, label) {
  const secretPattern = /(api[_ -]?key|secret|token|password|passwd|cookie|session|authorization|bearer)\s*[:=]/i;
  if (secretPattern.test(value)) {
    throw new Error(`${label} appears to contain a secret-like assignment; do not write it to handoff files`);
  }
}

function validateOptions(options) {
  if (!STATUSES.has(options.status)) throw new Error(`invalid --status ${options.status}`);
  if (!REASONS.has(options.reason)) throw new Error(`invalid --reason ${options.reason}`);
  if (!POLICY_ACTIONS.has(options["policy-action"])) {
    throw new Error(`invalid --policy-action ${options["policy-action"]}`);
  }
  if (!options.summary.trim()) throw new Error("missing --summary");
  assertSafeText(options.summary, "summary");
  assertSafeText(options["next-step"], "next-step");
}

function buildState(options, nextTask, generatedAt) {
  const workerKind = WORKER_KINDS.get(options.worker) || "other";
  const state = {
    version: 1,
    run_id: runId(options.worker, generatedAt),
    worker_id: options.worker,
    worker_kind: workerKind,
    workspace: REPO_ROOT,
    task: {
      id: nextTask.id,
      title: nextTask.title,
      source: ["task-queue", "roadmap", "manual", "handoff"].includes(nextTask.source) ? nextTask.source : "handoff",
    },
    status: options.status,
    reason: options.reason,
    timestamps: {
      started_at: generatedAt.toISOString(),
      updated_at: generatedAt.toISOString(),
    },
    usage: {
      provider: PROVIDERS.get(options.worker) || "other",
      budget_status: options.status === "quota_limited" ? "exhausted" : "unknown",
    },
    verification: {
      commands: [],
      result: options["verification-result"],
    },
    handoff: {
      summary: options.summary,
      next_step: options["next-step"],
      files: [
        "tools/agent-orchestrator/handoff/NEXT_TASK.md",
        "tools/agent-orchestrator/handoff/HANDOFF_ONLY.md",
        "tools/agent-orchestrator/handoff/RUN_STATUS.md",
      ],
    },
    git: {
      branch: "main",
      commit: "not_created",
      pushed: false,
      dirty: true,
    },
    safety: {
      contains_secrets: false,
      external_write: false,
      policy_action: options["policy-action"],
    },
  };

  if (options["decision-id"]) {
    state.handoff.decision_id = options["decision-id"];
  }

  return state;
}

function markdownForState(state, statePath) {
  return `# HANDOFF_ONLY

- Generated: ${state.timestamps.updated_at}
- Run state: ${path.relative(REPO_ROOT, statePath).replaceAll("\\", "/")}
- Worker: ${state.worker_id}
- Status: ${state.status}
- Reason: ${state.reason}
- Policy action: ${state.safety.policy_action}
- Contains secrets: ${state.safety.contains_secrets}

## Task

- Task id: ${state.task.id}
- Task title: ${state.task.title}
- Source: ${state.task.source}

## Summary

${state.handoff.summary}

## Next Step

${state.handoff.next_step}

## Required Reads

1. AGENTS.md
2. .claude-sync/memory/project_state.md
3. .claude-sync/plans/agent-orchestrator-roadmap.md
4. tools/agent-orchestrator/approval-policy.yaml
5. tools/agent-orchestrator/handoff/NEXT_TASK.md
6. tools/agent-orchestrator/handoff/RUN_STATUS.md
7. ${path.relative(REPO_ROOT, statePath).replaceAll("\\", "/")}
`;
}

function runStatusEntry(state, statePath) {
  return `
## ${state.timestamps.updated_at}

- Status: ${state.status}
- Summary: handoff-only fallback recorded for ${state.worker_id}: ${state.handoff.summary}
- Verification: ${state.verification.result}
- Git: not_created
- Decisions: ${state.handoff.decision_id || "none"}
- Next: ${state.handoff.next_step}
- Run state: ${path.relative(REPO_ROOT, statePath).replaceAll("\\", "/")}
`;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

validateOptions(options);

const generatedAt = new Date();
const nextTask = parseNextTask(await readFile(NEXT_TASK, "utf8"));
const state = buildState(options, nextTask, generatedAt);
const statePath = path.join(RUN_STATES_DIR, `${state.run_id}.json`);

if (!options["dry-run"]) {
  await mkdir(RUN_STATES_DIR, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(HANDOFF_ONLY, markdownForState(state, statePath), "utf8");
  await appendFile(RUN_STATUS, runStatusEntry(state, statePath), "utf8");
}

if (options.json) {
  console.log(JSON.stringify({ dry_run: options["dry-run"], state, state_path: statePath, handoff_path: HANDOFF_ONLY }, null, 2));
} else {
  console.log(`dry_run=${options["dry-run"]}`);
  console.log(`state=${statePath}`);
  console.log(`handoff=${HANDOFF_ONLY}`);
  console.log(`status=${state.status}`);
  console.log(`reason=${state.reason}`);
}
