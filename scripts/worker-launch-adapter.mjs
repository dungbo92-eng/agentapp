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
  buildInterruptedWorktreePatch,
  finishRunRecord,
  getRuntimeSettings,
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

// 조직 정책 거절 — Anthropic 엔터프라이즈 등 조직 정책으로 특정 도메인
// (예: "C# 외 거절") 작업이 거절될 때 출력되는 안내문 패턴.
//
// 주의: 정상 응답에 자주 등장하는 단어(T-SQL, 스키마, 에러 분석 등) 를 단독
// 으로 매칭하면 false positive 가 발생한다. 예: 사용자가 "[오류분석] T-SQL
// 스키마 검토" 라고 요청하고 worker 가 정상적으로 "T-SQL 스키마를 검토하
// 겠습니다" 라고 답해도 policy_blocked 로 잘못 분류된다. 따라서 거절문
// 컨텍스트 (만/외/이외/허용/거절/한해) 와 함께 매칭해야 한다.
const ORG_POLICY_PATTERNS = [
  /본 조직은 .{0,80}(?:Claude|claude|AI|모델)/i,
  // "C# 코드만", "C# 개발 외" 형태 — 이미 컨텍스트가 있음
  /C#\s*(?:코드|개발)\s*(?:만|외)/,
  // 정책문 형태: "T-SQL/스키마/에러 분석 외에는 거절", "T-SQL만 가능"
  /(?:T-?SQL|스키마|에러\s*분석)\s*(?:만|외|이외|이외에는|이외에|에\s*한해|에\s*한정)/,
  // "외에는 T-SQL", "이외에 스키마" 같은 어순 역전
  /(?:외에는|이외에는|이외에|에\s*한해서는)\s*(?:T-?SQL|스키마|에러\s*분석)/,
  /일반 도구를 사용해주세요/,
  /사용 정책이 확장되면/,
  /(?:^|\s)조직 정책(?:에|으로|상)/,
  /enterprise\s+(?:policy|usage policy)/i,
  /not\s+permitted\s+by\s+(?:your\s+)?organization/i,
  // 실제 회사 거절문에서 자주 등장하는 표현. "도입 초기 단계" + Claude/AI 컨텍스트.
  /도입\s*초기\s*단계/,
  // "순수 개발 작업에만 응답 가능", "개발 작업에 한해 답변" 같은 화이트리스트 안내.
  /순수\s*(?:개발|코딩)\s*작업/,
  /(?:개발\s*작업|코딩\s*작업)\s*에(?:만|\s*한해)/,
  // "추후 정책이 확장되면 안내" — 거절문 마무리 상투 문구.
  /추후\s*(?:사용\s*)?정책이?\s*확장되면/,
];

// Worker 종료 후 combinedOutput 을 한 번 더 훑어 quota 로 분류하는 패턴.
// onLine 단계에서 parseQuotaReset 가 잠금까지 마쳤더라도 여기서 'quota' 로
// 분류돼야 finishRunRecord(quota_limited) + tryQuotaRetry 가 호출돼 다른
// 계정으로 자동 이어진다. provider 별 실제 출력 형태를 모두 잡도록 확장.
const QUOTA_PATTERNS = [
  /rate[_\s-]?limit(?:ed|[_\s-]?(?:exceeded|reached))/i,
  /rate_limit_exceeded/i,
  /quota (?:exceeded|reached)/i,
  /usage (?:limit|exceeded)/i,
  /you have reached your/i,
  /you'?ve hit your (?:limit|weekly limit|daily limit|usage)/i, // Claude Code 정확 매칭
  /hit your (?:limit|weekly|daily)/i,
  /too many requests/i,
  /429/,
  /weekly limit/i,
  /monthly limit/i,
  /daily limit/i,
  /resource[_\s]exhausted/i, // Gemini
  /retry.?delay/i, // Gemini
  /insufficient_quota/i, // Codex / OpenAI
  /resets?\s+(?:today|tomorrow|in|at|on|by|\d)/i, // 전치사 없는 "resets 6:30pm" 등
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

// Claude Code `--output-format stream-json --verbose` 가 NDJSON 으로 흘려보내는
// 진행 이벤트를 dashboard event log 에 보여줄 수 있는 한 줄 메시지로 변환.
// 반환:
//   { skip: true }        — 이 라인은 event log 에 보이지 말 것 (system init 등)
//   { display: string }   — event log 에 보여줄 사람용 한 줄
//   { display, finalText } — 완료 이벤트일 때 final assistant text 동봉
//   { keep: true }        — JSON 아님 → 원본 라인 그대로 처리하라
export function interpretClaudeStreamLine(line) {
  const raw = String(line || "").trim();
  if (!raw || raw[0] !== "{") return { keep: true };
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return { keep: true };
  }
  const type = String(event?.type || "");
  if (!type) return { skip: true };

  if (type === "system") {
    const subtype = String(event.subtype || "");
    if (subtype === "init") {
      const model = event.model ? `모델 ${event.model}` : "";
      const tools = Array.isArray(event.tools) ? `${event.tools.length} 개 tool` : "";
      const info = [model, tools].filter(Boolean).join(" / ");
      return { display: `▶ Claude Code 세션 시작 (${info || "준비"})` };
    }
    return { skip: true };
  }

  if (type === "assistant") {
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    const blocks = [];
    for (const block of content) {
      const blockType = String(block?.type || "");
      if (blockType === "text") {
        const text = String(block?.text || "").trim();
        if (text) {
          const oneLine = text.replace(/\s+/g, " ");
          blocks.push(`💬 ${oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine}`);
        }
      } else if (blockType === "tool_use") {
        const name = String(block?.name || "Tool");
        const input = block?.input || {};
        let summary = "";
        if (typeof input?.file_path === "string") summary = input.file_path;
        else if (typeof input?.path === "string") summary = input.path;
        else if (typeof input?.command === "string") summary = input.command.length > 80 ? `${input.command.slice(0, 80)}…` : input.command;
        else if (typeof input?.pattern === "string") summary = input.pattern;
        else if (typeof input?.url === "string") summary = input.url;
        else if (typeof input?.description === "string") summary = input.description;
        blocks.push(summary ? `🔧 ${name}(${summary})` : `🔧 ${name}`);
      } else if (blockType === "thinking") {
        const text = String(block?.thinking || block?.text || "").trim();
        if (text) {
          const oneLine = text.replace(/\s+/g, " ");
          blocks.push(`🤔 ${oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine}`);
        }
      }
    }
    if (blocks.length === 0) return { skip: true };
    return { display: blocks.join(" · ") };
  }

  if (type === "user") {
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    const blocks = [];
    for (const block of content) {
      if (String(block?.type || "") !== "tool_result") continue;
      const isError = block?.is_error === true;
      const result = block?.content;
      let text = "";
      if (typeof result === "string") text = result;
      else if (Array.isArray(result)) {
        text = result
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .filter(Boolean)
          .join(" ");
      }
      text = text.replace(/\s+/g, " ").trim();
      if (isError) {
        blocks.push(`⚠ tool 결과 오류: ${text.length > 160 ? `${text.slice(0, 160)}…` : text}`);
      } else if (text) {
        // 정상 tool 결과는 한 줄 미리보기만.
        const preview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
        blocks.push(`↳ ${preview}`);
      }
    }
    if (blocks.length === 0) return { skip: true };
    return { display: blocks.join(" · ") };
  }

  if (type === "result") {
    const subtype = String(event.subtype || "");
    const isError = event?.is_error === true || subtype === "error";
    const turns = Number(event?.num_turns || 0);
    const duration = Number(event?.duration_ms || 0);
    const cost = Number(event?.total_cost_usd || 0);
    const parts = [];
    if (turns) parts.push(`${turns}턴`);
    if (duration) parts.push(`${Math.round(duration / 1000)}초`);
    if (cost) parts.push(`$${cost.toFixed(4)}`);
    const summary = parts.length ? ` (${parts.join(" / ")})` : "";
    const display = isError
      ? `▣ Claude 결과 오류${summary} — ${String(event?.error || event?.result || "").slice(0, 200)}`
      : `▣ Claude 작업 종료${summary}`;
    const finalText = typeof event?.result === "string" ? event.result : "";
    return { display, finalText };
  }

  return { skip: true };
}

export function detectInterruption(workerId, output) {
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
  // 조직 정책 거절은 quota 보다 먼저 분류. quota 패턴이 정책 거절 메시지의
  // 부분 문구(예: "사용 정책") 와 충돌해 quota 로 잘못 잡히는 걸 막는다.
  for (const pattern of ORG_POLICY_PATTERNS) {
    const match = output.match(pattern);
    if (match) {
      const snippet = match[0].length > 120 ? `${match[0].slice(0, 120)}...` : match[0];
      return {
        kind: "policy_blocked",
        reason: `${provider || "도구"} 가 조직 정책으로 작업을 거절했습니다: "${snippet}"`,
      };
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

// 공통관리 헤더를 **프로젝트별로 동적 생성**한다. 과거에는 AgentApp 저장소
// 기준 하드코딩 텍스트를 모든 프로젝트에 주입해서, 외부 프로젝트(예:
// sytleOsjang 처럼 handoff/ 가 없는 곳)의 worker 가 존재하지 않는 경로를 찾아
// 헤매거나 "여긴 AgentApp 저장소" 로 오해하는 문제가 있었다.
//
// 이제 작업 디렉터리(workspace)에 **실제 존재하는** 공유 파일만 감지해 그
// 경로만 언급한다. 여러 에이전트가 같은 프로젝트를 이어받는 "공통관리" 의도는
// 유지하되, 각 프로젝트의 실제 구조에 맞춘다.
async function buildSyncPreamble(workspace) {
  if (!workspace || !existsSync(workspace)) return "";
  const projName = path.basename(workspace.replace(/[\\/]+$/, "")) || "프로젝트";
  const has = (...segs) => existsSync(path.join(workspace, ...segs));

  const ruleFiles = [];
  if (has("AGENTS.md")) ruleFiles.push("AGENTS.md");
  if (has("CLAUDE.md")) ruleFiles.push("CLAUDE.md");

  const items = ["- git: 현재 branch 의 working tree. 의미 있는 변경은 작은 단위로 commit. push 는 remote 가 명확할 때만."];
  if (has(".claude-sync", "memory", "project_state.md")) {
    items.push("- `.claude-sync/memory/project_state.md`: 현재 상태와 다음 작업 후보. 진행 시 갱신.");
  } else if (has(".claude-sync")) {
    items.push("- `.claude-sync/`: 이 프로젝트의 공용 memory/plan. 진행 시 갱신.");
  }
  if (has(".claude-sync", "plans")) {
    items.push("- `.claude-sync/plans/`: 단계 완료/방향 전환 시 해당 plan 체크박스 갱신.");
  }
  if (has("tools", "agent-orchestrator", "handoff", "NEXT_TASK.md")) {
    items.push("- `tools/agent-orchestrator/handoff/NEXT_TASK.md`: 다음 작업 1순위. 시작 시 확인.");
  }
  if (has("tools", "agent-orchestrator", "handoff", "RUN_STATUS.md")) {
    items.push("- `tools/agent-orchestrator/handoff/RUN_STATUS.md`: 작업 종료 시 결과 한 줄 남김.");
  }
  if (has("tools", "agent-orchestrator", "handoff", "DECISIONS_REQUIRED.md")) {
    items.push("- `tools/agent-orchestrator/handoff/DECISIONS_REQUIRED.md`: 사용자 결정 필요 항목만 여기에.");
  }

  const lines = [`[${projName} 공통 관리 — 이 프로젝트를 작업하는 모든 에이전트 공통]`, ""];
  lines.push("여러 에이전트(Codex/Claude Code/Cursor/Gemini)가 이 프로젝트를 이어받아 작업한다.");
  if (ruleFiles.length) {
    lines.push(`먼저 ${ruleFiles.join(" / ")} 의 이 프로젝트 규칙을 읽는다.`);
  }
  lines.push("아래는 이 프로젝트에 실제 존재하는 공유 파일이다. 시작 전 확인하고, 의미 있는 진행이 있으면 갱신한 뒤 종료한다.");
  lines.push("");
  lines.push(...items);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function writeLaunchPrompt(run, files) {
  const userPrompt = String(run.prompt || "").trim();
  const promptPrefix = String(run.promptPrefix || "").trim();
  const prefixBlock = promptPrefix ? `${promptPrefix}\n\n` : "";
  // 작업 디렉터리를 먼저 확정해 그 프로젝트에 실제 존재하는 파일 기반으로
  // 공통관리 헤더를 만든다. workspace 를 모르면(또는 헤더 만들 게 없으면)
  // 헤더 없이 사용자 프롬프트만 전달한다.
  const workspace = (await resolveProjectPath(run.projectId))
    || (isPackagedRuntime() ? safeSpawnCwd() : REPO_ROOT);
  const preamble = await buildSyncPreamble(workspace);
  const preBlock = preamble ? `${preamble}\n---\n` : "";
  // 사용자가 입력한 프롬프트가 있으면 그것만 그대로 전달 (chat 모드).
  // 비어 있을 때만 워커 핸드오프 템플릿을 사용 (NEXT_TASK 자동 진행 모드).
  let body;
  if (userPrompt) {
    const launchPrompt = promptPrefix && !userPrompt.startsWith(promptPrefix)
      ? `${promptPrefix}\n\n${userPrompt}`
      : userPrompt;
    body = `${preBlock}${launchPrompt}`;
  } else {
    const workerPrompt = await readWorkerPrompt(run.workerId);
    const inner = workerPrompt
      ? workerPrompt
      : "Continue from tools/agent-orchestrator/handoff/NEXT_TASK.md.";
    body = `${preBlock}${prefixBlock}${inner}`;
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

// codebase-memory MCP 바이너리 위치 해석. 우선순위: settings 경로 > env > .tooling(dev) > PATH.
// 못 찾으면 "" 반환 → 등록을 건너뛰고 launch 는 정상 진행 (graceful).
async function resolveCmmBinary(settings) {
  const explicit = settings?.integrations?.codebaseMemoryMcpPath || "";
  if (explicit && existsSync(explicit)) return explicit;
  const fromEnv = process.env.AGENTAPP_CMM_COMMAND || "";
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const dev = path.join(REPO_ROOT, ".tooling", "codebase-memory-mcp", "extracted", "codebase-memory-mcp.exe");
  if (existsSync(dev)) return dev;
  return (await commandPathFor("codebase-memory-mcp")) || "";
}

// 세션 프로필 경계 안에 codebase-memory MCP 를 등록한다. claude 는 --mcp-config 로
// 가리킬 JSON 경로를 반환, codex/gemini 는 자기 config dir 파일에 기록 후 "" 반환.
// 설정 예시: tools/agent-orchestrator/integrations/codebase-memory-mcp/.
export async function registerCodebaseMemoryMcp(provider, sessionDir, binPath) {
  const name = "codebase-memory";
  if (provider === "claude-code") {
    const file = path.join(sessionDir, "codebase-memory.mcp.json");
    await writeFile(file, JSON.stringify({ mcpServers: { [name]: { command: binPath, args: [] } } }, null, 2));
    return file;
  }
  if (provider === "codex") {
    const file = path.join(sessionDir, "config.toml");
    let existing = "";
    try { existing = await readFile(file, "utf8"); } catch { /* 새 프로필 */ }
    if (!existing.includes(`[mcp_servers.${name}]`)) {
      const block = `\n[mcp_servers.${name}]\ncommand = ${JSON.stringify(binPath)}\nargs = []\n`;
      await writeFile(file, existing + block);
    }
    return "";
  }
  if (provider === "gemini-cli") {
    const file = path.join(sessionDir, "settings.json");
    let json = {};
    try { json = JSON.parse(await readFile(file, "utf8")); } catch { /* 새 프로필 */ }
    json.mcpServers = { ...(json.mcpServers || {}), [name]: { command: binPath, args: [] } };
    await writeFile(file, JSON.stringify(json, null, 2));
    return "";
  }
  return "";
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

  // codebase-memory MCP opt-in. 켜져 있고 바이너리가 해석되면 세션 프로필에 등록.
  const settings = await getRuntimeSettings();
  const cmmBin = settings.integrations?.codebaseMemoryMcp ? await resolveCmmBinary(settings) : "";

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
    if (cmmBin) await registerCodebaseMemoryMcp("codex", sessionDir, cmmBin);
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
    let claudeMcpArgs = [];
    if (cmmBin) {
      const cfg = await registerCodebaseMemoryMcp("claude-code", sessionDir, cmmBin);
      if (cfg) claudeMcpArgs = ["--mcp-config", cfg];
    }
    const claudeModel = mapClaudeModel(run.routing?.model || run.modelOverride);
    return {
      status: "ready",
      mode: "command",
      command,
      // --output-format stream-json --verbose 는 Claude Code 가 작업 진행을
      // NDJSON 으로 즉시 흘려보내는 모드. text 모드 (--print 만) 는 응답이
      // 다 끝날 때까지 stdout 이 비어 있어 dashboard 에 진행 상황이 안 보인다.
      // 각 라인은 한 개의 완성된 JSON 이벤트 (system / assistant / user /
      // tool_use / tool_result / result) — interpretClaudeStreamLine 가
      // 사람 읽기 좋은 한 줄로 변환해서 event log 에 보여준다.
      args: [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        ...claudeMcpArgs,
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
      summary: "Claude Code --print stream-json 어댑터 준비 완료",
      // raw stream-json 을 lastMessage 로 저장하면 JSON 파편이 들어가므로
      // assistant text 만 모아서 별도 buffer 에서 기록한다.
      writeLastMessageFromStdout: false,
      streamJsonClaude: true,
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
    if (cmmBin) await registerCodebaseMemoryMcp("gemini-cli", sessionDir, cmmBin);
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
    const startedAt = Date.now();
    let lastActivityAt = Date.now();
    let warned = false;
    let idleKilled = false;
    let sessionCapKilled = false;
    let permissionPromptKilled = false;
    let stdinClosed = false;
    let autoConfirmCount = 0;
    const AUTO_CONFIRM_MAX = 5;

    const idleTimer = options.idleWarnMs || options.idleKillMs || options.maxSessionMs
      ? setInterval(async () => {
          const now = Date.now();
          const idleMs = now - lastActivityAt;
          const sessionMs = now - startedAt;
          if (!warned && options.idleWarnMs && idleMs >= options.idleWarnMs) {
            warned = true;
            if (options.onIdleWarn) await options.onIdleWarn(idleMs);
          }
          if (options.idleKillMs && idleMs >= options.idleKillMs) {
            idleKilled = true;
            clearInterval(idleTimer);
            if (options.onIdleKill) await options.onIdleKill(idleMs);
            killChildTree(child.pid);
            return;
          }
          // wall-time cap. idleKill 은 "출력이 멈춘 시간" 만 본다 — worker 가
          // 의미 없는 출력을 계속 흘리며 진척 없이 시간만 까먹는 패턴은
          // idleKill 로 잡히지 않는다. maxSessionMs (>0) 가 설정되면 그
          // 시간 안에 무조건 종료해 한 작업이 며칠씩 멈춰 보이는 현상을 막는다.
          if (options.maxSessionMs && sessionMs >= options.maxSessionMs) {
            sessionCapKilled = true;
            clearInterval(idleTimer);
            if (options.onSessionCap) await options.onSessionCap(sessionMs);
            killChildTree(child.pid);
          }
        }, 5000)
      : null;

    const tryAutoConfirm = async (trimmed) => {
      // stream-json mode 의 NDJSON 라인 (assistant / tool_use / tool_result / result)
      // 안에는 모델이 인용한 임의 텍스트가 들어 있다. 그 텍스트가 우연히 "Continue?",
      // "Are you sure?", "Trust this workspace?", "loginDesc" 같은 권한 prompt 패턴
      // 단어를 포함하면 (예: 사용자 코드의 i18n ko/en.json 메시지) false positive 로
      // worker 가 즉시 kill 되는 사고가 있었다. NDJSON 은 항상 `{` 또는 `[` 로 시작
      // 하므로 그 라인은 권한 prompt 검사에서 제외한다. 실제 CLI 권한 prompt 는
      // plain text 로 나오므로 영향 없음.
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
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
        sessionCapKilled,
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
  const maxSession = Number.isFinite(Number(settings.maxSessionMs)) ? Math.max(0, Number(settings.maxSessionMs)) : 0;
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
  if (maxSession > 0) {
    await appendRunEvent(run.id, {
      level: "info",
      message: `세션 wall-time 한도: ${Math.round(maxSession / 1000 / 60)}분 (이 시간 안에 무조건 종료)`,
    });
  }
  // Claude stream-json 어댑터의 진행 텍스트 누적 — final result 이벤트가
  // 안 오는 비정상 종료 대비 fallback 으로도 쓰인다.
  const claudeStream = {
    enabled: Boolean(adapter.streamJsonClaude),
    assistantText: "",
    finalText: "",
  };

  const result = await streamProcess(adapter.command, adapter.args, {
    cwd: adapterCwd,
    env: { ...augmentedSpawnEnv(), ...(adapter.env || {}) },
    logPath: files.launchLogPath,
    stdinText: promptText,
    idleWarnMs: idleWarn,
    idleKillMs: idleKill,
    maxSessionMs: maxSession,
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
      // Claude stream-json: stdout 의 NDJSON 라인을 사람용으로 변환해 event log
      // 에 보여주고, 원본 JSON 라인은 숨긴다. stderr 는 그대로 통과.
      //
      // 라인을 parseQuotaReset 에 그대로 넘기지 않는다. tool_result 블록 본문에
      // 우연히 "limit", "quota" 같은 단어가 섞이면 false-positive 잠금이 발생해
      // 정상 계정이 routing 후보에서 제외되는 사고가 있었다 (DEC-20260516-003).
      // 대신: stderr 는 그대로, stream-json stdout 은 interpret 결과만 검사한다.
      let quotaScanLine = "";
      if (claudeStream.enabled && level === "stdout") {
        const interp = interpretClaudeStreamLine(line);
        if (interp.skip) {
          // 건너뛰는 라인은 event log 에 보이지 않게.
        } else if (interp.display) {
          if (typeof interp.finalText === "string" && interp.finalText) {
            claudeStream.finalText = interp.finalText;
          }
          // assistant text 누적 (final 미수신 대비)
          const m = interp.display.match(/^💬\s+(.*)$/);
          if (m) claudeStream.assistantText += `${m[1]}\n`;
          await appendRunEvent(run.id, {
            level: "info",
            message: interp.display.length > 240 ? `${interp.display.slice(0, 240)}...` : interp.display,
          });
          // 실제 한도 메시지는 Claude CLI 의 final `result` 이벤트로 도착한다.
          // result 이벤트의 finalText 만 quota 검사 대상으로 삼는다. assistant
          // 텍스트나 tool_use/tool_result preview 는 검사하지 않는다 — 모델이
          // 인용한 단어가 잠금을 일으키는 false-positive 를 차단.
          if (typeof interp.finalText === "string" && interp.finalText) {
            quotaScanLine = interp.finalText;
          }
        } else if (interp.keep) {
          // JSON 으로 해석되지 않은 stdout 라인 (드물게 CLI 가 plain text 를
          // stream-json 모드 중 섞어 보낸 경우). 정상 텍스트로 보고 검사 대상.
          await appendRunEvent(run.id, {
            level: "info",
            message: line.length > 220 ? `${line.slice(0, 220)}...` : line,
          });
          quotaScanLine = line;
        }
      } else {
        await appendRunEvent(run.id, {
          level: level === "stderr" ? "warn" : "info",
          message: line.length > 220 ? `${line.slice(0, 220)}...` : line,
        });
        // 비 stream-json 모드 또는 stderr 라인은 종전대로 raw line 을 검사.
        quotaScanLine = line;
      }
      // 진행 상황 표면화 — '[STATUS] ...' 라인이 보이면 run.currentStatus 에 저장.
      // dashboard 가 이 필드를 topbar/컴팩트 모드에 실시간 표시.
      try {
        const statusMatch = String(line).match(/^\s*\[STATUS\]\s*(.+?)\s*$/i);
        if (statusMatch && statusMatch[1]) {
          await patchRunRecord(run.id, { currentStatus: statusMatch[1].slice(0, 200) });
        }
      } catch {
        /* status marker is opportunistic */
      }
      if (!quotaScanLine) return;
      try {
        const { parseQuotaReset, applyQuotaLockout, providerForWorker } = await import("./dashboard-runtime.mjs");
        const providerHint = run.routing?.provider || providerForWorker(run.workerId) || "";
        const resetAt = parseQuotaReset(quotaScanLine, providerHint);
        if (resetAt && run.routing?.accountId) {
          await applyQuotaLockout(
            run.routing.accountId,
            resetAt,
            quotaScanLine.length > 200 ? `${quotaScanLine.slice(0, 200)}...` : quotaScanLine,
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
    onSessionCap: async (sessionMs) => {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `세션 wall-time 한도 (${Math.round(sessionMs / 1000 / 60)} 분) 도달 — 자동 종료합니다. autoChain 이 켜져 있으면 다른 계정에서 NEXT_TASK 가 자동 픽업됩니다.`,
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

  // Claude stream-json: result 이벤트의 finalText 우선, 없으면 누적된
  // assistant text fallback. raw NDJSON 을 lastMessage 로 기록하지 않는다.
  if (claudeStream.enabled) {
    const finalText = claudeStream.finalText || claudeStream.assistantText.trim();
    if (finalText) {
      try {
        await writeFile(files.lastMessagePath, `${finalText}\n`, "utf8");
      } catch {
        // best-effort
      }
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

  // session wall-time cap. idleKill 과 달리 계정을 needs-login 으로 떨어뜨리지
  // 않는다 (계정 자체에는 문제 없음). status 는 completed 로 둬서 autoChain 이
  // 다음 사이클을 다른 ready 계정으로 자동 이어받을 수 있게 한다.
  if (result.sessionCapKilled) {
    await finishRunRecord(
      run.id,
      {
        status: "completed",
        adapter: {
          status: "session-cap",
          mode: adapter.mode,
          pid: result.pid,
          exitCode: result.code,
          logPath: relativePath(files.launchLogPath),
          promptPath: relativePath(files.promptPath),
          sessionDir: relativePath(adapter.sessionDir),
        },
      },
      {
        handoffStatus: "completed",
        handoffReason: "session_cap_reached",
      },
    );
    return;
  }

  // 정책 거절 우선 분류 — Claude Enterprise 의 조직 정책 거절은 worker 가 exit code 0
  // 으로 정상 종료하면서 본문에만 거절문을 내놓는 형태라 result.code === 0 분기로 가기
  // 전에 본문/출력 전체에서 패턴을 먼저 검사한다. 안 그러면 "completed" 로 마감 → autoChain
  // 이 같은 계정에서 NEXT_TASK 를 또 spawn 하는 토큰 폭주가 발생.
  const earlyDetection = detectInterruption(
    run.workerId,
    `${result.combinedOutput || ""}\n${lastMessage || ""}`,
  );
  if (earlyDetection.kind === "policy_blocked") {
    await appendRunEvent(run.id, { level: "error", message: earlyDetection.reason });
    // 정책 거절 = 그 작업이 그 계정의 정책에 안 맞았다는 신호일 뿐, 계정 자체가
    // 망가진 게 아니다. 24h 자동 잠금은 다음 cycle 에 같은 회사 계정으로 정상
    // 통과될 작업까지 막아버려서 오히려 사용성을 해친다. 잠금 대신 분류 단계
    // (classifyTaskDomain) 에서 "명확히 통과할" 작업만 회사 계정 우선으로
    // 라우팅하도록 제한하고, 정책 거절이 발생하면 그냥 다른 provider 로 1 회만
    // failover 한 뒤 다음 요청은 새 분류로 다시 판단한다.
    await finishRunRecord(
      run.id,
      {
        status: "policy_blocked",
        adapter: {
          status: "policy-blocked",
          mode: adapter.mode,
          pid: result.pid,
          exitCode: result.code,
          summary: earlyDetection.reason,
          logPath: relativePath(files.launchLogPath),
          promptPath: relativePath(files.promptPath),
          sessionDir: relativePath(adapter.sessionDir),
        },
      },
      {
        handoffStatus: "policy_blocked",
        handoffReason: "org_policy_refusal",
      },
    );
    try {
      const { tryPolicyRetry } = await import("./dashboard-runtime.mjs");
      const retried = await tryPolicyRetry(run);
      if (retried) {
        await appendRunEvent(run.id, {
          level: "info",
          message: `▶ 정책 거절 — ${retried.routing?.accountId || "다른 계정"} 으로 1 회 전환 시도 (policy retry).`,
        });
      } else {
        await appendRunEvent(run.id, {
          level: "error",
          message: "정책 거절 — 다른 provider/계정 후보가 없거나 이미 1 회 재시도했습니다. 작업 내용을 정책에 맞게 조정하거나 사이드바에서 다른 계정을 준비한 뒤 다시 시작하세요.",
        });
      }
    } catch (error) {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `policy retry 시도 중 오류: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
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
      // CHAIN_DONE 은 worker 의 '정말 끝남' 신호다. 출력 중간이나 코드 사이에
      // 섞인 CHAIN_DONE 으로 오작동하지 않도록, **마지막 비어있지 않은 줄**이
      // 정확히 CHAIN_DONE 일 때만 신호로 인정한다. 신호가 맞더라도 멈출지
      // 여부는 tryAutoChain 이 진행률/NEXT_TASK 를 보고 한 번 더 판단한다
      // (남은 작업이 있으면 override 해서 이어감).
      const lines = responseText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const lastLine = lines.length > 0 ? lines[lines.length - 1] : "";
      const chainDoneSignaled = /^CHAIN_DONE[.!\s]*$/i.test(lastLine);

      {
        const { tryAutoChain } = await import("./dashboard-runtime.mjs");
        const chained = await tryAutoChain(run, { chainDoneSignaled, lastMessage: responseText });
        if (chained && chained.stopped) {
          await appendRunEvent(run.id, {
            level: "info",
            message: `▣ autoChain 종료 — ${chained.reason}`,
          });
        } else if (chained && chained.skipped) {
          await appendRunEvent(run.id, {
            level: "info",
            message: `▣ autoChain 중단 — ${chained.reason || "한도 도달"}.`,
          });
        } else if (chained) {
          const depthSuffix = chained.chainDepth ? ` (depth ${chained.chainDepth})` : "";
          const overrideSuffix =
            chained.chainReason === "chain_done_override"
              ? " — worker 가 CHAIN_DONE 을 보냈지만 남은 작업이 있어 이어감"
              : "";
          await appendRunEvent(run.id, {
            level: "info",
            message: `▶ autoChain: ${chained.workerId} 로 자동 이어 시작했습니다 (run ${chained.id})${depthSuffix}${overrideSuffix}.`,
          });
          // startRun 이 내부에서 이미 launchDashboardWorker 를 호출했으므로
          // 여기서 다시 launch 하면 같은 run 에 worker 가 두 개 spawn 된다.
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
        // startRun 이 내부에서 이미 launchDashboardWorker 를 호출했으므로 중복 호출 금지.
      }
    } catch (error) {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `재시도 시도 중 오류: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    return;
  }
  if (detection.kind === "policy_blocked") {
    await appendRunEvent(run.id, { level: "error", message: detection.reason });
    // 정책 거절은 그 작업이 그 계정 정책에 안 맞았다는 신호일 뿐 계정이 망가진
    // 게 아니다. 24h 자동 잠금 대신 분류 단계에서 회사 계정 우선 작업을 제한
    // 하고, 거절이 발생하면 다른 provider 로 1 회만 failover 한 뒤 다음 요청은
    // 새 분류로 다시 판단한다.
    await finishRunRecord(
      run.id,
      {
        status: "policy_blocked",
        adapter: {
          status: "policy-blocked",
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
        handoffStatus: "policy_blocked",
        handoffReason: "org_policy_refusal",
      },
    );
    // 다른 vendor 의 ready 계정으로 1 회만 failover. 같은 vendor 의 다른 계정에도
    // 같은 조직 정책이 적용될 가능성이 높기 때문에 cross-provider 우선 시도.
    // policyRetryCount 가 이미 1 이면 더 이상 시도하지 않아 cascading 폭주 차단.
    try {
      const { tryPolicyRetry } = await import("./dashboard-runtime.mjs");
      const retried = await tryPolicyRetry(run);
      if (retried) {
        await appendRunEvent(run.id, {
          level: "info",
          message: `▶ 정책 거절 — ${retried.routing?.accountId || "다른 계정"} 으로 1 회 전환 시도 (policy retry).`,
        });
      } else {
        await appendRunEvent(run.id, {
          level: "error",
          message: "정책 거절 — 다른 provider/계정 후보가 없거나 이미 1 회 재시도했습니다. 작업 내용을 정책에 맞게 조정하거나 사이드바에서 다른 계정을 준비한 뒤 다시 시작하세요.",
        });
      }
    } catch (error) {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `policy retry 시도 중 오류: ${error instanceof Error ? error.message : String(error)}`,
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
        // startRun 이 내부에서 이미 launchDashboardWorker 를 호출했으므로 중복 호출 금지.
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

  const interruptedPatch = await buildInterruptedWorktreePatch(run, "worker_failed");
  if (interruptedPatch.interruptedWorktree) {
    const files = interruptedPatch.interruptedWorktree.files.slice(0, 6).join(", ");
    const suffix = interruptedPatch.interruptedWorktree.fileCount > 6
      ? ` 외 ${interruptedPatch.interruptedWorktree.fileCount - 6}개`
      : "";
    await appendRunEvent(run.id, {
      level: "warn",
      message: `작업 실패 후 미커밋 변경 ${interruptedPatch.interruptedWorktree.fileCount}개가 남아 있습니다: ${files}${suffix}`,
    });
  }
  await finishRunRecord(
    run.id,
    {
      ...interruptedPatch,
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
    projectId: run.projectId || "",
    projectPath: adapter.workspace || "",
    accountId: run.routing?.accountId || "",
    provider: run.routing?.provider || "",
    model: run.routing?.model || "",
    reasoningEffort: run.routing?.reasoningEffort || "",
    sessionProfile: run.routing?.sessionProfile || "",
    mode: adapter.mode,
    promptPath: relativePath(files.promptPath),
    launchLogPath: relativePath(files.launchLogPath),
    validationLogPath: relativePath(files.validationLogPath),
    lastMessagePath: relativePath(files.lastMessagePath),
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

// 같은 run 에 대해 launch / execute 가 중복 진입되지 않게 막는 가드.
// retry / autoChain / pending-dispatch / HTTP 더블 클릭 등 여러 경로에서 호출될
// 수 있어, 한 프로세스 안에서는 in-memory 잠금으로 즉시 차단한다.
const RUN_LAUNCH_LOCKS = new Set();

function isPidAlive(pid) {
  const value = Number(pid || 0);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function launchDashboardWorker(run) {
  if (!run || !run.id) return;
  if (RUN_LAUNCH_LOCKS.has(run.id)) {
    await appendRunEvent(run.id, {
      level: "warn",
      message: `중복 launch 요청 무시 — 같은 run 에 이미 실행 어댑터가 준비 중입니다 (pid ${process.pid}).`,
    });
    return;
  }
  // adapter 가 이미 running 또는 launching 상태면 중복 호출.
  // 이전 프로세스가 남긴 상태일 수도 있어 PID 가 살아있을 때만 가드한다.
  try {
    const existing = await resolveRun(run.id);
    const status = existing?.adapter?.status || "";
    const pid = Number(existing?.adapter?.pid || 0);
    if ((status === "running" || status === "launching") && pid > 0 && isPidAlive(pid)) {
      await appendRunEvent(run.id, {
        level: "warn",
        message: `중복 launch 요청 무시 — 이미 어댑터 pid ${pid} 가 ${status} 상태입니다.`,
      });
      return;
    }
  } catch {
    // 가드 실패는 무시하고 일반 흐름으로 진행.
  }
  RUN_LAUNCH_LOCKS.add(run.id);
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
      executeRun(run.id)
        .catch(async (error) => {
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
        })
        .finally(() => {
          RUN_LAUNCH_LOCKS.delete(run.id);
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
  // 자식 노드 프로세스가 detached 로 인계됐으니, 부모 프로세스에서는 잠금을 풀어
  // 같은 run 의 후속 patch / log 호출이 막히지 않도록 한다. 자식 안의 중복 호출은
  // 자식 자체의 RUN_LAUNCH_LOCKS 가 다시 막는다.
  RUN_LAUNCH_LOCKS.delete(run.id);
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
