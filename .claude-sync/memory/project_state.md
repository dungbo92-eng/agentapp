# Project State

Last updated: 2026-05-10

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

## 진행률

- 전체 MVP 기준: 93%
- 문서/규칙 기반: 100%
- 실제 worker 실행 어댑터: 0%
- 주간 사용량/모델 라우팅: 100%
- UI/dashboard: 100%

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

1. worker별 session profile launch adapter.
2. Codex/Claude/Cursor/Gemini 실행 로그 수집.
3. 세션 만료 감지 시 needs-login handoff.
4. validation 결과를 dashboard active run에 연결.

## 열린 질문

- 실제 worker 자동 실행 어댑터는 session profile별 공식 앱/CLI 실행 경계를 더 정해야 한다.
- 세션 만료/보안 확인 감지 신호는 worker별로 별도 정의가 필요하다.

## 최근 보고

- Updated: 2026-05-10T13:59:56.452Z
- Status: completed
- Summary: dashboard 계정 설정을 고정 조합에서 동적 Add account 흐름으로 전면 교체했다. provider/login method/email/session profile/password/API key 입력을 지원하고, secret은 Windows DPAPI local vault에 암호화 저장하며 runtime에는 credential reference만 남긴다. Start 화면에는 모델 override와 active run line log를 추가했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; vault-runtime-test 통과; in-app browser에서 Add account/AI tool/Google/Model/GPT-5.5/Prompt/Start 표시 확인
- Git: not recorded
- Decisions: none
- Next: worker별 session profile launch adapter

