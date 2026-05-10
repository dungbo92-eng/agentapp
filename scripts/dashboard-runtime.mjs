#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.resolve(process.env.AGENTAPP_DATA_DIR || path.join(REPO_ROOT, "data"));
const RUNTIME_FILE = path.join(DATA_DIR, "dashboard-runtime.json");
const HANDOFF_DIR = path.resolve(
  process.env.AGENTAPP_HANDOFF_DIR || path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff"),
);
const RUN_STATES_DIR = path.join(HANDOFF_DIR, "run-states");
const DASHBOARD_RUN_STATE = path.join(RUN_STATES_DIR, "dashboard-current.json");
const DASHBOARD_RUN_HANDOFF = path.join(HANDOFF_DIR, "DASHBOARD_RUN.md");
const DEFAULT_RUNTIME = {
  version: 1,
  accounts: [],
  projects: [],
  activeRun: null,
  runHistory: [],
};

const ESTIMATED_UNITS = {
  routine: 3,
  standard: 8,
  complex: 20,
  critical: 30,
};

const MODEL_RANK = {
  sonnet: 3,
  opus: 5,
  "gpt-5.4-mini": 2,
  "gpt-5.4": 4,
  "gpt-5.5": 5,
};

const SESSION_STATUSES = new Set(["needs-login", "ready", "paused"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSessionStatus(value) {
  const status = String(value || "needs-login")
    .trim()
    .toLowerCase();
  return SESSION_STATUSES.has(status) ? status : "needs-login";
}

function relativePath(file) {
  return path.relative(REPO_ROOT, file).replaceAll("\\", "/");
}

function providerForWorker(workerId) {
  if (String(workerId).includes("claude")) return "claude";
  if (String(workerId).includes("codex")) return "codex";
  return "";
}

function defaultProfiles(provider) {
  if (provider === "claude") {
    return {
      routine: { model: "sonnet", reasoningEffort: "normal", estimatedUnits: 3 },
      standard: { model: "sonnet", reasoningEffort: "high", estimatedUnits: 7 },
      complex: { model: "opus", reasoningEffort: "very_high", estimatedUnits: 18 },
      critical: { model: "opus", reasoningEffort: "very_high", estimatedUnits: 28 },
    };
  }

  if (provider === "codex") {
    return {
      routine: { model: "gpt-5.4-mini", reasoningEffort: "medium", estimatedUnits: 3 },
      standard: { model: "gpt-5.4", reasoningEffort: "high", estimatedUnits: 8 },
      complex: { model: "gpt-5.5", reasoningEffort: "xhigh", estimatedUnits: 20 },
      critical: { model: "gpt-5.5", reasoningEffort: "xhigh", estimatedUnits: 30 },
    };
  }

  return {
    routine: { model: "efficient", reasoningEffort: "medium", estimatedUnits: 3 },
    standard: { model: "balanced", reasoningEffort: "high", estimatedUnits: 8 },
    complex: { model: "best_available", reasoningEffort: "xhigh", estimatedUnits: 20 },
    critical: { model: "best_available", reasoningEffort: "xhigh", estimatedUnits: 30 },
  };
}

function normalizeAccount(input) {
  const provider = normalizeId(input.provider || "claude");
  const loginLabel = normalizeId(input.loginLabel || input.login_label || "google-a");
  const id = normalizeId(input.id || `${provider}-${loginLabel}`);
  const weeklyUnits = Number(input.weeklyUnits ?? input.weekly_units ?? input.weekly_budget_units ?? 100);
  const remainingUnits = Number(input.remainingUnits ?? input.remaining_units ?? weeklyUnits);

  return {
    id,
    provider,
    plan: String(input.plan || (provider === "claude" ? "pro" : "plus")).trim().toLowerCase(),
    loginLabel,
    enabled: input.enabled !== false,
    sessionStatus: normalizeSessionStatus(input.sessionStatus || input.session_status),
    lastVerifiedAt: input.lastVerifiedAt || input.last_verified_at || "",
    auth: "user-managed",
    remainingUnits: Math.max(0, remainingUnits),
    weeklyUnits: Math.max(1, weeklyUnits),
    resetDay: String(input.resetDay || input.reset_day || "monday").trim().toLowerCase(),
    source: "local",
    modelProfiles: input.modelProfiles || input.model_profiles || defaultProfiles(provider),
  };
}

function normalizeProject(input) {
  const rawPath = String(input.path || "").trim();
  const name = String(input.name || rawPath.split(/[\\/]/).filter(Boolean).at(-1) || "Local project").trim();
  return {
    id: normalizeId(input.id || `project-${Date.now()}`),
    name,
    path: rawPath,
    status: rawPath ? "needs-baseline" : "registered",
    progress: 0,
  };
}

function uniqueById(items) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function normalizeRuntime(input) {
  const runtime = { ...clone(DEFAULT_RUNTIME), ...(input || {}) };
  return {
    version: 1,
    accounts: Array.isArray(runtime.accounts) ? runtime.accounts.map(normalizeAccount) : [],
    projects: Array.isArray(runtime.projects) ? runtime.projects.map(normalizeProject) : [],
    activeRun: runtime.activeRun || null,
    runHistory: Array.isArray(runtime.runHistory) ? runtime.runHistory.slice(0, 20) : [],
  };
}

export async function readRuntime() {
  try {
    return normalizeRuntime(JSON.parse(await readFile(RUNTIME_FILE, "utf8")));
  } catch {
    return clone(DEFAULT_RUNTIME);
  }
}

export async function writeRuntime(runtime) {
  const normalized = normalizeRuntime(runtime);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(RUNTIME_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function defaultFourAccountPreset() {
  return buildAccountPreset({ claudeCount: 2, codexCount: 2 });
}

function loginLabelFor(index) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return `google-${alphabet[index] || index + 1}`;
}

function countFrom(input, key) {
  const count = Number(input[key] ?? 0);
  return Math.min(8, Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0));
}

export function buildAccountPreset(input = {}) {
  const remainingUnits = Number(input.remainingUnits ?? input.remaining_units ?? 70);
  const weeklyUnits = Number(input.weeklyUnits ?? input.weekly_units ?? 100);
  const counts = [
    { provider: "claude", plan: "pro", count: countFrom(input, "claudeCount") },
    { provider: "codex", plan: "plus", count: countFrom(input, "codexCount") },
    { provider: "cursor", plan: "team", count: countFrom(input, "cursorCount") },
    { provider: "gemini", plan: "pro", count: countFrom(input, "geminiCount") },
  ];

  return counts.flatMap(({ provider, plan, count }) =>
    Array.from({ length: count }, (_, index) => {
      const loginLabel = loginLabelFor(index);
      return normalizeAccount({
        provider,
        plan,
        loginLabel,
        id: `${provider}-${loginLabel}`,
        remainingUnits,
        weeklyUnits,
        sessionStatus: "needs-login",
      });
    }),
  );
}

export async function addAccount(input) {
  const runtime = await readRuntime();
  runtime.accounts = uniqueById([...runtime.accounts, normalizeAccount(input)]);
  return writeRuntime(runtime);
}

export async function setAccountEnabled(input) {
  const runtime = await readRuntime();
  const id = normalizeId(input.id);
  const exists = runtime.accounts.some((account) => account.id === id);
  const nextAccount = normalizeAccount({ ...input, id, enabled: input.enabled !== false });
  runtime.accounts = exists
    ? runtime.accounts.map((account) => (account.id === id ? { ...account, enabled: input.enabled !== false } : account))
    : uniqueById([...runtime.accounts, nextAccount]);
  return writeRuntime(runtime);
}

export async function setAccountSession(input) {
  const runtime = await readRuntime();
  const id = normalizeId(input.id);
  const sessionStatus = normalizeSessionStatus(input.sessionStatus || input.session_status);
  const lastVerifiedAt = sessionStatus === "ready" ? new Date().toISOString() : "";
  const exists = runtime.accounts.some((account) => account.id === id);
  const nextAccount = normalizeAccount({ ...input, id, sessionStatus, lastVerifiedAt });

  runtime.accounts = exists
    ? runtime.accounts.map((account) => (account.id === id ? { ...account, sessionStatus, lastVerifiedAt } : account))
    : uniqueById([...runtime.accounts, nextAccount]);

  return writeRuntime(runtime);
}

export async function applyFourAccountPreset() {
  return applyAccountPreset({ claudeCount: 2, codexCount: 2 });
}

export async function applyAccountPreset(input) {
  const runtime = await readRuntime();
  runtime.accounts = uniqueById([...runtime.accounts, ...buildAccountPreset(input)]);
  return writeRuntime(runtime);
}

export async function addProject(input) {
  const runtime = await readRuntime();
  runtime.projects = uniqueById([...runtime.projects, normalizeProject(input)]);
  return writeRuntime(runtime);
}

function routeScore(candidate, complexity) {
  const profile = candidate.profile;
  const account = candidate.account;
  const modelRank = MODEL_RANK[profile.model] || 1;
  const remaining = Number(account.remainingUnits || 0);
  const estimated = Number(profile.estimatedUnits || ESTIMATED_UNITS[complexity] || 8);

  if (complexity === "routine") return remaining * 2 - estimated * 10 - modelRank;
  if (complexity === "standard") return modelRank * 20 + remaining - estimated * 2;
  return modelRank * 100 + remaining - estimated;
}

export function selectRoute(accounts, request) {
  const complexity = request.complexity || "standard";
  const preferredProvider = providerForWorker(request.workerId);
  const enabledAccounts = accounts
    .filter((account) => account.enabled !== false)
    .filter((account) => !preferredProvider || account.provider === preferredProvider);
  const providerAccounts = enabledAccounts.filter((account) => account.sessionStatus === "ready");

  if (enabledAccounts.length === 0) {
    return {
      status: "blocked",
      reason: "No enabled user-managed account is available for this worker.",
      complexity,
    };
  }

  if (providerAccounts.length === 0) {
    return {
      status: "blocked",
      reason: "No ready user-managed session is available for this worker. Mark a logged-in account as ready first.",
      complexity,
    };
  }

  const candidates = providerAccounts
    .map((account) => ({ account, profile: account.modelProfiles?.[complexity] }))
    .filter((candidate) => candidate.profile)
    .filter((candidate) => Number(candidate.account.remainingUnits || 0) >= Number(candidate.profile.estimatedUnits || 0))
    .sort((left, right) => routeScore(right, complexity) - routeScore(left, complexity));

  if (candidates.length === 0) {
    return {
      status: "blocked",
      reason: "No user-managed account has enough local budget units for this worker and complexity.",
      complexity,
    };
  }

  const selected = candidates[0];
  return {
    status: "recommended",
    accountId: selected.account.id,
    provider: selected.account.provider,
    loginLabel: selected.account.loginLabel,
    model: selected.profile.model,
    reasoningEffort: selected.profile.reasoningEffort,
    estimatedUnits: Number(selected.profile.estimatedUnits || ESTIMATED_UNITS[complexity] || 8),
    complexity,
    reason:
      complexity === "routine"
        ? "Routine work uses the most efficient user-managed profile with enough remaining budget."
        : "Quality-first routing selected the strongest configured profile with enough remaining budget.",
  };
}

function dashboardRunState(run, status, reason) {
  const now = new Date().toISOString();
  return {
    version: 1,
    run_id: run.id,
    worker_id: run.workerId,
    worker_kind: providerForWorker(run.workerId) || run.workerId,
    workspace: REPO_ROOT,
    task: {
      id: "dashboard-run",
      title: "Dashboard start request",
      source: "dashboard",
    },
    status,
    reason,
    timestamps: {
      started_at: run.startedAt,
      updated_at: now,
    },
    usage: {
      provider: run.routing?.provider || providerForWorker(run.workerId) || "unknown",
      account_id: run.routing?.accountId || "",
      login_label: run.routing?.loginLabel || "",
      model_tier: run.routing?.model || "",
      reasoning_effort: run.routing?.reasoningEffort || "",
      estimated_units: run.routing?.estimatedUnits || 0,
      budget_status: run.routing?.status === "recommended" ? "reserved" : "blocked",
    },
    verification: {
      commands: [],
      result: "not_run",
    },
    handoff: {
      summary:
        status === "running"
          ? `Dashboard started ${run.workerId} with ${run.routing?.accountId || "no-account"} / ${run.routing?.model || "model-pending"}. Prompt body is stored local-only in data/dashboard-runtime.json.`
          : status === "queued"
            ? `Dashboard queued ${run.workerId} because no ready account or local budget route is available. Prompt body is stored local-only in data/dashboard-runtime.json.`
          : `Dashboard recorded ${status} for ${run.workerId}. Prompt body is stored local-only in data/dashboard-runtime.json.`,
      next_step:
        status === "running"
          ? "Monitor the dashboard run or stop it from the dashboard if the worker needs handoff."
          : status === "queued"
            ? "Open the dashboard, make one account ready, then start the run again if needed."
          : "Review the local run history and continue from NEXT_TASK.md or start a new dashboard run.",
      files: [
        "data/dashboard-runtime.json",
        "tools/agent-orchestrator/handoff/DASHBOARD_RUN.md",
        "tools/agent-orchestrator/handoff/run-states/dashboard-current.json",
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
      prompt_body_stored_local_only: true,
      external_write: false,
      policy_action: "auto_allowed",
    },
  };
}

function dashboardRunMarkdown(state) {
  return `# DASHBOARD_RUN

- Generated: ${state.timestamps.updated_at}
- Run state: ${relativePath(DASHBOARD_RUN_STATE)}
- Worker: ${state.worker_id}
- Status: ${state.status}
- Reason: ${state.reason}
- Account: ${state.usage.account_id || "none"}
- Model: ${state.usage.model_tier || "none"}
- Prompt body: local-only in data/dashboard-runtime.json
- Contains secrets: ${state.safety.contains_secrets}

## Summary

${state.handoff.summary}

## Next Step

${state.handoff.next_step}
`;
}

async function writeDashboardRunHandoff(run, status, reason) {
  const state = dashboardRunState(run, status, reason);
  await mkdir(RUN_STATES_DIR, { recursive: true });
  await writeFile(DASHBOARD_RUN_STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await writeFile(DASHBOARD_RUN_HANDOFF, dashboardRunMarkdown(state), "utf8");
  return relativePath(DASHBOARD_RUN_STATE);
}

export async function startRun(input) {
  const runtime = await readRuntime();
  const routing = selectRoute(runtime.accounts, input);
  const id = `run-${Date.now()}`;
  const run = {
    id,
    status: routing.status === "blocked" ? "queued" : "running",
    workerId: String(input.workerId || "codex"),
    projectId: String(input.projectId || "current"),
    prompt: String(input.prompt || "").trim(),
    complexity: String(input.complexity || "standard"),
    startedAt: new Date().toISOString(),
    routing,
  };
  run.handoffPath = await writeDashboardRunHandoff(
    run,
    run.status,
    routing.status === "blocked" ? "missing_credentials" : "in_progress",
  );

  if (routing.accountId && routing.estimatedUnits) {
    runtime.accounts = runtime.accounts.map((account) =>
      account.id === routing.accountId
        ? { ...account, remainingUnits: Math.max(0, Number(account.remainingUnits || 0) - Number(routing.estimatedUnits || 0)) }
        : account,
    );
  }

  runtime.activeRun = run.status === "running" ? run : null;
  runtime.runHistory = [run, ...runtime.runHistory.filter((item) => item.id !== id)].slice(0, 20);
  return writeRuntime(runtime);
}

export async function stopRun() {
  const runtime = await readRuntime();
  if (!runtime.activeRun) return runtime;
  const stopped = {
    ...runtime.activeRun,
    status: "stopped",
    stoppedAt: new Date().toISOString(),
  };
  stopped.handoffPath = await writeDashboardRunHandoff(stopped, "interrupted", "user_stopped");
  runtime.activeRun = null;
  runtime.runHistory = [stopped, ...runtime.runHistory.filter((item) => item.id !== stopped.id)].slice(0, 20);
  return writeRuntime(runtime);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const runtime = command === "--preset-four-accounts" ? await applyFourAccountPreset() : await readRuntime();
  console.log(JSON.stringify(runtime, null, 2));
}
