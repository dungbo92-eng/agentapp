#!/usr/bin/env node

// Claude Remote Control wiring 검증. 임시 데이터/세션 dir 로 실제 claude 실행 없이
// 설정 기본값 + buildRemoteControlSpec(계정별 실행 스펙)만 결정적으로 검사한다.
// spawnRemoteControlConsole 은 실제 claude 세션을 띄우므로 여기서 실행하지 않는다.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execPath } from "node:process";

const dataDir = await mkdtemp(path.join(tmpdir(), "agentapp-rc-data-"));
const profDir = await mkdtemp(path.join(tmpdir(), "agentapp-rc-prof-"));
process.env.AGENTAPP_DATA_DIR = dataDir;
process.env.AGENTAPP_SESSION_PROFILES_DIR = profDir;
process.env.AGENTAPP_CLAUDE_COMMAND = execPath; // 실제 claude 없이 command 를 결정적으로 해석

const rt = await import("./dashboard-runtime.mjs");
const wl = await import("./worker-launch-adapter.mjs");

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`[validate-remote-control] ok ${name}`);
  else { console.error(`[validate-remote-control] FAIL ${name}`); failures += 1; }
};

try {
  check("remoteControlAutoStart default true", (await rt.getRuntimeSettings()).remoteControlAutoStart === true);
  check("listReadyClaudeAccounts [] when no accounts", (await rt.listReadyClaudeAccounts()).length === 0);
  check("spawnRemoteControlConsole is exported", typeof wl.spawnRemoteControlConsole === "function");

  const spec = await wl.buildRemoteControlSpec({ id: "acct1", email: "a@b.com", sessionProfile: "claude-code-acct1" });
  check("spec ready", spec.status === "ready");
  check("spec command resolved from env", spec.command === execPath);
  check("spec args = --remote-control <name>", spec.args[0] === "--remote-control" && spec.args.length === 2);
  check("spec name from email", spec.args[1] === "a@b.com");
  check("spec CLAUDE_CONFIG_DIR under profiles root", String(spec.env.CLAUDE_CONFIG_DIR).startsWith(profDir));
  check("spec cwd set", typeof spec.cwd === "string" && spec.cwd.length > 0);

  const spec2 = await wl.buildRemoteControlSpec({ id: "acct2" }, { name: "phone-2" });
  check("name override", spec2.args[1] === "phone-2");
} finally {
  await rm(dataDir, { recursive: true, force: true });
  await rm(profDir, { recursive: true, force: true });
}

console.log(`[validate-remote-control] done (${failures} failure(s))`);
if (failures > 0) process.exit(1);
