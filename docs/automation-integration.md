# Automation Integration

AgentApp의 자동화는 개발자를 대신해 플랫폼 제한을 우회하거나 계정을 전환하는 기능이 아니다. 목적은 프로젝트별 memory, plan, handoff, git 상태를 주기적으로 점검하고 다음 worker가 안전하게 이어받을 수 있게 준비하는 것이다.

## 지원할 자동화 모드

### 1. Manual handoff

사용자가 직접 Codex, Claude Code, Cursor, Gemini CLI 등을 열고 `NEXT_TASK.md`를 기준으로 이어간다. 현재 MVP의 기본 모드다.

### 2. Local scheduler

Windows Task Scheduler, cron, 또는 사용자가 직접 실행하는 로컬 스케줄러가 아래 read-only 중심 명령을 주기적으로 실행한다.

```bash
pnpm agent:status
pnpm agent:doctor
pnpm agent:progress
pnpm agent:next
pnpm dashboard:prepare
```

로컬 스케줄러는 새 코드를 작성하거나 외부 서비스를 변경하지 않는다. 상태 점검 결과가 문제를 발견하면 handoff 문서나 decision queue에 남긴다.

### 3. Codex automation

Codex 앱의 heartbeat 또는 cron automation은 다음 용도로만 사용한다.

- 현재 thread를 나중에 깨워 진행 상태를 확인한다.
- worktree에서 read-only 점검을 수행한다.
- 실패, quota, 사용자 결정 필요 상태를 handoff로 남긴다.

실제 예약 생성은 사용자가 명시적으로 요청할 때만 수행한다.

## 자동 실행 허용 범위

- `pnpm agent:status`
- `pnpm agent:doctor`
- `pnpm agent:progress`
- `pnpm agent:next`
- `pnpm dashboard:prepare`
- read-only git status/log/diff
- memory/plan/handoff의 상태 보고 갱신

## 자동 실행 금지 범위

- 자동 로그인
- 자동 계정 전환
- captcha, MFA, 승인창 우회
- 결제, 요금제 변경, quota 우회
- 운영 DB, 배포, 외부 서비스 쓰기
- 비밀값 생성, 저장, 출력
- force push, history rewrite, 파괴적 삭제

## 권장 MVP 순서

1. 안전한 scheduled check 명령을 만든다.
2. scheduled check가 git clean 여부, sync 상태, 다음 task, pending decision, budget 상태를 한 번에 요약한다.
3. check 결과를 `RUN_STATUS.md`에 남기는 옵션을 추가한다.
4. 사용자가 원할 때만 OS scheduler 또는 Codex automation 설정 예시를 제공한다.
5. 자동화가 code edit을 직접 수행해야 하는 경우 별도 사용자 승인을 요구한다.

## Scheduled check 명령

```bash
pnpm agent:scheduled-check
pnpm agent:scheduled-check -- --json
pnpm agent:scheduled-check -- --write-next --prepare-dashboard
pnpm agent:scheduled-check -- --write-report
```

기본 실행은 read-only 점검이다. `--write-next`를 명시한 경우에만 `NEXT_TASK.md`를 재생성하고, `--write-report`를 명시한 경우에만 `RUN_STATUS.md`에 scheduled check 결과를 남긴다.

## 운영 원칙

- 자동화는 정상 인증된 사용자의 도구 상태를 전제로 한다.
- 자동화는 플랫폼 제한을 우회하지 않고, 남은 사용량을 계획하는 데만 사용한다.
- 프로젝트별 공통 memory, plan, git sync는 모든 자동화의 기본 입력이다.
- 자동화가 판단하기 애매한 상황은 `DECISIONS_REQUIRED.md`로 넘긴다.
