#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DATA_DIR,
  REPO_ROOT,
  appendRunEvent,
  finishRunRecord,
  patchRunRecord,
  readRuntime,
  relativePath,
  reserveAccountBudget,
  updateAccountSession,
} from "./dashboard-runtime.mjs";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const WORKER_PROMPTS_DIR = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "worker-prompts");
const RUNS_DIR = path.join(DATA_DIR, "worker-launches");
const LOGIN_REQUIRED_PATTERNS = [
  /not logged in/i,
  /log in/i,
  /login required/i,
  /sign in/i,
  /session expired/i,
  /reauth/i,
  /authentication/i,
];

const HELP = `Usage:
  node scripts/worker-launch-adapter.mjs --execute-run <run-id>
  node scripts/worker-launch-adapter.mjs --stop-run <run-id> [--pid <pid>]

This script is used by dashboard-runtime.mjs to execute or stop local worker launch adapters.
`;

function parseArgs(argv) {
  const options = {
    executeRun: "",
    stopRun: "",
    pid: 0,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--execute-run") {
      options.executeRun = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--stop-run") {
      options.stopRun = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--pid") {
      options.pid = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeSegment(value) {
  return String(value || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

function launchFilesFor(runId) {
  const runDir = path.join(RUNS_DIR, sanitizeSegment(runId));
  return {
    runDir,
    promptPath: path.join(runDir, "launch-prompt.md"),
    launchLogPath: path.join(runDir, "worker.log"),
    validationLogPath: path.join(runDir, "validate.log"),
    lastMessagePath: path.join(runDir, "last-message.txt"),
    metadataPath: path.join(runDir, "metadata.json"),
  };
}

async function resolveRun(runId) {
  const runtime = await readRuntime();
  return runtime.activeRun?.id === runId
    ? runtime.activeRun
    : runtime.runHistory.find((item) => item.id === runId) || null;
}

async function readWorkerPrompt(workerId) {
  try {
    return await readFile(path.join(WORKER_PROMPTS_DIR, `${workerId}.md`), "utf8");
  } catch {
    return "";
  }
}

async function writeLaunchPrompt(run, files) {
  const workerPrompt = await readWorkerPrompt(run.workerId);
  const prompt = `# Dashboard Launch Request

- Generated: ${nowIso()}
- Worker: ${run.workerId}
- Project: ${run.projectId}
- Account: ${run.routing?.accountId || "none"}
- Session profile: ${run.routing?.sessionProfile || "none"}
- Model: ${run.routing?.model || run.modelOverride || "auto"}
- Reasoning: ${run.routing?.reasoningEffort || "n/a"}

## Worker Prompt

${workerPrompt || "See tools/agent-orchestrator/handoff/worker-prompts for the standard worker prompt."}

## Dashboard User Prompt

${run.prompt || "Continue from tools/agent-orchestrator/handoff/NEXT_TASK.md."}
`;

  await mkdir(files.runDir, { recursive: true });
  await writeFile(files.promptPath, prompt, "utf8");
  return prompt;
}

async function appendLog(file, text) {
  await appendFile(file, `${text}\n`, "utf8");
}

async function commandPathFor(command) {
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

function buildSessionProfileDir(provider, sessionProfile) {
  return path.join(DATA_DIR, "session-profiles", sanitizeSegment(provider), sanitizeSegment(sessionProfile));
}

async function resolveAdapter(run, files) {
  const sessionProfile = run.routing?.sessionProfile || `${run.workerId}-${run.routing?.accountId || "default"}`;
  const workspace = REPO_ROOT;

  if (run.workerId === "codex") {
    const command = process.env.AGENTAPP_CODEX_COMMAND || (await commandPathFor("codex"));
    if (!command) {
      return {
        status: "blocked",
        mode: "command",
        summary: "Codex CLI was not found on this machine.",
      };
    }

    const sessionDir = buildSessionProfileDir("codex", sessionProfile);
    await mkdir(sessionDir, { recursive: true });
    return {
      status: "ready",
      mode: "command",
      command,
      args: [
        "exec",
        "-C",
        workspace,
        "-m",
        run.routing?.model || run.modelOverride || "gpt-5.4",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
        "-o",
        files.lastMessagePath,
        "-",
      ],
      env: {
        CODEX_HOME: sessionDir,
        AGENTAPP_SESSION_PROFILE: sessionProfile,
        AGENTAPP_ACCOUNT_ID: run.routing?.accountId || "",
        AGENTAPP_MODEL: run.routing?.model || run.modelOverride || "auto",
      },
      sessionDir,
      summary: "Codex exec adapter is ready.",
    };
  }

  if (run.workerId === "cursor") {
    const command = process.env.AGENTAPP_CURSOR_COMMAND || "cursor";
    const found = await commandPathFor(command);
    if (!found && !process.env.AGENTAPP_CURSOR_COMMAND) {
      return {
        status: "blocked",
        mode: "open-window",
        summary: "Cursor CLI was not found on this machine.",
      };
    }

    const sessionDir = buildSessionProfileDir("cursor", sessionProfile);
    await mkdir(sessionDir, { recursive: true });
    return {
      status: "ready",
      mode: "open-window",
      command,
      args: [
        "--reuse-window",
        "--user-data-dir",
        sessionDir,
        workspace,
        "-g",
        `${files.promptPath}:1`,
      ],
      env: {
        AGENTAPP_SESSION_PROFILE: sessionProfile,
        AGENTAPP_ACCOUNT_ID: run.routing?.accountId || "",
        AGENTAPP_MODEL: run.routing?.model || run.modelOverride || "auto",
      },
      sessionDir,
      summary: "Cursor window adapter is ready.",
    };
  }

  if (run.workerId === "claude-code") {
    return {
      status: "manual",
      mode: "manual",
      summary: "Claude Code is not auto-configured on this machine. Open the worker prompt manually in the authenticated terminal session.",
    };
  }

  if (run.workerId === "gemini-cli") {
    return {
      status: "manual",
      mode: "manual",
      summary: "Gemini CLI is not auto-configured on this machine. Open the worker prompt manually in the authenticated terminal session.",
    };
  }

  return {
    status: "blocked",
    mode: "manual",
    summary: `No launch adapter is defined for worker ${run.workerId}.`,
  };
}

export { resolveAdapter as resolveLaunchAdapter };

function lineChunks(buffer, chunk) {
  const text = `${buffer}${chunk.toString("utf8")}`;
  const parts = text.split(/\r?\n/);
  return { lines: parts.slice(0, -1), rest: parts.at(-1) || "" };
}

async function streamProcess(command, args, options = {}) {
  await mkdir(path.dirname(options.logPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || REPO_ROOT,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: options.windowsHide ?? true,
      shell: options.shell ?? false,
      detached: options.detached ?? false,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let combined = "";

    const forwardLines = async (lines, level) => {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        combined += `${trimmed}\n`;
        await appendLog(options.logPath, `[${level}] ${trimmed}`);
        if (options.onLine) await options.onLine(trimmed, level, child.pid);
      }
    };

    child.stdout.on("data", async (chunk) => {
      const next = lineChunks(stdoutBuffer, chunk);
      stdoutBuffer = next.rest;
      await forwardLines(next.lines, "stdout");
    });

    child.stderr.on("data", async (chunk) => {
      const next = lineChunks(stderrBuffer, chunk);
      stderrBuffer = next.rest;
      await forwardLines(next.lines, "stderr");
    });

    child.on("error", reject);
    child.on("close", async (code, signal) => {
      if (stdoutBuffer.trim()) await forwardLines([stdoutBuffer.trim()], "stdout");
      if (stderrBuffer.trim()) await forwardLines([stderrBuffer.trim()], "stderr");
      resolve({
        code: Number(code ?? 1),
        signal: signal || "",
        pid: child.pid,
        combinedOutput: combined.trim(),
      });
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText, "utf8");
      child.stdin.end();
    }

    if (options.onSpawn) options.onSpawn(child.pid);
  });
}

function loginRequired(output) {
  return LOGIN_REQUIRED_PATTERNS.some((pattern) => pattern.test(output || ""));
}

async function runPreflight(run, files) {
  await patchRunRecord(run.id, {
    validation: {
      status: "running",
      command: "pnpm validate",
      logPath: relativePath(files.validationLogPath),
      summary: "Running pnpm validate before launch.",
    },
  });
  await appendRunEvent(run.id, { level: "info", message: "Preflight validation started." });

  const result = await streamProcess(
    process.platform === "win32" ? "cmd.exe" : "sh",
    process.platform === "win32" ? ["/d", "/s", "/c", "pnpm validate"] : ["-lc", "pnpm validate"],
    {
      cwd: REPO_ROOT,
      logPath: files.validationLogPath,
      windowsHide: true,
    },
  );

  if (result.code === 0) {
    await patchRunRecord(run.id, {
      validation: {
        status: "passed",
        command: "pnpm validate",
        logPath: relativePath(files.validationLogPath),
        summary: "Preflight validation passed.",
      },
    });
    await appendRunEvent(run.id, { level: "info", message: "Preflight validation passed." });
    return true;
  }

  await finishRunRecord(
    run.id,
    {
      status: "blocked",
      validation: {
        status: "failed",
        command: "pnpm validate",
        logPath: relativePath(files.validationLogPath),
        summary: "Preflight validation failed.",
      },
      adapter: {
        status: "blocked",
        mode: "preflight",
      },
      events: [
        ...(run.events || []),
        { at: nowIso(), level: "error", message: "Preflight validation failed. Check validate.log before launching a worker." },
      ],
    },
    {
      handoffStatus: "blocked",
      handoffReason: "validation_failed",
    },
  );
  return false;
}

async function launchCommandWorker(run, files, adapter, promptText) {
  await patchRunRecord(run.id, {
    adapter: {
      status: "running",
      mode: adapter.mode,
      command: `${path.basename(adapter.command)} ${adapter.args.join(" ")}`,
      promptPath: relativePath(files.promptPath),
      logPath: relativePath(files.launchLogPath),
      sessionDir: relativePath(adapter.sessionDir),
    },
  });
  await appendRunEvent(run.id, {
    level: "info",
    message: `Starting ${run.workerId} with session profile ${run.routing?.sessionProfile || "default"}.`,
  });

  const result = await streamProcess(adapter.command, adapter.args, {
    cwd: REPO_ROOT,
    env: adapter.env,
    logPath: files.launchLogPath,
    stdinText: promptText,
    onSpawn: async (pid) => {
      await patchRunRecord(run.id, {
        adapter: {
          status: "running",
          mode: adapter.mode,
          pid,
          logPath: relativePath(files.launchLogPath),
          promptPath: relativePath(files.promptPath),
          sessionDir: relativePath(adapter.sessionDir),
          lastMessagePath: relativePath(files.lastMessagePath),
        },
      });
    },
    onLine: async (line, level) => {
      await appendRunEvent(run.id, {
        level: level === "stderr" ? "warn" : "info",
        message: line.length > 220 ? `${line.slice(0, 220)}...` : line,
      });
    },
  });

  let lastMessage = "";
  try {
    lastMessage = (await readFile(files.lastMessagePath, "utf8")).trim();
  } catch {
    lastMessage = "";
  }

  if (result.code === 0) {
    if (lastMessage) {
      await appendRunEvent(run.id, {
        level: "info",
        message: `Worker final message saved to ${relativePath(files.lastMessagePath)}.`,
      });
    }
    await finishRunRecord(
      run.id,
      {
        status: "completed",
        completedAt: nowIso(),
        adapter: {
          status: "completed",
          mode: adapter.mode,
          pid: result.pid,
          exitCode: result.code,
          logPath: relativePath(files.launchLogPath),
          promptPath: relativePath(files.promptPath),
          sessionDir: relativePath(adapter.sessionDir),
          lastMessagePath: relativePath(files.lastMessagePath),
        },
      },
      {
        handoffStatus: "completed",
        handoffReason: "completed",
      },
    );
    return;
  }

  if (loginRequired(result.combinedOutput)) {
    await updateAccountSession(run.routing?.accountId || "", "needs-login");
    await appendRunEvent(run.id, {
      level: "warn",
      message: "The worker reported a login or session problem. This session profile was marked needs-login.",
    });
    await finishRunRecord(
      run.id,
      {
        status: "needs_user",
        adapter: {
          status: "needs-login",
          mode: adapter.mode,
          pid: result.pid,
          exitCode: result.code,
          logPath: relativePath(files.launchLogPath),
          promptPath: relativePath(files.promptPath),
          sessionDir: relativePath(adapter.sessionDir),
        },
      },
      {
        handoffStatus: "needs_user",
        handoffReason: "missing_credentials",
      },
    );
    return;
  }

  await finishRunRecord(
    run.id,
    {
      status: "failed",
      adapter: {
        status: "failed",
        mode: adapter.mode,
        pid: result.pid,
        exitCode: result.code,
        logPath: relativePath(files.launchLogPath),
        promptPath: relativePath(files.promptPath),
        sessionDir: relativePath(adapter.sessionDir),
      },
    },
    {
      handoffStatus: "failed",
      handoffReason: "tool_error",
    },
  );
}

async function launchWindowWorker(run, files, adapter) {
  await patchRunRecord(run.id, {
    adapter: {
      status: "launching",
      mode: adapter.mode,
      promptPath: relativePath(files.promptPath),
      sessionDir: relativePath(adapter.sessionDir),
    },
  });

  const result = await streamProcess(adapter.command, adapter.args, {
    cwd: REPO_ROOT,
    env: adapter.env,
    logPath: files.launchLogPath,
    windowsHide: false,
    shell: process.platform === "win32",
    onSpawn: async (pid) => {
      await patchRunRecord(run.id, {
        adapter: {
          status: "needs-user",
          mode: adapter.mode,
          pid,
          promptPath: relativePath(files.promptPath),
          logPath: relativePath(files.launchLogPath),
          sessionDir: relativePath(adapter.sessionDir),
        },
      });
    },
  });

  if (result.code === 0) {
    await appendRunEvent(run.id, {
      level: "info",
      message: `Opened ${run.workerId} with session profile directory ${relativePath(adapter.sessionDir)}.`,
    });
    await patchRunRecord(
      run.id,
      {
        status: "running",
        adapter: {
          status: "needs-user",
          mode: adapter.mode,
          promptPath: relativePath(files.promptPath),
          logPath: relativePath(files.launchLogPath),
          sessionDir: relativePath(adapter.sessionDir),
        },
      },
      {
        handoffStatus: "running",
        handoffReason: "in_progress",
      },
    );
    return;
  }

  await finishRunRecord(
    run.id,
    {
      status: "failed",
      adapter: {
        status: "failed",
        mode: adapter.mode,
        exitCode: result.code,
        logPath: relativePath(files.launchLogPath),
        promptPath: relativePath(files.promptPath),
        sessionDir: relativePath(adapter.sessionDir),
      },
    },
    {
      handoffStatus: "failed",
      handoffReason: "tool_error",
    },
  );
}

async function markManualWorker(run, files, adapter) {
  await appendRunEvent(run.id, { level: "warn", message: adapter.summary });
  await finishRunRecord(
    run.id,
    {
      status: "needs_user",
      adapter: {
        status: "manual",
        mode: adapter.mode,
        promptPath: relativePath(files.promptPath),
        logPath: relativePath(files.launchLogPath),
      },
    },
    {
      handoffStatus: "needs_user",
      handoffReason: "missing_credentials",
    },
  );
}

async function blockUnavailableWorker(run, files, adapter) {
  await appendRunEvent(run.id, { level: "error", message: adapter.summary });
  await finishRunRecord(
    run.id,
    {
      status: "blocked",
      adapter: {
        status: "blocked",
        mode: adapter.mode,
        promptPath: relativePath(files.promptPath),
        logPath: relativePath(files.launchLogPath),
      },
    },
    {
      handoffStatus: "blocked",
      handoffReason: "tool_error",
    },
  );
}

async function writeMetadata(run, files, adapter) {
  const payload = {
    generatedAt: nowIso(),
    runId: run.id,
    workerId: run.workerId,
    accountId: run.routing?.accountId || "",
    sessionProfile: run.routing?.sessionProfile || "",
    mode: adapter.mode,
    promptPath: relativePath(files.promptPath),
    launchLogPath: relativePath(files.launchLogPath),
    validationLogPath: relativePath(files.validationLogPath),
    sessionDir: adapter.sessionDir ? relativePath(adapter.sessionDir) : "",
  };
  await writeFile(files.metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function executeRun(runId) {
  const run = await resolveRun(runId);
  if (!run) return;

  const files = launchFilesFor(run.id);
  const promptText = await writeLaunchPrompt(run, files);
  await appendRunEvent(run.id, {
    level: "info",
    message: `Launch prompt written to ${relativePath(files.promptPath)}.`,
  });

  if (!(await runPreflight(run, files))) {
    return;
  }

  const adapter = await resolveAdapter(run, files);
  await writeMetadata(run, files, adapter);

  if (adapter.status === "blocked") {
    await blockUnavailableWorker(run, files, adapter);
    return;
  }

  if (adapter.status === "manual") {
    await markManualWorker(run, files, adapter);
    return;
  }

  await reserveAccountBudget(run.routing?.accountId || "", run.routing?.estimatedUnits || 0);
  await appendRunEvent(run.id, {
    level: "info",
    message: `${run.routing?.estimatedUnits || 0} local budget units reserved for this run.`,
  });

  if (adapter.mode === "open-window") {
    await launchWindowWorker(run, files, adapter);
    return;
  }

  await launchCommandWorker(run, files, adapter, promptText);
}

export async function launchDashboardWorker(run) {
  const child = spawn(process.execPath, [SCRIPT_FILE, "--execute-run", run.id], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  await patchRunRecord(run.id, {
    adapter: {
      status: "launching",
      mode: "runner",
      runnerPid: child.pid,
    },
  });
  await appendRunEvent(run.id, {
    level: "info",
    message: `Worker launch adapter started in the background (pid ${child.pid}).`,
  });
}

async function killPid(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore missing processes
  }
}

export async function stopDashboardWorker(run) {
  await killPid(Number(run.adapter?.runnerPid || 0));
  await killPid(Number(run.adapter?.pid || 0));
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

if (options.executeRun) {
  await executeRun(options.executeRun);
}

if (options.stopRun) {
  const run = await resolveRun(options.stopRun);
  if (run) {
    await stopDashboardWorker({
      ...run,
      adapter: {
        ...(run.adapter || {}),
        pid: options.pid || run.adapter?.pid || 0,
      },
    });
  }
}
