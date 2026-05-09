#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROADMAP = path.join(REPO_ROOT, ".claude-sync", "plans", "agent-orchestrator-roadmap.md");
const PROJECT_STATE = path.join(REPO_ROOT, ".claude-sync", "memory", "project_state.md");
const POLICY = path.join(REPO_ROOT, "tools", "agent-orchestrator", "approval-policy.yaml");
const WORKERS = path.join(REPO_ROOT, "tools", "agent-orchestrator", "workers.example.yaml");
const TASK_QUEUE = path.join(REPO_ROOT, "tools", "agent-orchestrator", "task-queue.json");
const DECISIONS = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "DECISIONS_REQUIRED.md");
const USAGE_BUDGET = path.join(REPO_ROOT, "docs", "usage-budget-model-routing.md");
const COMPLETION_PROTOCOL = path.join(REPO_ROOT, "docs", "handoff-completion-protocol.md");
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
const workers = await readText(WORKERS);
const taskQueueText = await readText(TASK_QUEUE);
const decisions = await readText(DECISIONS);
const usageBudget = await readText(USAGE_BUDGET);
const completionProtocol = await readText(COMPLETION_PROTOCOL);

const unchecked = [...roadmap.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1].trim());

function parseTaskQueue(text) {
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.tasks) ? parsed.tasks : [];
  } catch (error) {
    console.warn(`[agent-next] task queue ignored: ${error.message}`);
    return [];
  }
}

function pendingDecisionIds(markdown) {
  const pendingSection = markdown.match(/## 대기([\s\S]*?)(?:\n## |\n# |$)/);
  if (!pendingSection) return new Set();
  return new Set([...pendingSection[1].matchAll(/###\s+(DEC-\d{8}-\d{3})\b/g)].map((match) => match[1]));
}

function taskPriority(task) {
  if (Number.isFinite(task.priority)) return task.priority;
  return { high: 90, medium: 50, low: 10 }[task.priority] || 0;
}

function selectTask(tasks, pendingDecisions) {
  const completed = new Set(
    tasks.filter((task) => ["done", "completed"].includes(task.status)).map((task) => task.id),
  );
  const skippedStatuses = new Set(["done", "completed", "blocked", "hold"]);
  const available = tasks
    .filter((task) => !skippedStatuses.has(task.status))
    .filter((task) => (task.depends_on || []).every((id) => completed.has(id)))
    .filter(
      (task) =>
        !(task.blocked_by || []).some((id) =>
          id.startsWith("DEC-") ? pendingDecisions.has(id) : !completed.has(id),
        ),
    )
    .sort((left, right) => taskPriority(right) - taskPriority(left));

  return available[0] || null;
}

const tasks = parseTaskQueue(taskQueueText);
const pendingDecisions = pendingDecisionIds(decisions);
const selectedTask = selectTask(tasks, pendingDecisions);
const selected = selectedTask?.title || unchecked[0] || "로드맵의 다음 미완료 작업을 정리한다.";
const selectedSource = selectedTask ? "task-queue" : "roadmap";

function excerpt(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}\n\n...truncated...`;
}

const generatedAt = new Date().toISOString();
const body = `# NEXT_TASK

- Generated: ${generatedAt}
- Selected task: ${selected}
- Selection source: ${selectedSource}
- Task id: ${selectedTask?.id || "n/a"}
- Task priority: ${selectedTask?.priority || "n/a"}
- Workspace: ${REPO_ROOT}
- Policy: tools/agent-orchestrator/approval-policy.yaml

## Required Reads

1. AGENTS.md
2. .claude-sync/memory/project_state.md
3. .claude-sync/plans/agent-orchestrator-roadmap.md
4. tools/agent-orchestrator/approval-policy.yaml
5. docs/usage-budget-model-routing.md
6. docs/handoff-completion-protocol.md
7. tools/agent-orchestrator/task-queue.json
8. tools/agent-orchestrator/workers.example.yaml

## Agent Prompt

위 Required Reads를 먼저 읽고 시작한다.

다음 작업을 진행한다:

> ${selected}

## Execution Rules

- \`auto_allowed\`에 해당하는 로컬 작업은 바로 진행한다.
- \`hold_for_user\` 또는 \`user_required\`에 해당하는 작업은 실행하지 말고 DECISIONS_REQUIRED.md에 남긴다.
- \`deny\`에 해당하는 작업은 구현하지 않는다.
- 비밀값, 계정 정보, 토큰, 쿠키, 운영 인증 정보는 파일/로그/문서에 남기지 않는다.
- 작업 범위가 섞여 있으면 안전한 로컬 부분만 완료하고 보류 항목을 기록한다.
- 개발 구현, 문서화, 테스트, 로컬 검증, handoff 갱신, commit/push는 추가 확인 없이 계속 진행한다.

## Completion Checklist

- pnpm validate
- pnpm agent:doctor
- pnpm agent:progress
- pnpm agent:next
- pnpm agent:sync
- git status 확인
- 검증된 변경 commit
- 승인된 remote가 있으면 push

## Handoff Updates

- tools/agent-orchestrator/handoff/RUN_STATUS.md: 수행 내용과 검증 결과 추가
- tools/agent-orchestrator/handoff/DECISIONS_REQUIRED.md: 사용자 결정 필요 항목 추가/해결 처리
- .claude-sync/memory/project_state.md: 의미 있는 진행 반영
- .claude-sync/plans/agent-orchestrator-roadmap.md: 완료된 roadmap 체크박스 갱신

## Context Snapshot

### Project State

\`\`\`md
${excerpt(state, 4000)}
\`\`\`

### Approval Policy

\`\`\`yaml
${excerpt(policy, 3500)}
\`\`\`

### Worker Registry

\`\`\`yaml
${excerpt(workers, 2500)}
\`\`\`

### Task Queue

\`\`\`json
${excerpt(taskQueueText, 2500)}
\`\`\`

### Usage Budget and Model Routing

\`\`\`md
${excerpt(usageBudget, 2500)}
\`\`\`

### Handoff Completion Protocol

\`\`\`md
${excerpt(completionProtocol, 2500)}
\`\`\`
`;

await mkdir(HANDOFF_DIR, { recursive: true });
await writeFile(NEXT_TASK, body, "utf8");

console.log(`next-task=${selected}`);
console.log(`written=${NEXT_TASK}`);
