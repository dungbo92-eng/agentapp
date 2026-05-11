# Changelog

## v0.1.0 - 2026-05-11

사용자 환경에서 실제 worker 실행까지 이어지는 설치/점검 흐름을 보강한 릴리즈.

### Added

- `pnpm agent:setup`: Node.js, Git, pnpm, Codex, Claude Code, Cursor, Gemini CLI 설치와 PATH/env override 진단.
- `pnpm agent:cycle-test`: 인증 완료 후 dashboard Start/worker/validation/handoff 한 사이클을 점검하는 통합 테스트 명령.
- dashboard 환경 패널: AI CLI 누락 상태와 설치 명령 표시, **[누락 AI CLI 자동 설치] 버튼과 실시간 설치 로그**.
- `POST /api/agentapp/environment/install` runtime API: dev/desktop 양쪽에서 누락 CLI 를 npm install -g 로 자동 설치하고 stdout/stderr 를 로그로 반환.
- `installMissingTargets` runtime export: Electron 패키지 안에서도 콘솔 없이 stdout/stderr 캡처가 가능하도록 분리.
- **NSIS installer 빌드 추가** (`pnpm desktop:installer` / `pnpm desktop:all`): 표준 Windows 설치 마법사(경로 선택, 바탕화면/시작 메뉴 바로가기, 제어판 등록) + 설치 마지막 단계에 "필수 환경(Node.js + AI CLI) 자동 설치" 동의 prompt.
- `build/installer.nsh`, `build/setup-tools.cmd`: NSIS 커스터마이즈 + winget/npm 기반 환경 자동 설치 스크립트.
- 세션 프로필 경로 PC-전역화 (`%APPDATA%\AgentApp\session-profiles\`) — portable EXE, NSIS installer, dev server 가 동일 인증을 공유. 옛 `repo/data/session-profiles/` 는 첫 실행 시 자동 마이그레이션.

### Changed

- dashboard dev server와 desktop server의 runtime API를 맞춰 예산 수정, 로그인 시작, 세션 재감지가 개발/패키지 환경 모두에서 동작한다.
- dashboard UX에 빈 상태 안내, nav active 표시, 폼 validation, live 사용량 동기화를 추가했다.
- Windows portable EXE 산출물 이름과 artifact 기록이 `package.json` 버전을 따라가도록 변경했다.
- NSIS installer 안정화를 위해 post-install custom prompt를 제거하고, 환경 설치는 설치 후 dashboard 환경 패널에서 실행하도록 정리했다.

### Verified

- `pnpm validate`
- `pnpm dashboard:build`
- `pnpm agent:setup`
- `pnpm agent:cycle-test`
- `pnpm desktop:pack`
- `pnpm desktop:artifact`

## v0.0.1 - 2026-05-10

Initial AgentApp MVP release.

### Added

- 공통 에이전트 규칙: `AGENTS.md`, `CLAUDE.md`
- 프로젝트별 memory/plan/handoff 동기화: `.claude-sync`, git hooks, `pnpm agent:sync`
- 작업 운영 CLI: `agent:doctor`, `agent:progress`, `agent:next`, `agent:report`, `agent:prompt`
- 승인 정책과 dry-run 분류: auto allowed, hold for user, deny
- worker prompt adapter: Codex, Claude Code, Cursor, Gemini CLI
- quota/중단/fallback 상태 모델
- 주간 사용량 예산과 품질 우선 모델 라우팅
- 로컬 dashboard MVP: progress, next task, worker status, handoff viewer, approval queue, usage budget
- scheduled check: sync, progress, decision, git, budget 상태 요약
- 제품화 문서: 설치 가이드, 보안 모델, plugin/MCP 확장 전략, 테스트 시나리오

### Verified

- `pnpm validate`
- `pnpm dashboard:build`
- `pnpm agent:doctor`
- `pnpm agent:scheduled-check -- --json`

### Tag

- `v0.0.1`
