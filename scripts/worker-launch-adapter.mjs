#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile, readdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

function safeSpawnCwd() {
  if (REPO_ROOT.includes(`${path.sep}app.asar${path.sep}`) || REPO_ROOT.endsWith(`${path.sep}app.asar`)) {
    return tmpdir();
  }
  if (!existsSync(REPO_ROOT)) return tmpdir();
  return REPO_ROOT;
}

const WORKER_PROMPTS_DIR = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "worker-prompts");
const RUNS_DIR = path.join(DATA_DIR, "worker-launches");
const LOGIN_PATTERNS_BY_PROVIDER = {
  default: [
    /\bnot logged in\b/i,
    /\bplease log ?in\b/i,
    /\blogin required\b/i,
    /\bsign in\b/i,
    /\bsession expired\b/i,
    /\breauth(?:enticate)?\b/i,
    /\bauthentication (?:failed|required|error)\b/i,
    /\bunauthori[sz]ed\b/i,
    /\bmissing credential/i,
  ],
  claude: [
    /please run\s+`?claude\s+login/i,
    /not logged in to claude/i,
    /claude\.ai\/login/i,
    /anthropic api key/i,
  ],
  codex: [
    /openai_api_key/i,
    /openai api key/i,
    /please run\s+`?codex\s+login/i,
    /chatgpt account/i,
  ],
  gemini: [
    /please run\s+`?gemini\s+auth/i,
    /google_application_credentials/i,
    /google cloud project/i,
    /not authori[sz]ed/i,
  ],
  cursor: [
    /cursor\.com\/(?:login|signin)/i,
    /cursor pro/i,
  ],
};

const QUOTA_PATTERNS = [
  /rate ?limit(?:ed)?/i,
  /quota (?:exceeded|reached)/i,
  /usage (?:limit|exceeded)/i,
  /you have reached your/i,
  /too many requests/i,
  /429/,
  /weekly limit/i,
  /monthly limit/i,
];

const IDLE_WARN_MS = 30000;
const IDLE_KILL_MS = 120000;

function providerKeyFor(workerId) {
  const id = String(workerId || "").toLowerCase();
  if (id.includes("claude")) return "claude";
  if (id.includes("codex")) return "codex";
  if (id.includes("gemini")) return "gemini";
  if (id.includes("cursor")) return "cursor";
  return "";
}

function detectInterruption(workerId, output) {
  if (!output) return { kind: "", reason: "" };
  const provider = providerKeyFor(workerId);
  const loginPatterns = [
    ...LOGIN_PATTERNS_BY_PROVIDER.default,
    ...(LOGIN_PATTERNS_BY_PROVIDER[provider] || []),
  ];
  for (const pattern of loginPatterns) {
    const match = output.match(pattern);
    if (match) {
      return { kind: "needs-login", reason: `${provider || "도구"} 가 로그인이 필요하다고 보고했습니다: "${match[0]}"` };
    }
  }
  for (const pattern of QUOTA_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      return { kind: "quota", reason: `${provider || "도구"} 가 사용량 한도를 보고했습니다: "${match[0]}"` };
    }
  }
  return { kind: "", reason: "" };
}

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

function cappedRunEvents(events, nextEvent) {
  return [...(events || []), nextEvent].slice(-120);
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

function isWindows() {
  return process.platform === "win32";
}

function windowsSystemRoot() {
  return process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
}

function windowsSystemCommand(commandName) {
  return path.join(windowsSystemRoot(), "System32", commandName);
}

function windowsShell() {
  return process.env.ComSpec || process.env.COMSPEC || windowsSystemCommand("cmd.exe");
}

function needsWindowsShell(command) {
  return isWindows() && /\.(cmd|bat)$/i.test(command);
}

function spawnInvocation(command, args, shellOverride) {
  if (shellOverride !== undefined) return { command, args, shell: shellOverride };
  if (!needsWindowsShell(command)) return { command, args, shell: false };
  return {
    command: windowsShell(),
    args: ["/d", "/s", "/c", "call", command, ...args],
    shell: false,
  };
}

const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const LOGIN_URL_CAPTURE_MS = 5000;

function executableFromPathProbe(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!isWindows()) return lines[0] || "";

  const direct = lines.find((line) => /\.(exe|cmd|bat)$/i.test(line));
  if (direct) return direct;
  for (const line of lines) {
    for (const extension of [".cmd", ".exe", ".bat"]) {
      const candidate = `${line}${extension}`;
      if (existsSync(candidate)) return candidate;
    }
  }
  return lines[0] || "";
}

function sanitizeUrl(rawUrl) {
  return String(rawUrl || "").replace(/[)\].,;]+$/g, "");
}

function uniqueUrls(text) {
  return Array.from(new Set((String(text || "").match(URL_PATTERN) || []).map(sanitizeUrl).filter(Boolean)));
}

function openUrl(url) {
  if (!url) return;
  const target = sanitizeUrl(url);
  let command;
  let args;
  if (isWindows()) {
    command = windowsSystemCommand("rundll32.exe");
    args = ["url.dll,FileProtocolHandler", target];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [target];
  } else {
    command = "xdg-open";
    args = [target];
  }
  const child = spawn(command, args, {
    cwd: safeSpawnCwd(),
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
}

async function commandPathFor(command) {
  const probe = isWindows() ? windowsSystemCommand("where.exe") : "which";
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
      resolve(executableFromPathProbe(stdout));
    });
  });
}

export function sharedSessionProfilesRoot() {
  if (process.env.AGENTAPP_SESSION_PROFILES_DIR) {
    return path.resolve(process.env.AGENTAPP_SESSION_PROFILES_DIR);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(homedir(), "AppData", "Roaming");
    return path.join(appData, "AgentApp", "session-profiles");
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "AgentApp", "session-profiles");
  }
  return path.join(homedir(), ".local", "share", "AgentApp", "session-profiles");
}

const LEGACY_SESSION_DIR = path.join(REPO_ROOT, "data", "session-profiles");
let legacyMigrationDone = false;

async function migrateLegacySessionProfiles() {
  if (legacyMigrationDone) return;
  legacyMigrationDone = true;
  if (!existsSync(LEGACY_SESSION_DIR)) return;
  const sharedRoot = sharedSessionProfilesRoot();
  if (path.resolve(LEGACY_SESSION_DIR) === path.resolve(sharedRoot)) return;
  try {
    const providers = await readdir(LEGACY_SESSION_DIR);
    for (const provider of providers) {
      const legacyProvider = path.join(LEGACY_SESSION_DIR, provider);
      const sharedProvider = path.join(sharedRoot, provider);
      const profiles = await readdir(legacyProvider).catch(() => []);
      for (const profile of profiles) {
        const src = path.join(legacyProvider, profile);
        const dst = path.join(sharedProvider, profile);
        if (existsSync(dst)) continue;
        await mkdir(path.dirname(dst), { recursive: true });
        await cp(src, dst, { recursive: true, force: false, errorOnExist: false });
      }
    }
  } catch {
    // best-effort; legacy migration failure is non-fatal
  }
}

function buildSessionProfileDir(provider, sessionProfile) {
  // fire and forget; first call ensures legacy data is copied to the shared root
  void migrateLegacySessionProfiles();
  return path.join(sharedSessionProfilesRoot(), sanitizeSegment(provider), sanitizeSegment(sessionProfile));
}

const CLAUDE_MODEL_ALIASES = {
  auto: "",
  best_available: "opus",
  opus: "opus",
  sonnet: "sonnet",
  haiku: "haiku",
};

function mapClaudeModel(modelInput) {
  if (!modelInput) return "";
  const key = String(modelInput).toLowerCase();
  if (key in CLAUDE_MODEL_ALIASES) return CLAUDE_MODEL_ALIASES[key];
  return key.startsWith("claude-") || key.includes("opus") || key.includes("sonnet") || key.includes("haiku") ? key : "";
}

function mapGeminiModel(modelInput) {
  if (!modelInput) return "";
  const key = String(modelInput).toLowerCase();
  if (key === "auto") return "";
  if (key === "best_available") return "gemini-2.5-pro";
  if (key.startsWith("gemini-")) return key;
  return "";
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
        summary: "이 PC에서 Codex CLI 를 찾지 못했습니다.",
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
      summary: "Codex exec 어댑터 준비 완료",
    };
  }

  if (run.workerId === "cursor") {
    const command = process.env.AGENTAPP_CURSOR_COMMAND || "cursor";
    const found = await commandPathFor(command);
    if (!found && !process.env.AGENTAPP_CURSOR_COMMAND) {
      return {
        status: "blocked",
        mode: "open-window",
        summary: "이 PC에서 Cursor CLI 를 찾지 못했습니다.",
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
      summary: "Cursor 창 어댑터 준비 완료",
    };
  }

  if (run.workerId === "claude-code") {
    const command = process.env.AGENTAPP_CLAUDE_COMMAND || (await commandPathFor("claude"));
    if (!command) {
      return {
        status: "blocked",
        mode: "command",
        summary: "이 PC에서 Claude Code CLI 를 찾지 못했습니다.",
      };
    }

    const sessionDir = buildSessionProfileDir("claude-code", sessionProfile);
    await mkdir(sessionDir, { recursive: true });
    const claudeModel = mapClaudeModel(run.routing?.model || run.modelOverride);
    return {
      status: "ready",
      mode: "command",
      command,
      args: [
        "--print",
        "--permission-mode",
        "acceptEdits",
        ...(claudeModel ? ["--model", claudeModel] : []),
      ],
      env: {
        CLAUDE_CONFIG_DIR: sessionDir,
        AGENTAPP_SESSION_PROFILE: sessionProfile,
        AGENTAPP_ACCOUNT_ID: run.routing?.accountId || "",
        AGENTAPP_MODEL: claudeModel || "auto",
      },
      sessionDir,
      summary: "Claude Code --print 어댑터 준비 완료",
      writeLastMessageFromStdout: true,
    };
  }

  if (run.workerId === "gemini-cli") {
    const command = process.env.AGENTAPP_GEMINI_COMMAND || (await commandPathFor("gemini"));
    if (!command) {
      return {
        status: "blocked",
        mode: "command",
        summary: "이 PC에서 Gemini CLI 를 찾지 못했습니다.",
      };
    }

    const sessionDir = buildSessionProfileDir("gemini-cli", sessionProfile);
    await mkdir(sessionDir, { recursive: true });
    const geminiModel = mapGeminiModel(run.routing?.model || run.modelOverride);
    return {
      status: "ready",
      mode: "command",
      command,
      args: [
        "--prompt",
        "-",
        ...(geminiModel ? ["--model", geminiModel] : []),
      ],
      env: {
        GEMINI_CONFIG_DIR: sessionDir,
        AGENTAPP_SESSION_PROFILE: sessionProfile,
        AGENTAPP_ACCOUNT_ID: run.routing?.accountId || "",
        AGENTAPP_MODEL: geminiModel || "auto",
      },
      sessionDir,
      summary: "Gemini CLI -p 어댑터 준비 완료",
      writeLastMessageFromStdout: true,
    };
  }

  return {
    status: "blocked",
    mode: "manual",
    summary: `${run.workerId} 용 실행 어댑터가 아직 정의되지 않았습니다.`,
  };
}

export { resolveAdapter as resolveLaunchAdapter };

export async function resolveLoginAdapter(provider, sessionProfile) {
  const id = String(provider || "").toLowerCase();
  if (id === "codex") {
    const command = process.env.AGENTAPP_CODEX_COMMAND || (await commandPathFor("codex"));
    if (!command) return { status: "blocked", reason: "codex CLI 가 PATH 에서 발견되지 않습니다." };
    const sessionDir = buildSessionProfileDir("codex", sessionProfile);
    await mkdir(sessionDir, { recursive: true });
    return { status: "ready", command, args: ["login", "--device-auth"], env: { CODEX_HOME: sessionDir }, sessionDir, sessionProfile, interactive: true };
  }
  if (id === "claude" || id === "claude-code") {
    const command = process.env.AGENTAPP_CLAUDE_COMMAND || (await commandPathFor("claude"));
    if (!command) return { status: "blocked", reason: "claude CLI 가 PATH 에서 발견되지 않습니다." };
    const sessionDir = buildSessionProfileDir("claude-code", sessionProfile);
    await mkdir(sessionDir, { recursive: true });
    return { status: "ready", command, args: ["auth", "login"], env: { CLAUDE_CONFIG_DIR: sessionDir }, sessionDir, sessionProfile, interactive: true };
  }
  if (id === "gemini" || id === "gemini-cli") {
    const command = process.env.AGENTAPP_GEMINI_COMMAND || (await commandPathFor("gemini"));
    if (!command) return { status: "blocked", reason: "gemini CLI 가 PATH 에서 발견되지 않습니다." };
    const sessionDir = buildSessionProfileDir("gemini-cli", sessionProfile);
    await mkdir(sessionDir, { recursive: true });
    return { status: "ready", command, args: [], env: { GEMINI_CONFIG_DIR: sessionDir }, sessionDir, sessionProfile, interactive: true };
  }
  if (id === "cursor") {
    const command = process.env.AGENTAPP_CURSOR_COMMAND || "cursor";
    const sessionDir = buildSessionProfileDir("cursor", sessionProfile);
    await mkdir(sessionDir, { recursive: true });
    return { status: "ready", command, args: ["--user-data-dir", sessionDir], env: {}, sessionDir, sessionProfile, interactive: false };
  }
  return { status: "blocked", reason: `${id} 는 자동 로그인을 지원하지 않습니다.` };
}

export async function launchLoginProcess(adapter, options = {}) {
  const env = { ...process.env, ...(adapter.env || {}) };
  const opened = new Set();
  const isolatedPartitions = new Set();
  let child;
  try {
    const invocation = spawnInvocation(adapter.command, adapter.args);
    child = spawn(invocation.command, invocation.args, {
      cwd: safeSpawnCwd(),
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: invocation.shell,
      windowsHide: true,
    });
  } catch (error) {
    return {
      pid: 0,
      openedUrls: [],
      browserOpened: false,
      isolated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let errorMessage = "";
  const partitionKey = options.partitionKey || adapter.sessionProfile || "";
  const useIsolated = Boolean(partitionKey) && Boolean(process.versions.electron);
  const openInIsolated = async (url) => {
    try {
      const { openIsolatedLoginWindow } = await import("./electron-login-window.mjs");
      const result = await openIsolatedLoginWindow({
        partitionKey,
        url,
        title: options.windowTitle || "AgentApp 로그인",
        autofill: options.autofill,
      });
      if (result && result.partition) isolatedPartitions.add(result.partition);
      if (!result || result.ok !== true) {
        openUrl(url);
      }
    } catch {
      openUrl(url);
    }
  };
  const inspect = (chunk) => {
    for (const url of uniqueUrls(chunk.toString("utf8"))) {
      if (opened.has(url)) continue;
      opened.add(url);
      if (useIsolated) {
        void openInIsolated(url);
      } else {
        openUrl(url);
      }
    }
  };
  child.stdout.on("data", inspect);
  child.stderr.on("data", inspect);
  child.unref();

  await new Promise((resolve) => {
    let settled = false;
    let timer;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(done, LOGIN_URL_CAPTURE_MS);
    child.on("error", (error) => {
      errorMessage = error instanceof Error ? error.message : String(error);
      done();
    });
    child.on("close", done);
  });

  child.stdout.off("data", inspect);
  child.stderr.off("data", inspect);
  child.stdout.unref?.();
  child.stderr.unref?.();
  return {
    pid: child.pid || 0,
    openedUrls: Array.from(opened),
    browserOpened: opened.size > 0,
    isolated: useIsolated && isolatedPartitions.size > 0,
    partitions: Array.from(isolatedPartitions),
    error: errorMessage,
  };
}

function lineChunks(buffer, chunk) {
  const text = `${buffer}${chunk.toString("utf8")}`;
  const parts = text.split(/\r?\n/);
  return { lines: parts.slice(0, -1), rest: parts.at(-1) || "" };
}

async function streamProcess(command, args, options = {}) {
  await mkdir(path.dirname(options.logPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const invocation = spawnInvocation(command, args, options.shell);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd || REPO_ROOT,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: options.windowsHide ?? true,
      shell: invocation.shell,
      detached: options.detached ?? false,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let combined = "";
    let stdoutOnly = "";
    let lastActivityAt = Date.now();
    let warned = false;
    let idleKilled = false;

    const idleTimer = options.idleWarnMs || options.idleKillMs
      ? setInterval(async () => {
          const idleMs = Date.now() - lastActivityAt;
          if (!warned && options.idleWarnMs && idleMs >= options.idleWarnMs) {
            warned = true;
            if (options.onIdleWarn) await options.onIdleWarn(idleMs);
          }
          if (options.idleKillMs && idleMs >= options.idleKillMs) {
            idleKilled = true;
            clearInterval(idleTimer);
            if (options.onIdleKill) await options.onIdleKill(idleMs);
            if (process.platform === "win32") {
              spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
            } else {
              try { process.kill(child.pid, "SIGKILL"); } catch { /* already gone */ }
            }
          }
        }, 5000)
      : null;

    const forwardLines = async (lines, level) => {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lastActivityAt = Date.now();
        combined += `${trimmed}\n`;
        if (level === "stdout") stdoutOnly += `${trimmed}\n`;
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

    child.on("error", (error) => {
      if (idleTimer) clearInterval(idleTimer);
      reject(error);
    });
    child.on("close", async (code, signal) => {
      if (idleTimer) clearInterval(idleTimer);
      if (stdoutBuffer.trim()) await forwardLines([stdoutBuffer.trim()], "stdout");
      if (stderrBuffer.trim()) await forwardLines([stderrBuffer.trim()], "stderr");
      resolve({
        code: Number(code ?? 1),
        signal: signal || "",
        pid: child.pid,
        combinedOutput: combined.trim(),
        stdoutOnly: stdoutOnly.trim(),
        idleKilled,
      });
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText, "utf8");
      child.stdin.end();
    }

    if (options.onSpawn) options.onSpawn(child.pid);
  });
}

// detectInterruption replaces the legacy loginRequired check.

async function runPreflight(run, files) {
  await patchRunRecord(run.id, {
    validation: {
      status: "running",
      command: "pnpm validate",
      logPath: relativePath(files.validationLogPath),
      summary: "실행 전 pnpm validate 검사 중",
    },
  });
  await appendRunEvent(run.id, { level: "info", message: "사전 검증을 시작했습니다." });

  const result = await streamProcess(
    process.platform === "win32" ? "cmd.exe" : "sh",
    process.platform === "win32" ? ["/d", "/s", "/c", "pnpm validate"] : ["-lc", "pnpm validate"],
    {
      cwd: safeSpawnCwd(),
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
        summary: "사전 검증 통과",
      },
    });
    await appendRunEvent(run.id, { level: "info", message: "사전 검증을 통과했습니다." });
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
        summary: "사전 검증 실패",
      },
      adapter: {
        status: "blocked",
        mode: "preflight",
      },
      events: [
        ...(run.events || []),
        { at: nowIso(), level: "error", message: "사전 검증에 실패했습니다. worker 실행 전에 validate.log 를 확인하세요." },
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
    message: `${run.workerId} 작업을 세션 프로필 ${run.routing?.sessionProfile || "default"} 로 시작합니다.`,
  });

  const result = await streamProcess(adapter.command, adapter.args, {
    cwd: safeSpawnCwd(),
    env: adapter.env,
    logPath: files.launchLogPath,
    stdinText: promptText,
    idleWarnMs: IDLE_WARN_MS,
    idleKillMs: IDLE_KILL_MS,
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
    onIdleWarn: async (idleMs) => {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `${run.workerId} 가 ${Math.round(idleMs / 1000)} 초간 응답이 없습니다. 인증/네트워크 상태를 확인하거나, 응답이 길어지는 작업이라면 잠시 더 기다려 주세요.`,
      });
    },
    onIdleKill: async (idleMs) => {
      await appendRunEvent(run.id, {
        level: "error",
        message: `${run.workerId} 가 ${Math.round(idleMs / 1000)} 초간 출력이 없어 자동 중지합니다. 인증 또는 CLI 설치 상태를 확인한 뒤 다시 시작하세요.`,
      });
    },
  });

  if (adapter.writeLastMessageFromStdout && result.stdoutOnly) {
    try {
      await writeFile(files.lastMessagePath, `${result.stdoutOnly}\n`, "utf8");
    } catch {
      // last message capture is best-effort
    }
  }

  let lastMessage = "";
  try {
    lastMessage = (await readFile(files.lastMessagePath, "utf8")).trim();
  } catch {
    lastMessage = "";
  }

  if (result.idleKilled) {
    if (run.routing?.accountId) {
      await updateAccountSession(run.routing.accountId, "needs-login");
    }
    await finishRunRecord(
      run.id,
      {
        status: "needs_user",
        adapter: {
          status: "idle-timeout",
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
        handoffReason: "session_timeout",
      },
    );
    return;
  }

  if (result.code === 0) {
    if (lastMessage) {
      await appendRunEvent(run.id, {
        level: "info",
        message: `작업 최종 메시지를 ${relativePath(files.lastMessagePath)} 에 저장했습니다.`,
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

  const detection = detectInterruption(run.workerId, result.combinedOutput);
  if (detection.kind === "needs-login") {
    await updateAccountSession(run.routing?.accountId || "", "needs-login");
    await appendRunEvent(run.id, { level: "warn", message: detection.reason });
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
  if (detection.kind === "quota") {
    await appendRunEvent(run.id, { level: "warn", message: detection.reason });
    await finishRunRecord(
      run.id,
      {
        status: "quota_limited",
        adapter: {
          status: "quota-exhausted",
          mode: adapter.mode,
          pid: result.pid,
          exitCode: result.code,
          logPath: relativePath(files.launchLogPath),
          promptPath: relativePath(files.promptPath),
          sessionDir: relativePath(adapter.sessionDir),
        },
      },
      {
        handoffStatus: "quota_limited",
        handoffReason: "quota_exhausted",
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
    cwd: safeSpawnCwd(),
    env: adapter.env,
    logPath: files.launchLogPath,
    windowsHide: true,
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
      message: `${run.workerId} 창을 세션 프로필 디렉터리 ${relativePath(adapter.sessionDir)} 로 열었습니다.`,
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
    message: `실행 프롬프트를 ${relativePath(files.promptPath)} 에 기록했습니다.`,
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
    message: `이번 실행을 위해 로컬 예산 ${run.routing?.estimatedUnits || 0} 단위를 예약했습니다.`,
  });

  if (adapter.mode === "open-window") {
    await launchWindowWorker(run, files, adapter);
    return;
  }

  await launchCommandWorker(run, files, adapter, promptText);
}

export async function launchDashboardWorker(run) {
  if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
    await patchRunRecord(run.id, {
      adapter: {
        status: "launching",
        mode: "runner",
        runnerPid: process.pid,
        inlineRunner: true,
      },
    });
    await appendRunEvent(run.id, {
      level: "info",
      message: `작업 실행 어댑터를 앱 메인 프로세스에서 백그라운드로 시작했습니다 (pid ${process.pid}).`,
    });
    setImmediate(() => {
      executeRun(run.id).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        await finishRunRecord(
          run.id,
          {
            status: "blocked",
            adapter: {
              status: "blocked",
              mode: "runner",
              runnerPid: process.pid,
              inlineRunner: true,
            },
            events: cappedRunEvents(run.events || [], {
              at: nowIso(),
              level: "error",
              message: `작업 실행 어댑터 시작 실패: ${message}`,
            }),
          },
          {
            handoffStatus: "blocked",
            handoffReason: "runner_failed",
          },
        );
      });
    });
    return;
  }

  if (!existsSync(process.execPath)) {
    await finishRunRecord(
      run.id,
      {
        status: "blocked",
        adapter: {
          status: "blocked",
          mode: "runner",
        },
        events: cappedRunEvents(run.events || [], {
          at: nowIso(),
          level: "error",
          message: `작업 실행 어댑터를 시작할 실행 파일을 찾지 못했습니다: ${process.execPath}`,
        }),
      },
      {
        handoffStatus: "blocked",
        handoffReason: "runner_executable_missing",
      },
    );
    return;
  }

  const child = spawn(process.execPath, [SCRIPT_FILE, "--execute-run", run.id], {
    cwd: safeSpawnCwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.on("error", async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await finishRunRecord(
      run.id,
      {
        status: "blocked",
        adapter: {
          status: "blocked",
          mode: "runner",
        },
        events: cappedRunEvents(run.events || [], {
          at: nowIso(),
          level: "error",
          message: `작업 실행 어댑터 시작 실패: ${message}`,
        }),
      },
      {
        handoffStatus: "blocked",
        handoffReason: "runner_spawn_failed",
      },
    );
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
    message: `작업 실행 어댑터를 백그라운드에서 시작했습니다 (pid ${child.pid}).`,
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
