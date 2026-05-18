# NEXT_TASK

- Generated: 2026-05-18T00:14:20.363Z
- Selected task: Claude/Gemini CLI 설치 후 실제 authenticated cycle 재검증
- Selection source: roadmap
- Task id: n/a
- Task priority: n/a
- Workspace: D:\agentApp
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

> Claude/Gemini CLI 설치 후 실제 authenticated cycle 재검증

## Execution Rules

- `auto_allowed`에 해당하는 로컬 작업은 바로 진행한다.
- `hold_for_user` 또는 `user_required`에 해당하는 작업은 실행하지 말고 DECISIONS_REQUIRED.md에 남긴다.
- `deny`에 해당하는 작업은 구현하지 않는다.
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

```md
# Project State

Last updated: 2026-05-11

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
- `docs/usage-budget-model-routing.md`에 주간 사용량 예산, 주말 예비분, 품질 우선 모델 선택, 작업 난이도별 모델 라우팅 방향을 추가했다.
- worker registry에 `usage_budget_planning` capability와 provider별 model routing 예시를 추가했다.
- `DECISIONS_REQUIRED.md`를 ID, 상태, 우선순위, 차단 범위, 선택지, 권장안, 결정 후 작업을 가진 decision queue 템플릿으로 확정했다.
- `docs/handoff-completion-protocol.md`에 작업 완료/중단 시 memory, roadmap, handoff, 검증, commit, push 규칙을 정리했다.
- 사용자의 지시에 따라 개발 구현, 문서화, 테스트, 로컬 검증, handoff 갱신, commit/push는 추가 확인 없이 계속 진행하는 원칙을 확정했다.
- `tools/agent-orchestrator/task-queue.json`을 추가하고 `pnpm agent:next`가 우선순위, 의존성, 보류 decision을 반영해 다음 작업을 고르도록 개선했다.
- `usage-budget.schema.json`, `usage-budget.example.json`을 추가해 계정 수/요금제/남은 주간 사용량을 비밀값 없이 기록하는 설정 계약을 만들었다.
- `scripts/validate-configs.mjs`를 추가해 JSON 설정 파일의 파싱과 기본 제약을 `pnpm validate`에서 확인한다.
- `scripts/agent-route-model.mjs`와 `pnpm agent:route`를 추가해 작업 설명/난이도/위험도 기반 모델 티어, 추론 강도, 계정 별칭, 예산 상태를 추천한다.
- `scripts/agent-budget.mjs`와 `pnpm agent:budget`을 추가해 reset day, 주말 예비분, provider별 남은 사용량, 오늘 권장 사용량을 계산한다.
- `pnpm agent:route -- --write-decision`이 사용량 부족 시 `DECISIONS_REQUIRED.md`에 작업 분해/사용자 승인 선택지를 남기도록 구현했다.
- `pnpm agent:progress`가 전체 진행률과 Phase별 진행률을 함께 출력하도록 개선했다.
- `pnpm agent:report`가 `RUN_STATUS.md`와 함께 `project_state.md`의 `최근 보고` 섹션을 갱신하도록 개선했다.
- dashboard 계정 등록 UX를 고정 조합 마법사에서 동적 Add account 흐름으로 바꿨다.
- Claude, Codex, Cursor, Gemini 등 provider와 Google/email/API key/CLI/browser profile 로그인 방식을 계정별로 선택할 수 있다.
- password/API key는 Windows DPAPI local credential vault에 암호화 저장하고, runtime에는 credential reference만 저장한다.
- session profile descriptor를 계정별로 만들어 ready profile만 모델 라우팅 후보로 사용한다.
- Start 화면에 모델 override와 line별 active run event log를 추가했다.
- Windows EXE 패키징 파일 목록에 credential vault runtime을 포함했다.
- worker launch adapter를 추가해 Start가 실제 launch request를 처리하도록 연결했다.
- Codex는 session profile별 `CODEX_HOME`으로 `codex exec`를 실행할 수 있고, Cursor는 session profile별 `--user-data-dir`로 창을 연다.
- launch 전 `pnpm validate` preflight를 실행하고 결과를 active run, DASHBOARD_RUN, run-state에 남긴다.
- worker output에서 login/session expired 패턴을 감지하면 해당 계정을 `needs-login`으로 되돌리고 `needs_user` handoff로 마감한다.
- Claude Code는 session profile별 `CLAUDE_CONFIG_DIR`로 `claude --print --permission-mode acceptEdits`를 실행할 수 있다.
- Gemini CLI는 session profile별 `GEMINI_CONFIG_DIR`로 `gemini -p`를 실행할 수 있다.
- `pnpm agent:setup`을 추가해 Node.js, Git, pnpm, Codex, Claude Code, Cursor, Gemini CLI 설치/PATH/env override 상태를 진단하고 누락 도구의 설치 명령을 출력한다.
- `pnpm agent:cycle-test`를 추가해 dashboard Start, validation, worker launch, handoff 기록 한 사이클을 인증된 로컬 환경에서 점검할 수 있다.
- dashboard 잔여 UX를 정리했다. 빈 상태, nav active 표시, 계정/프로젝트/예산 validation, live 사용량 동기화, 환경 패널을 추가했다.
- dashboard dev server와 desktop server의 runtime API parity를 맞췄다. budget 저장, 로그인 시작, 세션 재감지가 dev/prod 모두에서 동작한다.
- v0.1.0 릴리즈 문서와 Windows portable EX

...truncated...
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
  - "Usage budgeting is for planning normal user-owned capacity, not bypassing platform limits."
  - "Model routing is quality-first: downgrade only low-risk routine work, never critical reasoning work."

auto_allowed:
  - id: local_file_edits
    description: "Edit local source, docs, configs, tests, and scripts inside the repository."
    scope:
      - "repo files inside the AgentApp workspace"
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
  - id: local_worker_launch
    description: "Start or stop local user-managed worker adapters from ready session profiles."
    limits:
      - "local only"
      - "use only normal user-authenticated tools already installed on the machine"
      - "no automatic login, captcha, MFA, or approval bypass"
      - "record handoff and runtime state without storing secrets"
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
  - id: usage_budget_planning
    description: "Track user-provided remaining weekly usage units and recommend model/account allocation."
    limits:
      - "manual or user-provided usage values only"
      - "no hidden quota scraping"
      - "no automatic login or account switching"
      - "no payment or plan changes"
    examples:
      - "reserve weekend usage"
      - "recommend efficient model for routine context revie

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
  workspace: ""
  auth: "user-managed"
  status: "available"
  approval_policy: "tools/agent-orchestrator/approval-policy.yaml"
  usage_budget_policy: "docs/usage-budget-model-routing.md"
  required_reads:
    - "AGENTS.md"
    - ".claude-sync/memory/project_state.md"
    - ".claude-sync/plans/agent-orchestrator-roadmap.md"
    - "tools/agent-orchestrator/approval-policy.yaml"
    - "docs/usage-budget-model-routing.md"
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
    workspace: ""
    status: "available"
    launch:
      mode: "adapter"
      instructions:
        - "Dashboard adapter launches `codex exec` with a session-profile-specific CODEX_HOME."
        - "If the session profile is not authenticated yet, run Codex login in that profile and mark the account Ready again."
    capabilities:
      auto_allowed:
        - local_file_edits
        - validation
        - read_only_checks
        - memory_plan_updates
        - git_status_diff
        - git_local_commit
        - usage_budget_planning
      hold_for_user:
        - external_writes
        - deployment
        - billing_payments
        - secrets
        - destructive_git
        - destructive_filesystem
        - account_automation
        - usage_source_setup
        - git_remote_setup
        - git_push
      denied:
        - quota_bypass
        - credential_capture
        - unattended_security_bypass
    model_routing:
      routine:
        model_tier: "efficient"
        reasoning_effort: "medium"
      standard:
        model_tier: "balanced"
        reasoning_effort: "high"
      complex:
        mo

...truncated...
```

### Task Queue

```json
{
  "version": 1,
  "selection": {
    "priority_order": "higher_first",
    "skip_statuses": [
      "done",
      "blocked",
      "hold"
    ],
    "pending_decisions_source": "tools/agent-orchestrator/handoff/DECISIONS_REQUIRED.md"
  },
  "tasks": [
    {
      "id": "agent-next-priority",
      "title": "`agent-next`가 우선순위/의존성/보류 상태를 반영하도록 개선",
      "phase": "phase-2",
      "priority": 100,
      "status": "done",
      "depends_on": [],
      "blocked_by": [],
      "reason": "NEXT_TASK 생성기가 단순 첫 체크박스가 아니라 task queue와 decision queue를 반영해야 한다."
    },
    {
      "id": "usage-budget-schema",
      "title": "계정 수/요금제/남은 주간 사용량 설정 스키마 작성",
      "phase": "phase-4",
      "priority": 95,
      "status": "done",
      "depends_on": [],
      "blocked_by": [],
      "reason": "사용량 예산과 모델 라우팅 구현의 입력 계약이 먼저 필요하다."
    },
    {
      "id": "model-routing-cli",
      "title": "작업 난이도별 모델 추천 CLI 초안 작성",
      "phase": "phase-4",
      "priority": 90,
      "status": "done",
      "depends_on": [
        "usage-budget-schema"
      ],
      "blocked_by": [],
      "reason": "계정/예산 스키마가 있어야 추천 로직이 안정적으로 동작한다."
    },
    {
      "id": "weekly-budget-calculator",
      "title": "토요일/일요일 예비 사용량을 남기는 주간 예산 계산 로직 구현",
      "phase": "phase-4",
      "priority": 85,
      "status": "done",
      "depends_on": [
        "usage-budget-schema",
        "model-routing-cli"
      ],
      "blocked_by": [],
      "reason": "모델 추천이 주말 예비분을 더 정확히 반영하려면 날짜 기반 예산 계산이 필요하다."
    },
    {
      "id": "usage-insufficient-handoff",
      "title": "사용량 부족 시 작업 분해 또는 사용자 결정 요청 handoff 구현",
      "phase": "phase-4",
      "priority": 80,
      "status": "done",
      "depends_on": [
        "usage-budget-schema",
        "model-routing-cli",
        "weekly-budget-calculator"
      ],
      "blocked_by": [],
      "reason": "예산 부족 상태를 감지했을 때 자동 계정 전환이 아니라 작업 분해/사용자 결정 큐로 넘겨야 한다."
    },
    {
      "id": "agent-progress-by-phase",
      "title": "`agent-progress`가 phase별 진행률을 출력하도록 개선",
      "phase": "phase-2",
      "priority": 70,
      "status": "done",
      "depends_on": [],
      "blocked_by": [],
      "reason": "전체 진행률뿐 아니라 Phase별 병목을 보여줘야 한다."
    },
    {
      "id": "agent-report-project-state",
      "title": "`agent-report`가 project_state까지 갱신하도록 개선",
      "phase": "phase-2",
      "priority": 65,
      "status": "done",
      "depends_on": [
        "agent-progress-by-phase"
      ],
      "blocked_by": [],
      "reason": "보고와 상태 갱신을 한 번에 묶어 handoff 누락을 줄인다."
    },

...truncated...
```

### Usage Budget and Model Routing

```md
# Usage Budget and Model Routing

AgentApp은 여러 정상 인증 AI 도구를 이어받게 하는 프로젝트다. 이 기능은 계정 제한을 우회하는 자동화가 아니라, 사용자가 보유한 Claude Pro, Codex Plus 같은 계정의 주간 사용량을 로컬에서 계획하고 작업 난이도에 맞는 모델을 추천하는 품질 중심 라우터다.

## 목표

- 프로젝트 품질을 최우선으로 둔다.
- 남은 주간 사용량을 평일, 토요일, 일요일까지 끊김 없이 배분한다.
- 계정 수가 Claude Pro 2개 + Codex Plus 2개인 경우와 Claude Pro 1개 + Codex Plus 1개인 경우를 모두 지원한다.
- 단순 숙지, 설치 안내, 문서 정리에는 중간급 모델/보통 추론을 사용해 예산을 아낀다.
- 자동매매 로직, AI 모델 연동, 아키텍처, 보안, 데이터 손실 가능 변경처럼 복잡한 작업에는 최고 품질 모델/높은 추론을 우선한다.
- 자동 로그인, 자동 계정 전환, 캡차/승인 우회, 제한 우회는 하지 않는다.

## 비목표

- 플랫폼의 주간 제한을 우회하지 않는다.
- 계정 비밀번호, 세션 쿠키, API key, 토큰을 저장하지 않는다.
- 숨겨진 사용량을 스크래핑하거나 보안 절차를 우회하지 않는다.
- 요금제 변경, 결제, 계정 생성, 자동 계정 전환은 하지 않는다.

## 입력 데이터

계정별 설정은 비밀값 없이 로컬 설정으로 관리한다. 스키마는 `tools/agent-orchestrator/usage-budget.schema.json`, 예시는 `tools/agent-orchestrator/usage-budget.example.json`에 둔다.

```yaml
accounts:
  - id: claude-pro-1
    provider: claude
    plan: pro
    auth: user-managed
    weekly_budget_units: 100
    remaining_units: 64
    reset_day: monday
  - id: codex-plus-1
    provider: codex
    plan: plus
    auth: user-managed
    weekly_budget_units: 100
    remaining_units: 71
    reset_day: monday
```

`weekly_budget_units`는 실제 토큰 수가 아니라 상대 단위다. 플랫폼별 제한 정책이 바뀌어도 사용자가 현재 보이는 남은 사용량을 0-100 단위로 입력하면 같은 로직을 적용할 수 있다.

## 작업 등급

| 등급 | 예시 | 기본 모델 정책 |
|---|---|---|
| `routine` | 프로젝트 숙지, 파일 탐색, Docker 설치 방법, 단순 문서 정리 | Sonnet/보통, Codex 중간 추론 |
| `standard` | 일반 버그 수정, 작은 기능 구현, 테스트 보강 | Sonnet/높음 또는 Codex 높음 |
| `complex` | 자동매매 로직 설계, AI 모델 연동 설계, 아키텍처 결정, 보안 설계 | Opus/매우높음, Codex xhigh |
| `critical` | 데이터 손실 위험, 운영 장애, 대규모 리팩터, 결제/보안 영향 | 최고 품질 모델 우선, 필요 시 사용자 확인 |

## 품질 우선 규칙

1. 작업 위험도와 복잡도가 높으면 예산 절약보다 품질을 우선한다.
2. `complex` 이상은 남은 예산이 부족해도 중간 모델로 강등하지 않고, 작업 분해 또는 사용자 결정을 요청한다.
3. `routine` 작업은 고급 모델을 기본 사용하지 않는다.
4. 긴 작업은 탐색, 설계, 구현, 검증으로 쪼개고 각 단계에 맞는 모델을 선택한다.
5. 모델 선택 이유와 예상 예산 소모를 handoff에 남긴다.

## 주간 예산 배분

토요일, 일요일 작업이 끊기지 않게 주말 예비분을 둔다.

```text
available = sum(account.remaining_units)
days_to_reset = reset_day까지 남은 일수
weekend_reserve = expected_sat_sun_units
weekday_budget = max(0, available - weekend_reserve)
today_budget = weekday_budget / max(1, weekday_days_left)
```

계정 수가 많으면 같은 provider 안에서 사용량이 적게 남은 계정보다 여유 있는 계정을 우선 추천한다. 계정 수가 적으면 routine 작업을 더 강하게 절약 모드로 보내고, complex 작업은 큐에 남기거나 사용자에게 예산 사용 승인을 요청한다.

```bash
pnpm agent:budget
pnpm agent:budget -- --date 2026-05-09 --json
```

`agent:budget`은 reset day까지 남은 일수, 주말 예비분, 오늘 권장 사용량, provider별 남은 단위를 계산한다.

## 라우팅 로직 초안

```text
classify(task):

...truncated...
```

### Handoff Completion Protocol

```md
# Handoff Completion Protocol

작업을 끝내거나 중단할 때 모든 에이전트가 같은 순서로 memory, plan, handoff, git 상태를 정리하기 위한 규칙이다.

## 기본 원칙

- 개발 구현, 문서 수정, 테스트, 로컬 검증, 로컬 CLI 실행, memory/plan/handoff 갱신, commit/push는 `approval-policy.yaml`의 `auto_allowed` 범위에서 계속 진행한다.
- 사용자 결정은 안전, 계정, 결제, 배포, 외부 운영 쓰기, 비밀값, 파괴적 작업처럼 `hold_for_user` 또는 `deny`에 해당하는 경우에만 요구한다.
- 작업이 끝나면 다음 에이전트가 바로 이어받을 수 있도록 `project_state.md`, roadmap, handoff, git remote를 같은 상태로 맞춘다.
- GitHub remote가 설정되어 있으면 검증된 변경은 commit 후 push한다.

## 완료 시 체크리스트

1. 작업 결과를 요약한다.
2. 관련 roadmap 체크박스를 갱신한다.
3. `.claude-sync/memory/project_state.md`에 의미 있는 진행, 다음 후보, 열린 질문을 갱신한다.
4. `tools/agent-orchestrator/handoff/RUN_STATUS.md`에 구조화 로그를 남긴다.
5. 사용자 결정이 필요한 항목은 `DECISIONS_REQUIRED.md`에 추가하거나 해결 처리한다.
6. `pnpm agent:next`로 다음 작업 handoff를 재생성한다.
7. `pnpm agent:sync`로 repo와 로컬 Claude memory/plan을 맞춘다.
8. `pnpm validate`, `pnpm agent:doctor`, `pnpm agent:status`를 실행한다.
9. `git status`와 diff를 확인한다.
10. 변경 사항을 commit한다.
11. remote가 설정되어 있으면 push한다.

## 중단 시 체크리스트

1. `RUN_STATUS.md`에 `Status: blocked` 또는 `Status: in_progress`로 기록한다.
2. 막힌 이유를 한 문장으로 적는다.
3. 사용자가 결정해야 할 항목은 `DECISIONS_REQUIRED.md`에 구조화해서 남긴다.
4. 안전하게 완료한 로컬 변경은 가능한 한 검증하고 commit/push한다.
5. 다음 에이전트가 이어갈 수 있게 `NEXT_TASK.md`를 최신 상태로 만든다.

## RUN_STATUS 필드

- Status: `completed`, `blocked`, `in_progress`
- Summary: 수행 내용
- Verification: 실행한 검증 명령과 결과
- Git: commit/push 상태
- Decisions: 새로 생기거나 해결한 결정 항목
- Next: 다음 작업

## DECISIONS_REQUIRED 기준

기록해야 하는 경우:

- 외부 서비스 쓰기, 배포, 결제, 요금제 변경
- 비밀값 생성, 노출, 저장, 회전
- 운영 DB나 운영 인프라 파괴 가능 작업
- 자동 로그인, 자동 계정 전환, captcha/승인/보안 절차 우회
- 사용자가 선택해야 하는 제품 방향

기록하지 않고 진행하는 경우:

- 저장소 안의 코드, 문서, 테스트, 설정 수정
- 로컬 검증, 빌드, 타입체크, lint
- handoff, memory, roadmap 갱신
- 안전한 git status/diff/log 확인
- 검증된 로컬 commit과 승인된 remote push

## 권장 완료 명령

```bash
pnpm validate
pnpm agent:doctor
pnpm agent:status
pnpm agent:progress
pnpm agent:next
pnpm agent:sync
git status --short
git add -A
git commit -m "<type>: <summary>"
git push
```

```
