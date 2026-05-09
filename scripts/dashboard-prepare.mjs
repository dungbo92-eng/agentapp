#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DASHBOARD_PUBLIC = path.join(REPO_ROOT, "apps", "dashboard", "public");
const SNAPSHOT = path.join(DASHBOARD_PUBLIC, "agent-snapshot.json");

const FILES = {
  roadmap: path.join(REPO_ROOT, ".claude-sync", "plans", "agent-orchestrator-roadmap.md"),
  projectState: path.join(REPO_ROOT, ".claude-sync", "memory", "project_state.md"),
  nextTask: path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "NEXT_TASK.md"),
  decisions: path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "DECISIONS_REQUIRED.md"),
  runStatus: path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "RUN_STATUS.md"),
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

function summarizeUsageBudget(usageBudget) {
  const accounts = Array.isArray(usageBudget?.accounts) ? usageBudget.accounts : [];
  return {
    total_remaining_units: accounts.reduce((sum, account) => sum + Number(account.remaining_units || 0), 0),
    account_count: accounts.length,
    providers: [...new Set(accounts.map((account) => account.provider))],
    weekend_reserve_units: Number(usageBudget?.weekend_reserve?.minimum_units || 0),
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

const [roadmap, projectState, nextTask, decisions, runStatus, taskQueue, usageBudget, workersText, runStates] = await Promise.all([
  readText(FILES.roadmap),
  readText(FILES.projectState),
  readText(FILES.nextTask),
  readText(FILES.decisions),
  readText(FILES.runStatus),
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
