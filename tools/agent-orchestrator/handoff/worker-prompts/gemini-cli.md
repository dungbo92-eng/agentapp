# Gemini CLI Start Prompt

Workspace: E:\\agentApp
Worker id: gemini-cli
Worker kind: gemini-cli
Auth: user-managed only

## Launch

- Open a terminal in E:\\agentApp.
- Start Gemini CLI with the repository as context.
- Paste the Agent Prompt from tools/agent-orchestrator/handoff/NEXT_TASK.md.

- Start Gemini CLI from `E:\agentApp`, then paste this prompt as the working instruction.

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

- Selected task: handoff viewer
- Task id: dashboard-handoff-viewer
- Priority: 36
- Generated: 2026-05-09T21:49:30.452Z

위 Required Reads를 먼저 읽고 시작한다.

다음 작업을 진행한다:

> handoff viewer


## Model Routing

Quality is first. Use efficient models for routine reading, setup, and simple docs. Use the best available model and high reasoning for architecture, trading logic, AI integration, security, or irreversible design work.

- routine: efficient / normal
- standard: balanced / high
- complex: best_available / very_high
- critical: best_available / very_high

Before heavy work, run:

```bash
pnpm agent:route -- --task "handoff viewer"
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
