# DECISIONS_REQUIRED

사용자 결정이 필요한 항목을 모은 큐다. 에이전트는 `approval-policy.yaml`의 `hold_for_user` 또는 `deny`에 해당하는 작업을 임의 실행하지 않고, 여기 구조에 맞춰 기록한다.

## 기록 규칙

- 새 항목은 `대기` 아래에 추가한다.
- 해결된 항목은 `해결됨` 아래로 옮기고 `Resolved`를 채운다.
- 비밀값, 토큰, 계정명, 이메일, 세션 정보는 기록하지 않는다.
- 결정 없이 진행 가능한 로컬 작업은 멈추지 말고 완료한다.
- 결정이 필요한 작업만 명확히 분리한다.

## 항목 템플릿

```md
### DEC-YYYYMMDD-001 — 짧은 제목

- Status: pending
- Priority: high | medium | low
- Category: product | safety | git | usage_budget | worker | deployment | other
- Requested by: user | agent
- Blocks: 어떤 작업이 막히는지
- Context: 왜 결정이 필요한지
- Options:
  - A: 선택지와 영향
  - B: 선택지와 영향
- Recommended: 권장 선택과 이유
- Decision needed: 사용자가 답해야 할 짧은 질문
- After decision: 결정 후 에이전트가 수행할 작업
- Created: YYYY-MM-DD
```

## 대기

### DEC-20260509-001 — 첫 UI 구현 방식

- Status: pending
- Priority: medium
- Category: product
- Requested by: agent
- Blocks: Dashboard Phase 착수 방식
- Context: 제품 첫 화면을 CLI 중심으로 유지할지, 로컬 웹 대시보드를 바로 만들지 결정이 필요하다.
- Options:
  - A: CLI 우선 유지. 빠르게 안전 정책, handoff, 예산 라우팅 CLI를 완성할 수 있다.
  - B: 로컬 웹 대시보드 착수. 사용성은 좋아지지만 MVP 스코프가 커진다.
- Recommended: A. 현재는 동기화/정책/큐가 먼저 단단해야 한다.
- Decision needed: 첫 UI는 CLI 우선인가, 로컬 웹 대시보드 우선인가?
- After decision: roadmap 우선순위와 다음 task selection 로직에 반영한다.
- Created: 2026-05-09

### DEC-20260509-003 — 주간 사용량 입력 방식

- Status: pending
- Priority: high
- Category: usage_budget
- Requested by: user
- Blocks: 사용량 예산/모델 라우팅 CLI 구현
- Context: Claude Pro, Codex Plus 등 정상 보유 계정의 남은 주간 사용량을 어떻게 입력받을지 정해야 한다.
- Options:
  - A: 사용자 수동 입력만 허용. 가장 안전하고 비밀값/세션 접근이 없다.
  - B: 사용자가 명시 제공한 read-only 화면 값까지 허용. 편하지만 브라우저/화면 접근 정책이 추가로 필요하다.
- Recommended: A로 MVP를 시작한다. B는 별도 승인 정책과 read-only 검증 후 추가한다.
- Decision needed: 사용량 입력은 수동 입력만 허용할까, 사용자가 명시 제공한 read-only 화면 값까지 허용할까?
- After decision: 계정 수/요금제/남은 주간 사용량 설정 스키마와 budget CLI에 반영한다.
- Created: 2026-05-09

## 해결됨

### DEC-20260509-000 — git remote URL

- Status: resolved
- Priority: high
- Category: git
- Requested by: user
- Blocks: GitHub push 기반 동기화
- Context: 여러 에이전트/PC가 같은 상태를 보려면 remote가 필요했다.
- Decision: `git@github.com:dungbo92-eng/agentapp.git`
- Resolved: 2026-05-09
- Result: `origin` 등록, `main` push 완료.

### DEC-20260509-002 — worker 실행 범위

- Status: resolved
- Priority: high
- Category: worker
- Requested by: agent
- Blocks: Worker adapter Phase의 자동화 범위
- Context: AgentApp이 프롬프트와 handoff만 생성할지, 일부 CLI 실행까지 자동으로 맡을지 결정이 필요했다.
- Decision: 개발 구현, 문서화, 테스트, 로컬 검증, memory/plan/handoff 갱신, commit/push는 추가 확인 없이 계속 진행한다.
- Resolved: 2026-05-09
- Result: `auto_allowed` 범위의 로컬 작업은 에이전트가 자율 진행한다. `hold_for_user`와 `deny`에 해당하는 작업만 decision queue로 넘긴다.
