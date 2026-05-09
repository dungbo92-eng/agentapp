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

## 6. 에이전트 작업 흐름

1. `AGENTS.md` 또는 `CLAUDE.md`를 읽는다.
2. `.claude-sync/memory/project_state.md`를 읽는다.
3. `.claude-sync/plans/agent-orchestrator-roadmap.md`를 읽는다.
4. `tools/agent-orchestrator/approval-policy.yaml`을 확인한다.
5. `docs/usage-budget-model-routing.md`를 확인하고 작업 난이도에 맞는 모델/예산 정책을 따른다.
6. `docs/handoff-completion-protocol.md`를 확인하고 작업 종료 규칙을 따른다.
7. `tools/agent-orchestrator/task-queue.json`을 확인해 우선순위/의존성/보류 상태를 파악한다.
8. `tools/agent-orchestrator/handoff/NEXT_TASK.md`가 있으면 우선 확인한다.
9. 의사결정이 필요 없는 개발 작업이면 바로 진행한다.
10. 작업 후 테스트/검증 결과를 남긴다.
11. `project_state.md`, roadmap, handoff를 갱신한다.

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
pnpm agent:codex-prompt -- --write
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
