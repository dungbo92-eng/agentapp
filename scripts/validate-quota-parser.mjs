#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const fixedNow = Date.parse("2026-05-13T00:00:00.000Z");
const realDateNow = Date.now;
const tempDir = path.join(os.tmpdir(), `agentapp-quota-validate-${realDateNow()}`);

await mkdir(tempDir, { recursive: true });
process.env.AGENTAPP_DATA_DIR = tempDir;
process.env.AGENTAPP_DISABLE_LEGACY_RUNTIME_RECOVERY = "1";

const {
  classifyTaskDomain,
  dispatchPendingForAccount,
  ensureMaintenancePromptPrefix,
  parseQuotaReset,
  readRuntime,
  setAccountSession,
  startRun,
  tryAutoChain,
  writeRuntime,
} = await import("./dashboard-runtime.mjs");
const { detectInterruption, interpretClaudeStreamLine } = await import("./worker-launch-adapter.mjs");

Date.now = () => fixedNow;

const cases = [
  {
    name: "claude month-date reset",
    line: "You've hit your limit \u00b7 resets May 18, 6am (Asia/Seoul)",
    provider: "claude",
    expected: "2026-05-17T21:00:00.000Z",
  },
  {
    name: "generic month-date reset",
    line: "You've hit your limit \u00b7 resets May 18, 6am (Asia/Seoul)",
    provider: "",
    expected: "2026-05-17T21:00:00.000Z",
  },
  {
    name: "claude tomorrow reset",
    line: "Usage limit reached, resets tomorrow 6pm (Asia/Seoul)",
    provider: "claude",
    expected: "2026-05-14T09:00:00.000Z",
  },
  {
    name: "codex hard fallback reset",
    line: "ERROR: rate_limit_exceeded",
    provider: "codex",
    expected: "2026-05-13T01:00:00.000Z",
  },
  {
    name: "codex doc rate-limit phrase ignored",
    line: "- API Rate Limit applied, retry/backoff needed",
    provider: "codex",
    expected: null,
  },
  {
    name: "generic doc rate-limit phrase ignored",
    line: "- API Rate Limit applied, retry/backoff needed",
    provider: "",
    expected: null,
  },
];

try {
  for (const item of cases) {
    const actual = parseQuotaReset(item.line, item.provider);
    if (actual !== item.expected) {
      throw new Error(`${item.name}: expected ${item.expected}, got ${actual}`);
    }
    console.log(`[validate-quota-parser] ok ${item.name}`);
  }

  const runtimeFile = path.join(tempDir, "dashboard-runtime.json");

  await writeRuntime({
    version: 1,
    accounts: [
      {
        id: "recovery-account",
        provider: "codex",
        plan: "plus",
        loginLabel: "recovery",
        sessionStatus: "ready",
        remainingUnits: 10,
        weeklyUnits: 80,
      },
    ],
    projects: [{ id: "recovery-project", name: "recovery", path: tempDir }],
    activeRuns: [],
    activeRun: null,
    runHistory: [],
    pendingRuns: [],
    settings: {},
  });
  await writeFile(runtimeFile, "", "utf8");
  await writeFile(`${runtimeFile}.bak`, "", "utf8");
  const recoveredRuntime = await readRuntime();
  if (
    !recoveredRuntime.accounts.some((account) => account.id === "recovery-account")
    || !recoveredRuntime.projects.some((project) => project.id === "recovery-project")
  ) {
    throw new Error("last-good runtime recovery did not restore accounts/projects");
  }
  console.log("[validate-quota-parser] ok last-good runtime recovery");

  const softInterruption = detectInterruption("codex", "- API Rate Limit applied, retry/backoff needed");
  if (softInterruption.kind !== "") {
    throw new Error(`codex doc rate-limit phrase was classified as ${softInterruption.kind}`);
  }
  console.log("[validate-quota-parser] ok worker ignores doc rate-limit phrase");

  const hardInterruption = detectInterruption("codex", "ERROR: rate_limit_exceeded");
  if (hardInterruption.kind !== "quota") {
    throw new Error(`codex hard rate limit was classified as ${hardInterruption.kind || "none"}`);
  }
  console.log("[validate-quota-parser] ok worker detects hard rate-limit error");

  const companyPrompt = ensureMaintenancePromptPrefix(
    "T-SQL 오류 확인",
    { email: "dev@hanilnetworks.com" },
    "hanilnetworks.com",
  );
  if (companyPrompt !== "[에러분석] T-SQL 오류 확인" || classifyTaskDomain(companyPrompt) !== "maintenance") {
    throw new Error(`company prompt was not prefixed correctly: ${companyPrompt}`);
  }
  console.log("[validate-quota-parser] ok company prompt prefix added");

  const normalizedCompanyPrompt = ensureMaintenancePromptPrefix(
    "[오류분석] T-SQL 오류 확인",
    { actualAuthEmail: "dev@hanilnetworks.com" },
    "hanilnetworks.com",
  );
  if (normalizedCompanyPrompt !== "[에러분석] T-SQL 오류 확인") {
    throw new Error(`company prompt leading tag was not normalized: ${normalizedCompanyPrompt}`);
  }
  console.log("[validate-quota-parser] ok company prompt prefix normalized");

  const personalPrompt = ensureMaintenancePromptPrefix(
    "T-SQL 오류 확인",
    { email: "dev@example.com" },
    "hanilnetworks.com",
  );
  if (personalPrompt !== "T-SQL 오류 확인") {
    throw new Error(`personal prompt was unexpectedly prefixed: ${personalPrompt}`);
  }
  console.log("[validate-quota-parser] ok personal prompt not prefixed");

  await writeFile(runtimeFile, JSON.stringify({
    version: 1,
    accounts: [
      {
        id: "expired-codex",
        provider: "codex",
        plan: "plus",
        loginLabel: "expired",
        sessionStatus: "ready",
        remainingUnits: 0,
        weeklyUnits: 80,
        quotaResetAt: "2026-05-12T00:00:00.000Z",
        quotaReason: "expired quota",
      },
    ],
    projects: [],
    activeRun: null,
    runHistory: [],
    pendingRuns: [],
    settings: {},
  }, null, 2), "utf8");

  const normalized = await readRuntime();
  const expired = normalized.accounts.find((account) => account.id === "expired-codex");
  if (expired?.remainingUnits !== 80 || expired?.quotaResetAt !== "") {
    throw new Error("expired quota lockout did not restore local budget");
  }
  console.log("[validate-quota-parser] ok expired quota restore");

  await writeFile(runtimeFile, JSON.stringify({
    version: 1,
    accounts: [
      {
        id: "locked-claude",
        provider: "claude",
        plan: "pro",
        loginLabel: "locked",
        sessionStatus: "ready",
        remainingUnits: 0,
        weeklyUnits: 100,
        quotaResetAt: "2026-05-17T21:00:00.000Z",
        quotaReason: "active quota",
      },
    ],
    projects: [],
    activeRun: null,
    runHistory: [],
    pendingRuns: [
      {
        id: "pending-locked",
        queuedAt: "2026-05-13T00:00:00.000Z",
        workerId: "claude-code",
        projectId: "current",
        prompt: "do not run",
        complexity: "standard",
        modelOverride: "auto",
        provider: "claude",
      },
    ],
    settings: {},
  }, null, 2), "utf8");

  await setAccountSession({ id: "locked-claude", sessionStatus: "ready" });
  const afterReady = await readRuntime();
  const locked = afterReady.accounts.find((account) => account.id === "locked-claude");
  if (locked?.quotaResetAt !== "2026-05-17T21:00:00.000Z") {
    throw new Error("active quota lockout was cleared by ready transition");
  }
  console.log("[validate-quota-parser] ok active quota preserved on ready");

  const dispatched = await dispatchPendingForAccount("locked-claude");
  if (dispatched.dispatched !== 0) {
    throw new Error("active quota account dispatched pending work");
  }
  const afterDispatch = await readRuntime();
  if ((afterDispatch.pendingRuns || []).length !== 1) {
    throw new Error("pending work was removed for active quota account");
  }
  console.log("[validate-quota-parser] ok active quota blocks pending dispatch");

  const lastMessagePath = path.join(tempDir, "last-message.txt");
  await writeFile(lastMessagePath, "CHAIN_DONE\n", "utf8");
  await writeFile(runtimeFile, JSON.stringify({
    version: 1,
    accounts: [],
    projects: [],
    activeRun: {
      id: "stale-run",
      status: "running",
      workerId: "codex",
      projectId: "current",
      startedAt: "2026-05-13T00:00:00.000Z",
      adapter: {
        status: "running",
        pid: 999999,
        lastMessagePath,
      },
      events: [],
    },
    runHistory: [
      {
        id: "stale-run",
        status: "running",
        workerId: "codex",
        projectId: "current",
        startedAt: "2026-05-13T00:00:00.000Z",
        adapter: {
          status: "running",
          pid: 999999,
          lastMessagePath,
        },
        events: [],
      },
    ],
    pendingRuns: [],
    settings: {},
  }, null, 2), "utf8");

  const afterStale = await readRuntime();
  const staleRun = afterStale.runHistory.find((run) => run.id === "stale-run");
  if (afterStale.activeRun || staleRun?.status !== "completed" || staleRun?.adapter?.lastMessageText !== "CHAIN_DONE") {
    throw new Error("stale active run was not completed from last-message");
  }
  console.log("[validate-quota-parser] ok stale active run cleanup");

  const dirtyRepo = path.join(tempDir, "dirty-repo");
  await mkdir(dirtyRepo, { recursive: true });
  spawnSync("git", ["init"], { cwd: dirtyRepo, stdio: "ignore" });
  await writeFile(path.join(dirtyRepo, "leftover.txt"), "partial\n", "utf8");
  const dirtyLastMessagePath = path.join(tempDir, "dirty-last-message.txt");
  await writeFile(dirtyLastMessagePath, "CHAIN_DONE\n", "utf8");
  await writeFile(runtimeFile, JSON.stringify({
    version: 1,
    accounts: [],
    projects: [{ id: "dirty-project", name: "dirty", path: dirtyRepo }],
    activeRun: {
      id: "dirty-stale-run",
      status: "running",
      workerId: "codex",
      projectId: "dirty-project",
      startedAt: "2026-05-13T00:00:00.000Z",
      adapter: {
        status: "running",
        pid: 999999,
        lastMessagePath: dirtyLastMessagePath,
      },
      events: [],
    },
    runHistory: [
      {
        id: "dirty-stale-run",
        status: "running",
        workerId: "codex",
        projectId: "dirty-project",
        startedAt: "2026-05-13T00:00:00.000Z",
        adapter: {
          status: "running",
          pid: 999999,
          lastMessagePath: dirtyLastMessagePath,
        },
        events: [],
      },
    ],
    pendingRuns: [],
    settings: {},
  }, null, 2), "utf8");

  const afterDirtyStale = await readRuntime();
  const dirtyStaleRun = afterDirtyStale.runHistory.find((run) => run.id === "dirty-stale-run");
  if (
    afterDirtyStale.activeRun
    || dirtyStaleRun?.status !== "needs_user"
    || dirtyStaleRun?.interruptedWorktree?.fileCount !== 1
  ) {
    throw new Error("dirty stale active run was not marked for review");
  }
  console.log("[validate-quota-parser] ok dirty stale run needs review");

  // ---- startRun activeRun 가드 ----
  // 같은 프로젝트에 살아 있는 activeRun 위에 일반 startRun 이 또 들어오면
  // 거절돼야 한다 (file/git/memory 충돌 방지). 다른 프로젝트는 동시 허용.
  // continuation flag (autoChain/retryCount/pendingId/handoffFrom/autoDispatched)
  // 가 없는 호출만 가드 대상.
  await writeFile(runtimeFile, JSON.stringify({
    version: 1,
    accounts: [
      {
        id: "ready-claude",
        provider: "claude",
        plan: "pro",
        loginLabel: "ready",
        sessionStatus: "ready",
        remainingUnits: 50,
        weeklyUnits: 100,
      },
    ],
    projects: [],
    activeRun: {
      id: "running-run",
      status: "running",
      workerId: "claude-code",
      projectId: "current",
      prompt: "long task",
      startedAt: "2026-05-13T00:00:00.000Z",
      // 살아 있는 PID 가 필요하다 (readRuntime 의 reconcileStaleActiveRun 이
      // 죽은 PID 면 activeRun 을 자동 정리해 가드가 작동할 기회조차 없어진다).
      adapter: { status: "running", pid: process.pid, mode: "runner" },
      routing: { status: "recommended", accountId: "ready-claude", provider: "claude" },
    },
    activeRuns: [
      {
        id: "running-run",
        status: "running",
        workerId: "claude-code",
        projectId: "current",
        prompt: "long task",
        startedAt: "2026-05-13T00:00:00.000Z",
        adapter: { status: "running", pid: process.pid, mode: "runner" },
        routing: { status: "recommended", accountId: "ready-claude", provider: "claude" },
      },
    ],
    runHistory: [],
    pendingRuns: [],
    settings: {},
  }, null, 2), "utf8");

  // 같은 프로젝트 ("current") 로 한 번 더 startRun → 거절돼야 함.
  const rejectAttempt = await startRun({
    workerId: "claude-code",
    projectId: "current",
    prompt: "concurrent attempt",
    complexity: "standard",
  });
  if (!rejectAttempt.startRejected || rejectAttempt.startRejected.reason !== "active_run_running_for_project") {
    throw new Error(`startRun did not block concurrent run on same project; got ${JSON.stringify(rejectAttempt.startRejected)}`);
  }
  console.log("[validate-quota-parser] ok startRun blocks concurrent run on same project");

  // ---- CHAIN_DONE 기본 동작 = stop ----
  // settings.autoChainOverrideOnChainDone 가 꺼져 있으면 진행률이 99% 라도
  // CHAIN_DONE 신호를 받으면 무조건 stop.
  await writeFile(runtimeFile, JSON.stringify({
    version: 1,
    accounts: [],
    projects: [],
    activeRun: null,
    runHistory: [],
    pendingRuns: [],
    settings: { autoChainEnabled: true, autoChainOverrideOnChainDone: false },
  }, null, 2), "utf8");
  const chainResult = await tryAutoChain(
    {
      id: "done-run",
      workerId: "claude-code",
      projectId: "current",
      prompt: "earlier task",
      chainDepth: 0,
      chainDoneOverrides: 0,
    },
    { chainDoneSignaled: true, lastMessage: "작업 완료했습니다.\nCHAIN_DONE" },
  );
  if (!chainResult || !chainResult.stopped) {
    throw new Error("CHAIN_DONE was not honored by default (override flag off)");
  }
  console.log("[validate-quota-parser] ok CHAIN_DONE honored by default");

  // ---- Claude stream-json 파서 ----
  const streamCases = [
    {
      name: "system init line is human-friendly",
      input: JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-4-5", tools: ["Read", "Edit"] }),
      assert: (out) => out.display && out.display.includes("Claude Code 세션 시작") && !out.skip,
    },
    {
      name: "assistant text becomes 💬 line",
      input: JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reading the config file" }] } }),
      assert: (out) => out.display && out.display.startsWith("💬"),
    },
    {
      name: "tool_use surfaces tool name and target",
      input: JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "src/main.tsx" } }] } }),
      assert: (out) => out.display && out.display.includes("🔧 Read(src/main.tsx)"),
    },
    {
      name: "tool_result error becomes ⚠ line",
      input: JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "File not found" }] } }),
      assert: (out) => out.display && out.display.includes("⚠ tool 결과 오류"),
    },
    {
      name: "result event exposes finalText and stats",
      input: JSON.stringify({ type: "result", subtype: "success", num_turns: 5, duration_ms: 12000, total_cost_usd: 0.0234, result: "Final answer" }),
      assert: (out) => out.finalText === "Final answer" && out.display.includes("5턴") && out.display.includes("12초"),
    },
    {
      name: "non-JSON line is kept as-is",
      input: "plain text line",
      assert: (out) => out.keep === true,
    },
  ];
  for (const tc of streamCases) {
    const out = interpretClaudeStreamLine(tc.input);
    if (!tc.assert(out)) {
      throw new Error(`stream-json parser failed: ${tc.name}: ${JSON.stringify(out)}`);
    }
    console.log(`[validate-quota-parser] ok claude stream-json: ${tc.name}`);
  }
} finally {
  Date.now = realDateNow;
  await rm(tempDir, { recursive: true, force: true });
}

console.log("[validate-quota-parser] done");
