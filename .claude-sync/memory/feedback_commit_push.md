---
name: 작업 후 commit/push 필수
description: AgentApp에서 의미 있는 작업을 끝낼 때마다 사용자 추가 확인 없이 검증→commit→push까지 수행한다
type: feedback
originSessionId: 59074303-d9d6-4834-bed6-30bce60b5c00
---
작업이 끝나면 검증(`pnpm validate` 등) 후 git commit하고 origin remote에 push까지 마친다. "수정분 git 올려야지, 작업하면 이건 필수야" — 사용자 명시 지시.

**Why:** 다른 PC/다른 에이전트가 즉시 이어받는 멀티 에이전트 오케스트레이터 프로젝트라 로컬에만 머문 변경은 의미가 없다. CLAUDE.md/handoff-completion-protocol.md의 자율 진행 원칙에도 commit/push가 포함되어 있다.

**How to apply:** 코드/문서/설정을 수정한 모든 작업 끝에 적용. 단계는 1) 검증 명령 실행 2) `git status` 확인 3) 관련 파일만 stage 4) 한국어 또는 type prefix 커밋 메시지로 commit 5) `git push`. 사용자가 따로 막거나 destructive 영역(force push, history rewrite 등)이 아니면 묻지 않고 진행한다.
