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
  KeyRound,
  MessageSquareText,
  Play,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  ShieldCheck,
  Square,
  Terminal,
  TimerReset,
  Trash2,
  UserCheck,
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
};

type RunRecord = {
  id: string;
  status: string;
  workerId: string;
  projectId: string;
  prompt: string;
  complexity: string;
  modelOverride?: string;
  startedAt: string;
  stoppedAt?: string;
  completedAt?: string;
  handoffPath?: string;
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

type RuntimeState = {
  version?: number;
  accounts: ManagedAccount[];
  projects: ManagedProject[];
  activeRun: RunRecord | null;
  runHistory: RunRecord[];
  pendingRuns?: PendingRun[];
  handoff?: { status: string; targetAccountId?: string; reason: string };
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

function useNumericHistory(value: number, max = 24): number[] {
  const [history, setHistory] = React.useState<number[]>(() =>
    Number.isFinite(value) ? [value] : [],
  );
  React.useEffect(() => {
    if (!Number.isFinite(value)) return;
    setHistory((previous) => {
      const last = previous[previous.length - 1];
      if (last === value && previous.length > 0) return previous;
      const next = previous.length >= max ? previous.slice(previous.length - max + 1) : previous;
      return [...next, value];
    });
  }, [value, max]);
  return history;
}

function Sparkline({
  values,
  width = 96,
  height = 24,
  stroke = "currentColor",
  fill = "rgba(37, 99, 235, 0.12)",
  ariaLabel,
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  ariaLabel?: string;
}) {
  if (!values || values.length < 2) {
    return <span className="sparkline sparkline-empty" aria-hidden="true" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 1.5;
  const usable = height - pad * 2;
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = pad + (1 - (value - min) / range) * usable;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const polyline = points.join(" ");
  const area = `0,${height} ${polyline} ${width},${height}`;
  const lastX = width;
  const lastValue = values[values.length - 1];
  const lastY = pad + (1 - (lastValue - min) / range) * usable;
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : "true"}
    >
      <polygon fill={fill} stroke="none" points={area} />
      <polyline fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" points={polyline} />
      <circle cx={lastX} cy={lastY} r="1.8" fill={stroke} />
    </svg>
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
  trend,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  trend?: number[];
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
      {trend && trend.length >= 2 ? <Sparkline values={trend} width={64} height={20} /> : null}
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
  return account.modelProfiles?.[complexity];
}

function recommendLocalRoute(accounts: ManagedAccount[], complexity: string, workerId: string) {
  const provider = providerForWorker(workerId);
  const candidates = accounts
    .filter((account) => !provider || account.provider === provider)
    .filter((account) => account.enabled !== false)
    .filter((account) => account.sessionStatus === "ready")
    .map((account) => ({ account, profile: profileFor(account, complexity) }))
    .filter(
      (candidate): candidate is { account: ManagedAccount; profile: { model: string; reasoningEffort: string; estimatedUnits: number } } =>
        Boolean(candidate.profile),
    )
    .filter((candidate) => candidate.account.remainingUnits >= candidate.profile.estimatedUnits)
    .sort((left, right) => right.account.remainingUnits - left.account.remainingUnits);

  const selected = candidates[0];
  if (!selected) return null;
  return {
    accountId: selected.account.id,
    provider: selected.account.provider,
    loginLabel: selected.account.loginLabel,
    model: selected.profile.model,
    reasoningEffort: selected.profile.reasoningEffort,
    estimatedUnits: selected.profile.estimatedUnits,
  };
}

function routeBlockMessage(accounts: ManagedAccount[], workerId: string) {
  const provider = providerForWorker(workerId);
  const matching = accounts.filter((account) => (!provider || account.provider === provider) && account.modelProfiles);
  const enabled = matching.filter((account) => account.enabled !== false);
  const ready = enabled.filter((account) => account.sessionStatus === "ready");

  if (matching.length === 0) return "이 작업 도구에 연결된 계정이 없습니다.";
  if (enabled.length === 0) return "사용 가능한 계정이 없습니다. 토글을 켜 주세요.";
  if (ready.length === 0) return "준비된 세션이 없습니다. 로그인 후 준비 상태로 바꿔 주세요.";
  return "남은 사용량이 부족하거나 이 난이도에 맞는 모델 프로필이 없습니다.";
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
  const [complexity, setComplexity] = React.useState("standard");
  const [modelOverride, setModelOverride] = React.useState("auto");
  const [selectedWorker, setSelectedWorker] = React.useState("codex");
  const [selectedProject, setSelectedProject] = React.useState("current");
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
  const [editingBudgetId, setEditingBudgetId] = React.useState<string | null>(null);
  const [budgetDraft, setBudgetDraft] = React.useState<{ remaining: string; weekly: string }>({ remaining: "", weekly: "" });
  const [now, setNow] = React.useState<number>(Date.now());
  const [activeSection, setActiveSection] = React.useState("run");

  React.useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

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

  const refreshRuntime = React.useCallback(async () => {
    try {
      const next = await runtimeRequest("runtime");
      setRuntime(next);
      setRuntimeStatus("로컬 설정 동기화 완료");
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (caught: unknown) {
      setRuntimeStatus(caught instanceof Error ? caught.message : "로컬 설정을 불러올 수 없습니다");
    }
  }, []);

  const refreshEnvironment = React.useCallback(async () => {
    try {
      setEnvironment(await environmentRequest());
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
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
  const roadmapPercentRaw = snapshot?.progress?.percent ?? 0;
  const roadmapDoneRaw = snapshot?.progress?.done ?? 0;
  const approvalCountRaw = snapshot
    ? snapshot.approval_queue.pending_decisions.length + snapshot.approval_queue.held_tasks.length
    : 0;
  const accountsCountRaw = (runtime.accounts || []).length + (snapshot?.usage_budget?.accounts?.length || 0);

  const usageHistory = useNumericHistory(liveUsageRaw.remaining);
  const usageFlashKey = useFlashOnChange(liveUsageRaw.remaining);
  const environmentHistory = useNumericHistory(environmentPercentRaw);
  const environmentFlashKey = useFlashOnChange(environmentPercentRaw);
  const roadmapHistory = useNumericHistory(roadmapPercentRaw);
  const doneHistory = useNumericHistory(roadmapDoneRaw);
  const approvalHistory = useNumericHistory(approvalCountRaw);
  const accountsHistory = useNumericHistory(accountsCountRaw);

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

  const currentProject: ManagedProject = {
    id: "current",
    name: "AgentApp",
    path: snapshot.repo_root,
    status: "active",
    progress: snapshot.progress.percent,
  };
  const projects = uniqById([currentProject, ...runtime.projects]);
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
  const localRecommendation = recommendLocalRoute(accounts, complexity, selectedWorker);
  const selectedProjectRecord = projects.find((project) => project.id === selectedProject) || currentProject;
  const activeRun = runtime.activeRun;
  const approvalCount = snapshot.approval_queue.pending_decisions.length + snapshot.approval_queue.held_tasks.length;
  const nextTaskTitle = snapshot.next_task.title === "none" ? "다음 계획 작성" : snapshot.next_task.title;
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

  function startRun() {
    const text = prompt.trim() || nextTaskTitle;
    if (!localRecommendation) {
      const message = routeBlockMessage(accounts, selectedWorker);
      setRunError(message);
      setToast({ kind: "warn", message });
      return;
    }
    setRunError("");
    void updateRuntime(
      runtimeRequest("runs/start", {
        workerId: selectedWorker,
        projectId: selectedProjectRecord.id,
        prompt: text,
        complexity,
        modelOverride,
      }),
    );
  }

  function stopRun() {
    if (!activeRun) return;
    void updateRuntime(runtimeRequest("runs/stop", {}));
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

  function openBudgetEditor(account: ManagedAccount) {
    setEditingBudgetId(account.id);
    setBudgetDraft({ remaining: String(account.remainingUnits), weekly: String(account.weeklyUnits) });
  }

  async function saveBudget(account: ManagedAccount) {
    const remaining = Number(budgetDraft.remaining);
    const weekly = Number(budgetDraft.weekly);
    if (!Number.isFinite(weekly) || weekly <= 0 || !Number.isFinite(remaining) || remaining < 0) {
      setToast({ kind: "warn", message: "주간 예산은 1 이상, 남은 사용량은 0 이상이어야 합니다." });
      return;
    }
    if (remaining > weekly) {
      setToast({ kind: "warn", message: "남은 사용량은 주간 예산보다 클 수 없습니다." });
      return;
    }
    try {
      const next = await runtimeRequest("accounts/budget", { id: account.id, remainingUnits: remaining, weeklyUnits: weekly });
      setRuntime(next);
      setLastRuntimeSyncAt(new Date().toLocaleTimeString("ko-KR"));
      setEditingBudgetId(null);
      setToast({ kind: "success", message: `'${account.displayName || account.id}' 사용량을 ${remaining}/${weekly} 로 저장했습니다.` });
    } catch (caught) {
      setToast({ kind: "warn", message: caught instanceof Error ? caught.message : "사용량 저장에 실패했습니다" });
    }
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

  return (
    <main className="appShell">
      {toast ? (
        <div className={`toast ${toast.kind}`} role="status">
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="알림 닫기">×</button>
        </div>
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
          <a className={activeSection === "run" ? "active" : ""} href="#run" onClick={() => setActiveSection("run")}>
            <Zap aria-hidden="true" size={16} />
            실행
          </a>
          <a className={activeSection === "projects" ? "active" : ""} href="#projects" onClick={() => setActiveSection("projects")}>
            <FolderGit2 aria-hidden="true" size={16} />
            프로젝트
          </a>
          <a className={activeSection === "accounts" ? "active" : ""} href="#accounts" onClick={() => setActiveSection("accounts")}>
            <KeyRound aria-hidden="true" size={16} />
            계정
          </a>
          <a className={activeSection === "handoff" ? "active" : ""} href="#handoff" onClick={() => setActiveSection("handoff")}>
            <ClipboardList aria-hidden="true" size={16} />
            인수인계
          </a>
        </nav>

        <section className="sidebarBlock" id="projects">
          <div className="sectionTitle compact">
            <h2>프로젝트</h2>
            <FolderGit2 aria-hidden="true" size={16} />
          </div>
          <div className="projectList">
            {projects.map((project) => (
              <button
                className={`projectButton ${project.id === selectedProject ? "selected" : ""}`}
                key={project.id}
                type="button"
                title={`${project.name} 프로젝트를 현재 작업 대상으로 선택합니다`}
                onClick={() => setSelectedProject(project.id)}
              >
                <span>{project.name}</span>
                <small>{project.path}</small>
                <ProgressBar value={project.progress} />
              </button>
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
            <input
              aria-label="프로젝트 경로"
              placeholder="E:\\myProject"
              title="로컬 프로젝트 절대 경로를 입력합니다"
              value={projectForm.path}
              onChange={(event) => setProjectForm({ ...projectForm, path: event.target.value })}
            />
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
              const percent = account.weeklyUnits > 0 ? Math.round((account.remainingUnits / account.weeklyUnits) * 100) : 0;
              const alertLevel = usageAlertLevel(account);
              return (
                <article className={`accountItem usage-${alertLevel} ${account.enabled === false ? "disabled" : ""}`} key={account.id}>
                  <header>
                    <div className="accountNameRow">
                      <strong>{account.displayName || account.id}</strong>
                      {account.source === "config" ? (
                        <span className="badge example" title="usage-budget.example.json 의 예시 데이터입니다. 실제 본인 계정으로 사용하려면 사이드바에서 새 계정을 추가하세요.">예시</span>
                      ) : null}
                      {alertLevel === "critical" ? (
                        <span className="badge alertCritical" title="남은 사용량이 10% 이하입니다. 다른 계정으로 인계하거나 사용량 reset 까지 대기를 검토하세요.">⚠ 한도 임박</span>
                      ) : alertLevel === "warning" ? (
                        <span className="badge alertWarning" title="남은 사용량이 30% 이하입니다. 복잡 작업은 다른 계정 사용을 고려하세요.">주의</span>
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
                  {account.sessionDetectionReason ? (
                    <small className="detectionReason">{account.sessionDetectionReason}</small>
                  ) : null}
                  {editingBudgetId === account.id ? (
                    <div className="budgetEditor">
                      <label>
                        남은
                        <input
                          inputMode="numeric"
                          value={budgetDraft.remaining}
                          onChange={(event) => setBudgetDraft({ ...budgetDraft, remaining: event.target.value })}
                        />
                      </label>
                      <label>
                        주간
                        <input
                          inputMode="numeric"
                          value={budgetDraft.weekly}
                          onChange={(event) => setBudgetDraft({ ...budgetDraft, weekly: event.target.value })}
                        />
                      </label>
                      <div className="budgetActions">
                        <button className="segButton" type="button" onClick={() => saveBudget(account)}>저장</button>
                        <button className="segButton" type="button" onClick={() => setEditingBudgetId(null)}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <div className="budgetRow">
                      <small>
                        남은 사용량 <strong>{numberFormatter.format(account.remainingUnits)}</strong> / 주간 예산 {numberFormatter.format(account.weeklyUnits)} / {planLabel(account.plan)}
                      </small>
                      {account.source === "local" ? (
                        <button
                          className="linkButton"
                          type="button"
                          title="잔여 사용량을 수정합니다. 외부 API 에서 실제 사용량을 가져올 수 없어 사용자 입력으로만 업데이트됩니다."
                          onClick={() => openBudgetEditor(account)}
                        >
                          수정
                        </button>
                      ) : null}
                    </div>
                  )}
                  <ProgressBar value={percent} />
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
                title="요금제에 따라 주간 사용량 기본값이 자동 설정됩니다"
                value={accountForm.plan}
                onChange={(event) => setAccountForm({ ...accountForm, plan: event.target.value })}
              >
                <option value="pro">Pro (주간 100단위)</option>
                <option value="plus">Plus (주간 80단위)</option>
                <option value="team">Team (주간 200단위)</option>
                <option value="local">Local (주간 50단위)</option>
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
          </div>
          <div className="topActions">
            <StatusPill status={activeRun?.status || "ready"} />
            <time dateTime={snapshot.generated_at}>{new Date(snapshot.generated_at).toLocaleString("ko-KR")}</time>
          </div>
        </header>

        <section className="overview">
          <Stat label="로드맵" value={`${snapshot.progress.percent}%`} icon={Gauge} trend={roadmapHistory} />
          <Stat label="완료" value={`${snapshot.progress.done}/${snapshot.progress.total}`} icon={CheckCircle2} trend={doneHistory} />
          <Stat label="결정 필요" value={String(approvalCount)} icon={AlertCircle} trend={approvalHistory} />
          <Stat label="계정 수" value={String(accounts.length)} icon={KeyRound} trend={accountsHistory} />
        </section>

        <section className="runSurface" id="run">
          <div className="runHeader">
            <div>
              <span>다음 작업</span>
              <h2>{nextTaskTitle}</h2>
            </div>
            <div className="runControls">
              <IconButton
                icon={activeRun ? Square : Play}
                variant={activeRun ? "danger" : "primary"}
                title={activeRun ? "현재 실행 중인 작업을 중지합니다" : "입력한 프롬프트로 작업을 시작합니다"}
                disabled={!activeRun && !localRecommendation}
                onClick={activeRun ? stopRun : startRun}
              >
                {activeRun ? "중지" : "시작"}
              </IconButton>
            </div>
          </div>

          <div className="runnerGrid">
            <label>
              작업 도구
              <select
                title="이번 작업을 실행할 에이전트를 선택합니다"
                value={selectedWorker}
                onChange={(event) => {
                  setSelectedWorker(event.target.value);
                  setRunError("");
                }}
              >
                {snapshot.workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.display_name || worker.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              모델
              <select
                title="자동 선택을 유지하거나 특정 모델로 고정할 수 있습니다"
                value={modelOverride}
                onChange={(event) => setModelOverride(event.target.value)}
              >
                <option value="auto">자동</option>
                <option value="gpt-5.5">GPT-5.5</option>
                <option value="gpt-5.4">GPT-5.4</option>
                <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                <option value="opus">Claude Opus</option>
                <option value="sonnet">Claude Sonnet</option>
                <option value="best_available">가능한 최고 품질</option>
              </select>
            </label>
            <label>
              난이도
              <select
                title="작업 난이도에 따라 모델과 예산 추천이 달라집니다"
                value={complexity}
                onChange={(event) => {
                  setComplexity(event.target.value);
                  setRunError("");
                }}
              >
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
            {activeRun ? (() => {
              const startMs = new Date(activeRun.startedAt).getTime();
              const elapsedMs = Math.max(0, now - startMs);
              const elapsedSec = Math.floor(elapsedMs / 1000);
              const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
              const ss = String(elapsedSec % 60).padStart(2, "0");
              const lastEventMs = (activeRun.events && activeRun.events.length > 0)
                ? new Date(activeRun.events[activeRun.events.length - 1].at).getTime()
                : startMs;
              const idleMs = Math.max(0, now - lastEventMs);
              const idleSec = Math.floor(idleMs / 1000);
              const showIdleWarn = activeRun.status === "running" && idleSec >= 20;
              return (
              <div className="activeRun">
                <strong>{activeRun.prompt}</strong>
                <div className="runMetrics">
                  <span className="runTimer">⏱ 경과 {mm}:{ss}</span>
                  {showIdleWarn ? (
                    <span className="idleWarn">⚠️ 마지막 응답 {idleSec}초 전 — 도구가 응답 중인지 확인 필요</span>
                  ) : null}
                </div>
                <span>
                  {activeRun.workerId} / {complexityLabel(activeRun.complexity)} / {modelOverrideLabel(activeRun.modelOverride || "auto")}
                </span>
                {activeRun.routing ? (
                  <span>
                    {activeRun.routing.accountId || "대기 중"} / {activeRun.routing.model || "모델 선택 대기"} / 예상 {activeRun.routing.estimatedUnits || 0} 단위
                  </span>
                ) : null}
                {activeRun.validation ? (
                  <span>
                    검증 / {statusLabel(activeRun.validation.status || "not_run")} / {activeRun.validation.summary || "대기 중"}
                  </span>
                ) : null}
                {activeRun.adapter ? (
                  <span>
                    어댑터 / {adapterModeLabel(activeRun.adapter.mode)} / {statusLabel(activeRun.adapter.status || "pending")}
                  </span>
                ) : null}
                {activeRun.adapter?.promptPath ? <small>{activeRun.adapter.promptPath}</small> : null}
                {activeRun.adapter?.logPath ? <small>{activeRun.adapter.logPath}</small> : null}
                {activeRun.handoffPath ? <small>{activeRun.handoffPath}</small> : null}
                <small>{activeRun.startedAt}</small>
                <div className="quickSwitchRow">
                  <button
                    type="button"
                    className="quickSwitchBtn"
                    title="현재 실행을 멈추고 남은 사용량이 많은 다른 준비된 계정으로 같은 작업을 이어갑니다 (자동 로그인은 하지 않습니다)"
                    onClick={() => void quickSwitchAccount()}
                  >
                    🔄 다른 계정으로 이어가기
                  </button>
                  {readyLocalAccounts
                    .filter((account) => account.id !== activeRun.routing?.accountId)
                    .slice(0, 3)
                    .map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        className="quickSwitchTarget"
                        title={`'${account.displayName || account.id}' 계정으로 이어가기 (남은 ${account.remainingUnits}/${account.weeklyUnits})`}
                        onClick={() => void quickSwitchAccount(account.id)}
                      >
                        → {account.displayName || account.id}
                      </button>
                    ))}
                </div>
                <div className="eventLog">
                  {(activeRun.events || []).map((event) => (
                    <div className={`eventLine ${event.level}`} key={`${event.at}-${event.message}`}>
                      <time>{new Date(event.at).toLocaleTimeString("ko-KR")}</time>
                      <span>{event.message}</span>
                    </div>
                  ))}
                </div>
              </div>
              );
            })() : (
              <p className="empty">실행 중인 작업이 없습니다.</p>
            )}
            {(runtime.pendingRuns || []).length > 0 ? (
              <div className="pendingList">
                <h3>준비 대기 중인 작업</h3>
                <p className="emptyState">계정이 준비 상태로 바뀌면 같은 도구의 첫 작업이 자동으로 시작됩니다.</p>
                {(runtime.pendingRuns || []).map((pending) => (
                  <article key={pending.id} className="pendingItem">
                    <StatusPill status="queued" />
                    <div>
                      <strong>{pending.prompt || "(빈 프롬프트)"}</strong>
                      <span>
                        {pending.workerId} / {complexityLabel(pending.complexity)} / {pending.blockedReason}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="historyList">
              {runtime.runHistory.length === 0 ? <p className="emptyState">아직 실행 기록이 없습니다.</p> : null}
              {runtime.runHistory.slice(0, 4).map((run) => (
                <article key={run.id}>
                  <StatusPill status={run.status} />
                  <div>
                    <strong>{run.prompt}</strong>
                    <span>
                      {run.workerId}
                      {run.routing?.accountId ? ` / ${run.routing.accountId} / ${run.routing.model}` : ""}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>

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
              {snapshot.handoff_documents.length === 0 ? <p className="emptyState">인수인계 문서가 없습니다.</p> : null}
              {snapshot.handoff_documents.map((document) => (
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
              {snapshot.progress.phases.map((phase) => {
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
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="sectionTitle">
              <h2>명령</h2>
              <Terminal aria-hidden="true" size={17} />
            </div>
            <div className="commandList">
              <code>pnpm agent:next</code>
              <code>pnpm agent:prompt -- --all --write</code>
              <code>pnpm agent:scheduled-check -- --json</code>
              <code>pnpm dashboard:build</code>
            </div>
          </section>

          <section className="panel">
            <div className="sectionTitle">
              <h2>작업 도구</h2>
              <Settings aria-hidden="true" size={17} />
            </div>
            <div className="workerList">
              {snapshot.workers.length === 0 ? <p className="emptyState">등록된 작업 도구가 없습니다.</p> : null}
              {snapshot.workers.map((worker) => (
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
      </section>

      <aside className="contextRail">
        <section className="railPanel">
          <div className="sectionTitle compact">
            <h2>사용량</h2>
            <button className="iconOnly" type="button" title="로컬 사용량을 다시 동기화합니다" onClick={() => void refreshRuntime()}>
              <RefreshCcw aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="bigNumberRow">
            <strong className="bigNumber" key={`usage-${usageFlashKey}`} data-flash="changed">
              {numberFormatter.format(liveUsage.remaining)}
            </strong>
            <Sparkline values={usageHistory} ariaLabel="최근 사용량 추이" />
          </div>
          <span>남은 전체 사용량</span>
          <ProgressBar value={liveUsagePercent} live={Boolean(runtime.activeRun)} />
          <small>주간 예산 {numberFormatter.format(liveUsage.weekly)} / 동기화 {lastRuntimeSyncAt || "대기"}</small>
        </section>

        <section className="railPanel">
          <div className="sectionTitle compact">
            <h2>환경</h2>
            <button className="iconOnly" type="button" title="설치 환경을 다시 점검합니다" onClick={() => void refreshEnvironment()}>
              <RefreshCcw aria-hidden="true" size={15} />
            </button>
          </div>
          <div className="bigNumberRow">
            <strong className="bigNumber" key={`env-${environmentFlashKey}`} data-flash="changed">
              {environment ? `${environment.summary.ok}/${environment.summary.total}` : "-"}
            </strong>
            <Sparkline values={environmentHistory} ariaLabel="설치된 도구 추이" />
          </div>
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
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
