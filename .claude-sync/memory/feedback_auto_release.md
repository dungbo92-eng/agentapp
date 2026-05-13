---
name: 의미 있는 변경은 push 직후 자동 릴리즈
description: 데스크탑 자동 업데이트는 GitHub Release 가 발행돼야 동작하므로 의미 있는 코드 변경 push 후 즉시 pnpm desktop:release 를 실행한다
type: feedback
originSessionId: 2468d041-8263-4262-a320-e89945a1182b
---
설치된 AgentApp 데스크탑은 GitHub Release 의 `latest.yml` 을 통해서만 자동 업데이트되므로, 의미 있는 코드 변경이 main 에 push 되면 같은 사이클 안에서 릴리즈를 발행한다. 사용자의 추가 승인 없이 진행한다.

**Why:** 사용자가 "왜 자동 업데이트 안 되지" 라고 했을 때, 원인이 단순히 릴리즈 발행이 없었다는 사실이 드러났음. fix 가 main 에 들어가도 릴리즈가 없으면 설치본 사용자에게는 영원히 전달되지 않는다. 그래서 푸시 단계로 끝내지 말고 릴리즈까지 한 사이클로 묶는 것이 사용자의 기대.

**How to apply:**

- 트리거 경로: `apps/desktop/**`, `apps/dashboard/**`, `scripts/dashboard-*.mjs`, `scripts/worker-*.mjs`, `scripts/desktop-*.mjs`, `scripts/credential-vault.mjs`, `scripts/electron-*.mjs`, `package.json`, `build/**`. 이 중 하나라도 commit + push 되면 `pnpm desktop:release -- --bump patch` 실행.
- 문서·memory·plan·handoff·task-queue 만 바뀐 커밋은 릴리즈하지 않는다.
- 기능 추가는 `--bump minor`, 호환성 깨짐은 `--bump major`. 기본은 patch.
- `AGENTAPP_SKIP_RELEASE=1` 환경 또는 `gh auth status` 실패면 건너뛰고 `DECISIONS_REQUIRED.md` 에 토큰 점검 항목 남긴다.
- portable 빌드만 발행 금지. NSIS Setup + latest.yml 이 같이 올라가야 자동 업데이트가 동작한다.
- 같은 push 안에 트리거 파일이 여러 개여도 릴리즈는 한 번 (push 단위 patch 한 번).
- 릴리즈 노트는 최근 commit 메시지 요약을 `--notes` 로 전달한다.
- 상세 규칙: 프로젝트 `AGENTS.md` 11 절 / `CLAUDE.md` 자동 릴리즈 절.
