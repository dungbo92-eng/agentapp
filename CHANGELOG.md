# Changelog

## v0.1.0 - 2026-05-11

사용자 환경에서 실제 worker 실행까지 이어지는 설치/점검 흐름을 보강한 릴리즈.

### Added

- `pnpm agent:setup`: Node.js, Git, pnpm, Codex, Claude Code, Cursor, Gemini CLI 설치와 PATH/env override 진단.
- `pnpm agent:cycle-test`: 인증 완료 후 dashboard Start/worker/validation/handoff 한 사이클을 점검하는 통합 테스트 명령.
- dashboard 환경 패널: AI CLI 누락 상태와 설치 명령 표시.

### Changed

- dashboard dev server와 desktop server의 runtime API를 맞춰 예산 수정, 로그인 시작, 세션 재감지가 개발/패키지 환경 모두에서 동작한다.
- dashboard UX에 빈 상태 안내, nav active 표시, 폼 validation, live 사용량 동기화를 추가했다.
- Windows portable EXE 산출물 이름과 artifact 기록이 `package.json` 버전을 따라가도록 변경했다.

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
