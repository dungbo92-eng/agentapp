# Changelog

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
