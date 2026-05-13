# RUN_STATUS

## 2026-05-09

- AgentApp 초기 프로젝트 골격 생성.
- 공통 규칙, memory/plan sync, 승인 정책, worker 예시, handoff 구조 추가.

## 2026-05-09T10:02:41.545Z

초기 골격 생성 및 검증 완료: git init, pnpm install, hook 설치, pnpm validate, pnpm agent:progress, pnpm agent:next, pnpm agent:status 통과.

## 2026-05-09T10:13:02.135Z

sync 환경 점검을 우선 보강: scripts/agent-doctor.mjs 추가, package/docs 연결, pnpm agent:doctor 및 pnpm validate 통과. 남은 경고는 git remote 미설정과 첫 커밋 전 working tree 상태.

## 2026-05-09T10:46:27.935Z

approval-policy.yaml allow/hold 정책 확정: default hold, auto_allowed, hold_for_user, deny, completion_requirements 정리. git remote origin=git@github.com:dungbo92-eng/agentapp.git 등록, 기본 브랜치 main 설정.

## 2026-05-09T10:50:27.141Z

workers.example.yaml registry 예시 확정: Codex, Claude Code, Cursor, Gemini CLI를 user-managed/manual launch worker로 정리하고 auto_allowed/hold_for_user/denied capabilities와 handoff 입출력 규칙을 명시.

## 2026-05-09T10:53:12.586Z

NEXT_TASK.md 템플릿 확정: agent-next 생성물을 Required Reads, Execution Rules, Completion Checklist, Handoff Updates, Context Snapshot 구조로 강화하고 worker registry 발췌를 포함하도록 변경.

## 2026-05-09T10:57:05.021Z

- Status: completed
- Summary: RUN_STATUS.md 템플릿 확정: agent-report가 Status/Summary/Verification/Git/Decisions/Next 필드를 가진 구조화 로그를 추가하도록 변경.
- Verification: pnpm validate 통과; pnpm agent:progress=30%
- Git: pending commit/push
- Decisions: none
- Next: DECISIONS_REQUIRED.md 템플릿 확정

## 2026-05-09T12:40:55.975Z

- Status: completed
- Summary: 개발 방향 추가: 주간 사용량 예산, 주말 예비분, 품질 우선 모델 라우팅, 작업 난이도별 모델 선택 정책을 문서/roadmap/policy/worker registry에 반영.
- Verification: pnpm validate 통과; pnpm agent:progress=26%
- Git: pending commit/push
- Decisions: 사용량 입력 방식은 수동 우선인지 read-only 화면 값 허용인지 추후 결정
- Next: DECISIONS_REQUIRED.md 템플릿 확정

## 2026-05-09T12:45:02.452Z

- Status: completed
- Summary: DECISIONS_REQUIRED.md 템플릿 확정: decision queue를 ID/상태/우선순위/카테고리/차단 범위/옵션/권장안/결정 후 작업 구조로 정리.
- Verification: pending final validation
- Git: pending commit/push
- Decisions: 기존 대기 항목 3개를 새 템플릿으로 유지
- Next: 작업 종료 시 memory/plan/handoff 갱신 규칙 정리

## 2026-05-09T12:45:39.066Z

- Status: completed
- Summary: DECISIONS_REQUIRED.md 템플릿 검증 완료: 대기/해결 decision queue 구조 확정.
- Verification: pnpm validate 통과; pnpm agent:doctor 통과(변경분 경고만 존재); pnpm agent:status in-sync
- Git: pending commit/push
- Decisions: 대기 항목 3개 유지
- Next: 작업 종료 시 memory/plan/handoff 갱신 규칙 정리

## 2026-05-09T12:50:52.064Z

- Status: completed
- Summary: 작업 종료 시 memory/plan/handoff 갱신 규칙 정리: docs/handoff-completion-protocol.md 추가, agent-next Required Reads에 완료 프로토콜 포함, 개발 구현 자율 진행 원칙 반영.
- Verification: pnpm validate 통과; pnpm agent:progress=30%
- Git: pending commit/push
- Decisions: DEC-20260509-002 worker 실행 범위 resolved: auto_allowed 로컬 개발 작업은 자율 진행
- Next: agent-next 우선순위/의존성/보류 상태 반영 개선

## 2026-05-09T12:54:18.102Z

- Status: completed
- Summary: agent-next 선택 로직 개선: task-queue.json 추가, 우선순위/의존성/보류 decision을 반영하고 roadmap fallback을 유지하도록 변경.
- Verification: pnpm validate 통과; pnpm agent:next가 usage-budget-schema를 선택
- Git: pending commit/push
- Decisions: DEC-20260509-001이 dashboard task를 보류하도록 task queue에 반영
- Next: 계정 수/요금제/남은 주간 사용량 설정 스키마 작성

## 2026-05-09T12:57:17.793Z

- Status: completed
- Summary: 사용량 예산 설정 스키마 작성: usage-budget.schema.json/example.json 추가, validate-configs로 JSON 설정 검증을 pnpm validate에 통합.
- Verification: pnpm validate 통과; pnpm agent:next가 모델 추천 CLI 초안을 선택; pnpm agent:progress=35%
- Git: pending commit/push
- Decisions: usage 입력 방식 DEC-20260509-003은 대기 유지, MVP는 수동 입력 가능한 스키마부터 진행
- Next: 작업 난이도별 모델 추천 CLI 초안 작성

## 2026-05-09T13:03:12.571Z

- Status: completed
- Summary: 작업 난이도별 모델 추천 CLI 초안 작성: pnpm agent:route 추가, routine/standard/complex/critical 분류와 품질 우선 추천, 예산/주말 예비분 경고 출력 구현.
- Verification: pnpm validate 통과; routine/complex/critical route 예시 실행 통과
- Git: pending commit/push
- Decisions: none
- Next: 토요일/일요일 예비 사용량을 남기는 주간 예산 계산 로직 구현

## 2026-05-09T13:06:29.959Z

- Status: completed
- Summary: 주간 예산 계산 로직 구현: pnpm agent:budget 추가, reset day/주말 예비분/오늘 권장 사용량/provider별 잔여 단위 계산.
- Verification: pnpm validate 통과; pnpm agent:budget -- --date 2026-05-09 실행 통과; pnpm agent:progress=42%
- Git: pending commit/push
- Decisions: none
- Next: 사용량 부족 시 작업 분해 또는 사용자 결정 요청 handoff 구현

## 2026-05-09T13:09:42.465Z

- Status: completed
- Summary: 사용량 부족 handoff 구현: agent:route --write-decision 옵션 추가, low budget 예시 설정 추가, needs_decision 상태 검증.
- Verification: pnpm validate 통과; low config complex route가 needs_decision 반환; pnpm agent:progress=44%
- Git: pending commit/push
- Decisions: 실제 decision queue에는 테스트 항목을 쓰지 않음
- Next: agent-progress phase별 진행률 출력 개선

## 2026-05-09T13:11:33.275Z

- Status: completed
- Summary: agent-progress phase별 출력 개선: 전체 진행률과 Phase별 진행률, 다음 미완료 항목을 함께 출력하도록 변경.
- Verification: pnpm validate 통과; pnpm agent:progress phase별 출력 확인; progress=47%
- Git: pending commit/push
- Decisions: none
- Next: agent-report가 project_state까지 갱신하도록 개선

## 2026-05-09T13:13:16.014Z

- Status: completed
- Summary: agent-report project_state 갱신 개선: RUN_STATUS 추가와 동시에 project_state.md 최근 보고 섹션을 갱신하도록 구현.
- Verification: pnpm validate 통과; pnpm agent:progress=49%
- Git: pending commit/push
- Decisions: none
- Next: 안전 작업/보류 작업을 분류하는 dry-run 명령 추가

## 2026-05-09T21:11:52.142Z

- Status: completed
- Summary: 안전 작업/보류 작업 dry-run 분류 CLI(agent:dry-run)를 추가하고 approval-policy 기반으로 auto_allowed/hold_for_user/deny 판정을 검증했다.
- Verification: pnpm validate 통과; pnpm agent:dry-run auto/hold/deny 예시 통과; pnpm agent:progress=51%
- Git: pending commit/push
- Decisions: none
- Next: worker별 프롬프트 템플릿 생성 명령 추가

## 2026-05-09T21:16:12.245Z

- Status: completed
- Summary: worker registry와 NEXT_TASK를 기반으로 Codex/Claude Code/Cursor/Gemini CLI별 시작 프롬프트를 생성하는 agent:prompt CLI를 추가했다.
- Verification: pnpm validate 통과; pnpm agent:prompt -- --worker codex 출력 확인; pnpm agent:prompt -- --all --json 통과; pnpm agent:prompt -- --all --write로 4개 프롬프트 생성; pnpm agent:progress=53%
- Git: pending commit/push
- Decisions: none
- Next: Codex 작업 프롬프트 생성 어댑터

## 2026-05-09T21:22:27.816Z

- Status: completed
- Summary: Codex Desktop 전용 작업 프롬프트 어댑터를 agent:prompt 자동 형식과 agent:codex-prompt alias로 추가하고, Codex 실행 계약/안전 분류/모델 라우팅/완료 보고 지침을 생성 프롬프트에 포함했다.
- Verification: pnpm validate 통과; pnpm agent:codex-prompt -- --write 통과; pnpm agent:prompt -- --worker codex --json에서 Codex Adapter 섹션 확인; pnpm agent:progress=56%
- Git: pending commit/push
- Decisions: none
- Next: Claude Code 작업 프롬프트 생성 어댑터

## 2026-05-09T21:24:38.840Z

- Status: completed
- Summary: Claude Code 전용 작업 프롬프트 어댑터를 agent:prompt 자동 형식과 agent:claude-prompt alias로 추가하고, CLAUDE.md 자동 로드/AGENTS.md 공통 정책/터미널 루트 실행/Claude 모델 라우팅 지침을 생성 프롬프트에 포함했다.
- Verification: pnpm validate 통과; pnpm agent:claude-prompt -- --write 통과; pnpm agent:prompt -- --worker claude-code --json에서 Claude Code Adapter 섹션 확인; pnpm agent:progress=58%
- Git: pending commit/push
- Decisions: none
- Next: Cursor 작업 프롬프트 생성 어댑터

## 2026-05-09T21:26:45.972Z

- Status: completed
- Summary: Cursor 전용 작업 프롬프트 어댑터를 agent:prompt 자동 형식과 agent:cursor-prompt alias로 추가하고, workspace 열기/IDE agent 붙여넣기/좁은 범위 편집/비밀값 저장 금지 지침을 생성 프롬프트에 포함했다.
- Verification: pnpm validate 통과; pnpm agent:cursor-prompt -- --write 통과; pnpm agent:prompt -- --worker cursor --json에서 Cursor Adapter 섹션 확인; pnpm agent:progress=60%
- Git: pending commit/push
- Decisions: none
- Next: 실패/중단/quota 감지 상태 모델 정의

## 2026-05-09T21:29:52.172Z

- Status: completed
- Summary: worker 실행/중단/실패/quota 상태 모델을 JSON schema와 예시 파일로 정의하고, validate-configs에서 상태/이유/비밀값 금지/정책 판정을 검증하도록 추가했다.
- Verification: pnpm validate 통과; worker-run-state.example status=blocked reason=hold_for_user contains_secrets=false 확인; pnpm agent:progress=63%
- Git: pending commit/push
- Decisions: none
- Next: worker가 직접 실행할 수 없는 경우 handoff만 남기는 fallback 구현

## 2026-05-09T21:36:19.496Z

- Status: completed
- Summary: 직접 실행 불가 환경에서 worker를 실행하지 않고 handoff-only 상태를 남기는 agent:fallback CLI를 추가했다. dry-run 검증으로 HANDOFF_ONLY/run-state/RUN_STATUS 생성 내용을 확인했다.
- Verification: pnpm validate 통과; pnpm agent:fallback -- --worker codex --reason tool_error --summary 현재환경직접실행불가 --dry-run --json 통과; pnpm agent:progress=65% Phase3=100%
- Git: pending commit/push
- Decisions: none
- Next: 로컬 웹 대시보드 기술 선택

## 2026-05-09T21:40:15.005Z

- Status: completed
- Summary: 로컬 웹 대시보드 기술을 Vite + React + TypeScript read-only SPA로 결정하고 docs/dashboard-technology.md에 근거와 초기 구조를 기록했다. 첫 UI 결정도 로컬 대시보드 착수로 해결 처리하고 task queue를 다음 화면 작업으로 열었다.
- Verification: pnpm validate 통과; pnpm agent:progress=67%; pnpm agent:next=진행률/다음 작업/보류 결정 화면; pnpm agent:dry-run 로컬 대시보드 파일 생성 auto_allowed 확인
- Git: pending commit/push
- Decisions: DEC-20260509-001 resolved
- Next: 진행률/다음 작업/보류 결정 화면

## 2026-05-09T21:47:06.047Z

- Status: completed
- Summary: 진행률/다음 작업/보류 결정 화면을 위한 Vite + React + TypeScript 로컬 대시보드 MVP를 추가하고, dashboard snapshot 생성 스크립트로 progress/next task/decisions/latest run/task queue/usage budget을 표시하도록 구현했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; dev server http://127.0.0.1:5173 응답 200; pnpm agent:progress=70%
- Git: pending commit/push
- Decisions: none
- Next: worker 상태 화면

## 2026-05-09T21:49:55.286Z

- Status: completed
- Summary: 대시보드에 worker 상태 화면을 추가했다. snapshot 생성 시 workers.example.yaml과 worker run-state 예시/기록을 합쳐 worker별 최신 상태, 이유, 최근 task를 표시한다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; snapshot workers=4 next=handoff viewer; pnpm agent:progress=72%
- Git: pending commit/push
- Decisions: none
- Next: handoff viewer

## 2026-05-09T21:54:52.576Z

- Status: completed
- Summary: 대시보드에 handoff viewer를 추가했다. snapshot 생성 시 NEXT_TASK, RUN_STATUS, DECISIONS_REQUIRED를 읽어 문서별 상태, 다음 항목, 줄 수, excerpt를 제공하고 UI에서 읽기 전용으로 확인할 수 있게 했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; handoff_documents=3; pnpm agent:progress=74%
- Git: pending commit/push
- Decisions: none
- Next: 승인 필요 큐 화면

## 2026-05-09T21:58:44.172Z

- Status: completed
- Summary: 대시보드에 승인 필요 큐 화면을 추가했다. approval-policy.yaml의 hold_for_user/deny/user_required 경계와 DECISIONS_REQUIRED 대기 항목, hold/blocked task를 snapshot에 모아 UI에서 확인할 수 있게 했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; approval pending=1 holdRules=10 denyRules=3; pnpm agent:progress=77%
- Git: pending commit/push
- Decisions: none
- Next: 주간 사용량/주말 예비분/모델 추천 화면

## 2026-05-10T02:19:14.446Z

- Status: completed
- Summary: 대시보드에 주간 사용량/주말 예비분/모델 추천 화면을 추가하고, 프로젝트별 공통 memory/plan/git sync를 기본 운영 골격으로 문서화했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; usage accounts=2 recommendations=4; pnpm agent:progress=79% Phase5=100%
- Git: pending commit/push
- Decisions: none
- Next: OS 작업 스케줄러 또는 Codex automation 연동 방식 정리

## 2026-05-10T02:21:30.533Z

- Status: completed
- Summary: OS 작업 스케줄러/Codex automation 연동 방식을 정리했다. 자동화는 read-only 점검과 handoff 갱신 중심으로 제한하고, 실제 예약 생성은 사용자 명시 요청 시에만 수행하도록 문서화했다.
- Verification: pnpm validate 통과; pnpm agent:progress=81% Phase6=25%; pnpm dashboard:prepare 통과
- Git: pending commit/push
- Decisions: none
- Next: 주기적 agent-next 실행 방식 구현

## 2026-05-10T02:24:19.564Z

- Status: completed
- Summary: 주기적 agent-next 실행을 위한 agent:scheduled-check CLI를 추가했다. 기본은 read-only 상태 점검이며, --write-next/--write-report/--prepare-dashboard 옵션으로 handoff 갱신 범위를 명시하게 했다.
- Verification: pnpm agent:scheduled-check -- --json 통과; pnpm agent:scheduled-check -- --write-next --prepare-dashboard --json 통과; pnpm validate 통과; pnpm agent:progress=84%
- Git: pending commit/push
- Decisions: none
- Next: 보류 결정 알림 방식 정리

## 2026-05-10T02:27:44.107Z

- Status: completed
- Summary: 보류 결정 알림 방식을 정리하고 agent:scheduled-check에 pending decision 개수와 level 요약을 추가했다. 기본 알림은 dashboard, scheduled check, handoff report에만 표시한다.
- Verification: pnpm agent:scheduled-check -- --json pending_decisions=1 level=attention; pnpm validate 통과; pnpm dashboard:build 통과; pnpm agent:progress=86%
- Git: pending commit/push
- Decisions: none
- Next: git sync 상태 점검 자동화

## 2026-05-10T02:29:50.701Z

- Status: completed
- Summary: git sync 상태 자동 점검을 agent:scheduled-check에 추가했다. branch, upstream, remote 설정 여부, ahead/behind, synced 상태를 read-only로 요약한다.
- Verification: pnpm agent:scheduled-check -- --json git.upstream=origin/main git.synced=true; pnpm validate 통과; pnpm agent:progress=88% Phase6=100%
- Git: pending commit/push
- Decisions: none
- Next: 설치 가이드

## 2026-05-10T02:42:39.947Z

- Status: completed
- Summary: 설치 가이드를 추가하고 새 PC/새 프로젝트 등록 시 공통 memory/plan/handoff/git sync를 기본 세팅으로 확인하는 절차를 문서화했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; pnpm agent:progress=91%; pnpm agent:scheduled-check 통과
- Git: pending commit/push
- Decisions: none
- Next: 보안 모델 문서화

## 2026-05-10T02:47:55.833Z

- Status: completed
- Summary: 보안 모델 문서를 추가해 비밀값, 계정, MCP/connector, 자동화, git remote, 외부 쓰기 경계를 제품화 기준으로 정리했다.
- Verification: pnpm validate 통과; pnpm agent:progress=93%
- Git: pending commit/push
- Decisions: none
- Next: plugin/MCP 확장 전략

## 2026-05-10T02:50:23.864Z

- Status: completed
- Summary: plugin/MCP 확장 전략 문서를 추가해 Browser, Figma, GitHub, OpenAI Developers, local tools를 권한 계층별로 분류하고 외부 쓰기와 connector 변경은 decision queue로 보류하는 기준을 정리했다.
- Verification: pnpm validate 통과; pnpm agent:progress=95%
- Git: pending commit/push
- Decisions: none
- Next: 테스트 시나리오

## 2026-05-10T02:52:33.861Z

- Status: completed
- Summary: 제품화 테스트 시나리오 문서를 추가해 새 PC 시작, handoff 이어받기, 예산 라우팅, 승인 정책, scheduled check, dashboard smoke, git sync, 보안 경계, plugin/MCP fallback 검증 절차를 정리했다.
- Verification: pnpm validate 통과; pnpm agent:progress=98%
- Git: pending commit/push
- Decisions: none
- Next: 첫 릴리즈 태그

## 2026-05-10T02:55:06.320Z

- Status: completed
- Summary: v0.0.1 CHANGELOG를 추가하고 Phase 7 첫 릴리즈 태그 작업을 완료 상태로 정리했다. 전체 roadmap 진행률은 100%다.
- Verification: pnpm validate 통과; pnpm agent:progress=100%
- Git: pending commit/tag/push
- Decisions: none
- Next: none

## 2026-05-10T03:13:01.788Z

- Status: completed
- Summary: dashboard를 단순 상태판에서 통합 에이전트 콘솔 UX로 개편했다. 좌측 프로젝트/계정 등록, 중앙 프롬프트 입력과 Start/Stop, 모델 라우팅, 우측 queue/usage, handoff/plan/worker 패널을 추가했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 브라우저 DOM에서 Projects/Accounts/Prompt/Start/Stop/Phase8 확인; Start/Stop 클릭 테스트 통과
- Git: pending commit/push
- Decisions: none
- Next: dashboard local execution API

## 2026-05-10T07:23:10.353Z

- Status: completed
- Summary: dashboard local runtime API를 추가해 Claude/Codex Google A/B 계정 프리셋, 비밀값 없는 로컬 계정 예산 저장, 프로젝트 registry 저장, Start 모델/계정 자동 라우팅과 예산 차감, Stop run history 기록을 구현했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 브라우저에서 claude-google-a/codex-google-b 표시, Start=codex-google/gpt-5.4 라우팅, Stop 상태 확인
- Git: pending commit/push
- Decisions: none
- Next: Start/Stop과 worker process/handoff 연동

## 2026-05-10T07:28:32.467Z

- Status: completed
- Summary: 등록된 AI 계정에 enabled 토글을 추가했다. 사용자가 계정을 삭제하지 않고 on/off를 바꿀 수 있고, disabled 계정은 모델/계정 자동 라우팅 후보에서 제외된다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 브라우저에서 계정 checkbox 6개 확인; off/on 토글 확인; disabled codex-google-b 상태에서 codex-google-a로 라우팅 확인
- Git: pending commit/push
- Decisions: none
- Next: Start/Stop과 worker process/handoff 연동

## 2026-05-10T07:42:09.880Z

- Status: completed
- Summary: dashboard 계정에 needs-login/ready 세션 상태를 추가하고 Ready 계정만 자동 라우팅에 사용하도록 변경했다. Start/Stop은 DASHBOARD_RUN.md와 run-states/dashboard-current.json을 갱신해 prompt 본문은 local-only로 두면서 실행 상태를 handoff에 남긴다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 브라우저에서 Ready 전환 전 Ready 세션 없음 차단, Ready 전환 후 codex-google-a/gpt-5.4 라우팅, Start/Stop handoff path 표시 확인
- Git: not recorded
- Decisions: none
- Next: Windows exe packaging

## 2026-05-10T07:55:33.314Z

- Status: completed
- Summary: Windows portable EXE packaging 기반을 추가했다. Electron desktop shell, 정적 dashboard/local API 서버, userData local-only 저장 경로, desktop:dev/desktop:pack 스크립트를 추가하고 dist-desktop/AgentApp-0.0.1-x64.exe 생성을 확인했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; dashboard-server 스모크 테스트 통과; pnpm desktop:pack 통과; EXE 산출물 E:\\agentApp\\dist-desktop\\AgentApp-0.0.1-x64.exe 확인
- Git: not recorded
- Decisions: none
- Next: none

## 2026-05-10T08:30:11.166Z

- Status: completed
- Summary: 사용자별 계정 수가 다른 상황을 위해 dashboard 계정 준비 흐름을 개선했다. 이후 고정 조합 방식은 동적 Add account 방식으로 대체했다. EXE 공유를 위해 desktop:artifact checksum 산출도 추가했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 계정 준비 API 확인; pnpm desktop:artifact -- --json 통과
- Git: not recorded
- Decisions: none
- Next: none

## 2026-05-10T13:59:56.452Z

- Status: completed
- Summary: dashboard 계정 설정을 고정 조합에서 동적 Add account 흐름으로 전면 교체했다. provider/login method/email/session profile/password/API key 입력을 지원하고, secret은 Windows DPAPI local vault에 암호화 저장하며 runtime에는 credential reference만 남긴다. Start 화면에는 모델 override와 active run line log를 추가했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; vault-runtime-test 통과; in-app browser에서 Add account/AI tool/Google/Model/GPT-5.5/Prompt/Start 표시 확인
- Git: not recorded
- Decisions: none
- Next: worker별 session profile launch adapter

## 2026-05-10T14:17:20.025Z

- Status: completed
- Summary: worker launch adapter를 추가해 Start가 실제 launch request를 처리하도록 연결했다. Codex는 session-profile별 CODEX_HOME으로 codex exec를 실행하고, Cursor는 session-profile별 user-data-dir로 창을 연다. launch 전 pnpm validate preflight를 실행해 결과를 active run에 반영하고, login/session expired 패턴이 보이면 계정을 needs-login으로 되돌리며 needs_user handoff를 남긴다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; worker-launch-adapter-test 통과; in-app browser에서 Projects/Accounts/Prompt/Workers/Connection policy 표시 확인
- Git: not recorded
- Decisions: none
- Next: Claude Code command-mode adapter profile

## 2026-05-10T14:35:02.421Z

- Status: completed
- Summary: 대시보드 UI를 한글로 통일하고 계정 삭제 버튼, 입력/버튼 툴팁, 남은 사용량/주간 예산 설명을 추가했다. 계정 삭제 API를 붙이고 삭제 시 로컬 credential vault 정리까지 반영했다.
- Verification: pnpm validate; pnpm dashboard:build; Edge headless DOM/screenshot; temp account delete API verified
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-10T23:02:58.933Z

- Status: completed
- Summary: Phase 11 Claude Code command-mode adapter profile 추가
- Verification: pnpm validate; pnpm agent:progress
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-10T23:18:42.248Z

- Status: completed
- Summary: dashboard 계정 UX 자동화: 폼 collapsible, 세션 자동 감지, plan별 사용량 자동
- Verification: pnpm validate; pnpm dashboard:build; live API test (add+detect)
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T01:01:02.737Z

- Status: completed
- Summary: Phase 11 완료 (4/4): Gemini adapter, detector 보강, doctor session readiness 진단
- Verification: pnpm validate; pnpm agent:doctor; pnpm agent:progress=100%
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T03:14:25.871Z

- Status: completed
- Summary: v0.1.0 사용자 환경 설치/점검, dashboard UX polish, cycle test CLI, Windows EXE 재패키징 완료
- Verification: pnpm validate; pnpm dashboard:build; pnpm agent:setup; pnpm agent:cycle-test; dashboard-server smoke; pnpm desktop:pack; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: Claude/Gemini CLI 설치 또는 env override 후 authenticated cycle 재검증

## 2026-05-11T04:38:13.960Z

- Status: completed
- Summary: 사용자/배포 PC 모두에서 누락 AI CLI 를 자동 설치할 수 있도록 dashboard install API + UI 버튼을 추가하고 EXE 를 재패키징했다.
- Verification: pnpm validate; pnpm dashboard:build; pnpm agent:cycle-test --execute (timeout_stopped); pnpm desktop:pack; pnpm desktop:artifact sha256=bdb25a...
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T06:00:06.940Z

- Status: completed
- Summary: NSIS System.dll crash 진단 후 installer를 custom prompt 없는 표준 NSIS로 재빌드하고 silent 설치/실행 검증까지 완료
- Verification: win-unpacked AgentApp.exe 8초 생존; pnpm desktop:installer; installer UI 경로 6초 생존; installer /S temp 설치 exit 0; 설치된 AgentApp.exe 8초 생존; uninstaller /S exit 0; pnpm validate; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: 사용자 PC에서 AgentApp-Setup-0.1.0-x64.exe 더블클릭 설치 확인 후 dashboard 환경 패널에서 누락 CLI 자동 설치 실행

## 2026-05-11T06:11:47.980Z

- Status: completed
- Summary: dashboard AI CLI auto-install now starts on main screen and Windows packaged install uses absolute cmd/where paths
- Verification: PATH-empty agent:setup ai json; pnpm validate; pnpm dashboard:build; pnpm desktop:installer; silent installer smoke; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: 사용자 PC에서 앱 실행 후 Claude/Gemini CLI 자동 설치 로그 확인, 이후 수동 인증 후 cycle-test 실행

## 2026-05-11T06:15:48.544Z

- Status: completed
- Summary: dashboard now auto-installs missing core tools and AI CLIs on main screen; Windows packaged install resolves cmd/where and common Node/Git/Cursor/npm paths without relying on PATH
- Verification: PATH-empty agent:setup all json; pnpm validate; pnpm dashboard:build; pnpm desktop:installer; silent installer smoke with auto-install disabled; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: 앱을 일반 실행하면 누락된 Claude/Gemini CLI 자동 설치가 시작됩니다. 설치 후 Claude/Gemini 수동 인증을 완료하고 authenticated cycle-test를 실행하세요.

## 2026-05-11T07:37:25.813Z

- Status: blocked
- Summary: Installed Claude/Gemini CLI, fixed Windows npm shim execution for worker adapters, updated Gemini CLI launch syntax, rebuilt installer, and ran cycle tests. Remaining blocker is user authentication: Codex session profile returns 401, Claude/Gemini login profiles are empty, Cursor opens but requires manual UI completion.
- Verification: node scripts/agent-environment-setup.mjs --target all --json: all 7 ok; node scripts/agent-doctor.mjs: CLI ok, auth warnings only; Codex cycle-test reached CLI and logged 401; Cursor cycle opened window with validation passed; pnpm.cmd validate; pnpm.cmd dashboard:build; pnpm.cmd desktop:installer; silent installer smoke; pnpm.cmd desktop:artifact
- Git: not recorded
- Decisions: none
- Next: Complete the opened Codex/Claude/Gemini login flows manually, then click 재감지 or rerun node scripts/user-environment-cycle-test.mjs --worker <worker> --execute.

## 2026-05-11T08:35:50.111Z

- Status: completed
- Summary: 로그인/계정 확인 흐름을 콘솔 창 대신 백그라운드 실행 + 인증 URL 자동 브라우저 오픈 방식으로 변경했고 Windows installer/portable을 재패키징했습니다.
- Verification: pnpm validate; node scripts\\agent-environment-setup.mjs --target all --json; node scripts\\agent-doctor.mjs; pnpm dashboard:build; pnpm desktop:installer; pnpm desktop:pack; silent installer install/uninstall smoke
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T08:50:00.101Z

- Status: completed
- Summary: 로그인/계정 확인 흐름을 콘솔 창 없이 백그라운드에서 실행하고, CLI 출력 인증 URL을 기본 브라우저로 자동 오픈하도록 변경했습니다. Windows .cmd shim은 숨김 cmd 래퍼로 실행해 cmd.exe ENOENT와 콘솔 창 노출을 줄였고 installer/portable을 최종 재패키징했습니다.
- Verification: pnpm validate; node scripts\\agent-environment-setup.mjs --target all --json; node scripts\\agent-doctor.mjs; pnpm desktop:installer; pnpm desktop:pack; silent installer install/uninstall smoke; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T12:35:00.000Z

- Status: completed
- Summary: 컨텍스트 자동화 4종 한꺼번에 구현. (1) 계정 한도 임박 시 dashboard 펄스 강조 + 1분 throttle 비프음, (2) 현재 실행을 다른 준비된 계정으로 한 번에 인계하는 quickHandoff API/UI(빠른 계정 후보 단축버튼 포함), (3) Ready 전환 시 같은 provider의 pendingRuns 첫 항목 자동 dispatch, (4) selectRoute에 lastUsedAt 기반 load balance bonus. ToS 준수: 자동 로그인/강제 계정 전환/CAPTCHA·MFA 우회는 구현하지 않음.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과(237 KB, css 14.5 KB)
- Git: committed
- Decisions: none
- Next: 패키징 EXE 재빌드는 사용자 시간대에 진행 예정

## 2026-05-13T08:33:28.160Z

- Status: completed
- Summary: 자동 라우팅 run 의 provider fallback, auto pending dispatch, stale quota lock 해제를 수정했습니다. Codex 세션 인증이 남아 있는데도 한도 잠금 때문에 ready 후보에서 제외되는 경우를 명확히 표시하고, 재감지/ready 전환 시 잠금을 지우도록 했습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress; selectRoute/startRun 시뮬레이션
- Git: pending
- Decisions: none
- Next: 현재 변경 검토 후 commit/push, 릴리즈 트리거 여부 확인

## 2026-05-13T08:37:50.301Z

- Status: completed
- Summary: 자동 라우팅 provider fallback 수정은 검증 후 commit/push 완료했습니다. 릴리즈 트리거 대상 변경이지만 이 PC에 gh CLI가 없어 GitHub Release 발행은 보류했고 DEC-20260513-001에 도구 점검을 기록했습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress; pnpm agent:next; pnpm agent:sync; pnpm agent:status; selectRoute/startRun 시뮬레이션; git push origin main
- Git: commit befa6d7 pushed to origin/main
- Decisions: DEC-20260513-001 pending: gh CLI missing, release skipped
- Next: gh CLI 설치/인증 후 pnpm desktop:release -- --bump patch 실행

## 2026-05-13T08:43:52.870Z

- Status: completed
- Summary: 정정: gh CLI는 설치되어 있었고 현재 shell PATH에만 없었습니다. 풀 경로 인증 확인 후 desktop-release fallback으로 v0.2.1 GitHub Release를 발행했습니다.
- Verification: C:\\Program Files\\GitHub CLI\\gh.exe auth status; pnpm desktop:release -- --bump patch; gh release view v0.2.1
- Git: release commit 9e6af68 and tag v0.2.1 pushed to origin/main
- Decisions: DEC-20260513-001 resolved
- Next: Claude/Gemini authenticated cycle 재검증

## 2026-05-13T09:02:02.948Z

- Status: completed
- Summary: 컴팩트 채팅 모드를 좌측 프로젝트 리스트와 우측 작업 패널로 재배치했습니다. 우측 상단은 프롬프트 입력/시작 버튼으로 고정하고, 프로젝트 요약과 최신 실행/진행 로그만 남겨 나머지 메타 정보는 숨겼습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; Browser visual check http://127.0.0.1:5173 compact mode
- Git: pending
- Decisions: none
- Next: commit/push/release

## 2026-05-13T09:02:57.210Z

- Status: completed
- Summary: 컴팩트 채팅 모드를 좌측 프로젝트 리스트와 우측 작업 패널로 재배치했습니다. 우측 상단은 프롬프트 입력/시작 버튼으로 고정하고, 프로젝트 요약과 최신 실행/진행 로그만 남겨 나머지 메타 정보는 숨겼습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress; pnpm agent:next; pnpm agent:sync; pnpm agent:status; Browser visual check http://127.0.0.1:5173 compact mode
- Git: pending
- Decisions: none
- Next: commit/push/release

## 2026-05-13T09:06:05.787Z

- Status: completed
- Summary: 컴팩트 채팅 모드 레이아웃을 좌측 프로젝트 리스트/우측 작업 패널로 단순화했고, v0.2.2 릴리즈까지 발행했습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress; pnpm agent:next; pnpm agent:sync; pnpm agent:status; Browser visual check; gh release view v0.2.2
- Git: commit dab5f22 pushed; release commit 0f3393f and tag v0.2.2 pushed
- Decisions: none
- Next: Claude/Gemini authenticated cycle 재검증

## 2026-05-13T09:25:14.737Z

- Status: completed
- Summary: Claude quota reset 문자열 May 18, 6am Asia/Seoul 파싱을 정확히 처리하고, active quota lock은 재감지/준비 전환/pending 자동 시작으로 풀리지 않게 수정했습니다. 설치 앱 로컬 상태도 Claude 잠금 2026-05-18 06:00 KST, Codex dungbo92 로컬 예산 ok로 보정했습니다.
- Verification: pnpm validate; pnpm dashboard:build; parseQuotaReset sample => 2026-05-17T21:00:00.000Z
- Git: not recorded
- Decisions: none
- Next: commit/push/release

## 2026-05-13T09:29:42.738Z

- Status: completed
- Summary: Claude quota reset dated lockout 수정분을 commit/push했고, 자동 업데이트용 v0.2.3 patch release를 발행했습니다.
- Verification: pnpm validate; pnpm dashboard:build; gh release view v0.2.3
- Git: commit b76d469 pushed; release commit 7967461 and tag v0.2.3 pushed
- Decisions: none
- Next: Claude/Gemini authenticated cycle 재검증
