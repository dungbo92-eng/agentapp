// End-to-end 검증 — dashboard server 를 임시 디렉토리에서 띄우고 주요 API
// (snapshot, settings, startRun → finishRun → autoChain 흐름) 응답을 점검.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP_DIR = path.join(REPO_ROOT, ".tmp-e2e-test");
const DATA_DIR = path.join(TMP_DIR, "data");
const HANDOFF_DIR = path.join(TMP_DIR, "handoff");

process.env.AGENTAPP_DATA_DIR = DATA_DIR;
process.env.AGENTAPP_HANDOFF_DIR = HANDOFF_DIR;

await rm(TMP_DIR, { recursive: true, force: true });
await mkdir(DATA_DIR, { recursive: true });
await mkdir(HANDOFF_DIR, { recursive: true });

const { createDashboardServer } = await import("./dashboard-server.mjs");
const { writeRuntime, finishRunRecord, tryAutoChain, startRun, readRuntime } = await import("./dashboard-runtime.mjs");

// 1) 초기 runtime 세팅 — ready 계정 + 프로젝트.
await writeRuntime({
  version: 1,
  accounts: [
    {
      id: "codex-test-a",
      provider: "codex",
      plan: "plus",
      loginLabel: "test-a",
      sessionStatus: "ready",
      enabled: true,
      remainingUnits: 100,
      weeklyUnits: 100,
      authMethod: "google",
      sessionProfile: "codex/test-a",
    },
  ],
  projects: [
    { id: "proj-e2e", name: "E2E", path: REPO_ROOT, lastModel: "", lastWorker: "" },
  ],
  activeRun: null,
  activeRuns: [],
  runHistory: [],
  pendingRuns: [],
  settings: {
    autoChainEnabled: true,
    autoChainMaxDepth: 8,
    quotaRetryEnabled: true,
    notifyEnabled: true,
  },
  notifications: [],
});

const checks = [];

// 2) 서버 부팅.
const server = await createDashboardServer({ host: "127.0.0.1", lanAccessToken: "" });
checks.push({ step: "server_boot", ok: !!server?.url, info: server?.url || "no url" });

// 3) runtime endpoint.
try {
  const res = await fetch(`${server.url.replace(/\/$/, "")}/api/agentapp/runtime`);
  const json = await res.json();
  const ok = res.ok && typeof json === "object" && Array.isArray(json.accounts);
  checks.push({ step: "GET /api/agentapp/runtime", ok, info: ok ? `accounts=${json.accounts.length} projects=${(json.projects || []).length}` : `status=${res.status}` });
} catch (error) {
  checks.push({ step: "GET /api/agentapp/runtime", ok: false, info: error?.message || String(error) });
}

// 4) startRun via API — 가짜 worker spawn 없이 routing 까지만 확인.
//    실제 worker spawn 은 environment dependent (CLI presence) 라서 직접 dashboard-runtime
//    함수 호출로 라우팅 결과만 확인.
let createdRunId = "";
try {
  const result = await startRun({
    workerId: "auto",
    projectId: "proj-e2e",
    prompt: "[검증] simple e2e test",
    complexity: "auto",
    modelOverride: "auto",
  });
  const active = result?.activeRun || (result?.activeRuns?.[0]) || null;
  createdRunId = active?.id || "";
  // Note: worker spawn 은 background 에서 진행되지만 외부 CLI 가 없으면 어댑터가 blocked 로 끝남.
  checks.push({
    step: "startRun routing",
    ok: Boolean(active?.id) && active.routing?.status === "recommended",
    info: active ? `id=${active.id} routing=${active.routing?.status} provider=${active.routing?.provider}` : "no active",
  });
} catch (error) {
  checks.push({ step: "startRun routing", ok: false, info: error?.message || String(error) });
}

// 5) finishRunRecord — 강제 완료 처리 후 history 에 들어가는지.
if (createdRunId) {
  try {
    await finishRunRecord(createdRunId, { status: "completed", completedAt: new Date().toISOString() }, { handoffStatus: "completed", handoffReason: "completed" });
    const rt = await readRuntime();
    const inHistory = rt.runHistory?.some((r) => r.id === createdRunId && r.status === "completed");
    checks.push({ step: "finishRunRecord → history", ok: Boolean(inHistory), info: inHistory ? "moved to history" : "missing in history" });
  } catch (error) {
    checks.push({ step: "finishRunRecord → history", ok: false, info: error?.message || String(error) });
  }

  // 6) tryAutoChain — settings.autoChainEnabled=true, 새 run 이 만들어지는지 (worker spawn 은 별개).
  try {
    const rt = await readRuntime();
    const prev = rt.runHistory?.find((r) => r.id === createdRunId);
    const chained = await tryAutoChain(prev, { chainDoneSignaled: false, lastMessage: "" });
    // tryAutoChain 이 새 run 을 반환하면 success, 아니면 stop/skip/null.
    const ok = chained && !chained.stopped && !chained.skipped;
    checks.push({
      step: "tryAutoChain",
      ok: Boolean(ok),
      info: chained ? `result=${chained.id ? "new_run id=" + chained.id : (chained.stopped ? "stopped: " + chained.reason : chained.skipped ? "skipped: " + chained.reason : "no_id")}` : "null",
    });
    // tryAutoChain 가 만든 새 run 이 runtime 에 정상 등록됐는지 (race fix 검증).
    if (chained?.id) {
      const rt2 = await readRuntime();
      const found = rt2.runHistory?.find((r) => r.id === chained.id);
      const hasWorker = found?.workerId && found.workerId !== "";
      const hasProject = found?.projectId && found.projectId !== "";
      checks.push({
        step: "tryAutoChain run preserved in runtime",
        ok: Boolean(found) && hasWorker && hasProject,
        info: found ? `id=${found.id} status=${found.status} worker=${found.workerId} project=${found.projectId} recovered=${found.recovered}` : "not found (stub or lost)",
      });
    }
  } catch (error) {
    checks.push({ step: "tryAutoChain", ok: false, info: error?.message || String(error) });
  }
}

// 7) settings via runtime endpoint.
try {
  const res = await fetch(`${server.url.replace(/\/$/, "")}/api/agentapp/runtime`);
  const json = await res.json();
  const ok = res.ok && typeof json?.settings?.autoChainEnabled === "boolean";
  checks.push({ step: "settings in runtime endpoint", ok, info: ok ? `autoChainEnabled=${json.settings.autoChainEnabled} notifyEnabled=${json.settings.notifyEnabled}` : "missing" });
} catch (error) {
  checks.push({ step: "settings in runtime endpoint", ok: false, info: error?.message || String(error) });
}

// 정리.
try { server?.server?.close?.(); } catch { /* ignore */ }
await new Promise((r) => setTimeout(r, 200));
await rm(TMP_DIR, { recursive: true, force: true });

const allOk = checks.every((c) => c.ok);
if (allOk) {
  console.log(`[validate-e2e-server] ok ${checks.length} checks: ${checks.map((c) => c.step).join(", ")}`);
  process.exit(0);
}
console.error("[validate-e2e-server] FAIL");
console.error(JSON.stringify({ ok: false, checks }, null, 2));
process.exit(1);
