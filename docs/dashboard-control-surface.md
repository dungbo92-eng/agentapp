# Dashboard Control Surface

AgentApp dashboard는 단순 상태판이 아니라 Claude, Codex, Cursor, Gemini 같은 worker를 한 화면에서 준비하고 실행 상태를 이어받게 하는 통합 콘솔이다.

## 현재 화면

- 좌측: 로컬 프로젝트 등록, 계정 등록, enable 토글, 세션 ready 표시
- 중앙: 다음 계획, worker 선택, 난이도 선택, 프로젝트 선택, 프롬프트 입력, Start/Stop
- 우측: 사용량 예산과 다음 queue
- 하단: active run, 연결 정책, handoff 문서, plan, 명령, worker 상태

## 계정 연결 기준

실제 로그인은 Claude, Codex, Cursor 등의 공식 앱이나 CLI에서 사용자가 정상 인증한 세션을 사용한다. AgentApp은 계정을 고정 조합으로 만들지 않고, 사용자가 필요한 만큼 동적으로 추가하는 로컬 설정을 관리한다.

- 표시 이름
- AI tool: Claude, Codex, Cursor, Gemini 등
- login method: Google, email/password, API key, local CLI session, browser profile
- email 또는 account id
- account alias
- session profile
- plan
- enable 여부
- session status: `needs-login`, `ready`, `paused`
- 남은 로컬 예산 단위
- 주간 예산 단위
- encrypted credential reference

password/API key를 사용자가 입력하면 repo가 아니라 local-only vault에 Windows DPAPI로 암호화해 저장하고, dashboard runtime에는 credential reference와 저장 여부만 남긴다. session cookie, OAuth token, captcha/MFA 우회 정보는 저장하지 않는다.

계정 수는 고정하지 않는다. 사용자는 Claude 1개, Codex 1개부터 Claude 2개와 Codex 2개, 또는 지인처럼 총 3개 계정 구성까지 필요한 만큼 등록할 수 있다. 라우팅은 `enabled=true`이고 `sessionStatus=ready`인 계정만 후보로 사용한다.

기본 예산 파일은 `tools/agent-orchestrator/usage-budget.example.json`이고, dashboard에서 추가한 임시 계정은 git에 올라가지 않는 `data/dashboard-runtime.json`에 저장된다.

## 세션 준비 흐름

1. dashboard 좌측 Accounts에서 `Add account`로 AI tool, login method, email/id, alias, session profile, 예산 단위를 입력한다.
2. 사용자가 공식 앱/CLI/브라우저 프로필에서 해당 계정으로 정상 로그인한다.
3. dashboard에서 해당 계정을 `Ready`로 표시한다.
4. Start 실행 시 worker, 모델 override, 난이도, 프로젝트, 로컬 예산을 기준으로 ready 계정과 모델이 자동 추천된다.
5. 사용하지 않을 계정은 삭제하지 않고 enable 토글을 off로 바꾼다.

자동 로그인, 자동 계정 전환, captcha/MFA 우회, 계정 제한 우회는 구현하지 않는다.

자세한 세션 프로필/credential vault 기준은 `docs/session-profile-routing.md`를 따른다.

## 프로젝트 등록 기준

현재 repo는 자동으로 `AgentApp` 프로젝트로 표시된다. 추가 프로젝트는 dashboard 좌측 Projects에서 로컬 경로로 등록한다.

새 프로젝트를 실제 관리 대상으로 연결할 때는 아래 기본 파일을 먼저 갖춘다.

- `AGENTS.md`
- `CLAUDE.md`
- `.claude-sync/memory/project_state.md`
- `.claude-sync/plans/<project-roadmap>.md`
- `tools/agent-orchestrator/handoff/NEXT_TASK.md`
- `tools/agent-orchestrator/task-queue.json`

## Start/Stop 기준

Start는 로컬 runtime에서 다음 정보를 생성한다.

- active run 상태
- 추천 계정, 모델, reasoning effort, 예상 예산
- `pnpm validate` preflight 결과
- worker adapter mode, prompt path, log path
- `tools/agent-orchestrator/handoff/DASHBOARD_RUN.md`
- `tools/agent-orchestrator/handoff/run-states/dashboard-current.json`

Stop은 active run을 중단 상태로 바꾸고 같은 handoff 파일을 갱신한다. 프롬프트 본문은 비밀값 유출을 피하기 위해 `data/dashboard-runtime.json`에만 local-only로 저장한다.

현재 adapter 동작은 아래와 같다.

- Codex: session profile별 `CODEX_HOME` 디렉터리로 `codex exec` 실행
- Cursor: session profile별 `--user-data-dir`로 창 오픈
- Claude Code, Gemini CLI: 아직 machine-specific command profile이 없으면 manual fallback

## 다음 구현 후보

- Claude Code command-mode adapter profile
- Gemini CLI command-mode adapter profile
- tool별 login/session-expired detector 보강
- credential vault 복호화가 필요한 worker adapter별 안전 경계

## EXE packaging 방향

최종 실행파일은 로컬 API와 dashboard UI를 한 프로세스에서 띄우는 desktop shell 형태로 만든다.

- 현재 후보: Electron
- 기본 포트 충돌 없이 내부 localhost API 실행
- `data/` local-only 설정 유지
- 빌드 산출물에 secret 미포함
- Windows `.exe`와 portable zip을 우선 목표로 한다.

세부 명령과 구조는 `docs/windows-exe-packaging.md`를 따른다.
