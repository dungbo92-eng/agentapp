#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROADMAP = path.join(REPO_ROOT, ".claude-sync", "plans", "agent-orchestrator-roadmap.md");
const PROJECT_STATE = path.join(REPO_ROOT, ".claude-sync", "memory", "project_state.md");
const POLICY = path.join(REPO_ROOT, "tools", "agent-orchestrator", "approval-policy.yaml");
const HANDOFF_DIR = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff");
const NEXT_TASK = path.join(HANDOFF_DIR, "NEXT_TASK.md");

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

const roadmap = await readText(ROADMAP);
const state = await readText(PROJECT_STATE);
const policy = await readText(POLICY);

const unchecked = [...roadmap.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1].trim());
const selected = unchecked[0] || "로드맵의 다음 미완료 작업을 정리한다.";

const generatedAt = new Date().toISOString();
const body = `# NEXT_TASK

- Generated: ${generatedAt}
- Selected task: ${selected}

## Agent Prompt

AGENTS.md, .claude-sync/memory/project_state.md, .claude-sync/plans/agent-orchestrator-roadmap.md, tools/agent-orchestrator/approval-policy.yaml을 먼저 읽고 시작한다.

다음 작업을 진행한다:

> ${selected}

규칙:

- 승인 정책상 auto_allowed에 해당하는 작업은 바로 진행한다.
- user_required에 해당하는 작업은 실행하지 말고 DECISIONS_REQUIRED.md에 남긴다.
- 작업 후 RUN_STATUS.md, project_state.md, roadmap을 갱신한다.
- 검증 가능하면 pnpm validate를 실행한다.

## Context Snapshot

### Project State

\`\`\`md
${state.slice(0, 4000)}
\`\`\`

### Approval Policy

\`\`\`yaml
${policy.slice(0, 3000)}
\`\`\`
`;

await mkdir(HANDOFF_DIR, { recursive: true });
await writeFile(NEXT_TASK, body, "utf8");

console.log(`next-task=${selected}`);
console.log(`written=${NEXT_TASK}`);
