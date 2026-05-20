// 검증 스크립트 — readRuntime 의 reconcile-snapshot 쓰기가 잠금 안에서
// 직렬화되는지 시뮬레이션. v0.8.12 fix 가 race 를 막는지 확인.
//
// 시나리오:
// 1. 임시 데이터 디렉토리에 빈 runtime 생성.
// 2. startRun 흉내 — 새 run 을 writeRuntime 으로 50회 추가.
// 3. 동시에 NotificationDispatcher 폴링 흉내 — readRuntime 을 2ms 간격으로 50회 호출.
//    각 readRuntime 은 stale-active 정리 시 lock 안에서 snapshot 을 다시 쓴다.
// 4. 모든 호출 종료 후 disk 에 마지막으로 추가한 run 이 있는지 확인.
//
// race 가 있는 옛 코드: 가끔 마지막 추가 run 이 사라짐 (외부 read 의 snapshot 쓰기에 덮임).
// fix 후: 항상 마지막 run 보존.

import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP_DIR = path.join(REPO_ROOT, ".tmp-race-test");
const DATA_DIR = path.join(TMP_DIR, "data");
const HANDOFF_DIR = path.join(TMP_DIR, "handoff");

process.env.AGENTAPP_DATA_DIR = DATA_DIR;
process.env.AGENTAPP_HANDOFF_DIR = HANDOFF_DIR;

await rm(TMP_DIR, { recursive: true, force: true });
await mkdir(DATA_DIR, { recursive: true });
await mkdir(HANDOFF_DIR, { recursive: true });

// 동적 import 로 환경 변수 적용 후 모듈 로드.
const { appendRunEvent, readRuntime, writeRuntime } = await import("./dashboard-runtime.mjs");

// 초기 빈 runtime persist.
await writeRuntime({
  version: 1,
  accounts: [],
  projects: [{ id: "proj-test", path: REPO_ROOT, lastModel: "", lastWorker: "" }],
  activeRun: null,
  activeRuns: [],
  runHistory: [],
  pendingRuns: [],
  settings: {},
  notifications: [],
});

const RUN_COUNT = 50;
const POLL_COUNT = 80;

let lastWrittenId = "";

// startRun 흉내 — read + add new run + write.
async function fakeStartRun(i) {
  const runtime = await readRuntime();
  const run = {
    id: `race-run-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: "running",
    workerId: "test",
    projectId: "proj-test",
    startedAt: new Date().toISOString(),
    adapter: { status: "queued" },
    events: [],
    routing: {},
  };
  runtime.activeRuns = [run, ...(runtime.activeRuns || [])];
  runtime.activeRun = run;
  runtime.runHistory = [run, ...(runtime.runHistory || [])].slice(0, 100);
  await writeRuntime(runtime);
  lastWrittenId = run.id;
  return run.id;
}

// NotificationDispatcher 폴링 흉내 — read only.
async function fakePoll() {
  await readRuntime();
}

const errors = [];

// 실제 코드의 패턴: writer 는 직렬 (startRun → completion → autoChain → startRun ...).
// poller 는 별도 setInterval 로 병렬 read. 이 둘 사이의 race 가 v0.8.12 이전의 버그.
let pollerStop = false;
const pollerLoop = (async () => {
  while (!pollerStop) {
    try {
      await fakePoll();
    } catch (error) {
      errors.push(`poll: ${error?.message || error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
})();

const writtenIds = [];
for (let i = 0; i < RUN_COUNT; i += 1) {
  try {
    const id = await fakeStartRun(i);
    writtenIds.push(id);
  } catch (error) {
    errors.push(`startRun ${i}: ${error?.message || error}`);
  }
}

pollerStop = true;
await pollerLoop;

// 잠금이 비워질 때까지 짧게 대기 — readRuntime 안의 deferred snapshot 쓰기가 끝나도록.
await new Promise((resolve) => setTimeout(resolve, 500));

// 최종 상태 검증: disk 에 마지막으로 쓴 run id 가 보존돼야 함.
const finalRuntime = await readRuntime();
const allIdsInRuntime = new Set([
  ...(finalRuntime.activeRuns || []).map((r) => r?.id).filter(Boolean),
  ...(finalRuntime.runHistory || []).map((r) => r?.id).filter(Boolean),
]);

const verdict = allIdsInRuntime.has(lastWrittenId);

// 모든 race-run-* 가 history 또는 active 에 살아남았는지 누락 검출.
const ranIds = new Set();
for (const id of allIdsInRuntime) {
  if (id?.startsWith("race-run-")) ranIds.add(id);
}

const cleanup = async () => { await rm(TMP_DIR, { recursive: true, force: true }); };

// 직렬 writer 가 N개 썼다면 history 가 capped (100) 안이라면 전부 살아있어야 한다.
const missing = writtenIds.filter((id) => !allIdsInRuntime.has(id));
const report = {
  ok: verdict && errors.length === 0 && missing.length === 0,
  ranWrites: RUN_COUNT,
  preservedRunsInRuntime: ranIds.size,
  lastWrittenId,
  lastIdPreserved: verdict,
  missingCount: missing.length,
  missing: missing.slice(0, 5),
  errorCount: errors.length,
  errors: errors.slice(0, 5),
};

const staleRun = {
  id: `stale-cleanup-${Date.now()}`,
  status: "running",
  workerId: "test",
  projectId: "proj-test",
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  adapter: { status: "running", pid: 999999 },
  events: [],
};
await writeFile(path.join(DATA_DIR, "dashboard-runtime.json"), JSON.stringify({
  version: 1,
  accounts: [],
  projects: [{ id: "proj-test", path: TMP_DIR, lastModel: "", lastWorker: "" }],
  activeRun: staleRun,
  activeRuns: [staleRun],
  runHistory: [],
  pendingRuns: [],
  settings: {},
  notifications: [],
}, null, 2), "utf8");
await readRuntime();
const cleanupRuntime = JSON.parse(await readFile(path.join(DATA_DIR, "dashboard-runtime.json"), "utf8"));
const staleStillActive = Boolean(cleanupRuntime.activeRun?.id === staleRun.id)
  || (cleanupRuntime.activeRuns || []).some((run) => run?.id === staleRun.id);
const staleInHistory = (cleanupRuntime.runHistory || []).some((run) => run?.id === staleRun.id && run.status !== "running");
report.staleCleanupPersisted = !staleStillActive && staleInHistory;
report.ok = report.ok && report.staleCleanupPersisted;

const inlineRunnerRun = {
  id: `inline-runner-grace-${Date.now()}`,
  status: "running",
  workerId: "test",
  projectId: "proj-test",
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  adapter: { status: "launching", runnerPid: process.pid, inlineRunner: true },
  events: [],
};
await writeFile(path.join(DATA_DIR, "dashboard-runtime.json"), JSON.stringify({
  version: 1,
  accounts: [],
  projects: [{ id: "proj-test", path: TMP_DIR, lastModel: "", lastWorker: "" }],
  activeRun: inlineRunnerRun,
  activeRuns: [inlineRunnerRun],
  runHistory: [],
  pendingRuns: [],
  settings: {},
  notifications: [],
}, null, 2), "utf8");
const inlineRunnerRuntime = await readRuntime();
const inlineRunnerStillActive = Boolean(inlineRunnerRuntime.activeRun?.id === inlineRunnerRun.id)
  || (inlineRunnerRuntime.activeRuns || []).some((run) => run?.id === inlineRunnerRun.id);
report.inlineRunnerNoPidPreserved = inlineRunnerStillActive;
report.ok = report.ok && report.inlineRunnerNoPidPreserved;

const recoveredRunId = `lost-active-${Date.now()}`;
const recoveredDir = path.join(DATA_DIR, "worker-launches", recoveredRunId);
await mkdir(recoveredDir, { recursive: true });
await writeFile(path.join(recoveredDir, "metadata.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  runId: recoveredRunId,
  workerId: "codex",
  projectId: "proj-test",
  projectPath: TMP_DIR,
  accountId: "test-account",
  provider: "codex",
  model: "gpt-test",
  reasoningEffort: "medium",
  sessionProfile: "codex/test",
  mode: "command",
  promptPath: "worker-launches/lost-active/launch-prompt.md",
  launchLogPath: "worker-launches/lost-active/worker.log",
  validationLogPath: "worker-launches/lost-active/validate.log",
  lastMessagePath: "worker-launches/lost-active/last-message.txt",
  sessionDir: "session-profiles/codex/test",
}, null, 2), "utf8");
await appendRunEvent(recoveredRunId, { level: "info", message: "live event after record loss" });
const recoveredRuntime = await readRuntime();
const recoveredActive = (recoveredRuntime.activeRuns || []).find((run) => run?.id === recoveredRunId);
report.liveEventRecovery = Boolean(
  recoveredActive
  && recoveredActive.status === "running"
  && recoveredActive.workerId === "codex"
  && recoveredActive.projectId === "proj-test",
);
report.ok = report.ok && report.liveEventRecovery;

// 알림 큐 + 진단 로그 영속성 — normalizeRuntime 이 notifications / notifyDebugLog
// 키를 drop 하면 OS 알림이 영원히 안 뜨고 진단도 불가능했던 회귀 방어.
const { pushNotification, appendNotifyDebugLog } = await import("./dashboard-runtime.mjs");
await pushNotification({
  kind: "info",
  title: "regression-test",
  message: "notifications must survive a write cycle",
});
await appendNotifyDebugLog({ stage: "regression_test_probe", ok: true, detail: "should persist" });
// 한 번 더 write 사이클 강제 — pushNotification 내부 write 가 다음 normalize 에서
// drop 되는지 확인.
const probeRuntime = await readRuntime();
const writeSurvivalReport = {
  notificationsCount: Array.isArray(probeRuntime.notifications) ? probeRuntime.notifications.length : -1,
  notifyDebugLogCount: Array.isArray(probeRuntime.notifyDebugLog) ? probeRuntime.notifyDebugLog.length : -1,
  hasRegressionEntry: (probeRuntime.notifications || []).some((n) => n?.title === "regression-test"),
  hasDebugProbe: (probeRuntime.notifyDebugLog || []).some((d) => d?.stage === "regression_test_probe"),
};
report.notificationsPersisted = writeSurvivalReport.hasRegressionEntry && writeSurvivalReport.hasDebugProbe;
report.notificationsSurvival = writeSurvivalReport;
report.ok = report.ok && report.notificationsPersisted;

await cleanup();
if (report.ok) {
  console.log(`[validate-runtime-race] ok ${report.preservedRunsInRuntime}/${report.ranWrites} runs preserved under concurrent read load`);
  process.exit(0);
}
console.error("[validate-runtime-race] FAIL");
console.error(JSON.stringify(report, null, 2));
process.exit(1);
