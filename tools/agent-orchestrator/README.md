# Agent Orchestrator

여러 AI 개발 에이전트가 같은 작업 상태를 이어받기 위한 운영 디렉터리다.

## 파일

| 파일 | 역할 |
|---|---|
| `approval-policy.yaml` | 자동 진행 가능/사용자 승인 필요 기준 |
| `workers.example.yaml` | worker registry 예시 |
| `task-queue.json` | 우선순위/의존성/보류 상태를 가진 작업 큐 |
| `usage-budget.schema.json` | 주간 사용량 예산 설정 스키마 |
| `usage-budget.example.json` | 비밀값 없는 주간 사용량 예시 설정 |
| `worker-run-state.schema.json` | worker 실행/중단/실패/quota 상태 모델 |
| `worker-run-state.example.json` | 비밀값 없는 worker 상태 예시 |
| `../../docs/dashboard-technology.md` | 로컬 대시보드 기술 선택 |
| `roadmap.yaml` | 기계가 읽기 쉬운 로드맵 초안 |
| `handoff/NEXT_TASK.md` | 다음 에이전트가 수행할 작업 |
| `handoff/RUN_STATUS.md` | 최근 실행 결과 |
| `handoff/DECISIONS_REQUIRED.md` | 사용자 결정 필요 항목 |

## Worker registry

`workers.example.yaml`은 실제 계정 정보를 저장하지 않는 예시 registry다.

- worker는 정상 인증된 도구/세션을 사람이 여는 방식으로 시작한다.
- `capabilities.auto_allowed`는 `approval-policy.yaml`의 안전 작업 id만 참조한다.
- `capabilities.hold_for_user`와 `capabilities.denied`는 자동 실행하지 않는다.
- 작업 완료 시 memory/plan/handoff 갱신, 검증, commit, 승인된 remote push를 수행한다.

## Worker run state

`worker-run-state.schema.json`은 worker가 멈췄거나 이어받기를 남겨야 할 때 공통으로 기록할 상태 계약이다.

- `status`: `queued`, `running`, `completed`, `interrupted`, `blocked`, `failed`, `quota_limited`, `needs_user`
- `reason`: `session_timeout`, `quota_exhausted`, `missing_credentials`, `hold_for_user`, `deny_policy`, `validation_failed`, `tool_error`, `merge_conflict` 등
- `handoff`: 요약, 다음 단계, 관련 파일, 필요 시 decision id
- `safety`: 비밀값 포함 여부는 항상 `false`, 외부 쓰기 여부, 정책 판정

이 모델은 사용량 제한 우회를 위한 자동 계정 전환이 아니라, 정상 보유 세션에서 작업이 멈춘 이유를 다음 worker가 안전하게 해석하기 위한 기록이다.

`pnpm agent:fallback`은 worker를 직접 실행할 수 없는 환경에서 handoff만 남긴다.

```bash
pnpm agent:fallback -- --worker codex --reason tool_error --summary "현재 환경에서 Codex 실행 불가"
pnpm agent:fallback -- --worker claude-code --status quota_limited --reason quota_exhausted --summary "이번 주 사용량 예산 부족"
pnpm agent:fallback -- --worker cursor --summary "IDE 실행 불가" --dry-run --json
```

이 명령은 `handoff/HANDOFF_ONLY.md`, `handoff/run-states/*.json`, `handoff/RUN_STATUS.md`를 갱신하며 외부 도구 실행이나 계정 전환을 하지 않는다.

## NEXT_TASK template

`pnpm agent:next`가 생성하는 `handoff/NEXT_TASK.md`는 아래 계약을 따른다.

- Required Reads: 새 에이전트가 반드시 읽을 파일 목록
- Agent Prompt: 선택된 다음 작업
- Execution Rules: allow/hold/deny 기준
- Completion Checklist: 검증, handoff 갱신, commit, push 순서
- Context Snapshot: project state, approval policy, worker registry 발췌

## Task queue

`task-queue.json`은 `pnpm agent:next`가 roadmap보다 먼저 참고하는 실행 큐다.

- `priority`: 숫자가 높을수록 먼저 선택한다.
- `status`: `pending`, `done`, `blocked`, `hold`를 사용한다.
- `depends_on`: 완료된 task id가 모두 있어야 선택된다.
- `blocked_by`: 대기 중인 `DEC-*` 또는 미완료 task id가 있으면 선택하지 않는다.
- task queue가 비어 있거나 파싱 실패하면 markdown roadmap의 첫 미완료 체크박스를 fallback으로 사용한다.

## Progress CLI

`pnpm agent:progress`는 전체 진행률과 Phase별 진행률을 함께 출력한다.

## RUN_STATUS template

`pnpm agent:report`는 `handoff/RUN_STATUS.md`에 아래 필드를 가진 실행 로그를 추가하고, `.claude-sync/memory/project_state.md`의 `최근 보고` 섹션도 갱신한다.

- Status: `completed`, `blocked`, `in_progress` 중 하나
- Summary: 수행 내용
- Verification: 실행한 검증 명령과 결과
- Git: commit/push 상태
- Decisions: 새로 생긴 사용자 결정 필요 항목
- Next: 다음 작업 또는 `NEXT_TASK.md` 참조

## DECISIONS_REQUIRED template

`handoff/DECISIONS_REQUIRED.md`는 사용자가 결정해야만 진행 가능한 항목을 관리한다.

- Status: `pending`, `resolved`, `blocked`
- Priority: `high`, `medium`, `low`
- Category: `product`, `safety`, `git`, `usage_budget`, `worker`, `deployment`, `other`
- Blocks: 막히는 작업
- Context: 결정이 필요한 이유
- Options: 사용자가 고를 수 있는 선택지와 영향
- Recommended: 에이전트 권장안
- Decision needed: 사용자에게 물을 질문
- After decision: 결정 후 이어갈 작업

## Completion protocol

작업 완료/중단 시에는 `docs/handoff-completion-protocol.md`를 따른다.

- 완료 시 roadmap, `project_state.md`, `RUN_STATUS.md`, `DECISIONS_REQUIRED.md`, `NEXT_TASK.md`를 갱신한다.
- `pnpm validate`, `pnpm agent:doctor`, `pnpm agent:status`로 검증한다.
- 검증된 변경은 commit 후 remote가 설정되어 있으면 push한다.
- 개발 구현/문서/테스트/로컬 검증은 추가 확인 없이 계속 진행한다.
- `hold_for_user` 또는 `deny` 작업만 decision queue로 넘긴다.

## Safety dry-run CLI

`pnpm agent:dry-run`은 실행하려는 작업 설명이나 명령을 `approval-policy.yaml` 기준으로 `auto_allowed`, `hold_for_user`, `deny` 중 하나로 분류한다.

```bash
pnpm agent:dry-run -- --operation "pnpm validate"
pnpm agent:dry-run -- --operation "git push" --json
pnpm agent:dry-run -- --operation "bypass quota"
```

분류 결과가 `hold_for_user` 또는 `deny`이면 작업을 실행하지 않고, 차단 범위가 있으면 `handoff/DECISIONS_REQUIRED.md`에 남긴다.

## Worker prompt CLI

`pnpm agent:prompt`는 `workers.example.yaml`과 `handoff/NEXT_TASK.md`를 읽어 worker별 시작 프롬프트를 만든다.

```bash
pnpm agent:prompt -- --worker codex
pnpm agent:prompt -- --worker claude-code --write
pnpm agent:prompt -- --all --write
```

`--write`를 사용하면 `handoff/worker-prompts/{worker-id}.md` 파일을 생성한다. 이 파일은 사용자가 정상 인증한 각 도구에 붙여넣는 지시문이며, 자동 로그인/계정 전환/승인 우회 정보를 포함하지 않는다.

Codex 전용 어댑터 프롬프트는 아래 alias를 쓴다.

```bash
pnpm agent:codex-prompt -- --write
pnpm agent:prompt -- --worker codex --format codex --write
```

Codex 전용 출력에는 Codex Desktop 실행 계약, 진행 업데이트 방식, `agent:dry-run`/`agent:route --provider codex` 사용 지침, 완료 보고 항목이 포함된다.

Claude Code 전용 어댑터 프롬프트는 아래 alias를 쓴다.

```bash
pnpm agent:claude-prompt -- --write
pnpm agent:prompt -- --worker claude-code --format claude-code --write
```

Claude Code 전용 출력에는 `CLAUDE.md` 자동 로드 전제, `AGENTS.md` 공통 정책 확인, 터미널 루트 실행, `agent:route --provider claude` 사용 지침, 완료 보고 항목이 포함된다.

Cursor 전용 어댑터 프롬프트는 아래 alias를 쓴다.

```bash
pnpm agent:cursor-prompt -- --write
pnpm agent:prompt -- --worker cursor --format cursor --write
```

Cursor 전용 출력에는 `E:\agentApp` workspace 열기, IDE agent/chat에 붙여넣기, 좁은 범위 편집, 비밀값 저장 금지, 완료 보고 항목이 포함된다.

## Model routing CLI

`pnpm agent:route`는 작업 설명과 난이도를 받아 모델/계정 별칭을 추천한다.

```bash
pnpm agent:route -- --task "Docker 설치 방법 정리"
pnpm agent:route -- --task "자동매매 로직 설계" --complexity complex
pnpm agent:route -- --config tools/agent-orchestrator/usage-budget.low.example.json --task "자동매매 로직 설계" --complexity complex --write-decision
```

이 명령은 실제 계정을 전환하지 않고 `usage-budget.example.json` 형태의 로컬 예산 설정을 기반으로 추천만 출력한다.
`--write-decision`은 사용량 부족 시 `DECISIONS_REQUIRED.md`에 작업 분해/사용자 승인 선택지를 남긴다.

## Usage budget CLI

`pnpm agent:budget`은 reset day까지 남은 기간과 주말 예비분을 기준으로 오늘 권장 사용량을 계산한다.

```bash
pnpm agent:budget
pnpm agent:budget -- --date 2026-05-09 --json
```

## Automation integration

자동화 연동 기준은 `../../docs/automation-integration.md`를 따른다. MVP 자동화는 `agent:status`, `agent:doctor`, `agent:progress`, `agent:next`, `dashboard:prepare` 같은 read-only 또는 handoff 갱신 중심 명령만 대상으로 한다.

```bash
pnpm agent:scheduled-check
pnpm agent:scheduled-check -- --write-next --prepare-dashboard
pnpm agent:scheduled-check -- --write-report
```

보류 결정 알림 기준은 `../../docs/decision-notifications.md`를 따른다. 기본 구현은 외부 메시지를 보내지 않고 pending decision 수와 level을 로컬 출력/report/dashboard에 표시한다.

## 원칙

- 이 디렉터리는 계정 제한 우회용이 아니다.
- 각 worker는 사용자가 정상 인증한 도구/세션에서만 동작한다.
- 자동 실행은 `approval-policy.yaml`의 `auto_allowed` 범위로 제한한다.
- 위험하거나 불확실한 작업은 handoff/decision queue로 넘긴다.

## 환경 점검

새 PC나 새 에이전트 세션에서는 먼저 아래 명령으로 sync 환경을 확인한다.

```bash
pnpm agent:doctor
```

이 명령은 git hooks, `.claude-sync`, 로컬 `~/.claude` 경로, git UTF-8 설정, 현재 sync 상태를 점검한다.
