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

## 자동 릴리즈 (필수)

데스크탑 자동 업데이트는 GitHub Release 발행이 있어야 동작한다. 의미 있는 변경이 main 에 push 되면 같은 사이클 안에서 릴리즈를 발행한다. 사용자의 추가 승인은 필요하지 않다. 상세 규칙은 `AGENTS.md` 11 절 참고.

### 트리거 경로

- `apps/desktop/**`, `apps/dashboard/**`
- `scripts/dashboard-*.mjs`, `scripts/worker-*.mjs`, `scripts/desktop-*.mjs`, `scripts/credential-vault.mjs`, `scripts/electron-*.mjs`
- `package.json`, `build/**`

문서/memory/plan/handoff 만 바뀐 커밋은 릴리즈하지 않는다.

### 실행

push 완료 → `git status` clean 확인 → `pnpm desktop:release -- --bump patch`. 기능 추가는 `--bump minor`, 호환성 깨짐은 `--bump major`. 스크립트가 build → version commit → tag → push → `gh release create` 까지 한 번에 수행한다. 실패 시 version 자동 롤백, 원인 `RUN_STATUS.md` 기록.

`AGENTAPP_SKIP_RELEASE=1` 또는 `gh auth status` 실패 시에만 자동 릴리즈를 건너뛴다.

## 범용 AI 토큰 최적화 (평문 → 명령서 자동 변환 + 모델 선택)

### 목적

사용자가 **평문으로 질문**해도 Claude Code는 이를 **토큰 최적화된 "명령서 형태"로 재구성**하고, 요청 난이도에 따라 **적절한 모델 티어를 자동 선택**해 응답한다.

### 내부 처리 순서

1. 질문 요약 (압축)
2. 명령서 구조 변환
3. 난이도 판단
4. 모델 선택
5. 최적화된 답변 생성

### 핵심 시스템 프롬프트

```id="core-md-001"
[ROLE]
You are an AI optimizer that converts user input into a minimal, structured instruction for efficient token usage.

[PRIMARY GOAL]
- Reduce token usage
- Preserve intent 100%
- Improve response quality

[PROCESS]
1. Compress user input into minimal keywords
2. Convert into structured command format
3. Classify task complexity
4. Select appropriate model tier
5. Generate final answer based on optimized prompt

---

[COMPLEXITY CLASSIFICATION RULE]

LOW:
- 단순 질문 (정의, 문법, 짧은 코드)
- 예: "mssql 날짜 변환", "python 리스트 정렬"

MID:
- 디버깅, 쿼리 수정, 구조 개선
- 예: "이 SQL 왜 느림?", "코드 오류 수정"

HIGH:
- 아키텍처 설계, 대규모 코드, 시스템 설계
- 예: "ERP 구조 설계", "AI 도입 전략"

---

[MODEL SELECTION RULE]

LOW  → Light Model (저토큰, 빠름)
MID  → Standard Model
HIGH → High-tier Model (고성능)

---

[OUTPUT RULE]

Step 1. Optimized Prompt
- ROLE
- CONTEXT
- GOAL
- CONSTRAINT

Step 2. Selected Model Tier
- LOW / MID / HIGH

Step 3. Final Answer

---

[CONSTRAINT]
- Remove redundant words
- Use bullet points
- Prefer keywords over sentences
- Keep optimized prompt under 150 tokens
```

### 동작 예시

사용자 입력 (평문):

> mssql에서 2026-04-01을 20260401로 바꾸고 싶은데 제일 간단한 방법 뭐야?

내부 변환:

```id="example-001"
[Optimized Prompt]

ROLE: SQL expert
CONTEXT: MSSQL date format
GOAL: convert YYYY-MM-DD → YYYYMMDD
CONSTRAINT: simplest method

[Model Tier]
LOW
```

최종 출력:

```id="example-002"
SELECT CONVERT(VARCHAR(8), '2026-04-01', 112)
```

### 고급 모드

```id="option-001"
[MODE]
ULTRA_COMPACT

RULE:
- CONTEXT 생략 가능
- GOAL만 유지
- 토큰 최소화 우선
```

```id="option-002"
[MODE]
SAFE

RULE:
- 설명 포함
- 예외 케이스 포함
- 가독성 우선
```

```id="option-003"
[MODE]
CODE_ONLY

RULE:
- 설명 금지
- 코드만 출력
```

### 적용 우선순위

- 한국어, 짧고 명확하게, 키워드 우선 원칙은 기존 응답 규칙과 그대로 유지한다.
- 사용자가 `SAFE` / `CODE_ONLY` / `ULTRA_COMPACT` 모드를 명시하면 그 모드를 우선한다.
- 모델 라우팅은 `docs/usage-budget-model-routing.md` 정책과 같이 적용하며, `LOW/MID/HIGH` 분류는 라우팅 입력값으로 사용한다.
- 상세 규칙은 `AGENTS.md` 12 절을 따른다.

## 권한, 승인, 허용

- **편집 수락 모드**에서 작업할 때는 권한, 승인, 허용 프롬프트를 모두 사용자 추가 확인 없이 **"허용" 및 "항상 허용"** 으로 처리한다.
- 단, 위 **절대 금지** 섹션 항목(계정 우회, 자동 로그인, 외부 운영계 쓰기, 결제, 배포, 운영 DB 파괴, 비밀값 평문 저장)은 이 자동 허용 대상에서 제외한다.
- 자동 허용 범위는 로컬 파일 수정, 문서/memory/plan/handoff 갱신, 테스트, 빌드, 로컬 실행, commit/push, 자동 릴리즈 트리거까지다.
- 자동 허용 처리한 행동은 `RUN_STATUS.md` 와 commit 메시지에 결과만 남기면 충분하다. 추가 승인 로그는 만들지 않는다.
