# Plugin and MCP Extension Strategy

AgentApp의 plugin/MCP 확장은 더 많은 도구를 붙이는 일이 아니라, worker가 같은 안전 경계 안에서 더 정확하게 이어받도록 능력을 등록하고 제한하는 일이다.

## 목표

- 프로젝트별 공통 memory, plan, handoff, git sync를 모든 확장의 기본 입력으로 둔다.
- plugin/MCP 도구는 read-only 또는 local-write부터 붙이고, 외부 쓰기는 사용자 결정 뒤에만 실행한다.
- 도구별 권한, 위험도, 검증 명령, handoff 규칙을 명확하게 남긴다.
- 설치 여부가 달라도 worker prompt가 안전하게 fallback할 수 있게 한다.
- 비밀값, 계정 세션, quota 우회 자동화는 확장 대상에서 제외한다.

## 기본 확장 계층

| 계층 | 예시 | 기본 정책 |
|---|---|---|
| local read | 파일 검색, git status, dashboard snapshot 읽기 | 자동 허용 |
| local write | 문서/코드 수정, dashboard snapshot 생성, handoff 갱신 | 검증 후 자동 허용 |
| external read | 공식 문서 조회, GitHub issue/CI 읽기, Figma 파일 읽기 | read-only 우선, 민감 정보 제거 |
| external write | PR 생성, issue 작성, Figma 파일 수정, connector 설정 변경 | 사용자 결정 필요 |
| denied | 자동 로그인, 자동 계정 전환, quota 우회, captcha/MFA 우회 | 구현 금지 |

## 권장 plugin/MCP 범위

### Browser

- 용도: local dashboard, localhost 앱, 파일 기반 UI 검증
- 허용: 페이지 열기, 클릭 테스트, 스크린샷, 로컬 UI smoke test
- 보류: 외부 서비스 계정 로그인, 결제/설정 변경, 권한 승인창 자동 클릭

### Figma

- 용도: 디자인 시스템, 화면 설계, Code Connect, 디자인 구현 검토
- 허용: 사용자 제공 파일의 read-only context 조회, 명시 요청된 디자인 생성
- 보류: 조직 라이브러리 구조 변경, 외부 팀 파일 쓰기, 권한 scope 확대

### GitHub

- 용도: PR, issue, CI, release note 확인
- 허용: read-only 조회, 로컬 git 상태와 remote sync 확인
- 보류: PR 생성, issue 작성, branch protection 변경, release publish

### OpenAI Developers

- 용도: OpenAI API 최신 공식 문서 확인, 모델/SDK 변경 확인
- 허용: 공식 문서 read-only 조회
- 보류: API key 생성, 프로젝트 권한 변경, 결제/사용량 변경

### Local filesystem and terminal

- 용도: 코드 수정, 검증, build, task queue 갱신
- 허용: repo 안의 로컬 작업
- 보류: repo 밖 파괴적 파일 작업, 운영 비밀값 접근

## 확장 등록 기준

새 plugin/MCP를 프로젝트에 도입할 때는 아래 항목을 기록한다.

```yaml
id: github
kind: connector
default_mode: external_read
allowed_use:
  - inspect_pull_requests
  - inspect_ci
hold_for_user:
  - create_pull_request
  - edit_issue
deny:
  - change_billing
  - bypass_auth
handoff_notes:
  - redact tokens and private account identifiers
verification:
  - pnpm validate
  - pnpm agent:scheduled-check -- --json
```

MVP에서는 별도 runtime registry보다 문서, approval policy, worker prompt를 먼저 맞춘다. 이후 필요하면 위 형식을 `tools/agent-orchestrator/plugins.example.yaml`로 승격한다.

## Worker prompt 반영

worker prompt는 plugin/MCP를 다음 순서로 다룬다.

1. `AGENTS.md`, `docs/security-model.md`, `approval-policy.yaml`을 먼저 읽는다.
2. 현재 worker가 사용할 수 있는 plugin/MCP만 사용한다.
3. 같은 목적의 도구가 없으면 로컬 CLI와 handoff 문서로 fallback한다.
4. 외부 쓰기나 connector 권한 변경은 실행하지 않고 `DECISIONS_REQUIRED.md`에 남긴다.
5. 사용한 도구와 검증 결과를 `RUN_STATUS.md`에 남긴다.

## Dashboard 반영 방향

dashboard에는 실행 버튼보다 상태와 위험 신호를 먼저 보여준다.

- 사용 가능한 plugin/MCP 목록
- 도구별 기본 권한 계층
- 마지막 read-only 점검 결과
- 보류 중인 외부 쓰기 또는 connector 결정
- worker별 fallback 가능 여부

외부 쓰기 버튼은 MVP 범위에 넣지 않는다.

## Decision queue 기준

아래 상황은 자동 실행하지 않는다.

- 새 plugin 설치 또는 connector 연결
- connector scope 추가
- 외부 서비스 write action
- 운영 데이터 접근 요청
- API key 또는 token 생성/저장
- 자동 로그인이나 계정 전환을 암시하는 요청

decision 항목에는 목적, 필요한 권한, 위험도, 권장안, 승인 후 실행 명령을 남긴다.

## 단계별 확장 계획

1. 문서 기준 확정: security model, plugin/MCP strategy, installation guide 연결
2. read-only 도구 우선: Browser local UI, 공식 문서 조회, GitHub CI 조회
3. local-write 강화: dashboard snapshot, prompt 생성, handoff 갱신 자동화
4. external-write 후보 분리: PR 생성, issue 작성, Figma 쓰기 등은 decision queue로 관리
5. registry 승격: 반복 패턴이 쌓이면 `plugins.example.yaml`과 검증 스크립트 추가

## 완료 기준

- 확장 전략 문서가 security model과 충돌하지 않는다.
- 자동화가 외부 쓰기나 계정 절차를 수행하지 않는다는 점이 명확하다.
- 다음 worker가 어떤 plugin/MCP를 써도 handoff와 검증 규칙을 동일하게 따른다.
- `pnpm validate`, `pnpm agent:scheduled-check -- --json`, `pnpm agent:progress`가 통과한다.
