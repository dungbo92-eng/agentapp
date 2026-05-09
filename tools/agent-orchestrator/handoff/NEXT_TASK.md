# NEXT_TASK

- Generated: 2026-05-09T10:46:43.569Z
- Selected task: `workers.example.yaml` worker registry 예시 확정

## Agent Prompt

AGENTS.md, .claude-sync/memory/project_state.md, .claude-sync/plans/agent-orchestrator-roadmap.md, tools/agent-orchestrator/approval-policy.yaml을 먼저 읽고 시작한다.

다음 작업을 진행한다:

> `workers.example.yaml` worker registry 예시 확정

규칙:

- 승인 정책상 auto_allowed에 해당하는 작업은 바로 진행한다.
- user_required에 해당하는 작업은 실행하지 말고 DECISIONS_REQUIRED.md에 남긴다.
- 작업 후 RUN_STATUS.md, project_state.md, roadmap을 갱신한다.
- 검증 가능하면 pnpm validate를 실행한다.

## Context Snapshot

### Project State

```md
# Project State

Last updated: 2026-05-09

## 프로젝트 한 줄

AgentApp은 여러 AI 개발 에이전트가 같은 memory/plan/handoff를 공유하며 안전한 작업을 이어받게 하는 멀티 에이전트 개발 오케스트레이터다.

## 현재 상태

- `AGENTS.md`, `CLAUDE.md` 공통 규칙 초안 생성.
- `.claude-sync` memory/plan 동기화 구조 생성.
- `scripts/claude-sync.mjs`, `install-hooks.mjs` 생성.
- `scripts/agent-doctor.mjs`, `agent-next.mjs`, `agent-progress.mjs`, `agent-report.mjs` 생성.
- `tools/agent-orchestrator` 아래 승인 정책, worker 예시, handoff 초안 생성.
- `git init`, `pnpm install`, hook 설치 완료.
- `pnpm validate`, `pnpm agent:doctor`, `pnpm agent:progress`, `pnpm agent:next`, `pnpm agent:status` 검증 완료.
- 새 PC/새 에이전트 세션에서 `pnpm agent:doctor`로 Node/pnpm/git, hooks, `.claude-sync`, 로컬 `~/.claude`, git UTF-8 설정, sync 상태를 점검한다.
- `approval-policy.yaml`을 allow/hold/deny 구조로 확정하고 로컬 commit/remote push 기준을 명시했다.
- git remote `origin`은 `git@github.com:dungbo92-eng/agentapp.git`, 기본 브랜치는 `main`으로 설정했다.

## 진행률

- 전체 MVP 기준: 22%
- 문서/규칙 기반: 45%
- 실제 worker 실행 어댑터: 0%
- UI/dashboard: 0%

## 결정된 원칙

- 계정 제한 우회형 자동 계정 전환은 만들지 않는다.
- 정상 인증된 에이전트/도구의 작업 이어받기와 handoff는 지원한다.
- 자동 승인은 allowlist 기반으로 제한한다.
- 사용자 결정 필요 항목은 `DECISIONS_REQUIRED.md`에 모은다.
- 검증된 변경은 로컬 commit으로 남기고, remote가 설정된 경우 사용자 승인 범위 안에서 push까지 수행한다.

## 다음 작업 후보

1. `workers.example.yaml` worker registry 예시 확정.
2. handoff 템플릿(`NEXT_TASK.md`, `RUN_STATUS.md`, `DECISIONS_REQUIRED.md`) 확정.
3. roadmap 체크박스 기반 진행률 계산 고도화.
4. Codex/Claude/Cursor 각각의 수동 실행 프롬프트 템플릿 작성.
5. 안전 작업/보류 작업을 분류하는 dry-run 명령 추가.

## 열린 질문

- 첫 UI는 CLI 우선인가, 웹 대시보드 우선인가?
- worker 실행은 완전 자동 실행보다 “준비된 프롬프트/명령 열기” 수준부터 시작할지 결정 필요.
- 배포 대상은 아직 미정.
- 첫 GitHub push 후 다른 PC/에이전트는 `git clone git@github.com:dungbo92-eng/agentapp.git`로 동기화한다.

```

### Approval Policy

```yaml
version: 1

intent:
  product: "multi-agent development orchestrator"
  goal: "continue safe development work across authenticated agents using shared memory, plans, and handoff files"

default_action: "hold_for_user"

principles:
  - "Prefer safe local progress over external mutation."
  - "Keep every operation inside the repository unless the policy explicitly allows otherwise."
  - "Use normal user-authenticated tools only; never automate login, account switching, captcha, billing, or approval bypass."
  - "Never store secrets, credentials, session cookies, tokens, or production data in repo files, logs, MCP configs, or handoff docs."
  - "When a task mixes auto-allowed and hold-for-user operations, complete the safe local part and record the held part in DECISIONS_REQUIRED.md."

auto_allowed:
  - id: local_file_edits
    description: "Edit local source, docs, configs, tests, and scripts inside the repository."
    scope:
      - "repo files under E:\\agentApp"
      - "generated docs, tests, and local tool configs that contain no secrets"
    examples:
      - "update scripts"
      - "edit README/AGENTS/CLAUDE/handoff docs"
      - "add local tests"
  - id: validation
    description: "Run local syntax checks, tests, typechecks, builds, and linters."
    examples:
      - "pnpm validate"
      - "pnpm agent:doctor"
      - "pnpm agent:progress"
  - id: local_runtime
    description: "Start or stop local development servers and local Docker infrastructure."
    limits:
      - "local only"
      - "no production deploy"
      - "no destructive database operation"
  - id: read_only_checks
    description: "Run read-only local or external checks that do not mutate production systems."
    examples:
      - "inspect package metadata"
      - "view logs"
      - "read documentation"
  - id: memory_plan_updates
    description: "Update .claude-sync memory/plans and handoff files."
    required_when:
      - "meaningful progress is made"
      - "task is blocked"
      - "a user decision is needed"
  - id: git_status_diff
    description: "Inspect git status, diff, logs, and branches."
    examples:
      - "git status --short"
      - "git diff"
      - "git log --oneline"
  - id: git_local_commit
    description: "Stage and create local commits for verified project changes."
    limits:
      - "do not rewrite history"
      - "do not discard user changes"
      - "review status before staging"
      - "run validation first when feasible"

hold_for_user:
  - id: external_writes
    description: "POST, PUT, PATCH, DELETE against external or production services."
  - id: deployment
    description: "Deploy to production, change DNS, publish packages, or release artifacts."
  - id: billing_payments
    description: "Payments, billing, paid plan changes, or usage quota changes."
  - id: secrets
    description: "Create, reveal, rotate, or store API keys, passwords, tokens, or credentials."
  - id: destructive_git
    description: "git reset --hard, f
```
