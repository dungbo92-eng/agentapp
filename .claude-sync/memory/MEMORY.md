# MEMORY

AgentApp 공용 memory index.

## 파일

- `project_state.md`: 현재 프로젝트 상태, 진행률, 다음 작업 후보
- `user_profile.md`: 사용자 선호와 작업 방식
- `archive.md`: 완료/폐기된 세부 로그
- [작업 후 commit/push 필수](feedback_commit_push.md) — 의미 있는 작업 끝에 검증→commit→push까지 묻지 않고 진행
- [push 후 자동 릴리즈](feedback_auto_release.md) — 데스크탑 트리거 경로 변경 push 직후 `pnpm desktop:release -- --bump patch` 까지 한 사이클로 진행
- [계정/한도 우회 자동화 거부](feedback_no_bypass.md) — 자동 로그인·강제 계정 전환·CAPTCHA/MFA 우회는 사용자가 요청해도 구현 안 함

## 운영 규칙

- 에이전트는 작업 시작 전 `project_state.md`를 읽는다.
- 작업이 의미 있게 진행되면 `project_state.md`를 갱신한다.
- 오래된 세부 로그는 `archive.md`로 이동한다.
- 비밀값은 기록하지 않는다.
