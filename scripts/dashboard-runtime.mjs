#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deleteCredential, storeCredential } from "./credential-vault.mjs";

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
const AUTH_METHODS = new Set(["google", "email_password", "api_key", "cli_session", "browser_profile", "manual"]);

const PLAN_WEEKLY_BUDGET = {
  pro: 100,
  plus: 80,
  team: 200,
  local: 50,
};

const PROVIDER_CLI = {
  claude: { command: "claude", envOverride: "AGENTAPP_CLAUDE_COMMAND", configEnv: "CLAUDE_CONFIG_DIR", configSubdir: "session-profiles/claude-code" },
  codex: { command: "codex", envOverride: "AGENTAPP_CODEX_COMMAND", configEnv: "CODEX_HOME", configSubdir: "session-profiles/codex" },
  cursor: { command: "cursor", envOverride: "AGENTAPP_CURSOR_COMMAND", configEnv: "", configSubdir: "session-profiles/cursor" },
  gemini: { command: "gemini", envOverride: "AGENTAPP_GEMINI_COMMAND", configEnv: "", configSubdir: "session-profiles/gemini-cli" },
};

function planWeeklyDefault(plan) {
  const key = String(plan || "").trim().toLowerCase();
  return PLAN_WEEKLY_BUDGET[key] || PLAN_WEEKLY_BUDGET.pro;
}

export { REPO_ROOT, DATA_DIR, HANDOFF_DIR, RUN_STATES_DIR, DASHBOARD_RUN_STATE, DASHBOARD_RUN_HANDOFF };

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

function normalizeAuthMethod(value) {
  const method = normalizeId(value || "google").replaceAll("-", "_");
  return AUTH_METHODS.has(method) ? method : "manual";
}

function sessionProfileFor(provider, email, loginLabel) {
  const identity = normalizeId(email || loginLabel || "default");
  return `${normalizeId(provider || "agent")}/${identity}`;
}

function relativePath(file) {
  return path.relative(REPO_ROOT, file).replaceAll("\\", "/");
}

export { relativePath };

function providerForWorker(workerId) {
  if (String(workerId).includes("claude")) return "claude";
  if (String(workerId).includes("codex")) return "codex";
  if (String(workerId).includes("cursor")) return "cursor";
  if (String(workerId).includes("gemini")) return "gemini";
  return "";
}

export { providerForWorker };

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
  const email = String(input.email || input.loginEmail || input.login_email || "").trim().toLowerCase();
  const loginLabel = normalizeId(input.loginLabel || input.login_label || email || "google-a");
  const id = normalizeId(input.id || `${provider}-${loginLabel}`);
  const plan = String(input.plan || (provider === "claude" ? "pro" : "plus")).trim().toLowerCase();
  const planDefault = planWeeklyDefault(plan);
  const weeklyRaw = input.weeklyUnits ?? input.weekly_units ?? input.weekly_budget_units;
  const weeklyUnits = Number.isFinite(Number(weeklyRaw)) && Number(weeklyRaw) > 0 ? Number(weeklyRaw) : planDefault;
  const remainingRaw = input.remainingUnits ?? input.remaining_units;
  const remainingUnits = Number.isFinite(Number(remainingRaw)) ? Number(remainingRaw) : weeklyUnits;
  const credentialStatus = input.credentialStatus || input.credential_status || (input.credentialRef || input.credential_ref ? "stored" : "empty");

  return {
    id,
    displayName: String(input.displayName || input.display_name || id).trim(),
    provider,
    plan,
    loginLabel,
    email,
    authMethod: normalizeAuthMethod(input.authMethod || input.auth_method),
    sessionProfile: String(input.sessionProfile || input.session_profile || sessionProfileFor(provider, email, loginLabel)).trim(),
    enabled: input.enabled !== false,
    sessionStatus: normalizeSessionStatus(input.sessionStatus || input.session_status),
    lastVerifiedAt: input.lastVerifiedAt || input.last_verified_at || "",
    credentialRef: input.credentialRef || input.credential_ref || "",
    credentialStatus,
    auth: "user-managed",
    remainingUnits: Math.max(0, remainingUnits),
    weeklyUnits: Math.max(1, weeklyUnits),
    resetDay: String(input.resetDay || input.reset_day || "monday").trim().toLowerCase(),
    source: "local",
    modelProfiles: input.modelProfiles || input.model_profiles || defaultProfiles(provider),
    sessionDetectionReason: input.sessionDetectionReason || input.session_detection_reason || "",
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
  const account = normalizeAccount(input);
  if (input.secret) {
    const credential = await storeCredential({ accountId: account.id, kind: input.secretKind || "password", secret: input.secret });
    account.credentialRef = credential.credentialRef;
    account.credentialStatus = credential.credentialStatus;
  }
  const detection = await detectAccountSession(account);
  account.sessionStatus = detection.sessionStatus;
  account.sessionDetectionReason = detection.reason;
  if (detection.sessionStatus === "ready") account.lastVerifiedAt = nowIso();
  runtime.accounts = uniqueById([...runtime.accounts, account]);
  return writeRuntime(runtime);
}

export async function saveAccountCredential(input) {
  const runtime = await readRuntime();
  const id = normalizeId(input.id || input.accountId || input.account_id);
  const account = runtime.accounts.find((item) => item.id === id);
  if (!account) throw new Error(`unknown account: ${id}`);

  const credential = await storeCredential({ accountId: id, kind: input.secretKind || "password", secret: input.secret });
  runtime.accounts = runtime.accounts.map((item) =>
    item.id === id
      ? {
          ...item,
          credentialRef: credential.credentialRef,
          credentialStatus: credential.credentialStatus,
        }
      : item,
  );
  return writeRuntime(runtime);
}

export async function deleteAccount(input) {
  const runtime = await readRuntime();
  const id = normalizeId(input.id || input.accountId || input.account_id);
  const account = runtime.accounts.find((item) => item.id === id);
  runtime.accounts = runtime.accounts.filter((item) => item.id !== id);

  if (account?.credentialRef) {
    await deleteCredential({ credentialRef: account.credentialRef, accountId: account.id });
  }

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

async function probeCommand(command) {
  const probe = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    const child = spawn(probe, [command], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve(""));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve("");
        return;
      }
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      resolve(first || "");
    });
  });
}

async function hasSessionArtifacts(provider, sessionProfile) {
  const config = PROVIDER_CLI[provider];
  if (!config) return false;
  const profileDir = path.join(DATA_DIR, config.configSubdir.replace("/", path.sep), sanitizeSegment(sessionProfile));
  try {
    const entries = await readdir(profileDir);
    return entries.some((entry) => !entry.startsWith("."));
  } catch {
    return false;
  }
}

function sanitizeSegment(value) {
  return String(value || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

export async function detectAccountSession(account) {
  const provider = normalizeId(account.provider || "");
  const config = PROVIDER_CLI[provider];
  if (!config) {
    return { sessionStatus: "needs-login", reason: "지원하지 않는 도구입니다." };
  }
  const cliPath = process.env[config.envOverride] || (await probeCommand(config.command));
  if (!cliPath) {
    return { sessionStatus: "needs-login", reason: `${config.command} CLI 가 PATH 에서 발견되지 않습니다. 설치 후 다시 감지하세요.` };
  }
  if (account.credentialStatus === "stored") {
    return { sessionStatus: "ready", reason: "저장된 자격증명을 사용합니다." };
  }
  const sessionProfile = account.sessionProfile || sessionProfileFor(provider, account.email, account.loginLabel);
  if (await hasSessionArtifacts(provider, sessionProfile)) {
    return { sessionStatus: "ready", reason: "세션 프로필 디렉터리에서 기존 인증 흔적을 찾았습니다." };
  }
  return { sessionStatus: "needs-login", reason: "세션 프로필이 비어 있습니다. 해당 도구에서 한 번 로그인하면 자동으로 준비 상태로 바뀝니다." };
}

export async function detectAndUpdateAccount(accountId) {
  const runtime = await readRuntime();
  const id = normalizeId(accountId);
  const account = runtime.accounts.find((item) => item.id === id);
  if (!account) return runtime;
  const detection = await detectAccountSession(account);
  runtime.accounts = runtime.accounts.map((item) =>
    item.id === id
      ? {
          ...item,
          sessionStatus: detection.sessionStatus,
          lastVerifiedAt: detection.sessionStatus === "ready" ? nowIso() : item.lastVerifiedAt || "",
          sessionDetectionReason: detection.reason,
        }
      : item,
  );
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
  const modelOverride = String(request.modelOverride || request.model_override || "auto");
  const enabledAccounts = accounts
    .filter((account) => account.enabled !== false)
    .filter((account) => !preferredProvider || account.provider === preferredProvider);
  const providerAccounts = enabledAccounts.filter((account) => account.sessionStatus === "ready");

  if (enabledAccounts.length === 0) {
    return {
      status: "blocked",
      reason: "이 작업 도구에 사용할 수 있는 활성 계정이 없습니다.",
      complexity,
    };
  }

  if (providerAccounts.length === 0) {
    return {
      status: "blocked",
      reason: "준비된 세션이 없습니다. 로그인된 계정을 준비 상태로 먼저 바꿔 주세요.",
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
      reason: "이 작업과 난이도에 맞는 남은 사용량이 충분한 계정이 없습니다.",
      complexity,
    };
  }

  const selected = candidates[0];
  return {
    status: "recommended",
    accountId: selected.account.id,
    provider: selected.account.provider,
    loginLabel: selected.account.loginLabel,
    sessionProfile: selected.account.sessionProfile,
    authMethod: selected.account.authMethod,
    model: modelOverride !== "auto" ? modelOverride : selected.profile.model,
    reasoningEffort: selected.profile.reasoningEffort,
    estimatedUnits: Number(selected.profile.estimatedUnits || ESTIMATED_UNITS[complexity] || 8),
    complexity,
    reason:
      complexity === "routine"
        ? "단순 작업이므로 남은 사용량이 충분한 가장 효율적인 프로필을 선택했습니다."
        : "품질 우선 기준으로 남은 사용량이 충분한 가장 강한 프로필을 선택했습니다.",
  };
}

function dashboardRunState(run, status, reason) {
  const now = new Date().toISOString();
  const validationResult = run.validation?.status === "passed" ? "passed" : run.validation?.status === "failed" ? "failed" : run.validation?.status === "running" ? "partial" : "not_run";
  return {
    version: 1,
    run_id: run.id,
    worker_id: run.workerId,
    worker_kind: providerForWorker(run.workerId) || run.workerId,
    workspace: REPO_ROOT,
    task: {
      id: "dashboard-run",
      title: "대시보드 시작 요청",
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
      session_profile: run.routing?.sessionProfile || "",
      auth_method: run.routing?.authMethod || "",
      model_tier: run.routing?.model || "",
      reasoning_effort: run.routing?.reasoningEffort || "",
      estimated_units: run.routing?.estimatedUnits || 0,
      budget_status: run.routing?.status === "recommended" ? "reserved" : "blocked",
    },
    verification: {
      commands: run.validation?.command ? [run.validation.command] : [],
      result: validationResult,
      summary: run.validation?.summary || "",
      log_path: run.validation?.logPath || "",
    },
    adapter: {
      mode: run.adapter?.mode || "pending",
      status: run.adapter?.status || "pending",
      prompt_path: run.adapter?.promptPath || "",
      log_path: run.adapter?.logPath || "",
      session_dir: run.adapter?.sessionDir || "",
    },
    handoff: {
      summary:
        status === "running"
          ? `대시보드가 ${run.workerId} 작업을 ${run.routing?.accountId || "계정 없음"} / ${run.routing?.model || "모델 대기"} 조합으로 시작했습니다. 어댑터 ${run.adapter?.mode || "pending"} 상태는 ${run.adapter?.status || "pending"} 입니다. 프롬프트 본문은 data/dashboard-runtime.json 에만 저장됩니다.`
          : status === "queued"
            ? `준비된 계정이나 사용 가능한 예산 경로가 없어 ${run.workerId} 작업을 대기 상태로 기록했습니다. 프롬프트 본문은 data/dashboard-runtime.json 에만 저장됩니다.`
            : `대시보드가 ${run.workerId} 작업의 상태를 ${status} 로 기록했습니다. 프롬프트 본문은 data/dashboard-runtime.json 에만 저장됩니다.`,
      next_step:
        status === "running"
          ? "대시보드에서 실행 상태, 검증 결과, 어댑터 로그를 확인하세요. 인수인계가 필요하면 여기서 중지하면 됩니다."
          : status === "queued"
            ? "대시보드에서 계정을 하나 준비 상태로 바꾼 뒤 다시 시작하세요."
          : "로컬 실행 기록을 확인하고 NEXT_TASK.md 에서 이어가거나 새 작업을 시작하세요.",
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

- 생성 시각: ${state.timestamps.updated_at}
- 실행 상태 파일: ${relativePath(DASHBOARD_RUN_STATE)}
- 작업 도구: ${state.worker_id}
- 상태: ${state.status}
- 사유: ${state.reason}
- 계정: ${state.usage.account_id || "없음"}
- 모델: ${state.usage.model_tier || "없음"}
- 프롬프트 본문: data/dashboard-runtime.json 에만 저장
- 비밀 포함 여부: ${state.safety.contains_secrets}

## 요약

${state.handoff.summary}

## 다음 단계

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

function nowIso() {
  return new Date().toISOString();
}

function cappedEvents(events, nextEvent) {
  return [...(events || []), nextEvent].slice(-120);
}

async function mutateRuntimeRun(runId, mutator, options = {}) {
  const runtime = await readRuntime();
  let nextRun = null;
  const buildNext = (current) => {
    if (!nextRun) nextRun = mutator({ ...current });
    return nextRun;
  };

  if (runtime.activeRun?.id === runId) {
    const updated = buildNext(runtime.activeRun);
    runtime.activeRun = options.clearActive ? null : updated;
  }

  runtime.runHistory = runtime.runHistory.map((item) => (item.id === runId ? buildNext(item) : item));
  if (!nextRun) return runtime;

  if (options.handoffStatus || options.handoffReason) {
    nextRun.handoffPath = await writeDashboardRunHandoff(
      nextRun,
      options.handoffStatus || nextRun.status || "running",
      options.handoffReason || "unknown",
    );
    if (runtime.activeRun?.id === runId) runtime.activeRun = nextRun;
    runtime.runHistory = runtime.runHistory.map((item) => (item.id === runId ? nextRun : item));
  }

  return writeRuntime(runtime);
}

export async function updateAccountSession(accountId, sessionStatus) {
  const runtime = await readRuntime();
  const id = normalizeId(accountId);
  runtime.accounts = runtime.accounts.map((account) =>
    account.id === id
      ? {
          ...account,
          sessionStatus: normalizeSessionStatus(sessionStatus),
          lastVerifiedAt: sessionStatus === "ready" ? nowIso() : "",
        }
      : account,
  );
  return writeRuntime(runtime);
}

export async function reserveAccountBudget(accountId, estimatedUnits) {
  if (!accountId || !estimatedUnits) return readRuntime();
  const runtime = await readRuntime();
  const id = normalizeId(accountId);
  runtime.accounts = runtime.accounts.map((account) =>
    account.id === id
      ? {
          ...account,
          remainingUnits: Math.max(0, Number(account.remainingUnits || 0) - Number(estimatedUnits || 0)),
        }
      : account,
  );
  return writeRuntime(runtime);
}

export async function appendRunEvent(runId, event, handoff = null) {
  const nextEvent = {
    at: event.at || nowIso(),
    level: event.level || "info",
    message: String(event.message || "").trim(),
  };
  return mutateRuntimeRun(
    runId,
    (run) => ({ ...run, events: cappedEvents(run.events, nextEvent) }),
    handoff || {},
  );
}

export async function patchRunRecord(runId, patch, handoff = null) {
  return mutateRuntimeRun(
    runId,
    (run) => ({
      ...run,
      ...patch,
      adapter: patch.adapter ? { ...(run.adapter || {}), ...patch.adapter } : run.adapter,
      validation: patch.validation ? { ...(run.validation || {}), ...patch.validation } : run.validation,
    }),
    handoff || {},
  );
}

export async function finishRunRecord(runId, patch, handoff = null) {
  const finishedAt = nowIso();
  return mutateRuntimeRun(
    runId,
    (run) => ({
      ...run,
      ...patch,
      stoppedAt: patch.stoppedAt || patch.completedAt || finishedAt,
      adapter: patch.adapter ? { ...(run.adapter || {}), ...patch.adapter } : run.adapter,
      validation: patch.validation ? { ...(run.validation || {}), ...patch.validation } : run.validation,
    }),
    {
      clearActive: true,
      ...(handoff || {}),
    },
  );
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
    modelOverride: String(input.modelOverride || "auto"),
    startedAt: new Date().toISOString(),
    routing,
    validation: {
      status: "not_run",
      command: "pnpm validate",
      summary: "사전 검증 대기 중",
    },
    adapter: {
      status: routing.status === "blocked" ? "blocked" : "queued",
      mode: "pending",
      sessionProfile: routing.sessionProfile || "",
    },
    events: [
      { at: new Date().toISOString(), level: "info", message: "대시보드에서 작업 요청을 등록했습니다." },
      {
        at: new Date().toISOString(),
        level: routing.status === "blocked" ? "warn" : "info",
        message:
          routing.status === "blocked"
            ? routing.reason
            : `선택 계정 ${routing.accountId} / 모델 ${routing.model} / 추론 ${routing.reasoningEffort}`,
      },
      { at: new Date().toISOString(), level: "info", message: "작업 실행 어댑터를 준비하는 중입니다." },
    ],
  };
  run.handoffPath = await writeDashboardRunHandoff(
    run,
    run.status,
    routing.status === "blocked" ? "missing_credentials" : "in_progress",
  );

  runtime.activeRun = run.status === "running" ? run : null;
  runtime.runHistory = [run, ...runtime.runHistory.filter((item) => item.id !== id)].slice(0, 20);
  const saved = await writeRuntime(runtime);

  if (run.status !== "running") {
    return saved;
  }

  const { launchDashboardWorker } = await import("./worker-launch-adapter.mjs");
  await launchDashboardWorker(run);
  return readRuntime();
}

export async function stopRun() {
  const runtime = await readRuntime();
  if (!runtime.activeRun) return runtime;
  try {
    const { stopDashboardWorker } = await import("./worker-launch-adapter.mjs");
    await stopDashboardWorker(runtime.activeRun);
  } catch {
    // If the adapter is unavailable we still record a local stop.
  }
  const stopped = {
    ...runtime.activeRun,
    status: "stopped",
    stoppedAt: new Date().toISOString(),
    adapter: {
      ...(runtime.activeRun.adapter || {}),
      status: "stopped",
    },
    events: [
      ...(runtime.activeRun.events || []),
      { at: new Date().toISOString(), level: "warn", message: "대시보드에서 실행을 중지했습니다." },
    ],
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
