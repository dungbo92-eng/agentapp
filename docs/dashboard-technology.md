# Dashboard Technology Decision

## Decision

AgentApp의 로컬 대시보드는 `Vite + React + TypeScript` 기반 SPA로 시작한다.

초기 구현은 외부 서비스나 운영 쓰기 없이 로컬 저장소의 상태 파일을 읽어 보여주는 데 집중한다.

## Why

- 이 프로젝트의 핵심 데이터는 이미 repo 안의 JSON/Markdown 파일이다.
- Vite는 React TypeScript 템플릿과 로컬 dev server 흐름을 공식 지원한다.
- React는 상태가 여러 화면으로 갈라지는 dashboard UI에 충분히 익숙하고, Cursor/Codex/Claude 모두 이어받기 쉽다.
- 별도 서버 프레임워크를 먼저 도입하지 않아도 progress, next task, decisions, worker states, budget summary 화면을 만들 수 있다.
- 배포가 아니라 로컬 운영 도구이므로 SSR, auth, production hosting, database는 MVP 범위에서 제외한다.

## Initial Shape

```text
apps/dashboard/
  index.html
  package.json
  src/
    main.tsx
    App.tsx
    data/
    components/
    views/
```

## Data Strategy

MVP는 repo 파일을 읽어 생성한 정적 JSON snapshot을 dashboard가 표시하는 방식으로 시작한다.

- 입력: `.claude-sync/memory/project_state.md`, roadmap, task queue, decisions, run status, usage budget, worker run states
- 변환: Node script가 dashboard용 snapshot JSON 생성
- 표시: Vite dashboard가 snapshot JSON을 읽어 화면 구성

이 방식은 브라우저가 임의 로컬 파일에 직접 접근하지 않아도 되고, 외부 API나 계정 세션이 필요 없다.

## Scripts

예상 스크립트:

```json
{
  "dashboard:prepare": "node scripts/dashboard-prepare.mjs",
  "dashboard:dev": "pnpm dashboard:prepare && pnpm --dir apps/dashboard dev",
  "dashboard:build": "pnpm dashboard:prepare && pnpm --dir apps/dashboard build"
}
```

## MVP Views

1. Progress and phase summary
2. Next task
3. Pending decisions
4. Worker status and latest run states
5. Usage budget summary
6. Handoff viewer

## Constraints

- No account automation.
- No external writes.
- No secrets in generated snapshots.
- No production deploy in MVP.
- Dashboard writes, if added later, must go through explicit local CLI commands and approval policy checks.

## Alternatives Considered

- Plain HTML/CSS/JS: smallest dependency surface, but component/state complexity will grow quickly.
- Next.js or full-stack framework: powerful, but unnecessary for a local read-only MVP.
- Tauri/Electron: useful later for desktop packaging, but too heavy before the dashboard shape is proven.

## References

- Vite guide: https://vite.dev/guide/
- Vite build guide: https://vite.dev/guide/build
- React installation guide: https://react.dev/learn/installation
