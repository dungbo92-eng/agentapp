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
} finally {
  Date.now = realDateNow;
  await rm(tempDir, { recursive: true, force: true });
}

console.log("[validate-quota-parser] done");
