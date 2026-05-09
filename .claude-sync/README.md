# .claude-sync — 공용 에이전트 memory/plan 동기화

이 디렉터리는 Claude Code의 로컬 memory/plan을 git으로 공유하기 위해 시작했지만, 이 프로젝트에서는 모든 AI 에이전트의 공용 상태 저장소로 사용한다.

## 동기화 대상

| Repo | Local Claude Code | 역할 |
|---|---|---|
| `.claude-sync/memory/*.md` | `~/.claude/projects/<projectId>/memory/*.md` | 현재 상태, 사용자 선호, 장기 메모리 |
| `.claude-sync/plans/*.md` | `~/.claude/plans/*.md` | 로드맵, 큰 계획 |
| `.claude-sync/plans-manifest.json` | 없음 | 동기화할 plan 목록 |

## 명령

```bash
pnpm agent:status
pnpm agent:doctor
pnpm agent:sync
pnpm agent:pull
pnpm agent:push
```

`pnpm agent:doctor`는 Node/pnpm/git, hooks, `.claude-sync`, 로컬 `~/.claude` 경로, git UTF-8 설정, sync 상태를 한 번에 점검한다.

`pnpm claude:*` 명령은 호환 alias다.

## hooks

| 시점 | 동작 |
|---|---|
| `git commit` | `~/.claude` → `.claude-sync` push 후 stage |
| `git pull` / merge | `.claude-sync` → `~/.claude` pull |
| branch checkout | `.claude-sync` → `~/.claude` pull |

## 규칙

- 의미 있는 진행이 생기면 `memory/project_state.md`를 갱신한다.
- 큰 방향 전환이나 단계 완료 시 `plans/agent-orchestrator-roadmap.md`를 갱신한다.
- 비밀값, 토큰, 계정 정보는 절대 기록하지 않는다.
- handoff 세부 파일은 `tools/agent-orchestrator/handoff`에 둔다.
