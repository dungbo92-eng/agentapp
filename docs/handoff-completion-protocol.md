# Handoff Completion Protocol

작업을 끝내거나 중단할 때 모든 에이전트가 같은 순서로 memory, plan, handoff, git 상태를 정리하기 위한 규칙이다.

## 기본 원칙

- 개발 구현, 문서 수정, 테스트, 로컬 검증, 로컬 CLI 실행, memory/plan/handoff 갱신, commit/push는 `approval-policy.yaml`의 `auto_allowed` 범위에서 계속 진행한다.
- 사용자 결정은 안전, 계정, 결제, 배포, 외부 운영 쓰기, 비밀값, 파괴적 작업처럼 `hold_for_user` 또는 `deny`에 해당하는 경우에만 요구한다.
- 작업이 끝나면 다음 에이전트가 바로 이어받을 수 있도록 `project_state.md`, roadmap, handoff, git remote를 같은 상태로 맞춘다.
- GitHub remote가 설정되어 있으면 검증된 변경은 commit 후 push한다.

## 완료 시 체크리스트

1. 작업 결과를 요약한다.
2. 관련 roadmap 체크박스를 갱신한다.
3. `.claude-sync/memory/project_state.md`에 의미 있는 진행, 다음 후보, 열린 질문을 갱신한다.
4. `tools/agent-orchestrator/handoff/RUN_STATUS.md`에 구조화 로그를 남긴다.
5. 사용자 결정이 필요한 항목은 `DECISIONS_REQUIRED.md`에 추가하거나 해결 처리한다.
6. `pnpm agent:next`로 다음 작업 handoff를 재생성한다.
7. `pnpm agent:sync`로 repo와 로컬 Claude memory/plan을 맞춘다.
8. `pnpm validate`, `pnpm agent:doctor`, `pnpm agent:status`를 실행한다.
9. `git status`와 diff를 확인한다.
10. 변경 사항을 commit한다.
11. remote가 설정되어 있으면 push한다.

## 중단 시 체크리스트

1. `RUN_STATUS.md`에 `Status: blocked` 또는 `Status: in_progress`로 기록한다.
2. 막힌 이유를 한 문장으로 적는다.
3. 사용자가 결정해야 할 항목은 `DECISIONS_REQUIRED.md`에 구조화해서 남긴다.
4. 안전하게 완료한 로컬 변경은 가능한 한 검증하고 commit/push한다.
5. 다음 에이전트가 이어갈 수 있게 `NEXT_TASK.md`를 최신 상태로 만든다.

## RUN_STATUS 필드

- Status: `completed`, `blocked`, `in_progress`
- Summary: 수행 내용
- Verification: 실행한 검증 명령과 결과
- Git: commit/push 상태
- Decisions: 새로 생기거나 해결한 결정 항목
- Next: 다음 작업

## DECISIONS_REQUIRED 기준

기록해야 하는 경우:

- 외부 서비스 쓰기, 배포, 결제, 요금제 변경
- 비밀값 생성, 노출, 저장, 회전
- 운영 DB나 운영 인프라 파괴 가능 작업
- 자동 로그인, 자동 계정 전환, captcha/승인/보안 절차 우회
- 사용자가 선택해야 하는 제품 방향

기록하지 않고 진행하는 경우:

- 저장소 안의 코드, 문서, 테스트, 설정 수정
- 로컬 검증, 빌드, 타입체크, lint
- handoff, memory, roadmap 갱신
- 안전한 git status/diff/log 확인
- 검증된 로컬 commit과 승인된 remote push

## 권장 완료 명령

```bash
pnpm validate
pnpm agent:doctor
pnpm agent:status
pnpm agent:progress
pnpm agent:next
pnpm agent:sync
git status --short
git add -A
git commit -m "<type>: <summary>"
git push
```
