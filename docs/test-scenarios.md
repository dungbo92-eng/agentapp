# Test Scenarios

AgentApp 제품화 전 최소 검증 시나리오다. 각 시나리오는 새 worker가 같은 상태를 이어받고, 안전 경계를 지키며, 검증된 변경만 git으로 동기화할 수 있는지 확인한다.

## 공통 전제

- repository root: `E:\agentApp`
- remote: `origin`
- branch: `main`
- 비밀값, 계정 토큰, session cookie를 파일이나 로그에 남기지 않는다.
- 외부 쓰기, 배포, 결제, connector 권한 변경은 decision queue로 보류한다.

## S01. 새 PC 시작

목적: 새 PC 또는 새 worker가 기본 환경을 복구할 수 있는지 확인한다.

```bash
git clone git@github.com:dungbo92-eng/agentapp.git agentApp
cd agentApp
pnpm install
pnpm agent:doctor
pnpm agent:status
pnpm agent:next
pnpm dashboard:prepare
```

기대 결과:

- git hooks가 설치된다.
- `.claude-sync`와 로컬 `~/.claude` memory/plan이 in-sync다.
- `NEXT_TASK.md`가 현재 task queue의 다음 작업을 가리킨다.
- dashboard snapshot이 생성된다.

## S02. Handoff 이어받기

목적: 이전 worker가 남긴 상태로 다음 worker가 바로 작업을 시작할 수 있는지 확인한다.

```bash
pnpm agent:status
pnpm agent:progress
pnpm agent:next
pnpm agent:prompt -- --all --write
```

기대 결과:

- progress와 next task가 roadmap/task queue와 일치한다.
- worker별 prompt가 같은 next task를 가리킨다.
- `RUN_STATUS.md`에는 마지막 완료 작업과 검증 결과가 남아 있다.

## S03. 작업 완료 보고

목적: 작업 종료 시 memory, report, next task가 같은 상태로 갱신되는지 확인한다.

```bash
pnpm agent:report -- --status completed --summary "테스트 작업" --verify "pnpm validate 통과" --next "다음 작업"
pnpm agent:next
pnpm agent:sync
pnpm agent:status
```

기대 결과:

- `RUN_STATUS.md`에 새 완료 항목이 추가된다.
- `.claude-sync/memory/project_state.md`가 갱신된다.
- memory/plans sync 상태가 in-sync다.

## S04. 사용량 예산과 모델 라우팅

목적: 주말 예비분과 작업 난이도 기반 모델 추천이 동작하는지 확인한다.

```bash
pnpm agent:budget
pnpm agent:route -- --task "Docker 설치 방법 정리" --complexity routine
pnpm agent:route -- --task "AI 모델 연동 설계" --complexity complex
pnpm agent:route -- --config tools/agent-orchestrator/usage-budget.low.example.json --task "자동매매 로직 설계" --complexity complex --write-decision
```

기대 결과:

- routine 작업은 효율 모델을 추천한다.
- complex 작업은 최고 품질 모델을 우선 추천한다.
- 예산 부족 상태는 작업 분해 또는 사용자 결정 요청으로 처리된다.
- `--write-decision`은 부족 상태를 `DECISIONS_REQUIRED.md`에 기록한다.

## S05. 승인 정책 dry-run

목적: 자동 허용, 보류, 금지 작업이 올바르게 분류되는지 확인한다.

```bash
pnpm agent:dry-run -- --operation "pnpm validate"
pnpm agent:dry-run -- --operation "production deploy"
pnpm agent:dry-run -- --operation "automatic login and captcha bypass"
```

기대 결과:

- 로컬 검증은 `auto_allowed`다.
- production deploy는 `hold_for_user`다.
- 자동 로그인과 captcha 우회는 `deny`다.

## S06. Scheduled check

목적: 자동 점검이 기본 read-only로 동작하고, 명시 옵션에서만 로컬 handoff를 갱신하는지 확인한다.

```bash
pnpm agent:scheduled-check -- --json
pnpm agent:scheduled-check -- --write-next --prepare-dashboard --json
pnpm agent:scheduled-check -- --write-report
```

기대 결과:

- 기본 실행은 파일을 쓰지 않고 상태만 요약한다.
- `sync_ok`, `git.synced`, `budget_ok`가 확인된다.
- write 옵션은 `NEXT_TASK.md`, `RUN_STATUS.md`, dashboard snapshot 같은 로컬 산출물만 갱신한다.

## S07. Dashboard smoke test

목적: dashboard build와 snapshot 표시가 깨지지 않는지 확인한다.

```bash
pnpm dashboard:prepare
pnpm dashboard:build
```

기대 결과:

- `apps/dashboard/public/agent-snapshot.json`이 생성된다.
- build가 성공한다.
- snapshot에는 progress, next task, decisions, git status, usage budget, handoff documents가 포함된다.

## S08. Git sync

목적: 검증된 변경만 commit/push되고, memory/plan hook이 함께 동작하는지 확인한다.

```bash
git status --short
pnpm validate
pnpm agent:sync
git add <changed-files>
git commit -m "type: summary"
git push origin main
```

기대 결과:

- commit 전 `pnpm validate`가 통과한다.
- pre-commit hook이 `.claude-sync`를 stage한다.
- push 후 `git status --short`가 비어 있다.
- `pnpm agent:scheduled-check -- --json`의 `git.synced=true`다.

## S09. 보안 경계

목적: secret과 외부 쓰기 경계가 문서와 정책대로 유지되는지 확인한다.

점검 항목:

- handoff 문서에 API key, token, cookie가 없다.
- MCP/connector 설정에 운영 비밀값이 없다.
- 외부 쓰기 요청은 실행하지 않고 `DECISIONS_REQUIRED.md`에 남긴다.
- 자동 로그인, 자동 계정 전환, captcha/MFA 우회는 구현하지 않는다.

## S10. Plugin/MCP fallback

목적: 특정 plugin이 없어도 안전하게 로컬 절차로 대체되는지 확인한다.

점검 항목:

- Browser가 없으면 `pnpm dashboard:build`와 snapshot 확인으로 대체한다.
- GitHub connector가 없으면 로컬 git status/log와 remote sync 확인으로 대체한다.
- Figma가 없으면 디자인 작업은 decision 또는 handoff로 보류한다.
- OpenAI Developers가 없으면 공식 문서 확인이 필요한 작업을 별도 read-only 조사로 남긴다.

## 완료 기준

```bash
pnpm validate
pnpm dashboard:build
pnpm agent:doctor
pnpm agent:scheduled-check -- --json
git status --short
```

모든 명령이 통과하고 `git status --short`가 비어 있으면 제품화 테스트 기준을 만족한 것으로 본다.
