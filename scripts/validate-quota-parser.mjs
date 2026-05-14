#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const fixedNow = Date.parse("2026-05-13T00:00:00.000Z");
const realDateNow = Date.now;
const tempDir = path.join(os.tmpdir(), `agentapp-quota-validate-${realDateNow()}`);

await mkdir(tempDir, { recursive: true });
process.env.AGENTAPP_DATA_DIR = tempDir;

const {
  dispatchPendingForAccount,
  parseQuotaReset,
  readRuntime,
  setAccountSession,
} = await import("./dashboard-runtime.mjs");
const { detectInterruption } = await import("./worker-launch-adapter.mjs");

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
} finally {
  Date.now = realDateNow;
  await rm(tempDir, { recursive: true, force: true });
}

console.log("[validate-quota-parser] done");
