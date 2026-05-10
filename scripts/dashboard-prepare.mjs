#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DASHBOARD_PUBLIC = path.join(REPO_ROOT, "apps", "dashboard", "public");
const SNAPSHOT = path.join(DASHBOARD_PUBLIC, "agent-snapshot.json");
const DAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
const INDEX_DAY = Object.fromEntries(Object.entries(DAY_INDEX).map(([day, index]) => [index, day]));
const MODEL_RANK = {
  efficient: 1,
  balanced: 2,
  sonnet: 3,
  best_available: 4,
  opus: 5,
  other: 0,
};

const FILES = {
  roadmap: path.join(REPO_ROOT, ".claude-sync", "plans", "agent-orchestrator-roadmap.md"),
  projectState: path.join(REPO_ROOT, ".claude-sync", "memory", "project_state.md"),
  nextTask: path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "NEXT_TASK.md"),
  decisions: path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "DECISIONS_REQUIRED.md"),
  approvalPolicy: path.join(REPO_ROOT, "tools", "agent-orchestrator", "approval-policy.yaml"),
  runStatus: path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "RUN_STATUS.md"),
  dashboardRun: path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "DASHBOARD_RUN.md"),
  taskQueue: path.join(REPO_ROOT, "tools", "agent-orchestrator", "task-queue.json"),
  usageBudget: path.join(REPO_ROOT, "tools", "agent-orchestrator", "usage-budget.example.json"),
  workers: path.join(REPO_ROOT, "tools", "agent-orchestrator", "workers.example.yaml"),
  workerRunStateExample: path.join(REPO_ROOT, "tools", "agent-orchestrator", "worker-run-state.example.json"),
  workerRunStatesDir: path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "run-states"),
};

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readText(file));
  } catch {
    return null;
  }
}

function parseRoadmap(markdown) {
  const phases = [];
  let current = null;

  for (const line of markdown.split(/\r?\n/)) {
    const phaseMatch = line.match(/^##\s+(.+)$/);
    if (phaseMatch) {
      current = { title: phaseMatch[1], done: 0, total: 0, items: [] };
      phases.push(current);
      continue;
    }

    const itemMatch = line.match(/^- \[( |x|X)\]\s+(.+)$/);
    if (current && itemMatch) {
      const done = itemMatch[1].toLowerCase() === "x";
      current.total += 1;
      if (done) current.done += 1;
      current.items.push({ title: itemMatch[2], done });
    }
  }

  const total = phases.reduce((sum, phase) => sum + phase.total, 0);
  const done = phases.reduce((sum, phase) => sum + phase.done, 0);
  return {
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
    done,
    total,
    phases: phases.filter((phase) => phase.total > 0),
  };
}

function getMeta(markdown, label) {
  return markdown.match(new RegExp(`^- ${label}:\\s*(.+)$`, "m"))?.[1]?.trim() || "";
}

function parseNextTask(markdown) {
  return {
    generated: getMeta(markdown, "Generated"),
    title: getMeta(markdown, "Selected task"),
    source: getMeta(markdown, "Selection source"),
    id: getMeta(markdown, "Task id"),
    priority: getMeta(markdown, "Task priority"),
  };
}

function parsePendingDecisions(markdown) {
  const pending = markdown.match(/## 대기\n([\s\S]*?)(?=\n## |\n?$)/)?.[1] || "";
  return [...pending.matchAll(/^###\s+(.+)$/gm)].map((match) => {
    const start = match.index || 0;
    const next = pending.indexOf("\n### ", start + 1);
    const section = pending.slice(start, next === -1 ? undefined : next);
    return {
      title: match[1].trim(),
      priority: section.match(/^- Priority:\s*(.+)$/m)?.[1]?.trim() || "unknown",
      category: section.match(/^- Category:\s*(.+)$/m)?.[1]?.trim() || "unknown",
      blocks: section.match(/^- Blocks:\s*(.+)$/m)?.[1]?.trim() || "",
    };
  });
}

function parseLatestRunStatus(markdown) {
  const entries = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  if (entries.length === 0) return null;
  const last = entries.at(-1);
  const section = markdown.slice(last.index || 0);
  return {
    at: last[1],
    status: section.match(/^- Status:\s*(.+)$/m)?.[1]?.trim() || "unknown",
    summary: section.match(/^- Summary:\s*(.+)$/m)?.[1]?.trim() || "",
    verification: section.match(/^- Verification:\s*(.+)$/m)?.[1]?.trim() || "",
    next: section.match(/^- Next:\s*(.+)$/m)?.[1]?.trim() || "",
  };
}

function compactExcerpt(markdown, mode = "head", limit = 2200) {
  const normalized = markdown.trim();
  if (normalized.length <= limit) return normalized;
  const slice = mode === "tail" ? normalized.slice(-limit) : normalized.slice(0, limit);
  return mode === "tail" ? `...${slice}` : `${slice}...`;
}

function summarizeHandoffDocuments(documents) {
  return documents.map((document) => {
    const lines = document.markdown.split(/\r?\n/).filter(Boolean);
    const heading = lines.find((line) => line.startsWith("#"))?.replace(/^#+\s*/, "") || document.title;
    const status = document.status ?? getMeta(document.markdown, "Status");
    const next = document.next ?? getMeta(document.markdown, "Next");
    const generated = document.generated ?? getMeta(document.markdown, "Generated");
    const decisionCount = document.decisionCount ?? document.markdown.match(/^###\s+DEC-.+$/gm)?.length ?? 0;

    return {
      id: document.id,
      title: document.title,
      path: path.relative(REPO_ROOT, document.file).replace(/\\/g, "/"),
      heading,
      status,
      next,
      generated,
      decision_count: decisionCount,
      line_count: lines.length,
      excerpt: compactExcerpt(document.markdown, document.mode),
    };
  });
}

function summarizeTaskQueue(taskQueue) {
  const tasks = Array.isArray(taskQueue?.tasks) ? taskQueue.tasks : [];
  const statuses = tasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});
  return {
    total: tasks.length,
    statuses,
    next: tasks
      .filter((task) => task.status === "pending")
      .sort((left, right) => (right.priority || 0) - (left.priority || 0))
      .slice(0, 5)
      .map((task) => ({ id: task.id, title: task.title, phase: task.phase, priority: task.priority })),
  };
}

function parsePolicyItems(text, sectionName) {
  const section = text.match(new RegExp(`(?:^|\\n)${sectionName}:\\n([\\s\\S]*?)(?=\\n[a-z_]+:|$)`))?.[1] || "";
  const items = [];
  const matches = [...section.matchAll(/^  - id:\s*(.+?)\s*$(?:\r?\n    description:\s*"(.+?)")?/gm)];

  for (const match of matches) {
    items.push({
      id: match[1].trim(),
      description: (match[2] || "").trim(),
    });
  }

  return items;
}

function summarizeApprovalQueue(decisions, taskQueue, approvalPolicy) {
  const tasks = Array.isArray(taskQueue?.tasks) ? taskQueue.tasks : [];
  const pendingDecisions = parsePendingDecisions(decisions);
  const heldTasks = tasks
    .filter((task) => task.status === "hold" || task.status === "blocked" || task.blocked_by?.some((blocker) => String(blocker).startsWith("DEC-")))
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      blocked_by: task.blocked_by || [],
      reason: task.reason || "",
    }));

  return {
    pending_decisions: pendingDecisions,
    held_tasks: heldTasks,
    policy: {
      hold_for_user: parsePolicyItems(approvalPolicy, "hold_for_user"),
      deny: parsePolicyItems(approvalPolicy, "deny"),
      user_required: parsePolicyItems(approvalPolicy, "user_required"),
    },
  };
}

function dayName(date) {
  return INDEX_DAY[date.getDay()];
}

function daysUntil(fromIndex, targetIndex) {
  const diff = (targetIndex - fromIndex + 7) % 7;
  return diff === 0 ? 7 : diff;
}

function daysInWindow(todayIndex, count) {
  return Array.from({ length: count }, (_, offset) => INDEX_DAY[(todayIndex + offset) % 7]);
}

function scoreUsageCandidate(candidate, complexity) {
  const rank = MODEL_RANK[candidate.profile.model_tier] || 0;
  const remaining = Number(candidate.account.remaining_units || 0);
  const estimated = Number(candidate.profile.estimated_units || 0);

  if (complexity === "routine") return remaining * 2 - estimated * 10 + rank;
  if (complexity === "standard") return rank * 20 + remaining - estimated * 2;
  return rank * 100 + remaining - estimated;
}

function modelReason(complexity, reserveOk) {
  if (!reserveOk && ["complex", "critical"].includes(complexity)) {
    return "Quality-first route, but split the task or ask for approval before spending weekend reserve.";
  }
  if (complexity === "routine") return "Use an efficient profile for context review, setup, and simple documentation.";
  if (complexity === "standard") return "Use a balanced profile for normal implementation and bug fixing.";
  return "Use the highest quality profile for architecture, trading logic, AI integration, and high-risk reasoning.";
}

function recommendForComplexity(accounts, complexity, totalRemaining, reserve) {
  const candidates = accounts
    .map((account) => ({ account, profile: account.model_profiles?.[complexity] }))
    .filter((candidate) => candidate.profile)
    .filter((candidate) => Number(candidate.account.remaining_units || 0) >= Number(candidate.profile.estimated_units || 0))
    .sort((left, right) => scoreUsageCandidate(right, complexity) - scoreUsageCandidate(left, complexity));

  if (candidates.length === 0) {
    return {
      complexity,
      status: "blocked",
      reason: "No configured account has enough remaining local budget units for this complexity.",
    };
  }

  const selected = candidates[0];
  const estimated = Number(selected.profile.estimated_units || 0);
  const remainingAfter = totalRemaining - estimated;
  const reserveOk = remainingAfter >= reserve;

  return {
    complexity,
    status: reserveOk || complexity === "routine" ? "recommended" : "needs_decision",
    account_id: selected.account.id,
    provider: selected.account.provider,
    model_tier: selected.profile.model_tier,
    reasoning_effort: selected.profile.reasoning_effort,
    estimated_units: estimated,
    weekend_reserve_after_run: remainingAfter - reserve,
    weekend_reserve_ok: reserveOk,
    reason: modelReason(complexity, reserveOk),
  };
}

function summarizeUsageBudget(usageBudget) {
  const accounts = Array.isArray(usageBudget?.accounts) ? usageBudget.accounts : [];
  const now = new Date();
  const today = dayName(now);
  const todayIndex = DAY_INDEX[today];
  const resetDay = usageBudget?.week_start_day || "monday";
  const resetIndex = DAY_INDEX[resetDay] ?? DAY_INDEX.monday;
  const daysToReset = daysUntil(todayIndex, resetIndex);
  const periodDays = daysInWindow(todayIndex, daysToReset);
  const reserveDays = new Set(usageBudget?.weekend_reserve?.days || []);
  const weekendDaysLeft = periodDays.filter((day) => reserveDays.has(day));
  const workingDaysLeft = Math.max(1, periodDays.length - weekendDaysLeft.length);
  const totalRemaining = accounts.reduce((sum, account) => sum + Number(account.remaining_units || 0), 0);
  const weekendReserve = usageBudget?.weekend_reserve?.enabled ? Number(usageBudget.weekend_reserve.minimum_units || 0) : 0;
  const spendableBeforeReserve = Math.max(0, totalRemaining - weekendReserve);
  const providerMap = new Map();

  for (const account of accounts) {
    const summary = providerMap.get(account.provider) || {
      provider: account.provider,
      accounts: 0,
      remaining_units: 0,
      weekly_budget_units: 0,
    };
    summary.accounts += 1;
    summary.remaining_units += Number(account.remaining_units || 0);
    summary.weekly_budget_units += Number(account.weekly_budget_units || 0);
    providerMap.set(account.provider, summary);
  }

  return {
    total_remaining_units: totalRemaining,
    account_count: accounts.length,
    providers: [...new Set(accounts.map((account) => account.provider))],
    weekend_reserve_units: weekendReserve,
    spendable_before_reserve: spendableBeforeReserve,
    recommended_today_budget_units: Number((spendableBeforeReserve / workingDaysLeft).toFixed(2)),
    reset_day: resetDay,
    days_to_reset: daysToReset,
    weekend_days_left: weekendDaysLeft,
    reserve_ok_now: totalRemaining >= weekendReserve,
    provider_summaries: Array.from(providerMap.values()),
    accounts: accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      plan: account.plan,
      auth: account.auth,
      remaining_units: Number(account.remaining_units || 0),
      weekly_budget_units: Number(account.weekly_budget_units || 0),
      remaining_percent:
        Number(account.weekly_budget_units || 0) > 0
          ? Math.round((Number(account.remaining_units || 0) / Number(account.weekly_budget_units || 0)) * 100)
          : 0,
      reset_day: account.reset_day || resetDay,
    })),
    recommendations: ["routine", "standard", "complex", "critical"].map((complexity) =>
      recommendForComplexity(accounts, complexity, totalRemaining, weekendReserve),
    ),
  };
}

function parseWorkers(text) {
  const workers = [];
  let inWorkers = false;
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    if (line === "workers:") {
      inWorkers = true;
      continue;
    }
    if (!inWorkers) continue;
    if (/^[a-z_]+:/.test(line)) break;

    const workerMatch = line.match(/^  - id:\s*(.+?)\s*$/);
    if (workerMatch) {
      current = { id: workerMatch[1].trim(), kind: "", display_name: "", status: "unknown" };
      workers.push(current);
      continue;
    }

    if (!current) continue;
    const fieldMatch = line.match(/^    (kind|display_name|status):\s*(.+?)\s*$/);
    if (fieldMatch) {
      current[fieldMatch[1]] = fieldMatch[2].trim().replace(/^"|"$/g, "");
    }
  }

  return workers;
}

async function readRunStates() {
  const states = [];
  const example = await readJson(FILES.workerRunStateExample);
  if (example) states.push(example);

  try {
    const entries = await readdir(FILES.workerRunStatesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const parsed = await readJson(path.join(FILES.workerRunStatesDir, entry.name));
      if (parsed) states.push(parsed);
    }
  } catch {
    // A missing run-states directory simply means no live handoff-only fallback has been recorded.
  }

  return states;
}

function summarizeWorkers(workers, runStates) {
  return workers.map((worker) => {
    const latest = runStates
      .filter((state) => state.worker_id === worker.id)
      .sort((left, right) => String(right.timestamps?.updated_at || "").localeCompare(String(left.timestamps?.updated_at || "")))[0];

    return {
      ...worker,
      latest_status: latest?.status || worker.status,
      latest_reason: latest?.reason || "none",
      latest_task: latest?.task?.title || "",
      latest_updated_at: latest?.timestamps?.updated_at || "",
      handoff_summary: latest?.handoff?.summary || "",
    };
  });
}

const [
  roadmap,
  projectState,
  nextTask,
  decisions,
  approvalPolicy,
  runStatus,
  dashboardRun,
  taskQueue,
  usageBudget,
  workersText,
  runStates,
] = await Promise.all([
  readText(FILES.roadmap),
  readText(FILES.projectState),
  readText(FILES.nextTask),
  readText(FILES.decisions),
  readText(FILES.approvalPolicy),
  readText(FILES.runStatus),
  readText(FILES.dashboardRun),
  readJson(FILES.taskQueue),
  readJson(FILES.usageBudget),
  readText(FILES.workers),
  readRunStates(),
]);

const snapshot = {
  generated_at: new Date().toISOString(),
  repo_root: REPO_ROOT,
  progress: parseRoadmap(roadmap),
  next_task: parseNextTask(nextTask),
  pending_decisions: parsePendingDecisions(decisions),
  latest_run: parseLatestRunStatus(runStatus),
  approval_queue: summarizeApprovalQueue(decisions, taskQueue, approvalPolicy),
  handoff_documents: summarizeHandoffDocuments([
    {
      id: "next-task",
      title: "NEXT_TASK.md",
      file: FILES.nextTask,
      markdown: nextTask,
      mode: "head",
      status: parseNextTask(nextTask).source || "handoff",
      next: parseNextTask(nextTask).title,
      generated: parseNextTask(nextTask).generated,
    },
    {
      id: "run-status",
      title: "RUN_STATUS.md",
      file: FILES.runStatus,
      markdown: runStatus,
      mode: "tail",
      status: parseLatestRunStatus(runStatus)?.status || "",
      next: parseLatestRunStatus(runStatus)?.next || "",
      generated: parseLatestRunStatus(runStatus)?.at || "",
    },
    {
      id: "dashboard-run",
      title: "DASHBOARD_RUN.md",
      file: FILES.dashboardRun,
      markdown: dashboardRun,
      mode: "head",
      status: dashboardRun.match(/^- Status:\s*(.+)$/m)?.[1]?.trim() || "not_started",
      next: dashboardRun.match(/## Next Step\s+([\s\S]+)$/m)?.[1]?.trim().split(/\r?\n/)[0] || "",
      generated: dashboardRun.match(/^- Generated:\s*(.+)$/m)?.[1]?.trim() || "",
    },
    {
      id: "decisions",
      title: "DECISIONS_REQUIRED.md",
      file: FILES.decisions,
      markdown: decisions,
      mode: "head",
      status: `${parsePendingDecisions(decisions).length} pending`,
      decisionCount: parsePendingDecisions(decisions).length,
    },
  ]),
  task_queue: summarizeTaskQueue(taskQueue),
  usage_budget: summarizeUsageBudget(usageBudget),
  workers: summarizeWorkers(parseWorkers(workersText), runStates),
  project_state_excerpt: projectState.slice(0, 1200),
};

await mkdir(DASHBOARD_PUBLIC, { recursive: true });
await writeFile(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`snapshot=${SNAPSHOT}`);
