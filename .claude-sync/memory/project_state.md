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

## 진행률

- 전체 MVP 기준: 49%
- 문서/규칙 기반: 45%
- 실제 worker 실행 어댑터: 0%
- 주간 사용량/모델 라우팅: 10%
- UI/dashboard: 0%

## 결정된 원칙

- 계정 제한 우회형 자동 계정 전환은 만들지 않는다.
- 정상 인증된 에이전트/도구의 작업 이어받기와 handoff는 지원한다.
- 자동 승인은 allowlist 기반으로 제한한다.
- 사용자 결정 필요 항목은 `DECISIONS_REQUIRED.md`에 모은다.
- 검증된 변경은 로컬 commit으로 남기고, remote가 설정된 경우 사용자 승인 범위 안에서 push까지 수행한다.
- 주간 사용량 관리는 정상 보유 계정의 로컬 예산 배분이며 제한 우회가 아니다.
- 모델 선택은 품질 우선이다. 단순 작업은 효율 모델, 복잡한 설계/추론은 최고 품질 모델을 추천한다.
- 개발 구현은 사용자 의사결정을 기다리지 않고 `auto_allowed` 범위에서 계속 진행한다.

## 다음 작업 후보

1. 안전 작업/보류 작업을 분류하는 dry-run 명령 추가.
2. worker별 프롬프트 템플릿 생성 명령 추가.
3. Codex 작업 프롬프트 생성 어댑터.
4. Claude Code 작업 프롬프트 생성 어댑터.
5. Cursor 작업 프롬프트 생성 어댑터.

## 열린 질문

- 첫 UI는 CLI 우선인가, 웹 대시보드 우선인가?
- 배포 대상은 아직 미정.
- 첫 GitHub push 후 다른 PC/에이전트는 `git clone git@github.com:dungbo92-eng/agentapp.git`로 동기화한다.
- 사용량 입력은 수동 입력 우선인가, 사용자가 명시 제공한 read-only 화면 값까지 허용할지 결정 필요.

## 최근 보고

- Updated: 2026-05-09T21:40:15.005Z
- Status: completed
- Summary: 로컬 웹 대시보드 기술을 Vite + React + TypeScript read-only SPA로 결정하고 docs/dashboard-technology.md에 근거와 초기 구조를 기록했다. 첫 UI 결정도 로컬 대시보드 착수로 해결 처리하고 task queue를 다음 화면 작업으로 열었다.
- Verification: pnpm validate 통과; pnpm agent:progress=67%; pnpm agent:next=진행률/다음 작업/보류 결정 화면; pnpm agent:dry-run 로컬 대시보드 파일 생성 auto_allowed 확인
- Git: pending commit/push
- Decisions: DEC-20260509-001 resolved
- Next: 진행률/다음 작업/보류 결정 화면

