import React from "react";
import { createRoot } from "react-dom/client";
import { AlertCircle, CheckCircle2, ClipboardList, FileText, Gauge, GitBranch, TimerReset } from "lucide-react";
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
    provider_summaries: {
      provider: string;
      accounts: number;
      remaining_units: number;
      weekly_budget_units: number;
    }[];
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

const numberFormatter = new Intl.NumberFormat("ko-KR");

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <section className="stat">
      <Icon aria-hidden="true" size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </section>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progressTrack" aria-label={`progress ${value}%`}>
      <div className="progressFill" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function App() {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    fetch("/agent-snapshot.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`snapshot load failed: ${response.status}`);
        return response.json() as Promise<Snapshot>;
      })
      .then(setSnapshot)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "snapshot load failed"));
  }, []);

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
          <strong>Loading snapshot</strong>
        </section>
      </main>
    );
  }

  const pendingCount = snapshot.pending_decisions.length;
  const phaseCount = snapshot.progress.phases.length;
  const approvalCount = snapshot.approval_queue.pending_decisions.length + snapshot.approval_queue.held_tasks.length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p>AgentApp</p>
          <h1>Operations Dashboard</h1>
        </div>
        <time dateTime={snapshot.generated_at}>{new Date(snapshot.generated_at).toLocaleString("ko-KR")}</time>
      </header>

      <section className="overview">
        <Stat label="Progress" value={`${snapshot.progress.percent}%`} icon={Gauge} />
        <Stat label="Completed" value={`${snapshot.progress.done}/${snapshot.progress.total}`} icon={CheckCircle2} />
        <Stat label="Approval Queue" value={String(approvalCount)} icon={AlertCircle} />
        <Stat label="Queue Items" value={String(snapshot.task_queue.total)} icon={ClipboardList} />
      </section>

      <section className="band">
        <div className="sectionTitle">
          <h2>Next Task</h2>
          <span>{snapshot.next_task.source || "handoff"}</span>
        </div>
        <div className="nextTask">
          <strong>{snapshot.next_task.title || "No task selected"}</strong>
          <dl>
            <div>
              <dt>ID</dt>
              <dd>{snapshot.next_task.id || "n/a"}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{snapshot.next_task.priority || "n/a"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="grid">
        <div className="panel wide">
          <div className="sectionTitle">
            <h2>Phase Progress</h2>
            <span>{phaseCount} phases</span>
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
        </div>

        <div className="panel">
          <div className="sectionTitle">
            <h2>Decisions</h2>
            <span>{pendingCount} pending</span>
          </div>
          {pendingCount === 0 ? (
            <p className="empty">No pending decisions.</p>
          ) : (
            <ul className="decisionList">
              {snapshot.pending_decisions.map((decision) => (
                <li key={decision.title}>
                  <strong>{decision.title}</strong>
                  <span>
                    {decision.priority} · {decision.category}
                  </span>
                  {decision.blocks ? <p>{decision.blocks}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <div className="sectionTitle">
            <h2>Usage Budget</h2>
            <span>{snapshot.usage_budget.providers.join(", ") || "n/a"}</span>
          </div>
          <div className="budget">
            <strong>{numberFormatter.format(snapshot.usage_budget.total_remaining_units)}</strong>
            <span>remaining units</span>
            <p>{snapshot.usage_budget.account_count} user-managed accounts tracked</p>
            <p>{snapshot.usage_budget.weekend_reserve_units} units reserved for weekend continuity</p>
          </div>
        </div>

        <div className="panel wide">
          <div className="sectionTitle">
            <h2>Usage Routing</h2>
            <span>{snapshot.usage_budget.reserve_ok_now ? "reserve ok" : "reserve low"}</span>
          </div>
          <div className="usageSummary">
            <div>
              <strong>{numberFormatter.format(snapshot.usage_budget.spendable_before_reserve)}</strong>
              <span>spendable before reserve</span>
            </div>
            <div>
              <strong>{numberFormatter.format(snapshot.usage_budget.recommended_today_budget_units)}</strong>
              <span>today budget units</span>
            </div>
            <div>
              <strong>{snapshot.usage_budget.days_to_reset}</strong>
              <span>days to reset</span>
            </div>
            <div>
              <strong>{snapshot.usage_budget.weekend_days_left.length}</strong>
              <span>weekend days left</span>
            </div>
          </div>
          <div className="accountGrid">
            {snapshot.usage_budget.accounts.map((account) => (
              <article className="accountCard" key={account.id}>
                <div>
                  <strong>{account.id}</strong>
                  <span>
                    {account.provider} / {account.plan}
                  </span>
                </div>
                <ProgressBar value={account.remaining_percent} />
                <small>
                  {account.remaining_units}/{account.weekly_budget_units} units / reset {account.reset_day}
                </small>
              </article>
            ))}
          </div>
          <div className="routingGrid">
            {snapshot.usage_budget.recommendations.map((recommendation) => (
              <article className="routeCard" key={recommendation.complexity}>
                <header>
                  <strong>{recommendation.complexity}</strong>
                  <span className={`pill ${recommendation.status}`}>{recommendation.status}</span>
                </header>
                {recommendation.account_id ? (
                  <p>
                    {recommendation.account_id} / {recommendation.model_tier} / {recommendation.reasoning_effort}
                  </p>
                ) : (
                  <p>No account available</p>
                )}
                <small>{recommendation.reason}</small>
              </article>
            ))}
          </div>
        </div>

        <div className="panel wide">
          <div className="sectionTitle">
            <h2>Workers</h2>
            <span>{snapshot.workers.length} registered</span>
          </div>
          <div className="workerGrid">
            {snapshot.workers.map((worker) => (
              <article className="workerRow" key={worker.id}>
                <div>
                  <strong>{worker.display_name || worker.id}</strong>
                  <span>{worker.kind}</span>
                </div>
                <span className={`pill ${worker.latest_status}`}>{worker.latest_status}</span>
                <p>{worker.latest_task || "No recent run state"}</p>
                <small>{worker.latest_reason}</small>
              </article>
            ))}
          </div>
        </div>

        <div className="panel wide">
          <div className="sectionTitle">
            <h2>Approval Queue</h2>
            <span>{approvalCount} waiting</span>
          </div>
          <div className="approvalSummary">
            <div>
              <strong>{snapshot.approval_queue.pending_decisions.length}</strong>
              <span>pending decisions</span>
            </div>
            <div>
              <strong>{snapshot.approval_queue.held_tasks.length}</strong>
              <span>held tasks</span>
            </div>
            <div>
              <strong>{snapshot.approval_queue.policy.hold_for_user.length}</strong>
              <span>hold rules</span>
            </div>
            <div>
              <strong>{snapshot.approval_queue.policy.deny.length}</strong>
              <span>deny rules</span>
            </div>
          </div>
          <div className="approvalGrid">
            <section>
              <h3>Waiting Decisions</h3>
              {snapshot.approval_queue.pending_decisions.length === 0 ? (
                <p className="empty">No pending decisions.</p>
              ) : (
                <ul>
                  {snapshot.approval_queue.pending_decisions.map((decision) => (
                    <li key={decision.title}>
                      <strong>{decision.title}</strong>
                      <span>
                        {decision.priority} / {decision.category}
                      </span>
                      {decision.blocks ? <p>{decision.blocks}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>Policy Boundaries</h3>
              <ul>
                {[...snapshot.approval_queue.policy.hold_for_user, ...snapshot.approval_queue.policy.deny].slice(0, 8).map((rule) => (
                  <li key={rule.id}>
                    <strong>{rule.id}</strong>
                    <span>{rule.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <div className="panel wide">
          <div className="sectionTitle">
            <h2>Latest Run</h2>
            <span>{snapshot.latest_run?.status || "unknown"}</span>
          </div>
          {snapshot.latest_run ? (
            <div className="run">
              <p>{snapshot.latest_run.summary}</p>
              <span>{snapshot.latest_run.verification}</span>
              <small>{snapshot.latest_run.at}</small>
            </div>
          ) : (
            <p className="empty">No run status recorded.</p>
          )}
        </div>

        <div className="panel wide">
          <div className="sectionTitle">
            <h2>Handoff Viewer</h2>
            <span>{snapshot.handoff_documents.length} docs</span>
          </div>
          <div className="handoffList">
            {snapshot.handoff_documents.map((document) => (
              <article className="handoffDoc" key={document.id}>
                <header>
                  <FileText aria-hidden="true" size={16} />
                  <div>
                    <strong>{document.title}</strong>
                    <span>{document.path}</span>
                  </div>
                </header>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>{document.status || "n/a"}</dd>
                  </div>
                  <div>
                    <dt>Next</dt>
                    <dd>{document.next || document.generated || "n/a"}</dd>
                  </div>
                  <div>
                    <dt>Lines</dt>
                    <dd>{document.line_count}</dd>
                  </div>
                </dl>
                <pre>{document.excerpt || "No content."}</pre>
              </article>
            ))}
          </div>
        </div>

        <div className="panel wide">
          <div className="sectionTitle">
            <h2>Upcoming Queue</h2>
            <GitBranch aria-hidden="true" size={18} />
          </div>
          <ol className="queueList">
            {snapshot.task_queue.next.map((task) => (
              <li key={task.id}>
                <strong>{task.title}</strong>
                <span>
                  {task.phase} · priority {task.priority}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
