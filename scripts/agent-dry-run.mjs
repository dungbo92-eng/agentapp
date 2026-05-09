#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_POLICY = path.join(REPO_ROOT, "tools", "agent-orchestrator", "approval-policy.yaml");

const HELP = `Usage:
  pnpm agent:dry-run -- --operation "pnpm validate"
  pnpm agent:dry-run -- "git status --short"
  pnpm agent:dry-run -- --operation "deploy production" --json

Classifies an intended operation against tools/agent-orchestrator/approval-policy.yaml.
`;

function parseArgs(argv) {
  const args = {
    json: false,
    help: false,
    operation: "",
    policy: DEFAULT_POLICY,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--operation" || arg === "--op" || arg === "--task") {
      args.operation = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--policy") {
      args.policy = path.resolve(REPO_ROOT, argv[index + 1] || "");
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  if (!args.operation && positional.length > 0) {
    args.operation = positional.join(" ");
  }

  return args;
}

function parsePolicy(text) {
  const sections = new Map();
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const sectionMatch = rawLine.match(/^([a-z_]+):\s*$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections.has(current)) sections.set(current, new Set());
      continue;
    }

    const idMatch = rawLine.match(/^\s*-\s+id:\s*([A-Za-z0-9_-]+)/);
    if (current && idMatch) {
      sections.get(current).add(idMatch[1]);
    }
  }

  return sections;
}

const RULES = [
  {
    action: "deny",
    id: "quota_bypass",
    patterns: [
      /\b(quota|limit|usage cap|weekly usage)\b.*\b(bypass|evade|work around)\b/i,
      /\b(bypass|evade|work around)\b.*\b(quota|limit|usage cap|weekly usage)\b/i,
      /(제한|한도|쿼터|사용량).*(우회|회피)/,
      /(우회|회피).*(제한|한도|쿼터|사용량)/,
    ],
  },
  {
    action: "deny",
    id: "credential_capture",
    patterns: [
      /\b(capture|persist|print|dump|exfiltrate|steal)\b.*\b(credential|secret|token|cookie|password|api key)\b/i,
      /\b(credential|secret|token|cookie|password|api key)\b.*\b(capture|persist|print|dump|exfiltrate|steal)\b/i,
      /(비밀|토큰|쿠키|비밀번호|자격증명|api key).*(저장|출력|탈취|수집)/i,
    ],
  },
  {
    action: "deny",
    id: "unattended_security_bypass",
    patterns: [
      /\b(captcha|mfa|2fa|security prompt|consent screen|approval dialog)\b.*\b(bypass|skip|auto.?click)\b/i,
      /\b(bypass|skip|auto.?click)\b.*\b(captcha|mfa|2fa|security prompt|consent screen|approval dialog)\b/i,
      /(캡차|mfa|2fa|보안|승인창|동의창).*(우회|자동 클릭|건너뛰)/,
    ],
  },
  {
    action: "hold_for_user",
    id: "destructive_git",
    patterns: [
      /\bgit\s+(reset\s+--hard|push\s+--force|push\s+-f|branch\s+-D|branch\s+--delete|rebase)\b/i,
      /(히스토리|브랜치).*(삭제|재작성)/,
    ],
  },
  {
    action: "hold_for_user",
    id: "git_remote_setup",
    patterns: [/\bgit\s+remote\s+(add|set-url|remove|rename)\b/i],
  },
  {
    action: "hold_for_user",
    id: "git_push",
    patterns: [/\bgit\s+push\b/i],
  },
  {
    action: "hold_for_user",
    id: "deployment",
    patterns: [
      /\b(deploy|release|publish package|change dns|production)\b/i,
      /(배포|릴리스|운영|프로덕션|dns)/i,
    ],
  },
  {
    action: "hold_for_user",
    id: "billing_payments",
    patterns: [/\b(payment|billing|paid plan|subscribe|upgrade plan|quota change)\b/i, /(결제|요금|유료|구독|플랜 변경)/],
  },
  {
    action: "hold_for_user",
    id: "secrets",
    patterns: [
      /\b(create|reveal|rotate|store|change)\b.*\b(api key|secret|token|password|credential)\b/i,
      /\b(api key|secret|token|password|credential)\b.*\b(create|reveal|rotate|store|change)\b/i,
      /(비밀|토큰|비밀번호|자격증명|api key).*(생성|공개|회전|저장|변경)/i,
    ],
  },
  {
    action: "hold_for_user",
    id: "external_writes",
    patterns: [
      /\b(POST|PUT|PATCH|DELETE)\b.*\b(http|https|api|external|production)\b/i,
      /\b(write|mutate|delete|update)\b.*\b(external|production|remote service)\b/i,
      /(외부|운영|프로덕션).*(쓰기|수정|삭제|변경)/,
    ],
  },
  {
    action: "hold_for_user",
    id: "destructive_filesystem",
    patterns: [
      /\b(rm\s+-rf|remove-item\b.*-recurse|del\s+\/s|format)\b/i,
      /(재귀|영구).*(삭제|제거)/,
    ],
  },
  {
    action: "hold_for_user",
    id: "account_automation",
    patterns: [
      /\b(auto.?login|automatic login|account switching|approval auto.?click|captcha|mfa bypass)\b/i,
      /(자동 로그인|계정 전환|승인창 자동|캡차|보안 우회)/,
    ],
  },
  {
    action: "hold_for_user",
    id: "usage_source_setup",
    patterns: [
      /\b(connect|change|setup|configure)\b.*\b(usage source|browser session|account metadata)\b/i,
      /(사용량 소스|브라우저 세션|계정 메타데이터).*(연결|변경|설정)/,
    ],
  },
  {
    action: "auto_allowed",
    id: "validation",
    patterns: [
      /\b(pnpm|npm|yarn|node)\b.*\b(validate|test|lint|typecheck|build|--check)\b/i,
      /\b(agent:doctor|agent:progress|agent:budget|agent:next|agent:route|agent:status)\b/i,
      /(검증|테스트|린트|빌드|문법 확인)/,
    ],
  },
  {
    action: "auto_allowed",
    id: "git_status_diff",
    patterns: [/\bgit\s+(status|diff|log|show|branch)\b/i],
  },
  {
    action: "auto_allowed",
    id: "git_local_commit",
    patterns: [/\bgit\s+(add|commit)\b/i],
  },
  {
    action: "auto_allowed",
    id: "memory_plan_updates",
    patterns: [/(project_state|roadmap|handoff|NEXT_TASK|RUN_STATUS|DECISIONS_REQUIRED)/i, /(메모리|계획|핸드오프).*(갱신|수정|업데이트)/],
  },
  {
    action: "auto_allowed",
    id: "usage_budget_planning",
    patterns: [/(usage budget|model routing|weekend reserve|token budget|사용량 예산|모델 라우팅|주말 예비|토큰 관리)/i],
  },
  {
    action: "auto_allowed",
    id: "read_only_checks",
    patterns: [/\b(read|inspect|view|list|search|open)\b/i, /(읽기|조회|확인|검색|점검)/],
  },
  {
    action: "auto_allowed",
    id: "local_runtime",
    patterns: [/\b(localhost|dev server|docker compose|local docker|start server|stop server)\b/i, /(로컬 서버|개발 서버|로컬 docker)/i],
  },
  {
    action: "auto_allowed",
    id: "local_file_edits",
    patterns: [
      /\b(edit|update|create|add|modify|write)\b.*\b(file|files|doc|docs|script|test|config|readme|dashboard|local)\b/i,
      /\b(local|dashboard)\b.*\b(file|files|app|view|component)\b/i,
      /(파일|문서|스크립트|테스트|설정|대시보드).*(수정|추가|작성|갱신|생성)/,
    ],
  },
];

function matchingRules(operation) {
  return RULES.filter((rule) => rule.patterns.some((pattern) => pattern.test(operation)));
}

function classify(operation, policy) {
  const matches = matchingRules(operation);
  const actionOrder = ["deny", "hold_for_user", "auto_allowed"];
  const action = actionOrder.find((candidate) => matches.some((rule) => rule.action === candidate)) || "hold_for_user";
  const matched = matches.filter((rule) => rule.action === action).map((rule) => rule.id);
  const defaulted = matched.length === 0;

  const unknownPolicyIds = matched.filter((id) => {
    const section = action === "deny" ? "deny" : action === "auto_allowed" ? "auto_allowed" : "hold_for_user";
    return !policy.get(section)?.has(id);
  });

  return {
    action,
    operation,
    matched_policy_ids: defaulted ? ["default_action"] : [...new Set(matched)],
    defaulted,
    unknown_policy_ids: unknownPolicyIds,
    handoff_required: action !== "auto_allowed",
    note:
      action === "auto_allowed"
        ? "Safe to proceed locally under the current policy."
        : action === "deny"
          ? "Do not implement this operation; record it in DECISIONS_REQUIRED.md if relevant."
          : "Hold this operation for explicit user approval and record it in DECISIONS_REQUIRED.md if it blocks progress.",
  };
}

function printHuman(result) {
  console.log(`action=${result.action}`);
  console.log(`operation=${result.operation}`);
  console.log(`matched=${result.matched_policy_ids.join(",")}`);
  console.log(`handoff_required=${result.handoff_required}`);
  console.log(`note=${result.note}`);
  if (result.unknown_policy_ids.length > 0) {
    console.log(`warning=rules missing from policy: ${result.unknown_policy_ids.join(",")}`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

if (!args.operation.trim()) {
  console.error("[agent-dry-run] missing --operation");
  console.error(HELP);
  process.exit(1);
}

const policyText = await readFile(args.policy, "utf8");
const policy = parsePolicy(policyText);
const result = classify(args.operation.trim(), policy);

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}
