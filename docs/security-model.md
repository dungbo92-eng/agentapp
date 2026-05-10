# Security Model

AgentApp의 보안 모델은 여러 AI 개발 에이전트가 같은 프로젝트를 이어받아도 계정, 비밀값, 외부 시스템, git 이력을 안전하게 다루도록 경계를 고정하는 문서다.

## 목표

- 프로젝트 품질과 연속성을 높이되 플랫폼 제한, 인증 절차, 결제 절차를 우회하지 않는다.
- 각 worker는 사용자가 정상 인증한 도구와 세션 안에서만 동작한다.
- memory, plan, handoff, dashboard snapshot에는 운영 비밀값을 저장하지 않는다.
- 자동화는 로컬 점검과 handoff 갱신을 기본으로 하며 외부 쓰기는 명시 승인 후에만 한다.
- 의심스럽거나 경계가 불명확한 작업은 `DECISIONS_REQUIRED.md`에 남기고 보류한다.

## 신뢰 경계

| 영역 | 신뢰 수준 | 허용되는 기본 동작 |
|---|---|---|
| repository | 높음 | 코드, 문서, 테스트, 로컬 설정 수정 |
| `.claude-sync` | 높음 | 프로젝트 상태, plan, handoff 동기화 |
| local user tools | 중간 | 사용자가 로그인한 Codex, Claude Code, Cursor, Gemini CLI에서 수동 실행 |
| MCP/connectors | 제한 | read-only 우선, 쓰기/권한 변경은 승인 필요 |
| git remote | 제한 | 승인된 저장소에 검증된 commit push |
| external services | 낮음 | read-only 조회 우선, `POST/PUT/PATCH/DELETE`는 보류 |
| production data | 매우 낮음 | 기본 접근 금지, 필요 시 별도 사용자 결정 |

## 데이터 분류

### repo-safe

git에 저장해도 되는 데이터다.

- 제품 방향, roadmap, task queue
- 작업 요약, 검증 결과, 다음 작업
- 로컬 예산 단위와 모델 라우팅 규칙
- 샘플 설정과 schema

### local-only

로컬에만 두고 git에 올리지 않는 데이터다.

- 사용자가 직접 확인한 실제 남은 사용량 원본
- 개인 환경 경로 중 공개가 불필요한 값
- 로컬 dev server 상태나 임시 로그

### forbidden

repo, handoff, dashboard snapshot, MCP 설정에 저장하면 안 되는 데이터다.

- API key, password, session cookie, OAuth token
- captcha, MFA, 승인창 우회 정보
- 운영 DB dump, 고객 개인정보, 결제 정보
- 플랫폼 제한을 우회하기 위한 계정 전환 절차

## 허용 작업

`tools/agent-orchestrator/approval-policy.yaml`의 `auto_allowed`가 기준이다.

- repo 안의 코드, 문서, 테스트, 설정 수정
- `pnpm validate`, build, lint, typecheck, doctor 같은 로컬 검증
- `.claude-sync`와 `~/.claude`의 memory/plan 동기화
- `NEXT_TASK.md`, `RUN_STATUS.md`, worker prompt 갱신
- read-only git status, diff, log 확인
- 검증된 변경의 로컬 commit
- 사용자가 승인한 remote에 한정한 push

## 보류 작업

아래 작업은 바로 실행하지 않고 `DECISIONS_REQUIRED.md`에 남긴다.

- 외부 서비스 쓰기 요청: `POST`, `PUT`, `PATCH`, `DELETE`
- production 배포, DNS 변경, 패키지 publish
- 결제, 요금제 변경, quota 구매 또는 변경
- API key 생성, 회전, 공개, 저장
- git history rewrite, force push, branch 삭제
- 운영 DB 변경이나 파괴적 파일 작업
- MCP/connector 권한 추가, 외부 계정 연결 변경

## 금지 작업

아래 작업은 제품 기능으로 구현하지 않는다.

- 자동 로그인
- 자동 계정 전환
- captcha, MFA, 승인창 우회
- 플랫폼 quota 우회 목적의 병렬 계정 사용 자동화
- credential capture 또는 session cookie 저장
- 사용량 제한을 숨겨서 회피하는 scheduler

사용량 예산과 모델 라우팅은 정상 보유 계정의 남은 용량을 계획하는 기능이다. 제한을 우회하거나 숨기는 기능이 아니다.

## MCP와 connector

MCP와 connector는 최소 권한 원칙을 따른다.

- 기본은 read-only 조회와 로컬 파일 작업이다.
- 새 connector 설치, 외부 계정 연결, 권한 scope 확대는 사용자 결정이 필요하다.
- MCP 설정에는 운영 비밀값을 넣지 않는다.
- connector로 가져온 결과를 handoff에 남길 때는 credential, token, 개인정보를 제거한다.
- 외부 쓰기가 필요한 workflow는 dry-run 또는 decision queue를 먼저 만든다.

## Git과 동기화

git은 프로젝트 상태 공유의 핵심 경계다.

- 모든 의미 있는 작업은 검증 후 commit한다.
- remote push는 사용자가 승인한 저장소와 branch에만 한다.
- force push, reset hard, history rewrite는 기본 금지다.
- pre-commit은 `~/.claude`에서 `.claude-sync`로 memory/plan을 push하고 stage한다.
- post-merge/post-checkout은 repo의 `.claude-sync`를 로컬 `~/.claude`로 pull한다.
- push 전에는 `git status --short`, `pnpm validate`, 필요한 build를 확인한다.

## Dashboard와 자동화

dashboard는 read-only 운영 화면이다.

- `apps/dashboard/public/agent-snapshot.json`에는 repo-safe 데이터만 포함한다.
- dashboard는 외부 서비스 쓰기를 수행하지 않는다.
- scheduled check의 기본 모드는 read-only다.
- `--write-next`, `--write-report`, `--prepare-dashboard`는 로컬 handoff와 snapshot만 갱신한다.
- 자동화는 실패, quota 부족, 결정 필요 상태를 handoff로 남긴다.

## Handoff 안전 규칙

handoff 문서는 다음 worker가 바로 이어받기 위한 최소 상태만 담는다.

- 작업 요약, 검증 결과, 다음 단계, known risk를 기록한다.
- secret, token, cookie, 개인 계정 식별 정보는 기록하지 않는다.
- 불명확한 외부 쓰기나 권한 변경은 `DECISIONS_REQUIRED.md`로 분리한다.
- 로그를 붙일 때는 credential과 개인정보를 제거한다.
- 실패 상태도 감추지 않고 재현 명령과 관찰 결과를 남긴다.

## 새 프로젝트 보안 체크리스트

새 프로젝트를 AgentApp 관리 대상으로 등록할 때는 기능 개발 전에 아래를 확인한다.

- `AGENTS.md`, `CLAUDE.md`가 같은 안전 경계를 가리킨다.
- `.claude-sync/memory`, `.claude-sync/plans`, handoff 문서가 존재한다.
- `approval-policy.yaml`이 프로젝트 위험도에 맞게 정의되어 있다.
- `usage-budget` 설정에는 계정 별칭과 수동 예산 단위만 들어 있다.
- git remote와 branch가 의도한 저장소인지 확인되어 있다.
- `pnpm agent:doctor`, `pnpm agent:status`, `pnpm validate`가 통과한다.

## 검증 명령

```bash
pnpm validate
pnpm agent:doctor
pnpm agent:status
pnpm agent:scheduled-check -- --json
git status --short
```

검증 실패가 경계 판단 문제라면 구현을 멈추고 `DECISIONS_REQUIRED.md`에 남긴다.
