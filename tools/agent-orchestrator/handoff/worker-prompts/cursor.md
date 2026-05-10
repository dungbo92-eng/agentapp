# Cursor Start Prompt

Workspace: E:\\agentApp
Worker id: cursor
Worker kind: cursor
Auth: user-managed only

## Launch

- Open E:\\agentApp in Cursor.
- Paste the Agent Prompt from tools/agent-orchestrator/handoff/NEXT_TASK.md.

- Paste this prompt into Cursor with `E:\agentApp` opened as the workspace.

## Required Reads

1. AGENTS.md
2. .claude-sync/memory/project_state.md
3. .claude-sync/plans/agent-orchestrator-roadmap.md
4. tools/agent-orchestrator/approval-policy.yaml
5. docs/usage-budget-model-routing.md
6. docs/handoff-completion-protocol.md
7. tools/agent-orchestrator/task-queue.json
8. tools/agent-orchestrator/handoff/NEXT_TASK.md

## Current Task

- Selected task: 주기적 `agent-next` 실행 방식 구현
- Task id: scheduled-agent-next
- Priority: 28
- Generated: 2026-05-10T02:21:31.204Z

위 Required Reads를 먼저 읽고 시작한다.

다음 작업을 진행한다:

> 주기적 `agent-next` 실행 방식 구현

## Cursor Adapter

Use this prompt when opening the repository in Cursor.

### Cursor Run Contract

- Open `E:\agentApp` as the workspace before starting.
- Paste this prompt into the Cursor agent/chat tied to the repository.
- Read `AGENTS.md`, `NEXT_TASK.md`, project memory, roadmap, and policy before editing.
- Keep edits tightly scoped and avoid broad IDE refactors unless the task calls for them.
- Use Cursor for local code, docs, tests, validation, handoff updates, commit, and approved push only.
- Do not store secrets in Cursor settings, prompts, files, comments, or logs.
- Before any unclear operation, run `pnpm agent:dry-run -- --operation "<operation>"`.
- Use `pnpm agent:route -- --task "주기적 `agent-next` 실행 방식 구현"` before expensive reasoning work.

### Cursor Completion Output

When finished, report:

- Edited files and why
- Validation commands and results
- Commit hash and push status
- Any held operation or decision
- Next task from `pnpm agent:next`


## Model Routing

Quality is first. Use efficient models for routine reading, setup, and simple docs. Use the best available model and high reasoning for architecture, trading logic, AI integration, security, or irreversible design work.

- routine: efficient / normal
- standard: balanced / high
- complex: best_available / very_high
- critical: best_available / very_high

Before heavy work, run:

```bash
pnpm agent:route -- --task "주기적 `agent-next` 실행 방식 구현"
```

## Safety Rules

- Do not automate login, account switching, approvals, captcha, MFA, billing, or quota bypass.
- Do not store secrets, credentials, cookies, tokens, or account identifiers in repo files or logs.
- Continue local implementation, docs, tests, validation, handoff updates, commit, and approved remote push without asking.
- For uncertain operations, classify first:

```bash
pnpm agent:dry-run -- --operation "<operation>"
```

## Completion

Run the completion sequence when meaningful work is done:

```bash
pnpm validate
pnpm agent:doctor
pnpm agent:progress
pnpm agent:next
pnpm agent:sync
git status --short
```

Then commit verified changes and push to the configured approved remote.
