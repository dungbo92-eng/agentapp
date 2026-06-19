#!/usr/bin/env node

// Ponytail 룰을 worker 프롬프트 프리앰블로 합성한다. 기본은 dry-run(출력만).
// 실제 worker 주입은 dashboard-runtime.mjs(데스크탑 트리거 경로)에서 별도 적용한다.
// integrations/ponytail/INTEGRATION.md 참고.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULE_FILE = path.join(REPO_ROOT, "tools", "agent-orchestrator", "integrations", "ponytail", "ponytail.rule.md");
const MARKER = "[PONYTAIL 규칙]"; // 멱등 첨부 가드
const MODES = new Set(["off", "lite", "full"]);
const LITE = "코드 작성 전 YAGNI 사다리(필요? → stdlib → 네이티브 → 기존 의존성 → 한 줄 → 최소 구현). 검증/에러처리/보안/접근성은 최소화 대상 아님.";

function parseArgs(argv) {
  const options = { mode: "full", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") { options.json = true; continue; }
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (key in options) options[key] = value || "";
  }
  if (!MODES.has(options.mode)) options.mode = "full";
  return options;
}

// 프롬프트에 붙일 프리앰블을 만든다. 이미 마커가 있으면 그대로 둔다(멱등).
export async function composePonytailPreamble(prompt, mode = "full") {
  if (mode === "off") return prompt;
  if (prompt && prompt.includes(MARKER)) return prompt;
  const body = mode === "lite" ? LITE : (await readFile(RULE_FILE, "utf8")).trim();
  const block = `${MARKER}\n${body}\n${MARKER.replace("[", "[/")}`;
  return prompt ? `${block}\n\n${prompt}` : block;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const preamble = await composePonytailPreamble("", options.mode);
  if (options.json) {
    console.log(JSON.stringify({ mode: options.mode, marker: MARKER, dryRun: true, preamble }, null, 2));
    return;
  }
  console.log(`# Ponytail dry-run (mode=${options.mode}, 아무것도 쓰지 않음)\n`);
  console.log(preamble);
  console.log(`\n# 주입 지점: dashboard-runtime.mjs decorateAutoChainPrompt (Phase 13에서 적용)`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("integrate-ponytail.mjs")) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
