---
name: integrations-external-tools
description: "codebase-memory MCP + Ponytail 통합 — opt-in, 기본 off, v0.13.0 wiring 적용"
metadata: 
  node_type: memory
  type: project
  originSessionId: 10c85f17-50ff-4422-b966-a600d1f93649
---

사용자 요청으로 두 OSS를 AgentApp worker 실행 흐름에 통합(2026-06, v0.13.0). 둘 다 프로젝트 opt-in, 기본 off. 세부: `tools/agent-orchestrator/integrations/`.

- **codebase-memory-mcp** (DeusData, MIT, v0.8.1): 코드베이스 그래프 색인 로컬 MCP. **입력 토큰** 절감. `worker-launch-adapter.mjs` `resolveAdapter`가 `settings.integrations.codebaseMemoryMcp` 켜지고 바이너리 해석되면 등록 — claude `--mcp-config <json>`, codex `$CODEX_HOME/config.toml [mcp_servers]`, gemini `settings.json mcpServers`. 바이너리 경로: settings → `AGENTAPP_CMM_COMMAND` → `.tooling/`(dev) → PATH, 실패 시 graceful skip. **설치 앱에는 바이너리 미동봉** — 사용자가 설정에서 경로 지정하거나 PATH에 둬야 함.
- **Ponytail** (DietrichGebert, MIT, v4.7.0): 코드 최소화 룰. **출력 토큰** 절감. `dashboard-runtime.mjs` `applyPonytailPreamble(prompt, mode)` 가 off/lite/full 로 프롬프트 앞에 멱등 prepend. 단일 소스 `ponytail.rule.md`. safety 가드 보존.
- dashboard 설정 패널에 MCP 토글+경로+Ponytail 모드 select. 회귀 검증 `scripts/validate-integrations.mjs` (`pnpm validate` 체인).
- 결정: DEC-20260619-001=A(contained, 전역 설정 비침해). 미완: 인증 세션에서 실 사이클 검증(Claude/Gemini 로그인 필요).

기존 토큰 최적화 프로토콜(입력 프롬프트 압축)과 역할 분담: Ponytail=출력 코드, MCP=입력 코드 이해. 동기화 주의는 [[sync-clobber-gotcha]] 참고.
