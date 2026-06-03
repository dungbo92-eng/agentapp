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

### DEC-20260516-002 — Gemini CLI 인증 + dashboard 계정 등록

- Status: pending
- Priority: medium
- Category: worker
- Requested by: agent
- Blocks: `pnpm agent:cycle-test -- --worker gemini-cli --execute` (현재 라우팅 후보 0건)
- Context: Gemini CLI 0.41.2가 설치돼 있지만 `gemini -p`가 `Please set an Auth method in your C:\Users\lee\.gemini\settings.json or specify GEMINI_API_KEY / GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_GENAI_USE_GCA` 안내로 종료한다. dashboard runtime에도 등록된 Gemini 계정이 없다.
- Options:
  - A: GEMINI_API_KEY 발급 후 환경 변수 또는 dashboard secret으로 등록 → 무료 한도 + API 키 인증으로 가장 단순.
  - B: `gemini` 인터랙티브 모드로 Google 계정 OAuth 로그인 완료 → GCA 인증 후 dashboard에서 Add account → session profile 생성.
  - C: Vertex AI(GOOGLE_GENAI_USE_VERTEXAI) 경로 → 기업 계정/프로젝트 설정 필요.
- Recommended: B. Google OAuth가 사용자가 보유한 Gemini Pro 한도를 그대로 사용하고 비밀값 저장도 피한다.
- Decision needed: Gemini 인증 방식과 사용할 계정 한 가지.
- After decision: 인증 완료 후 dashboard에서 Add account → provider=Gemini → 해당 login method 선택 → ready 전환 → `pnpm agent:cycle-test -- --worker gemini-cli --execute` 재실행.
- Created: 2026-05-16

## 해결됨

### DEC-20260516-003 — Claude dashboard 한도 잠금 일치성 확인

- Status: resolved
- Priority: low
- Category: usage_budget
- Requested by: agent
- Blocks: (해소됨) `pnpm agent:cycle-test -- --worker claude-code --execute` false-positive 잠금
- Context: leemg 계정의 `quotaReason`이 `tool_result` 본문 JSON이라 false-positive 24h 잠금 의심.
- Decision: Option C 채택 — 근본 원인(코드 수정)으로 해결. `worker-launch-adapter.mjs`의 stream-json onLine 훅에서 `quotaScanLine` 가드를 두어, JSON envelope 라인은 `parseQuotaReset`에 절대 넘기지 않고 Claude의 `result` 이벤트 `finalText` 또는 plain text fallback 만 검사한다. tool_result/assistant text의 인용 문구가 잠금을 일으키는 경로가 차단됐다.
- Resolved: 2026-05-16
- Result: `scripts/worker-launch-adapter.mjs` (commit 이전 작업분에 포함). `validate-quota-parser`에 검증 케이스 2개 추가 (tool_result/assistant text → finalText 미노출, 진짜 result 이벤트 → finalText 노출). 사용자가 leemg 계정의 기존 false-positive 잠금만 dashboard '강제 해제' 버튼으로 1회 풀면 이후 정상 동작.

### DEC-20260509-003 — 주간 사용량 입력 방식

- Status: resolved
- Priority: high
- Category: usage_budget
- Requested by: user
- Blocks: (해소됨) 사용량 예산/모델 라우팅 CLI
- Context: 원래 "수동 입력 vs 사용자 제공 read-only 화면 값" 둘 중 하나를 결정해야 했음.
- Decision: 둘 다 채택하지 않고 **CLI 자동 인식** 으로 우회. worker 가 quota/rate-limit 오류를 출력하면 `parseQuotaReset` 가 reset 시각을 추출하고 `applyQuotaLockout` 이 해당 계정을 자동 잠금. reset 시각이 지나면 selectRoute 단계에서 자동 복구. 사용자는 화면 값 입력도, 수동 숫자 입력도 강제되지 않음 (수정은 가능하지만 선택사항).
- Resolved: 2026-05-16
- Result: `scripts/dashboard-runtime.mjs` 의 `parseQuotaReset`, `applyQuotaLockout`, `probeAccountLockout`, `clearAccountQuotaLockout` + `worker-launch-adapter.mjs` 의 `onLine` quota 감지 훅으로 구현. dashboard 사이드바에서 잠긴 계정의 reset 시각 표시와 '강제 해제' 버튼 제공.

### DEC-20260516-001 — 이 PC 에서 gh CLI 누락 → 자동 릴리즈 불가

- Status: resolved
- Priority: medium
- Category: deployment
- Requested by: agent
- Blocks: 토큰 폭주 수정 (`0a10bbd`) + Claude stream-json (`13b2304`) 의 자동 릴리즈
- Context: 이 PC 에서 `gh` 가 PATH 와 표준 경로에 없어 `pnpm desktop:release` 가 실패했다.
- Decision: 사용자가 gh CLI 를 설치하고 OAuth 인증 완료. `C:\Program Files\GitHub CLI\gh.exe` 절대경로로 PATH 임시 export 후 release 실행.
- Resolved: 2026-05-16
- Result: `pnpm desktop:release -- --bump minor` 로 `v0.3.0` 발행 (commit `79bbd7d`). Notes: 토큰 폭주 3대 원인 차단 + Claude Code stream-json 라이브 타임라인. NSIS Setup `AgentApp-Setup-0.3.0-x64.exe` + latest.yml + blockmap 업로드 확인. 기존 설치본은 다음 실행 시 자동 업데이트.
- Release URL: https://github.com/dungbo92-eng/agentapp/releases/tag/v0.3.0

### DEC-20260513-001 — GitHub Release 도구 점검

- Status: resolved
- Priority: high
- Category: deployment
- Requested by: agent
- Blocks: 코드 변경 push 후 자동 업데이트용 GitHub Release 발행
- Context: bare `gh`는 현재 세션 PATH에서 감지되지 않았지만, `C:\Program Files\GitHub CLI\gh.exe`가 설치되어 있고 인증도 정상임을 확인했다. `scripts/desktop-release.mjs`의 fallback이 해당 경로를 사용해 릴리즈를 발행했다.
- Decision: GitHub CLI 설치/인증 확인 후 자동 릴리즈 진행.
- Resolved: 2026-05-13
- Result: `pnpm desktop:release -- --bump patch`로 `v0.2.1` GitHub Release를 발행했고 `latest.yml`, NSIS setup, blockmap 업로드를 확인했다.

### DEC-20260509-001 — 첫 UI 구현 방식

- Status: resolved
- Priority: medium
- Category: product
- Requested by: agent
- Blocks: Dashboard Phase 착수 방식
- Context: CLI 기반 동기화, 정책, 큐, worker adapter, 사용량 예산 기능이 먼저 안정화되었고 이제 read-only 로컬 웹 대시보드를 진행할 수 있다.
- Decision: 로컬 웹 대시보드를 착수한다. 기술 선택은 `docs/dashboard-technology.md` 기준 `Vite + React + TypeScript` read-only SPA로 한다.
- Resolved: 2026-05-10
- Result: `dashboard-decision-screen`의 decision block을 해제하고 `dashboard-tech-selection` 완료 task를 큐에 추가했다.

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
