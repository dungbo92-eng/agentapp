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
  // 교차곱: 계정 2 × 프로젝트 2 = 4 세션(각 계정이 모든 프로젝트에 대해 세션). 라운드로빈 아님.
  const a = [{ id: "acc1" }, { id: "acc2" }];
  const p = [{ id: "pA" }, { id: "pB" }];
  const cross = rt.buildRemoteControlTargets(a, p);
  check("cross product count = accounts*projects", cross.length === 4);
  check("cross product acc1 has both projects", cross.filter((t) => t.account.id === "acc1").map((t) => t.project.id).sort().join(",") === "pA,pB");
  check("cross product acc2 has both projects", cross.filter((t) => t.account.id === "acc2").map((t) => t.project.id).sort().join(",") === "pA,pB");
  check("no projects → one per account (fallback)", rt.buildRemoteControlTargets(a, []).length === 2 && rt.buildRemoteControlTargets(a, []).every((t) => t.project === null));
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

  // ---- Claude 자격증명 검사 (ready 오탐 방지) ----
  // 미로그인 프로필에서 claude 를 실행하면 토큰이 빈 .credentials.json 이 생긴다.
  // 이걸 ready 로 오탐하면 RC 가 숨긴 콘솔의 로그인 프롬프트에 걸려 폰에 세션이 안 뜬다.
  check("readClaudeCredentialState is exported", typeof rt.readClaudeCredentialState === "function");
  const NOW = 1_800_000_000_000; // 고정 시각
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const parse = rt.parseClaudeCredentialState;
  const why = (cred) => rt.claudeCredentialRejectReason(cred, NOW);

  check("parse null → null", parse(null) === null);
  check("parse without claudeAiOauth → null", parse({ foo: 1 }) === null);

  // 실제 버그 재현: accessToken/refreshToken 빈 문자열 + expiresAt 0.
  const stub = parse({ claudeAiOauth: { accessToken: "", refreshToken: "", expiresAt: 0, scopes: ["user:inference"] } });
  check("stub parsed: no tokens", stub.hasAccessToken === false && stub.hasRefreshToken === false && stub.expiresAt === 0);
  check("REGRESSION: empty-token stub is rejected (was false-ready)", why(stub).includes("로그인 미완료"));

  const valid = parse({ claudeAiOauth: { accessToken: "a".repeat(108), refreshToken: "r".repeat(108), expiresAt: NOW + HOUR } });
  check("valid token → accepted", why(valid) === "");

  // access 만료 + refresh 보유 → claude 가 갱신하므로 통과.
  const refreshable = parse({ claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: NOW - HOUR } });
  check("expired access with refresh token → accepted", why(refreshable) === "");

  // refresh 없이 access 만료 → 회복 불가.
  const deadNoRefresh = parse({ claudeAiOauth: { accessToken: "a", refreshToken: "", expiresAt: NOW - HOUR } });
  check("expired access without refresh → rejected", why(deadNoRefresh).includes("refresh 토큰이 없습니다"));

  // refresh 토큰 자체가 만료.
  const deadRefresh = parse({ claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: NOW + HOUR, refreshTokenExpiresAt: NOW - DAY } });
  check("expired refresh token → rejected", why(deadRefresh).includes("refresh 토큰이"));

  // 만료 정보가 없고 refresh 도 없음.
  const noExpiry = parse({ claudeAiOauth: { accessToken: "a", refreshToken: "", expiresAt: 0 } });
  check("no expiry + no refresh → rejected", why(noExpiry).includes("만료 정보가 없습니다"));

  // 7일 넘게 만료된 프로필은 refresh 가 있어도 재로그인 (기존 grace 유지).
  const stale = parse({ claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: NOW - 8 * DAY } });
  check("expired > 7d → rejected even with refresh", why(stale) !== "");

  check("null cred → rejected", why(null).includes("읽을 수 없습니다"));

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
