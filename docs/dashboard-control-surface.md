# Dashboard Control Surface

AgentApp dashboard는 단순 상태판이 아니라 Claude, Codex, Cursor, Gemini 같은 worker를 한 화면에서 다루는 통합 콘솔로 확장한다.

## 현재 화면

- 좌측: 로컬 프로젝트 등록, 계정 별칭 등록
- 중앙: 다음 계획, worker 선택, 난이도 선택, 프롬프트 입력, Start/Stop
- 우측: 사용량 예산, 다음 queue
- 하단: active run, 연결 정책, handoff, plan, 명령, workers

## 계정 연결 기준

실제 로그인은 Claude, Codex, Cursor 등 각 공식 앱에서 사용자가 직접 유지한다. AgentApp dashboard에는 아래 값만 둔다.

- account alias
- provider
- plan
- 남은 로컬 예산 단위
- 주간 예산 단위

API key, password, session cookie, OAuth token은 저장하지 않는다.

기본 예산 파일은 `tools/agent-orchestrator/usage-budget.example.json`이고, 화면에서 추가한 임시 계정은 브라우저 localStorage에만 저장된다.

## 프로젝트 등록 기준

현재 repo는 자동으로 `AgentApp` 프로젝트로 표시된다. 추가 프로젝트는 dashboard 좌측 Projects에서 로컬 경로로 등록한다.

새 프로젝트를 실제 관리 대상으로 승격할 때는 아래 기준 파일을 먼저 갖춘다.

- `AGENTS.md`
- `CLAUDE.md`
- `.claude-sync/memory/project_state.md`
- `.claude-sync/plans/<project-roadmap>.md`
- `tools/agent-orchestrator/handoff/NEXT_TASK.md`
- `tools/agent-orchestrator/task-queue.json`

## Start/Stop 기준

현재 Start/Stop은 dashboard 화면에서 run 상태를 관리하는 UX MVP다. 실제 worker 프로세스 실행은 다음 단계에서 로컬 API로 연결한다.

다음 단계의 실행 API는 아래 경계를 따른다.

- 실행 전 `approval-policy.yaml`로 작업을 분류한다.
- 자동 허용 작업만 로컬 프로세스로 시작한다.
- 중단은 active run 상태와 handoff를 남긴다.
- 외부 쓰기, connector 권한 변경, 계정 작업은 실행하지 않고 decision queue에 남긴다.

## 다음 구현 후보

- dashboard dev server에 local API 추가
- Start가 `pnpm agent:route`, `agent:prompt`, worker adapter를 순서대로 호출
- Stop이 로컬 child process를 종료하고 `RUN_STATUS.md`에 중단 상태 기록
- 프로젝트 registry를 `data/` 아래 local-only 파일로 저장
- 계정 예산 편집을 secret 없는 local-only 설정으로 저장
