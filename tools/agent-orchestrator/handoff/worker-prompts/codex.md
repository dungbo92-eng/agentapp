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

- Selected task: plugin/MCP 확장 전략
- Task id: plugin-mcp-extension-plan
- Priority: 18
- Generated: 2026-05-10T02:47:59.183Z

위 Required Reads를 먼저 읽고 시작한다.

다음 작업을 진행한다:

> plugin/MCP 확장 전략

## Codex Adapter

Use this prompt when opening a fresh Codex Desktop thread for the current task.

### Codex Run Contract

- Work from the repository root: `E:\agentApp`.
- Treat `AGENTS.md` as the governing instruction file.
- Use `tools/agent-orchestrator/handoff/NEXT_TASK.md` as the active handoff.
- Continue implementation autonomously for local code, docs, tests, validation, handoff updates, commit, and approved push.
- Send short progress updates while exploring, editing, validating, and pushing.
- Before any unclear operation, run `pnpm agent:dry-run -- --operation "<operation>"`.
- Use `pnpm agent:route -- --task "plugin/MCP 확장 전략" --provider codex` before expensive reasoning work.

### Codex Completion Output

When finished, report:

- What changed
- What was verified
- Commit hash and push status
- Next task from `pnpm agent:next`

If staging, committing, or pushing succeeds inside Codex Desktop, include the app git directives in the final response.


## Model Routing

Quality is first. Use efficient models for routine reading, setup, and simple docs. Use the best available model and high reasoning for architecture, trading logic, AI integration, security, or irreversible design work.

- routine: efficient / medium
- standard: balanced / high
- complex: best_available / xhigh
- critical: best_available / xhigh

Before heavy work, run:

```bash
pnpm agent:route -- --task "plugin/MCP 확장 전략"
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
