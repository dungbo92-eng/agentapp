# AgentApp — Claude Code 작업 규칙

이 파일은 Claude Code가 자동으로 읽는 지시서다. Codex와 기타 에이전트는 `AGENTS.md`를 우선 읽지만, 모든 규칙은 같은 의미로 적용한다.

## 핵심

- 작업 루트: `E:\agentApp`
- 프로젝트 목적: 여러 AI 개발 에이전트가 같은 memory/plan/handoff를 공유하며 안전한 개발 작업을 이어받게 하는 멀티 에이전트 오케스트레이터
- `.claude-sync`는 Claude 전용이 아니라 모든 에이전트 공용 memory/plan 동기화 저장소다.
- 모델 선택은 품질 우선이다. 단순 작업은 효율 모델, 복잡한 설계/추론 작업은 최고 품질 모델을 사용하도록 추천한다.
- 주간 사용량 관리는 정상 보유 계정의 로컬 예산 배분이며, 자동 로그인/자동 계정 전환/제한 우회가 아니다.
- 개발 구현, 문서화, 테스트, 로컬 검증, memory/plan/handoff 갱신, commit/push는 추가 확인 없이 계속 진행한다.

## 절대 금지

- 계정 제한, 토큰 제한, 요금제 제한, 승인 절차 우회 자동화
- 자동 로그인, 자동 계정 전환, 승인창 무조건 클릭
- 사용자 명시 승인 없는 외부 운영계 쓰기, 결제, 배포, 운영 DB 파괴적 변경
- 비밀값을 코드/주석/로그/문서/MCP 설정에 평문 저장

## 허용되는 자동 진행

- 로컬 코드 수정
- 문서, memory, plan, handoff 갱신
- 테스트, 타입체크, 빌드
- 로컬 실행 및 read-only 점검
- 다음 작업 프롬프트 생성

## 작업 시작 순서

1. `AGENTS.md`를 함께 읽고 공통 규칙을 확인한다.
2. `.claude-sync/memory/project_state.md`를 읽는다.
3. `.claude-sync/plans/agent-orchestrator-roadmap.md`를 읽는다.
4. `tools/agent-orchestrator/approval-policy.yaml`을 읽는다.
5. `docs/security-model.md`를 읽고 비밀값/계정/외부 쓰기/git 경계를 확인한다.
6. `docs/usage-budget-model-routing.md`를 읽고 작업 난이도에 맞는 모델/예산 정책을 확인한다.
7. `docs/handoff-completion-protocol.md`를 읽고 완료/중단 시 갱신 규칙을 확인한다.
8. `tools/agent-orchestrator/task-queue.json`을 확인한다.
9. `tools/agent-orchestrator/handoff/NEXT_TASK.md`를 확인한다.
10. `git status`로 현재 변경 사항을 확인한다.

## 동기화

```bash
pnpm agent:status
pnpm agent:dry-run -- --operation "pnpm validate"
pnpm agent:fallback -- --worker codex --summary "현재 환경에서 직접 실행 불가"
pnpm agent:codex-prompt -- --write
pnpm agent:claude-prompt -- --write
pnpm agent:cursor-prompt -- --write
pnpm agent:prompt -- --all --write
pnpm agent:doctor
pnpm agent:sync
pnpm agent:next
pnpm agent:progress
pnpm validate
```

commit 시 pre-commit hook이 `~/.claude`의 memory/plan을 `.claude-sync`에 push하고 자동 stage한다. pull/checkout 후에는 `.claude-sync`를 `~/.claude`로 pull한다.

의미 있는 작업 완료 후 검증이 끝나면 로컬 git commit을 만든다. remote push는 remote URL이 설정되고 사용자 승인 범위가 명확할 때만 수행한다.

## 완료 보고

작업이 끝나면 아래를 갱신한다.

- `.claude-sync/memory/project_state.md`
- `.claude-sync/plans/agent-orchestrator-roadmap.md` 또는 관련 plan
- `tools/agent-orchestrator/handoff/RUN_STATUS.md`
- 필요 시 `tools/agent-orchestrator/handoff/DECISIONS_REQUIRED.md`

응답은 한국어로 짧고 명확하게 작성한다.

## 프로젝트별 기본 동기화 원칙

- AgentApp이 관리하는 모든 프로젝트는 공통 memory, plan, handoff, git sync 기준을 기본 포함 사항으로 둔다.
- 새 프로젝트는 기능 개발보다 먼저 `AGENTS.md`, `CLAUDE.md`, `.claude-sync`, task queue, handoff 문서, git remote/branch 점검 흐름을 갖춘다.
- 세부 기준은 `docs/project-baseline-sync.md`를 따른다.
