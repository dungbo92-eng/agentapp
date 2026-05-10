#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const RUNTIME_FILE = path.join(DATA_DIR, "dashboard-runtime.json");
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
  return [
    normalizeAccount({ provider: "claude", plan: "pro", loginLabel: "google-a", id: "claude-google-a", remainingUnits: 70, weeklyUnits: 100 }),
    normalizeAccount({ provider: "claude", plan: "pro", loginLabel: "google-b", id: "claude-google-b", remainingUnits: 70, weeklyUnits: 100 }),
    normalizeAccount({ provider: "codex", plan: "plus", loginLabel: "google-a", id: "codex-google-a", remainingUnits: 70, weeklyUnits: 100 }),
    normalizeAccount({ provider: "codex", plan: "plus", loginLabel: "google-b", id: "codex-google-b", remainingUnits: 70, weeklyUnits: 100 }),
  ];
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

export async function applyFourAccountPreset() {
  const runtime = await readRuntime();
  runtime.accounts = uniqueById([...runtime.accounts, ...defaultFourAccountPreset()]);
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
  const providerAccounts = accounts
    .filter((account) => account.enabled !== false)
    .filter((account) => !preferredProvider || account.provider === preferredProvider);
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
  runtime.activeRun = null;
  runtime.runHistory = [stopped, ...runtime.runHistory.filter((item) => item.id !== stopped.id)].slice(0, 20);
  return writeRuntime(runtime);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const runtime = command === "--preset-four-accounts" ? await applyFourAccountPreset() : await readRuntime();
  console.log(JSON.stringify(runtime, null, 2));
}
