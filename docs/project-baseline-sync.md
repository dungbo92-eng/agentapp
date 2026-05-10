# Project Baseline Sync

AgentApp에서 관리하는 각 프로젝트는 worker 종류와 무관하게 같은 기본 운영 골격을 가져야 한다. 이 문서는 새 프로젝트를 등록하거나 기존 프로젝트를 점검할 때 적용하는 공통 기준이다.

## 기본 포함 사항

- 프로젝트별 공통 memory 저장소
- 프로젝트별 plan/roadmap 저장소
- handoff 문서와 다음 작업 문서
- git remote, branch, commit, push 상태 확인
- local memory와 repo memory의 동기화 명령
- 작업 완료 시 검증, report, next task 생성, sync, commit, push 흐름

## 표준 파일

```text
AGENTS.md
CLAUDE.md
.claude-sync/memory/project_state.md
.claude-sync/plans/<project-roadmap>.md
tools/agent-orchestrator/handoff/NEXT_TASK.md
tools/agent-orchestrator/handoff/RUN_STATUS.md
tools/agent-orchestrator/handoff/DECISIONS_REQUIRED.md
tools/agent-orchestrator/task-queue.json
```

## 표준 명령

```bash
pnpm agent:doctor
pnpm agent:status
pnpm agent:sync
pnpm agent:next
pnpm agent:progress
pnpm agent:report
pnpm validate
```

## 동작 원칙

- 새 프로젝트는 개발 작업보다 먼저 memory, plan, handoff, git sync 기준을 갖춘다.
- 각 worker는 작업 시작 시 공통 memory와 plan을 읽고, 작업 종료 시 handoff와 report를 갱신한다.
- 검증된 변경은 로컬 commit으로 남기고, remote가 설정되어 있으며 사용자가 승인한 범위라면 push까지 수행한다.
- 프로젝트별 sync 기준은 계정, 토큰, 승인 절차를 우회하기 위한 자동화가 아니다. 정상 인증된 도구들이 같은 상태를 안전하게 이어받기 위한 운영 기본값이다.
- 운영 비밀값, 토큰, 쿠키, 계정 식별 정보는 memory, plan, handoff, git 문서에 저장하지 않는다.
