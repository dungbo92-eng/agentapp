# NEXT_TASK

- Generated: 2026-05-09T10:57:05.452Z
- Selected task: `DECISIONS_REQUIRED.md` 템플릿 확정
- Workspace: E:\agentApp
- Policy: tools/agent-orchestrator/approval-policy.yaml

## Required Reads

1. AGENTS.md
2. .claude-sync/memory/project_state.md
3. .claude-sync/plans/agent-orchestrator-roadmap.md
4. tools/agent-orchestrator/approval-policy.yaml
5. tools/agent-orchestrator/workers.example.yaml

## Agent Prompt

위 Required Reads를 먼저 읽고 시작한다.

다음 작업을 진행한다:

> `DECISIONS_REQUIRED.md` 템플릿 확정

## Execution Rules

- `auto_allowed`에 해당하는 로컬 작업은 바로 진행한다.
- `hold_for_user` 또는 `user_required`에 해당하는 작업은 실행하지 말고 DECISIONS_REQUIRED.md에 남긴다.
- `deny`에 해당하는 작업은 구현하지 않는다.
- 비밀값, 계정 정보, 토큰, 쿠키, 운영 인증 정보는 파일/로그/문서에 남기지 않는다.
- 작업 범위가 섞여 있으면 안전한 로컬 부분만 완료하고 보류 항목을 기록한다.

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
- `workers.example.yaml`을 Codex, Claude Code, Cursor, Gemini CLI용 registry 예시로 확정했다.
- `pnpm agent:next`가 생성하는 `NEXT_TASK.md` 템플릿을 Required Reads, 실행 규칙, 완료 체크리스트, handoff 갱신 목록, context snapshot 구조로 확정했다.
- `pnpm agent:report`가 `RUN_STATUS.md`에 Status, Summary, Verification, Git, Decisions, Next 필드를 가진 실행 로그를 남기도록 템플릿을 확정했다.

## 진행률

- 전체 MVP 기준: 30%
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

1. `DECISIONS_REQUIRED.md` 템플릿 확정.
2. 작업 종료 시 memory/plan/handoff 갱신 규칙 정리.
3. roadmap 체크박스 기반 진행률 계산 고도화.
4. Codex/Claude/Cursor/Gemini 각각의 수동 실행 프롬프트 템플릿 작성.
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
    description: "git reset --hard, force push, branch deletion, history rewrite."
  - id: destructive_filesystem
    description: "Recursive deletion or irreversible file operations outside clearly scoped generated output."
  - id: account_automation
    description: "Automatic login, account switching to bypass limits, approval dialog auto-clicking, captcha or security bypass."
  - id: git_remote_setup
    description: "Add, change, or remove git remotes."
  - id: git_push
    description: "Push commits or tags to a remote reposi

...truncated...
```

### Worker Registry

```yaml
version: 1

schema:
  worker:
    required:
      - id
      - kind
      - auth
      - workspace
      - launch
      - capabilities
      - handoff
    notes:
      - "This registry describes user-managed, already-authenticated tools."
      - "Do not store tokens, cookies, passwords, API keys, or account identifiers here."
      - "Do not use multiple workers to bypass quota, billing, approval, or security limits."

defaults:
  workspace: "E:\\agentApp"
  auth: "user-managed"
  status: "available"
  approval_policy: "tools/agent-orchestrator/approval-policy.yaml"
  required_reads:
    - "AGENTS.md"
    - ".claude-sync/memory/project_state.md"
    - ".claude-sync/plans/agent-orchestrator-roadmap.md"
    - "tools/agent-orchestrator/approval-policy.yaml"
    - "tools/agent-orchestrator/handoff/NEXT_TASK.md"
  handoff_outputs:
    - "tools/agent-orchestrator/handoff/RUN_STATUS.md"
    - "tools/agent-orchestrator/handoff/DECISIONS_REQUIRED.md"
    - ".claude-sync/memory/project_state.md"
    - ".claude-sync/plans/agent-orchestrator-roadmap.md"
  completion_commands:
    - "pnpm validate"
    - "pnpm agent:doctor"
    - "pnpm agent:next"
    - "pnpm agent:sync"

workers:
  - id: codex
    kind: codex
    display_name: "Codex Desktop"
    auth: "user-managed"
    workspace: "E:\\agentApp"
    status: "available"
    launch:
      mode: "manual"
      instructions:
        - "Open Codex with workspace E:\\agentApp."
        - "Ask it to read tools/agent-orchestrator/handoff/NEXT_TASK.md."
    capabilities:
      auto_allowed:
        - local_file_edits
        - validation
        - read_only_checks
        - memory_plan_updates
        - git_status_diff
        - git_local_commit
      hold_for_user:
        - external_writes
        - deployment
        - billing_payments
        - secrets
        - destructive_git
        - destructive_filesystem
        - account_automation
        - git_remote_setup
        - git_push
      denied:
        - quota_bypass
        - credential_capture
        - unattended_security_bypass
    handoff:
      input: "tools/agent-orchestrator/handoff/NEXT_TASK.md"
      required_reads: "defaults.required_reads"
      outputs: "defaults.handoff_outputs"
    health_checks:
      - "pnpm agent:doctor"
      - "pnpm agent:status"

  - id: claude-code
    kind: claude-code
    display_name: "Claude Code"
    auth: "user-managed"
    workspace: "E:\\agentApp"
    status: "available"
    launch:
      mode: "manual"
      instructions

...truncated...
```
