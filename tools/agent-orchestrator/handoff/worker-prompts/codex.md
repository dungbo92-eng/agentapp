# Codex Desktop Start Prompt

Workspace: E:\\agentApp
Worker id: codex
Worker kind: codex
Auth: user-managed only

## Launch

- Open Codex with workspace E:\\agentApp.
- Ask it to read tools/agent-orchestrator/handoff/NEXT_TASK.md.

- Codex should start from `AGENTS.md`, then use `NEXT_TASK.md` as the handoff source.

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

- Selected task: Codex 작업 프롬프트 생성 어댑터
- Task id: n/a
- Priority: n/a
- Generated: 2026-05-09T21:16:18.824Z

위 Required Reads를 먼저 읽고 시작한다.

다음 작업을 진행한다:

> Codex 작업 프롬프트 생성 어댑터

## Model Routing

Quality is first. Use efficient models for routine reading, setup, and simple docs. Use the best available model and high reasoning for architecture, trading logic, AI integration, security, or irreversible design work.

- routine: efficient / medium
- standard: balanced / high
- complex: best_available / xhigh
- critical: best_available / xhigh

Before heavy work, run:

```bash
pnpm agent:route -- --task "Codex 작업 프롬프트 생성 어댑터"
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
