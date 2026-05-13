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
    /refresh token (?:was|is|has been) revoked/i,
    /access token could not be refreshed/i,
    /(?:please )?log out and sign in/i,
    /token (?:expired|revoked|invalid)/i,
    /401 unauthori[sz]ed/i,
  ],
  claude: [
    /please run\s+`?claude\s+login/i,
    /not logged in to claude/i,
    /claude\.ai\/login/i,
    /anthropic api key/i,
    /credentials? (?:are )?invalid/i,
  ],
  codex: [
    /openai_api_key/i,
    /openai api key/i,
    /please run\s+`?codex\s+login/i,
    /chatgpt account/i,
    /refresh token .* revoked/i,
    /access token could not be refreshed/i,
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

// 권한/승인 prompt 패턴 — CLI 가 사용자 입력을 기다리는 신호.
// 매칭 시 stdin 에 자동 "y" 응답 시도, 안 되면 즉시 kill 해서 hang 회피.
const PERMISSION_PROMPT_PATTERNS = [
  /\[y\/n\]/i,
  /\(y\/n\)/i,
  /\[Y\/n\]/,
  /\[y\/N\]/,
  /\(yes\/no\)/i,
  /press enter to continue/i,
  /press any key/i,
  /do you (want to|wish to|confirm)/i,
  /are you sure/i,
  /allow this (tool|command|action)/i,
  /approve this (action|tool|command)/i,
  /\bproceed\?/i,
  /\bcontinue\?/i,
  /workspace trust/i,
  /trust this (workspace|folder|directory)/i,
  /grant permission/i,
];

function killChildTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

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

// Idle 임계값을 환경 변수로 오버라이드 가능. 기본값은 autonomous run 에
// 충분히 긴 시간으로 설정 — Claude/Codex 가 큰 컨텍스트를 추론할 때 출력
// 없이 수십 초~수 분 지연될 수 있으므로 너무 짧으면 진짜로 일하고 있는데
// 중단된다. 사용자가 자율 진행을 원하면 길게 잡고, 정말 멈춰 있을 때만
// 안전망으로 끊는다. AGENTAPP_IDLE_KILL_MS=0 으로 두면 자동 종료 비활성.
function parseIdleMs(envKey, fallbackMs) {
  const raw = process.env[envKey];
  if (raw == null || raw === "") return fallbackMs;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallbackMs;
  return Math.max(0, n);
}
const IDLE_WARN_MS = parseIdleMs("AGENTAPP_IDLE_WARN_MS", 90 * 1000);
const IDLE_KILL_MS = parseIdleMs("AGENTAPP_IDLE_KILL_MS", 30 * 60 * 1000);

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
    const raw = await readFile(path.join(WORKER_PROMPTS_DIR, `${workerId}.md`), "utf8");
    return substituteRuntimePaths(raw);
  } catch {
    return "";
  }
}

function substituteRuntimePaths(text) {
  if (!text) return text;
  const replacement = safeSpawnCwd();
  return text
    .replace(/[A-Za-z]:\\\\agentApp/g, replacement.replace(/\\/g, "\\\\"))
    .replace(/[A-Za-z]:\\agentApp/g, replacement);
}

const SHARED_SYNC_PREAMBLE = `[AgentApp 공통 관리 — 모든 에이전트 공통 숙지]

다음 항목은 모든 worker (Codex/Claude Code/Cursor/Gemini)가 공유하는 동기화 대상이다.
작업 시작 전 한 번 읽고, 의미 있는 진행이 발생하면 같은 파일을 갱신한 뒤 종료한다.

- git: 현재 branch 의 working tree. 의미 있는 변경은 작은 단위로 commit. push 는 remote 가 명확할 때만.
- \`.claude-sync/memory/project_state.md\`: 현재 상태와 다음 작업 후보. 진행 시 갱신.
- \`.claude-sync/plans/agent-orchestrator-roadmap.md\` 등 plans: 단계 완료/방향 전환 시 체크박스 갱신.
- \`tools/agent-orchestrator/handoff/NEXT_TASK.md\`: 다음 작업 1순위. 시작 시 확인.
- \`tools/agent-orchestrator/handoff/RUN_STATUS.md\`: 작업 종료 시 \`pnpm agent:report\` 로 한 줄 남김.
- \`tools/agent-orchestrator/handoff/DECISIONS_REQUIRED.md\`: 사용자 결정 필요 항목만 여기에.

자동 라우팅은 각 계정의 한도/사용량/세션 ready 상태를 보고 골고루 분배한다.
한도 초과는 worker stderr 패턴으로 자동 감지 → 해당 계정 잠금. 수동 입력 없음.

`;

async function writeLaunchPrompt(run, files) {
  const userPrompt = String(run.prompt || "").trim();
  // 사용자가 입력한 프롬프트가 있으면 그것만 그대로 전달 (chat 모드).
  // 비어 있을 때만 워커 핸드오프 템플릿을 사용 (NEXT_TASK 자동 진행 모드).
  let body;
  if (userPrompt) {
    body = `${SHARED_SYNC_PREAMBLE}\n---\n${userPrompt}`;
  } else {
    const workerPrompt = await readWorkerPrompt(run.workerId);
    const inner = workerPrompt
      ? workerPrompt
      : "Continue from tools/agent-orchestrator/handoff/NEXT_TASK.md.";
    body = `${SHARED_SYNC_PREAMBLE}\n---\n${inner}`;
  }

  await mkdir(files.runDir, { recursive: true });
  await writeFile(files.promptPath, body, "utf8");
  return body;
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

function windowsToolPathEntries() {
  if (!isWindows()) return [];
  const root = windowsSystemRoot();
  const userProfile = process.env.USERPROFILE || homedir();
  const appData = process.env.APPDATA || path.join(userProfile, "AppData", "Roaming");
  const localAppData = process.env.LOCALAPPDATA || path.join(userProfile, "AppData", "Local");
  return [
    path.join(root, "System32"),
    path.join(root, "System32", "Wbem"),
    path.join(root, "System32", "WindowsPowerShell", "v1.0"),
    root,
    "C:\\Program Files\\nodejs",
    "C:\\Program Files\\Git\\cmd",
    "C:\\Program Files\\Git\\bin",
    path.join(appData, "npm"),
    path.join(localAppData, "Programs", "cursor", "resources", "app", "bin"),
    path.join(localAppData, "Microsoft", "WindowsApps"),
  ];
}

function augmentedSpawnEnv() {
  if (!isWindows()) return { ...process.env };
  const next = { ...process.env };
  const pathKey = Object.keys(next).find((key) => key.toLowerCase() === "path") || "Path";
  for (const key of Object.keys(next)) {
    if (key.toLowerCase() === "path" && key !== pathKey) delete next[key];
  }
  const entries = [...windowsToolPathEntries(), next[pathKey] || ""]
    .flatMap((entry) => String(entry).split(";"))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set();
  next[pathKey] = entries
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(";");
  return next;
}

function firstWindowsExecutableMatch(command) {
  if (!isWindows()) return "";
  const extensions = [".cmd", ".exe", ".bat", ".ps1", ""];
  const hasExt = /\.(cmd|exe|bat|ps1)$/i.test(command);
  for (const dir of windowsToolPathEntries()) {
    if (!dir) continue;
    const exts = hasExt ? [""] : extensions;
    for (const ext of exts) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "";
}

export async function commandPathFor(command) {
  if (!command) return "";
  const probe = isWindows() ? windowsSystemCommand("where.exe") : "which";
  const fromWhere = await new Promise((resolve) => {
    let child;
    try {
      child = spawn(probe, [command], {
        cwd: safeSpawnCwd(),
        env: augmentedSpawnEnv(),
        windowsHide: true,
      });
    } catch {
      resolve("");
      return;
    }
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
  if (fromWhere && existsSync(fromWhere)) return fromWhere;
  return firstWindowsExecutableMatch(command);
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

async function resolveProjectPath(projectId) {
  if (!projectId || projectId === "current") return "";
  try {
    const { readRuntime } = await import("./dashboard-runtime.mjs");
    const runtime = await readRuntime();
    const project = (runtime.projects || []).find((item) => item.id === projectId);
    if (project && project.path && existsSync(project.path)) {
      return project.path;
    }
  } catch {
    // best-effort lookup; fall through to default workspace
  }
  return "";
}

async function resolveAdapter(run, files) {
  const sessionProfile = run.routing?.sessionProfile || `${run.workerId}-${run.routing?.accountId || "default"}`;
  const projectPath = await resolveProjectPath(run.projectId);
  // 우선순위: 선택된 프로젝트 경로 > 패키징 환경의 safeSpawnCwd > REPO_ROOT
  const workspace = projectPath || (isPackagedRuntime() ? safeSpawnCwd() : REPO_ROOT);

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
        "--skip-git-repo-check",
        "-C",
        workspace,
        "-m",
        run.routing?.model || run.modelOverride || "gpt-5.4",
        // 자율 진행 모드: 승인 프롬프트 + 샌드박스를 모두 우회. 코덱스
        // v0.128+ 에서 'exec' 가 받는 자동 승인 옵션은 이것 하나뿐
        // (이전 --ask-for-approval 은 인터랙티브 명령에만 존재).
        "--dangerously-bypass-approvals-and-sandbox",
        "-o",
        files.lastMessagePath,
        "-",
      ],
      env: {
        CODEX_HOME: sessionDir,
        AGENTAPP_SESSION_PROFILE: sessionProfile,
        AGENTAPP_ACCOUNT_ID: run.routing?.accountId || "",
        AGENTAPP_MODEL: run.routing?.model || run.modelOverride || "auto",
        AGENTAPP_WORKSPACE: workspace,
      },
      sessionDir,
      workspace,
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
        AGENTAPP_WORKSPACE: workspace,
      },
      sessionDir,
      workspace,
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
        "--dangerously-skip-permissions",
        ...(claudeModel ? ["--model", claudeModel] : []),
      ],
      env: {
        CLAUDE_CONFIG_DIR: sessionDir,
        AGENTAPP_SESSION_PROFILE: sessionProfile,
        AGENTAPP_ACCOUNT_ID: run.routing?.accountId || "",
        AGENTAPP_MODEL: claudeModel || "auto",
        AGENTAPP_WORKSPACE: workspace,
      },
      sessionDir,
      workspace,
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
        "--yolo",
        ...(geminiModel ? ["--model", geminiModel] : []),
      ],
      env: {
        GEMINI_CONFIG_DIR: sessionDir,
        AGENTAPP_SESSION_PROFILE: sessionProfile,
        AGENTAPP_ACCOUNT_ID: run.routing?.accountId || "",
        AGENTAPP_MODEL: geminiModel || "auto",
        AGENTAPP_WORKSPACE: workspace,
      },
      sessionDir,
      workspace,
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
    let permissionPromptKilled = false;
    let stdinClosed = false;
    let autoConfirmCount = 0;
    const AUTO_CONFIRM_MAX = 5;

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
            killChildTree(child.pid);
          }
        }, 5000)
      : null;

    const tryAutoConfirm = async (trimmed) => {
      // 권한 prompt 패턴: y/N, allow/deny, continue?, proceed?
      if (!PERMISSION_PROMPT_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
      // stdin 이 아직 열려있다면 자동 응답 시도 (인터랙티브 mode 가능성).
      if (!stdinClosed && child.stdin && !child.stdin.destroyed) {
        try {
          child.stdin.write("y\n", "utf8");
          autoConfirmCount += 1;
          if (options.onAutoConfirm) await options.onAutoConfirm(trimmed, autoConfirmCount);
          if (autoConfirmCount >= AUTO_CONFIRM_MAX) {
            // 너무 많이 응답 — 무한 prompt 루프 의심. kill.
            permissionPromptKilled = true;
            if (options.onPermissionPrompt) await options.onPermissionPrompt(trimmed);
            killChildTree(child.pid);
          }
          return true;
        } catch {
          // stdin write 실패 — 닫혀있을 가능성
        }
      }
      // stdin 닫혀있고 prompt 가 보임 → 영원히 멈출 거니까 즉시 kill + 사용자 안내.
      permissionPromptKilled = true;
      if (options.onPermissionPrompt) await options.onPermissionPrompt(trimmed);
      killChildTree(child.pid);
      return true;
    };

    const forwardLines = async (lines, level) => {
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lastActivityAt = Date.now();
        combined += `${trimmed}\n`;
        if (level === "stdout") stdoutOnly += `${trimmed}\n`;
        await appendLog(options.logPath, `[${level}] ${trimmed}`);
        if (options.onLine) await options.onLine(trimmed, level, child.pid);
        if (options.detectPermissionPrompt !== false && !permissionPromptKilled) {
          await tryAutoConfirm(trimmed);
        }
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
        permissionPromptKilled,
      });
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText, "utf8");
      if (options.keepStdinOpen) {
        // stdin keep-open: 권한 prompt 가 떴을 때 auto-yes 를 보낼 수 있도록.
        // 정상 종료는 worker 가 출력 끝낸 후 자기 자신 exit 으로.
      } else {
        child.stdin.end();
        stdinClosed = true;
      }
    } else {
      stdinClosed = true;
    }
    if (child.stdin) {
      child.stdin.on("close", () => { stdinClosed = true; });
      child.stdin.on("error", () => { stdinClosed = true; });
    }

    if (options.onSpawn) options.onSpawn(child.pid);
  });
}

// detectInterruption replaces the legacy loginRequired check.

function isPackagedRuntime() {
  if (process.env.AGENTAPP_SKIP_PREFLIGHT === "1") return true;
  if (REPO_ROOT.includes(`${path.sep}app.asar${path.sep}`) || REPO_ROOT.endsWith(`${path.sep}app.asar`)) {
    return true;
  }
  if (!existsSync(path.join(REPO_ROOT, "package.json"))) return true;
  return false;
}

async function runPreflight(run, files) {
  if (isPackagedRuntime()) {
    await patchRunRecord(run.id, {
      validation: {
        status: "skipped",
        command: "pnpm validate",
        summary: "패키징 환경에서는 사전 검증을 건너뜁니다.",
      },
    });
    await appendRunEvent(run.id, {
      level: "info",
      message: "패키징된 실행 환경에서는 pnpm validate 사전 검증을 건너뜁니다.",
    });
    return true;
  }

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
        summary: `사전 검증(pnpm validate) 실패. validate.log 확인 필요. exit=${result.code ?? "n/a"}`,
        logPath: relativePath(files.validationLogPath),
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
  const adapterCwd = adapter.workspace && existsSync(adapter.workspace) ? adapter.workspace : safeSpawnCwd();
  await appendRunEvent(run.id, {
    level: "info",
    message: `작업 디렉터리: ${adapterCwd}`,
  });
  const { getRuntimeSettings } = await import("./dashboard-runtime.mjs");
  const settings = await getRuntimeSettings();
  const idleWarn = Number.isFinite(settings.idleWarnMs) ? settings.idleWarnMs : IDLE_WARN_MS;
  const idleKill = Number.isFinite(settings.idleKillMs) ? settings.idleKillMs : IDLE_KILL_MS;
  if (idleKill > 0) {
    await appendRunEvent(run.id, {
      level: "info",
      message: `자동 종료 임계값: ${Math.round(idleKill / 1000 / 60)}분 무응답`,
    });
  } else {
    await appendRunEvent(run.id, {
      level: "info",
      message: "자동 종료 비활성 — 사용자가 멈출 때까지 실행 유지",
    });
  }
  const result = await streamProcess(adapter.command, adapter.args, {
    cwd: adapterCwd,
    env: { ...augmentedSpawnEnv(), ...(adapter.env || {}) },
    logPath: files.launchLogPath,
    stdinText: promptText,
    idleWarnMs: idleWarn,
    idleKillMs: idleKill,
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
      try {
        const { parseQuotaReset, applyQuotaLockout, providerForWorker } = await import("./dashboard-runtime.mjs");
        const providerHint = run.routing?.provider || providerForWorker(run.workerId) || "";
        const resetAt = parseQuotaReset(line, providerHint);
        if (resetAt && run.routing?.accountId) {
          await applyQuotaLockout(
            run.routing.accountId,
            resetAt,
            line.length > 200 ? `${line.slice(0, 200)}...` : line,
          );
          await appendRunEvent(run.id, {
            level: "warn",
            message: `사용량 한도 감지 — 이 계정은 ${new Date(resetAt).toLocaleString("ko-KR")} 까지 자동 잠금됩니다.`,
          });
        }
      } catch {
        // best-effort quota detection; do not break the run on parse errors
      }
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
    // keepStdinOpen 은 비대화형 CLI (claude --print, codex exec, gemini --prompt -) 의
    // 정상 종료 (stdin EOF = prompt 끝 신호) 를 방해하므로 사용 안 함.
    // 대신 권한 prompt 패턴이 보이면 stdin 이 이미 닫혔으므로 즉시 fail-fast.
    onAutoConfirm: async (line, count) => {
      await appendRunEvent(run.id, {
        level: "info",
        message: `⚡ 권한 prompt 자동 응답 (#${count}): ${line.length > 160 ? `${line.slice(0, 160)}...` : line}`,
      });
    },
    onPermissionPrompt: async (line) => {
      await appendRunEvent(run.id, {
        level: "error",
        message: `🛑 권한 prompt 자동 해결 실패 — 즉시 중지: "${line.length > 200 ? `${line.slice(0, 200)}...` : line}". CLI 옵션이 도구 prompt 를 막지 못한 경우입니다.`,
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

  if (result.permissionPromptKilled) {
    await finishRunRecord(
      run.id,
      {
        status: "needs_user",
        adapter: {
          status: "permission-prompt",
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
        handoffReason: "hold_for_user",
      },
    );
    return;
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
    // 자동 이어 진행 (autoChain) — settings.autoChainEnabled 가 true 일 때만 발동.
    try {
      const responseText = String(lastMessage || "").trim();
      const stopSignal = /^CHAIN_DONE\s*$/im.test(responseText);
      if (stopSignal) {
        await appendRunEvent(run.id, {
          level: "info",
          message: "▣ autoChain 종료 — worker 가 CHAIN_DONE 신호를 보냈습니다.",
        });
      } else {
        const { tryAutoChain } = await import("./dashboard-runtime.mjs");
        const chained = await tryAutoChain(run);
        if (chained && chained.skipped) {
          await appendRunEvent(run.id, {
            level: "info",
            message: `▣ autoChain 중단 — ${chained.reason || "한도 도달"}.`,
          });
        } else if (chained) {
          const depthSuffix = chained.chainDepth ? ` (depth ${chained.chainDepth})` : "";
          await appendRunEvent(run.id, {
            level: "info",
            message: `▶ autoChain: ${chained.workerId} 로 자동 이어 시작했습니다 (run ${chained.id})${depthSuffix}.`,
          });
          const { launchDashboardWorker } = await import("./worker-launch-adapter.mjs");
          await launchDashboardWorker(chained);
        } else {
          await appendRunEvent(run.id, {
            level: "info",
            message: "▣ autoChain 비활성 또는 다음 작업 없음 — 사이클 종료.",
          });
        }
      }
    } catch (error) {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `autoChain 시도 중 오류: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return;
  }

  const detection = detectInterruption(run.workerId, result.combinedOutput);
  if (detection.kind === "needs-login") {
    await updateAccountSession(run.routing?.accountId || "", "needs-login");
    // OAuth 토큰이 revoke 됐을 가능성이 높으므로 actualAuthEmail 도 초기화.
    // 다음 로그인에서 사용자가 정확한 계정으로 OAuth 를 다시 끝내야 한다.
    try {
      const { clearAccountAuthIdentity } = await import("./dashboard-runtime.mjs");
      if (run.routing?.accountId) await clearAccountAuthIdentity(run.routing.accountId);
    } catch {
      // best-effort
    }
    await appendRunEvent(run.id, {
      level: "error",
      message: `${detection.reason} — 사이드바에서 이 계정의 '로그인' 을 다시 눌러 OAuth 를 새로 완료하세요.`,
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
          summary: detection.reason,
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
    // 토큰 revoke 도 한도 도달과 동일하게 처리 — 자동 라우팅으로 시작한
    // run 은 다른 provider 의 ready 계정까지 후보로 열어 둔다.
    try {
      const { tryQuotaRetry } = await import("./dashboard-runtime.mjs");
      const retried = await tryQuotaRetry(run);
      if (retried) {
        await appendRunEvent(run.id, {
          level: "info",
          message: `▶ 인증 실패 — ${retried.routing?.accountId || "다른 계정"} 으로 자동 재시도 (attempt ${retried.retryCount}).`,
        });
        await launchDashboardWorker(retried);
      }
    } catch (error) {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `재시도 시도 중 오류: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
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
    // 토큰 소진 시 자동 라우팅 run 은 다른 provider 의 ready 계정까지 재시도.
    try {
      const { tryQuotaRetry } = await import("./dashboard-runtime.mjs");
      const retried = await tryQuotaRetry(run);
      if (retried) {
        await appendRunEvent(run.id, {
          level: "info",
          message: `▶ 한도 도달 — ${retried.routing?.accountId || "다른 계정"} 으로 자동 재시도 시작 (attempt ${retried.retryCount}).`,
        });
        const { launchDashboardWorker } = await import("./worker-launch-adapter.mjs");
        await launchDashboardWorker(retried);
      } else {
        await appendRunEvent(run.id, {
          level: "error",
          message: "한도 도달 — 자동 재시도 가능한 ready 계정이 없습니다. 다른 계정 인증/추가 또는 한도 reset 대기 후 다시 시작하세요.",
        });
      }
    } catch (error) {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `quota retry 시도 중 오류: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
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

  const adapterCwd = adapter.workspace && existsSync(adapter.workspace) ? adapter.workspace : safeSpawnCwd();
  const result = await streamProcess(adapter.command, adapter.args, {
    cwd: adapterCwd,
    env: { ...augmentedSpawnEnv(), ...(adapter.env || {}) },
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
        summary: adapter.summary || "",
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

  // 로컬 예산 차감은 실제 provider 한도와 동기화되지 않아 사용자 혼동만 키워서
  // 비활성. 실제 한도는 provider 가 보낸 quota_limited 메시지로만 판단한다.

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
  // inlineRunner=true 이면 runnerPid 는 우리 Electron/Node 메인 프로세스 자체다.
  // 그걸 죽이면 dashboard 가 같이 죽으므로 절대 kill 하지 않는다. worker 자식 pid 만 종료.
  if (!run.adapter?.inlineRunner) {
    const runnerPid = Number(run.adapter?.runnerPid || 0);
    if (runnerPid && runnerPid !== process.pid) {
      await killPid(runnerPid);
    }
  }
  const workerPid = Number(run.adapter?.pid || 0);
  if (workerPid && workerPid !== process.pid) {
    await killPid(workerPid);
  }
  // 인라인 실행 중인 streamProcess 가 worker close 이벤트를 받고 promise 가 resolve 되면
  // executeRun 의 후속 로직이 finishRunRecord 로 마감한다.
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
