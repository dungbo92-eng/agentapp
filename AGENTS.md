# AgentApp — AI 에이전트 공통 작업 규칙

이 파일은 Codex, Claude Code, Cursor, Gemini CLI, 기타 MCP 기반 에이전트가 같은 컨텍스트로 진입하기 위한 프로젝트 헌법입니다.

- Codex: `AGENTS.md` 자동 로드
- Claude Code: `CLAUDE.md` 자동 로드
- 기타 에이전트: 이 파일과 `.claude-sync/memory/project_state.md`를 먼저 읽고 시작
- `.claude-sync` 이름은 역사적 호환성 때문에 유지하지만, 의미는 **모든 AI 에이전트 공용 memory/plan 동기화 저장소**다.

## 0. 최우선 안전 규칙

- 이 저장소 루트 `E:\agentApp`에서 작업한다.
- 이 프로젝트의 목적은 **여러 에이전트의 작업 상태를 안전하게 이어받게 하는 것**이다.
- 계정 제한, 요금제 제한, 토큰 제한, 플랫폼 승인 절차를 우회하는 자동화는 구현하지 않는다.
- 자동 로그인, 자동 계정 전환, 권한 승인창 무조건 클릭, 캡차/보안 절차 우회는 금지한다.
- MCP/커넥터/설정 파일에 운영 비밀값을 저장하지 않는다.
- 외부 서비스 `POST`, `PUT`, `PATCH`, `DELETE`, 배포, 결제, 운영 DB 파괴적 변경은 사용자 명시 승인 없이 실행하지 않는다.
- 로컬 파일 수정, 테스트, 빌드, 문서 갱신, read-only 점검은 자동 진행 가능하다.
- 개발 구현, 문서화, 테스트, 로컬 검증, memory/plan/handoff 갱신, commit/push는 사용자의 추가 확인 없이 계속 진행한다.

## 1. 프로젝트 한 줄

여러 AI 개발 에이전트가 동일한 memory/plan/handoff를 공유하면서, 의사결정이 필요 없는 개발 작업을 계속 이어가도록 돕는 **멀티 에이전트 개발 오케스트레이터**.

## 2. 제품 방향

- 여러 worker(Codex, Claude Code, Cursor, Gemini CLI 등)를 등록한다.
- 각 worker는 사용자가 정상 인증한 세션/도구 안에서만 동작한다.
- 작업은 roadmap과 task queue에서 선택한다.
- worker가 quota, 시간 제한, 오류, 결정 필요 상태로 멈추면 handoff 문서를 남긴다.
- 다음 worker는 handoff, memory, plan, git 상태를 읽고 이어서 진행한다.
- 승인 정책은 allowlist 기반으로 관리한다.
- 사용자가 정상 보유한 Claude Pro, Codex Plus 등 계정의 주간 사용량을 로컬 예산으로 관리한다.
- 품질을 최우선으로 하되, 단순 숙지/설치/문서 작업은 효율 모델을, 복잡한 설계/추론 작업은 최고 품질 모델을 추천한다.
- 토요일/일요일 작업이 끊기지 않도록 주말 예비 사용량을 남기는 모델 라우팅 로직을 둔다.

## 3. 새 PC에서 작업 시작

```bash
git clone <repo-url> agentApp
cd agentApp
pnpm install
pnpm agent:doctor
pnpm agent:status
pnpm agent:next
```

`pnpm install`의 postinstall은 다음을 수행한다.

- git hooks 설치: `.git/hooks/{pre-commit,post-merge,post-checkout}`
- `.claude-sync`와 `~/.claude` memory/plan 자동 동기화

## 4. 동기화 규칙

- **memory 갱신**: 의미 있는 진행이 발생하면 `.claude-sync/memory/project_state.md`를 갱신한다.
- **plan 갱신**: 큰 방향 전환, 단계 완료, 우선순위 변경 시 `.claude-sync/plans/agent-orchestrator-roadmap.md`를 갱신한다.
- **handoff 갱신**: 작업 종료 또는 중단 시 `tools/agent-orchestrator/handoff` 아래 문서를 갱신한다.
- **수동 sync**:
  - `pnpm agent:sync`: mtime 기준 양방향 동기화
  - `pnpm agent:status`: 차이 확인
  - `pnpm agent:pull`: repo → 로컬
  - `pnpm agent:push`: 로컬 → repo
- `pnpm claude:*` 명령은 Claude Code 호환 alias로 유지한다.
- commit 시 pre-commit hook이 `~/.claude` → `.claude-sync` push 후 자동 stage한다.
- pull/checkout 시 post-merge/post-checkout hook이 `.claude-sync` → `~/.claude` pull한다.
- 의미 있는 작업 완료 후 검증이 끝나면 로컬 git commit을 만든다.
- git remote가 설정된 뒤에는 사용자 승인 범위 안에서 push까지 수행해 여러 에이전트/PC가 같은 상태를 보게 한다.

## 5. Codex / MCP / 로컬 도구 세팅

### Windows UTF-8

Windows PowerShell 5.1은 기본 코드페이지가 949라 한글 파일명/UTF-8 문서가 깨질 수 있다. CurrentUserAllHosts 프로필에 아래 내용을 넣는다.

```powershell
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
chcp 65001 > $null
```

이 PC 기준 프로필 경로:

```text
C:\Users\lee\Documents\WindowsPowerShell\profile.ps1
```

### Git UTF-8

```bash
git config --global core.quotepath false
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8
```

### Docker Desktop / WSL2

Docker Desktop에서 `WSL_E_CONSOLE` 또는 legacy console 문제가 나면 아래 값을 적용 후 Docker Desktop을 재시작한다.

```powershell
Set-ItemProperty -Path HKCU:\Console -Name ForceV2 -Type DWord -Value 1
Set-ItemProperty -Path HKCU:\Console -Name CodePage -Type DWord -Value 65001
New-ItemProperty -Path HKCU:\Console -Name VirtualTerminalLevel -PropertyType DWord -Value 1 -Force
```

### 권장 MCP / 플러그인

- Browser/browser-use: 로컬 UI 검증, 스크린샷, 클릭 테스트
- Figma: 앱 화면 설계, 디자인 시스템, 컴포넌트 매핑
- GitHub: PR, issue, CI 확인이 필요할 때
- OpenAI Developers: OpenAI API 최신 문서 확인이 필요할 때
- 파일 시스템/터미널 MCP: 로컬 코드 수정 및 검증
- MCP/커넥터에는 운영 비밀값을 저장하지 않는다.
- 확장 도입 기준은 `docs/plugin-mcp-extension-strategy.md`를 따른다.

## 6. 에이전트 작업 흐름

1. `AGENTS.md` 또는 `CLAUDE.md`를 읽는다.
2. `.claude-sync/memory/project_state.md`를 읽는다.
3. `.claude-sync/plans/agent-orchestrator-roadmap.md`를 읽는다.
4. `tools/agent-orchestrator/approval-policy.yaml`을 확인한다.
5. `docs/security-model.md`를 확인하고 비밀값/계정/외부 쓰기/git 경계를 따른다.
6. `docs/usage-budget-model-routing.md`를 확인하고 작업 난이도에 맞는 모델/예산 정책을 따른다.
7. `docs/handoff-completion-protocol.md`를 확인하고 작업 종료 규칙을 따른다.
8. `tools/agent-orchestrator/task-queue.json`을 확인해 우선순위/의존성/보류 상태를 파악한다.
9. `tools/agent-orchestrator/handoff/NEXT_TASK.md`가 있으면 우선 확인한다.
10. 의사결정이 필요 없는 개발 작업이면 바로 진행한다.
11. 작업 후 테스트/검증 결과를 남긴다.
12. `project_state.md`, roadmap, handoff를 갱신한다.

## 7. 응답 / 코딩 규칙

- 응답은 한국어, 짧고 명령서처럼 명확하게 작성한다.
- 코드는 가능한 작고 검증 가능하게 변경한다.
- 신규 구조는 기존 문서와 스크립트 패턴을 따른다.
- 비밀값은 코드, 주석, 로그, 문서에 평문으로 남기지 않는다.
- 불확실한 운영/계정/결제/외부 쓰기 작업은 `DECISIONS_REQUIRED.md`에 남긴다.
- `DECISIONS_REQUIRED.md` 항목은 ID, 상태, 우선순위, 차단 범위, 선택지, 권장안, 결정 후 작업을 포함한다.
- 검증은 최소 `pnpm validate`를 수행한다.
- 완료된 변경은 git status/diff 확인 후 commit한다.

## 8. 자주 쓰는 명령

```bash
pnpm agent:status
pnpm agent:budget
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
pnpm agent:route -- --task "작업 설명" --complexity routine
pnpm agent:report -- "작업 요약"
pnpm agent:report -- --status completed --summary "작업 요약" --verify "pnpm validate"
pnpm validate
```

## 9. 다음 작업 기준

항상 `.claude-sync/memory/project_state.md`의 **다음 작업 후보**와 `tools/agent-orchestrator/handoff/NEXT_TASK.md`를 먼저 본다. 새 결정이 생기면 같은 파일들에 기록한다.

## 10. 프로젝트별 기본 동기화 원칙

- AgentApp이 관리하는 모든 프로젝트는 공통 memory, plan, handoff, git sync 기준을 기본 포함 사항으로 둔다.
- 새 프로젝트는 기능 개발보다 먼저 `AGENTS.md`, `CLAUDE.md`, `.claude-sync`, task queue, handoff 문서, git remote/branch 점검 흐름을 갖춘다.
- 세부 기준은 `docs/project-baseline-sync.md`를 따른다.

## 11. 자동 릴리즈 규칙 (필수)

설치된 데스크탑 앱은 GitHub Release 의 `latest.yml` 을 통해서만 자동 업데이트된다. **릴리즈 발행이 없으면 자동 업데이트도 없다**. 따라서 의미 있는 코드 변경이 main 에 푸시되면 같은 사이클 안에서 릴리즈를 발행한다. 사용자의 추가 승인은 필요하지 않다.

### 트리거 조건

다음 경로 중 하나라도 변경되어 commit + push 가 완료되면 **즉시** `pnpm desktop:release -- --bump patch` 를 실행한다.

- `apps/desktop/**`
- `apps/dashboard/**`
- `scripts/dashboard-*.mjs`, `scripts/worker-*.mjs`, `scripts/desktop-*.mjs`, `scripts/credential-vault.mjs`, `scripts/electron-*.mjs`
- `package.json` (의존성/스크립트/build 설정 변경)
- `build/**`

문서, memory, plan, handoff, task-queue 만 바뀐 커밋은 릴리즈하지 않는다.

### 실행 절차

1. 릴리즈 대상 변경이 `git push` 까지 완료된 상태인지 확인한다 (`git status` clean).
2. `pnpm desktop:release -- --bump patch` 를 실행한다. 의미 있는 기능 추가/UX 변화는 `--bump minor`, 호환성 깨짐은 `--bump major`.
3. 스크립트가 자동으로:
   - `package.json` version bump
   - `pnpm desktop:installer` 로 NSIS Setup + `latest.yml` 빌드
   - `chore: release vX.Y.Z` commit + `vX.Y.Z` tag + push
   - `gh release create` 로 자산 업로드
4. 실패 시 version 은 자동 롤백된다. 실패 원인을 `RUN_STATUS.md` 에 기록하고 다음 시도 전에 해결한다.

### 옵트아웃

- 환경변수 `AGENTAPP_SKIP_RELEASE=1` 이면 자동 릴리즈를 건너뛴다 (긴 작업 중간 산물이나 실험 브랜치에서만 사용).
- `gh auth status` 가 실패하거나 토큰이 없으면 릴리즈는 자동 건너뛰고 `DECISIONS_REQUIRED.md` 에 토큰 점검 항목을 남긴다.
- 같은 push 안에 여러 트리거 파일이 묶여 있으면 한 번만 릴리즈한다 (push 단위로 patch 한 번).

### 금지

- portable 빌드만 발행하지 않는다 (electron-updater 가 portable 을 in-place 업데이트하지 못한다). NSIS Setup + `latest.yml` 이 같이 올라가야 한다.
- 릴리즈 노트를 비워두지 않는다. 최근 commit 메시지 요약을 `--notes` 로 전달한다.
- 사용자가 `AGENTAPP_DISABLE_AUTOUPDATE=1` 로 켜진 환경에서 테스트 중이라고 알린 경우 그 세션에서만 릴리즈를 보류한다.

## 12. 범용 AI 토큰 최적화 (평문 → 명령서 자동 변환 + 모델 선택)

### 12.1 목적

사용자가 **평문으로 질문**하더라도 에이전트는 이를 **토큰 최적화된 "명령서 형태"로 재구성**하고, 요청 난이도에 따라 **적절한 모델을 자동 선택**해 응답한다.

### 12.2 내부 처리 순서

사용자는 평문으로 질문해도 되며, 에이전트는 내부적으로 다음 단계를 수행한다.

1. 질문 요약 (압축)
2. 명령서 구조 변환
3. 난이도 판단
4. 모델 선택
5. 최적화된 답변 생성

### 12.3 핵심 시스템 프롬프트

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

### 12.4 동작 예시

사용자 입력 (평문):

> mssql에서 2026-04-01을 20260401로 바꾸고 싶은데 제일 간단한 방법 뭐야?

내부 변환 결과:

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

### 12.5 고급 모드

#### 12.5.1 초압축 모드

```id="option-001"
[MODE]
ULTRA_COMPACT

RULE:
- CONTEXT 생략 가능
- GOAL만 유지
- 토큰 최소화 우선
```

#### 12.5.2 안정성 모드

```id="option-002"
[MODE]
SAFE

RULE:
- 설명 포함
- 예외 케이스 포함
- 가독성 우선
```

#### 12.5.3 코드 전용 모드

```id="option-003"
[MODE]
CODE_ONLY

RULE:
- 설명 금지
- 코드만 출력
```

### 12.6 적용 우선순위

- 본 규칙은 [응답/코딩 규칙](#7-응답--코딩-규칙)과 충돌 시 같은 의미로 통합한다. 한국어, 짧고 명확하게, 키워드 우선 원칙은 그대로 유지한다.
- 사용자가 명시적으로 `SAFE` / `CODE_ONLY` / `ULTRA_COMPACT` 모드를 지정하면 해당 모드 규칙을 우선한다.
- 모델 라우팅은 `docs/usage-budget-model-routing.md` 정책과 같이 적용한다. 본 규칙의 `LOW/MID/HIGH` 분류는 라우팅 입력값으로 사용한다.

## 13. 권한·승인·허용 자동 처리

- **편집 수락 모드**에서 작업할 때는 권한, 승인, 허용 프롬프트를 모두 사용자 추가 확인 없이 **"허용" 및 "항상 허용"** 으로 처리한다.
- 단, [0. 최우선 안전 규칙](#0-최우선-안전-규칙)에 명시된 금지 항목(계정 우회, 자동 로그인, 외부 운영계 쓰기, 결제, 배포, 운영 DB 파괴, 비밀값 평문 저장)은 이 자동 허용 대상에서 제외한다.
- 자동 허용 범위는 로컬 파일 수정, 문서/memory/plan/handoff 갱신, 테스트, 빌드, 로컬 실행, commit/push, 자동 릴리즈 트리거까지다.
- 자동 허용 처리한 행동은 `RUN_STATUS.md` 와 commit 메시지에 결과만 남기면 충분하다. 추가 승인 로그는 만들지 않는다.
