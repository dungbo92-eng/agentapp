#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = path.join(REPO_ROOT, "tools", "agent-orchestrator", "usage-budget.example.json");
const DECISIONS = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "DECISIONS_REQUIRED.md");

const COMPLEXITIES = new Set(["routine", "standard", "complex", "critical"]);
const RISKS = new Set(["low", "medium", "high"]);
const MODEL_RANK = {
  efficient: 1,
  balanced: 2,
  sonnet: 3,
  best_available: 4,
  opus: 5,
  other: 0
};

function parseArgs(argv) {
  const options = {
    config: DEFAULT_CONFIG,
    json: false,
    provider: "",
    complexity: "",
    risk: "",
    task: "",
    "write-decision": false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--write-decision") {
      options["write-decision"] = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      options.task = [options.task, arg].filter(Boolean).join(" ");
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;

    if (key in options) options[key] = value || "";
  }

  return options;
}

function usage() {
  console.error("usage: pnpm agent:route -- --task \"작업 설명\" [--complexity routine|standard|complex|critical] [--risk low|medium|high] [--provider claude|codex] [--json] [--write-decision]");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function inferComplexity(task, requested) {
  if (COMPLEXITIES.has(requested)) return requested;

  const text = task.toLowerCase();
  if (/운영|장애|보안|결제|비밀|데이터\s*손실|마이그레이션|critical/.test(text)) return "critical";
  if (/자동매매|ai\s*모델|모델\s*연동|아키텍처|설계|추론|복잡|보안\s*설계|complex/.test(text)) {
    return "complex";
  }
  if (/버그|구현|테스트|리팩터|수정|standard/.test(text)) return "standard";
  return "routine";
}

function inferRisk(task, requested, complexity) {
  if (RISKS.has(requested)) return requested;
  if (complexity === "critical") return "high";
  if (/운영|배포|결제|비밀|삭제|데이터|보안|장애/.test(task.toLowerCase())) return "high";
  if (complexity === "complex") return "medium";
  return "low";
}

function weekendReserve(config) {
  if (!config.weekend_reserve?.enabled) return 0;
  return Number(config.weekend_reserve.minimum_units || 0);
}

function totalRemaining(config) {
  return (config.accounts || []).reduce((sum, account) => sum + Number(account.remaining_units || 0), 0);
}

function candidateScore(candidate, complexity) {
  const profile = candidate.profile;
  const modelRank = MODEL_RANK[profile.model_tier] || 0;
  const remaining = Number(candidate.account.remaining_units || 0);
  const estimated = Number(profile.estimated_units || 0);

  if (complexity === "routine") {
    return remaining * 2 - estimated * 10 + modelRank;
  }

  if (complexity === "standard") {
    return modelRank * 20 + remaining - estimated * 2;
  }

  return modelRank * 100 + remaining - estimated;
}

function recommendationReason(complexity, risk, reserveOk) {
  if (!reserveOk && ["complex", "critical"].includes(complexity)) {
    return "복잡도/위험도가 높아 품질을 우선하지만 주말 예비분을 침범하므로 작업 분해 또는 사용자 확인이 필요함.";
  }
  if (complexity === "routine") {
    return "단순 숙지/설치/문서 작업은 예산 보존을 우선해 효율 모델을 추천함.";
  }
  if (complexity === "standard") {
    return "일반 구현/수정 작업은 품질과 예산의 균형이 필요해 balanced 또는 Sonnet급 프로필을 추천함.";
  }
  return "복잡한 설계/추론 작업은 장기 품질 리스크가 커서 최고 품질 모델과 높은 추론 강도를 우선함.";
}

function chooseModel(config, options) {
  const complexity = inferComplexity(options.task, options.complexity);
  const risk = inferRisk(options.task, options.risk, complexity);
  const provider = options.provider;
  const reserve = weekendReserve(config);
  const remainingBefore = totalRemaining(config);

  const candidates = (config.accounts || [])
    .filter((account) => !provider || account.provider === provider)
    .map((account) => ({ account, profile: account.model_profiles?.[complexity] }))
    .filter((candidate) => candidate.profile)
    .filter((candidate) => Number(candidate.account.remaining_units || 0) >= Number(candidate.profile.estimated_units || 0))
    .sort((left, right) => candidateScore(right, complexity) - candidateScore(left, complexity));

  if (candidates.length === 0) {
    return {
      status: "blocked",
      task: options.task,
      complexity,
      risk,
      provider: provider || "any",
      reason: "조건에 맞는 계정/모델 프로필이 없거나 남은 사용량이 예상 사용량보다 적음.",
      next: "작업을 더 작게 나누거나 DECISIONS_REQUIRED.md에 사용자 결정을 남긴다."
    };
  }

  const best = candidates[0];
  const estimated = Number(best.profile.estimated_units || 0);
  const remainingAfter = remainingBefore - estimated;
  const reserveOk = remainingAfter >= reserve;
  const needsConfirmation =
    !reserveOk && (config.routing?.require_confirmation_for || []).includes(complexity);

  return {
    status: needsConfirmation ? "needs_decision" : "recommended",
    task: options.task,
    complexity,
    risk,
    provider: best.account.provider,
    account_id: best.account.id,
    model_tier: best.profile.model_tier,
    reasoning_effort: best.profile.reasoning_effort,
    reason: recommendationReason(complexity, risk, reserveOk),
    budget: {
      estimated_units: estimated,
      total_remaining_before: remainingBefore,
      total_remaining_after: remainingAfter,
      weekend_reserve_units: reserve,
      weekend_reserve_ok: reserveOk
    },
    safety: {
      auth: best.account.auth,
      action: "recommendation_only",
      note: "자동 로그인, 자동 계정 전환, 제한 우회 없이 사용자가 정상 로그인된 세션에서 선택한다."
    }
  };
}

function compactDate() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function decisionId(result) {
  const suffix = `${result.complexity || "unknown"}-${(result.provider || "any").replace(/[^a-z0-9-]/gi, "-")}`;
  return `DEC-${compactDate()}-USAGE-${suffix}`.toUpperCase();
}

function decisionEntry(result) {
  const id = decisionId(result);
  const summary =
    result.status === "blocked"
      ? "조건에 맞는 계정/모델 프로필이 없거나 남은 사용량이 부족하다."
      : "추천 모델 실행 시 주말 예비 사용량을 침범한다.";

  return {
    id,
    markdown: `\n### ${id} — 사용량 예산 부족: ${result.task || "작업"}\n\n- Status: pending\n- Priority: high\n- Category: usage_budget\n- Requested by: agent\n- Blocks: ${result.task || "모델 라우팅 대상 작업"}\n- Context: ${summary}\n- Options:\n  - A: 작업을 탐색/설계/구현/검증 단계로 나누고 낮은 위험 단계부터 실행한다.\n  - B: 사용자가 이번 주 예산 사용을 승인한 뒤 최고 품질 모델로 진행한다.\n- Recommended: A. 제한 우회 없이 품질과 주말 예비분을 같이 지킨다.\n- Decision needed: 이 작업을 분해해서 진행할까, 예산 사용을 승인하고 진행할까?\n- After decision: agent:route 또는 agent:budget 결과를 다시 확인하고 NEXT_TASK를 갱신한다.\n- Created: ${new Date().toISOString().slice(0, 10)}\n`
  };
}

async function writeDecisionIfNeeded(result) {
  if (!["needs_decision", "blocked"].includes(result.status)) return null;

  const { id, markdown } = decisionEntry(result);
  const current = await readFile(DECISIONS, "utf8");
  if (current.includes(`### ${id} `)) {
    return { id, written: false, path: DECISIONS, reason: "already_exists" };
  }

  const marker = "\n## 해결됨";
  const next =
    current.includes(marker)
      ? current.replace(marker, `${markdown}${marker}`)
      : `${current.trimEnd()}\n${markdown}\n`;
  await writeFile(DECISIONS, next, "utf8");
  return { id, written: true, path: DECISIONS };
}

function printHuman(result) {
  console.log(`status=${result.status}`);
  console.log(`complexity=${result.complexity}`);
  console.log(`risk=${result.risk}`);
  if (result.account_id) {
    console.log(`account=${result.account_id}`);
    console.log(`provider=${result.provider}`);
    console.log(`model_tier=${result.model_tier}`);
    console.log(`reasoning_effort=${result.reasoning_effort}`);
    console.log(`estimated_units=${result.budget.estimated_units}`);
    console.log(`remaining_after=${result.budget.total_remaining_after}`);
    console.log(`weekend_reserve_ok=${result.budget.weekend_reserve_ok}`);
  }
  console.log(`reason=${result.reason}`);
  if (result.next) console.log(`next=${result.next}`);
}

const options = parseArgs(process.argv.slice(2));
if (!options.task) {
  usage();
  process.exit(1);
}

const config = await readJson(path.resolve(REPO_ROOT, options.config));
const result = chooseModel(config, options);
const decision = options["write-decision"] ? await writeDecisionIfNeeded(result) : null;
if (decision) result.decision = decision;

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}
