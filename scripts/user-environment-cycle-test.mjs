#!/usr/bin/env node

import {
  detectAndUpdateAccount,
  readRuntime,
  selectRoute,
  startRun,
  stopRun,
} from "./dashboard-runtime.mjs";

const HELP = `Usage:
  pnpm agent:cycle-test
  pnpm agent:cycle-test -- --worker codex --execute --timeout-ms 120000

Runs a dashboard-cycle readiness probe. Without --execute it only checks routing.
With --execute it starts one local dashboard run, waits for a terminal state, and
stops the run on timeout. It does not log in, switch accounts, bypass approvals,
or store secrets.
`;

const TERMINAL_STATUSES = new Set([
  "blocked",
  "completed",
  "failed",
  "needs_user",
  "quota_limited",
  "stopped",
]);

function parseArgs(argv) {
  const options = {
    worker: "codex",
    project: "current",
    complexity: "routine",
    modelOverride: "auto",
    prompt: "AgentApp dashboard integration smoke test. Do not edit files. Reply with: AgentApp cycle ok.",
    execute: false,
    timeoutMs: 120000,
    json: false,
    strict: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--worker") {
      options.worker = argv[index + 1] || options.worker;
      index += 1;
    } else if (arg === "--project") {
      options.project = argv[index + 1] || options.project;
      index += 1;
    } else if (arg === "--complexity") {
      options.complexity = argv[index + 1] || options.complexity;
      index += 1;
    } else if (arg === "--model") {
      options.modelOverride = argv[index + 1] || options.modelOverride;
      index += 1;
    } else if (arg === "--prompt") {
      options.prompt = argv[index + 1] || options.prompt;
      index += 1;
    } else if (arg === "--execute") {
      options.execute = true;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Math.max(10000, Number(argv[index + 1] || options.timeoutMs));
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeId(value) {
  const text = String(value || "");
  if (text.length <= 6) return text || "none";
  return `${text.slice(0, 3)}...${text.slice(-2)}`;
}

function summarizeRoute(route) {
  if (route.status === "recommended") {
    return `${route.provider}/local-account ${route.model} ${route.reasoningEffort} estimated=${route.estimatedUnits}`;
  }
  return route.reason || "route blocked";
}

function publicRoute(route) {
  if (route.status !== "recommended") return route;
  return {
    ...route,
    accountId: "local-account",
    loginLabel: "local-account",
    sessionProfile: "local-account",
  };
}

async function refreshSessions(runtime) {
  for (const account of runtime.accounts) {
    await detectAndUpdateAccount(account.id);
  }
  return readRuntime();
}

async function waitForRun(runId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const runtime = await readRuntime();
    const run =
      runtime.activeRun?.id === runId
        ? runtime.activeRun
        : runtime.runHistory.find((item) => item.id === runId) || null;
    if (run && TERMINAL_STATUSES.has(run.status)) return { runtime, run, timedOut: false };
    await sleep(2000);
  }

  await stopRun();
  const runtime = await readRuntime();
  const run = runtime.runHistory.find((item) => item.id === runId) || runtime.activeRun || null;
  return { runtime, run, timedOut: true };
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

let runtime = await refreshSessions(await readRuntime());
const route = selectRoute(runtime.accounts, {
  workerId: options.worker,
  complexity: options.complexity,
  modelOverride: options.modelOverride,
});

if (!options.execute) {
  const report = {
    status: route.status === "recommended" ? "ready" : "blocked",
    execute: false,
    worker: options.worker,
    route: publicRoute(route),
    summary: summarizeRoute(route),
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[cycle-test] status=${report.status}`);
    console.log(`[cycle-test] worker=${options.worker}`);
    console.log(`[cycle-test] route=${report.summary}`);
    console.log("[cycle-test] add --execute to run one real dashboard worker cycle.");
  }
  if (options.strict && report.status !== "ready") process.exit(1);
  process.exit(0);
}

if (route.status !== "recommended") {
  const report = {
    status: "blocked",
    execute: true,
    worker: options.worker,
    route: publicRoute(route),
    summary: summarizeRoute(route),
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log("[cycle-test] status=blocked");
    console.log(`[cycle-test] route=${report.summary}`);
  }
  process.exit(options.strict ? 1 : 0);
}

runtime = await startRun({
  workerId: options.worker,
  projectId: options.project,
  prompt: options.prompt,
  complexity: options.complexity,
  modelOverride: options.modelOverride,
});

const run = runtime.activeRun || runtime.runHistory[0];
if (!run) {
  console.log("[cycle-test] status=failed");
  console.log("[cycle-test] no run record was created");
  process.exit(1);
}

const result = await waitForRun(run.id, options.timeoutMs);
const report = {
  status: result.timedOut ? "timeout_stopped" : result.run?.status || "unknown",
  execute: true,
  worker: options.worker,
  runId: run.id,
  validation: result.run?.validation?.status || "",
  adapter: result.run?.adapter?.status || "",
  handoffPath: result.run?.handoffPath || "",
};

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[cycle-test] status=${report.status}`);
  console.log(`[cycle-test] run=${report.runId}`);
  console.log(`[cycle-test] validation=${report.validation || "n/a"}`);
  console.log(`[cycle-test] adapter=${report.adapter || "n/a"}`);
  if (report.handoffPath) console.log(`[cycle-test] handoff=${report.handoffPath}`);
}

if (options.strict && report.status !== "completed") {
  process.exit(1);
}
