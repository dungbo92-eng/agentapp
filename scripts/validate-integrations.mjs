#!/usr/bin/env node

// 외부 도구 통합 wiring 회귀 검증.
// - applyPonytailPreamble: off/lite/full + 멱등성
// - registerCodebaseMemoryMcp: claude/codex/gemini 세션 프로필 등록 + codex 멱등성

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPonytailPreamble } from "./dashboard-runtime.mjs";
import { registerCodebaseMemoryMcp } from "./worker-launch-adapter.mjs";

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`[validate-integrations] ok ${name}`);
  else { console.error(`[validate-integrations] FAIL ${name}`); failures += 1; }
}

// --- ponytail ---
check("ponytail off = unchanged", applyPonytailPreamble("TASK", "off") === "TASK");
const lite = applyPonytailPreamble("TASK", "lite");
check("ponytail lite prepends marker", lite.startsWith("[PONYTAIL 규칙]") && lite.endsWith("TASK"));
const full = applyPonytailPreamble("TASK", "full");
check("ponytail full has YAGNI rule", full.includes("YAGNI") && full.includes("TASK"));
check("ponytail idempotent", applyPonytailPreamble(lite, "lite") === lite);
check("ponytail unknown mode = off", applyPonytailPreamble("TASK", "bogus") === "TASK");

// --- codebase-memory MCP 등록 ---
const dir = await mkdtemp(path.join(tmpdir(), "agentapp-integrations-"));
const bin = "C:\\tools\\codebase-memory-mcp.exe";
try {
  const claudeCfg = await registerCodebaseMemoryMcp("claude-code", dir, bin);
  const claudeJson = JSON.parse(await readFile(claudeCfg, "utf8"));
  check("claude returns mcp-config path", claudeCfg.endsWith("codebase-memory.mcp.json"));
  check("claude json registers server", claudeJson.mcpServers["codebase-memory"].command === bin);

  await registerCodebaseMemoryMcp("codex", dir, bin);
  let toml = await readFile(path.join(dir, "config.toml"), "utf8");
  check("codex writes mcp_servers block", toml.includes("[mcp_servers.codebase-memory]"));
  check("codex escapes path as valid string", toml.includes('command = "C:\\\\tools\\\\codebase-memory-mcp.exe"'));
  // 멱등: 두 번째 호출은 블록을 중복 추가하지 않는다.
  await registerCodebaseMemoryMcp("codex", dir, bin);
  toml = await readFile(path.join(dir, "config.toml"), "utf8");
  check("codex idempotent", (toml.match(/\[mcp_servers\.codebase-memory\]/g) || []).length === 1);

  await registerCodebaseMemoryMcp("gemini-cli", dir, bin);
  const gem = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
  check("gemini settings registers server", gem.mcpServers["codebase-memory"].command === bin);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`[validate-integrations] done (${failures} failure(s))`);
if (failures > 0) process.exit(1);
