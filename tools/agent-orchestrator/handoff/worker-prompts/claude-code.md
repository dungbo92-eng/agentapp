# Claude Code Start Prompt

Workspace: E:\\agentApp
Worker id: claude-code
Worker kind: claude-code
Auth: user-managed only

## Launch

- Open a terminal in E:\\agentApp.
- Run Claude Code from the repository root.
- Claude Code reads CLAUDE.md automatically; still check AGENTS.md for shared rules.

- Claude Code loads `CLAUDE.md` automatically, but still read `AGENTS.md` for shared policy.

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

- Selected task: 로드맵의 다음 미완료 작업을 정리한다.
- Task id: n/a
- Priority: n/a
- Generated: 2026-05-10T02:55:09.980Z

위 Required Reads를 먼저 읽고 시작한다.

다음 작업을 진행한다:

> 로드맵의 다음 미완료 작업을 정리한다.

## Claude Code Adapter

Use this prompt when opening Claude Code from a terminal at the repository root.

### Claude Code Run Contract

- Start from `E:\agentApp`; Claude Code should naturally load `CLAUDE.md`.
- Still read `AGENTS.md` because it is the shared policy for every agent.
- Use `tools/agent-orchestrator/handoff/NEXT_TASK.md` as the active handoff.
- Keep all implementation, docs, tests, validation, handoff updates, commit, and approved push moving without asking.
- Do not rely on terminal history or unstated local context; read the required files first.
- Before any unclear operation, run `pnpm agent:dry-run -- --operation "<operation>"`.
- Use `pnpm agent:route -- --task "로드맵의 다음 미완료 작업을 정리한다." --provider claude` before expensive reasoning work.

### Claude Code Completion Output

When finished, report:

- Files or modules changed
- Validation commands and results
- Commit hash and push status
- Any held decision in `DECISIONS_REQUIRED.md`
- Next task from `pnpm agent:next`


## Model Routing

Quality is first. Use efficient models for routine reading, setup, and simple docs. Use the best available model and high reasoning for architecture, trading logic, AI integration, security, or irreversible design work.

- routine: sonnet / normal
- standard: sonnet / high
- complex: opus / very_high
- critical: opus / very_high

Before heavy work, run:

```bash
pnpm agent:route -- --task "로드맵의 다음 미완료 작업을 정리한다."
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
