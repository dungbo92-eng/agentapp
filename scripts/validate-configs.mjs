#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JSON_FILES = [
  "tools/agent-orchestrator/task-queue.json",
  "tools/agent-orchestrator/usage-budget.schema.json",
  "tools/agent-orchestrator/usage-budget.example.json",
  "tools/agent-orchestrator/usage-budget.low.example.json",
  "tools/agent-orchestrator/usage-budget.empty.json",
  "tools/agent-orchestrator/worker-run-state.schema.json",
  "tools/agent-orchestrator/worker-run-state.example.json"
];

async function readJson(relativePath) {
  const file = path.join(REPO_ROOT, relativePath);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${relativePath}: ${error.message}`);
  }
}

const parsed = new Map();
for (const file of JSON_FILES) {
  parsed.set(file, await readJson(file));
  console.log(`[validate-configs] ok ${file}`);
}

const taskQueue = parsed.get("tools/agent-orchestrator/task-queue.json");
if (!Array.isArray(taskQueue.tasks) || taskQueue.tasks.length === 0) {
  throw new Error("tools/agent-orchestrator/task-queue.json: tasks must be a non-empty array");
}

const usageBudget = parsed.get("tools/agent-orchestrator/usage-budget.example.json");
const accountIds = new Set();
for (const account of usageBudget.accounts || []) {
  if (accountIds.has(account.id)) {
    throw new Error(`tools/agent-orchestrator/usage-budget.example.json: duplicate account id ${account.id}`);
  }
  accountIds.add(account.id);
  if (account.auth !== "user-managed") {
    throw new Error(`tools/agent-orchestrator/usage-budget.example.json: ${account.id} auth must be user-managed`);
  }
}

const workerRunState = parsed.get("tools/agent-orchestrator/worker-run-state.example.json");
const allowedRunStatuses = new Set([
  "queued",
  "running",
  "completed",
  "interrupted",
  "blocked",
  "failed",
  "quota_limited",
  "needs_user"
]);
const allowedRunReasons = new Set([
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
  "unknown"
]);
if (!allowedRunStatuses.has(workerRunState.status)) {
  throw new Error(`tools/agent-orchestrator/worker-run-state.example.json: invalid status ${workerRunState.status}`);
}
if (!allowedRunReasons.has(workerRunState.reason)) {
  throw new Error(`tools/agent-orchestrator/worker-run-state.example.json: invalid reason ${workerRunState.reason}`);
}
if (workerRunState.safety?.contains_secrets !== false) {
  throw new Error("tools/agent-orchestrator/worker-run-state.example.json: contains_secrets must be false");
}
if (!["auto_allowed", "hold_for_user", "deny"].includes(workerRunState.safety?.policy_action)) {
  throw new Error("tools/agent-orchestrator/worker-run-state.example.json: invalid policy_action");
}

console.log("[validate-configs] done");
