#!/usr/bin/env node

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deleteCredential, storeCredential } from "./credential-vault.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.resolve(process.env.AGENTAPP_DATA_DIR || path.join(REPO_ROOT, "data"));
const RUNTIME_FILE = path.join(DATA_DIR, "dashboard-runtime.json");
const RUNTIME_BACKUP_FILE = `${RUNTIME_FILE}.bak`;
const RUNTIME_LAST_GOOD_FILE = `${RUNTIME_FILE}.last-good`;
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
  // 가장 최근에 시작된 running run. 호환용 별칭 — UI/하위 코드가 단일 필드를 보던
  // 곳을 깨지 않기 위해 유지. 실제 동시 실행 여부는 activeRuns 가 source of truth.
  activeRun: null,
  // 프로젝트별로 동시 실행이 가능하도록 한 모든 running run 목록. 각 worker 는
  // 자기 run-<id> 폴더와 별도 자식 프로세스를 갖기 때문에 OS 레벨 충돌은 없다.
  // 같은 프로젝트 안에서는 1 개만 동시 실행 (file/git 충돌 방지) — startRun 가드.
  activeRuns: [],
  runHistory: [],
  pendingRuns: [],
  settings: {
    idleWarnMs: 90 * 1000,
    idleKillMs: 30 * 60 * 1000,
    autoChainEnabled: true,
    // 기본을 30 → 8 로 낮춤. 30 은 사용자 환경에서 토큰 폭주의 주범.
    // 사용자가 명시적으로 늘릴 수 있게 settings 로 노출 유지.
    autoChainMaxDepth: 8,
    // CHAIN_DONE 을 worker 가 보냈는데도 진행률 등을 이유로 무시하고 다시
    // 강제 실행하는 동작은 기본 OFF. 워커가 명시적으로 끝났다고 했을 때는
    // 그 신호를 존중한다. 토큰 절약 우선. 사용자가 켜고 싶으면 settings 에서.
    // 기본 on — 사용자가 "최대한 멈추지 말고 끈질기게 진행" 을 원해 CHAIN_DONE 이 와도
    // NEXT_TASK / 진행률 기반으로 한 번 더 이어간다. override 횟수는 CHAIN_DONE_OVERRIDE_CAP
    // 으로 제한해 무한 루프는 막는다. 사용자가 명시적으로 멈추고 싶을 때만 off.
    autoChainOverrideOnChainDone: true,
    quotaRetryEnabled: true,
    // 한도 도달 시 다른 ready 계정으로 시도. 같은 prompt 를 3 번까지 다른
    // 계정으로 돌리는 동작도 사용자 입장에선 토큰 폭주로 보일 수 있어
    // 2 로 축소.
    quotaRetryMaxAttempts: 2,
    // 유지보수 분류(오류분석/검증/C#/T-SQL 등) 시 1 순위로 라우팅할 회사 도메인.
    // 빈 값 또는 미지정이면 도메인 우선 비활성화. 코드 상수 대신 settings 로
    // 노출해 사이트별로 다른 도메인을 쓸 수 있게 한다.
    maintenanceDomain: "hanilnetworks.com",
    // 같은 Wi-Fi 안의 모바일/태블릿에서 대시보드 접속 허용. 기본 off (127.0.0.1).
    // 켜면 main.mjs 가 0.0.0.0 으로 dashboard-server 를 다시 띄우고, 비로컬호스트
    // 요청은 lanAccessToken 을 query (?t=...) 또는 X-AgentApp-Token 헤더로 들고
    // 와야 받아준다. 토큰은 toggle ON 시 자동 생성 (영구 보관).
    lanAccessEnabled: false,
    lanAccessToken: "",
    // worker 가 CHAIN_DONE 과 함께 "사용자 결정 대기" 신호를 보낼 때 어디까지
    // 엄격하게 stop 할지 결정. 사용자가 "대기/사용자 확인으로 멈추는 케이스를
    // 최대한 줄여달라" 고 요청해 기본 false 로 둔다.
    //   false (기본) — DECISIONS_REQUIRED / [NEXT_NONE] 마커처럼 가장 명확한
    //                  종료 신호만 stop. wait/no-actionable/사용자 승인 같은
    //                  약한 신호는 무시하고 진행률·NEXT_TASK 기반으로 끈질기게
    //                  이어 진행.
    //   true         — 기존 STRICT_WAIT_FOR_USER_PATTERNS 4 개 패턴 모두 stop
    //                  (escalation, wait for user approval/decision/input,
    //                  사용자 승인/결재 필요 등). 보수적 운영용.
    strictUserWait: false,
    // 외부 알림 webhook. 이벤트(완료/대기/사용자 답변 필요) 발생 시 POST.
    // ntfy.sh / Discord / Slack incoming webhook 호환 (자동 형식 감지).
    // 예: https://ntfy.sh/agentapp-xxx (ntfy 앱 설치 후 토픽 구독으로 모바일 알림).
    notifyWebhookUrl: "",
    // 알림 켜기/끄기 (true=웹훅 + dashboard toast + OS Notification 모두 발생).
    notifyEnabled: true,
  },
};

function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const idleWarnMs = Number.isFinite(Number(source.idleWarnMs)) ? Math.max(0, Number(source.idleWarnMs)) : 90 * 1000;
  const idleKillMs = Number.isFinite(Number(source.idleKillMs)) ? Math.max(0, Number(source.idleKillMs)) : 30 * 60 * 1000;
  const autoChainEnabled = source.autoChainEnabled === undefined ? true : Boolean(source.autoChainEnabled);
  const autoChainMaxDepth = Number.isFinite(Number(source.autoChainMaxDepth))
    ? Math.max(1, Math.min(500, Number(source.autoChainMaxDepth)))
    : 8;
  const autoChainOverrideOnChainDone =
    source.autoChainOverrideOnChainDone === undefined ? true : Boolean(source.autoChainOverrideOnChainDone);
  const quotaRetryEnabled = source.quotaRetryEnabled === undefined ? true : Boolean(source.quotaRetryEnabled);
  const quotaRetryMaxAttempts = Number.isFinite(Number(source.quotaRetryMaxAttempts))
    ? Math.max(0, Math.min(10, Number(source.quotaRetryMaxAttempts)))
    : 2;
  // maintenanceDomain: 빈 문자열 / null / undefined → 도메인 우선 비활성.
  // 정상 값이면 소문자로 정규화해서 저장 (이메일 비교가 소문자 기준).
  const maintenanceDomainRaw = source.maintenanceDomain;
  const maintenanceDomain = typeof maintenanceDomainRaw === "string"
    ? maintenanceDomainRaw.trim().toLowerCase()
    : "hanilnetworks.com";
  const strictUserWait = source.strictUserWait === undefined
    ? false
    : Boolean(source.strictUserWait);
  const notifyWebhookUrl = typeof source.notifyWebhookUrl === "string"
    ? source.notifyWebhookUrl.trim()
    : "";
  const notifyEnabled = source.notifyEnabled === undefined
    ? true
    : Boolean(source.notifyEnabled);
  const lanAccessEnabled = source.lanAccessEnabled === undefined
    ? false
    : Boolean(source.lanAccessEnabled);
  // 토큰은 영문/숫자 32 자. 켤 때 비어 있으면 새로 생성, 한 번 만들면 유지.
  // (토글을 껐다가 다시 켜면 같은 토큰 그대로 → 폰에 저장된 즐겨찾기 URL 재사용 가능)
  const tokenRaw = String(source.lanAccessToken || "").trim();
  const tokenValid = /^[A-Za-z0-9_-]{16,64}$/.test(tokenRaw);
  const lanAccessToken = lanAccessEnabled && !tokenValid
    ? generateLanAccessToken()
    : tokenValid
      ? tokenRaw
      : "";
  return {
    idleWarnMs,
    idleKillMs,
    autoChainEnabled,
    autoChainMaxDepth,
    autoChainOverrideOnChainDone,
    quotaRetryEnabled,
    quotaRetryMaxAttempts,
    maintenanceDomain,
    strictUserWait,
    notifyWebhookUrl,
    notifyEnabled,
    lanAccessEnabled,
    lanAccessToken,
  };
}

function generateLanAccessToken() {
  // 32 자 영문/숫자 — Math.random 충분 (보안 결정 토큰 아님, URL guess 방지용).
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
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
const MAINTENANCE_PROMPT_PREFIX = "[에러분석]";

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
  // activeRuns 가 비었는데 activeRun (구버전) 만 있으면 거기에 묶어 마이그레이션.
  // 반대로 activeRuns 가 있고 activeRun 이 비었으면 가장 최근 것을 alias.
  const activeRunsRaw = Array.isArray(runtime.activeRuns) ? runtime.activeRuns.filter(Boolean) : [];
  const legacyActiveRun = runtime.activeRun && !activeRunsRaw.some((r) => r?.id === runtime.activeRun.id)
    ? runtime.activeRun
    : null;
  const activeRuns = legacyActiveRun ? [legacyActiveRun, ...activeRunsRaw] : activeRunsRaw;
  return {
    version: 1,
    accounts: Array.isArray(runtime.accounts) ? runtime.accounts.map(normalizeAccount) : [],
    projects: Array.isArray(runtime.projects) ? runtime.projects.map(normalizeProject) : [],
    activeRuns,
    // 가장 최근 (배열 첫 번째) = legacy alias. UI 가 단일 카드만 보던 부분 호환.
    activeRun: activeRuns[0] || null,
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

function processIsAlive(pid) {
  const value = Number(pid || 0);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function projectPathForRun(runtime, run) {
  const project = (runtime.projects || []).find((item) => item.id === run?.projectId);
  return String(project?.path || "").trim();
}

function trimCapture(text, limit = 4096) {
  const value = String(text || "");
  return value.length <= limit ? value : value.slice(-limit);
}

async function captureCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd || REPO_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        stdout: trimCapture(stdout),
        stderr: trimCapture(stderr),
      });
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish({ code: 124, timedOut: true });
    }, Math.max(1000, Number(options.timeoutMs || 5000)));
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ code: 1, error: error instanceof Error ? error.message : String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code: Number(code || 0), timedOut: false });
    });
  });
}

export async function inspectRunWorktree(runtime, run) {
  const cwd = projectPathForRun(runtime, run);
  if (!cwd) return null;
  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) return null;
  } catch {
    return null;
  }

  const status = await captureCommand("git", ["status", "--short"], { cwd, timeoutMs: 5000 });
  if (status.code !== 0) {
    return {
      path: cwd,
      dirty: false,
      branch: "",
      files: [],
      fileCount: 0,
      statusText: "",
      error: status.stderr || status.error || "git status failed",
    };
  }

  const branch = await captureCommand("git", ["branch", "--show-current"], { cwd, timeoutMs: 3000 });
  const diffStat = await captureCommand("git", ["diff", "--stat"], { cwd, timeoutMs: 5000 });
  const lines = status.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const files = lines.map((line) => line.replace(/^.. ?/, "").trim()).filter(Boolean);
  return {
    path: cwd,
    dirty: lines.length > 0,
    branch: branch.code === 0 ? branch.stdout.trim() : "",
    files: files.slice(0, 30),
    fileCount: lines.length,
    statusText: lines.slice(0, 50).join("\n"),
    diffStat: diffStat.code === 0 ? diffStat.stdout.trim() : "",
  };
}

function dirtyWorktreeEvent(snapshot, reason) {
  if (!snapshot?.dirty) return null;
  const sample = snapshot.files.slice(0, 6).join(", ");
  const suffix = snapshot.fileCount > 6 ? ` 외 ${snapshot.fileCount - 6}개` : "";
  const reasonText = reason === "stale_pid_missing"
    ? "worker PID가 사라졌습니다"
    : "worker가 실패 종료했습니다";
  return `중단 감지: ${reasonText}. ${snapshot.path}에 미커밋 변경 ${snapshot.fileCount}개가 남아 있습니다: ${sample}${suffix}`;
}

export async function buildInterruptedWorktreePatch(run, reason = "worker_failed") {
  const runtime = await readRuntime();
  const snapshot = await inspectRunWorktree(runtime, run);
  if (!snapshot?.dirty) return {};
  return {
    interruptedWorktree: {
      ...snapshot,
      reason,
      detectedAt: nowIso(),
    },
    currentStatus: `작업 중단: 미커밋 변경 ${snapshot.fileCount}개 남음`,
  };
}

async function reconcileStaleActiveRun(runtime) {
  const active = runtime.activeRun;
  if (!active || active.status !== "running" || !active.adapter?.pid) {
    return { runtime, changed: false };
  }
  if (processIsAlive(active.adapter.pid)) {
    return { runtime, changed: false };
  }

  const finishedAt = nowIso();
  const lastMessageText = (await readInlineText(active.adapter.lastMessagePath)).trim();
  const worktree = await inspectRunWorktree(runtime, active);
  const dirtyAfterExit = Boolean(worktree?.dirty);
  const completed = Boolean(lastMessageText) && !dirtyAfterExit;
  const status = completed ? "completed" : lastMessageText ? "needs_user" : "failed";
  const adapterStatus = completed ? "completed" : lastMessageText ? "interrupted-dirty-worktree" : "failed";
  const dirtyEvent = dirtyWorktreeEvent(worktree, "stale_pid_missing");
  const nextRun = {
    ...active,
    status,
    currentStatus: dirtyAfterExit ? `작업 중단: 미커밋 변경 ${worktree.fileCount}개 남음` : active.currentStatus,
    interruptedWorktree: dirtyAfterExit
      ? {
          ...worktree,
          reason: "stale_pid_missing",
          detectedAt: finishedAt,
        }
      : active.interruptedWorktree,
    stoppedAt: active.stoppedAt || finishedAt,
    adapter: {
      ...(active.adapter || {}),
      status: adapterStatus,
      exitCode: completed ? 0 : 1,
      lastMessageText,
    },
    events: cappedEvents(active.events, {
      at: finishedAt,
      level: completed ? "info" : "warn",
      message: completed
        ? "stale activeRun 정리: worker PID가 종료됐고 최종 메시지가 있어 완료 처리했습니다."
        : "stale activeRun 정리: worker PID가 종료됐고 최종 메시지가 없어 실패 처리했습니다.",
    }),
  };
  if (lastMessageText && dirtyAfterExit) {
    nextRun.events = cappedEvents(nextRun.events, {
      at: finishedAt,
      level: "warn",
      message: "최종 메시지는 있으나 작업 폴더에 미커밋 변경이 남아 검토 필요 상태로 처리했습니다.",
    });
  }
  if (dirtyEvent) {
    nextRun.events = cappedEvents(nextRun.events, {
      at: finishedAt,
      level: "warn",
      message: dirtyEvent,
    });
  }
  const history = Array.isArray(runtime.runHistory) ? runtime.runHistory : [];
  const found = history.some((item) => item.id === nextRun.id);
  const runHistory = (found
    ? history.map((item) => (item.id === nextRun.id ? nextRun : item))
    : [nextRun, ...history]
  ).slice(0, 20);
  return {
    runtime: {
      ...runtime,
      activeRun: null,
      runHistory,
    },
    changed: true,
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

function runtimeCollections(input) {
  return {
    accounts: Array.isArray(input?.accounts) ? input.accounts.length : 0,
    projects: Array.isArray(input?.projects) ? input.projects.length : 0,
  };
}

function hasRuntimeCollections(input) {
  const counts = runtimeCollections(input);
  return counts.accounts > 0 || counts.projects > 0;
}

function hasRuntimeActivity(input) {
  return Boolean(input?.activeRun)
    || (Array.isArray(input?.activeRuns) && input.activeRuns.length > 0)
    || (Array.isArray(input?.runHistory) && input.runHistory.length > 0)
    || (Array.isArray(input?.pendingRuns) && input.pendingRuns.length > 0);
}

function hasNonDefaultRuntimeSettings(input) {
  if (!input?.settings || typeof input.settings !== "object") return false;
  return JSON.stringify(normalizeSettings(input.settings)) !== JSON.stringify(normalizeSettings(DEFAULT_RUNTIME.settings));
}

function isTriviallyEmptyRuntime(input) {
  return !hasRuntimeCollections(input) && !hasRuntimeActivity(input) && !hasNonDefaultRuntimeSettings(input);
}

function runtimeRecoveryCandidates({ skipPrimary = false, includeLegacy = true } = {}) {
  const candidates = [];
  if (!skipPrimary) candidates.push({ file: RUNTIME_FILE, label: "primary" });
  candidates.push(
    { file: RUNTIME_BACKUP_FILE, label: "backup" },
    { file: RUNTIME_LAST_GOOD_FILE, label: "last-good" },
  );
  if (includeLegacy && process.env.AGENTAPP_DISABLE_LEGACY_RUNTIME_RECOVERY !== "1" && process.env.APPDATA) {
    const legacyFile = path.join(process.env.APPDATA, "Electron", "data", "dashboard-runtime.json");
    if (path.resolve(legacyFile) !== path.resolve(RUNTIME_FILE)) {
      candidates.push({ file: legacyFile, label: "legacy-electron" });
    }
  }
  return candidates;
}

async function readRuntimeJsonCandidate(candidate, { quiet = false } = {}) {
  try {
    const raw = await readFile(candidate.file, "utf8");
    if (!raw.trim()) throw new Error("empty runtime file");
    return {
      ...candidate,
      parsed: JSON.parse(raw),
      bytes: Buffer.byteLength(raw, "utf8"),
    };
  } catch (error) {
    if (!quiet && candidate.label === "primary") {
      process.stderr.write(
        `[runtime] primary runtime unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return null;
  }
}

async function readFirstValidRuntimeSource(options = {}) {
  const { requireCollections = false } = options;
  for (const candidate of runtimeRecoveryCandidates(options)) {
    const source = await readRuntimeJsonCandidate(candidate, { quiet: candidate.label !== "primary" });
    if (!source) continue;
    if (requireCollections && !hasRuntimeCollections(source.parsed)) continue;
    return source;
  }
  return null;
}

async function writeRuntimeSnapshot(normalized, { backupSource } = {}) {
  await mkdir(DATA_DIR, { recursive: true });

  if (backupSource && hasRuntimeCollections(backupSource)) {
    const backup = normalizeRuntime(backupSource);
    await atomicWriteJson(RUNTIME_BACKUP_FILE, `${JSON.stringify(backup, null, 2)}\n`);
  }

  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  await atomicWriteJson(RUNTIME_FILE, content);
  await atomicWriteJson(RUNTIME_LAST_GOOD_FILE, content);
}

export async function readRuntime() {
  let source = await readFirstValidRuntimeSource();
  if (source && isTriviallyEmptyRuntime(source.parsed)) {
    const recovery = await readFirstValidRuntimeSource({ skipPrimary: true, requireCollections: true });
    if (recovery) {
      const counts = runtimeCollections(recovery.parsed);
      process.stderr.write(
        `[runtime] primary runtime was empty; restored from ${recovery.label} (${counts.accounts} accounts, ${counts.projects} projects).\n`,
      );
      source = recovery;
    }
  }
  if (!source) return clone(DEFAULT_RUNTIME);

  let normalized;
  try {
    normalized = normalizeRuntime(source.parsed);
  } catch (error) {
    process.stderr.write(`[runtime] normalize failed: ${error instanceof Error ? error.message : String(error)}\n`);
    normalized = {
      version: 1,
      accounts: Array.isArray(source.parsed?.accounts) ? source.parsed.accounts : [],
      projects: Array.isArray(source.parsed?.projects) ? source.parsed.projects : [],
      activeRun: source.parsed?.activeRun || null,
      activeRuns: Array.isArray(source.parsed?.activeRuns) ? source.parsed.activeRuns : [],
      runHistory: Array.isArray(source.parsed?.runHistory) ? source.parsed.runHistory : [],
      pendingRuns: Array.isArray(source.parsed?.pendingRuns) ? source.parsed.pendingRuns : [],
      settings: source.parsed?.settings || {},
    };
  }

  // 디스크의 live 가 비어 있지만 백업에는 데이터가 있으면 자동 복구. 백업 또한
  // 깨졌을 가능성을 감안해 best-effort 로만 시도하고 본 흐름은 그대로 유지.
  if (
    (!Array.isArray(normalized.accounts) || normalized.accounts.length === 0)
    && (!Array.isArray(normalized.projects) || normalized.projects.length === 0)
  ) {
    try {
      const bakRaw = await readFile(`${RUNTIME_FILE}.bak`, "utf8");
      const bakParsed = JSON.parse(bakRaw);
      const bakAccounts = Array.isArray(bakParsed?.accounts) ? bakParsed.accounts : [];
      const bakProjects = Array.isArray(bakParsed?.projects) ? bakParsed.projects : [];
      if (bakAccounts.length > 0 || bakProjects.length > 0) {
        process.stderr.write(
          `[runtime] live 가 비어 있어 백업에서 자동 복구 (${bakAccounts.length} accounts, ${bakProjects.length} projects).\n`,
        );
        normalized = normalizeRuntime({ ...bakParsed, ...normalized, accounts: bakAccounts, projects: bakProjects });
      }
    } catch {
      // 백업도 못 읽으면 그냥 빈 상태 유지.
    }
  }

  try {
    const reconciled = await reconcileStaleActiveRun(normalized);
    normalized = reconciled.runtime;
    if (reconciled.changed || source.file !== RUNTIME_FILE) {
      await writeRuntimeSnapshot(normalized, { backupSource: source.parsed });
    }
    return await enrichRuntime(normalized);
  } catch (error) {
    process.stderr.write(`[runtime] enrich failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return normalized;
  }
}

async function readDiskRuntimeRaw() {
  const source = await readFirstValidRuntimeSource({ requireCollections: true })
    || await readFirstValidRuntimeSource();
  return source?.parsed || null;
}

// 같은 프로세스 안에서 writeRuntime 두 개가 동시에 await 사이에 끼면 두 호출이
// 각자 fd 를 열어 같은 파일에 비-truncating 으로 덮어쓰기 시작. 짧은 쓰기 위에
// 긴 쓰기의 꼬리가 남아 .bak 가 손상되고 → 다음 사이클의 safety net 우회 →
// 빈 accounts/projects 가 그대로 live 로 persist 되는 데이터 소실 회귀. 직렬화로 차단.
let runtimeWriteLock = Promise.resolve();
function withRuntimeLock(fn) {
  const next = runtimeWriteLock.then(() => fn(), () => fn());
  // chain 으로 직렬화하되 실패도 다음 호출을 막지 않도록 .then 의 두 번째 인자 사용.
  runtimeWriteLock = next.catch(() => undefined);
  return next;
}

// writeFile 은 truncate-then-write 이지만 두 writer 가 동시에 들어가면 결과 파일 길이가
// 짧은 쪽이 되어도 더 긴 쓰기의 꼬리가 남는 OS 동작이 발생 가능. temp 파일에 다 쓰고
// rename 으로 교체하면 같은 inode 를 두 writer 가 만지지 않아 race 차단 + 부분 쓰기로
// 인한 corrupt 도 동시에 해결.
async function atomicWriteJson(targetPath, content) {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmpPath, content, "utf8");
  try {
    await rename(tmpPath, targetPath);
  } catch (error) {
    // rename 실패 시 tmp 정리 후 에러 전파.
    try { await unlink(tmpPath); } catch { /* ignore */ }
    throw error;
  }
}

export async function writeRuntime(runtime) {
  return withRuntimeLock(async () => {
    const normalized = normalizeRuntime(runtime);

    // Safety net: 디스크에 데이터가 있는데 호출자가 빈 배열로 덮어쓰려는 시도는 차단.
    // accounts 뿐 아니라 projects 도 같이 보호 (이전엔 accounts 만 보호해 projects 가
    // 회귀로 날아가는 케이스가 있었음).
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
    if (
      onDisk
      && Array.isArray(onDisk.projects)
      && onDisk.projects.length > 0
      && normalized.projects.length === 0
    ) {
      process.stderr.write(
        `[runtime] writeRuntime would have wiped ${onDisk.projects.length} projects; restoring from disk.\n`,
      );
      normalized.projects = onDisk.projects.map(normalizeProject);
    }

    await mkdir(DATA_DIR, { recursive: true });

    // Store a backup only from a valid persisted runtime. A zero-byte or
    // unparsable primary must never replace the last usable backup.
    try {
      if (onDisk && hasRuntimeCollections(onDisk)) {
        const backup = normalizeRuntime(onDisk);
        await atomicWriteJson(RUNTIME_BACKUP_FILE, `${JSON.stringify(backup, null, 2)}\n`);
      }
    } catch {
      // 첫 쓰기라 live 파일이 아직 없을 수 있음 — 그 경우 backup 불필요.
    }

    await atomicWriteJson(RUNTIME_FILE, `${JSON.stringify(normalized, null, 2)}\n`);
    await atomicWriteJson(RUNTIME_LAST_GOOD_FILE, `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  });
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
  // 균등 분배 (오래 안 쓴 계정 우선) + 모델 품질만 사용. 도메인 우선은 점수
  // 보너스 (+500) 가 아니라 selectRoute 의 1차 후보 필터로 처리한다. 그래야
  // 보너스가 다른 가중치를 압도해 사용자에게 표시되는 추천 모델과 실제 라우팅
  // 결과가 어긋나는 일을 막을 수 있다.
  if (complexity === "routine") {
    return loadBalance * 40 - modelRank;
  }
  if (complexity === "standard") {
    return loadBalance * 30 + modelRank * 8;
  }
  return loadBalance * 20 + modelRank * 20;
}

function accountMatchesDomain(account, domain) {
  const normalizedDomain = String(domain || "").trim().toLowerCase().replace(/^@/, "");
  if (!normalizedDomain) return false;
  return [account?.actualAuthEmail, account?.email]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .some((email) => email.endsWith(`@${normalizedDomain}`));
}

export function ensureMaintenancePromptPrefix(promptText, account, domain) {
  const text = String(promptText || "").trim();
  if (!text || !accountMatchesDomain(account, domain)) return text;
  if (text.startsWith(MAINTENANCE_PROMPT_PREFIX)) return text;

  const body = text.replace(
    /^\[\s*(?:오류|에러)\s*(?:분석|진단|디버그|디버깅|수정)\s*\]\s*/i,
    "",
  ).trim();
  return body ? `${MAINTENANCE_PROMPT_PREFIX} ${body}` : MAINTENANCE_PROMPT_PREFIX;
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
  // 정책 거절 retry 등에서 특정 provider 를 후보에서 빼고 싶을 때 사용. 같은 vendor 의
  // 다른 계정에도 동일한 조직 정책이 적용될 가능성이 높으므로 cross-provider 우선 시도용.
  const excludeProviders = Array.isArray(request.excludeProviders)
    ? request.excludeProviders.map((p) => String(p || "").toLowerCase()).filter(Boolean)
    : [];
  // 실패한 특정 계정을 retry 후보에서 명시적으로 제외. quota lockout 이 race 로 아직
  // 적용 안 됐을 때를 위한 안전망.
  const excludeAccountIds = Array.isArray(request.excludeAccountIds)
    ? request.excludeAccountIds.map((id) => String(id || "").toLowerCase()).filter(Boolean)
    : [];
  const preferAccountDomain = String(request.preferAccountDomain || "").toLowerCase();
  const enabledAccounts = accounts
    .filter((account) => account.enabled !== false)
    .filter((account) => !preferredProvider || account.provider === preferredProvider)
    .filter((account) => excludeProviders.length === 0 || !excludeProviders.includes(String(account.provider || "").toLowerCase()))
    .filter((account) => excludeAccountIds.length === 0 || !excludeAccountIds.includes(String(account.id || "").toLowerCase()));
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
  const allCandidates = providerAccounts
    .map((account) => ({ account, profile: account.modelProfiles?.[complexity] }))
    .filter((candidate) => candidate.profile);

  // 도메인 우선 — preferAccountDomain 이 지정되면 그 도메인 계정만 1차 후보로
  // 좁힌다. 점수 보너스(+500)로 처리하던 방식은 다른 가중치를 압도해 UI 표시
  // 모델과 실제 라우팅 결과가 어긋날 수 있었기에, 명시적 1차 필터로 전환.
  // 도메인 계정이 하나도 없으면 자동으로 전체 풀로 폴백한다.
  const domainCandidates = preferAccountDomain
    ? allCandidates.filter((c) => accountMatchesDomain(c.account, preferAccountDomain))
    : [];
  const usingDomainFilter = domainCandidates.length > 0;
  const candidates = (usingDomainFilter ? domainCandidates : allCandidates)
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
  // 도메인 필터 적용 여부를 사용자에게 노출 — UI 일관성. 회사 도메인 우선
  // 분류가 동작한 경우와, 후보 부재로 일반 풀로 폴백된 경우를 구분해서 보여
  // 준다.
  let domainNote = "";
  if (preferAccountDomain) {
    if (usingDomainFilter) {
      domainNote = ` (유지보수 작업 분류 — ${preferAccountDomain} 도메인 계정 우선)`;
    } else {
      domainNote = ` (유지보수 작업 분류였으나 ${preferAccountDomain} 도메인 후보 없어 일반 풀로 폴백)`;
    }
  }
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
    domainPreferred: Boolean(usingDomainFilter),
    preferAccountDomain,
    reason:
      (complexity === "routine"
        ? "단순 작업이므로 남은 사용량이 충분한 가장 효율적인 프로필을 선택했습니다."
        : "품질 우선 기준으로 남은 사용량이 충분한 가장 강한 프로필을 선택했습니다.") + mismatchNote + domainNote,
  };
}

function dashboardRunState(run, status, reason) {
  const now = new Date().toISOString();
  const validationResult = run.validation?.status === "passed" ? "passed" : run.validation?.status === "failed" ? "failed" : run.validation?.status === "running" ? "partial" : "not_run";
  const interruptedWorktree = run.interruptedWorktree || null;
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
    interrupted_worktree: interruptedWorktree,
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
      branch: interruptedWorktree?.branch || "main",
      commit: "not_created",
      pushed: false,
      dirty: Boolean(interruptedWorktree?.dirty),
      dirty_files: interruptedWorktree?.files || [],
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
  const dirtyFiles = state.interrupted_worktree?.dirty
    ? `\n## 중단된 변경 파일\n\n- 작업 경로: ${state.interrupted_worktree.path}\n- 변경 파일: ${state.interrupted_worktree.fileCount}개\n\n\`\`\`text\n${state.interrupted_worktree.statusText || state.interrupted_worktree.files.join("\n")}\n\`\`\`\n`
    : "";
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
${dirtyFiles}
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

  // activeRuns 배열에서 해당 run 찾아 갱신. clearActive 시 배열에서 제거 + history 로 이동.
  const activeRuns = Array.isArray(runtime.activeRuns) ? [...runtime.activeRuns] : [];
  const idxInActive = activeRuns.findIndex((r) => r && r.id === runId);
  if (idxInActive >= 0) {
    const updated = buildNext(activeRuns[idxInActive]);
    if (options.clearActive) {
      activeRuns.splice(idxInActive, 1);
      // history 에 보존 — 아래 runHistory.map 이 처리하지 못하는 신규 항목이면 prepend.
      if (!runtime.runHistory.some((item) => item.id === runId)) {
        runtime.runHistory = [updated, ...runtime.runHistory].slice(0, 20);
      }
    } else {
      activeRuns[idxInActive] = updated;
    }
  }
  runtime.activeRuns = activeRuns;
  // legacy alias 동기화 — 같은 run 이면 같이 갱신, clearActive 면 다음 후보로.
  if (runtime.activeRun?.id === runId) {
    runtime.activeRun = options.clearActive ? activeRuns[0] || null : nextRun || runtime.activeRun;
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
    runtime.activeRuns = runtime.activeRuns.map((item) => (item && item.id === runId ? nextRun : item));
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
    fallback: /(you'?ve hit your (?:limit|weekly limit|daily limit|usage)|hit your (?:limit|weekly|daily)|usage limit (?:reached|hit)|weekly limit (?:reached|hit))/i,
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
    hint: /(rate[_\s-]?limit(?:ed|[_\s-]?(?:exceeded|reached))|rate_limit_exceeded|429|too many requests|you'?ve (?:used|reached) .*limit|usage limit|out of (?:credit|quota)|insufficient_quota|quota.*exceeded|retry.after|resets? in)/i,
    fallback: /(rate[_\s-]?limit(?:ed|[_\s-]?(?:exceeded|reached))|rate_limit_exceeded|429|too many requests|you'?ve (?:used|reached) .*limit|usage limit|out of (?:credit|quota)|insufficient_quota|quota.*exceeded)/i,
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
    fallback: /(resource[_\s]exhausted|quota exceeded|exceeded your quota|429|rate[_\s-]?limit(?:ed|[_\s-]?(?:exceeded|reached))|quota metric)/i,
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
    fallback: /(usage limit|quota.*exceeded|too many requests|429|monthly limit|used all|tier limit)/i,
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
      if (providerEntry.fallback?.test(rawLine)) {
        return new Date(Date.now() + 60 * 60 * 1000).toISOString();
      }
      return null;
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
      account.modelProfiles?.routine?.model || "gpt-5.4-mini",
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
      if (/(quota.*(?:exceeded|reached)|rate[_\s-]?limit(?:ed|[_\s-]?(?:exceeded|reached))|rate_limit_exceeded|too many requests|usage limit|429|hit your (?:usage|limit)|exceeded your quota|insufficient_quota)/i.test(combined)) {
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
  // 작업 종료 알림 — 사용자가 dashboard 백그라운드일 때 OS/모바일로 알린다.
  // 완료/한도도달/정책거절/실패 모두 사용자가 알아야 다음 액션 결정.
  try {
    const finishedStatus = String(patch?.status || "").toLowerCase();
    const finishedRun = result.runHistory?.find((item) => item.id === runId);
    const projectIdForNotif = finishedRun?.projectId || "";
    const shortPrompt = String(finishedRun?.prompt || "").replace(/\[[^\]]*\]/g, "").trim().slice(0, 80);
    if (finishedStatus === "completed") {
      await pushNotification({
        kind: "completed",
        title: "AgentApp — 작업 완료",
        message: shortPrompt ? `[${projectIdForNotif}] ${shortPrompt}` : `[${projectIdForNotif}] 작업이 완료됐습니다.`,
        runId, projectId: projectIdForNotif,
      });
    } else if (finishedStatus === "quota_limited") {
      await pushNotification({
        kind: "blocked",
        title: "AgentApp — 한도 도달",
        message: `[${projectIdForNotif}] 사용량 한도로 작업이 중단됐습니다. 다른 계정 준비 또는 reset 시각 대기.`,
        runId, projectId: projectIdForNotif,
      });
    } else if (finishedStatus === "policy_blocked") {
      await pushNotification({
        kind: "blocked",
        title: "AgentApp — 정책 거절",
        message: `[${projectIdForNotif}] 조직 정책으로 작업 거절. 다른 provider 로 자동 재시도 중이거나 사용자 결정 필요.`,
        runId, projectId: projectIdForNotif,
      });
    } else if (finishedStatus === "failed") {
      await pushNotification({
        kind: "error",
        title: "AgentApp — 작업 실패",
        message: `[${projectIdForNotif}] ${shortPrompt || "작업"} 이 실패했습니다.`,
        runId, projectId: projectIdForNotif,
      });
    }
  } catch {
    /* best-effort */
  }
  return result;
}

// 이벤트 알림 — 작업 완료 / 사용자 답변 대기 / 큐 대기 등 사용자가 알아야 할
// 상태 변경을 한 곳에서 발사. runtime.notifications 배열에 push (UI polling
// 으로 toast 표시) + settings.notifyWebhookUrl 로 외부 발송 (모바일 ntfy/Discord/
// Slack). main.mjs 의 polling 으로 OS Notification 까지 띄운다.
//
// kind: "completed" | "awaiting" | "pending" | "blocked" | "error" | "info"
// title/message: 사람용 짧은 텍스트
// runId/projectId: 클릭 시 컨텍스트 복원에 사용
export async function pushNotification({
  kind = "info",
  title = "",
  message = "",
  runId = "",
  projectId = "",
} = {}) {
  if (!title && !message) return;
  const runtime = await readRuntime();
  const settings = normalizeSettings(runtime.settings);
  if (!settings.notifyEnabled) return;
  const entry = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: String(kind || "info"),
    title: String(title || "").slice(0, 200),
    message: String(message || "").slice(0, 800),
    runId: String(runId || ""),
    projectId: String(projectId || ""),
    at: Date.now(),
    delivered: false,
  };
  const prev = Array.isArray(runtime.notifications) ? runtime.notifications : [];
  runtime.notifications = [entry, ...prev].slice(0, 40);
  await writeRuntime(runtime);

  // 외부 webhook — 본인이 등록한 ntfy/Discord/Slack 같은 푸시 채널.
  // ntfy.sh: plain text body + Title 헤더로 충분 (priority=high 면 잠금화면 푸시).
  // Discord webhook: { content } JSON, Slack incoming webhook: { text } JSON.
  // URL 호스트로 자동 분기.
  if (settings.notifyWebhookUrl) {
    try {
      const url = settings.notifyWebhookUrl;
      const isNtfy = /ntfy\.(sh|io)/i.test(url);
      const isDiscord = /discord\.com\/api\/webhooks/i.test(url);
      const headers = { "Content-Type": "application/json" };
      let body;
      if (isNtfy) {
        body = `${entry.title}\n\n${entry.message}`;
        headers["Content-Type"] = "text/plain; charset=utf-8";
        headers["Title"] = encodeNtfyHeader(entry.title);
        headers["Priority"] = kind === "awaiting" || kind === "blocked" || kind === "error" ? "high" : "default";
        headers["Tags"] = kind === "completed" ? "white_check_mark"
          : kind === "awaiting" ? "question"
          : kind === "blocked" ? "no_entry"
          : kind === "error" ? "warning"
          : "bell";
      } else if (isDiscord) {
        body = JSON.stringify({ content: `**[${kind}] ${entry.title}**\n${entry.message}` });
      } else {
        // Slack incoming webhook 또는 일반 JSON 호환
        body = JSON.stringify({ text: `*[${kind}] ${entry.title}*\n${entry.message}` });
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      await fetch(url, { method: "POST", body, headers, signal: controller.signal })
        .catch(() => { /* webhook 실패는 silent */ })
        .finally(() => clearTimeout(timeout));
    } catch {
      /* best-effort */
    }
  }
}

// ntfy 의 Title 헤더는 ISO-8859-1 만 허용. 한글 등 비ASCII 가 들어가면 invalid.
// RFC 8187 형식 (UTF-8 base64) 으로 인코딩하거나 ASCII 만 남기는 게 안전.
// 간단히 ASCII 외 문자를 ? 로 치환하고, 더 정확한 표시는 body 에 맡긴다.
function encodeNtfyHeader(text) {
  return String(text || "").replace(/[^\x20-\x7E]/g, "?").slice(0, 200);
}

// 사용자가 알림을 읽었거나 dismiss 할 때 호출 — 배열에서 제거.
export async function dismissNotification(input = {}) {
  const id = String(input?.id || "").trim();
  if (!id) return readRuntime();
  const runtime = await readRuntime();
  const before = Array.isArray(runtime.notifications) ? runtime.notifications : [];
  runtime.notifications = before.filter((n) => n?.id !== id);
  return writeRuntime(runtime);
}

// 한 번에 모두 제거 (사용자가 "모두 읽음" 누르거나, UI 가 일정 시간 지난 항목 정리).
export async function clearNotifications() {
  const runtime = await readRuntime();
  runtime.notifications = [];
  return writeRuntime(runtime);
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

// 사용자가 "닫기" 로 awaiting 패널을 무시할 때 — run 의 awaitingUserInput 플래그만
// 해제. 답변 새 run spawn 없이 history 보존. 사용자 환경의 옛 runtime 데이터에
// awaitingUserInput 마킹이 없어도, UI fallback 이 detect 한 상태를 dismiss 하려면
// run 에 dismissedByUser=true 플래그를 남기는 식으로 처리한다.
export async function dismissAwaitingRun(input = {}) {
  const runId = String(input?.runId || input?.id || "").trim();
  if (!runId) return readRuntime();
  try {
    return await patchRunRecord(runId, {
      awaitingUserInput: false,
      awaitingDismissedAt: nowIso(),
    });
  } catch {
    return readRuntime();
  }
}

// awaitingUserInput 으로 멈춘 run 에 사용자가 답변을 적어 이어 진행할 때.
// 같은 worker / 같은 projectId / 같은 계정으로 새 startRun 을 발사하고,
// 원래 run 의 awaitingUserInput 플래그를 해제 (한 번만 답변 받게).
export async function resumeRunWithUserInput(input = {}) {
  const runId = String(input?.runId || input?.id || "").trim();
  const userText = String(input?.prompt || input?.userInput || "").trim();
  if (!runId || !userText) {
    return readRuntime();
  }
  const runtime = await readRuntime();
  const stoppedRun = (runtime.runHistory || []).find((r) => r?.id === runId);
  if (!stoppedRun) return runtime;
  // 답변 prompt — 사용자 입력 + 직전 worker 가 남긴 마지막 메시지를 컨텍스트로 묶어
  // 같은 worker 가 이어서 진행하게 한다.
  const lastHint = String(stoppedRun.awaitingPromptHint || stoppedRun.adapter?.lastMessageText || "").trim();
  const contextNote = lastHint
    ? `\n\n[직전 worker 가 멈추며 남긴 메시지 — 답변 컨텍스트]\n${lastHint.slice(-1500)}`
    : "";
  const resumePrompt = `[사용자 답변]\n${userText}${contextNote}\n\n위 답변으로 이전 작업을 이어서 진행하세요.`;
  // 원래 run 의 awaitingUserInput 플래그 해제 (중복 답변 방지).
  try {
    await patchRunRecord(runId, { awaitingUserInput: false });
  } catch {
    /* best-effort */
  }
  return startRun({
    workerId: stoppedRun.workerAuto ? "auto" : (stoppedRun.workerId || "auto"),
    projectId: stoppedRun.projectId,
    prompt: resumePrompt,
    complexity: stoppedRun.complexity || "auto",
    modelOverride: stoppedRun.modelOverride || "auto",
    handoffFrom: stoppedRun.routing?.accountId || "",
  });
}

// 사용자가 대기 큐의 항목을 더 이상 원하지 않을 때 호출. id 일치 항목만 제거.
// 일치 항목이 없어도 silent (no-op) — UI 더블 클릭 등으로 같은 요청이 두 번 와도 안전.
export async function cancelPendingRun(input = {}) {
  const id = String(input?.id || input?.pendingId || "").trim();
  if (!id) return readRuntime();
  const runtime = await readRuntime();
  const before = Array.isArray(runtime.pendingRuns) ? runtime.pendingRuns : [];
  runtime.pendingRuns = before.filter((item) => item?.id !== id);
  return writeRuntime(runtime);
}

// 대기 큐 항목을 다시 startRun 으로 시도. 준비된 계정이 있으면 즉시 running,
// 없으면 새 pending 으로 다시 들어간다. 사용자가 "지금 다시 시도" 라고 누를 때.
export async function retryPendingRun(input = {}) {
  const id = String(input?.id || input?.pendingId || "").trim();
  if (!id) return readRuntime();
  const runtime = await readRuntime();
  const pending = (runtime.pendingRuns || []).find((item) => item?.id === id);
  if (!pending) return runtime;
  // 기존 entry 는 빼고 startRun 으로 재시도. startRun 이 같은 pendingId 를 받으면
  // 안에서 자동으로 entry 정리 — pendingId 를 그대로 넘긴다.
  return startRun({
    workerId: pending.workerId,
    projectId: pending.projectId,
    prompt: pending.prompt,
    complexity: pending.complexity,
    modelOverride: pending.modelOverride,
    pendingId: id,
  });
}

function pendingMatchesAccount(pending, account) {
  if (!pending || !account) return false;
  const provider = pending.provider || providerForWorker(pending.workerId);
  if (!provider || pending.workerAuto || pending.workerId === "auto") return true;
  return provider === account.provider;
}

// 같은 account 에 대해 dispatchPendingForAccount 가 동시에 호출돼도
// 한 pending 이 두 번 dispatch 되지 않도록 in-memory 직렬화.
// detectAndUpdateAccount + setAccountSession + login 완료 콜백 등에서
// 같은 시점에 ready 로 바뀌면 race 발생할 수 있음.
const DISPATCH_LOCKS = new Set();

export async function dispatchPendingForAccount(accountId) {
  const lockKey = String(accountId || "");
  if (DISPATCH_LOCKS.has(lockKey)) {
    return { runtime: await readRuntime(), dispatched: 0, skipped: "concurrent_dispatch" };
  }
  DISPATCH_LOCKS.add(lockKey);
  try {
    const runtime = await readRuntime();
    const account = runtime.accounts.find((item) => item.id === accountId);
    if (!account || account.enabled === false || account.sessionStatus !== "ready" || activeQuotaLock(account)) {
      return { runtime, dispatched: 0 };
    }
    // 이미 실행 중인 run 이 있으면 dispatch 하지 않는다. 사용자 입장에서
    // "백그라운드에서 여러 개가 동시에 도는" 문제의 직접 원인.
    if (runtime.activeRun && runtime.activeRun.status === "running") {
      return { runtime, dispatched: 0, skipped: "active_run_present" };
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
  } finally {
    DISPATCH_LOCKS.delete(lockKey);
  }
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
    // routeReadyAccount() 를 통과하지 못한 계정은 후보에서 제외한다. 한도 잠금/
    // 인증 계정 불일치 계정으로 이어받으면 곧바로 quota_limited 또는 needs-login
    // 으로 다시 떨어져 retry 폭주를 유발한다.
    const candidates = runtime.accounts
      .filter((account) =>
        account.enabled !== false
        && account.sessionStatus === "ready"
        && account.id !== fromId
        && routeReadyAccount(account),
      )
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

// 한도 도달한 run 을 다른 ready 계정으로 자동 재시도. 같은 provider 의 다른
// 계정 → 다른 provider 의 ready 계정 순으로 후보를 넓힌다. 사용자가 worker
// 를 명시했더라도, 그 worker provider 가 통째로 잠겼다면 다른 provider 로
// 넘어가는 게 사용자 의도(작업 자체를 끊지 않기)에 더 가깝다.
//
// 카운터 의도: `retryCount` 는 quota/policy retry 가 공유하는 전체 cascade
// 카운터다. 따라서 정책 거절 retry 가 먼저 1 회 발동한 뒤 quota 도달이
// 이어지면 quota retry 는 `quotaRetryMaxAttempts - 1` 만큼만 추가 시도된다.
// 이는 의도된 cascade 폭주 방지(정책+한도 연쇄 발동 시 무한 retry 차단)
// 효과이며, 일반적인 quota retry 단독 발동 시 max attempts 까지 정상 시도된다.
export async function tryQuotaRetry(failedRun) {
  const runtime = await readRuntime();
  const settings = normalizeSettings(runtime.settings);
  if (!settings.quotaRetryEnabled) return null;
  if (chainCancelled(runtime, failedRun)) return null;
  // attempts = "다음 시도 번호" — 정책 retry 가 이미 retryCount 를 1 올린
  // 상태라면 이 값이 2 부터 시작. quotaRetryMaxAttempts 기본값 2 와 비교
  // 해서 정책+한도 연쇄 cascade 의 총 retry 횟수를 제한한다.
  const attempts = Number(failedRun.retryCount || 0) + 1;
  if (attempts > settings.quotaRetryMaxAttempts) return null;
  const failedAccountId = String(failedRun.routing?.accountId || "");
  const originalWorkerId = failedRun.workerId;

  // 1) 같은 worker (provider) 안에서 다른 ready 계정 시도.
  let routing = selectRoute(runtime.accounts, {
    workerId: originalWorkerId,
    complexity: failedRun.complexity || "standard",
    modelOverride: failedRun.modelOverride || "auto",
  });
  let resolvedWorker = originalWorkerId;

  // 같은 계정으로 다시 라우팅되는 건 의미 없다 (이미 잠긴 상태라 selectRoute
  // 에서 걸러져야 하지만, 클럭/타이밍 안전망으로 한 번 더 가드).
  if (routing.status === "recommended" && routing.accountId === failedAccountId) {
    routing = { status: "blocked", reason: "same-account-skip" };
  }

  // 2) 같은 provider 에 후보 없으면 → 모든 provider 의 ready 계정으로 확대.
  //    이때 worker 도 routing 결과의 provider 에 맞춰 자동 매핑한다.
  if (routing.status !== "recommended") {
    routing = selectRoute(runtime.accounts, {
      workerId: "auto",
      complexity: failedRun.complexity || "standard",
      modelOverride: failedRun.modelOverride || "auto",
    });
    if (routing.status === "recommended" && routing.accountId !== failedAccountId) {
      resolvedWorker = workerForProvider(routing.provider) || "auto";
    } else {
      return null;
    }
  }

  const result = await startRun({
    workerId: resolvedWorker,
    projectId: failedRun.projectId,
    prompt: failedRun.prompt,
    complexity: failedRun.complexity || "auto",
    modelOverride: failedRun.modelOverride || "auto",
    retryCount: attempts,
    retryReason: `quota_exhausted_attempt_${attempts}_to_${routing.provider}`,
    // quota retry 후속 run 에서는 autoChain 을 끈다. retry 가 또 chain 을 타고
    // 다시 quota 를 만나는 곱셈 폭주 (max 3 retry × max 8 chain = 최대 24 회
    // 추가 spawn) 를 방지. 사용자는 "한도 도달 → 다른 계정으로 같은 작업 1 회만
    // 더 시도" 를 기대.
    autoChain: false,
  });
  return result.activeRun || null;
}

// run 이 completed 로 끝났을 때 autoChain 설정이 켜져 있으면 NEXT_TASK 를 자동으로 픽업해서
// 같은 worker/project 로 다음 run 시작. 외부 프로젝트는 그 프로젝트의 NEXT_TASK, AgentApp 자체는 repo 의 NEXT_TASK.
//
// opts.chainDoneSignaled: worker 의 마지막 줄이 'CHAIN_DONE' 이었으면 true.
// 단, 신호가 있어도 진행률이 100% 가 아니거나 NEXT_TASK 에 실제 항목이 남아
// 있으면 한 단계만 끝낸 오판으로 보고 override 해서 이어 진행한다. 무한
// override 를 막기 위해 chainDoneOverrides 횟수를 cap.
// override 모드를 사용자가 켰을 때도 1 회만 허용. 같은 prompt 를 두 번 우긴
// 다음에도 worker 가 또 CHAIN_DONE 을 보내면 그 시점에서는 사용자 판단이
// 필요하다.
// 사용자가 "최대한 멈추지 말고 끈질기게" 를 원해 3 회까지 override 허용. 그 이상은
// 분명히 무한 루프이거나 worker 가 같은 결론을 반복하는 상태이므로 종료.
const CHAIN_DONE_OVERRIDE_CAP = 3;

// worker 가 작업을 끝낼 때 응답 끝에 붙이는 마커. dashboard 는 이 마커를
// 파싱해서 autoChain 의 다음 prompt 를 만든다. 기존 CHAIN_DONE / NEXT_TASK.md
// 흐름과 병행한다 (마커 우선).
//
//   [NEXT_STEPS]
//   - title: <간결한 작업 제목>
//     priority: P0|P1|P2
//     notes: <한 줄 설명>
//   - title: ...
//   [/NEXT_STEPS]
//
// 다음 작업이 정말 없을 때:
//   [NEXT_NONE] <이유>
const STATUS_MARKER_RULE =
  "\n\n[STATUS 규칙] 단계마다 한 줄로 `[STATUS] <지금 하고 있는 일>` 을 출력하세요. dashboard 가 이 라인을 현재 작업으로 표면화합니다. 예) `[STATUS] 모델 라우팅 코드 리팩토링 중`.";
const CHAIN_DONE_PROMPT_RULE =
  "\n\n[CHAIN_DONE 규칙] CHAIN_DONE 은 roadmap/plan 의 **모든** 작업이 끝나고 진행률이 100% 일 때만, 다른 텍스트 없이 단독 한 줄로 보냅니다. 방금 한 단계만 끝낸 것이라면 절대 CHAIN_DONE 을 보내지 말고, memory/plan/NEXT_TASK 의 다음 항목을 스스로 골라 계속 진행하세요. 코드·설명과 같은 응답에 CHAIN_DONE 을 섞으면 무시됩니다.";
const NEXT_STEPS_RULE =
  "\n\n[NEXT_STEPS 규칙] 응답의 **맨 마지막**에 다음 작업 후보를 한 블록으로 출력합니다.\n" +
  "\n다음 작업이 있다면:\n" +
  "[NEXT_STEPS]\n" +
  "- title: <간결한 작업 제목>\n" +
  "  priority: P0|P1|P2  (P0=최우선)\n" +
  "  notes: <한 줄 설명 / 왜 필요한지>\n" +
  "- title: <다음 후보>\n" +
  "  priority: P1\n" +
  "  notes: ...\n" +
  "[/NEXT_STEPS]\n" +
  "\n다음 작업이 정말 없다면 (roadmap 완료 / 사용자 결정 대기 / 자율 진행 불가):\n" +
  "[NEXT_NONE] <이유 한 줄>\n" +
  "\ndashboard 가 이 마커를 파싱해 다음 자동 진행 prompt 를 만듭니다. NEXT_NONE 은 CHAIN_DONE 과 동등하게 즉시 종료를 의미하며, NEXT_STEPS 의 P0 항목이 다음 prompt 로 사용됩니다.";

const WORKER_PROMPT_RULES_MARKER = "[NEXT_STEPS 규칙]";

// 이미 worker prompt 규칙이 첨부된 prompt 인지 확인 — autoChain/retry/handoff
// 경로에서 prompt 가 재사용될 때 규칙이 중복 첨부되는 것을 막는다.
export function decorateAutoChainPrompt(prompt) {
  const text = String(prompt || "");
  if (text.includes(WORKER_PROMPT_RULES_MARKER)) return text;
  return text + STATUS_MARKER_RULE + CHAIN_DONE_PROMPT_RULE + NEXT_STEPS_RULE;
}

// worker 응답에서 NEXT_STEPS / NEXT_NONE 마커를 파싱.
// 반환:
//   { done: true, reason }                 — NEXT_NONE 마커 검출
//   { done: false, steps: [{title, priority, notes}, ...] } — NEXT_STEPS 블록
//   { done: false, steps: [] }             — 마커 없음 (기존 폴백 흐름으로)
export function parseNextSteps(text) {
  const source = String(text || "");
  // NEXT_NONE 우선 — 명시적 종료 신호
  const noneMatch = source.match(/\[NEXT_NONE\]\s*([^\n]*)/);
  if (noneMatch) {
    return { done: true, reason: noneMatch[1].trim() || "다음 작업 없음" };
  }
  const blockMatch = source.match(/\[NEXT_STEPS\]([\s\S]*?)\[\/NEXT_STEPS\]/);
  if (!blockMatch) return { done: false, steps: [] };
  const block = blockMatch[1];
  // 각 항목은 "- title: ..." 으로 시작. priority/notes 는 같은 항목 안에서
  // 들여쓰기된 라인. 다음 "- title:" 또는 블록 끝까지가 한 항목.
  const items = [];
  const itemRegex = /(^|\n)\s*-\s*title:\s*([^\n]+)([\s\S]*?)(?=(?:\n\s*-\s*title:)|$)/g;
  let match;
  while ((match = itemRegex.exec(block)) !== null) {
    const title = String(match[2] || "").trim();
    if (!title) continue;
    const rest = String(match[3] || "");
    const priorityMatch = rest.match(/priority:\s*(P[0-2])/i);
    const notesMatch = rest.match(/notes:\s*([^\n]+)/);
    items.push({
      title,
      priority: priorityMatch ? priorityMatch[1].toUpperCase() : "P1",
      notes: notesMatch ? notesMatch[1].trim() : "",
    });
  }
  // P0 > P1 > P2 순 정렬 (안정 정렬 — 같은 priority 면 입력 순서 유지)
  const priorityRank = { P0: 0, P1: 1, P2: 2 };
  items.sort((a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1));
  return { done: false, steps: items };
}

export async function tryAutoChain(prevRun, opts = {}) {
  const runtime = await readRuntime();
  const settings = normalizeSettings(runtime.settings);
  if (!settings.autoChainEnabled) return null;
  // 사용자가 정지를 눌렀거나 이 chain 이 명시적으로 취소된 경우 더 이상 spawn 하지 않는다.
  if (chainCancelled(runtime, prevRun)) {
    return { stopped: true, reason: "사용자가 정지를 눌러 자동 이어 진행을 취소했습니다." };
  }

  // 무한 루프 방지: 같은 체인에서 너무 많이 반복되지 않도록 제한.
  const prevDepth = Number(prevRun.chainDepth || 0);
  if (prevDepth >= settings.autoChainMaxDepth) {
    return { skipped: true, reason: `autoChain max depth ${settings.autoChainMaxDepth} 도달` };
  }

  // 외부 프로젝트면 그 프로젝트의 next_task + 진행률을, AgentApp 자체는 repo
  // 의 NEXT_TASK + roadmap phases 진행률을 읽는다.
  let nextTitle = "";
  let progressPercent = null;
  try {
    if (prevRun.projectId && prevRun.projectId !== "current") {
      const project = runtime.projects.find((p) => p.id === prevRun.projectId);
      if (project) {
        const meta = await readProjectMeta({ path: project.path });
        nextTitle = meta?.next_task?.title || "";
        progressPercent = Number.isFinite(meta?.progress?.percent) ? meta.progress.percent : null;
      }
    } else {
      const nextTaskPath = path.join(HANDOFF_DIR, "NEXT_TASK.md");
      const body = await readFile(nextTaskPath, "utf8").catch(() => "");
      const match = body.match(/Selected task:\s*(.+)/i);
      nextTitle = match ? match[1].trim() : "";
      try {
        const phases = await readPlanPhases(REPO_ROOT);
        const prog = await computeProgressFromPhases(phases);
        progressPercent = Number.isFinite(prog?.percent) ? prog.percent : null;
      } catch {
        progressPercent = null;
      }
    }
  } catch {
    nextTitle = "";
  }

  // NEXT_TASK 가 비었거나 'none' 이거나, **방금 끝낸 작업과 사실상 동일**하면
  // 일반 '이어 진행' 프롬프트로 폴백. 그래야 worker 가 NEXT_TASK 를 갱신하지
  // 않은 상태에서도 다음 단계로 자율 진행된다. "사실상 동일" 판단은 공백/구두점/
  // 대괄호 태그/대소문자를 정규화한 뒤 비교한다. 예: "DB 마이그레이션" 과 "DB
  // 마이그레이션 진행" 처럼 한 단어 차이로 같은 작업을 spawn 하는 패턴 방지.
  const prevPrompt = String(prevRun.prompt || "").trim();
  const normalizeForCompare = (str) => String(str || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")          // [오류분석] 같은 태그 제거
    .replace(/[\p{P}\p{S}]+/gu, " ")      // 구두점/기호 제거
    .replace(/\s+/g, " ")
    .trim();
  const normalizedPrev = normalizeForCompare(prevPrompt);
  const normalizedNext = normalizeForCompare(nextTitle);
  // 한쪽이 다른 쪽을 포함하면 사실상 동일한 작업으로 간주 (한 단어 추가/축약 차이).
  const sameAsPrev = normalizedNext.length > 0 && (
    normalizedNext === normalizedPrev
    || normalizedPrev.includes(normalizedNext)
    || normalizedNext.includes(normalizedPrev)
  );
  const hasNewTask = nextTitle && !/^none$/i.test(nextTitle) && !sameAsPrev;

  // CHAIN_DONE 안전망 — worker 가 종료 신호를 보냈을 때:
  //   1) 메시지에 "사용자 결정/방향 대기", "DECISIONS_REQUIRED", "actionable item 없음"
  //      류 신호가 있으면 무조건 stop. 사용자 입력이 필요한 상태이므로 토큰 소진
  //      방지 위해 override 하지 않는다 (최우선).
  //   2) 진행률 100% 이고 NEXT_TASK 도 비어 있으면 stop.
  //   3) 그 외에는 한 단계만 끝낸 오판일 수 있으니 override 해서 이어 진행.
  //   4) 같은 자리에서 무한 override 하지 않도록 cap.
  const chainDoneSignaled = Boolean(opts.chainDoneSignaled);
  const lastMessageText = String(opts.lastMessage || "");

  // NEXT_STEPS / NEXT_NONE 마커 우선 처리. worker 가 응답 끝에 명시적으로
  // 다음 작업 후보 (또는 종료 신호) 를 적었다면 NEXT_TASK.md 파싱이나 진행률
  // 기반 추정 같은 간접 신호보다 그게 더 정확하다.
  const nextStepsParsed = parseNextSteps(lastMessageText);
  if (nextStepsParsed.done) {
    // 사용자가 답변을 입력해 이어 진행할 수 있도록 prevRun 에 awaitingUserInput
    // 플래그를 마킹. UI 가 이걸 보고 입력 패널을 띄운다.
    try {
      await patchRunRecord(prevRun.id, {
        awaitingUserInput: true,
        awaitingReason: nextStepsParsed.reason || "다음 작업 없음",
        awaitingPromptHint: lastMessageText.slice(-1500),
      });
    } catch {
      /* best-effort */
    }
    // 사용자 답변 대기 알림 — 빨리 답변 줘야 진행 가능하므로 high priority.
    try {
      await pushNotification({
        kind: "awaiting",
        title: "AgentApp — 사용자 답변 필요",
        message: `[${prevRun.projectId || "?"}] ${nextStepsParsed.reason || "다음 작업 없음"}`,
        runId: prevRun.id,
        projectId: prevRun.projectId || "",
      });
    } catch { /* best-effort */ }
    return {
      stopped: true,
      awaitingUserInput: true,
      reason: `worker 가 [NEXT_NONE] 으로 다음 작업 없음을 보고했습니다 — ${nextStepsParsed.reason}. 사용자 답변 입력으로 이어 진행할 수 있습니다.`,
    };
  }
  const markerStep = nextStepsParsed.steps[0] || null;

  // 사용자가 "대기/사용자 확인으로 멈추는 케이스를 최대한 줄여달라" 고 요청.
  // 기본은 가장 명확한 종료 신호 (DECISIONS_REQUIRED) 만 stop 으로 인정한다.
  // [NEXT_NONE] 마커는 이미 위에서 처리해 즉시 종료. 그 외 wait/no-actionable/
  // 사용자 승인 같은 약한 신호는 무시하고 진행률·NEXT_TASK 기반으로 끈질기게
  // 이어 진행한다. settings.strictUserWait=true 면 기존 STRICT 4 패턴 모두 stop.
  const MINIMAL_WAIT_FOR_USER_PATTERNS = [
    /DECISIONS?_REQUIRED/i,
  ];
  const STRICT_WAIT_FOR_USER_PATTERNS = [
    /DECISIONS?_REQUIRED/i,
    /escalation된?\s+상태/,
    /\bwait(?:ing)?\s+for\s+user\s+(?:approval|decision|input)\b/i,
    /사용자\s*(?:승인|결재)\s*(?:필요|대기)/,
  ];
  const waitPatterns = settings.strictUserWait
    ? STRICT_WAIT_FOR_USER_PATTERNS
    : MINIMAL_WAIT_FOR_USER_PATTERNS;
  const isWaitingForUser = chainDoneSignaled
    && waitPatterns.some((re) => re.test(lastMessageText));

  const prevOverrides = Number(prevRun.chainDoneOverrides || 0);
  let chainDoneOverride = false;
  if (chainDoneSignaled) {
    // 사용자 대기 신호 — DECISIONS_REQUIRED 같은 명시적 escalation 만 stop. 그것도
    // NEXT_TASK 에 명확한 후속 항목이 있으면 override 해서 계속 진행 (사용자 요청:
    // 최대한 멈추지 말기). hasNewTask 가 false 일 때만 정말로 멈춤.
    if (isWaitingForUser && !hasNewTask) {
      try {
        await patchRunRecord(prevRun.id, {
          awaitingUserInput: true,
          awaitingReason: "사용자 결재/escalation 신호",
          awaitingPromptHint: lastMessageText.slice(-1500),
        });
      } catch {
        /* best-effort */
      }
      try {
        await pushNotification({
          kind: "awaiting",
          title: "AgentApp — 사용자 결재 필요",
          message: `[${prevRun.projectId || "?"}] worker 가 명시적 결재/escalation 신호를 보냈습니다.`,
          runId: prevRun.id,
          projectId: prevRun.projectId || "",
        });
      } catch { /* best-effort */ }
      return {
        stopped: true,
        awaitingUserInput: true,
        reason: "worker 가 명시적 사용자 결재/escalation 신호와 CHAIN_DONE 을 보냈고 NEXT_TASK 에도 새 항목이 없습니다. 답변 입력으로 이어 진행할 수 있습니다.",
      };
    }
    // 기본 정책: CHAIN_DONE 이 와도 NEXT_TASK / 진행률을 보고 override. 사용자가
    // settings.autoChainOverrideOnChainDone=false 로 명시 꺼야만 정말 멈춤.
    if (!settings.autoChainOverrideOnChainDone) {
      return {
        stopped: true,
        reason: "worker 가 CHAIN_DONE 을 보냈습니다. settings.autoChainOverrideOnChainDone 가 off 라 그대로 종료.",
      };
    }
    const progressIncomplete = Number.isFinite(progressPercent) && progressPercent < 100;
    // override 허용 모드에서도 hasNewTask (NEXT_TASK 에 실제 다음 항목이 있고
    // 그게 직전 작업과 다름) 만 신뢰. progressPercent 가 99% 에서 멈춘 상태로
    // 영구 override 되는 패턴 제거.
    if (!hasNewTask) {
      return {
        stopped: true,
        reason: "worker 가 CHAIN_DONE 을 보냈고 NEXT_TASK 에도 새 항목이 없어 사이클을 종료합니다.",
      };
    }
    if (prevOverrides >= CHAIN_DONE_OVERRIDE_CAP) {
      return {
        stopped: true,
        reason: `worker 가 CHAIN_DONE 을 ${CHAIN_DONE_OVERRIDE_CAP}회 연속 보냈습니다 (진행률 ${
          Number.isFinite(progressPercent) ? `${progressPercent}%` : "미상"
        }). 무한 루프 방지를 위해 종료 — 남은 작업은 수동으로 확인하세요.`,
      };
    }
    chainDoneOverride = true;
  }

  // basePrompt 결정 — 우선순위: NEXT_STEPS 마커(P0) > CHAIN_DONE override
  // 강제진행 > NEXT_TASK.md 다음 항목 > generic_continuation.
  let basePrompt;
  let chainReason;
  if (markerStep) {
    const notesNote = markerStep.notes ? ` (사유: ${markerStep.notes})` : "";
    basePrompt = `${markerStep.title}${notesNote}`;
    chainReason = "next_steps_marker";
  } else if (chainDoneOverride) {
    const progressNote = Number.isFinite(progressPercent)
      ? `현재 진행률은 ${progressPercent}% 입니다. `
      : "";
    const taskNote = hasNewTask
      ? `NEXT_TASK 에 '${nextTitle}' 항목이 아직 남아 있습니다. 이 항목부터 진행하세요. `
      : "memory/plan/NEXT_TASK 를 다시 확인해 남은 작업을 이어서 진행하세요. ";
    basePrompt = `직전 실행이 CHAIN_DONE 을 보냈지만 아직 작업이 남아 있습니다. ${progressNote}${taskNote}한 단계를 끝낸 것은 CHAIN_DONE 이 아닙니다 — 정말로 모든 작업이 끝나 진행률이 100% 일 때만 CHAIN_DONE 을 보내세요.`;
    chainReason = "chain_done_override";
  } else if (hasNewTask) {
    basePrompt = nextTitle;
    chainReason = "next_task_picked";
  } else {
    basePrompt = "이전 작업을 완료한 상태입니다. 메모리/계획/핸드오프 파일을 참고해 다음에 진행할 항목을 스스로 판단하고 이어서 진행해 주세요.";
    chainReason = "generic_continuation";
  }
  const chainPrompt = decorateAutoChainPrompt(basePrompt);
  const nextWorkerId = prevRun.workerAuto ? "auto" : prevRun.workerId;

  const result = await startRun({
    workerId: nextWorkerId,
    projectId: prevRun.projectId,
    prompt: chainPrompt,
    complexity: "auto",
    modelOverride: prevRun.modelOverride || "auto",
    autoChain: true,
    chainDoneOverrides: chainDoneOverride ? prevOverrides + 1 : 0,
    chainDepth: prevDepth + 1,
    chainReason,
  });
  return result.activeRun || null;
}

// 작업 텍스트로 도메인을 분류한다. 회사 조직 정책상 "명확하게 통과할" 작업만
// maintenance 로 분류해서 회사 계정 우선 라우팅에 사용한다. 너무 광범위하게
// 잡으면 정책 거절을 부른 뒤 다른 계정으로 fallback 하느라 회사 계정 1회를
// 낭비하므로, 보수적으로 분류한다.
//
// 사용자가 프롬프트 어디든 `[오류분석]`, `[검증]`, `[버그수정]`,
// `[프로세스분석]` 같은 명시 태그를 넣으면 그 자체로 즉시 maintenance.
// 이건 사용자가 회사 정책상 허용됨을 명시적으로 알리는 신호이므로 최우선.
//
// 명시 태그가 없으면 강한 키워드 조합(오류분석/버그수정/디버그/C#/T-SQL 등)만
// maintenance 로 분류. 약한 단어 하나(test/로그/분석)만으로는 분류하지 않는다.
export function classifyTaskDomain(promptText) {
  const text = String(promptText || "");
  if (!text.trim()) return "general";
  // 명시 태그 — 사용자가 회사 정책상 허용됨을 직접 알린 신호 (최우선).
  // 오류/에러, 분석/디버그/디버깅 등 동의어 변형을 모두 흡수해서 "에러분석" /
  // "오류분석" / "에러 분석" 처럼 사용자가 띄어쓰기 없이 쓰거나 일부 단어만
  // 써도 동일하게 인식한다.
  const explicitTagPatterns = [
    /\[\s*(?:오류|에러)\s*(?:분석|진단|디버그|디버깅|수정)\s*\]/i,
    /\[\s*(?:버그|bug)\s*(?:수정|fix|분석)\s*\]/i,
    /\[\s*(?:디버그|디버깅|debug(?:ging)?)\s*\]/i,
    /\[\s*(?:검증|validation|verify)\s*\]/i,
    /\[\s*(?:프로세스|process)\s*(?:분석|analysis)\s*\]/i,
    /\[\s*(?:코드|code)\s*(?:리뷰|review)\s*\]/i,
    /\[\s*(?:로그|log)\s*(?:분석|analysis)\s*\]/i,
    /\[\s*(?:스키마|schema)\s*(?:분석|analysis|검토)?\s*\]/i,
    /\[\s*(?:error\s*analysis|bug\s*fix|process\s*analysis|code\s*review)\s*\]/i,
  ];
  for (const pattern of explicitTagPatterns) {
    if (pattern.test(text)) return "maintenance";
  }
  const lower = text.toLowerCase();
  // 강한 키워드 — 회사 정책상 명확히 허용되는 도메인 (오류분석/버그수정/C#/T-SQL/스키마)
  const strongPatterns = [
    /오류\s*분석|에러\s*분석|버그\s*수정|디버그|디버깅/,
    /error\s*analysis|bug\s*fix|debug(?:ging)?\s+(?:the|this|code|issue)/i,
    /\bc#\b|csharp|\.net\s+(?:코드|개발|디버그)/i,
    /t-?sql|mssql|ssms|stored\s+procedure/i,
    /스택\s*트레이스|stack\s*trace|trace\s*back/i,
    /예외\s*처리|exception\s+(?:handling|trace)/i,
  ];
  for (const pattern of strongPatterns) {
    if (pattern.test(lower)) return "maintenance";
  }
  return "general";
}

// 사용자가 정지를 눌렀거나 해당 run 의 retry chain 이 명시적으로 취소된 경우 true.
// 정지 → 새 run spawn (retry/autoChain) 폭주 차단용.
function chainCancelled(runtime, failedRun) {
  const cancelAt = Number(runtime?.cancelChainAt || 0);
  // 직전 60 초 이내에 사용자가 정지를 눌렀으면 cascade 중단.
  if (cancelAt > 0 && Date.now() - cancelAt < 60_000) return true;
  if (!failedRun?.id) return false;
  const latest = runtime?.runHistory?.find((item) => item.id === failedRun.id);
  if (latest?.status === "stopped" || latest?.cancelRetryChain === true) return true;
  return false;
}

// 정책 거절 (조직 정책으로 작업 거절) 후 다른 계정으로 1 회만 retry. 같은 vendor 의 다른
// 계정에도 동일한 조직 정책이 적용될 가능성이 높으므로 다른 provider 를 우선 시도.
// quota retry 와 별개 counter (policyRetryCount) 를 사용해 cascade 폭주를 막는다.
export async function tryPolicyRetry(failedRun) {
  const latest = await readRuntime();
  const settings = normalizeSettings(latest.settings);
  if (!settings.quotaRetryEnabled) return null;
  if (Number(failedRun.policyRetryCount || 0) >= 1) return null;
  if (chainCancelled(latest, failedRun)) return null;

  const failedAccountId = String(failedRun.routing?.accountId || "");
  const failedProvider = String(failedRun.routing?.provider || providerForWorker(failedRun.workerId) || "").toLowerCase();

  // 1) 다른 provider 의 ready 계정 우선
  let routing = selectRoute(latest.accounts, {
    workerId: "auto",
    complexity: failedRun.complexity || "standard",
    modelOverride: "auto",
    excludeProviders: failedProvider ? [failedProvider] : [],
  });
  let resolvedWorker = routing.status === "recommended"
    ? (workerForProvider(routing.provider) || "auto")
    : "auto";

  // 2) 다른 provider 후보가 없으면 같은 provider 의 다른 계정 (실패 계정은 selectRoute 에서 자동 제외)
  if (routing.status !== "recommended") {
    routing = selectRoute(latest.accounts, {
      workerId: failedRun.workerId,
      complexity: failedRun.complexity || "standard",
      modelOverride: "auto",
    });
    if (routing.status !== "recommended" || routing.accountId === failedAccountId) {
      return null;
    }
    resolvedWorker = failedRun.workerId;
  }

  const result = await startRun({
    workerId: resolvedWorker,
    projectId: failedRun.projectId,
    prompt: failedRun.prompt,
    complexity: failedRun.complexity || "auto",
    modelOverride: "auto",
    retryCount: Number(failedRun.retryCount || 0) + 1,
    retryReason: `policy_blocked_attempt_1_to_${routing.provider || "alt"}`,
    policyRetryCount: 1,
    autoChain: false,
    // 같은 계정/같은 provider 로 회귀하지 않도록 명시. preferAccountDomain 도
    // 비워 회사 도메인 보너스로 다시 hanilnetworks 가 1순위가 되는 회귀 방지.
    excludeAccountIds: failedAccountId ? [failedAccountId] : [],
    excludeProviders: failedProvider ? [failedProvider] : [],
    preferAccountDomain: "",
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

// 살아 있는 worker PID 가 있는 activeRun 인지 확인. dashboard-server 의
// /runs/start 가 다중 호출됐을 때 (네트워크 재시도, 더블 클릭, 다중 탭, 외부
// dispatch + 사용자 수동 시작 충돌) 중복 spawn 을 막는다.
function isAliveActiveRun(activeRun) {
  if (!activeRun) return false;
  if (activeRun.status !== "running") return false;
  const adapter = activeRun.adapter || {};
  const status = String(adapter.status || "");
  // launching / running / preflight / queued 인 동안 살아 있다고 본다. queued 는
  // startRun 이 막 만든 직후 launchDashboardWorker 가 adapter 를 launching 으로 patch
  // 하기 전 짧은 윈도우 — 그 사이 새 startRun 이 들어오면 중복 spawn 회귀.
  if (!["queued", "launching", "running", "preflight"].includes(status)) return false;
  const pid = Number(adapter.pid || adapter.runnerPid || 0);
  if (!Number.isInteger(pid) || pid <= 0) {
    // PID 가 아직 안 잡힌 launching/queued 단계도 살아 있다고 본다.
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// project 단위 active run 검색. 같은 프로젝트에서 두 worker 가 동시에 같은 파일/git/
// memory 를 만지는 충돌을 방지하면서, 다른 프로젝트는 자유롭게 동시에 실행 가능하게.
function findAliveRunForProject(runtime, projectId) {
  const pool = [
    runtime.activeRun,
    ...(Array.isArray(runtime.activeRuns) ? runtime.activeRuns : []),
  ].filter(Boolean);
  return pool.find((r) => r.projectId === projectId && isAliveActiveRun(r)) || null;
}

export async function startRun(input) {
  const runtime = await readRuntime();

  // activeRun 가드 — 정상 종료 경로 (autoChain, quota retry, pending dispatch,
  // quickHandoff) 가 아닌 호출이 살아있는 activeRun 위에 새 run 을 덮어쓰는
  // 것을 차단. 그렇지 않으면 이전 worker 가 종료되지 않고 두 개가 동시에
  // 토큰을 소비한다.
  const isContinuation =
    Boolean(input.autoChain) ||
    Number(input.retryCount || 0) > 0 ||
    Boolean(input.pendingId) ||
    Boolean(input.autoDispatched) ||
    Boolean(input.handoffFrom) ||
    Boolean(input.allowConcurrent);
  // 같은 프로젝트에 이미 살아 있는 run 이 있으면 차단 (file/git/memory 충돌 방지).
  // 다른 프로젝트는 동시에 시작 가능 — worker 는 cli 자식 프로세스라 OS 레벨 분리.
  if (!isContinuation) {
    const conflict = findAliveRunForProject(runtime, String(input.projectId || "current"));
    if (conflict) {
      return {
        ...runtime,
        startRejected: {
          reason: "active_run_running_for_project",
          message: `이 프로젝트는 이미 ${conflict.workerId || "worker"} (${conflict.id || "?"}) 가 실행 중입니다. 같은 프로젝트는 동시에 1 개만 실행돼 file/git 충돌을 막습니다. 다른 프로젝트는 자유롭게 시작 가능합니다.`,
          activeRunId: conflict.id || "",
        },
      };
    }
  }

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

  // 도메인 우선 — prompt 가 유지보수성 (오류/분석/C#/T-SQL/검증 등) 이면 회사 계정을
  // 1순위로 라우팅. 회사 조직 정책상 이런 작업은 회사 계정에서 정상 처리되므로
  // 정책 거절을 피하면서 개인 계정 quota 를 아낀다. 호출자가 명시 override 한 경우 그대로 사용
  // (정책 거절 retry 등에서 빈 문자열을 넘기면 회귀 방지 위해 도메인 우선 비활성화).
  // 도메인 값은 settings.maintenanceDomain 에서 가져온다 (사이트별 override 가능).
  const settingsForRouting = normalizeSettings(runtime.settings);
  const maintenanceDomain = settingsForRouting.maintenanceDomain || "";
  const taskDomain = classifyTaskDomain(input.prompt);
  const hasExplicitDomain = Object.prototype.hasOwnProperty.call(input, "preferAccountDomain");
  const resolvedPreferDomain = hasExplicitDomain
    ? String(input.preferAccountDomain || "")
    : taskDomain === "maintenance"
      ? maintenanceDomain
      : "";

  // 실패 계정/provider 제외 — tryPolicyRetry 가 명시 전달. 명시 안 됐으면 빈 배열.
  const explicitExcludeAccountIds = Array.isArray(input.excludeAccountIds) ? input.excludeAccountIds : [];
  const excludeProviders = Array.isArray(input.excludeProviders) ? input.excludeProviders : [];

  // 반복 spawn 자동 감지 — 사용자가 같은 prompt 를 짧은 시간에 반복 입력하거나,
  // autoChain 이 같은 자리를 도는 패턴을 막는다. 최근 30 분 내 runHistory 에서
  // 같은 prompt (정규화 후) + 같은 accountId 로 spawn 된 run 이 2 회 이상이면
  // 그 계정을 자동 제외 후보로 본다. 회사 정책으로 거절된 작업이 같은 계정으로
  // 계속 라우팅되는 패턴의 핵심 차단 지점.
  //
  // 제외 조건:
  // (1) 같은 prompt + 같은 계정으로 2 회 이상 spawn 됐고, 그 중 하나라도
  //     policy_blocked/quota_limited/failed 였다면 → 제외 (실패 이력 명확)
  // (2) 또는 같은 prompt + 같은 계정으로 3 회 이상 spawn 됐다면 → 제외
  //     (반복 자체가 신호, status 무관)
  //
  // 명시 호출자(tryPolicyRetry 등)가 이미 excludeAccountIds 를 넘기는 경로는
  // 그대로 합집합으로 처리.
  const autoExcludeAccountIds = [];
  const REPEAT_WINDOW_MS = 30 * 60 * 1000;
  const inputPromptNormalized = String(input.prompt || "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (inputPromptNormalized) {
    const cutoff = Date.now() - REPEAT_WINDOW_MS;
    const sameByAccount = new Map();
    for (const item of runtime.runHistory || []) {
      const startedAtMs = Date.parse(item.startedAt || "") || 0;
      if (startedAtMs < cutoff) continue;
      const accountIdItem = String(item.routing?.accountId || "").toLowerCase();
      if (!accountIdItem) continue;
      const itemPrompt = String(item.prompt || "")
        .toLowerCase()
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/[\p{P}\p{S}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!itemPrompt) continue;
      const isSame = itemPrompt === inputPromptNormalized
        || itemPrompt.includes(inputPromptNormalized)
        || inputPromptNormalized.includes(itemPrompt);
      if (!isSame) continue;
      const entry = sameByAccount.get(accountIdItem) || { count: 0, hadFailure: false };
      entry.count += 1;
      const status = String(item.status || "").toLowerCase();
      if (status === "policy_blocked" || status === "quota_limited" || status === "failed") {
        entry.hadFailure = true;
      }
      sameByAccount.set(accountIdItem, entry);
    }
    for (const [accountIdLower, entry] of sameByAccount.entries()) {
      const failureWithRepeat = entry.count >= 2 && entry.hadFailure;
      const repeatOnly = entry.count >= 3;
      if (failureWithRepeat || repeatOnly) {
        autoExcludeAccountIds.push(accountIdLower);
      }
    }
  }
  const excludeAccountIds = Array.from(new Set([...explicitExcludeAccountIds, ...autoExcludeAccountIds]));

  // 1차 라우팅 — modelOverride='auto' 로 보내 selectRoute 가 후보 자유 선택.
  const firstPass = selectRoute(runtime.accounts, {
    ...input,
    complexity: resolvedComplexity,
    workerId: requestedWorker === "auto" ? "" : requestedWorker,
    modelOverride: "auto",
    preferAccountDomain: resolvedPreferDomain,
    excludeAccountIds,
    excludeProviders,
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
    preferAccountDomain: resolvedPreferDomain,
    excludeAccountIds,
    excludeProviders,
  };
  const routing = selectRoute(runtime.accounts, normalizedInput);
  const selectedRoutingAccount = routing.status === "recommended"
    ? runtime.accounts.find((account) => account.id === routing.accountId) || null
    : null;
  const maintenancePromptPrefix = accountMatchesDomain(selectedRoutingAccount, maintenanceDomain)
    ? MAINTENANCE_PROMPT_PREFIX
    : "";

  // auto 워커는 routing 이 고른 provider 로 환산.
  const resolvedWorker = requestedWorker === "auto"
    ? (routing.status === "recommended" ? (workerForProvider(routing.provider) || "claude-code") : "auto")
    : requestedWorker;

  const worktreeBefore = await inspectRunWorktree(runtime, { projectId });
  const id = `run-${Date.now()}`;
  // autoChain 이 켜져 있으면 worker prompt 끝에 STATUS/CHAIN_DONE/NEXT_STEPS
  // 규칙을 첨부한다. autoChain 이 다음 prompt 를 결정할 때 NEXT_STEPS 마커를
  // 파싱하려면 첫 run 부터 규칙이 worker 에게 전달돼야 한다. decorate 는
  // idempotent — 이미 첨부된 prompt 에는 중복 첨부하지 않는다.
  const rawPrompt = ensureMaintenancePromptPrefix(
    String(input.prompt || "").trim(),
    selectedRoutingAccount,
    maintenanceDomain,
  );
  const decoratedPrompt = settingsForRouting.autoChainEnabled
    ? decorateAutoChainPrompt(rawPrompt)
    : rawPrompt;
  const run = {
    id,
    status: routing.status === "blocked" ? "queued" : "running",
    workerId: resolvedWorker,
    workerAuto: requestedWorker === "auto",
    projectId,
    prompt: decoratedPrompt,
    complexity: resolvedComplexity,
    complexityAuto: requestedComplexity === "auto",
    modelOverride: resolvedModelOverride,
    modelOverrideAuto: requestedModelOverride === "auto",
    retryCount: Number(input.retryCount || 0),
    retryReason: String(input.retryReason || ""),
    policyRetryCount: Number(input.policyRetryCount || 0),
    autoChain: Boolean(input.autoChain),
    chainDepth: Number(input.chainDepth || 0),
    chainReason: String(input.chainReason || ""),
    chainDoneOverrides: Number(input.chainDoneOverrides || 0),
    promptPrefix: maintenancePromptPrefix,
    preferAccountDomain: resolvedPreferDomain,
    taskDomain: classifyTaskDomain(rawPrompt),
    startedAt: new Date().toISOString(),
    routing,
    worktreeBefore: worktreeBefore
      ? {
          ...worktreeBefore,
          capturedAt: nowIso(),
        }
      : null,
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
      ...(maintenancePromptPrefix
        ? [{ at: new Date().toISOString(), level: "info", message: "회사 도메인 계정 지시라 프롬프트 시작 태그 [에러분석]을 적용했습니다." }]
        : []),
    ],
  };
  run.handoffPath = await writeDashboardRunHandoff(
    run,
    run.status,
    routing.status === "blocked" ? "missing_credentials" : "in_progress",
  );

  // 다중 프로젝트 동시 실행 — running 인 새 run 을 activeRuns 배열 맨 앞에 추가.
  // activeRun (legacy alias) 도 새 run 으로 갱신 (가장 최근). 같은 projectId 충돌은
  // 위에서 이미 가드했으므로 여기엔 도달 안 함.
  const prevActiveRuns = Array.isArray(runtime.activeRuns) ? runtime.activeRuns.filter((r) => r && r.id !== id) : [];
  if (run.status === "running") {
    runtime.activeRuns = [run, ...prevActiveRuns];
    runtime.activeRun = run;
  } else {
    runtime.activeRuns = prevActiveRuns;
    runtime.activeRun = prevActiveRuns[0] || null;
  }
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
    // 사용자 알림 — 작업이 즉시 시작 못 하고 대기로 들어간 경우.
    // 사용자가 백그라운드에서 모를 수 있으므로 webhook 으로도 보냄.
    if (routing.status === "blocked") {
      try {
        await pushNotification({
          kind: "pending",
          title: "AgentApp — 작업 대기 중",
          message: `[${run.projectId}] ${routing.reason || "준비된 계정이 없습니다."} 계정 준비 시 자동 시작.`,
          runId: run.id,
          projectId: run.projectId,
        });
      } catch { /* best-effort */ }
    }
    return saved;
  }

  const { launchDashboardWorker } = await import("./worker-launch-adapter.mjs");
  await launchDashboardWorker(run);
  return readRuntime();
}

export async function stopRun(input = {}) {
  const runtime = await readRuntime();
  runtime.cancelChainAt = Date.now();
  // 다중 active runs — 특정 runId 가 주어지면 그것만, 아니면 모두 정지.
  const targetId = String(input?.runId || input?.id || "").trim();
  const allActive = [
    ...(Array.isArray(runtime.activeRuns) ? runtime.activeRuns : []),
    ...(runtime.activeRun && !runtime.activeRuns?.some((r) => r?.id === runtime.activeRun.id)
      ? [runtime.activeRun]
      : []),
  ].filter(Boolean);
  const targets = targetId
    ? allActive.filter((r) => r.id === targetId)
    : allActive;
  if (targets.length === 0) return writeRuntime(runtime);

  const { stopDashboardWorker } = await import("./worker-launch-adapter.mjs");
  for (const target of targets) {
    try {
      await stopDashboardWorker(target);
    } catch {
      // best-effort
    }
    const stopped = {
      ...target,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
      cancelRetryChain: true,
      adapter: { ...(target.adapter || {}), status: "stopped" },
      events: [
        ...(target.events || []),
        { at: new Date().toISOString(), level: "warn", message: "대시보드에서 실행을 중지했습니다. 자동 재시도/이어 진행도 함께 취소됩니다." },
      ],
    };
    stopped.handoffPath = await writeDashboardRunHandoff(stopped, "interrupted", "user_stopped");
    runtime.activeRuns = (runtime.activeRuns || []).filter((r) => r?.id !== target.id);
    if (runtime.activeRun?.id === target.id) runtime.activeRun = null;
    runtime.runHistory = [stopped, ...runtime.runHistory.filter((item) => item.id !== stopped.id)].slice(0, 20);
  }
  // legacy activeRun 갱신 — 남은 running 이 있으면 가장 최근, 없으면 null.
  if (!runtime.activeRun) runtime.activeRun = (runtime.activeRuns || [])[0] || null;
  return writeRuntime(runtime);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const runtime = command === "--preset-four-accounts" ? await applyFourAccountPreset() : await readRuntime();
  console.log(JSON.stringify(runtime, null, 2));
}
