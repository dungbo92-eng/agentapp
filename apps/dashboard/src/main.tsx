import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleStop,
  ClipboardList,
  FolderGit2,
  Gauge,
  GitBranch,
  Globe,
  KeyRound,
  MessageSquareText,
  Play,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Square,
  Terminal as TerminalIcon,
  TimerReset,
  Trash2,
  UserCheck,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import "./styles.css";

type Phase = {
  title: string;
  done: number;
  total: number;
  items: { title: string; done: boolean }[];
};

type Snapshot = {
  generated_at: string;
  repo_root: string;
  progress: {
    percent: number;
    done: number;
    total: number;
    phases: Phase[];
  };
  next_task: {
    title: string;
    id: string;
    source: string;
    priority: string;
  };
  pending_decisions: {
    title: string;
    priority: string;
    category: string;
    blocks: string;
  }[];
  approval_queue: {
    pending_decisions: {
      title: string;
      priority: string;
      category: string;
      blocks: string;
    }[];
    held_tasks: {
      id: string;
      title: string;
      status: string;
      blocked_by: string[];
      reason: string;
    }[];
    policy: {
      hold_for_user: { id: string; description: string }[];
      deny: { id: string; description: string }[];
      user_required: { id: string; description: string }[];
    };
  };
  latest_run: null | {
    at: string;
    status: string;
    summary: string;
    verification: string;
    next: string;
  };
  handoff_documents: {
    id: string;
    title: string;
    path: string;
    heading: string;
    status: string;
    next: string;
    generated: string;
    decision_count: number;
    line_count: number;
    excerpt: string;
  }[];
  task_queue: {
    total: number;
    statuses: Record<string, number>;
    next: { id: string; title: string; phase: string; priority: number }[];
  };
  usage_budget: {
    total_remaining_units: number;
    account_count: number;
    providers: string[];
    weekend_reserve_units: number;
    spendable_before_reserve: number;
    recommended_today_budget_units: number;
    reset_day: string;
    days_to_reset: number;
    weekend_days_left: string[];
    reserve_ok_now: boolean;
    accounts: {
      id: string;
      provider: string;
      plan: string;
      auth: string;
      remaining_units: number;
      weekly_budget_units: number;
      remaining_percent: number;
      reset_day: string;
    }[];
    recommendations: {
      complexity: string;
      status: string;
      account_id?: string;
      provider?: string;
      model_tier?: string;
      reasoning_effort?: string;
      estimated_units?: number;
      weekend_reserve_after_run?: number;
      weekend_reserve_ok?: boolean;
      reason: string;
    }[];
  };
  workers: {
    id: string;
    kind: string;
    display_name: string;
    status: string;
    latest_status: string;
    latest_reason: string;
    latest_task: string;
    latest_updated_at: string;
    handoff_summary: string;
  }[];
};

type ManagedAccount = {
  id: string;
  displayName?: string;
  provider: string;
  plan: string;
  loginLabel: string;
  email?: string;
  authMethod?: string;
  sessionProfile?: string;
  credentialRef?: string;
  credentialStatus?: "empty" | "stored";
  enabled: boolean;
  sessionStatus: "needs-login" | "ready" | "paused";
  lastVerifiedAt?: string;
  sessionDetectionReason?: string;
  actualAuthEmail?: string;
  quotaResetAt?: string;
  quotaReason?: string;
  remainingUnits: number;
  weeklyUnits: number;
  resetDay: string;
  source: "config" | "local";
  modelProfiles?: Record<string, { model: string; reasoningEffort: string; estimatedUnits: number }>;
  lastUsedAt?: string;
  usageAlert?: "ok" | "warning" | "critical";
};

type PendingRun = {
  id: string;
  queuedAt: string;
  workerId: string;
  workerAuto?: boolean;
  projectId: string;
  prompt: string;
  complexity: string;
  modelOverride?: string;
  provider: string;
  blockedReason: string;
};

type ManagedProject = {
  id: string;
  name: string;
  path: string;
  status: "active" | "registered" | "needs-baseline";
  progress: number;
  lastModel?: string;
  lastWorker?: string;
};

type RunRecord = {
  id: string;
  status: string;
  workerId: string;
  workerAuto?: boolean;
  projectId: string;
  prompt: string;
  complexity: string;
  modelOverride?: string;
  startedAt: string;
  stoppedAt?: string;
  completedAt?: string;
  handoffPath?: string;
  currentStatus?: string; // [STATUS] 마커가 마지막으로 보고한 현재 작업
  awaitingUserInput?: boolean;
  awaitingReason?: string;
  awaitingPromptHint?: string;
  interruptedWorktree?: {
    path: string;
    dirty: boolean;
    branch?: string;
    fileCount: number;
    files: string[];
    statusText?: string;
    diffStat?: string;
    reason?: string;
    detectedAt?: string;
  };
  retryCount?: number;
  chainDepth?: number;
  chainDoneOverrides?: number; // CHAIN_DONE 안전망 override 누적 횟수
  chainReason?: string;
  events?: { at: string; level: "info" | "warn" | "error"; message: string }[];
  validation?: {
    status?: string;
    command?: string;
    summary?: string;
    logPath?: string;
  };
  adapter?: {
    status?: string;
    mode?: string;
    pid?: number;
    runnerPid?: number;
    command?: string;
    promptPath?: string;
    logPath?: string;
    sessionDir?: string;
    sessionProfile?: string;
    lastMessagePath?: string;
    lastMessageText?: string;
    launchLogTail?: string;
    summary?: string;
    lastError?: string;
    exitCode?: number;
  };
  routing?: {
    status: string;
    accountId?: string;
    provider?: string;
    loginLabel?: string;
    sessionProfile?: string;
    authMethod?: string;
    model?: string;
    reasoningEffort?: string;
    estimatedUnits?: number;
    reason: string;
  };
};

type RuntimeSettings = {
  idleWarnMs: number;
  idleKillMs: number;
  autoChainEnabled?: boolean;
  autoChainMaxDepth?: number;
  autoChainOverrideOnChainDone?: boolean;
  quotaRetryEnabled?: boolean;
  quotaRetryMaxAttempts?: number;
  notifyWebhookUrl?: string;
  notifyEnabled?: boolean;
  strictUserWait?: boolean;
};

type RuntimeNotification = {
  id: string;
  kind: "completed" | "awaiting" | "pending" | "blocked" | "error" | "info" | string;
  title: string;
  message: string;
  runId?: string;
  projectId?: string;
  at: number;
  delivered?: boolean;
};

type RuntimeState = {
  version?: number;
  accounts: ManagedAccount[];
  projects: ManagedProject[];
  activeRun: RunRecord | null;
  activeRuns?: RunRecord[];
  runHistory: RunRecord[];
  pendingRuns?: PendingRun[];
  notifications?: RuntimeNotification[];
  handoff?: { status: string; targetAccountId?: string; reason: string };
  startRejected?: { reason: string; message: string; activeRunId?: string };
  settings?: RuntimeSettings;
};

type EnvironmentTarget = {
  id: string;
  group: "core" | "ai";
  label: string;
  command: string;
  envOverride?: string;
  status: string;
  ok: boolean;
  required: boolean;
  detail: string;
  reason: string;
  installCommand: string;
  afterInstall?: string;
  docs?: string;
  installable?: boolean;
};

type EnvironmentState = {
  generatedAt: string;
  packageVersion: string;
  summary: {
    total: number;
    ok: number;
    missing: number;
    missingRequired: number;
    ready: boolean;
  };
  autoInstall?: {
    aiCli: boolean;
  };
  targets: EnvironmentTarget[];
};

const numberFormatter = new Intl.NumberFormat("ko-KR");
const emptyRuntime: RuntimeState = { accounts: [], projects: [], activeRun: null, runHistory: [], pendingRuns: [] };

function usageAlertLevel(account: { remainingUnits: number; weeklyUnits: number; usageAlert?: string }): "ok" | "warning" | "critical" {
  if (account.usageAlert === "warning" || account.usageAlert === "critical") return account.usageAlert;
  const weekly = Number(account.weeklyUnits || 0);
  const remaining = Number(account.remainingUnits || 0);
  if (weekly <= 0) return "ok";
  const ratio = remaining / weekly;
  if (ratio <= 0.1) return "critical";
  if (ratio <= 0.3) return "warning";
  return "ok";
}

let lastCriticalBeepAt = 0;
function playCriticalBeep() {
  const now = Date.now();
  if (now - lastCriticalBeepAt < 60000) return;
  lastCriticalBeepAt = now;
  try {
    const AudioCtx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.type = "sine";
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close().catch(() => {}); }, 220);
  } catch {
    // audio not allowed; ignore
  }
}

const STATUS_LABELS: Record<string, string> = {
  ready: "준비됨",
  running: "실행 중",
  queued: "대기 중",
  blocked: "차단됨",
  recommended: "추천",
  "needs-login": "로그인 필요",
  needs_user: "사용자 확인 필요",
  "needs-user": "사용자 확인 필요",
  policy_blocked: "정책 거절",
  "policy-blocked": "정책 거절",
  quota_limited: "한도 도달",
  "quota-limited": "한도 도달",
  stopped: "중지됨",
  completed: "완료",
  failed: "실패",
  paused: "일시중지",
  available: "사용 가능",
  launching: "실행 준비 중",
  manual: "수동",
  interrupted: "중단됨",
  unknown: "알 수 없음",
  reserved: "예약됨",
  passed: "통과",
  partial: "부분 완료",
  pending: "대기 중",
  not_run: "미실행",
};

const AUTH_METHOD_LABELS: Record<string, string> = {
  google: "Google 로그인",
  email_password: "이메일 + 비밀번호",
  api_key: "API 키",
  cli_session: "CLI 세션",
  browser_profile: "브라우저 프로필",
  manual: "수동 관리",
};

const PLAN_LABELS: Record<string, string> = {
  pro: "Pro",
  plus: "Plus",
  team: "Team",
  local: "로컬",
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
};

const COMPLEXITY_LABELS: Record<string, string> = {
  routine: "기본",
  standard: "일반",
  complex: "복잡",
  critical: "중요",
};

const MODEL_OVERRIDE_LABELS: Record<string, string> = {
  auto: "자동",
  best_available: "가능한 최고 품질",
  opus: "Claude Opus",
  sonnet: "Claude Sonnet",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4 Mini",
};

const REASONING_LABELS: Record<string, string> = {
  low: "낮음",
  medium: "중간",
  normal: "보통",
  high: "높음",
  very_high: "매우 높음",
  xhigh: "최상",
};

const ADAPTER_MODE_LABELS: Record<string, string> = {
  command: "명령 실행",
  manual: "수동",
  runner: "백그라운드 실행",
  "open-window": "창 열기",
  pending: "대기 중",
  preflight: "사전 검증",
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] || status || STATUS_LABELS.unknown;
}

function authMethodLabel(method?: string) {
  return AUTH_METHOD_LABELS[method || "manual"] || method || AUTH_METHOD_LABELS.manual;
}

function planLabel(plan?: string) {
  return PLAN_LABELS[plan || "local"] || plan || PLAN_LABELS.local;
}

function providerLabel(provider?: string) {
  return PROVIDER_LABELS[provider || ""] || provider || "-";
}

function complexityLabel(complexity: string) {
  return COMPLEXITY_LABELS[complexity] || complexity;
}

function modelOverrideLabel(model: string) {
  return MODEL_OVERRIDE_LABELS[model] || model;
}

function reasoningLabel(value?: string) {
  return REASONING_LABELS[value || ""] || value || "-";
}

function adapterModeLabel(mode?: string) {
  return ADAPTER_MODE_LABELS[mode || ""] || mode || "대기 중";
}

function StatusPill({ status }: { status: string }) {
  const normalized = (status || "unknown").toLowerCase();
  const liveClass = ["running", "in_progress", "in-progress", "active", "live"].includes(normalized)
    ? "live"
    : ["paused", "warn", "warning"].includes(normalized)
      ? "paused"
      : "";
  return (
    <span className={`pill ${status}`}>
      {liveClass ? <span className={`statusDot ${liveClass}`} aria-hidden="true" /> : null}
      <span>{statusLabel(status || "unknown")}</span>
    </span>
  );
}

// awaitingUserInput 으로 멈춘 run 옆에 붙는 인라인 입력 패널. 사용자가 답변을
// 적고 "이어 진행" 누르면 같은 worker 가 그 답변을 받아 작업을 계속한다.
function ResumeWithUserInput({
  runId,
  onResume,
}: {
  runId: string;
  onResume: (text: string) => Promise<void> | void;
}) {
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="resumeForm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim() || busy) return;
        setBusy(true);
        try {
          await onResume(value);
          setValue("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="답변을 입력하면 worker 가 같은 컨텍스트로 이어서 진행합니다 (예: 'A 방향으로 가세요', '이 함수는 살려둬'). Shift+Enter 줄바꿈"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
          }
        }}
        data-runid={runId}
      />
      <div className="resumeFormActions">
        <button type="submit" className="primaryButton small" disabled={!value.trim() || busy}>
          {busy ? "전달 중…" : "답변하고 이어 진행"}
        </button>
      </div>
    </form>
  );
}

// ===== 인앱 브라우저 (Electron <webview> 기반) =====
// 외부 사이트를 안전한 격리 환경에서 로드. URL 입력 + 뒤로/앞으로/새로고침/홈 버튼.
// 사용자가 사이드바에서 "브라우저" 선택 시 메인 영역에 전체 노출.
function BrowserPanel({ onClose }: { onClose: () => void }) {
  const [urlInput, setUrlInput] = React.useState<string>("https://www.google.com");
  const [currentUrl, setCurrentUrl] = React.useState<string>("https://www.google.com");
  const [loading, setLoading] = React.useState<boolean>(false);
  const webviewRef = React.useRef<HTMLElement | null>(null);

  function normalize(u: string) {
    const s = u.trim();
    if (!s) return "";
    if (/^[a-z]+:\/\//i.test(s)) return s;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(s)) return `https://${s}`;
    // 검색어로 취급 — Google
    return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
  }

  React.useEffect(() => {
    const wv = webviewRef.current as unknown as {
      addEventListener: (event: string, handler: (e: Event & { url?: string }) => void) => void;
      removeEventListener: (event: string, handler: (e: Event & { url?: string }) => void) => void;
    } | null;
    if (!wv) return;
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    const onNav = (e: Event & { url?: string }) => {
      if (e.url) {
        setCurrentUrl(e.url);
        setUrlInput(e.url);
      }
    };
    wv.addEventListener("did-start-loading", onStart);
    wv.addEventListener("did-stop-loading", onStop);
    wv.addEventListener("did-navigate", onNav);
    wv.addEventListener("did-navigate-in-page", onNav);
    return () => {
      wv.removeEventListener("did-start-loading", onStart);
      wv.removeEventListener("did-stop-loading", onStop);
      wv.removeEventListener("did-navigate", onNav);
      wv.removeEventListener("did-navigate-in-page", onNav);
    };
  }, []);

  function go(target: string) {
    const u = normalize(target);
    if (!u) return;
    setCurrentUrl(u);
    setUrlInput(u);
    const wv = webviewRef.current as unknown as { loadURL: (url: string) => void } | null;
    try {
      wv?.loadURL?.(u);
    } catch { /* webview not ready */ }
  }
  function back() {
    const wv = webviewRef.current as unknown as { goBack: () => void; canGoBack: () => boolean } | null;
    if (wv?.canGoBack?.()) wv.goBack();
  }
  function fwd() {
    const wv = webviewRef.current as unknown as { goForward: () => void; canGoForward: () => boolean } | null;
    if (wv?.canGoForward?.()) wv.goForward();
  }
  function reload() {
    const wv = webviewRef.current as unknown as { reload: () => void } | null;
    wv?.reload?.();
  }

  return (
    <div className="inAppPanel browserPanel">
      <header className="inAppPanelHeader">
        <button type="button" className="metaToggleBtn" onClick={back} title="뒤로">←</button>
        <button type="button" className="metaToggleBtn" onClick={fwd} title="앞으로">→</button>
        <button type="button" className="metaToggleBtn" onClick={reload} title={loading ? "로딩 중..." : "새로고침"}>{loading ? "⏳" : "↻"}</button>
        <form
          className="browserUrlForm"
          onSubmit={(e) => { e.preventDefault(); go(urlInput); }}
        >
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="URL 또는 검색어"
            spellCheck={false}
          />
          <button type="submit" className="primaryButton small">이동</button>
        </form>
        <button type="button" className="metaToggleBtn" onClick={onClose} title="브라우저 패널 닫기">
          <X size={14} />
        </button>
      </header>
      <div className="browserContainer">
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {React.createElement("webview", {
          ref: webviewRef as any,
          src: currentUrl,
          style: { width: "100%", height: "100%", border: 0, display: "flex", flex: "1" },
          allowpopups: "true",
        } as any)}
      </div>
    </div>
  );
}

// ===== 인앱 터미널 (xterm.js + node-pty 기반) =====
// 사용자 시스템 셸을 그대로 띄움 — PowerShell (Windows), bash/zsh (macOS/Linux).
// 사이드바 "터미널" 선택 시 메인 영역 전체 차지.
function TerminalPanel({ onClose }: { onClose: () => void }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<string>("초기화 중...");
  const [error, setError] = React.useState<string>("");
  const sessionIdRef = React.useRef<string>("");

  React.useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let fit: import("@xterm/addon-fit").FitAddon | null = null;
    let offData: (() => void) | undefined;
    let offExit: (() => void) | undefined;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      const desktop = (typeof window !== "undefined" ? (window as any).agentapp : null);
      if (!desktop?.terminal) {
        setError("터미널 API 가 없습니다 (데스크탑 앱에서만 사용 가능).");
        setStatus("");
        return;
      }
      // xterm.js 동적 import — vite 가 ESM 으로 처리.
      const xtermMod = await import("@xterm/xterm");
      const fitMod = await import("@xterm/addon-fit");
      // @ts-expect-error CSS side-effect import — Vite 가 처리, TS declarations 없음
      await import("@xterm/xterm/css/xterm.css");
      if (disposed) return;
      term = new xtermMod.Terminal({
        fontFamily: "Consolas, 'Cascadia Mono', Menlo, monospace",
        fontSize: 13,
        theme: { background: "#0b1220", foreground: "#e5e7eb", cursor: "#34d399" },
        cursorBlink: true,
        scrollback: 5000,
      });
      fit = new fitMod.FitAddon();
      term.loadAddon(fit);
      if (containerRef.current) {
        term.open(containerRef.current);
        try { fit.fit(); } catch { /* container 아직 layout 안 됨 */ }
      }
      const cols = term.cols || 100;
      const rows = term.rows || 28;
      const result = await desktop.terminal.create({ cols, rows });
      if (disposed) return;
      if (!result?.ok) {
        setError(`터미널 시작 실패: ${result?.reason || "unknown"}`);
        setStatus("");
        return;
      }
      sessionIdRef.current = String(result.sessionId);
      setStatus(`연결됨 — ${result.shell || "shell"} @ ${result.cwd || ""}`);
      // 입력 → main 으로 전달
      term.onData((data) => {
        if (sessionIdRef.current) {
          void desktop.terminal.write(sessionIdRef.current, data);
        }
      });
      // 리사이즈 — 컨테이너 크기 변경 시 fit + main 에 resize 전달
      term.onResize(({ cols: c, rows: r }) => {
        if (sessionIdRef.current) {
          void desktop.terminal.resize(sessionIdRef.current, c, r);
        }
      });
      // main → renderer 데이터 push
      offData = desktop.terminal.onData(({ sessionId, data }: { sessionId: string; data: string }) => {
        if (sessionId === sessionIdRef.current && term) term.write(data);
      });
      offExit = desktop.terminal.onExit(({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
        if (sessionId === sessionIdRef.current) {
          setStatus(`종료됨 (exit ${exitCode})`);
          sessionIdRef.current = "";
        }
      });
      // 컨테이너 리사이즈 관찰 — fit 자동 적용
      if (containerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          try { fit?.fit(); } catch { /* ignore */ }
        });
        resizeObserver.observe(containerRef.current);
      }
    }
    void init();
    return () => {
      disposed = true;
      offData?.();
      offExit?.();
      resizeObserver?.disconnect();
      if (sessionIdRef.current) {
        const desktop = (typeof window !== "undefined" ? (window as any).agentapp : null);
        void desktop?.terminal?.kill?.(sessionIdRef.current);
        sessionIdRef.current = "";
      }
      term?.dispose();
    };
  }, []);

  return (
    <div className="inAppPanel terminalPanel">
      <header className="inAppPanelHeader">
        <strong>터미널</strong>
        <span className="terminalStatus" title="현재 세션 상태">{status}</span>
        {error ? <span className="terminalError">{error}</span> : null}
        <button type="button" className="metaToggleBtn" onClick={onClose} title="터미널 패널 닫기" style={{ marginLeft: "auto" }}>
          <X size={14} />
        </button>
      </header>
      <div className="terminalContainer" ref={containerRef} />
    </div>
  );
}

function IconButton({
  children,
  icon: Icon,
  variant = "ghost",
  type = "button",
  disabled = false,
  onClick,
  title,
}: {
  children: React.ReactNode;
  icon: LucideIcon;
  variant?: "primary" | "danger" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button className={`button ${variant}`} disabled={disabled} type={type} onClick={onClick} title={title}>
      <Icon aria-hidden="true" size={16} />
      <span>{children}</span>
    </button>
  );
}

function useFlashOnChange<T>(value: T): number {
  const [flashKey, setFlashKey] = React.useState(0);
  const previousRef = React.useRef<T>(value);
  React.useEffect(() => {
    if (previousRef.current !== value) {
      previousRef.current = value;
      setFlashKey((current) => current + 1);
    }
  }, [value]);
  return flashKey;
}

function useAnimatedNumber(target: number, durationMs = 700): number {
  const [display, setDisplay] = React.useState<number>(() => (Number.isFinite(target) ? target : 0));
  const startRef = React.useRef<number>(display);
  const rafRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (target === display) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const from = display;
    const to = target;
    const t0 = performance.now();
    startRef.current = from;
    const step = (now: number) => {
      const elapsed = now - t0;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(to);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}

function AnimatedNumber({
  value,
  durationMs = 700,
  format,
}: {
  value: number;
  durationMs?: number;
  format?: (value: number) => string;
}) {
  const animated = useAnimatedNumber(value, durationMs);
  const rounded = Number.isInteger(value) ? Math.round(animated) : animated;
  const formatted = format ? format(rounded) : numberFormatter.format(rounded);
  return <span className="animatedNumber">{formatted}</span>;
}

const NOISY_EVENT_RE = /^(실행 프롬프트를|작업 실행 어댑터를|이번 실행을 위해 로컬 예산|메타데이터 .* 기록|준비하는 중|등록했습니다)/;

function summarizeEvent(message: string): string {
  return message.replace(/\.{3}\s*$/, "");
}

function compactEventTime(value: string): string {
  return new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Lightweight inline markdown renderer for the chat assistant bubble.
// Handles: paragraph breaks, dash/asterisk bullet lists, fenced ``` blocks,
// inline `code`, **bold**, *italic*, and [text](url) links. No external dep.
function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let counter = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${counter++}`;
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        const href = m[2];
        const isHttp = /^https?:\/\//i.test(href);
        nodes.push(
          <a key={key} href={isHttp ? href : `#${encodeURIComponent(href)}`} target={isHttp ? "_blank" : undefined} rel={isHttp ? "noreferrer" : undefined}>
            {m[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownText({ source }: { source: string }) {
  if (!source) return null;
  const blocks: React.ReactNode[] = [];
  const parts = source.split(/\n{2,}/);
  parts.forEach((block, blockIndex) => {
    if (!block.trim()) return;
    // Fenced code block
    const fenced = block.match(/^```(\w*)\n([\s\S]*?)\n```$/);
    if (fenced) {
      blocks.push(
        <pre key={`code-${blockIndex}`} className="mdCode">
          <code>{fenced[2]}</code>
        </pre>,
      );
      return;
    }
    // Bullet list
    const lines = block.split("\n");
    const isList = lines.every((line) => /^\s*[-*]\s+/.test(line));
    if (isList && lines.length > 0) {
      blocks.push(
        <ul key={`ul-${blockIndex}`} className="mdList">
          {lines.map((line, i) => {
            const content = line.replace(/^\s*[-*]\s+/, "");
            return <li key={i}>{renderInlineMarkdown(content, `li-${blockIndex}-${i}`)}</li>;
          })}
        </ul>,
      );
      return;
    }
    blocks.push(
      <p key={`p-${blockIndex}`} className="mdPara">
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <br /> : null}
            {renderInlineMarkdown(line, `p-${blockIndex}-${i}`)}
          </React.Fragment>
        ))}
      </p>,
    );
  });
  return <div className="mdBody">{blocks}</div>;
}

function ChatConversation({
  run,
  now,
  onQuickSwitch,
  readyAccounts,
}: {
  run: RunRecord;
  now: number;
  onQuickSwitch: (targetId?: string) => void;
  readyAccounts: ManagedAccount[];
}) {
  const startMs = new Date(run.startedAt).getTime();
  const elapsedMs = Math.max(0, now - startMs);
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const events = run.events || [];
  const lastEventMs = events.length > 0 ? new Date(events[events.length - 1].at).getTime() : startMs;
  const idleMs = Math.max(0, now - lastEventMs);
  const idleSec = Math.floor(idleMs / 1000);
  const showIdleWarn = run.status === "running" && idleSec >= 20;
  const noisy = events.filter((event) => NOISY_EVENT_RE.test(event.message));
  // 진행 사항을 더 많이 보여주기 위해 최근 60개까지 노출 (이전 12개).
  const visibleEvents = events
    .filter((event) => !NOISY_EVENT_RE.test(event.message))
    .slice(-60);
  const isRunning = run.status === "running" || run.adapter?.status === "running";
  const hasResponse = Boolean(run.adapter?.lastMessageText);
  const accountLabel = run.routing?.accountId || "계정 대기";
  const modelLabel = run.routing?.model || run.modelOverride || "auto";
  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (timelineRef.current && isRunning) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [visibleEvents.length, isRunning]);

  return (
    <div className="chatThread">
      <div className="chatThreadHeader">
        <StatusPill status={run.status} />
        <span className="chatMeta">{run.workerId} · {modelLabel} · {accountLabel}</span>
        <span className="chatTimer">⏱ {mm}:{ss}</span>
        {showIdleWarn ? <span className="chatIdle">⚠ {idleSec}s 무응답</span> : null}
      </div>

      <article className="chatBubble user">
        <header>
          <span className="chatRole">나</span>
          <time>{new Date(run.startedAt).toLocaleTimeString("ko-KR")}</time>
        </header>
        <p>{run.prompt || "(빈 프롬프트)"}</p>
      </article>

      {hasResponse ? (
        <article className="chatBubble assistant">
          <header>
            <span className="chatRole">{accountLabel}</span>
            {run.stoppedAt ? <time>{new Date(run.stoppedAt).toLocaleTimeString("ko-KR")}</time> : null}
          </header>
          <MarkdownText source={run.adapter?.lastMessageText || ""} />
        </article>
      ) : isRunning ? (
        <article className="chatBubble assistant typing">
          <header>
            <span className="chatRole">{accountLabel}</span>
            <span className="chatTypingDots"><span /><span /><span /></span>
          </header>
          <small>응답 대기 중…</small>
        </article>
      ) : run.status === "blocked" || run.status === "failed" || run.status === "needs_user" ? (
        <article className="chatBubble system warn">
          <header>
            <span className="chatRole">시스템</span>
          </header>
          <p>{run.adapter?.summary || run.routing?.reason || "실행이 차단되었습니다."}</p>
        </article>
      ) : null}

      {visibleEvents.length > 0 ? (
        <div className="chatTimeline" ref={timelineRef}>
          {visibleEvents.map((event) => (
            <div className={`chatTimelineRow ${event.level}`} key={`${event.at}-${event.message.slice(0, 32)}`}>
              <time>{new Date(event.at).toLocaleTimeString("ko-KR")}</time>
              <span>{summarizeEvent(event.message)}</span>
            </div>
          ))}
          {noisy.length > 0 ? (
            <details className="chatTimelineMore">
              <summary>내부 이벤트 {noisy.length}건 보기</summary>
              {noisy.map((event) => (
                <div className="chatTimelineRow muted" key={`m-${event.at}-${event.message.slice(0, 32)}`}>
                  <time>{new Date(event.at).toLocaleTimeString("ko-KR")}</time>
                  <span>{event.message}</span>
                </div>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}

      {run.adapter?.launchLogTail ? (
        <details className="chatExtras">
          <summary>실행 로그 tail ({run.adapter.launchLogTail.length.toLocaleString()} 자)</summary>
          <pre>{run.adapter.launchLogTail}</pre>
        </details>
      ) : null}

      {run.adapter?.command ? (
        <details className="chatExtras">
          <summary>실행 명령</summary>
          <code>{run.adapter.command}</code>
        </details>
      ) : null}

      {isRunning ? (
        <div className="chatQuickSwitch">
          <button
            type="button"
            className="quickSwitchBtn"
            title="다른 준비된 계정으로 같은 작업을 이어갑니다"
            onClick={() => onQuickSwitch()}
          >
            🔄 다른 계정으로 이어가기
          </button>
          {readyAccounts
            .filter((account) => account.id !== run.routing?.accountId)
            .slice(0, 3)
            .map((account) => (
              <button
                key={account.id}
                type="button"
                className="quickSwitchTarget"
                title={`'${account.displayName || account.id}' 계정으로 이어가기`}
                onClick={() => onQuickSwitch(account.id)}
              >
                → {account.displayName || account.id}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeSettingsPanel({
  settings,
  onSave,
}: {
  settings?: RuntimeSettings;
  onSave: (next: Partial<RuntimeSettings>) => Promise<void>;
}) {
  const warnMin = settings ? Math.round(settings.idleWarnMs / 60000) : 1.5;
  const killMin = settings ? Math.round(settings.idleKillMs / 60000) : 30;
  const [warnInput, setWarnInput] = React.useState<string>(String(warnMin));
  const [killInput, setKillInput] = React.useState<string>(String(killMin));
  const [autoChain, setAutoChain] = React.useState<boolean>(settings?.autoChainEnabled !== false);
  const [chainDepthInput, setChainDepthInput] = React.useState<string>(String(settings?.autoChainMaxDepth ?? 8));
  const [overrideChainDone, setOverrideChainDone] = React.useState<boolean>(Boolean(settings?.autoChainOverrideOnChainDone));
  const [quotaRetry, setQuotaRetry] = React.useState<boolean>(settings?.quotaRetryEnabled !== false);
  const [notifyEnabled, setNotifyEnabled] = React.useState<boolean>(settings?.notifyEnabled !== false);
  const [notifyWebhookUrl, setNotifyWebhookUrl] = React.useState<string>(settings?.notifyWebhookUrl ?? "");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (settings) {
      setWarnInput(String(Math.round(settings.idleWarnMs / 60000)));
      setKillInput(String(Math.round(settings.idleKillMs / 60000)));
      setAutoChain(settings.autoChainEnabled !== false);
      setChainDepthInput(String(settings.autoChainMaxDepth ?? 8));
      setOverrideChainDone(Boolean(settings.autoChainOverrideOnChainDone));
      setQuotaRetry(settings.quotaRetryEnabled !== false);
      setNotifyEnabled(settings.notifyEnabled !== false);
      setNotifyWebhookUrl(settings.notifyWebhookUrl ?? "");
    }
  }, [settings?.idleWarnMs, settings?.idleKillMs, settings?.autoChainEnabled, settings?.autoChainMaxDepth, settings?.autoChainOverrideOnChainDone, settings?.quotaRetryEnabled, settings?.notifyEnabled, settings?.notifyWebhookUrl]);

  return (
    <section className="sidebarBlock">
      <div className="sectionTitle compact">
        <h2>자율 진행</h2>
        <TimerReset aria-hidden="true" size={16} />
      </div>
      <p className="settingsHint">
        worker 가 출력 없이 멈춰 보일 때 자동으로 끊는 시간입니다. 자율 진행은 길게, 빠른 실패는 짧게.
        kill 시간을 <strong>0</strong> 으로 두면 자동 종료를 끕니다.
      </p>
      <div className="settingsRow">
        <label>
          <span>경고 (분)</span>
          <input
            type="number"
            min={0}
            step={0.5}
            value={warnInput}
            onChange={(event) => setWarnInput(event.target.value)}
            title="이 시간만큼 worker 출력이 없으면 이벤트 로그에 경고 한 번 남깁니다"
          />
        </label>
        <label>
          <span>자동 종료 (분)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={killInput}
            onChange={(event) => setKillInput(event.target.value)}
            title="이 시간을 넘기면 worker 를 강제 종료합니다. 0 으로 두면 끄지 않습니다"
          />
        </label>
      </div>
      <div className="settingsToggles">
        <label className="toggleRow" title="run 이 정상 완료되면 NEXT_TASK 를 자동으로 픽업해서 같은 worker 로 이어서 진행합니다. NEXT_TASK 가 비어 있으면 '이어서 다음 단계 진행' 일반 프롬프트로 자율 진행하다가 worker 가 CHAIN_DONE 응답을 보내면 종료합니다.">
          <input
            type="checkbox"
            checked={autoChain}
            onChange={(event) => setAutoChain(event.target.checked)}
          />
          <span>▶ 자동 이어 진행 (사이클 완료 후 다음 작업 자동 픽업)</span>
        </label>
        {autoChain ? (
          <>
            <label className="toggleRow inline">
              <span>최대 반복</span>
              <input
                className="inlineNumber"
                type="number"
                min={1}
                max={500}
                step={1}
                value={chainDepthInput}
                onChange={(event) => setChainDepthInput(event.target.value)}
                title="이 횟수만큼 자동 이어 진행 후 멈춥니다. 무한 루프 방지용. 기본 8."
              />
              <span className="settingsHintInline">사이클 (이후 멈춤)</span>
            </label>
            <label className="toggleRow" title="worker 가 CHAIN_DONE 신호를 보냈을 때, 진행률이 100%가 아니거나 NEXT_TASK 에 다음 항목이 남아 있으면 무시하고 한 번 더 강제로 이어 시작합니다. 기본은 꺼져 있어 토큰을 절약합니다 — worker 가 끝났다고 하면 그 신호를 존중.">
              <input
                type="checkbox"
                checked={overrideChainDone}
                onChange={(event) => setOverrideChainDone(event.target.checked)}
              />
              <span>⚠ CHAIN_DONE 무시하고 진행률/NEXT_TASK 기반으로 강제 이어가기</span>
            </label>
          </>
        ) : null}
        <label className="toggleRow" title="worker 가 한도(quota) 도달로 종료되면 다른 ready 계정으로 자동 재시도합니다. 자동 선택으로 시작한 작업은 다른 도구까지 후보로 열고, 수동 도구 선택은 그 도구 안에서 재시도합니다.">
          <input
            type="checkbox"
            checked={quotaRetry}
            onChange={(event) => setQuotaRetry(event.target.checked)}
          />
          <span>🔁 한도 도달 시 다른 계정으로 자동 재시도</span>
        </label>
        <label className="toggleRow" title="작업 완료/대기/사용자 답변 필요 등 주요 이벤트가 발생하면 대시보드 우측 알림(2초) + OS 알림 + 등록된 webhook URL 로 전송합니다.">
          <input
            type="checkbox"
            checked={notifyEnabled}
            onChange={(event) => setNotifyEnabled(event.target.checked)}
          />
          <span>🔔 이벤트 알림 (완료/대기/사용자 답변 필요)</span>
        </label>
        <label className="toggleRow column" title="모바일 알림용 webhook. ntfy.sh / Discord / Slack incoming webhook URL 모두 지원. 비워두면 webhook 발송 안 함 (대시보드 토스트/OS 알림만).">
          <span>📱 모바일 알림 webhook URL</span>
          <input
            type="text"
            placeholder="https://ntfy.sh/agentapp-xxx  (또는 Discord/Slack webhook URL)"
            value={notifyWebhookUrl}
            onChange={(event) => setNotifyWebhookUrl(event.target.value)}
            style={{ width: "100%", padding: "4px 6px", marginTop: 4 }}
          />
          <small style={{ color: "#64748b", fontSize: "0.7rem", marginTop: 2, display: "block" }}>
            ntfy 사용: 폰에 ntfy 앱 설치 + 임의 토픽 구독 (예: agentapp-leemg-xyz) → 이 URL 에 https://ntfy.sh/&lt;토픽&gt; 입력
          </small>
        </label>
      </div>
      <button
        type="button"
        className="button primary settingsSaveBtn"
        disabled={saving}
        onClick={async () => {
          const warnMs = Math.max(0, Number(warnInput) * 60000) || 0;
          const killMs = Math.max(0, Number(killInput) * 60000) || 0;
          setSaving(true);
          try {
            const depth = Math.max(1, Math.min(500, Number(chainDepthInput) || 8));
            await onSave({
              idleWarnMs: warnMs,
              idleKillMs: killMs,
              autoChainEnabled: autoChain,
              autoChainMaxDepth: depth,
              autoChainOverrideOnChainDone: overrideChainDone,
              quotaRetryEnabled: quotaRetry,
              notifyEnabled,
              notifyWebhookUrl: notifyWebhookUrl.trim(),
            });
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "저장 중…" : "저장"}
      </button>
    </section>
  );
}

function ProgressBar({ value, live }: { value: number; live?: boolean }) {
  const clamped = Math.min(100, Math.max(0, value));
  const indeterminate = Boolean(live) && clamped === 0;
  return (
    <div
      className={`progressTrack${indeterminate ? " indeterminate" : ""}`}
      aria-label={`진행률 ${clamped}%`}
      aria-busy={live ? "true" : undefined}
    >
      <div className="progressFill" style={{ width: `${clamped}%` }} data-flash={live ? "changed" : undefined} />
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  const flashKey = useFlashOnChange(value);
  return (
    <section className="stat">
      <Icon aria-hidden="true" size={17} />
      <div>
        <span>{label}</span>
        <strong key={flashKey} data-flash="changed">
          {value}
        </strong>
      </div>
    </section>
  );
}

function uniqById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

async function runtimeRequest(path: string, body?: unknown) {
  const response = await fetch(`/api/agentapp/${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`runtime API failed: ${response.status}`);
  return (await response.json()) as RuntimeState;
}

async function environmentRequest() {
  const response = await fetch("/api/agentapp/environment", { cache: "no-store" });
  if (!response.ok) throw new Error(`environment API failed: ${response.status}`);
  return (await response.json()) as EnvironmentState;
}

function providerForWorker(workerId: string) {
  if (workerId.includes("claude")) return "claude";
  if (workerId.includes("codex")) return "codex";
  if (workerId.includes("cursor")) return "cursor";
  if (workerId.includes("gemini")) return "gemini";
  return "";
}

function profileFor(account: ManagedAccount, complexity: string) {
  // 'auto' / 빈 값 / 미지원 키 면 UI 미리보기 기준 'standard' 로 폴백.
  // (실제 routing 은 백엔드에서 prompt 텍스트로 정확히 재분류함.)
  const key = ["routine", "standard", "complex", "critical"].includes(complexity)
    ? complexity
    : "standard";
  return account.modelProfiles?.[key];
}

function recommendLocalRoute(
  accounts: ManagedAccount[],
  complexity: string,
  workerId: string,
  projectHint?: { lastModel?: string; lastWorker?: string },
) {
  // workerId='auto' 면 모든 provider 허용. 프로젝트의 lastWorker 가 있고
  // 사용자가 명시 worker 를 안 골랐다면 그 worker 를 선호하도록 힌트.
  const explicitProvider = providerForWorker(workerId);
  const hintProvider = projectHint?.lastWorker ? providerForWorker(projectHint.lastWorker) : "";
  const candidates = accounts
    .filter((account) => account.enabled !== false)
    .filter((account) => account.sessionStatus === "ready")
    .filter((account) => {
      // OAuth 신원 mismatch 계정 제외
      const expected = String(account.email || "").trim().toLowerCase();
      const actual = String(account.actualAuthEmail || "").trim().toLowerCase();
      if (expected && actual && expected !== actual) return false;
      // quotaResetAt 미래 계정 제외
      if (account.quotaResetAt) {
        const resetMs = Date.parse(account.quotaResetAt);
        if (Number.isFinite(resetMs) && resetMs > Date.now()) return false;
      }
      return true;
    })
    .filter((account) => !explicitProvider || account.provider === explicitProvider)
    .map((account) => ({ account, profile: profileFor(account, complexity) }))
    .filter(
      (candidate): candidate is { account: ManagedAccount; profile: { model: string; reasoningEffort: string; estimatedUnits: number } } =>
        Boolean(candidate.profile),
    );

  if (candidates.length === 0) return null;

  // 점수: 프로젝트 hint provider 일치 + 모델 일치 + load balance.
  candidates.sort((left, right) => {
    const score = (c: typeof candidates[number]) => {
      let s = 0;
      if (hintProvider && c.account.provider === hintProvider) s += 100;
      if (projectHint?.lastModel && c.profile.model === projectHint.lastModel) s += 50;
      // load balance: 오래 안 쓴 계정 가산
      const lastUsed = c.account.lastUsedAt ? Date.parse(c.account.lastUsedAt) : 0;
      const idleHours = lastUsed > 0 ? Math.max(0, (Date.now() - lastUsed) / 3600000) : 48;
      s += Math.min(idleHours, 24);
      return s;
    };
    return score(right) - score(left);
  });

  const selected = candidates[0];
  return {
    accountId: selected.account.id,
    provider: selected.account.provider,
    loginLabel: selected.account.loginLabel,
    model: projectHint?.lastModel && projectHint.lastModel !== "auto" ? projectHint.lastModel : selected.profile.model,
    reasoningEffort: selected.profile.reasoningEffort,
    estimatedUnits: selected.profile.estimatedUnits,
  };
}

function routeBlockMessage(accounts: ManagedAccount[], workerId: string) {
  const provider = providerForWorker(workerId);
  const matching = accounts.filter((account) => (!provider || account.provider === provider) && account.modelProfiles);
  const enabled = matching.filter((account) => account.enabled !== false);
  const ready = enabled.filter((account) => account.sessionStatus === "ready");
  const usable = ready.filter((account) => {
    const expected = String(account.email || "").trim().toLowerCase();
    const actual = String(account.actualAuthEmail || "").trim().toLowerCase();
    if (expected && actual && expected !== actual) return false;
    if (account.quotaResetAt && new Date(account.quotaResetAt).getTime() > Date.now()) return false;
    return true;
  });

  if (matching.length === 0) return "이 작업 도구에 연결된 계정이 없습니다.";
  if (enabled.length === 0) return "사용 가능한 계정이 없습니다. 토글을 켜 주세요.";
  if (ready.length === 0 && enabled.some((account) => account.actualAuthEmail)) {
    return "인증 계정은 감지됐지만 준비 상태가 아닙니다. 해당 계정에서 재감지를 눌러 ready 상태를 갱신하세요.";
  }
  if (ready.length === 0) return "준비된 세션이 없습니다. 로그인 후 준비 상태로 바꿔 주세요.";
  if (usable.length === 0) {
    const lockedCount = ready.length - usable.length;
    return `사용 가능한 계정이 없습니다 (한도 잠금/신원 mismatch ${lockedCount}건). 사이드바에서 상태 확인.`;
  }
  return "이 작업 난이도에 맞는 모델 프로필이 정의된 계정이 없습니다. 계정의 modelProfiles 설정을 확인하세요.";
}

function isAbsoluteLocalPath(value: string) {
  const text = value.trim();
  return /^[a-zA-Z]:[\\/]/.test(text) || /^\\\\[^\\]+\\[^\\]+/.test(text) || text.startsWith("/");
}

function hasUnsafeSessionProfile(value: string) {
  const text = value.trim();
  return Boolean(text && (text.includes("..") || /^[a-zA-Z]:/.test(text) || text.startsWith("/") || text.startsWith("\\")));
}

function App() {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [error, setError] = React.useState("");
  const [runtime, setRuntime] = React.useState<RuntimeState>(emptyRuntime);
  const [environment, setEnvironment] = React.useState<EnvironmentState | null>(null);
  const [installing, setInstalling] = React.useState(false);
  const [autoInstallAttempted, setAutoInstallAttempted] = React.useState(false);
  const [installLogs, setInstallLogs] = React.useState<{ at: string; level: string; message: string }[]>([]);
  const [runtimeStatus, setRuntimeStatus] = React.useState("로컬 설정 불러오는 중");
  const [lastRuntimeSyncAt, setLastRuntimeSyncAt] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [complexity, setComplexity] = React.useState("auto");
  const [modelOverride, setModelOverride] = React.useState("auto");
  const [showAdvancedModel, setShowAdvancedModel] = React.useState(false);
  const [selectedWorker, setSelectedWorker] = React.useState<string>("auto");
  const [showAdvancedWorker, setShowAdvancedWorker] = React.useState<boolean>(false);
  const [selectedProject, setSelectedProject] = React.useState("current");
  const [projectMeta, setProjectMeta] = React.useState<{
    path?: string;
    has_metadata?: boolean;
    progress?: { total: number; done: number; percent: number; phases: { title: string; total: number; done: number }[] };
    handoff_documents?: { id: string; title: string; path: string; excerpt: string }[];
    workers?: { id: string; display_name: string; kind: string; latest_status: string }[];
    next_task?: { title: string } | null;
  } | null>(null);
  const [accountForm, setAccountForm] = React.useState({
    displayName: "",
    provider: "claude",
    authMethod: "google",
    plan: "pro",
    alias: "",
    email: "",
    loginLabel: "",
    sessionProfile: "",
    secret: "",
  });
  const [accountFormOpen, setAccountFormOpen] = React.useState(false);
  const [projectForm, setProjectForm] = React.useState({ name: "", path: "" });
  const [accountErrors, setAccountErrors] = React.useState<string[]>([]);
  const [projectErrors, setProjectErrors] = React.useState<string[]>([]);
  const [runError, setRunError] = React.useState("");
  // 수동 사용량 편집은 제거됨 — 한도는 worker stderr 패턴 + quota lockout 으로 자동 추적.
  const [now, setNow] = React.useState<number>(Date.now());
  const [activeSection, setActiveSection] = React.useState("run");
  // 메인 패널 모드 — 대시보드(기본), 인앱 브라우저, 인앱 터미널 중 하나. 사이드바
  // nav 의 '브라우저'/'터미널' 클릭으로 전환. 컴팩트 모드(viewMode)와 직교 — 컴팩트
  // 모드에서는 항상 dashboard 패널을 사용.
  const [mainPanel, setMainPanel] = React.useState<"dashboard" | "browser" | "terminal">("dashboard");
  const [viewMode, setViewMode] = React.useState<"full" | "compact">("full");
  // electron preload 가 주입한 IPC bridge. 데스크탑이 아니면 undefined.
  type UpdateStatus = "idle" | "checking" | "current" | "available" | "downloaded" | "error";
  type UpdateState = { status: UpdateStatus; version: string; lastCheckedAt?: number; error?: string };
  const desktopApi = (typeof window !== "undefined" ? (window as unknown as { agentapp?: {
    setWindowMode: (mode: "full" | "compact") => Promise<string>;
    hideToTray: () => Promise<boolean>;
    getWindowMode: () => Promise<string>;
    onWindowModeChanged: (handler: (mode: string) => void) => () => void;
    getAppVersion?: () => Promise<string>;
    getUpdateStatus?: () => Promise<UpdateState>;
    onUpdateStatus?: (handler: (state: UpdateState) => void) => () => void;
    onUpdateAvailable?: (handler: (payload: { version?: string }) => void) => () => void;
    onUpdateDownloaded?: (handler: (payload: { version?: string }) => void) => () => void;
    installUpdate?: () => Promise<boolean>;
    checkForUpdates?: () => Promise<{ ok: boolean; reason?: string }>;
    getLanAccess?: () => Promise<{
      enabled: boolean;
      boundLan: boolean;
      needsRestart: boolean;
      token: string;
      port: number;
      urls: string[];
      entries?: { url: string; address: string; kind: string; interface: string }[];
      ips: string[];
      hasTailscale?: boolean;
    }>;
  } }).agentapp : undefined);
  const [appVersion, setAppVersion] = React.useState<string>("");
  const [updateInfo, setUpdateInfo] = React.useState<UpdateState>({ status: "idle", version: "" });
  type LanEntry = { url: string; address: string; kind: string; interface: string };
  type LanState = {
    enabled: boolean;
    boundLan: boolean;
    needsRestart: boolean;
    token: string;
    port: number;
    urls: string[];
    entries?: LanEntry[];
    ips: string[];
    hasTailscale?: boolean;
  };
  const [lanAccess, setLanAccess] = React.useState<LanState | null>(null);
  const refreshLanAccess = React.useCallback(async () => {
    if (!desktopApi?.getLanAccess) return;
    try {
      const info = await desktopApi.getLanAccess();
      setLanAccess(info);
    } catch {
      setLanAccess(null);
    }
  }, [desktopApi]);
  React.useEffect(() => {
    if (!desktopApi) return;
    let off: (() => void) | undefined;
    void desktopApi.getWindowMode().then((m) => {
      if (m === "compact" || m === "full") setViewMode(m);
    });
    off = desktopApi.onWindowModeChanged((m) => {
      if (m === "compact" || m === "full") setViewMode(m);
    });
    // 버전/업데이트 상태 — 데스크탑일 때만 채운다. 웹에서는 "" 그대로.
    if (desktopApi.getAppVersion) {
      void desktopApi.getAppVersion().then((v) => setAppVersion(String(v || "")));
    }
    if (desktopApi.getUpdateStatus) {
      void desktopApi.getUpdateStatus().then((s) => {
        if (s && s.status) setUpdateInfo(s);
      });
    }
    // LAN 접속 상태 — 토큰/IP/needsRestart 를 모바일 접속 패널에서 표시.
    void refreshLanAccess();
    // 통합 상태 채널 — checking/current/available/downloaded/error 모두 한 채널로.
    // 옛 빌드 호환을 위해 onUpdateAvailable/Downloaded 도 같이 구독한다.
    const offStatus = desktopApi.onUpdateStatus?.((s) => {
      if (s && s.status) setUpdateInfo(s);
    });
    const offAvail = desktopApi.onUpdateAvailable?.((payload) => {
      setUpdateInfo((prev) => prev.status === "downloaded" ? prev : { status: "available", version: String(payload?.version || "") });
    });
    const offDown = desktopApi.onUpdateDownloaded?.((payload) => {
      setUpdateInfo({ status: "downloaded", version: String(payload?.version || "") });
    });
    return () => {
      off?.();
      offStatus?.();
      offAvail?.();
      offDown?.();
    };
  }, [desktopApi]);

  // 헤더 pill 클릭 동작 — 다운로드 완료 상태면 즉시 quitAndInstall, 그 외에는
  // 수동 업데이트 체크를 트리거. X 버튼만 누르면 트레이로 내려가 quit 이
  // 발생 안 해 autoInstallOnAppQuit 가 영원히 안 도는 사용자 케이스 해결.
  const onVersionPillClick = React.useCallback(() => {
    if (!desktopApi) return;
    if (updateInfo.status === "downloaded" && desktopApi.installUpdate) {
      void desktopApi.installUpdate();
    } else if (desktopApi.checkForUpdates) {
      void desktopApi.checkForUpdates();
    }
  }, [desktopApi, updateInfo.status]);
  const toggleViewMode = React.useCallback(() => {
    const next = viewMode === "compact" ? "full" : "compact";
    // 낙관적 업데이트로 UI 가 즉시 반응하게 한다. main 에서 오는
    // window-mode-changed 이벤트는 같은 값으로 다시 한 번 setViewMode 를
    // 호출하지만 React 가 동일 값으로 재렌더링은 막아준다.
    setViewMode(next);
    if (desktopApi) {
      void desktopApi.setWindowMode(next);
    }
  }, [viewMode, desktopApi]);
  const [showMetaPanels, setShowMetaPanels] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("agentapp.showMetaPanels") === "1";
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("agentapp.showMetaPanels", showMetaPanels ? "1" : "0");
    } catch {
      // localStorage may be unavailable
    }
  }, [showMetaPanels]);

  React.useEffect(() => {
    if (selectedProject === "current") {
      setProjectMeta(null);
      return;
    }
    const target = runtime.projects.find((project) => project.id === selectedProject);
    if (!target || !target.path) {
      setProjectMeta(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = (await runtimeRequest("projects/meta", { path: target.path })) as {
          ok?: boolean;
          path?: string;
          has_metadata?: boolean;
          progress?: { total: number; done: number; percent: number; phases: { title: string; total: number; done: number }[] };
          handoff_documents?: { id: string; title: string; path: string; excerpt: string }[];
          workers?: { id: string; display_name: string; kind: string; latest_status: string }[];
          next_task?: { title: string } | null;
        };
        if (cancelled) return;
        if (result?.ok !== false) setProjectMeta(result);
        else setProjectMeta(null);
      } catch {
        if (!cancelled) setProjectMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProject, runtime.projects]);
  const hasActiveRun = Boolean(runtime.activeRun);

  React.useEffect(() => {
    if (!hasActiveRun) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => {
      if (composingRef.current) return;
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [hasActiveRun]);

  // Keep selectedProject in sync with the actual project list. EXE mode hides
  // the self-project card, so a stale "current" selection auto-snaps to the
  // first registered external project (or "none" when the list is empty).
  React.useEffect(() => {
    if (!snapshot) return;
    const ids: string[] = [];
    if (snapshot.repo_root) ids.push("current");
    for (const p of runtime.projects) ids.push(p.id);
    if (ids.length === 0) {
      if (selectedProject !== "none") setSelectedProject("none");
      return;
    }
    if (!ids.includes(selectedProject)) {
      setSelectedProject(ids[0]);
    }
  }, [snapshot, runtime.projects, selectedProject]);

  React.useEffect(() => {
    const sections = ["run", "projects", "accounts", "handoff"]
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (sections.length === 0) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { threshold: [0.35, 0.6], rootMargin: "-10% 0px -50% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [snapshot]);

  React.useEffect(() => {
    fetch("/agent-snapshot.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`snapshot load failed: ${response.status}`);
        return response.json() as Promise<Snapshot>;
      })
      .then(setSnapshot)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "snapshot load failed"));
  }, []);

  const composingRef = React.useRef(false);
  const pendingRuntimeRef = React.useRef<RuntimeState | null>(null);
  const pendingEnvironmentRef = React.useRef<EnvironmentState | null>(null);

  React.useEffect(() => {
    const isFormField = (target: EventTarget | null) =>
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable);

    const onStart = (event: Event) => {
      if (!isFormField(event.target)) return;
      composingRef.current = true;
    };

    const flushPending = () => {
      if (pendingRuntimeRef.current) {
        setRuntime(pendingRuntimeRef.current);
        pendingRuntimeRef.current = null;
      }
      if (pendingEnvironmentRef.current) {
        setEnvironment(pendingEnvironmentRef.current);
        pendingEnvironmentRef.current = null;
      }
    };

    const onEnd = () => {
      composingRef.current = false;
      // Defer one tick so React commits the input's final composed value
      // before reapplying any pending polling updates.
      setTimeout(flushPending, 30);
    };

    document.addEventListener("compositionstart", onStart, true);
    document.addEventListener("compositionend", onEnd, true);
    return () => {
      document.removeEventListener("compositionstart", onStart, true);
      document.removeEventListener("compositionend", onEnd, true);
    };
  }, []);

  const refreshRuntime = React.useCallback(async () => {
    try {
      const next = await runtimeRequest("runtime");
      if (composingRef.current) {
        pendingRuntimeRef.current = next;
        setRuntimeStatus("입력 중 — 동기화 보류");
        return;
      }
      setRuntime(next);
      setRuntimeStatus("로컬 설정 동기화 완료");
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (caught: unknown) {
      setRuntimeStatus(caught instanceof Error ? caught.message : "로컬 설정을 불러올 수 없습니다");
    }
  }, []);

  const refreshEnvironment = React.useCallback(async () => {
    try {
      const next = await environmentRequest();
      if (composingRef.current) {
        pendingEnvironmentRef.current = next;
        return;
      }
      setEnvironment(next);
    } catch {
      setEnvironment(null);
    }
  }, []);

  const installMissingTools = React.useCallback(async (target: string = "ai", mode: "manual" | "auto" = "manual") => {
    const targetLabel = target === "ai" ? "AI CLI" : target === "all" ? "필수 환경/AI CLI" : target;
    setInstalling(true);
    setInstallLogs([
      {
        at: new Date().toISOString(),
        level: "info",
        message:
          mode === "auto"
            ? `메인 화면에서 누락된 ${targetLabel}를 감지해 자동 설치를 시작합니다…`
            : `누락된 ${targetLabel} 설치를 시작합니다…`,
      },
    ]);
    try {
      const response = await fetch("/api/agentapp/environment/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      if (!response.ok) throw new Error(`install API failed: ${response.status}`);
      const result = await response.json() as {
        report: EnvironmentState;
        installed: string[];
        failed: { id: string; error: string }[];
        logs: { at: string; level: string; message: string }[];
      };
      setInstallLogs(result.logs);
      setEnvironment(result.report);
      const installed = result.installed.length;
      const failed = result.failed.length;
      setToast({
        kind: failed > 0 ? "warn" : "success",
        message: failed > 0
          ? `설치 완료 ${installed}개, 실패 ${failed}개. 로그를 확인하세요.`
          : installed > 0
            ? `${installed}개 도구를 설치했습니다. CLI 인증이 필요한 경우 [로그인 시작] 을 사용하세요.`
            : "추가로 설치할 도구가 없습니다.",
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "설치 요청에 실패했습니다";
      setInstallLogs((current) => [...current, { at: new Date().toISOString(), level: "error", message }]);
      setToast({ kind: "warn", message });
    } finally {
      setInstalling(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshRuntime();
    void refreshEnvironment();
  }, [refreshEnvironment, refreshRuntime]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshRuntime();
    }, runtime.activeRun ? 2000 : 5000);

    return () => window.clearInterval(interval);
  }, [refreshRuntime, runtime.activeRun?.id]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshEnvironment();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [refreshEnvironment]);

  const [toast, setToast] = React.useState<{ kind: "success" | "warn" | "info"; message: string } | null>(null);
  const missingInstallableToolCount =
    environment?.targets.filter((target) => !target.ok && target.installable !== false && Boolean(target.installCommand)).length || 0;
  const autoInstallAiCli = environment?.autoInstall?.aiCli !== false;

  React.useEffect(() => {
    if (!autoInstallAiCli || autoInstallAttempted || installing || missingInstallableToolCount === 0) return;
    setAutoInstallAttempted(true);
    void installMissingTools("all", "auto");
  }, [autoInstallAiCli, autoInstallAttempted, installMissingTools, installing, missingInstallableToolCount]);

  React.useEffect(() => {
    if (!toast) return;
    // 사용자 요청: "2초 표시 후 사라짐". 액션이 필요한 알림은 awaitingUserRuns 패널이
    // 별도로 표시해 사라져도 정보는 보존된다.
    const timer = window.setTimeout(() => setToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 런타임 notifications 배열 -> toast 자동 전환. 한 번 표시한 notification 은
  // 서버에 dismiss 요청을 보내 큐에서 제거. 사용자가 dashboard 백그라운드에서
  // 작업 중이면 OS Notification (main.mjs) + 모바일 webhook 으로도 같이 전달됨.
  const lastNotifIdRef = React.useRef<string>("");
  React.useEffect(() => {
    const notifs = runtime.notifications || [];
    if (notifs.length === 0) return;
    const latest = notifs[0];
    if (!latest || latest.id === lastNotifIdRef.current) return;
    lastNotifIdRef.current = latest.id;
    const kindToToast: Record<string, "success" | "warn" | "info"> = {
      completed: "success",
      awaiting: "warn",
      pending: "info",
      blocked: "warn",
      error: "warn",
      info: "info",
    };
    setToast({
      kind: kindToToast[latest.kind] || "info",
      message: latest.title ? `${latest.title} — ${latest.message}` : latest.message,
    });
    // 서버 큐에서 제거 (다음 polling 때 중복 표시 안 하도록)
    void runtimeRequest("notifications/dismiss", { id: latest.id }).catch(() => { /* best-effort */ });
  }, [runtime.notifications]);

  React.useEffect(() => {
    const critical = runtime.accounts.find(
      (account) => account.enabled !== false && usageAlertLevel(account) === "critical",
    );
    if (critical) playCriticalBeep();
  }, [runtime.accounts]);

  const liveUsageRaw = (runtime.accounts || []).reduce(
    (acc, account) => ({
      remaining: acc.remaining + Number(account.remainingUnits || 0),
      weekly: acc.weekly + Number(account.weeklyUnits || 0),
    }),
    { remaining: 0, weekly: 0 },
  );
  const environmentPercentRaw = environment
    ? Math.round((environment.summary.ok / Math.max(1, environment.summary.total)) * 100)
    : 0;

  const usageFlashKey = useFlashOnChange(liveUsageRaw.remaining);
  const environmentFlashKey = useFlashOnChange(environmentPercentRaw);

  if (error) {
    return (
      <main className="shell">
        <section className="notice">
          <AlertCircle aria-hidden="true" />
          <strong>{error}</strong>
        </section>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="shell">
        <section className="notice">
          <TimerReset aria-hidden="true" />
          <strong>작업 공간 불러오는 중</strong>
        </section>
      </main>
    );
  }

  // EXE/installed mode sends an empty repo_root (it's just AgentApp's own
  // userData folder, not a workspace). Skip the self-project card in that
  // case — the sidebar shows registered external projects only.
  const currentProject: ManagedProject | null = snapshot.repo_root
    ? {
        id: "current",
        name: "AgentApp",
        path: snapshot.repo_root,
        status: "active",
        progress: snapshot.progress.percent,
      }
    : null;
  const projects = uniqById([
    ...(currentProject ? [currentProject] : []),
    ...runtime.projects,
  ]);
  const configuredAccounts: ManagedAccount[] = snapshot.usage_budget.accounts.map((account) => ({
    id: account.id,
    displayName: account.id,
    provider: account.provider,
    plan: account.plan,
    loginLabel: "configured",
    authMethod: "manual",
    sessionProfile: `${account.provider}/configured`,
    credentialStatus: "empty",
    enabled: true,
    sessionStatus: "ready",
    remainingUnits: account.remaining_units,
    weeklyUnits: account.weekly_budget_units,
    resetDay: account.reset_day,
    source: "config",
    modelProfiles: undefined,
  }));
  const accounts = uniqById([...configuredAccounts, ...runtime.accounts]);
  const localAccounts = runtime.accounts;
  const readyLocalAccounts = localAccounts.filter((account) => account.enabled !== false && account.sessionStatus === "ready");
  // 프로젝트 최근 사용 이력 (lastWorker / lastModel) 을 라우팅 힌트로 전달
  // 해서 UI 미리보기와 백엔드 startRun 의 실제 라우팅이 같은 후보를 고르도록.
  const selectedProjectRow = runtime.projects.find((project) => project.id === selectedProject);
  const localRecommendation = recommendLocalRoute(
    accounts,
    complexity,
    selectedWorker,
    selectedProjectRow ? { lastModel: selectedProjectRow.lastModel, lastWorker: selectedProjectRow.lastWorker } : undefined,
  );
  const placeholderProject: ManagedProject = {
    id: "none",
    name: "프로젝트 추가",
    path: "",
    status: "registered",
    progress: 0,
  };
  const selectedProjectRecord: ManagedProject =
    projects.find((project) => project.id === selectedProject) ||
    currentProject ||
    projects[0] ||
    placeholderProject;
  const activeRun = runtime.activeRun;
  // 현재 실행 패널은 선택된 프로젝트 기준으로만 active run / pending / history 를
  // 표시해야 한다. 다중 active run 환경에서는 runtime.activeRuns 배열에 여러
  // 프로젝트의 running run 이 동시에 있을 수 있으므로 선택된 프로젝트의 run 만
  // 찾는다. runtime.activeRun 은 backward compat 단일 슬롯이라 fallback 으로만 사용.
  const activeRunForSelectedProject = (
    (runtime.activeRuns || []).find(
      (r) => r?.projectId === selectedProjectRecord.id && r?.status === "running",
    )
    || (activeRun && activeRun.projectId === selectedProjectRecord.id && activeRun.status === "running" ? activeRun : null)
  );
  const pendingRunsForSelectedProject = (runtime.pendingRuns || []).filter(
    (pending) => pending.projectId === selectedProjectRecord.id,
  );
  const runHistoryForSelectedProject = runtime.runHistory.filter(
    (run) => run.projectId === selectedProjectRecord.id,
  );
  // 사용자 답변을 기다리는 stopped run — 가장 최근 것만 보여줘서 답변 입력 가능하게.
  // 같은 run 에 답변 보내면 awaitingUserInput=false 로 갱신돼 자동으로 패널이 사라진다.
  const awaitingUserRuns = runHistoryForSelectedProject
    .filter((run) => run.awaitingUserInput === true)
    .slice(0, 1);
  const approvalCount = snapshot.approval_queue.pending_decisions.length + snapshot.approval_queue.held_tasks.length;
  // 선택된 프로젝트가 외부 프로젝트면 그 프로젝트의 NEXT_TASK 만 사용.
  // (없으면 chip 자체를 숨기기 위해 빈 문자열 유지 — AgentApp 자체 NEXT_TASK 로 폴백하면
  // 사용자가 외부 프로젝트 컨텍스트에서 엉뚱한 작업 제안을 보게 됨.)
  const isExternalProject = selectedProject !== "current";
  const rawNextTask = isExternalProject
    ? projectMeta?.next_task?.title || ""
    : snapshot.next_task.title === "none"
      ? ""
      : snapshot.next_task.title;
  const nextTaskTitle = rawNextTask || (isExternalProject ? "" : "다음 계획 작성");
  const liveUsage = accounts.reduce(
    (acc, account) => ({
      remaining: acc.remaining + Number(account.remainingUnits || 0),
      weekly: acc.weekly + Number(account.weeklyUnits || 0),
    }),
    { remaining: 0, weekly: 0 },
  );
  const liveUsagePercent = liveUsage.weekly > 0 ? Math.round((liveUsage.remaining / liveUsage.weekly) * 100) : 0;
  const environmentPercent = environmentPercentRaw;
  const missingEnvironment = environment?.targets.filter((target) => !target.ok) || [];
  const missingInstallableTools = missingEnvironment.filter(
    (target) => target.installable !== false && Boolean(target.installCommand),
  );

  async function updateRuntime(operation: Promise<RuntimeState>) {
    try {
      const next = await operation;
      setRuntime(next);
      setRuntimeStatus("로컬 설정 동기화 완료");
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (caught) {
      setRuntimeStatus(caught instanceof Error ? caught.message : "로컬 설정 업데이트에 실패했습니다");
    }
  }

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = accountForm.email.trim().toLowerCase();
    const alias =
      accountForm.alias.trim() ||
      `${accountForm.provider}-${email ? email.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") : Date.now()}`;
    const errors = [];
    if (!alias) errors.push("계정 별칭을 만들 수 없습니다.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("이메일 형식을 확인하세요.");
    if (accounts.some((account) => account.id === alias)) errors.push("이미 사용 중인 계정 별칭입니다.");
    if (hasUnsafeSessionProfile(accountForm.sessionProfile)) errors.push("세션 프로필은 상대 이름만 사용할 수 있습니다.");
    if (errors.length > 0) {
      setAccountErrors(errors);
      setToast({ kind: "warn", message: errors[0] });
      return;
    }
    setAccountErrors([]);

    try {
      const next = await runtimeRequest("accounts", {
        id: alias,
        displayName: accountForm.displayName.trim() || alias,
        provider: accountForm.provider,
        authMethod: accountForm.authMethod,
        plan: accountForm.plan,
        email,
        loginLabel: accountForm.loginLabel || email || alias,
        sessionProfile: accountForm.sessionProfile,
        secret: accountForm.secret,
        enabled: true,
      });
      setRuntime(next);
      setRuntimeStatus("로컬 설정 동기화 완료");
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
      const added = next.accounts.find((account) => account.id === alias);
      if (added) {
        const kind = added.sessionStatus === "ready" ? "success" : "warn";
        setToast({
          kind,
          message:
            added.sessionStatus === "ready"
              ? `'${added.displayName || added.id}' 계정이 자동으로 준비 상태로 연동됐습니다.`
              : `'${added.displayName || added.id}' 계정이 추가됐지만 아직 로그인이 필요합니다. ${added.sessionDetectionReason || ""}`,
        });
      }
    } catch (caught) {
      setRuntimeStatus(caught instanceof Error ? caught.message : "계정 추가에 실패했습니다");
      setToast({ kind: "warn", message: "계정 추가에 실패했습니다" });
    }
    setAccountForm({
      ...accountForm,
      displayName: "",
      alias: "",
      email: "",
      loginLabel: "",
      sessionProfile: "",
      secret: "",
    });
    setAccountFormOpen(false);
  }

  async function browseProjectPath() {
    try {
      const result = (await runtimeRequest("projects/browse", {
        defaultPath: projectForm.path || undefined,
      })) as { path?: string; canceled?: boolean; reason?: string };
      if (result?.path) {
        setProjectForm((current) => ({ ...current, path: result.path || "" }));
      } else if (!result?.canceled && result?.reason) {
        setToast({ kind: "warn", message: `폴더 선택을 열 수 없습니다: ${result.reason}` });
      }
    } catch (caught) {
      setToast({
        kind: "warn",
        message: caught instanceof Error ? caught.message : "폴더 선택에 실패했습니다",
      });
    }
  }

  function deleteProject(project: ManagedProject) {
    if (project.id === "current") return;
    if (!window.confirm(`'${project.name}' 프로젝트를 목록에서 제거할까요? (실제 폴더는 삭제되지 않습니다)`)) return;
    void updateRuntime(runtimeRequest("projects/delete", { id: project.id }));
    if (selectedProject === project.id) {
      const next = (currentProject?.id) || runtime.projects.find((p) => p.id !== project.id)?.id || "none";
      setSelectedProject(next);
    }
  }

  function addProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectPath = projectForm.path.trim();
    const name = projectForm.name.trim() || projectPath.split(/[\\/]/).filter(Boolean).at(-1) || "로컬 프로젝트";
    const errors = [];
    if (!projectPath) errors.push("프로젝트 경로를 입력하세요.");
    if (projectPath && !isAbsoluteLocalPath(projectPath)) errors.push("프로젝트 경로는 절대 경로로 입력하세요.");
    if (projects.some((project) => project.path.toLowerCase() === projectPath.toLowerCase())) {
      errors.push("이미 등록된 프로젝트 경로입니다.");
    }
    if (errors.length > 0) {
      setProjectErrors(errors);
      setToast({ kind: "warn", message: errors[0] });
      return;
    }
    setProjectErrors([]);

    void updateRuntime(runtimeRequest("projects", { id: `local-${Date.now()}`, name, path: projectPath }));
    setProjectForm({ name: "", path: "" });
  }

  async function startRun() {
    const text = prompt.trim() || nextTaskTitle;
    if (!localRecommendation) {
      const message = routeBlockMessage(accounts, selectedWorker);
      setRunError(message);
      setToast({ kind: "warn", message });
      return;
    }
    // 같은 프로젝트가 이미 실행 중이면 차단. 다른 프로젝트는 동시 실행 허용
    // (다중 active run 모델 — server side 가드도 active_run_running_for_project 로 차단).
    if (activeRunForSelectedProject && activeRunForSelectedProject.status === "running") {
      const message = "이 프로젝트는 이미 실행 중입니다. 먼저 중지하거나 '다른 계정으로 이어가기' 를 사용하세요. (다른 프로젝트는 사이드바에서 자유롭게 시작 가능합니다)";
      setRunError(message);
      setToast({ kind: "warn", message });
      return;
    }
    setRunError("");
    try {
      const next = (await runtimeRequest("runs/start", {
        workerId: selectedWorker,
        projectId: selectedProjectRecord.id,
        prompt: text,
        complexity,
        modelOverride,
      })) as RuntimeState & { startRejected?: { reason: string; message: string } };
      setRuntime(next);
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
      if (next.startRejected) {
        setRunError(next.startRejected.message);
        setToast({ kind: "warn", message: next.startRejected.message });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "작업 시작에 실패했습니다";
      setRunError(message);
      setToast({ kind: "warn", message });
    }
  }

  function stopRun() {
    // 다중 active run 환경 — 선택된 프로젝트의 run 만 정지. body 의 runId 가
    // 비어 있으면 모든 active 정지하므로 명시 전달.
    const runId = activeRunForSelectedProject?.id || "";
    if (!runId) return;
    void updateRuntime(runtimeRequest("runs/stop", { runId }));
  }

  // 대기 큐 항목 삭제/재시작 (사용자가 "영원히 대기" 상황을 직접 해결).
  async function cancelPending(id: string) {
    try {
      const next = (await runtimeRequest("runs/pending/cancel", { id })) as RuntimeState;
      setRuntime(next);
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (caught) {
      setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "대기 항목 삭제 실패" });
    }
  }
  async function retryPending(id: string) {
    try {
      const next = (await runtimeRequest("runs/pending/retry", { id })) as RuntimeState & {
        startRejected?: { reason: string; message: string };
      };
      setRuntime(next);
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
      if (next.startRejected) {
        setToast({ kind: "warn", message: next.startRejected.message });
      }
    } catch (caught) {
      setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "대기 항목 재시작 실패" });
    }
  }
  // 사용자 답변 입력으로 이어 진행 — awaitingUserInput run 에 prompt 보냄.
  async function resumeRunWithInput(runId: string, userText: string) {
    if (!userText.trim()) {
      setToast({ kind: "warn", message: "답변 내용을 입력하세요." });
      return;
    }
    try {
      const next = (await runtimeRequest("runs/resume", { runId, prompt: userText })) as RuntimeState & {
        startRejected?: { reason: string; message: string };
      };
      setRuntime(next);
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
      if (next.startRejected) {
        setToast({ kind: "warn", message: next.startRejected.message });
      } else {
        setToast({ kind: "success", message: "답변을 worker 에 전달해 이어 진행합니다." });
      }
    } catch (caught) {
      setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "이어 진행 실패" });
    }
  }

  async function quickSwitchAccount(targetAccountId?: string) {
    try {
      const next = (await runtimeRequest("handoff/quickswitch", {
        targetAccountId,
        prompt: prompt.trim() || activeRun?.prompt,
        complexity,
        modelOverride,
      })) as RuntimeState & { handoff?: { status: string; reason: string } };
      setRuntime(next);
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
      if (next.handoff) {
        setToast({
          kind: next.handoff.status === "started" ? "success" : "warn",
          message: next.handoff.reason,
        });
      }
    } catch (caught) {
      setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "계정 인계에 실패했습니다" });
    }
  }

  function toggleAccount(account: ManagedAccount) {
    void updateRuntime(runtimeRequest("accounts/enabled", { ...account, enabled: !account.enabled }));
  }

  async function startLogin(account: ManagedAccount) {
    try {
      const next = await runtimeRequest("accounts/login", { id: account.id });
      setRuntime(next);
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
      setToast({ kind: "info", message: `'${account.displayName || account.id}' 로그인을 위해 새 콘솔 창을 열었습니다. 그 창의 안내(URL/코드)를 따라 인증을 마친 뒤 [재감지]를 누르세요.` });
    } catch (caught) {
      setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "로그인 시작에 실패했습니다" });
    }
  }

  async function detectSession(account: ManagedAccount) {
    try {
      const next = await runtimeRequest("accounts/detect", { id: account.id });
      setRuntime(next);
      setRuntimeStatus("로컬 설정 동기화 완료");
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
      const updated = next.accounts.find((item) => item.id === account.id);
      if (updated) {
        setToast({
          kind: updated.sessionStatus === "ready" ? "success" : "warn",
          message:
            updated.sessionStatus === "ready"
              ? `'${updated.displayName || updated.id}' 세션이 준비 상태입니다.`
              : `'${updated.displayName || updated.id}' 아직 로그인 필요: ${updated.sessionDetectionReason || ""}`,
        });
      }
    } catch (caught) {
      setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "재감지에 실패했습니다" });
    }
  }

  function deleteAccount(account: ManagedAccount) {
    if (account.source !== "local") return;
    if (!window.confirm(`'${account.displayName || account.id}' 계정을 삭제할까요?`)) return;
    void updateRuntime(runtimeRequest("accounts/delete", { id: account.id }));
  }

  async function probeAccount(account: ManagedAccount) {
    setToast({ kind: "info", message: `'${account.displayName || account.id}' 토큰 확인 중…` });
    try {
      const result = (await runtimeRequest("accounts/probe", {
        id: account.id,
        force: true,
      })) as { ok?: boolean; reason?: string };
      // 결과 반영 위해 runtime 다시 새로고침
      await refreshRuntime();
      if (result?.ok) {
        setToast({ kind: "success", message: `'${account.displayName || account.id}' 잠금 해제 완료. 다시 사용 가능합니다.` });
      } else if (result?.reason === "throttled") {
        setToast({ kind: "warn", message: "최근에 점검했습니다. 10분 후 다시 시도해 주세요." });
      } else {
        setToast({ kind: "warn", message: `여전히 잠금 상태 (${result?.reason || "unknown"}). reset 시각을 더 기다리세요.` });
      }
    } catch (caught) {
      setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "토큰 점검 실패" });
    }
  }

  if (viewMode === "compact") {
    // 컴팩트 채팅 모드 — 프로젝트 목록과 현재 작업 진행만 남긴다.
    const compactProjects = projects.filter((p) => p.id !== "none");
    const compactSelected =
      compactProjects.find((p) => p.id === selectedProject) || compactProjects[0] || null;
    // 다중 active run — activeRuns 배열에서 이 프로젝트의 running run 우선 검색.
    const activeForProject = (
      (runtime.activeRuns || []).find(
        (r) => r?.projectId === (compactSelected?.id || "") && r?.status === "running",
      )
      || (activeRun && activeRun.projectId === (compactSelected?.id || "") && activeRun.status === "running" ? activeRun : null)
    );
    const historyForProject = !activeForProject && compactSelected
      ? runtime.runHistory.find((r) => r.projectId === compactSelected.id) || null
      : null;
    const focusRun = activeForProject || historyForProject;
    const events = focusRun?.events || [];
    const visibleEvents = events
      .filter((event) => !NOISY_EVENT_RE.test(event.message))
      .slice(-80);
    const isRunning = Boolean(activeForProject);
    const projectProgress = compactSelected?.id !== "current" && projectMeta?.progress
      ? projectMeta.progress.percent
      : compactSelected?.progress ?? snapshot.progress.percent;
    const projectNextTask = compactSelected?.id !== "current"
      ? projectMeta?.next_task?.title || ""
      : snapshot.next_task.title === "none" ? "" : snapshot.next_task.title;
    const lastMessage = focusRun?.adapter?.lastMessageText || "";
    const latestEvent = visibleEvents[visibleEvents.length - 1];
    return (
      <main className="appShell compactShell">
        {toast ? (
          <div className={`toast ${toast.kind}`} role="status">
            <span>{toast.message}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="알림 닫기">×</button>
          </div>
        ) : null}
        <header className="compactHeader">
          <div className="compactBrand">
            <Bot aria-hidden="true" size={16} />
            <strong>AgentApp</strong>
            {appVersion ? (
              <button
                type="button"
                className={`compactVersion status${updateInfo.status === "downloaded" ? "Downloaded" : updateInfo.status === "available" ? "Available" : "Ok"}`}
                title={
                  updateInfo.status === "downloaded"
                    ? `클릭하여 v${updateInfo.version} 즉시 재시작 적용`
                    : updateInfo.status === "available"
                      ? `v${updateInfo.version} 다운로드 중`
                      : "클릭하여 업데이트 지금 확인"
                }
                onClick={onVersionPillClick}
              >
                v{appVersion}
                {updateInfo.status === "downloaded" ? ` → v${updateInfo.version}▶` : updateInfo.status === "available" ? ` → v${updateInfo.version}↓` : ""}
              </button>
            ) : null}
          </div>
          <div className="compactHeaderActions">
            <button
              type="button"
              className="ghostButton small"
              title="전체 화면으로 전환"
              onClick={toggleViewMode}
            >
              전체화면
            </button>
            <button
              type="button"
              className="ghostButton small"
              title="트레이로 숨기기"
              onClick={() => desktopApi?.hideToTray()}
              disabled={!desktopApi}
            >
              숨김
            </button>
          </div>
        </header>
        <div className="compactWorkspace">
          <aside className="compactProjectRail" aria-label="프로젝트">
            {compactProjects.length === 0 ? (
              <div className="compactEmptyHint">프로젝트 없음</div>
            ) : (
              compactProjects.map((p) => {
                const isSel = compactSelected?.id === p.id;
                // 다중 active run — runtime.activeRuns 배열에서 이 프로젝트의 running run 검색.
                // activeRun (단일) 도 backward compat 으로 같이 본다.
                const projActiveRun =
                  (runtime.activeRuns || []).find((r) => r?.projectId === p.id && r?.status === "running")
                  || (activeRun?.projectId === p.id && activeRun.status === "running" ? activeRun : null);
                const projActive = Boolean(projActiveRun);
                const lastRun = runtime.runHistory.find((run) => run.projectId === p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`compactProjectItem${isSel ? " selected" : ""}${projActive ? " running" : ""}`}
                    onClick={() => setSelectedProject(p.id)}
                    title={p.path || p.name}
                  >
                    <span className="compactProjectName">
                      {projActive ? <span className="compactDot" aria-hidden="true" /> : null}
                      {p.name}
                    </span>
                    <span className="compactProjectSub">
                      {projActive
                        ? "실행 중"
                        : lastRun
                          ? STATUS_LABELS[lastRun.status] || lastRun.status
                          : `${Math.round(p.progress || 0)}%`}
                    </span>
                  </button>
                );
              })
            )}
          </aside>

          <section className="compactWorkPane">
            <div className="compactPromptDock">
              <div className="compactProjectSummary">
                <div>
                  <strong>{compactSelected?.name || "프로젝트 없음"}</strong>
                  <span>{compactSelected?.path || "프로젝트를 선택하세요"}</span>
                </div>
                {focusRun ? (
                  <span className={`compactStatusBadge status-${focusRun.status || "unknown"}`}>
                    {STATUS_LABELS[focusRun.status] || focusRun.status || "—"}
                  </span>
                ) : null}
              </div>
              {focusRun?.currentStatus ? (
                <div className="compactNowDoing" title="worker 가 [STATUS] 마커로 보고한 현재 작업">
                  <span className="compactNowDoingDot" aria-hidden="true" />
                  <span className="compactNowDoingText">{focusRun.currentStatus}</span>
                </div>
              ) : null}
              <form
                className="compactComposer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isRunning) return;
                  startRun();
                }}
              >
                <textarea
                  value={prompt}
                  placeholder={isRunning ? "실행 중" : "작업 지시 입력"}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isRunning}
                  aria-label="컴팩트 모드 프롬프트 입력"
                />
                <button
                  type={isRunning ? "button" : "submit"}
                  className={isRunning ? "dangerButton small" : "primaryButton small"}
                  onClick={isRunning ? stopRun : undefined}
                  disabled={!isRunning && !localRecommendation}
                  title={isRunning ? "현재 실행 중지" : "프롬프트로 새 작업 시작"}
                >
                  {isRunning ? "중지" : "시작"}
                </button>
              </form>
            </div>

            <section className="compactProjectContent">
              <div className="compactProjectCard">
                <span>진행률</span>
                <strong>{Math.round(projectProgress || 0)}%</strong>
              </div>
              <div className="compactProjectCard wide">
                <span>다음 작업</span>
                <strong>{projectNextTask || "대기 중"}</strong>
              </div>
              {focusRun ? (
                <div className="compactProjectCard wide">
                  <span>최근 실행</span>
                  <strong>
                    {focusRun.workerId}
                    {focusRun.routing?.model ? ` / ${focusRun.routing.model}` : ""}
                  </strong>
                </div>
              ) : null}
              {latestEvent ? (
                <div className={`compactLatestEvent level-${latestEvent.level || "info"}`}>
                  <time>{compactEventTime(latestEvent.at)}</time>
                  <span>{summarizeEvent(latestEvent.message)}</span>
                </div>
              ) : null}
              {lastMessage ? (
                <article className="compactLastMessage">
                  <MarkdownText source={lastMessage} />
                </article>
              ) : null}
            </section>

            <section
              className="compactEventList"
              ref={(node) => {
                if (node) node.scrollTop = node.scrollHeight;
              }}
            >
              {visibleEvents.length === 0 ? (
                <div className="compactEventEmpty">진행 내역 없음</div>
              ) : (
                visibleEvents.map((event, idx) => (
                  <div key={`${event.at}-${idx}`} className={`compactEventRow level-${event.level || "info"}`}>
                    <time>{compactEventTime(event.at)}</time>
                    <span>{summarizeEvent(event.message)}</span>
                  </div>
                ))
              )}
            </section>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className={`appShell${mainPanel !== "dashboard" ? " inAppPanelMode" : ""}`}>
      {toast ? (
        <div className={`toast ${toast.kind}`} role="status">
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="알림 닫기">×</button>
        </div>
      ) : null}
      {mainPanel === "browser" ? (
        <BrowserPanel onClose={() => setMainPanel("dashboard")} />
      ) : null}
      {mainPanel === "terminal" ? (
        <TerminalPanel onClose={() => setMainPanel("dashboard")} />
      ) : null}
      <aside className="sidebar">
        <div className="brand">
          <Bot aria-hidden="true" size={22} />
          <div>
            <strong>AgentApp</strong>
            <span>통합 에이전트 콘솔</span>
          </div>
        </div>

        <nav className="navStack" aria-label="작업 영역 섹션">
          <a className={mainPanel === "dashboard" && activeSection === "run" ? "active" : ""} href="#run"
            onClick={(e) => { e.preventDefault(); setMainPanel("dashboard"); setActiveSection("run"); }}>
            <Zap aria-hidden="true" size={16} />
            실행
          </a>
          <a className={mainPanel === "dashboard" && activeSection === "projects" ? "active" : ""} href="#projects"
            onClick={(e) => { e.preventDefault(); setMainPanel("dashboard"); setActiveSection("projects"); }}>
            <FolderGit2 aria-hidden="true" size={16} />
            프로젝트
          </a>
          <a className={mainPanel === "dashboard" && activeSection === "accounts" ? "active" : ""} href="#accounts"
            onClick={(e) => { e.preventDefault(); setMainPanel("dashboard"); setActiveSection("accounts"); }}>
            <KeyRound aria-hidden="true" size={16} />
            계정
          </a>
          <a className={mainPanel === "dashboard" && activeSection === "handoff" ? "active" : ""} href="#handoff"
            onClick={(e) => { e.preventDefault(); setMainPanel("dashboard"); setActiveSection("handoff"); }}>
            <ClipboardList aria-hidden="true" size={16} />
            인수인계
          </a>
          <a className={mainPanel === "browser" ? "active" : ""} href="#browser"
            onClick={(e) => { e.preventDefault(); setMainPanel("browser"); }}
            title="인앱 웹 브라우저 — 외부 사이트를 안전한 격리 환경에서 열기">
            <Globe aria-hidden="true" size={16} />
            브라우저
          </a>
          <a className={mainPanel === "terminal" ? "active" : ""} href="#terminal"
            onClick={(e) => { e.preventDefault(); setMainPanel("terminal"); }}
            title="인앱 터미널 — 시스템 셸 (PowerShell/cmd/bash) 을 직접 실행">
            <TerminalIcon aria-hidden="true" size={16} />
            터미널
          </a>
        </nav>

        <section className="sidebarBlock" id="projects">
          <div className="sectionTitle compact">
            <h2>프로젝트</h2>
            <FolderGit2 aria-hidden="true" size={16} />
          </div>
          <div className="projectList">
            {projects.map((project) => (
              <div
                className={`projectRow ${project.id === selectedProject ? "selected" : ""}`}
                key={project.id}
              >
                <button
                  className="projectButton"
                  type="button"
                  title={`${project.name} 프로젝트를 현재 작업 대상으로 선택합니다`}
                  onClick={() => setSelectedProject(project.id)}
                >
                  <span>{project.name}</span>
                  <small>{project.path}</small>
                  <ProgressBar value={project.progress} />
                </button>
                {project.id !== "current" ? (
                  <button
                    className="projectDeleteBtn"
                    type="button"
                    title="이 프로젝트를 목록에서 제거합니다 (실제 폴더는 삭제되지 않습니다)"
                    onClick={() => void deleteProject(project)}
                  >
                    <Trash2 aria-hidden="true" size={13} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <form className="miniForm" onSubmit={addProject}>
            <input
              aria-label="프로젝트 이름"
              placeholder="프로젝트 이름"
              title="사이드바에 표시할 프로젝트 이름입니다. 비워두면 경로 마지막 폴더명을 사용합니다"
              value={projectForm.name}
              onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })}
            />
            <div className="pathPickerRow">
              <input
                aria-label="프로젝트 경로"
                placeholder="C:\\path\\to\\your\\project"
                title="로컬 프로젝트 절대 경로를 입력합니다"
                value={projectForm.path}
                onChange={(event) => setProjectForm({ ...projectForm, path: event.target.value })}
              />
              <button
                type="button"
                className="button ghost pathBrowseBtn"
                title="파일 탐색기에서 폴더를 선택합니다"
                onClick={() => void browseProjectPath()}
              >
                찾아보기
              </button>
            </div>
            {projectErrors.length > 0 ? (
              <div className="formError" role="alert">
                {projectErrors.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
            <IconButton icon={Plus} type="submit" title="새 로컬 프로젝트를 목록에 추가합니다">
              추가
            </IconButton>
          </form>
        </section>

        <RuntimeSettingsPanel
          settings={runtime.settings}
          onSave={async (next) => {
            try {
              const result = await runtimeRequest("settings", next);
              setRuntime(result as RuntimeState);
              setToast({ kind: "success", message: "자율 진행 설정을 저장했습니다." });
            } catch (caught) {
              setToast({
                kind: "warn",
                message: caught instanceof Error ? caught.message : "설정 저장 실패",
              });
            }
          }}
        />

        <section className="sidebarBlock" id="accounts">
          <div className="sectionTitle compact">
            <h2>계정</h2>
            <UserCheck aria-hidden="true" size={16} />
          </div>
          <div className="runtimeStatus">{runtimeStatus}</div>
          <div className="setupStrip">
            <strong>
              {readyLocalAccounts.length}/{localAccounts.length}
            </strong>
            <span>준비된 세션 프로필 수</span>
          </div>
          <div className="accountList">
            {localAccounts.length === 0 ? (
              <p className="emptyState">로컬 계정이 없습니다. 계정 추가 후 공식 도구에서 인증을 완료하면 실행 후보에 들어갑니다.</p>
            ) : null}
            {accounts.map((account) => {
              const isQuotaLocked = Boolean(
                account.quotaResetAt && new Date(account.quotaResetAt).getTime() > Date.now(),
              );
              return (
                <article
                  className={`accountItem ${isQuotaLocked ? "usage-critical" : "usage-ok"} ${account.enabled === false ? "disabled" : ""}`}
                  key={account.id}
                >
                  <header>
                    <div className="accountNameRow">
                      <strong>{account.displayName || account.id}</strong>
                      {account.source === "config" ? (
                        <span className="badge example" title="usage-budget.example.json 의 예시 데이터입니다. 실제 본인 계정으로 사용하려면 사이드바에서 새 계정을 추가하세요.">예시</span>
                      ) : null}
                      {isQuotaLocked ? (
                        <span
                          className="badge alertCritical"
                          title={`provider 가 한도 초과 메시지를 보내 ${new Date(account.quotaResetAt!).toLocaleString("ko-KR")} 까지 자동 잠겼습니다.`}
                        >
                          ⏳ 한도 잠금
                        </span>
                      ) : null}
                    </div>
                    <label className="enableToggle">
                      <input
                        checked={account.enabled !== false}
                        disabled={account.source !== "local"}
                        type="checkbox"
                        title="이 계정을 자동 라우팅 후보에 포함하거나 제외합니다"
                        onChange={() => toggleAccount(account)}
                      />
                      <span>{account.enabled === false ? "꺼짐" : "사용"}</span>
                    </label>
                  </header>
                  <small>
                    {providerLabel(account.provider)} / {authMethodLabel(account.authMethod)} / {account.email || account.loginLabel} /{" "}
                    {account.credentialStatus === "stored" ? "암호 저장됨" : "암호 없음"}
                  </small>
                  <small>{account.sessionProfile || "세션 프로필 미지정"}</small>
                  <div className="sessionRow">
                    <StatusPill status={account.sessionStatus || "needs-login"} />
                    <div className="sessionActions">
                      {account.sessionStatus !== "ready" && account.source === "local" ? (
                        <button
                          className="segButton primary"
                          type="button"
                          title="이 계정의 공식 CLI 로그인 명령을 띄웁니다. 브라우저나 콘솔에서 직접 인증한 뒤 재감지를 눌러 주세요."
                          onClick={() => startLogin(account)}
                        >
                          로그인 시작
                        </button>
                      ) : null}
                      <button
                        className="segButton"
                        type="button"
                        disabled={account.source !== "local"}
                        title="현재 PC에서 이 계정의 세션 상태를 다시 감지합니다"
                        onClick={() => detectSession(account)}
                      >
                        <RefreshCcw aria-hidden="true" size={12} />
                        재감지
                      </button>
                      <button
                        className="segButton danger"
                        disabled={account.source !== "local"}
                        type="button"
                        title={
                          account.source === "local"
                            ? "직접 추가한 계정을 삭제합니다"
                            : "예산 스냅샷에서 온 계정은 여기서 삭제하지 않습니다"
                        }
                        onClick={() => deleteAccount(account)}
                      >
                        <Trash2 aria-hidden="true" size={12} />
                        삭제
                      </button>
                    </div>
                  </div>
                  {account.actualAuthEmail && account.email && account.actualAuthEmail !== account.email.toLowerCase() ? (
                    <small className="identityMismatch" role="alert">
                      ⚠ 실제 인증된 계정: <strong>{account.actualAuthEmail}</strong> — 설정한 {account.email} 과 다릅니다. 다시 로그인하세요.
                    </small>
                  ) : account.actualAuthEmail ? (
                    <small className="identityOk">✓ 인증: {account.actualAuthEmail}</small>
                  ) : null}
                  {account.quotaResetAt && new Date(account.quotaResetAt).getTime() > Date.now() ? (
                    <small className="quotaLockout" role="alert">
                      <span>⏳ 사용량 한도 — <strong>{new Date(account.quotaResetAt).toLocaleString("ko-KR")}</strong> 까지 자동 잠금</span>
                      <button
                        type="button"
                        className="probeBtn"
                        title="이 계정에 가장 저렴한 모델로 짧은 ping 을 보내 토큰이 실제로 살아 있는지 확인합니다. 정상 응답이면 잠금이 즉시 해제됩니다."
                        onClick={() => void probeAccount(account)}
                      >
                        ↻ 잠금 점검
                      </button>
                      <button
                        type="button"
                        className="probeBtn"
                        title="자동 감지가 오판했을 때만 사용. 잠금 즉시 해제 (다음 작업에서 후보로 다시 포함)."
                        onClick={async () => {
                          try {
                            const next = (await runtimeRequest("accounts/clear-quota", { id: account.id })) as { ok?: boolean; runtime?: RuntimeState };
                            if (next.runtime) setRuntime(next.runtime);
                            setToast({ kind: "info", message: `'${account.displayName || account.id}' 한도 잠금을 강제 해제했습니다.` });
                          } catch (caught) {
                            setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "잠금 해제 실패" });
                          }
                        }}
                      >
                        ✕ 강제 해제
                      </button>
                    </small>
                  ) : null}
                  {account.sessionDetectionReason ? (
                    <small className="detectionReason">{account.sessionDetectionReason}</small>
                  ) : null}
                  <small className="planRow">
                    {planLabel(account.plan)} · 한도 도달 시 자동 잠금
                  </small>
                </article>
              );
            })}
          </div>
          <div className="accountFormToggle">
            <IconButton
              icon={accountFormOpen ? Square : Plus}
              variant={accountFormOpen ? "ghost" : "primary"}
              title={accountFormOpen ? "계정 추가 폼을 닫습니다" : "새 계정을 추가하는 폼을 펼칩니다"}
              onClick={() => setAccountFormOpen(!accountFormOpen)}
            >
              {accountFormOpen ? "닫기" : "계정 추가"}
            </IconButton>
          </div>
          {accountFormOpen ? (
            <form className="miniForm" onSubmit={addAccount}>
              <input
                aria-label="계정 표시 이름"
                placeholder="예: Claude Google A"
                title="화면에 보일 계정 이름입니다"
                value={accountForm.displayName}
                onChange={(event) => setAccountForm({ ...accountForm, displayName: event.target.value })}
              />
              <select
                aria-label="AI 도구"
                title="이 계정이 연결된 AI 도구를 선택합니다"
                value={accountForm.provider}
                onChange={(event) => setAccountForm({ ...accountForm, provider: event.target.value })}
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="cursor">Cursor</option>
                <option value="gemini">Gemini</option>
              </select>
              <select
                aria-label="로그인 방식"
                title="계정이 어떤 방식으로 인증되는지 표시합니다"
                value={accountForm.authMethod}
                onChange={(event) => setAccountForm({ ...accountForm, authMethod: event.target.value })}
              >
                <option value="google">Google</option>
                <option value="email_password">이메일 + 비밀번호</option>
                <option value="api_key">API 키</option>
                <option value="cli_session">로컬 CLI 세션</option>
                <option value="browser_profile">브라우저 프로필</option>
              </select>
              <select
                aria-label="요금제"
                title="요금제 유형. 라우팅엔 영향 없고 표시용입니다."
                value={accountForm.plan}
                onChange={(event) => setAccountForm({ ...accountForm, plan: event.target.value })}
              >
                <option value="pro">Pro</option>
                <option value="plus">Plus</option>
                <option value="team">Team</option>
                <option value="local">Local</option>
              </select>
              <input
                aria-label="이메일 또는 계정 ID"
                placeholder="name@example.com"
                title="실제 로그인 이메일 또는 계정 식별자를 입력합니다"
                value={accountForm.email}
                onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })}
              />
              <input
                aria-label="계정 별칭"
                placeholder="내부 별칭 (선택)"
                title="중복 없이 계정을 구분할 내부 ID입니다. 비워두면 자동 생성합니다"
                value={accountForm.alias}
                onChange={(event) => setAccountForm({ ...accountForm, alias: event.target.value })}
              />
              <input
                aria-label="세션 프로필"
                placeholder="세션 프로필 이름 (선택)"
                title="각 계정별로 분리해서 사용할 로컬 세션 프로필 이름입니다"
                value={accountForm.sessionProfile}
                onChange={(event) => setAccountForm({ ...accountForm, sessionProfile: event.target.value })}
              />
              <input
                aria-label="암호 또는 비밀값"
                placeholder="비밀번호 또는 API 키 (선택, 로컬 암호화 저장)"
                type="password"
                title="입력하면 Windows DPAPI로 로컬 암호화 저장합니다"
                value={accountForm.secret}
                onChange={(event) => setAccountForm({ ...accountForm, secret: event.target.value })}
              />
              {accountErrors.length > 0 ? (
                <div className="formError" role="alert">
                  {accountErrors.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              ) : null}
              <div className="formHint">
                <strong>자동 처리</strong>
                <span>주간 사용량은 요금제 기본값으로, 세션 상태는 CLI 설치 여부와 세션 프로필을 자동 감지해 설정합니다.</span>
              </div>
              <IconButton icon={Plus} type="submit" title="입력한 설정으로 새 계정을 추가합니다">
                계정 추가
              </IconButton>
            </form>
          ) : null}
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>{selectedProjectRecord.path}</p>
            <h1>{selectedProjectRecord.name}</h1>
            {activeRunForSelectedProject?.currentStatus ? (
              <div className="nowDoing" title="worker 가 [STATUS] 마커로 보고한 현재 작업">
                <span className="nowDoingDot" aria-hidden="true" />
                <span>{activeRunForSelectedProject.currentStatus}</span>
              </div>
            ) : null}
          </div>
          <div className="topActions">
            <StatusPill status={activeRunForSelectedProject?.status || "ready"} />
            <button
              className="metaToggleBtn"
              type="button"
              title={showMetaPanels ? "메타데이터 패널 숨기기" : "로드맵·인수인계·계획·명령·작업도구 패널 보이기"}
              onClick={() => setShowMetaPanels((value) => !value)}
            >
              {showMetaPanels ? "메타 숨김" : "메타 보기"}
            </button>
            <button
              className="metaToggleBtn"
              type="button"
              title="우하단 작은 채팅 창으로 전환 (선택된 프로젝트의 진행 로그 + 간단 프롬프트)"
              onClick={toggleViewMode}
            >
              컴팩트 모드
            </button>
            {desktopApi ? (
              <button
                className="metaToggleBtn"
                type="button"
                title="앱을 트레이로 내려 백그라운드 실행"
                onClick={() => desktopApi.hideToTray()}
              >
                트레이로
              </button>
            ) : null}
            {appVersion ? (
              <button
                type="button"
                className={`appVersionPill status${updateInfo.status === "downloaded" ? "Downloaded" : updateInfo.status === "available" ? "Available" : updateInfo.status === "checking" ? "Checking" : updateInfo.status === "error" ? "Error" : "Ok"}`}
                title={
                  updateInfo.status === "downloaded"
                    ? `새 버전 v${updateInfo.version} 다운로드 완료 — 클릭하면 즉시 재시작 후 적용됩니다.`
                    : updateInfo.status === "available"
                      ? `새 버전 v${updateInfo.version} 다운로드 중 — 완료되면 클릭하여 적용할 수 있습니다.`
                      : updateInfo.status === "checking"
                        ? "업데이트 확인 중..."
                        : updateInfo.status === "error"
                          ? `업데이트 확인 실패: ${updateInfo.error || "알 수 없음"}. 클릭해서 다시 시도.`
                          : updateInfo.status === "current"
                            ? `최신 버전 (마지막 확인 ${updateInfo.lastCheckedAt ? new Date(updateInfo.lastCheckedAt).toLocaleTimeString("ko-KR") : "방금"}). 클릭해서 지금 확인.`
                            : "클릭해서 업데이트 지금 확인."
                }
                onClick={onVersionPillClick}
              >
                <span className="versionTag">v{appVersion}</span>
                {updateInfo.status === "downloaded" ? (
                  <span className="versionBadge">v{updateInfo.version} 지금 재시작 ▶</span>
                ) : updateInfo.status === "available" ? (
                  <span className="versionBadge">v{updateInfo.version} 다운로드 중…</span>
                ) : updateInfo.status === "checking" ? (
                  <span className="versionBadge">확인 중…</span>
                ) : updateInfo.status === "error" ? (
                  <span className="versionBadge">확인 실패</span>
                ) : (
                  <span className="versionBadge">최신</span>
                )}
              </button>
            ) : null}
            <time dateTime={snapshot.generated_at}>{new Date(snapshot.generated_at).toLocaleString("ko-KR")}</time>
          </div>
        </header>
        {selectedProjectRecord.id !== "current" ? (
          <div className="projectContextBanner" role="note">
            <strong>외부 프로젝트 모드</strong>
            <span>
              worker 는 <code>{selectedProjectRecord.path}</code> 디렉터리에서 실행됩니다. 아래 로드맵·핸드오프·작업 도구 패널은 AgentApp 자체 메타데이터이고 선택한 프로젝트에는 적용되지 않습니다.
            </span>
          </div>
        ) : null}

        <div className="syncBanner" role="note" aria-label="공통 관리 동기화 대상">
          <strong>🔄 공통 관리 (모든 에이전트가 함께 동기화)</strong>
          <span>
            <code>git</code> · <code>.claude-sync/memory/</code> · <code>.claude-sync/plans/</code> ·
            <code>tools/agent-orchestrator/handoff/{`{NEXT_TASK,RUN_STATUS,DECISIONS_REQUIRED}.md`}</code>
          </span>
          <small>모든 worker prompt 에 이 규칙이 명시되어 시작 시 자동 숙지됩니다. 작업 끝 + commit 시 동기화 hook 이 자동 갱신.</small>
        </div>

        <section className="overview">
          <Stat
            label="로드맵"
            value={`${selectedProject !== "current" && projectMeta?.progress
              ? projectMeta.progress.percent
              : snapshot.progress.percent}%`}
            icon={Gauge}
          />
          <Stat
            label="완료"
            value={selectedProject !== "current" && projectMeta?.progress
              ? `${projectMeta.progress.done}/${projectMeta.progress.total}`
              : `${snapshot.progress.done}/${snapshot.progress.total}`}
            icon={CheckCircle2}
          />
          <Stat label="결정 필요" value={String(approvalCount)} icon={AlertCircle} />
          <Stat label="계정 수" value={String(accounts.length)} icon={KeyRound} />
        </section>

        <section className="runSurface" id="run">
          <div className="runHeader">
            <div>
              <span>다음 작업</span>
              <h2>{nextTaskTitle}</h2>
            </div>
            <div className="runControls">
              <IconButton
                icon={activeRunForSelectedProject ? Square : Play}
                variant={activeRunForSelectedProject ? "danger" : "primary"}
                title={activeRunForSelectedProject ? "이 프로젝트의 실행을 중지합니다" : "입력한 프롬프트로 작업을 시작합니다"}
                disabled={!activeRunForSelectedProject && !localRecommendation}
                onClick={activeRunForSelectedProject ? stopRun : startRun}
              >
                {activeRunForSelectedProject ? "중지" : "시작"}
              </IconButton>
            </div>
          </div>

          <div className="runnerGrid">
            {showAdvancedWorker ? (
              <label>
                작업 도구 (수동)
                <select
                  title="자동 선택을 무시하고 특정 도구를 강제 사용합니다"
                  value={selectedWorker}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSelectedWorker(next);
                    // 워커 변경 시 호환되지 않는 stale modelOverride 를 'auto' 로 초기화
                    const nextProvider = providerForWorker(next);
                    const overrideProvider =
                      modelOverride === "auto" || modelOverride === "best_available"
                        ? ""
                        : /^(opus|sonnet|haiku|claude)/i.test(modelOverride) ? "claude"
                        : /^(gpt|o\d|codex)/i.test(modelOverride) ? "codex"
                        : /^gemini/i.test(modelOverride) ? "gemini" : "";
                    if (nextProvider && overrideProvider && nextProvider !== overrideProvider) {
                      setModelOverride("auto");
                    }
                    setRunError("");
                  }}
                >
                  <option value="auto">자동 (권장)</option>
                  {snapshot.workers.map((worker) => (
                    <option key={worker.id} value={worker.id}>
                      {worker.display_name || worker.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {showAdvancedModel ? (
              <label>
                모델 (수동)
                <select
                  title="자동 선택을 무시하고 특정 모델로 고정합니다 (선택된 작업 도구의 provider 와 호환되는 모델만 표시)"
                  value={modelOverride}
                  onChange={(event) => setModelOverride(event.target.value)}
                >
                  <option value="auto">자동 (권장)</option>
                  {(() => {
                    const provider = providerForWorker(selectedWorker);
                    const all: { value: string; label: string; provider: string }[] = [
                      { value: "gpt-5.5", label: "GPT-5.5", provider: "codex" },
                      { value: "gpt-5.4", label: "GPT-5.4", provider: "codex" },
                      { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "codex" },
                      { value: "opus", label: "Claude Opus", provider: "claude" },
                      { value: "sonnet", label: "Claude Sonnet", provider: "claude" },
                      { value: "best_available", label: "가능한 최고 품질", provider: "" },
                    ];
                    const filtered = provider
                      ? all.filter((m) => m.provider === "" || m.provider === provider)
                      : all;
                    return filtered.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ));
                  })()}
                </select>
              </label>
            ) : null}
            <label>
              난이도
              <select
                title="자동: 프롬프트 텍스트로 자동 분류. 수동 선택 시 그 단계로 고정."
                value={complexity}
                onChange={(event) => {
                  setComplexity(event.target.value);
                  setRunError("");
                }}
              >
                <option value="auto">자동 (작업 내용 분석)</option>
                <option value="routine">기본</option>
                <option value="standard">일반</option>
                <option value="complex">복잡</option>
                <option value="critical">중요</option>
              </select>
            </label>
            <label>
              프로젝트
              <select
                title="작업 기준이 되는 프로젝트를 선택합니다"
                value={selectedProject}
                onChange={(event) => setSelectedProject(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="advancedToggle">
            <button
              className="linkButton"
              type="button"
              onClick={() => {
                setShowAdvancedWorker((value) => !value);
                setShowAdvancedModel((value) => !value);
              }}
              title="기본은 자동 선택. 도구와 모델을 직접 고르고 싶을 때만 펼치세요."
            >
              {showAdvancedWorker ? "▼ 자동 선택으로 돌아가기" : "▸ 도구 / 모델 수동 선택"}
            </button>
            {!showAdvancedWorker ? (
              <small>도구와 모델은 준비된 계정, 잔여 사용량, 프로젝트의 최근 사용 이력을 보고 자동으로 결정됩니다.</small>
            ) : null}
          </div>

          <label className="promptBox">
            <div className="promptBoxHeader">
              <span>프롬프트</span>
              {nextTaskTitle && nextTaskTitle !== "다음 계획 작성" ? (
                <button
                  className="promptSuggestionChip"
                  type="button"
                  title="다음 작업 제목을 프롬프트에 채워 넣습니다"
                  onClick={() => setPrompt(nextTaskTitle)}
                >
                  → 다음 작업 사용: {nextTaskTitle}
                </button>
              ) : null}
            </div>
            <textarea
              placeholder={
                nextTaskTitle && nextTaskTitle !== "다음 계획 작성"
                  ? `예: ${nextTaskTitle}  (위 칩을 누르면 자동으로 채워집니다)`
                  : "작업 지시사항을 입력하세요"
              }
              title="에이전트가 바로 수행할 작업 지시를 입력합니다"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          <div className="routeStrip">
            <MessageSquareText aria-hidden="true" size={17} />
            <span>
              {localRecommendation
                ? `${localRecommendation.accountId} (${localRecommendation.loginLabel}) / ${localRecommendation.model} / ${reasoningLabel(localRecommendation.reasoningEffort)} / 예상 ${localRecommendation.estimatedUnits} 단위`
                : routeBlockMessage(accounts, selectedWorker)}
            </span>
            <StatusPill status={localRecommendation ? "recommended" : "blocked"} />
          </div>
          {runError ? <div className="formError inline" role="alert">{runError}</div> : null}
        </section>

        <section className="contentGrid">
          <section className="panel">
            <div className="sectionTitle">
              <h2>현재 실행</h2>
              <CircleStop aria-hidden="true" size={17} />
            </div>
            {activeRunForSelectedProject ? (
              <ChatConversation
                run={activeRunForSelectedProject}
                now={now}
                onQuickSwitch={(targetId) => void quickSwitchAccount(targetId)}
                readyAccounts={readyLocalAccounts}
              />
            ) : activeRun ? (
              <p className="empty">
                선택한 프로젝트에 진행 중인 작업이 없습니다. 다른 프로젝트에서 실행 중인 작업이 있어 글로벌 슬롯은 점유 중입니다.
              </p>
            ) : (
              <p className="empty">실행 중인 작업이 없습니다.</p>
            )}
            {pendingRunsForSelectedProject.length > 0 ? (
              <div className="pendingList">
                <h3>준비 대기 중인 작업</h3>
                <p className="emptyState">자동 선택 작업은 아무 ready 계정이나 준비되면 시작되고, 수동 도구 작업은 해당 도구 계정이 준비되면 시작됩니다.</p>
                {pendingRunsForSelectedProject.map((pending) => (
                  <article key={pending.id} className="pendingItem">
                    <StatusPill status="queued" />
                    <div>
                      <strong>{pending.prompt || "(빈 프롬프트)"}</strong>
                      <span>
                        {pending.workerAuto ? "auto" : pending.workerId} / {complexityLabel(pending.complexity)} / {pending.blockedReason}
                      </span>
                    </div>
                    <div className="pendingActions">
                      <button
                        type="button"
                        className="metaToggleBtn"
                        title="지금 다시 시작 — 준비된 계정이 있으면 즉시 실행"
                        onClick={() => void retryPending(pending.id)}
                      >
                        다시 시작
                      </button>
                      <button
                        type="button"
                        className="metaToggleBtn"
                        title="대기 큐에서 제거"
                        onClick={() => void cancelPending(pending.id)}
                      >
                        삭제
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            {/* 사용자 입력을 기다리는 stopped run — 답변 입력으로 이어 진행 */}
            {awaitingUserRuns.length > 0 ? (
              <div className="awaitingList">
                <h3>사용자 답변 대기</h3>
                <p className="emptyState">worker 가 자율 처리하기 어려운 결정 사항을 보고했습니다. 답변을 입력하면 같은 worker 로 이어 진행합니다.</p>
                {awaitingUserRuns.map((run) => (
                  <article key={run.id} className="awaitingItem">
                    <div className="awaitingHeader">
                      <StatusPill status="stopped" />
                      <strong>{run.prompt?.slice(0, 80) || "(빈 프롬프트)"}</strong>
                    </div>
                    <small className="awaitingReason">{run.awaitingReason || "사용자 입력 필요"}</small>
                    {run.awaitingPromptHint ? (
                      <details className="awaitingHint">
                        <summary>worker 가 남긴 마지막 메시지</summary>
                        <pre>{run.awaitingPromptHint.slice(-1200)}</pre>
                      </details>
                    ) : null}
                    <ResumeWithUserInput
                      runId={run.id}
                      onResume={async (text) => {
                        await resumeRunWithInput(run.id, text);
                      }}
                    />
                  </article>
                ))}
              </div>
            ) : null}
            <div className="historyList">
              {runHistoryForSelectedProject.length === 0 ? <p className="emptyState">아직 실행 기록이 없습니다.</p> : null}
              {runHistoryForSelectedProject.slice(0, 4).map((run) => (
                <article key={run.id}>
                  <StatusPill status={run.status} />
                  <div>
                    <strong>{run.prompt}</strong>
                    <span>
                      {run.workerId}
                      {run.routing?.accountId ? ` / ${run.routing.accountId} / ${run.routing.model}` : ""}
                    </span>
                    {run.adapter?.lastMessageText ? (
                      <div className="historyResponse">
                        <MarkdownText source={run.adapter.lastMessageText} />
                      </div>
                    ) : null}
                    {run.status === "blocked" || run.adapter?.status === "blocked" ? (
                      <small className="blockedReason">
                        {run.adapter?.summary
                          || run.adapter?.lastError
                          || run.routing?.reason
                          || "차단 사유 정보 없음"}
                      </small>
                    ) : null}
                    {run.interruptedWorktree?.dirty ? (
                      <small className="blockedReason">
                        중단된 변경 {run.interruptedWorktree.fileCount}개 남음: {run.interruptedWorktree.files.slice(0, 4).join(", ")}
                        {run.interruptedWorktree.fileCount > 4 ? ` 외 ${run.interruptedWorktree.fileCount - 4}개` : ""}
                      </small>
                    ) : null}
                    {run.adapter?.launchLogTail ? (
                      <details className="runResponse compact">
                        <summary>실행 로그 tail</summary>
                        <pre>{run.adapter.launchLogTail}</pre>
                      </details>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>
        {showMetaPanels ? (() => {
          const isExternal = selectedProjectRecord.id !== "current";
          const sourceLabel = isExternal ? `프로젝트 ${selectedProjectRecord.name}` : "AgentApp 자체";
          const handoffDocs = isExternal && projectMeta?.handoff_documents
            ? projectMeta.handoff_documents
            : snapshot.handoff_documents;
          const planPhases = isExternal && projectMeta?.progress?.phases
            ? projectMeta.progress.phases
            : snapshot.progress.phases;
          const metaWorkers = isExternal && projectMeta?.workers ? projectMeta.workers : snapshot.workers;
          const noMetaForProject = isExternal && projectMeta && !projectMeta.has_metadata;
          return (
        <section className="metaPanels">
          <div className="metaPanelsHeader">
            <strong>메타 기준:</strong> <span>{sourceLabel}</span>
            {noMetaForProject ? (
              <em>· 이 프로젝트엔 .claude-sync/handoff 구조가 없어 빈 상태로 표시됩니다.</em>
            ) : null}
          </div>
          <section className="panel">
            <div className="sectionTitle">
              <h2>연결 정책</h2>
              <ShieldCheck aria-hidden="true" size={17} />
            </div>
            <ul className="policyList">
              <li>Claude, Codex, Cursor 같은 도구는 사용자가 이미 로그인한 공식 환경 안에서만 사용합니다.</li>
              <li>AgentApp은 계정 보유 수, 주간 제한, 남은 예산을 로컬에서만 관리합니다.</li>
              <li>자동 로그인 우회, 강제 계정 전환, CAPTCHA/MFA 우회는 구현하지 않습니다.</li>
            </ul>
          </section>

          <section className="panel wide" id="handoff">
            <div className="sectionTitle">
              <h2>인수인계</h2>
              <ClipboardList aria-hidden="true" size={17} />
            </div>
            <div className="handoffGrid">
              {handoffDocs.length === 0 ? <p className="emptyState">인수인계 문서가 없습니다.</p> : null}
              {handoffDocs.map((document) => (
                <article className="handoffDoc" key={document.id}>
                  <header>
                    <strong>{document.title}</strong>
                    <span>{document.path}</span>
                  </header>
                  <pre>{document.excerpt || "내용이 없습니다."}</pre>
                </article>
              ))}
            </div>
          </section>

          <section className="panel wide">
            <div className="sectionTitle">
              <h2>계획</h2>
              <GitBranch aria-hidden="true" size={17} />
            </div>
            <div className="phaseList">
              {planPhases.length === 0 ? <p className="emptyState">계획 정보가 없습니다.</p> : null}
              {planPhases.map((phase) => {
                const percent = phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : 0;
                return (
                  <article className="phaseRow" key={phase.title}>
                    <div>
                      <strong>{phase.title}</strong>
                      <span>
                        {phase.done}/{phase.total}
                      </span>
                    </div>
                    <ProgressBar value={percent} live={activeRun?.status === "running"} />
                    <span className="phasePercent">{percent}%</span>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="sectionTitle">
              <h2>명령</h2>
              <TerminalIcon aria-hidden="true" size={17} />
            </div>
            {isExternal ? (
              <p className="emptyState">
                이 명령들은 AgentApp 자체 (개발 모드) 에서만 의미가 있습니다. 외부 프로젝트엔 적용되지 않습니다.
              </p>
            ) : (
              <div className="commandList">
                <code>pnpm agent:next</code>
                <code>pnpm agent:prompt -- --all --write</code>
                <code>pnpm agent:scheduled-check -- --json</code>
                <code>pnpm dashboard:build</code>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="sectionTitle">
              <h2>작업 도구</h2>
              <Settings aria-hidden="true" size={17} />
            </div>
            <div className="workerList">
              {metaWorkers.length === 0 ? <p className="emptyState">등록된 작업 도구가 없습니다.</p> : null}
              {metaWorkers.map((worker) => (
                <article key={worker.id}>
                  <Bot aria-hidden="true" size={16} />
                  <div>
                    <strong>{worker.display_name || worker.id}</strong>
                    <span>{worker.kind}</span>
                  </div>
                  <StatusPill status={worker.latest_status} />
                </article>
              ))}
            </div>
          </section>
        </section>
          );
        })() : null}
      </section>

      <aside className="contextRail">
        <section className="railPanel">
          <div className="sectionTitle compact">
            <h2>계정 상태</h2>
            <button className="iconOnly" type="button" title="계정 상태를 다시 동기화합니다" onClick={() => void refreshRuntime()}>
              <RefreshCcw aria-hidden="true" size={15} />
            </button>
          </div>
          {(() => {
            const ready = accounts.filter((a) => a.sessionStatus === "ready" && a.enabled !== false);
            const locked = accounts.filter(
              (a) => a.quotaResetAt && new Date(a.quotaResetAt).getTime() > Date.now(),
            );
            return (
              <>
                <strong className="bigNumber" data-flash="changed">
                  <AnimatedNumber value={ready.length} />
                  <span className="bigNumberDivider">/</span>
                  <AnimatedNumber value={accounts.length} />
                </strong>
                <span>사용 가능한 계정</span>
                {locked.length > 0 ? (
                  <small style={{ color: "#b45309" }}>
                    ⏳ 한도 잠금 {locked.length}개 (자동 reset 대기)
                  </small>
                ) : (
                  <small>실제 한도 도달 시 자동 잠금 → reset 시각 지나면 자동 복귀</small>
                )}
                <small>동기화 {lastRuntimeSyncAt || "대기"}</small>
              </>
            );
          })()}
        </section>

        <section className="railPanel">
          <div className="sectionTitle compact">
            <h2>환경</h2>
            <button className="iconOnly" type="button" title="설치 환경을 다시 점검합니다" onClick={() => void refreshEnvironment()}>
              <RefreshCcw aria-hidden="true" size={15} />
            </button>
          </div>
          <strong className="bigNumber" key={`env-${environmentFlashKey}`} data-flash="changed">
            {environment ? (
              <>
                <AnimatedNumber value={environment.summary.ok} />
                <span className="bigNumberDivider">/</span>
                <AnimatedNumber value={environment.summary.total} />
              </>
            ) : (
              "-"
            )}
          </strong>
          <span>설치된 도구</span>
          <ProgressBar value={environmentPercent} />
          {missingInstallableTools.length > 0 ? (
            <>
              <div className="installList">
                {missingInstallableTools.slice(0, 3).map((target) => (
                  <code key={target.id}>{target.installCommand}</code>
                ))}
              </div>
              <button
                className="button primary"
                type="button"
                disabled={installing}
                title="누락된 필수 환경과 AI CLI 도구들을 자동으로 설치합니다"
                onClick={() => void installMissingTools("all")}
              >
                {installing ? "설치 중…" : "누락 도구 자동 설치"}
              </button>
            </>
          ) : (
            <small>AI CLI 경로 점검 완료</small>
          )}
          {installLogs.length > 0 ? (
            <div className="installLog">
              {installLogs.slice(-8).map((entry, index) => (
                <div className={`installLogLine ${entry.level}`} key={`${entry.at}-${index}`}>
                  {entry.message}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="railPanel">
          <div className="sectionTitle compact">
            <h2>작업 큐</h2>
            <Send aria-hidden="true" size={16} />
          </div>
          {snapshot.task_queue.next.length === 0 ? (
            <p className="empty">대기 중인 작업이 없습니다.</p>
          ) : (
            <ol className="queueList">
              {snapshot.task_queue.next.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span>우선순위 {task.priority}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {desktopApi ? (
          <section className="railPanel">
            <div className="sectionTitle compact">
              <h2>모바일 접속</h2>
              <Smartphone aria-hidden="true" size={16} />
            </div>
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}
              title="같은 Wi-Fi 의 폰/태블릿에서 토큰 URL 로 대시보드 접속 허용. 토글 변경은 앱 재시작 후 반영됩니다."
            >
              <input
                type="checkbox"
                checked={Boolean(lanAccess?.enabled)}
                onChange={async (event) => {
                  const next = event.target.checked;
                  try {
                    await runtimeRequest("settings", { lanAccessEnabled: next });
                    await refreshLanAccess();
                    setToast({
                      kind: "info",
                      message: next
                        ? "LAN 접속 활성화. 앱을 한 번 종료 → 재실행해야 0.0.0.0 으로 다시 바인딩됩니다."
                        : "LAN 접속 비활성화. 재시작 시 127.0.0.1 로 돌아갑니다.",
                    });
                  } catch (caught) {
                    setToast({
                      kind: "warn",
                      message: caught instanceof Error ? caught.message : "설정 저장 실패",
                    });
                  }
                }}
              />
              <span>같은 Wi-Fi 에서 접속 허용</span>
            </label>
            {lanAccess?.needsRestart ? (
              <small style={{ color: "#b45309" }}>
                ⚠ 설정 변경됨 — 트레이 메뉴 → 종료 후 재실행해야 새 bind 가 적용됩니다.
              </small>
            ) : null}
            {lanAccess?.enabled && lanAccess.boundLan && (lanAccess.entries?.length ?? lanAccess.urls.length) > 0 ? (
              <>
                <small>아래 URL 클릭 → 복사 → 폰 브라우저에 붙여넣기 (즐겨찾기 저장하면 다음부터 한 번에):</small>
                {(lanAccess.entries && lanAccess.entries.length > 0
                  ? lanAccess.entries
                  : lanAccess.urls.map((url) => ({ url, address: "", kind: "lan", interface: "" }))
                ).map((entry) => {
                  const badge =
                    entry.kind === "tailscale"
                      ? { label: "Tailscale", color: "#7c3aed", hint: "어디서든 (4G/5G/외부 Wi-Fi 포함) — 본인 Tailnet 기기끼리만" }
                      : entry.kind === "lan"
                        ? { label: "같은 Wi-Fi", color: "#0ea5e9", hint: "현재 PC 와 같은 네트워크에 연결됐을 때만" }
                        : entry.kind === "public"
                          ? { label: "공인 IP", color: "#dc2626", hint: "외부 노출 — 권장 안 함, 라우터에 포트 포워딩이 잡힌 환경일 수 있음" }
                          : { label: entry.kind || "기타", color: "#64748b", hint: entry.interface || "" };
                  return (
                    <div key={entry.url} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                        <span
                          style={{
                            background: badge.color,
                            color: "#fff",
                            borderRadius: 4,
                            padding: "1px 6px",
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                          title={badge.hint}
                        >
                          {badge.label}
                        </span>
                        {entry.interface ? (
                          <span style={{ color: "#64748b", fontSize: 10 }}>{entry.interface}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="button ghost"
                        style={{
                          justifyContent: "flex-start",
                          fontSize: 11,
                          wordBreak: "break-all",
                          whiteSpace: "normal",
                          textAlign: "left",
                          padding: "6px 8px",
                        }}
                        title="클릭해서 URL 복사"
                        onClick={() => {
                          void navigator.clipboard?.writeText(entry.url);
                          setToast({ kind: "success", message: "URL 복사됨 — 폰에 붙여넣기" });
                        }}
                      >
                        {entry.url}
                      </button>
                    </div>
                  );
                })}
                {!lanAccess.hasTailscale ? (
                  <small style={{ color: "#64748b" }}>
                    💡 외출 중에도 (모바일 데이터, 다른 Wi-Fi) 접속하고 싶다면 PC + 폰에 <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale</a> 을 설치하세요. 같은 계정으로 로그인하면 위 목록에 `100.x.x.x` URL 이 추가로 나타나고 그 URL 은 어디서든 동작합니다 (개인 사용 무료).
                  </small>
                ) : (
                  <small style={{ color: "#64748b" }}>
                    Tailscale 감지됨 — 보라색 배지의 URL 은 어디서든 (4G/5G/카페 Wi-Fi 등) 동작. 파란색은 지금 PC 가 연결된 Wi-Fi 와 같은 네트워크에 있을 때만.
                  </small>
                )}
                <small style={{ color: "#64748b" }}>
                  토큰은 URL 의 <code>?t=</code> 뒤 부분. 노출 시 같은 네트워크 누구나 접속 가능하므로 친구 줄 때 주의.
                </small>
              </>
            ) : lanAccess?.enabled && !lanAccess.boundLan ? (
              <small style={{ color: "#b45309" }}>
                LAN 활성화됐지만 서버가 127.0.0.1 에 바인딩된 상태. 한 번 종료 후 재실행하세요.
              </small>
            ) : (
              <small>꺼져 있음. 켜면 같은 Wi-Fi 안의 다른 기기에서 토큰 URL 로 접속 가능 (인터넷엔 노출 안 됨).</small>
            )}
          </section>
        ) : null}
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
