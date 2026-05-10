#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_STATUS = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "RUN_STATUS.md");
const DECISIONS_REQUIRED = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "DECISIONS_REQUIRED.md");

function parseArgs(argv) {
  const options = {
    json: false,
    "write-next": false,
    "write-report": false,
    "prepare-dashboard": false,
  };

  for (const arg of argv) {
    if (arg === "--json") options.json = true;
    if (arg === "--write-next") options["write-next"] = true;
    if (arg === "--write-report") options["write-report"] = true;
    if (arg === "--prepare-dashboard") options["prepare-dashboard"] = true;
  }

  return options;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });

  return {
    command: [command, ...args].join(" "),
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function runNode(script, args = []) {
  return run(process.execPath, [path.join(REPO_ROOT, script), ...args]);
}

function firstLineMatching(output, prefix) {
  return output.split(/\r?\n/).find((line) => line.startsWith(prefix)) || "";
}

function gitSummary() {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = run("git", ["status", "--porcelain=v1"]);
  const changed = status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean).length : 0;

  return {
    branch: branch.stdout || "unknown",
    changed,
    clean: changed === 0,
    status_ok: branch.status === 0 && status.status === 0,
  };
}

function commandOk(result) {
  return result.status === 0;
}

async function pendingDecisionSummary() {
  try {
    const markdown = await readFile(DECISIONS_REQUIRED, "utf8");
    const pendingSection = markdown.match(/##\s+대기\n([\s\S]*?)(?=\n## |\n?$)/)?.[1] || "";
    const headings = [...pendingSection.matchAll(/^###\s+DEC-.+$/gm)];
    const pending = headings.filter((heading, index) => {
      const next = headings[index + 1];
      const section = pendingSection.slice(heading.index || 0, next?.index ?? undefined);
      return /^- Status:\s*pending\s*$/m.test(section);
    });
    return {
      count: pending.length,
      level: pending.length > 0 ? "attention" : "clear",
    };
  } catch {
    return {
      count: 0,
      level: "unknown",
    };
  }
}

async function writeReport(summary) {
  const entry = `
## ${summary.generated_at}

- Status: ${summary.decisions.count > 0 ? "in_progress" : "completed"}
- Summary: Scheduled check completed. next=${summary.next_task || "unknown"} git_clean=${summary.git.clean} sync_ok=${summary.sync_ok} pending_decisions=${summary.decisions.count}
- Verification: agent:scheduled-check commands completed; progress=${summary.progress || "unknown"}
- Git: read-only check
- Decisions: ${summary.decisions.count > 0 ? `${summary.decisions.count} pending` : "none"}
- Next: ${summary.next_task || "See NEXT_TASK.md"}
`;

  await appendFile(RUN_STATUS, entry, "utf8");
}

const options = parseArgs(process.argv.slice(2));
const sync = runNode("scripts/claude-sync.mjs", ["--status"]);
const progress = runNode("scripts/agent-progress.mjs");
const budget = runNode("scripts/agent-budget.mjs", ["--json"]);
const next = options["write-next"] ? runNode("scripts/agent-next.mjs") : null;
const dashboard = options["prepare-dashboard"] ? runNode("scripts/dashboard-prepare.mjs") : null;
const git = gitSummary();
const decisions = await pendingDecisionSummary();

const summary = {
  generated_at: new Date().toISOString(),
  mode: {
    write_next: options["write-next"],
    write_report: options["write-report"],
    prepare_dashboard: options["prepare-dashboard"],
  },
  sync_ok: commandOk(sync) && !sync.stdout.includes("repo-newer") && !sync.stdout.includes("claude-newer"),
  progress: firstLineMatching(progress.stdout, "progress=").replace("progress=", ""),
  next_task: options["write-next"]
    ? firstLineMatching(next?.stdout || "", "next-task=").replace("next-task=", "")
    : firstLineMatching(progress.stdout, "next=").replace("next=", ""),
  decisions,
  git,
  budget_ok: commandOk(budget),
  commands: {
    sync,
    progress,
    budget,
    next,
    dashboard,
  },
};

if (options["write-report"]) {
  await writeReport(summary);
}

if (options.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`generated_at=${summary.generated_at}`);
  console.log(`git_branch=${summary.git.branch}`);
  console.log(`git_clean=${summary.git.clean}`);
  console.log(`sync_ok=${summary.sync_ok}`);
  console.log(`progress=${summary.progress || "unknown"}`);
  console.log(`next=${summary.next_task || "unknown"}`);
  console.log(`pending_decisions=${summary.decisions.count}`);
  console.log(`decision_level=${summary.decisions.level}`);
  console.log(`write_next=${summary.mode.write_next}`);
  console.log(`write_report=${summary.mode.write_report}`);
  console.log(`prepare_dashboard=${summary.mode.prepare_dashboard}`);
}
