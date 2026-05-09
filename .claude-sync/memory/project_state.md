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

## 진행률

- 전체 MVP 기준: 24%
- 문서/규칙 기반: 45%
- 실제 worker 실행 어댑터: 0%
- UI/dashboard: 0%

## 결정된 원칙

- 계정 제한 우회형 자동 계정 전환은 만들지 않는다.
- 정상 인증된 에이전트/도구의 작업 이어받기와 handoff는 지원한다.
- 자동 승인은 allowlist 기반으로 제한한다.
- 사용자 결정 필요 항목은 `DECISIONS_REQUIRED.md`에 모은다.
- 검증된 변경은 로컬 commit으로 남기고, remote가 설정된 경우 사용자 승인 범위 안에서 push까지 수행한다.

## 다음 작업 후보

1. handoff 템플릿(`NEXT_TASK.md`, `RUN_STATUS.md`, `DECISIONS_REQUIRED.md`) 확정.
2. roadmap 체크박스 기반 진행률 계산 고도화.
3. Codex/Claude/Cursor/Gemini 각각의 수동 실행 프롬프트 템플릿 작성.
4. 안전 작업/보류 작업을 분류하는 dry-run 명령 추가.
5. worker registry를 읽는 CLI 명령 추가.

## 열린 질문

- 첫 UI는 CLI 우선인가, 웹 대시보드 우선인가?
- worker 실행은 완전 자동 실행보다 “준비된 프롬프트/명령 열기” 수준부터 시작할지 결정 필요.
- 배포 대상은 아직 미정.
- 첫 GitHub push 후 다른 PC/에이전트는 `git clone git@github.com:dungbo92-eng/agentapp.git`로 동기화한다.
