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
  remainingUnits: number;
  weeklyUnits: number;
  resetDay: string;
  source: "config" | "local";
  modelProfiles?: Record<string, { model: string; reasoningEffort: string; estimatedUnits: number }>;
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
};

const numberFormatter = new Intl.NumberFormat("ko-KR");
const emptyRuntime: RuntimeState = { accounts: [], projects: [], activeRun: null, runHistory: [] };

function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${status}`}>{status || "unknown"}</span>;
}

function IconButton({
  children,
  icon: Icon,
  variant = "ghost",
  type = "button",
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  icon: LucideIcon;
  variant?: "primary" | "danger" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`button ${variant}`} disabled={disabled} type={type} onClick={onClick}>
      <Icon aria-hidden="true" size={16} />
      <span>{children}</span>
    </button>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progressTrack" aria-label={`progress ${value}%`}>
      <div className="progressFill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <section className="stat">
      <Icon aria-hidden="true" size={17} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
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

function providerForWorker(workerId: string) {
  if (workerId.includes("claude")) return "claude";
  if (workerId.includes("codex")) return "codex";
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
    .filter((candidate): candidate is { account: ManagedAccount; profile: { model: string; reasoningEffort: string; estimatedUnits: number } } =>
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

  if (matching.length === 0) return "등록된 계정 없음";
  if (enabled.length === 0) return "켜진 계정 없음";
  if (ready.length === 0) return "Ready 세션 없음";
  return "예산 부족 또는 모델 프로필 없음";
}

function App() {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [error, setError] = React.useState("");
  const [runtime, setRuntime] = React.useState<RuntimeState>(emptyRuntime);
  const [runtimeStatus, setRuntimeStatus] = React.useState("loading local settings");
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
    remainingUnits: "70",
    weeklyUnits: "100",
  });
  const [projectForm, setProjectForm] = React.useState({ name: "", path: "" });

  React.useEffect(() => {
    fetch("/agent-snapshot.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`snapshot load failed: ${response.status}`);
        return response.json() as Promise<Snapshot>;
      })
      .then(setSnapshot)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "snapshot load failed"));
  }, []);

  React.useEffect(() => {
    runtimeRequest("runtime")
      .then((next) => {
        setRuntime(next);
        setRuntimeStatus("local settings synced");
      })
      .catch((caught: unknown) => {
        setRuntimeStatus(caught instanceof Error ? caught.message : "local settings unavailable");
      });
  }, []);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      runtimeRequest("runtime")
        .then((next) => {
          setRuntime(next);
          setRuntimeStatus("local settings synced");
        })
        .catch((caught: unknown) => {
          setRuntimeStatus(caught instanceof Error ? caught.message : "local settings unavailable");
        });
    }, runtime.activeRun ? 2000 : 5000);

    return () => window.clearInterval(interval);
  }, [runtime.activeRun?.id]);

  React.useEffect(() => {
    if (snapshot?.next_task.title && !prompt) {
      setPrompt(snapshot.next_task.title === "none" ? "" : snapshot.next_task.title);
    }
  }, [snapshot, prompt]);

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
          <strong>Loading workspace</strong>
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

  async function updateRuntime(operation: Promise<RuntimeState>) {
    try {
      const next = await operation;
      setRuntime(next);
      setRuntimeStatus("local settings synced");
    } catch (caught) {
      setRuntimeStatus(caught instanceof Error ? caught.message : "local settings update failed");
    }
  }

  function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = accountForm.email.trim().toLowerCase();
    const alias =
      accountForm.alias.trim() ||
      `${accountForm.provider}-${email ? email.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") : Date.now()}`;
    if (!alias) return;

    void updateRuntime(
      runtimeRequest("accounts", {
        id: alias,
        displayName: accountForm.displayName.trim() || alias,
        provider: accountForm.provider,
        authMethod: accountForm.authMethod,
        plan: accountForm.plan,
        email,
        loginLabel: accountForm.loginLabel || email || alias,
        sessionProfile: accountForm.sessionProfile,
        secret: accountForm.secret,
        remainingUnits: Number(accountForm.remainingUnits) || 0,
        weeklyUnits: Number(accountForm.weeklyUnits) || 100,
        enabled: true,
        sessionStatus: "needs-login",
      }),
    );
    setAccountForm({ ...accountForm, displayName: "", alias: "", email: "", loginLabel: "", sessionProfile: "", secret: "" });
  }

  function addProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = projectForm.path.trim();
    const name = projectForm.name.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || "Local project";
    if (!path) return;

    void updateRuntime(runtimeRequest("projects", { id: `local-${Date.now()}`, name, path }));
    setProjectForm({ name: "", path: "" });
  }

  function startRun() {
    const text = prompt.trim() || nextTaskTitle;
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

  function toggleAccount(account: ManagedAccount) {
    void updateRuntime(runtimeRequest("accounts/enabled", { ...account, enabled: !account.enabled }));
  }

  function setSession(account: ManagedAccount, sessionStatus: ManagedAccount["sessionStatus"]) {
    void updateRuntime(runtimeRequest("accounts/session", { ...account, sessionStatus }));
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <Bot aria-hidden="true" size={22} />
          <div>
            <strong>AgentApp</strong>
            <span>Unified agent console</span>
          </div>
        </div>

        <nav className="navStack" aria-label="Workspace sections">
          <a href="#run">
            <Zap aria-hidden="true" size={16} />
            Run
          </a>
          <a href="#projects">
            <FolderGit2 aria-hidden="true" size={16} />
            Projects
          </a>
          <a href="#accounts">
            <KeyRound aria-hidden="true" size={16} />
            Accounts
          </a>
          <a href="#handoff">
            <ClipboardList aria-hidden="true" size={16} />
            Handoff
          </a>
        </nav>

        <section className="sidebarBlock" id="projects">
          <div className="sectionTitle compact">
            <h2>Projects</h2>
            <FolderGit2 aria-hidden="true" size={16} />
          </div>
          <div className="projectList">
            {projects.map((project) => (
              <button
                className={`projectButton ${project.id === selectedProject ? "selected" : ""}`}
                key={project.id}
                type="button"
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
              aria-label="project name"
              placeholder="프로젝트 이름"
              value={projectForm.name}
              onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })}
            />
            <input
              aria-label="project path"
              placeholder="E:\\myProject"
              value={projectForm.path}
              onChange={(event) => setProjectForm({ ...projectForm, path: event.target.value })}
            />
            <IconButton icon={Plus} type="submit">
              Add
            </IconButton>
          </form>
        </section>

        <section className="sidebarBlock" id="accounts">
          <div className="sectionTitle compact">
            <h2>Accounts</h2>
            <UserCheck aria-hidden="true" size={16} />
          </div>
          <div className="runtimeStatus">{runtimeStatus}</div>
          <div className="setupStrip">
            <strong>
              {readyLocalAccounts.length}/{localAccounts.length}
            </strong>
            <span>ready session profiles</span>
          </div>
          <div className="accountList">
            {accounts.map((account) => {
              const percent = account.weeklyUnits > 0 ? Math.round((account.remainingUnits / account.weeklyUnits) * 100) : 0;
              return (
                <article className={`accountItem ${account.enabled === false ? "disabled" : ""}`} key={account.id}>
                  <header>
                    <strong>{account.displayName || account.id}</strong>
                    <label className="enableToggle">
                      <input checked={account.enabled !== false} type="checkbox" onChange={() => toggleAccount(account)} />
                      <span>{account.enabled === false ? "off" : "on"}</span>
                    </label>
                  </header>
                  <small>
                    {account.provider} / {account.authMethod || "manual"} / {account.email || account.loginLabel} /{" "}
                    {account.credentialStatus === "stored" ? "encrypted secret" : "no secret"}
                  </small>
                  <small>{account.sessionProfile || "profile pending"}</small>
                  <div className="sessionRow">
                    <StatusPill status={account.sessionStatus || "needs-login"} />
                    <div className="sessionActions">
                      <button
                        className={account.sessionStatus === "ready" ? "segButton selected" : "segButton"}
                        type="button"
                        onClick={() => setSession(account, "ready")}
                      >
                        Ready
                      </button>
                      <button
                        className={account.sessionStatus === "needs-login" ? "segButton selected" : "segButton"}
                        type="button"
                        onClick={() => setSession(account, "needs-login")}
                      >
                        Login
                      </button>
                    </div>
                  </div>
                  <ProgressBar value={percent} />
                </article>
              );
            })}
          </div>
          <form className="miniForm" onSubmit={addAccount}>
            <input
              aria-label="account display name"
              placeholder="Claude Google A"
              value={accountForm.displayName}
              onChange={(event) => setAccountForm({ ...accountForm, displayName: event.target.value })}
            />
            <select
              aria-label="ai tool"
              value={accountForm.provider}
              onChange={(event) => setAccountForm({ ...accountForm, provider: event.target.value })}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="cursor">Cursor</option>
              <option value="gemini">Gemini</option>
            </select>
            <select
              aria-label="auth method"
              value={accountForm.authMethod}
              onChange={(event) => setAccountForm({ ...accountForm, authMethod: event.target.value })}
            >
              <option value="google">Google</option>
              <option value="email_password">Email + password</option>
              <option value="api_key">API key</option>
              <option value="cli_session">Local CLI session</option>
              <option value="browser_profile">Browser profile</option>
            </select>
            <select
              aria-label="plan"
              value={accountForm.plan}
              onChange={(event) => setAccountForm({ ...accountForm, plan: event.target.value })}
            >
              <option value="pro">Pro</option>
              <option value="plus">Plus</option>
              <option value="team">Team</option>
              <option value="local">Local</option>
            </select>
            <input
              aria-label="email or account id"
              placeholder="name@example.com"
              value={accountForm.email}
              onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })}
            />
            <input
              aria-label="account alias"
              placeholder="optional account alias"
              value={accountForm.alias}
              onChange={(event) => setAccountForm({ ...accountForm, alias: event.target.value })}
            />
            <input
              aria-label="session profile"
              placeholder="optional session profile"
              value={accountForm.sessionProfile}
              onChange={(event) => setAccountForm({ ...accountForm, sessionProfile: event.target.value })}
            />
            <input
              aria-label="encrypted password or secret"
              placeholder="password/API key (encrypted local)"
              type="password"
              value={accountForm.secret}
              onChange={(event) => setAccountForm({ ...accountForm, secret: event.target.value })}
            />
            <div className="splitInputs">
              <input
                aria-label="remaining units"
                inputMode="numeric"
                value={accountForm.remainingUnits}
                onChange={(event) => setAccountForm({ ...accountForm, remainingUnits: event.target.value })}
              />
              <input
                aria-label="weekly units"
                inputMode="numeric"
                value={accountForm.weeklyUnits}
                onChange={(event) => setAccountForm({ ...accountForm, weeklyUnits: event.target.value })}
              />
            </div>
            <IconButton icon={Plus} type="submit">
              Add account
            </IconButton>
          </form>
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
          <Stat label="Roadmap" value={`${snapshot.progress.percent}%`} icon={Gauge} />
          <Stat label="Completed" value={`${snapshot.progress.done}/${snapshot.progress.total}`} icon={CheckCircle2} />
          <Stat label="Decisions" value={String(approvalCount)} icon={AlertCircle} />
          <Stat label="Accounts" value={String(accounts.length)} icon={KeyRound} />
        </section>

        <section className="runSurface" id="run">
          <div className="runHeader">
            <div>
              <span>Next plan</span>
              <h2>{nextTaskTitle}</h2>
            </div>
            <div className="runControls">
              <IconButton icon={activeRun ? Square : Play} variant={activeRun ? "danger" : "primary"} onClick={activeRun ? stopRun : startRun}>
                {activeRun ? "Stop" : "Start"}
              </IconButton>
            </div>
          </div>

          <div className="runnerGrid">
            <label>
              Agent
              <select value={selectedWorker} onChange={(event) => setSelectedWorker(event.target.value)}>
                {snapshot.workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.display_name || worker.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model
              <select value={modelOverride} onChange={(event) => setModelOverride(event.target.value)}>
                <option value="auto">Auto</option>
                <option value="gpt-5.5">GPT-5.5</option>
                <option value="gpt-5.4">GPT-5.4</option>
                <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                <option value="opus">Claude Opus</option>
                <option value="sonnet">Claude Sonnet</option>
                <option value="best_available">Best available</option>
              </select>
            </label>
            <label>
              Complexity
              <select value={complexity} onChange={(event) => setComplexity(event.target.value)}>
                <option value="routine">routine</option>
                <option value="standard">standard</option>
                <option value="complex">complex</option>
                <option value="critical">critical</option>
              </select>
            </label>
            <label>
              Project
              <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="promptBox">
            Prompt
            <textarea
              placeholder="작업 지시를 입력하세요"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          <div className="routeStrip">
            <MessageSquareText aria-hidden="true" size={17} />
            <span>
              {localRecommendation
                ? `${localRecommendation.accountId} (${localRecommendation.loginLabel}) / ${localRecommendation.model} / ${localRecommendation.reasoningEffort}`
                : routeBlockMessage(accounts, selectedWorker)}
            </span>
            <StatusPill status={localRecommendation ? "recommended" : "blocked"} />
          </div>
        </section>

        <section className="contentGrid">
          <section className="panel">
            <div className="sectionTitle">
              <h2>Active run</h2>
              <CircleStop aria-hidden="true" size={17} />
            </div>
            {activeRun ? (
              <div className="activeRun">
                <strong>{activeRun.prompt}</strong>
                <span>
                  {activeRun.workerId} / {activeRun.complexity} / {activeRun.modelOverride || "auto"}
                </span>
                {activeRun.routing ? (
                  <span>
                    {activeRun.routing.accountId || "queued"} / {activeRun.routing.model || "model pending"} /{" "}
                    {activeRun.routing.estimatedUnits || 0} units
                  </span>
                ) : null}
                {activeRun.validation ? (
                  <span>
                    validate / {activeRun.validation.status || "not_run"} / {activeRun.validation.summary || "pending"}
                  </span>
                ) : null}
                {activeRun.adapter ? (
                  <span>
                    adapter / {activeRun.adapter.mode || "pending"} / {activeRun.adapter.status || "pending"}
                  </span>
                ) : null}
                {activeRun.adapter?.promptPath ? <small>{activeRun.adapter.promptPath}</small> : null}
                {activeRun.adapter?.logPath ? <small>{activeRun.adapter.logPath}</small> : null}
                {activeRun.handoffPath ? <small>{activeRun.handoffPath}</small> : null}
                <small>{activeRun.startedAt}</small>
                <div className="eventLog">
                  {(activeRun.events || []).map((event) => (
                    <div className={`eventLine ${event.level}`} key={`${event.at}-${event.message}`}>
                      <time>{new Date(event.at).toLocaleTimeString("ko-KR")}</time>
                      <span>{event.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="empty">No active run.</p>
            )}
            <div className="historyList">
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
              <h2>Connection policy</h2>
              <ShieldCheck aria-hidden="true" size={17} />
            </div>
            <ul className="policyList">
              <li>Claude/Codex/Cursor 로그인은 각 공식 앱에서 사용자가 직접 유지</li>
              <li>AgentApp에는 계정 별칭, 요금제, 남은 로컬 예산 단위만 저장</li>
              <li>자동 로그인, 자동 계정 전환, captcha/MFA 우회는 금지</li>
            </ul>
          </section>

          <section className="panel wide" id="handoff">
            <div className="sectionTitle">
              <h2>Handoff</h2>
              <ClipboardList aria-hidden="true" size={17} />
            </div>
            <div className="handoffGrid">
              {snapshot.handoff_documents.map((document) => (
                <article className="handoffDoc" key={document.id}>
                  <header>
                    <strong>{document.title}</strong>
                    <span>{document.path}</span>
                  </header>
                  <pre>{document.excerpt || "No content."}</pre>
                </article>
              ))}
            </div>
          </section>

          <section className="panel wide">
            <div className="sectionTitle">
              <h2>Plan</h2>
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
                    <ProgressBar value={percent} />
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="sectionTitle">
              <h2>Commands</h2>
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
              <h2>Workers</h2>
              <Settings aria-hidden="true" size={17} />
            </div>
            <div className="workerList">
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
            <h2>Usage</h2>
            <RefreshCcw aria-hidden="true" size={16} />
          </div>
          <strong className="bigNumber">{numberFormatter.format(snapshot.usage_budget.total_remaining_units)}</strong>
          <span>remaining units</span>
          <ProgressBar value={snapshot.usage_budget.reserve_ok_now ? 100 : 40} />
          <small>{snapshot.usage_budget.weekend_reserve_units} weekend reserve</small>
        </section>

        <section className="railPanel">
          <div className="sectionTitle compact">
            <h2>Queue</h2>
            <Send aria-hidden="true" size={16} />
          </div>
          {snapshot.task_queue.next.length === 0 ? (
            <p className="empty">No pending queue.</p>
          ) : (
            <ol className="queueList">
              {snapshot.task_queue.next.map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span>priority {task.priority}</span>
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
