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
- v0.1.0 릴리즈 문서와 Windows portable EXE 재패키징을 완료했다. 산출물은 `dist-desktop/AgentApp-0.1.0-x64.exe`이고 SHA256은 `tools/agent-orchestrator/handoff/RELEASE_ARTIFACTS.md`에 기록했다.

## 진행률

- 전체 MVP 기준: 97%
- 문서/규칙 기반: 100%
- 실제 worker 실행 어댑터: 100%
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

1. Claude CLI 설치 또는 `AGENTAPP_CLAUDE_COMMAND` 설정 후 `pnpm agent:cycle-test -- --worker claude-code --execute` 실행.
2. Gemini CLI 설치 또는 `AGENTAPP_GEMINI_COMMAND` 설정 후 `pnpm agent:cycle-test -- --worker gemini-cli --execute` 실행.
3. Codex dashboard cycle이 60초 내 응답 없이 중지된 원인 확인. CLI 인증/세션 프로필을 재확인한 뒤 재실행.
4. Cursor 계정 ready 상태 준비 후 open-window cycle 확인.

## 열린 질문

- 현재 PC에서 Claude/Gemini CLI가 PATH에 없어 실제 실행 cycle은 설치 후 재검증이 필요하다.
- Codex는 dashboard Start와 `pnpm validate` preflight까지 통과했으나 60초 내 worker 출력이 없어 `agent:cycle-test`가 중지했다. 세션 인증 상태나 CLI 응답 대기 원인을 확인해야 한다.

## 최근 보고

- Updated: 2026-05-13T09:29:42.738Z
- Status: completed
- Summary: Claude quota reset dated lockout 수정분을 commit/push했고, 자동 업데이트용 v0.2.3 patch release를 발행했습니다.
- Verification: pnpm validate; pnpm dashboard:build; gh release view v0.2.3
- Git: commit b76d469 pushed; release commit 7967461 and tag v0.2.3 pushed
- Decisions: none
- Next: Claude/Gemini authenticated cycle 재검증

