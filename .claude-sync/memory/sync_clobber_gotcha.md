---
name: sync-clobber-gotcha
description: project_state.md / roadmap 직접 repo 편집은 pre-commit이 로컬본으로 덮어써 손실됨
metadata: 
  node_type: memory
  type: project
  originSessionId: 10c85f17-50ff-4422-b966-a600d1f93649
---

`.claude-sync/memory/*.md` 와 `.claude-sync/plans/*.md` 는 pre-commit 훅(`claude-sync.mjs --push`)이 **`~/.claude` 로컬본을 repo로 무조건 복사**한다(`copyPreserveMtime(local→repo)`). 따라서 repo 파일만 Edit 하고 커밋하면 그 편집이 커밋 시점에 stale 로컬본으로 **덮어써져 사라진다**.

**Why:** claude-sync는 로컬 `~/.claude`(projects/E--agentApp/memory, plans)를 source of truth로 보고 push한다. repo 직접 편집은 source가 아니다.

**How to apply:** project_state.md 나 roadmap 을 갱신하면, repo Edit 후 반드시 로컬본에도 같은 내용을 복사한다:
`cp .claude-sync/memory/project_state.md ~/.claude/projects/E--agentApp/memory/project_state.md` (plans 도 동일). 그러면 pre-commit push 가 동일 내용을 복사해 보존된다. handoff/* (RUN_STATUS, DECISIONS, task-queue) 와 일반 소스는 동기화 대상이 아니라 영향 없다. 2026-06-19 첫 커밋에서 이 문제로 project_state 편집이 한 번 날아갔다.
