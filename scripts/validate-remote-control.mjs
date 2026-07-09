#!/usr/bin/env node

// Claude Remote Control wiring 검증. 임시 데이터/세션 dir 로 실제 claude 실행 없이
// 설정 기본값 + buildRemoteControlSpec(계정별 실행 스펙)만 결정적으로 검사한다.
// spawnRemoteControlConsole 은 실제 claude 세션을 띄우므로 여기서 실행하지 않는다.

import { mkdtemp, rm, readFile } from "node:fs/promises";
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
  check("listRemoteControlTargets [] when no accounts", (await rt.listRemoteControlTargets()).length === 0);
  check("spawnRemoteControlConsole is exported", typeof wl.spawnRemoteControlConsole === "function");
  check("buildRemoteControlLaunchScript is exported", typeof wl.buildRemoteControlLaunchScript === "function");

  const spec = await wl.buildRemoteControlSpec({ id: "acct1", email: "a@b.com", sessionProfile: "claude-code-acct1" });
  check("spec ready", spec.status === "ready");
  check("spec command resolved from env", spec.command === execPath);
  check("spec args = --remote-control <name>", spec.args[0] === "--remote-control" && spec.args.length === 2);
  check("spec name from email", spec.args[1] === "a@b.com");
  check("spec CLAUDE_CONFIG_DIR under profiles root", String(spec.env.CLAUDE_CONFIG_DIR).startsWith(profDir));
  check("spec cwd set", typeof spec.cwd === "string" && spec.cwd.length > 0);

  const spec2 = await wl.buildRemoteControlSpec({ id: "acct2" }, { name: "phone-2" });
  check("name override", spec2.args[1] === "phone-2");

  // 프로젝트 경로별 세션: workspace override 로 cwd(작업 경로)를 지정한다.
  // cwd 는 claude 신뢰 키와 통일하려고 normalizeClaudeCwd(forward-slash) 로 정규화된다.
  const spec3 = await wl.buildRemoteControlSpec({ id: "acct3" }, { name: "proj-a", workspace: profDir });
  check("workspace override sets cwd (normalized)", spec3.cwd === wl.normalizeClaudeCwd(profDir));
  check("workspace override sets name", spec3.args[1] === "proj-a");

  // 창 없이 띄우는 PowerShell 스크립트 — 숨김/PassThru/작업경로/env 가 모두 들어가야 한다.
  const script = wl.buildRemoteControlLaunchScript(spec3);
  check("launch script Start-Process", script.includes("Start-Process"));
  check("launch script hidden window", script.includes("-WindowStyle Hidden"));
  check("launch script PassThru", script.includes("-PassThru"));
  check("launch script prints pid", script.includes("$p.Id"));
  check("launch script sets working dir", script.includes("-WorkingDirectory"));
  check("launch script sets CLAUDE_CONFIG_DIR env", script.includes("$env:CLAUDE_CONFIG_DIR="));
  check("launch script escapes single quotes", wl.buildRemoteControlLaunchScript({ command: "c", args: ["it's"], env: {}, cwd: "x" }).includes("'it''s'"));
  // 공백 포함 인자(프로젝트명 등)는 큰따옴표로 묶여야 Start-Process 재파싱에서 안 쪼개진다.
  const spaceScript = wl.buildRemoteControlLaunchScript({ command: "c", args: ["--remote-control", "My Project"], env: {}, cwd: "x" });
  check("launch script quotes spaced arg", spaceScript.includes('"My Project"'));
  check("updateProject is exported", typeof rt.updateProject === "function");

  // 폴더 신뢰 사전 처리 — 미신뢰 폴더에서 숨긴 RC 가 trust 대화상자에 걸려 폰 등록이
  // 안 되는 문제를 막는다. 키 형식은 claude 관측값(forward-slash + 드라이브 대문자)과 일치해야 한다.
  if (process.platform === "win32") {
    check("normalizeClaudeCwd → forward-slash uppercase drive", wl.normalizeClaudeCwd("e:\\Foo\\Bar") === "E:/Foo/Bar");
  }
  const trustCfg = await mkdtemp(path.join(tmpdir(), "agentapp-rc-cfg-"));
  try {
    check("ensureClaudeFolderTrusted returns true", (await wl.ensureClaudeFolderTrusted(trustCfg, "E:/agentApp")) === true);
    const cfgJson = JSON.parse(await readFile(path.join(trustCfg, ".claude.json"), "utf8"));
    check("trust written under exact claude key", cfgJson.projects["E:/agentApp"]?.hasTrustDialogAccepted === true);
    // 멱등성: 이미 신뢰된 폴더는 그대로 true 반환.
    check("ensureClaudeFolderTrusted idempotent", (await wl.ensureClaudeFolderTrusted(trustCfg, "E:/agentApp")) === true);
  } finally {
    await rm(trustCfg, { recursive: true, force: true });
  }
} finally {
  await rm(dataDir, { recursive: true, force: true });
  await rm(profDir, { recursive: true, force: true });
}

console.log(`[validate-remote-control] done (${failures} failure(s))`);
if (failures > 0) process.exit(1);
