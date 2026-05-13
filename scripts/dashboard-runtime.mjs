#!/usr/bin/env node

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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
  pendingRuns: [],
  settings: {
    idleWarnMs: 90 * 1000,
    idleKillMs: 30 * 60 * 1000,
    autoChainEnabled: true,
    autoChainMaxDepth: 30,
    quotaRetryEnabled: true,
    quotaRetryMaxAttempts: 3,
  },
};

function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const idleWarnMs = Number.isFinite(Number(source.idleWarnMs)) ? Math.max(0, Number(source.idleWarnMs)) : 90 * 1000;
  const idleKillMs = Number.isFinite(Number(source.idleKillMs)) ? Math.max(0, Number(source.idleKillMs)) : 30 * 60 * 1000;
  const autoChainEnabled = source.autoChainEnabled === undefined ? true : Boolean(source.autoChainEnabled);
  const autoChainMaxDepth = Number.isFinite(Number(source.autoChainMaxDepth))
    ? Math.max(1, Math.min(500, Number(source.autoChainMaxDepth)))
    : 30;
  const quotaRetryEnabled = source.quotaRetryEnabled === undefined ? true : Boolean(source.quotaRetryEnabled);
  const quotaRetryMaxAttempts = Number.isFinite(Number(source.quotaRetryMaxAttempts))
    ? Math.max(0, Math.min(10, Number(source.quotaRetryMaxAttempts)))
    : 3;
  return { idleWarnMs, idleKillMs, autoChainEnabled, autoChainMaxDepth, quotaRetryEnabled, quotaRetryMaxAttempts };
}

export async function getRuntimeSettings() {
  const runtime = await readRuntime();
  return normalizeSettings(runtime.settings);
}

export async function updateRuntimeSettings(input) {
  const runtime = await readRuntime();
  runtime.settings = normalizeSettings({
    ...(runtime.settings || {}),
    ...(input || {}),
  });
  return writeRuntime(runtime);
}

const USAGE_ALERT_THRESHOLDS = {
  critical: 0.1,
  warning: 0.3,
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
  claude: {
    command: "claude",
    envOverride: "AGENTAPP_CLAUDE_COMMAND",
    configEnv: "CLAUDE_CONFIG_DIR",
    configSubdir: "session-profiles/claude-code",
    authFiles: [".credentials.json"],
  },
  codex: {
    command: "codex",
    envOverride: "AGENTAPP_CODEX_COMMAND",
    configEnv: "CODEX_HOME",
    configSubdir: "session-profiles/codex",
    authFiles: ["auth.json"],
  },
  cursor: {
    command: "cursor",
    envOverride: "AGENTAPP_CURSOR_COMMAND",
    configEnv: "",
    configSubdir: "session-profiles/cursor",
    authFiles: ["Network/Cookies", "Cookies"],
  },
  gemini: {
    command: "gemini",
    envOverride: "AGENTAPP_GEMINI_COMMAND",
    configEnv: "GEMINI_CONFIG_DIR",
    configSubdir: "session-profiles/gemini-cli",
    authFiles: ["oauth_creds.json", "google_account_id"],
  },
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

// model 이름으로부터 어느 provider 에 속하는지 추정. 잘못된 모델/provider
// 조합 (예: claude 계정에 gpt 모델 지정) 을 자동 차단하기 위한 검증용.
function providerForModel(model) {
  if (!model) return "";
  const key = String(model).toLowerCase();
  if (/^(opus|sonnet|haiku|claude)/i.test(key)) return "claude";
  if (/^(gpt|o\d|codex)/i.test(key)) return "codex";
  if (/^gemini/i.test(key)) return "gemini";
  return "";
}

// provider 코드를 워커 식별자로 환산. 'auto' 선택 시 routing 이 고른
// 계정의 provider 를 실제 spawn 대상 workerId 로 매핑하기 위해 사용.
function workerForProvider(provider) {
  switch (provider) {
    case "claude": return "claude-code";
    case "codex": return "codex";
    case "gemini": return "gemini-cli";
    case "cursor": return "cursor";
    default: return "";
  }
}

export { providerForWorker, workerForProvider, providerForModel };

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

  // Quota lockout — provider 가 "use limit / quota / rate limit" 류 오류에서
  // 알려준 리셋 시간이 미래면 그 시각까지 remainingUnits 를 0 으로 잠금,
  // 시간이 지났으면 weekly 한도로 자동 복구.
  const quotaResetRaw = String(input.quotaResetAt || input.quota_reset_at || "").trim();
  const quotaResetMs = quotaResetRaw ? Date.parse(quotaResetRaw) : NaN;
  const quotaActive = Number.isFinite(quotaResetMs) && quotaResetMs > Date.now();
  const quotaResetAt = quotaActive ? new Date(quotaResetMs).toISOString() : "";

  let effectiveRemaining = Math.max(0, remainingUnits);
  if (quotaActive) {
    effectiveRemaining = 0;
  } else if (quotaResetRaw && !quotaActive) {
    // Reset window has passed. Stored runtime objects still carry the old
    // remainingUnits: 0 from the lockout, so restore the local budget here.
    effectiveRemaining = weeklyUnits;
  }

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
    remainingUnits: effectiveRemaining,
    weeklyUnits: Math.max(1, weeklyUnits),
    resetDay: String(input.resetDay || input.reset_day || "monday").trim().toLowerCase(),
    source: "local",
    modelProfiles: input.modelProfiles || input.model_profiles || defaultProfiles(provider),
    sessionDetectionReason: input.sessionDetectionReason || input.session_detection_reason || "",
    actualAuthEmail: String(input.actualAuthEmail || input.actual_auth_email || "").trim().toLowerCase(),
    lastUsedAt: input.lastUsedAt || input.last_used_at || "",
    quotaResetAt,
    quotaReason: quotaActive ? String(input.quotaReason || input.quota_reason || "사용량 한도").trim() : "",
    usageAlert: usageAlertLevel({
      remainingUnits: effectiveRemaining,
      weeklyUnits: Math.max(1, weeklyUnits),
    }),
  };
}

export function usageAlertLevel(account) {
  const weekly = Number(account.weeklyUnits || account.weekly_units || 0);
  const remaining = Number(account.remainingUnits || account.remaining_units || 0);
  if (weekly <= 0) return "ok";
  const ratio = remaining / weekly;
  if (ratio <= USAGE_ALERT_THRESHOLDS.critical) return "critical";
  if (ratio <= USAGE_ALERT_THRESHOLDS.warning) return "warning";
  return "ok";
}

function readyQuotaPatch(account) {
  return activeQuotaLock(account) ? {} : { quotaResetAt: "", quotaReason: "" };
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
    lastModel: String(input.lastModel || input.last_model || "").trim(),
    lastWorker: String(input.lastWorker || input.last_worker || "").trim(),
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
    pendingRuns: Array.isArray(runtime.pendingRuns) ? runtime.pendingRuns.slice(0, 20) : [],
    settings: normalizeSettings(runtime.settings),
  };
}

const MAX_INLINE_MESSAGE_BYTES = 8 * 1024;

async function readInlineText(relativeOrAbsolutePath) {
  if (!relativeOrAbsolutePath) return "";
  try {
    const fullPath = path.isAbsolute(relativeOrAbsolutePath)
      ? relativeOrAbsolutePath
      : path.join(REPO_ROOT, relativeOrAbsolutePath);
    const raw = await readFile(fullPath, "utf8");
    if (raw.length <= MAX_INLINE_MESSAGE_BYTES) return raw;
    return `${raw.slice(-MAX_INLINE_MESSAGE_BYTES)}\n…(앞부분 생략)`;
  } catch {
    return "";
  }
}

async function enrichRunRecord(run) {
  if (!run || !run.adapter) return run;
  const lastMessageText = await readInlineText(run.adapter.lastMessagePath);
  const launchLogTail = await readInlineText(run.adapter.logPath);
  return {
    ...run,
    adapter: {
      ...run.adapter,
      lastMessageText: lastMessageText.trim(),
      launchLogTail: launchLogTail.trim(),
    },
  };
}

async function enrichRuntime(runtime) {
  const next = { ...runtime };
  if (runtime.activeRun) {
    next.activeRun = await enrichRunRecord(runtime.activeRun);
  }
  if (Array.isArray(runtime.runHistory) && runtime.runHistory.length > 0) {
    const recent = runtime.runHistory.slice(0, 5);
    const rest = runtime.runHistory.slice(5);
    const enriched = await Promise.all(recent.map(enrichRunRecord));
    next.runHistory = [...enriched, ...rest];
  }
  return next;
}

export async function readRuntime() {
  let raw;
  try {
    raw = await readFile(RUNTIME_FILE, "utf8");
  } catch {
    // primary missing; try backup
    try {
      raw = await readFile(`${RUNTIME_FILE}.bak`, "utf8");
      process.stderr.write(`[runtime] primary file missing, restored from backup.\n`);
    } catch {
      return clone(DEFAULT_RUNTIME);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`[runtime] JSON parse failed: ${error instanceof Error ? error.message : String(error)}\n`);
    // try backup before giving up
    try {
      const backup = await readFile(`${RUNTIME_FILE}.bak`, "utf8");
      parsed = JSON.parse(backup);
      process.stderr.write(`[runtime] using backup after parse failure.\n`);
    } catch {
      return clone(DEFAULT_RUNTIME);
    }
  }

  let normalized;
  try {
    normalized = normalizeRuntime(parsed);
  } catch (error) {
    process.stderr.write(`[runtime] normalize failed: ${error instanceof Error ? error.message : String(error)}\n`);
    normalized = {
      version: 1,
      accounts: Array.isArray(parsed?.accounts) ? parsed.accounts : [],
      projects: Array.isArray(parsed?.projects) ? parsed.projects : [],
      activeRun: parsed?.activeRun || null,
      runHistory: Array.isArray(parsed?.runHistory) ? parsed.runHistory : [],
      pendingRuns: Array.isArray(parsed?.pendingRuns) ? parsed.pendingRuns : [],
    };
  }

  try {
    return await enrichRuntime(normalized);
  } catch (error) {
    process.stderr.write(`[runtime] enrich failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return normalized;
  }
}

async function readDiskRuntimeRaw() {
  try {
    const raw = await readFile(RUNTIME_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeRuntime(runtime) {
  const normalized = normalizeRuntime(runtime);

  // Safety net: never blow away the persisted accounts list. If somewhere
  // upstream produced a payload with 0 accounts (transient bug, partial
  // mutation, etc.) while the disk has 1+, restore from disk and log so
  // the issue is visible without losing user data.
  const onDisk = await readDiskRuntimeRaw();
  if (
    onDisk
    && Array.isArray(onDisk.accounts)
    && onDisk.accounts.length > 0
    && normalized.accounts.length === 0
  ) {
    process.stderr.write(
      `[runtime] writeRuntime would have wiped ${onDisk.accounts.length} accounts; restoring from disk.\n`,
    );
    normalized.accounts = onDisk.accounts.map(normalizeAccount);
  }

  await mkdir(DATA_DIR, { recursive: true });

  // Best-effort backup of the prior file so we can recover if something
  // does corrupt the live file mid-write.
  if (onDisk) {
    try {
      await writeFile(`${RUNTIME_FILE}.bak`, `${JSON.stringify(onDisk, null, 2)}\n`, "utf8");
    } catch {
      // backup is opportunistic; never block real writes on it
    }
  }

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
  account.actualAuthEmail = detection.actualEmail || "";
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

export async function setAccountBudget(input) {
  const runtime = await readRuntime();
  const id = normalizeId(input.id);
  const remaining = Number(input.remainingUnits ?? input.remaining_units);
  const weekly = Number(input.weeklyUnits ?? input.weekly_units);
  runtime.accounts = runtime.accounts.map((account) => {
    if (account.id !== id) return account;
    const nextWeekly = Number.isFinite(weekly) && weekly > 0 ? weekly : account.weeklyUnits;
    const nextRemaining = Number.isFinite(remaining) && remaining >= 0 ? Math.min(remaining, nextWeekly) : account.remainingUnits;
    return { ...account, weeklyUnits: nextWeekly, remainingUnits: nextRemaining };
  });
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

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(parts[1].length + ((4 - (parts[1].length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function readActualIdentity(provider, sessionProfile) {
  const config = PROVIDER_CLI[provider];
  if (!config) return "";
  const { sharedSessionProfilesRoot } = await import("./worker-launch-adapter.mjs");
  const subdir = config.configSubdir.replace(/^session-profiles\//, "");
  const profileDir = path.join(sharedSessionProfilesRoot(), subdir, sanitizeSegment(sessionProfile));

  if (provider === "claude") {
    try {
      const raw = await readFile(path.join(profileDir, ".claude.json"), "utf8");
      const parsed = JSON.parse(raw);
      return String(parsed?.oauthAccount?.emailAddress || "").trim().toLowerCase();
    } catch {
      return "";
    }
  }

  if (provider === "codex") {
    try {
      const raw = await readFile(path.join(profileDir, "auth.json"), "utf8");
      const parsed = JSON.parse(raw);
      const idToken = parsed?.tokens?.id_token;
      const payload = decodeJwtPayload(idToken);
      return String(payload?.email || "").trim().toLowerCase();
    } catch {
      return "";
    }
  }

  if (provider === "gemini") {
    for (const candidate of ["google_account_id", "oauth_creds.json"]) {
      try {
        const raw = await readFile(path.join(profileDir, candidate), "utf8");
        if (candidate === "oauth_creds.json") {
          const parsed = JSON.parse(raw);
          const email = parsed?.email || parsed?.account?.email || parsed?.client_email;
          if (email) return String(email).trim().toLowerCase();
        } else if (raw.includes("@")) {
          return raw.trim().toLowerCase();
        }
      } catch {
        // try next
      }
    }
    return "";
  }

  return "";
}

async function hasSessionArtifacts(provider, sessionProfile) {
  const config = PROVIDER_CLI[provider];
  if (!config) return false;
  // Touch buildSessionProfileDir indirectly so legacy data is migrated on the first detect call.
  const { sharedSessionProfilesRoot, resolveLoginAdapter } = await import("./worker-launch-adapter.mjs");
  try {
    await resolveLoginAdapter(provider, sessionProfile);
  } catch {
    // resolveLoginAdapter has side-effects only; failures here are fine.
  }
  const subdir = config.configSubdir.replace(/^session-profiles\//, "");
  const profileDir = path.join(sharedSessionProfilesRoot(), subdir, sanitizeSegment(sessionProfile));

  // Strict check: provider must have one of its known auth marker files
  // present with non-zero size. Codex/Claude/Gemini auto-create logs and
  // sqlite files on first invocation even without a successful login, so
  // a generic "non-dot file exists" probe would falsely report ready.
  const authFiles = config.authFiles || [];
  if (authFiles.length === 0) {
    try {
      const entries = await readdir(profileDir);
      return entries.some((entry) => !entry.startsWith("."));
    } catch {
      return false;
    }
  }

  for (const marker of authFiles) {
    try {
      const stats = await stat(path.join(profileDir, marker));
      if (stats.isFile() && stats.size > 0) return true;
    } catch {
      // file missing; try next marker
    }
  }
  return false;
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
    const expectedEmail = String(account.email || "").trim().toLowerCase();
    const actualEmail = await readActualIdentity(provider, sessionProfile);
    if (expectedEmail && actualEmail && expectedEmail !== actualEmail) {
      return {
        sessionStatus: "needs-login",
        actualEmail,
        reason:
          `이 계정에 저장된 토큰은 실제로 '${actualEmail}' 으로 인증돼 있습니다. 설정한 '${expectedEmail}' 과 다릅니다. 격리 창에서 다시 로그인할 때 반드시 ${expectedEmail} 계정을 선택하세요.`,
      };
    }
    return {
      sessionStatus: "ready",
      actualEmail,
      reason: actualEmail
        ? `세션 프로필에 ${actualEmail} 계정의 유효한 토큰이 있습니다.`
        : "세션 프로필에 유효한 인증 토큰이 있습니다.",
    };
  }
  const expected = (PROVIDER_CLI[provider]?.authFiles || []).join(", ");
  const hint = expected
    ? `이 계정의 세션 폴더에 ${expected} 가 없습니다. '로그인' 버튼으로 격리 브라우저에서 OAuth 를 완료하세요.`
    : "세션 프로필이 비어 있습니다. '로그인' 버튼으로 격리 브라우저에서 인증을 완료하세요.";
  return { sessionStatus: "needs-login", reason: hint };
}

export async function runAccountLogin(accountId) {
  const runtime = await readRuntime();
  const id = normalizeId(accountId);
  const account = runtime.accounts.find((item) => item.id === id);
  if (!account) return runtime;

  const { resolveLoginAdapter, launchLoginProcess } = await import("./worker-launch-adapter.mjs");
  const adapter = await resolveLoginAdapter(account.provider, account.sessionProfile);
  if (adapter.status !== "ready") {
    runtime.accounts = runtime.accounts.map((item) =>
      item.id === id ? { ...item, sessionDetectionReason: adapter.reason || "로그인 명령을 준비할 수 없습니다." } : item,
    );
    return writeRuntime(runtime);
  }

  let autofillEmail = "";
  let autofillPassword = "";
  if (account.email) autofillEmail = account.email;
  try {
    const vault = await import("./credential-vault.mjs");
    if (typeof vault.revealCredential === "function") {
      const revealed = await vault.revealCredential(account.id, "password");
      if (revealed && revealed.secret) autofillPassword = revealed.secret;
    }
  } catch {
    // vault optional; autofill stays partial
  }

  const launched = await launchLoginProcess(adapter, {
    partitionKey: account.sessionProfile || `${account.provider}-${account.id}`,
    windowTitle: `AgentApp 로그인 · ${account.displayName || account.email || account.id}`,
    autofill: { email: autofillEmail, password: autofillPassword },
  });

  const isolatedNotice = launched.isolated
    ? "격리 브라우저 창에서 인증을 진행하세요. 처음에는 ID/PW 입력이 필요할 수 있고, 다음부터는 한 번 클릭으로 끝납니다. 인증 완료 후 '재감지'를 눌러 주세요."
    : launched.browserOpened
      ? "인증 페이지를 브라우저로 열었습니다. 인증 완료 후 '재감지'를 눌러 주세요."
      : "로그인 프로세스를 백그라운드에서 시작했습니다. 브라우저가 자동으로 열리지 않으면 해당 CLI에서 수동 로그인 후 '재감지'를 눌러 주세요.";

  runtime.accounts = runtime.accounts.map((item) =>
    item.id === id
      ? {
          ...item,
          sessionStatus: "paused",
          sessionDetectionReason: launched.error
            ? `로그인 실행 실패: ${launched.error}`
            : isolatedNotice,
          loginProcessPid: launched.pid || 0,
          loginUrlOpenedAt: launched.browserOpened ? nowIso() : item.loginUrlOpenedAt || "",
          loginIsolated: Boolean(launched.isolated),
        }
      : item,
  );
  return writeRuntime(runtime);
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
          actualAuthEmail: detection.actualEmail || "",
          ...(detection.sessionStatus === "ready" ? readyQuotaPatch(item) : {}),
        }
      : item,
  );
  const saved = await writeRuntime(runtime);
  if (detection.sessionStatus === "ready") {
    const dispatched = await dispatchPendingForAccount(id);
    if (dispatched.dispatched > 0) return dispatched.runtime;
  }
  return saved;
}

export async function setAccountSession(input) {
  const runtime = await readRuntime();
  const id = normalizeId(input.id);
  const sessionStatus = normalizeSessionStatus(input.sessionStatus || input.session_status);
  const lastVerifiedAt = sessionStatus === "ready" ? new Date().toISOString() : "";
  const exists = runtime.accounts.some((account) => account.id === id);
  const nextAccount = normalizeAccount({ ...input, id, sessionStatus, lastVerifiedAt });

  runtime.accounts = exists
    ? runtime.accounts.map((account) =>
        account.id === id
          ? {
              ...account,
              sessionStatus,
              lastVerifiedAt,
              ...(sessionStatus === "ready" ? readyQuotaPatch(account) : {}),
            }
          : account,
      )
    : uniqueById([...runtime.accounts, nextAccount]);

  const saved = await writeRuntime(runtime);
  if (sessionStatus === "ready") {
    const dispatched = await dispatchPendingForAccount(id);
    if (dispatched.dispatched > 0) return dispatched.runtime;
  }
  return saved;
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

// ---------------------------------------------------------------------------
// Per-project meta snapshot — reads handoff/plan/workers from the selected
// project directory so dashboard panels reflect that project, not AgentApp.
// ---------------------------------------------------------------------------

const META_EXCERPT_LIMIT = 1600;

async function safeReadText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function collectMarkdownFiles(rootPath, candidates) {
  const docs = [];
  for (const relPath of candidates) {
    const full = path.join(rootPath, relPath);
    try {
      const stats = await stat(full);
      if (stats.isDirectory()) {
        const entries = await readdir(full);
        for (const entry of entries) {
          if (!entry.toLowerCase().endsWith(".md")) continue;
          const file = path.join(full, entry);
          const text = await safeReadText(file);
          if (!text) continue;
          docs.push({
            id: entry.toLowerCase().replace(/\.md$/, ""),
            title: entry,
            path: path.relative(rootPath, file).replaceAll("\\", "/"),
            excerpt: text.length > META_EXCERPT_LIMIT ? `${text.slice(0, META_EXCERPT_LIMIT)}…` : text,
          });
        }
      } else if (stats.isFile() && full.toLowerCase().endsWith(".md")) {
        const text = await safeReadText(full);
        if (text) {
          docs.push({
            id: path.basename(full, ".md").toLowerCase(),
            title: path.basename(full),
            path: path.relative(rootPath, full).replaceAll("\\", "/"),
            excerpt: text.length > META_EXCERPT_LIMIT ? `${text.slice(0, META_EXCERPT_LIMIT)}…` : text,
          });
        }
      }
    } catch {
      // skip missing
    }
  }
  return docs;
}

async function readHandoffDocs(rootPath) {
  // 우선순위: AgentApp 표준 handoff 디렉터리 → 없으면 .claude-sync/memory.
  const primary = await collectMarkdownFiles(rootPath, [
    path.join("tools", "agent-orchestrator", "handoff"),
  ]);
  if (primary.length > 0) return primary;
  // fallback: 일반 프로젝트도 보통 memory/plans 에 핸드오프 격 문서가 있음.
  return collectMarkdownFiles(rootPath, [
    path.join(".claude-sync", "memory"),
    "AGENTS.md",
    "CLAUDE.md",
    "README.md",
  ]);
}

async function readPlanPhases(rootPath) {
  // plans 디렉터리 안 모든 .md 를 합쳐 phase 추출. AgentApp 의
  // agent-orchestrator-roadmap.md 단일 파일 가정에서 일반 프로젝트의 임의
  // 파일명까지 지원.
  const plansDir = path.join(rootPath, ".claude-sync", "plans");
  const phases = [];
  let planFiles = [];
  try {
    planFiles = await readdir(plansDir);
  } catch {
    return [];
  }
  for (const entry of planFiles) {
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const text = await safeReadText(path.join(plansDir, entry));
    if (!text) continue;
    let currentTitle = "";
    let currentItems = [];
    const fileBase = entry.replace(/\.md$/i, "");
    const flush = () => {
      if (!currentTitle && currentItems.length === 0) return;
      const done = currentItems.filter((item) => item.done).length;
      phases.push({
        title: currentTitle || fileBase,
        total: currentItems.length,
        done,
        items: currentItems,
        file: entry,
      });
      currentTitle = "";
      currentItems = [];
    };
    for (const rawLine of text.split(/\r?\n/)) {
      const headerMatch = rawLine.match(/^##\s+(.+?)\s*$/);
      if (headerMatch) {
        flush();
        currentTitle = headerMatch[1].trim();
        continue;
      }
      const taskMatch = rawLine.match(/^\s*-\s*\[(.)\]\s+(.+?)\s*$/);
      if (taskMatch) {
        currentItems.push({ done: taskMatch[1].trim() !== "", title: taskMatch[2].trim() });
      }
    }
    flush();
  }
  return phases;
}

async function readWorkersList(rootPath) {
  const candidate = path.join(rootPath, "tools", "agent-orchestrator", "workers.example.yaml");
  const text = await safeReadText(candidate);
  if (!text) return [];
  const workers = [];
  for (const block of text.split(/^\s*-\s+id:\s*/m)) {
    const idMatch = block.match(/^([\w-]+)/);
    if (!idMatch) continue;
    const kindMatch = block.match(/^\s+kind:\s*"?([\w-]+)/m);
    workers.push({
      id: idMatch[1].trim(),
      display_name: idMatch[1].trim(),
      kind: kindMatch ? kindMatch[1].trim() : "unknown",
      latest_status: "available",
    });
  }
  return workers;
}

async function readNextTaskTitle(rootPath) {
  const file = path.join(rootPath, "tools", "agent-orchestrator", "handoff", "NEXT_TASK.md");
  const text = await safeReadText(file);
  const match = text.match(/^-\s*Selected task:\s*(.+?)\s*$/m);
  return match ? match[1].trim() : "";
}

async function computeProgressFromPhases(phases) {
  const total = phases.reduce((sum, phase) => sum + phase.total, 0);
  const done = phases.reduce((sum, phase) => sum + phase.done, 0);
  return {
    total,
    done,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    phases,
  };
}

export async function readProjectMeta(input) {
  const rootPath = String(input?.path || "").trim();
  if (!rootPath) return { ok: false, reason: "missing_path" };
  let exists = false;
  try {
    const info = await stat(rootPath);
    exists = info.isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) return { ok: false, reason: "path_not_found", path: rootPath };

  const [handoffDocs, phases, workers, nextTaskTitle] = await Promise.all([
    readHandoffDocs(rootPath),
    readPlanPhases(rootPath),
    readWorkersList(rootPath),
    readNextTaskTitle(rootPath),
  ]);

  const progress = await computeProgressFromPhases(phases);
  const hasAny = handoffDocs.length > 0 || phases.length > 0 || workers.length > 0;

  return {
    ok: true,
    has_metadata: hasAny,
    generated_at: new Date().toISOString(),
    path: rootPath,
    progress,
    handoff_documents: handoffDocs,
    workers,
    next_task: nextTaskTitle ? { title: nextTaskTitle } : null,
  };
}

export async function deleteProject(input) {
  const runtime = await readRuntime();
  const id = normalizeId(input.id || input.projectId || input.project_id);
  runtime.projects = runtime.projects.filter((project) => project.id !== id);
  return writeRuntime(runtime);
}

function routeScore(candidate, complexity) {
  const profile = candidate.profile;
  const account = candidate.account;
  const modelRank = MODEL_RANK[profile.model] || 1;
  const lastUsed = account.lastUsedAt ? Date.parse(account.lastUsedAt) : 0;
  // 24 시간 윈도에서 균등 분배 가중 (오래 안 쓴 계정 우선).
  const idleHours = lastUsed > 0 ? Math.max(0, (Date.now() - lastUsed) / 3600000) : 48;
  const loadBalance = Math.min(idleHours, 24) / 24; // 0..1, 24h+ 이면 만점

  // 로컬 remainingUnits 는 실제 provider 한도와 무관하므로 점수에서 제외.
  // 균등 분배 (오래 안 쓴 계정 우선) + 모델 품질만 사용.
  if (complexity === "routine") {
    return loadBalance * 40 - modelRank;
  }
  if (complexity === "standard") {
    return loadBalance * 30 + modelRank * 8;
  }
  return loadBalance * 20 + modelRank * 20;
}

function hasAuthIdentityMismatch(account) {
  const expected = String(account.email || "").trim().toLowerCase();
  const actual = String(account.actualAuthEmail || "").trim().toLowerCase();
  return Boolean(expected && actual && expected !== actual);
}

function activeQuotaLock(account) {
  if (!account.quotaResetAt) return false;
  const resetMs = Date.parse(account.quotaResetAt);
  return Number.isFinite(resetMs) && resetMs > Date.now();
}

function routeReadyAccount(account) {
  if (account.sessionStatus !== "ready") return false;
  if (hasAuthIdentityMismatch(account)) return false;
  if (activeQuotaLock(account)) return false;
  return true;
}

export function selectRoute(accounts, request) {
  const complexity = request.complexity || "standard";
  const preferredProvider = providerForWorker(request.workerId);
  const modelOverride = String(request.modelOverride || request.model_override || "auto");
  const enabledAccounts = accounts
    .filter((account) => account.enabled !== false)
    .filter((account) => !preferredProvider || account.provider === preferredProvider);
  const readyAccounts = enabledAccounts.filter((account) => account.sessionStatus === "ready");
  const providerAccounts = readyAccounts.filter(routeReadyAccount);

  if (enabledAccounts.length === 0) {
    return {
      status: "blocked",
      reason: "이 작업 도구에 사용할 수 있는 활성 계정이 없습니다.",
      complexity,
    };
  }

  if (providerAccounts.length === 0) {
    const lockedCount = readyAccounts.filter(activeQuotaLock).length;
    const mismatchCount = readyAccounts.filter(hasAuthIdentityMismatch).length;
    if (readyAccounts.length > 0 && (lockedCount > 0 || mismatchCount > 0)) {
      const details = [
        lockedCount > 0 ? `한도 잠금 ${lockedCount}건` : "",
        mismatchCount > 0 ? `인증 계정 불일치 ${mismatchCount}건` : "",
      ].filter(Boolean).join(", ");
      return {
        status: "blocked",
        reason: `준비된 세션은 있지만 라우팅 후보에서 제외됐습니다 (${details}). 재감지하거나 계정 상태를 확인하세요.`,
        complexity,
      };
    }
    return {
      status: "blocked",
      reason: "준비된 세션이 없습니다. 로그인된 계정을 준비 상태로 먼저 바꿔 주세요.",
      complexity,
    };
  }

  // 로컬 remainingUnits 는 정보용 추정치일 뿐 실제 provider 한도와
  // 동기화되지 않는다. 진짜 한도는 quota_limited 에러로 감지되어
  // quotaResetAt 으로 마킹되며 위 필터에서 이미 제외된다. 그러므로
  // 여기서는 remainingUnits 로 후보를 거르지 않는다.
  const candidates = providerAccounts
    .map((account) => ({ account, profile: account.modelProfiles?.[complexity] }))
    .filter((candidate) => candidate.profile)
    .sort((left, right) => routeScore(right, complexity) - routeScore(left, complexity));

  if (candidates.length === 0) {
    return {
      status: "blocked",
      reason: "이 작업 난이도에 맞는 프로필 (model profile) 이 정의된 계정이 없습니다.",
      complexity,
    };
  }

  const selected = candidates[0];
  // modelOverride provider 검증 — claude 워커에 gpt 모델 같은 mismatch 차단.
  // 사용자가 호환되지 않는 조합을 고른 경우 override 를 무시하고 profile 의
  // provider 일치 모델로 폴백한다.
  const overrideProvider = modelOverride !== "auto" ? providerForModel(modelOverride) : "";
  const overrideCompatible =
    modelOverride === "auto" ||
    overrideProvider === "" ||
    overrideProvider === selected.account.provider;
  const resolvedModel = overrideCompatible && modelOverride !== "auto"
    ? modelOverride
    : selected.profile.model;
  const mismatchNote = !overrideCompatible
    ? ` (요청 모델 '${modelOverride}' 은 ${selected.account.provider} 계정과 호환되지 않아 ${resolvedModel} 으로 폴백)`
    : "";
  return {
    status: "recommended",
    accountId: selected.account.id,
    provider: selected.account.provider,
    loginLabel: selected.account.loginLabel,
    sessionProfile: selected.account.sessionProfile,
    authMethod: selected.account.authMethod,
    model: resolvedModel,
    reasoningEffort: selected.profile.reasoningEffort,
    estimatedUnits: Number(selected.profile.estimatedUnits || ESTIMATED_UNITS[complexity] || 8),
    complexity,
    reason:
      (complexity === "routine"
        ? "단순 작업이므로 남은 사용량이 충분한 가장 효율적인 프로필을 선택했습니다."
        : "품질 우선 기준으로 남은 사용량이 충분한 가장 강한 프로필을 선택했습니다.") + mismatchNote,
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
      account_id: publicAccountId(run.routing?.accountId || ""),
      login_label: publicAccountId(run.routing?.loginLabel || ""),
      session_profile: publicAccountId(run.routing?.sessionProfile || ""),
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
      session_dir: run.adapter?.sessionDir ? `data/session-profiles/${providerForWorker(run.workerId) || "agent"}/local-account` : "",
    },
    handoff: {
      summary:
        status === "running"
          ? `대시보드가 ${run.workerId} 작업을 ${publicAccountId(run.routing?.accountId || "") || "계정 없음"} / ${run.routing?.model || "모델 대기"} 조합으로 시작했습니다. 어댑터 ${run.adapter?.mode || "pending"} 상태는 ${run.adapter?.status || "pending"} 입니다. 프롬프트 본문은 data/dashboard-runtime.json 에만 저장됩니다.`
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

function publicAccountId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return "local-account";
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

// ---------------------------------------------------------------------------
// Quota lockout detection
// ---------------------------------------------------------------------------

// Provider 별 한도 메시지 포맷이 달라서 hint/reset 정규식을 provider key 로
// 묶어 관리한다. parseQuotaReset 는 provider hint 가 주어지면 해당 provider
// 의 패턴을 먼저 시도하고, hint 가 없거나 매칭 실패면 generic 패턴으로 폴백.
//
// 새 provider 메시지 포맷을 발견하면 PROVIDER_QUOTA_PATTERNS 에 추가만 하면
// 다른 provider 의 인식에는 영향이 없다.
const PROVIDER_QUOTA_PATTERNS = {
  // Claude Code (Anthropic CLI) 예시:
  //   "You've hit your limit · resets 6:30pm (Asia/Seoul)"
  //   "You've hit your limit · resets May 18, 6am (Asia/Seoul)"
  //   "Approaching weekly limit"
  //   "Usage limit reached, resets tomorrow 6pm (Asia/Seoul)"
  claude: {
    hint: /(you'?ve hit your (?:limit|weekly limit|daily limit|usage)|hit your (?:limit|weekly|daily)|usage limit (?:reached|hit)|weekly limit (?:reached|hit)|approaching (?:your )?(?:weekly|daily) limit|reset(?:s)?\s+(?:\d|[a-z]{3,9}\s+\d))/i,
    reset: [
      /\breset(?:s)?\s+([a-z]{3,9}\s+\d{1,2}(?:,?\s*20\d{2})?(?:,?\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?[^.\n)·•|]*?)(?=[.\n)·•|]|$)/i,
      /\breset(?:s)?\s+((?:today|tomorrow)?\s*[0-9][^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
      /\breset(?:s)?\s+(?:at|on|by)\s+([^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
    ],
  },
  // Codex (OpenAI CLI) 예시:
  //   "You've used 100% of your weekly limit. Resets in 2h 30m."
  //   "rate_limit_exceeded — try again in 45 seconds"
  //   "429 Too Many Requests; please retry after 60s"
  //   "You've reached your usage limit. Try again at 2026-05-14T10:00:00Z."
  codex: {
    hint: /(rate.?limit(?:_exceeded)?|429|too many requests|you'?ve (?:used|reached) .*limit|usage limit|out of (?:credit|quota)|insufficient_quota|quota.*exceeded|retry.after|resets? in)/i,
    reset: [
      // "Resets in 2h 30m", "try again in 45 seconds", "retry after 60s"
      /(?:resets?|try again|retry|wait)\s+(?:in|after)\s+([0-9][^.\n)·•|]*?)(?=[.\n)·•|]|$)/i,
      /retry.after[:\s]+([0-9]+\s*(?:s|sec|seconds|m|min|minutes|h|hr|hours)?)/i,
      // "try again at <time>"
      /(?:try again|retry|available)\s+(?:at|on|by)\s+([^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
      // ISO timestamp on the line
      /\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[Zz]|[+-]\d{2}:?\d{2})?)\b/,
    ],
  },
  // Gemini CLI / Google AI 예시:
  //   "RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Generate requests'"
  //   "retryDelay: '60s'"
  //   "Quota exceeded for ... Please retry after 30s."
  //   "You have exceeded your quota. Try again in 45 minutes."
  gemini: {
    hint: /(resource[_\s]exhausted|quota exceeded|exceeded your quota|429|rate.?limit|retry.?delay|please retry|quota metric)/i,
    reset: [
      // "retryDelay: '60s'" / "retry-delay: 60s"
      /retry.?delay[:\s'"]+([0-9]+\s*(?:s|sec|seconds|m|min|minutes|h|hr|hours)?)/i,
      // "retry after 30s" / "try again in 45 minutes"
      /(?:retry|try again|please retry|available)\s+(?:after|in)\s+([0-9][^.\n)·•|'"]*?)(?=[.\n)·•|'"]|$)/i,
      /(?:retry|try again|available)\s+(?:at|on|by)\s+([^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
    ],
  },
  // Cursor 예시:
  //   "You have used all your fast requests this month. Resets on 2026-06-01."
  //   "Free tier limit reached. Renews in 5 days."
  cursor: {
    hint: /(usage limit|rate.?limit|quota|too many requests|429|exceeded|monthly limit|used all|fast requests|premium requests|tier limit|renews?)/i,
    reset: [
      /\b(?:reset(?:s)?|renews?|available)\s+(?:on|at|in|by)\s+([^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
      /\breset(?:s)?\s+((?:today|tomorrow)?\s*[0-9][^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
    ],
  },
};

// 어떤 provider 인지 hint 가 없을 때 사용하는 폴백.
const QUOTA_HINT_RE = /(usage limit|rate limit|quota|out of credit|too many requests|429|exceeded|hit your (?:usage|limit|weekly|daily)|you'?ve hit|limit (?:reached|reset)|weekly limit|daily limit|resets?\s+(?:\d|[a-z]{3,9}\s+\d)|resource[_\s]exhausted|retry.?delay|resets? in)/i;

const QUOTA_RESET_PATTERNS = [
  /(?:try again|available again|available|reset(?:s)?|resume(?:s)?|reset window|next attempt|retry|please retry)\s+(?:on|at|in|by|after)\s+([^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
  /(?:reset|available)\s*[:\-]\s*([^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
  /(?:available again at|resume at|reset at)\s+([^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
  // Preposition-less "resets 6:30pm", "reset 18:30", "resets tomorrow 6pm", "resets May 18, 6am"
  /\breset(?:s)?\s+([a-z]{3,9}\s+\d{1,2}(?:,?\s*20\d{2})?(?:,?\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?[^.\n)·•|]*?)(?=[.\n)·•|]|$)/i,
  /\breset(?:s)?\s+((?:today|tomorrow)?\s*[0-9][^.\n)·•|]+?)(?=[.\n)·•|]|$)/i,
  // retry-delay style: "retryDelay: '60s'", "retry-after: 30s"
  /retry.?(?:delay|after)[:\s'"]+([0-9]+\s*(?:s|sec|seconds|m|min|minutes|h|hr|hours)?)/i,
];

const TZ_OFFSET_MAP = {
  "asia/seoul": "+09:00", "kst": "+09:00", "jst": "+09:00", "asia/tokyo": "+09:00",
  "utc": "+00:00", "gmt": "+00:00",
  "pst": "-08:00", "pdt": "-07:00", "est": "-05:00", "edt": "-04:00",
  "america/los_angeles": "-08:00", "america/new_york": "-05:00",
};

function stripOrdinal(text) {
  return String(text || "").replace(/(\d+)(st|nd|rd|th)/gi, "$1");
}

const MONTH_INDEX = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function offsetMinutesFromString(offset) {
  const om = String(offset || "+00:00").match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!om) return 0;
  return (om[1] === "-" ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3]));
}

// Detect a timezone hint anywhere on the line ("Asia/Seoul", "KST", ...) and
// return the corresponding offset string ("+09:00") or "" if none recognized.
// IMPORTANT: substring 매칭은 "request" 안의 "est" 같은 false positive 를 만든다.
// 반드시 word boundary 또는 toxic context (앞뒤 영문자) 를 검사한다.
function detectTzOffset(line) {
  const lower = String(line || "").toLowerCase();
  // 짧은 약어 (3-4 자) 는 양쪽이 영문자가 아닐 때만 인정.
  const tzAbbrev = /\b(kst|jst|utc|gmt|pst|pdt|est|edt)\b/i;
  const am = lower.match(tzAbbrev);
  if (am && am[1]) {
    const key = am[1].toLowerCase();
    if (TZ_OFFSET_MAP[key]) return TZ_OFFSET_MAP[key];
  }
  // 긴 IANA 이름은 그대로 검사.
  for (const key of Object.keys(TZ_OFFSET_MAP)) {
    if (key.length <= 4) continue;
    if (lower.includes(key)) return TZ_OFFSET_MAP[key];
  }
  return "";
}

// Parse loose time tokens like "6:30pm", "18:30", "6pm", "tomorrow 6pm", optionally
// combined with a timezone offset string. Returns Date or null. If the resolved
// instant has already passed today, rolls to the next day.
function parseLooseTime(token, tzOffset) {
  const text = stripOrdinal(token).trim().toLowerCase();
  if (!text) return null;
  // "5 days", "3 weeks" 같이 duration unit 이 따라오면 시각이 아니라 기간이므로 거부.
  if (/\d+\s*(?:d|w|day|days|week|weeks|month|months|year|years)\b/.test(text)) return null;

  // Already-absolute parses (e.g. "Mar 5 6:30pm 2026") — try first.
  const direct = Date.parse(text + (tzOffset ? " " + tzOffset : ""));
  if (Number.isFinite(direct) && direct > Date.now()) return new Date(direct);

  // Match "h[:mm][am|pm]"
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3];
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;

  // Day hint
  let dayShift = 0;
  if (/\btomorrow\b/.test(text)) dayShift = 1;
  else if (/\btoday\b/.test(text)) dayShift = 0;

  // Resolve against tz-shifted "today"
  const offset = tzOffset || "+00:00";
  const offsetMinutes = offsetMinutesFromString(offset);
  const nowUtc = Date.now();
  const localNow = new Date(nowUtc + offsetMinutes * 60000);
  const y = localNow.getUTCFullYear();
  const mo = localNow.getUTCMonth();
  const d = localNow.getUTCDate() + dayShift;
  // Build the candidate as a UTC instant representing local-time h:mm at offset
  const candidateUtc = Date.UTC(y, mo, d, hour, minute) - offsetMinutes * 60000;
  let ts = candidateUtc;
  if (ts <= nowUtc && dayShift === 0) ts += 24 * 60 * 60 * 1000; // roll to tomorrow
  return ts > nowUtc ? new Date(ts) : null;
}

function parseMonthDateTime(token, tzOffset) {
  const text = stripOrdinal(token).trim().toLowerCase();
  if (!text) return null;
  const monthNames = Object.keys(MONTH_INDEX).join("|");
  const re = new RegExp(
    `\\b(${monthNames})\\s+(\\d{1,2})(?:,?\\s*(20\\d{2}))?(?:,?\\s*(?:at\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?)?\\b`,
    "i",
  );
  const match = text.match(re);
  if (!match) return null;

  const month = MONTH_INDEX[match[1].toLowerCase()];
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isFinite(day) || day < 1 || day > 31) return null;

  let hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const ampm = match[6]?.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;

  const offset = tzOffset || "+00:00";
  const offsetMinutes = offsetMinutesFromString(offset);
  const nowUtc = Date.now();
  const localNow = new Date(nowUtc + offsetMinutes * 60000);
  let year = match[3] ? Number(match[3]) : localNow.getUTCFullYear();
  let candidateUtc = Date.UTC(year, month, day, hour, minute) - offsetMinutes * 60000;
  if (!match[3] && candidateUtc <= nowUtc) {
    year += 1;
    candidateUtc = Date.UTC(year, month, day, hour, minute) - offsetMinutes * 60000;
  }
  return candidateUtc > nowUtc ? new Date(candidateUtc) : null;
}

// Parse relative duration tokens like "60s", "2h 30m", "45 minutes", "1h",
// "90 sec" and return absolute Date in the future, or null if not parseable.
function parseRelativeDuration(token) {
  const text = String(token || "").trim().toLowerCase();
  if (!text) return null;
  // Disallow tokens that are clearly absolute times (contain : or am/pm or
  // a year) to avoid misinterpreting "6:30pm" as duration. But allow tokens
  // that include a duration unit (s/m/h/d/w/...).
  if (/(?:\d{1,2}:\d{2}|am|pm|20\d{2})/i.test(text)
      && !/\d+\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|w|second|seconds|minute|minutes|hour|hours|day|days|week|weeks)\b/i.test(text)) {
    return null;
  }
  let totalMs = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|h|m|s|d|w)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (!Number.isFinite(value)) continue;
    matched = true;
    if (/^(s|sec|secs|second|seconds)$/.test(unit)) totalMs += value * 1000;
    else if (/^(m|min|mins|minute|minutes)$/.test(unit)) totalMs += value * 60_000;
    else if (/^(h|hr|hrs|hour|hours)$/.test(unit)) totalMs += value * 3_600_000;
    else if (/^(d|day|days)$/.test(unit)) totalMs += value * 86_400_000;
    else if (/^(w|week|weeks)$/.test(unit)) totalMs += value * 7 * 86_400_000;
  }
  // Bare integer with no unit → treat as seconds if it looks like retry-after seconds (<= 86400)
  if (!matched) {
    const bare = text.match(/^(\d+)$/);
    if (bare) {
      const value = Number(bare[1]);
      if (value > 0 && value <= 7 * 24 * 60 * 60) {
        totalMs = value * 1000;
        matched = true;
      }
    }
  }
  if (!matched || totalMs <= 0) return null;
  return new Date(Date.now() + totalMs);
}

// 단일 candidate 문자열을 절대 시각으로 해석. 절대→상대→느슨한 시각 순.
function resolveCandidate(candidate, tzOffset) {
  if (!candidate) return null;
  const cleaned = stripOrdinal(candidate).trim();
  // 1) Strict absolute parse
  const strict = Date.parse(cleaned + (tzOffset ? " " + tzOffset : ""));
  if (Number.isFinite(strict) && strict > Date.now()) return new Date(strict);
  // 2) Month date + time (e.g. "May 18, 6am (Asia/Seoul)")
  const monthDate = parseMonthDateTime(cleaned, tzOffset);
  if (monthDate) return monthDate;
  // 3) Relative duration (e.g. "2h 30m", "60s")
  const rel = parseRelativeDuration(cleaned);
  if (rel) return rel;
  // 4) Loose time (e.g. "6:30pm", "tomorrow 6pm")
  const loose = parseLooseTime(cleaned, tzOffset);
  if (loose) return loose;
  return null;
}

export function parseQuotaReset(rawLine, providerHint = "") {
  if (!rawLine || typeof rawLine !== "string") return null;
  const cleaned = rawLine.replace(/[()]/g, " ");
  const tzOffset = detectTzOffset(cleaned);

  // Provider-specific 우선 매칭
  const provider = String(providerHint || "").trim().toLowerCase();
  const providerEntry = provider && PROVIDER_QUOTA_PATTERNS[provider];
  if (providerEntry) {
    if (providerEntry.hint.test(rawLine)) {
      for (const re of providerEntry.reset) {
        const match = cleaned.match(re);
        if (!match) continue;
        // ISO 직접 매칭은 group 0 이 후보가 될 수 있음 (capture group 없는 경우)
        const captured = (match[1] || match[0] || "").toString();
        const resolved = resolveCandidate(captured, tzOffset);
        if (resolved && resolved.getTime() > Date.now()) {
          return resolved.toISOString();
        }
      }
      // hint 는 맞았지만 reset 시각 추출 실패 → 기본 잠금 윈도우 (1시간) 적용해
      // 같은 메시지에서 무한 재시도를 막는다. provider 가 시간을 안 알려 줄 때 안전판.
      return new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }
    // provider hint 가 안 맞으면 generic 으로 폴백 (오탐 방지)
  }

  // Generic 폴백
  if (!QUOTA_HINT_RE.test(rawLine)) return null;
  for (const re of QUOTA_RESET_PATTERNS) {
    const match = cleaned.match(re);
    if (!match || !match[1]) continue;
    const resolved = resolveCandidate(match[1], tzOffset);
    if (resolved && resolved.getTime() > Date.now()) return resolved.toISOString();
  }
  // ISO timestamp anywhere on the line
  const iso = cleaned.match(/\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[Zz]|[+-]\d{2}:?\d{2})?)\b/);
  if (iso && iso[1]) {
    const t = Date.parse(iso[1]);
    if (Number.isFinite(t) && t > Date.now()) return new Date(t).toISOString();
  }
  return null;
}

export async function applyQuotaLockout(accountId, resetAtIso, reason = "") {
  if (!accountId || !resetAtIso) return null;
  const id = normalizeId(accountId);
  const runtime = await readRuntime();
  let touched = false;
  runtime.accounts = runtime.accounts.map((account) => {
    if (account.id !== id) return account;
    touched = true;
    return {
      ...account,
      remainingUnits: 0,
      quotaResetAt: resetAtIso,
      quotaReason: reason || account.quotaReason || "사용량 한도",
      usageAlert: "critical",
    };
  });
  if (!touched) return null;
  await writeRuntime(runtime);
  return resetAtIso;
}

export async function clearAccountQuotaLockout(accountId) {
  if (!accountId) return null;
  const id = normalizeId(accountId);
  const runtime = await readRuntime();
  let touched = false;
  runtime.accounts = runtime.accounts.map((account) => {
    if (account.id !== id) return account;
    touched = true;
    return {
      ...account,
      quotaResetAt: "",
      quotaReason: "",
      remainingUnits: Math.max(account.remainingUnits || 0, Math.max(1, account.weeklyUnits || 1)),
      usageAlert: "ok",
      lastProbeAt: new Date().toISOString(),
      lastProbeResult: "ok",
    };
  });
  if (!touched) return null;
  await writeRuntime(runtime);
  return id;
}

const PROBE_THROTTLE_MS = 10 * 60 * 1000; // 같은 계정 10 분 내 중복 probe 차단.

// 잠긴 계정에 가장 저렴한 모델로 짧은 ping 을 보내 토큰이 실제로 살아 있는지
// 확인한다. 점검 보상 / quota 갱신으로 quotaResetAt 보다 일찍 풀린 경우를
// 자동 감지해 잠금 해제하기 위한 헬퍼.
export async function probeAccountLockout(accountId, options = {}) {
  const id = normalizeId(accountId);
  const runtime = await readRuntime();
  const account = runtime.accounts.find((item) => item.id === id);
  if (!account) return { ok: false, reason: "account_not_found" };
  if (!account.quotaResetAt) return { ok: false, reason: "not_locked" };

  if (!options.force && account.lastProbeAt) {
    const since = Date.now() - Date.parse(account.lastProbeAt);
    if (Number.isFinite(since) && since < PROBE_THROTTLE_MS) {
      return { ok: false, reason: "throttled", retryAfterMs: PROBE_THROTTLE_MS - since };
    }
  }

  const { commandPathFor, sharedSessionProfilesRoot } = await import("./worker-launch-adapter.mjs");
  const provider = account.provider;
  const sessionProfileRaw = account.sessionProfile || "";
  let command = "";
  let args = [];
  let configEnv = "";
  let subdir = "";

  if (provider === "codex") {
    command = process.env.AGENTAPP_CODEX_COMMAND || (await commandPathFor("codex"));
    args = [
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      "gpt-4o-mini",
      "ok",
    ];
    configEnv = "CODEX_HOME";
    subdir = "codex";
  } else if (provider === "claude") {
    command = process.env.AGENTAPP_CLAUDE_COMMAND || (await commandPathFor("claude"));
    args = [
      "--print",
      "--dangerously-skip-permissions",
      "--model",
      "haiku",
      "ok",
    ];
    configEnv = "CLAUDE_CONFIG_DIR";
    subdir = "claude-code";
  } else if (provider === "gemini") {
    command = process.env.AGENTAPP_GEMINI_COMMAND || (await commandPathFor("gemini"));
    args = [
      "--prompt",
      "ok",
      "--yolo",
      "--model",
      "gemini-2.5-flash",
    ];
    configEnv = "GEMINI_CONFIG_DIR";
    subdir = "gemini-cli";
  } else {
    return { ok: false, reason: "unsupported_provider" };
  }

  if (!command) {
    return { ok: false, reason: "cli_not_found" };
  }
  if (!sessionProfileRaw) {
    return { ok: false, reason: "missing_session_profile" };
  }

  const sessionDir = path.join(sharedSessionProfilesRoot(), subdir, sanitizeSegment(sessionProfileRaw));

  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    let combined = "";
    let resolved = false;
    const env = { ...process.env, [configEnv]: sessionDir };
    let child;
    try {
      child = spawn(command, args, {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        // shell needed for .cmd wrappers (claude.cmd / codex.cmd / gemini.cmd)
        shell: /\.(cmd|bat)$/i.test(command),
      });
    } catch (error) {
      void markProbeResult(id, "spawn_error", error?.message || String(error));
      resolve({ ok: false, reason: "spawn_error" });
      return;
    }
    const finish = async (ok, reason) => {
      if (resolved) return;
      resolved = true;
      if (ok) {
        await clearAccountQuotaLockout(id);
      } else {
        await markProbeResult(id, reason || "still_locked");
      }
      resolve({ ok, reason });
    };
    child.stdout.on("data", (chunk) => { combined += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { combined += chunk.toString("utf8"); });
    child.on("error", () => finish(false, "spawn_error"));
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish(false, "timeout");
    }, 30000);
    child.on("close", (code) => {
      clearTimeout(timer);
      // 출력에 quota / unauthorized 패턴이 있으면 still locked.
      if (/quota|rate.?limit|too many requests|usage limit|429|hit your (?:usage|limit)|exceeded/i.test(combined)) {
        finish(false, "still_locked");
        return;
      }
      if (/unauthor|revoked|refresh token/i.test(combined)) {
        finish(false, "auth_invalid");
        return;
      }
      if (code === 0 && combined.trim().length > 0) {
        finish(true, "ok");
      } else if (code === 0) {
        // Empty output with code 0 — likely OK but ambiguous. Treat as success.
        finish(true, "ok_empty");
      } else {
        finish(false, `exit_${code}`);
      }
    });
  });
}

async function markProbeResult(accountId, result, detail = "") {
  const runtime = await readRuntime();
  runtime.accounts = runtime.accounts.map((account) =>
    account.id === accountId
      ? {
          ...account,
          lastProbeAt: new Date().toISOString(),
          lastProbeResult: detail ? `${result}: ${detail.slice(0, 120)}` : result,
        }
      : account,
  );
  await writeRuntime(runtime);
}

export async function probeAllLockedAccounts(options = {}) {
  const runtime = await readRuntime();
  const now = Date.now();
  const locked = runtime.accounts.filter((account) => {
    if (!account.quotaResetAt) return false;
    const resetMs = Date.parse(account.quotaResetAt);
    return Number.isFinite(resetMs) && resetMs > now;
  });
  if (locked.length === 0) return { tried: 0, unlocked: 0 };
  let unlocked = 0;
  for (const account of locked) {
    const result = await probeAccountLockout(account.id, options);
    if (result.ok) unlocked += 1;
  }
  return { tried: locked.length, unlocked };
}

export async function clearAccountAuthIdentity(accountId) {
  if (!accountId) return null;
  const id = normalizeId(accountId);
  const runtime = await readRuntime();
  runtime.accounts = runtime.accounts.map((account) =>
    account.id === id
      ? {
          ...account,
          actualAuthEmail: "",
          sessionStatus: "needs-login",
          sessionDetectionReason: "OAuth 토큰이 만료/취소됐습니다. '로그인' 을 다시 눌러 인증을 새로 완료하세요.",
        }
      : account,
  );
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
  const result = await mutateRuntimeRun(
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
  // 성공/완료 시 프로젝트별 마지막 사용 모델/워커를 기억해 다음 실행 기본값으로 사용.
  // 단, model 의 provider 가 실제 워커의 provider 와 일치하는 경우에만 저장
  // (예: claude-code 가 'gpt-5.5' 로 잘못 라우팅됐던 mismatch 가 다음 실행에
  // 이어지지 않도록).
  try {
    const finishedStatus = patch?.status || "";
    if (finishedStatus === "completed" || finishedStatus === "stopped") {
      const finishedRun = result.runHistory?.find((item) => item.id === runId);
      if (finishedRun?.projectId && finishedRun.routing?.model && finishedRun.workerId) {
        const modelProvider = providerForModel(finishedRun.routing.model);
        const workerProvider = providerForWorker(finishedRun.workerId);
        const consistent = modelProvider === "" || workerProvider === "" || modelProvider === workerProvider;
        if (consistent) {
          const projectId = finishedRun.projectId;
          const lastModel = String(finishedRun.routing.model);
          const lastWorker = String(finishedRun.workerId);
          result.projects = result.projects.map((project) =>
            project.id === projectId ? { ...project, lastModel, lastWorker } : project,
          );
          await writeRuntime(result);
        }
      }
    }
  } catch {
    // best-effort: never block run completion on this bookkeeping
  }
  return result;
}

function buildPendingRecord(input, routing) {
  const workerId = String(input.workerId || "auto");
  const provider = providerForWorker(workerId);
  return {
    id: `pending-${Date.now()}`,
    queuedAt: nowIso(),
    workerId,
    workerAuto: workerId === "auto" || provider === "",
    projectId: String(input.projectId || "current"),
    prompt: String(input.prompt || "").trim(),
    complexity: String(input.complexity || "standard"),
    modelOverride: String(input.modelOverride || "auto"),
    provider,
    blockedReason: routing?.reason || "준비된 계정이 없습니다.",
  };
}

function pendingMatchesAccount(pending, account) {
  if (!pending || !account) return false;
  const provider = pending.provider || providerForWorker(pending.workerId);
  if (!provider || pending.workerAuto || pending.workerId === "auto") return true;
  return provider === account.provider;
}

export async function dispatchPendingForAccount(accountId) {
  const runtime = await readRuntime();
  const account = runtime.accounts.find((item) => item.id === accountId);
  if (!account || account.enabled === false || account.sessionStatus !== "ready" || activeQuotaLock(account)) {
    return { runtime, dispatched: 0 };
  }
  const pending = (runtime.pendingRuns || []).filter((item) => pendingMatchesAccount(item, account));
  if (pending.length === 0) return { runtime, dispatched: 0 };

  const next = pending[0];
  await writeRuntime({
    ...runtime,
    pendingRuns: runtime.pendingRuns.filter((item) => item.id !== next.id),
  });
  const after = await startRun({
    workerId: next.workerId,
    projectId: next.projectId,
    prompt: next.prompt,
    complexity: next.complexity,
    modelOverride: next.modelOverride,
    autoDispatched: true,
    pendingId: next.id,
  });
  return { runtime: after, dispatched: 1 };
}

export async function quickHandoff(input = {}) {
  const runtime = await readRuntime();
  const active = runtime.activeRun;
  const fallbackPrompt = String(input.prompt || active?.prompt || "이전 작업 인계").trim();
  const complexity = String(input.complexity || active?.complexity || "standard");
  const targetId = normalizeId(input.targetAccountId || input.target_account_id || "");

  let targetAccount = null;
  if (targetId) {
    targetAccount = runtime.accounts.find((item) => item.id === targetId) || null;
  } else {
    const fromId = normalizeId(input.fromAccountId || active?.routing?.accountId || "");
    const candidates = runtime.accounts
      .filter((account) => account.enabled !== false && account.sessionStatus === "ready" && account.id !== fromId)
      .sort((left, right) => Number(right.remainingUnits || 0) - Number(left.remainingUnits || 0));
    targetAccount = candidates[0] || null;
  }

  if (!targetAccount) {
    return {
      ...runtime,
      handoff: {
        status: "blocked",
        reason: "이어받을 준비된 계정이 없습니다. 다른 계정을 로그인 후 [재감지]로 준비 상태로 만드세요.",
      },
    };
  }

  if (active) {
    await stopRun();
  }

  const workerId = String(input.workerId || `${targetAccount.provider}-${targetAccount.loginLabel || "default"}`);
  const after = await startRun({
    workerId,
    projectId: input.projectId || active?.projectId || "current",
    prompt: fallbackPrompt,
    complexity,
    modelOverride: input.modelOverride || "auto",
    handoffFrom: active?.routing?.accountId || "",
  });

  return {
    ...after,
    handoff: {
      status: "started",
      targetAccountId: targetAccount.id,
      reason: `'${targetAccount.displayName || targetAccount.id}' 계정으로 작업을 이어받았습니다.`,
    },
  };
}

// 한도 도달한 run 을 다른 ready 계정으로 자동 재시도. 사용자가 자동 라우팅으로
// 시작한 run 은 다음 후보 provider 까지 다시 열어 둔다.
// 최대 시도 횟수를 넘기면 null 반환. 호출자는 사용자 알림으로 마감해야 한다.
export async function tryQuotaRetry(failedRun) {
  const settings = normalizeSettings((await readRuntime()).settings);
  if (!settings.quotaRetryEnabled) return null;
  const attempts = Number(failedRun.retryCount || 0) + 1;
  if (attempts > settings.quotaRetryMaxAttempts) return null;
  const runtime = await readRuntime();
  const retryWorkerId = failedRun.workerAuto ? "auto" : failedRun.workerId;
  // 현재 계정은 이미 quotaResetAt 잠금 상태라 selectRoute 에서 제외됨.
  const routing = selectRoute(runtime.accounts, {
    workerId: retryWorkerId,
    complexity: failedRun.complexity || "standard",
    modelOverride: failedRun.modelOverride || "auto",
  });
  if (routing.status !== "recommended") return null;
  const result = await startRun({
    workerId: retryWorkerId,
    projectId: failedRun.projectId,
    prompt: failedRun.prompt,
    complexity: failedRun.complexity || "auto",
    modelOverride: failedRun.modelOverride || "auto",
    retryCount: attempts,
    retryReason: `quota_exhausted_attempt_${attempts}`,
    autoChain: Boolean(failedRun.autoChain),
  });
  return result.activeRun || null;
}

// run 이 completed 로 끝났을 때 autoChain 설정이 켜져 있으면 NEXT_TASK 를 자동으로 픽업해서
// 같은 worker/project 로 다음 run 시작. 외부 프로젝트는 그 프로젝트의 NEXT_TASK, AgentApp 자체는 repo 의 NEXT_TASK.
export async function tryAutoChain(prevRun) {
  const runtime = await readRuntime();
  const settings = normalizeSettings(runtime.settings);
  if (!settings.autoChainEnabled) return null;

  // 무한 루프 방지: 같은 체인에서 너무 많이 반복되지 않도록 제한.
  const prevDepth = Number(prevRun.chainDepth || 0);
  if (prevDepth >= settings.autoChainMaxDepth) {
    return { skipped: true, reason: `autoChain max depth ${settings.autoChainMaxDepth} 도달` };
  }

  // 외부 프로젝트면 그 프로젝트의 next_task 를 사용.
  let nextTitle = "";
  try {
    if (prevRun.projectId && prevRun.projectId !== "current") {
      const project = runtime.projects.find((p) => p.id === prevRun.projectId);
      if (project) {
        const meta = await readProjectMeta({ path: project.path });
        nextTitle = meta?.next_task?.title || "";
      }
    } else {
      const nextTaskPath = path.join(HANDOFF_DIR, "NEXT_TASK.md");
      const body = await readFile(nextTaskPath, "utf8").catch(() => "");
      const match = body.match(/Selected task:\s*(.+)/i);
      nextTitle = match ? match[1].trim() : "";
    }
  } catch {
    nextTitle = "";
  }

  // NEXT_TASK 가 비었거나 'none' 이거나, **방금 끝낸 작업과 동일**하면
  // 일반 '이어 진행' 프롬프트로 폴백. 그래야 worker 가 NEXT_TASK 를
  // 갱신하지 않은 상태에서도 다음 단계로 자율 진행된다.
  const prevPrompt = String(prevRun.prompt || "").trim();
  const hasNewTask = nextTitle && !/^none$/i.test(nextTitle) && nextTitle.trim() !== prevPrompt;
  const chainPrompt = hasNewTask
    ? nextTitle
    : "이전 작업을 완료한 상태입니다. 메모리/계획/핸드오프 파일을 참고해 다음에 진행할 항목을 스스로 판단하고 이어서 진행해 주세요. 더 이상 진행할 작업이 없으면 'CHAIN_DONE' 한 줄만 응답해 주세요.";
  const nextWorkerId = prevRun.workerAuto ? "auto" : prevRun.workerId;

  const result = await startRun({
    workerId: nextWorkerId,
    projectId: prevRun.projectId,
    prompt: chainPrompt,
    complexity: "auto",
    modelOverride: prevRun.modelOverride || "auto",
    autoChain: true,
    chainDepth: prevDepth + 1,
    chainReason: hasNewTask ? "next_task_picked" : "generic_continuation",
  });
  return result.activeRun || null;
}

// 작업 텍스트만으로 complexity 를 자동 분류한다. 사용자가 dropdown 에서 명시적으로 고르지 않을 때 사용.
export function classifyComplexity(promptText) {
  const text = String(promptText || "").trim();
  if (!text) return "standard";
  const lower = text.toLowerCase();
  // 가장 강한 신호: critical (운영/배포/보안/긴급)
  if (/\b(critical|production|deploy(ment)?|security|hotfix|urgent|incident|p0|breaking change)\b/i.test(lower)) {
    return "critical";
  }
  // complex: 아키텍처/대규모 리팩토링/시스템 설계
  if (/\b(architect(ure)?|design.*system|migrate|migration|protocol|infrastructure|rewrite|overhaul|cross-?cut|orchestrat)/i.test(lower)) {
    return "complex";
  }
  // routine: 매우 단순한 작업 명령어
  if (/\b(typo|rename|format|whitespace|docstring|comment|fix.*spell|grammar|trivial|cosmetic|lint)\b/i.test(lower)) {
    return "routine";
  }
  // 개발 작업 동사 키워드 → 최소 standard 신호
  const isDevTask = /\b(implement|build|create|add|feature|enhance|refactor|update|change|fix|debug|integrate|wire|connect|extend|expose|support)\b/i.test(lower);
  // 다중 줄/여러 단계 신호 → standard 이상
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).length;
  if (lines >= 5 || text.length > 320) return "complex";
  if (isDevTask) return text.length > 200 ? "complex" : "standard";
  // 길이 기반 fallback (개발 키워드 없을 때만)
  if (text.length < 60) return "routine";
  return "standard";
}

export async function startRun(input) {
  const runtime = await readRuntime();
  // complexity="auto" 또는 미지정이면 prompt 텍스트로 자동 분류.
  const requestedComplexity = String(input.complexity || "auto").toLowerCase();
  const resolvedComplexity =
    requestedComplexity === "auto" || !["routine", "standard", "complex", "critical"].includes(requestedComplexity)
      ? classifyComplexity(input.prompt)
      : requestedComplexity;
  // workerId="auto" 면 후보 provider 를 모두 열어 두고, modelOverride="auto"
  // 면 이 프로젝트가 최근에 쓴 모델을 우선 사용. 단, lastModel 의 provider 가
  // 실제 라우팅 결과 provider 와 다르면 lastModel 무시 (claude 계정에 gpt 모델
  // 지정하는 식의 mismatch 방지).
  const requestedWorker = String(input.workerId || "auto").toLowerCase();
  const projectId = String(input.projectId || "current");
  const projectRecord = runtime.projects.find((item) => item.id === projectId);
  const projectLastModel = projectRecord?.lastModel || "";
  const requestedModelOverride = String(input.modelOverride || "auto");

  // 1차 라우팅 — modelOverride='auto' 로 보내 selectRoute 가 후보 자유 선택.
  const firstPass = selectRoute(runtime.accounts, {
    ...input,
    complexity: resolvedComplexity,
    workerId: requestedWorker === "auto" ? "" : requestedWorker,
    modelOverride: "auto",
  });

  // projectLastModel 이 1차 라우팅이 고른 provider 와 호환되는지 검사.
  // 호환되면 그 값을 modelOverride 로 다시 전달, 아니면 그냥 auto 유지.
  const lastModelProvider = providerForModel(projectLastModel);
  const lastModelCompatible = projectLastModel
    && firstPass.status !== "blocked"
    && (lastModelProvider === "" || lastModelProvider === firstPass.provider);
  const resolvedModelOverride = requestedModelOverride === "auto" && lastModelCompatible
    ? projectLastModel
    : requestedModelOverride === "auto"
      ? "auto"
      : requestedModelOverride;
  const normalizedInput = {
    ...input,
    complexity: resolvedComplexity,
    workerId: requestedWorker === "auto" ? "" : requestedWorker,
    modelOverride: resolvedModelOverride,
  };
  const routing = selectRoute(runtime.accounts, normalizedInput);

  // auto 워커는 routing 이 고른 provider 로 환산.
  const resolvedWorker = requestedWorker === "auto"
    ? (routing.status === "recommended" ? (workerForProvider(routing.provider) || "claude-code") : "auto")
    : requestedWorker;

  const id = `run-${Date.now()}`;
  const run = {
    id,
    status: routing.status === "blocked" ? "queued" : "running",
    workerId: resolvedWorker,
    workerAuto: requestedWorker === "auto",
    projectId,
    prompt: String(input.prompt || "").trim(),
    complexity: resolvedComplexity,
    complexityAuto: requestedComplexity === "auto",
    modelOverride: resolvedModelOverride,
    modelOverrideAuto: requestedModelOverride === "auto",
    retryCount: Number(input.retryCount || 0),
    retryReason: String(input.retryReason || ""),
    autoChain: Boolean(input.autoChain),
    chainDepth: Number(input.chainDepth || 0),
    chainReason: String(input.chainReason || ""),
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

  if (run.status !== "running" && routing.status === "blocked") {
    const pending = buildPendingRecord(input, routing);
    runtime.pendingRuns = [
      pending,
      ...(runtime.pendingRuns || []).filter((item) => item.id !== input.pendingId),
    ].slice(0, 20);
  } else if (input.pendingId) {
    runtime.pendingRuns = (runtime.pendingRuns || []).filter((item) => item.id !== input.pendingId);
  }

  if (run.status === "running" && routing.accountId) {
    runtime.accounts = runtime.accounts.map((account) =>
      account.id === routing.accountId ? { ...account, lastUsedAt: nowIso() } : account,
    );
  }

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
