# External Tool Integrations

AgentApp이 관리하는 worker(Claude Code / Codex / Cursor / Gemini)에 외부 도구를 붙일 때의 통합 설계와 안전 경계를 모은 폴더다.

기준 문서: [`docs/security-model.md`](../../../docs/security-model.md), [`docs/plugin-mcp-extension-strategy.md`](../../../docs/plugin-mcp-extension-strategy.md), [`tools/agent-orchestrator/approval-policy.yaml`](../approval-policy.yaml).

## 현재 후보 (2026-06-19 평가)

| 통합 | 종류 | 절감 위치 | 위험도 | 상태 |
|---|---|---|---|---|
| [codebase-memory-mcp](codebase-memory-mcp/INTEGRATION.md) | 로컬 MCP 서버 (서드파티 바이너리) | 입력 토큰 (코드 이해 → 그래프) | 중 (prebuilt 바이너리) | **프로덕션 wiring 적용** (opt-in, 기본 off) |
| [ponytail](ponytail/INTEGRATION.md) | 코드 최소화 룰/프롬프트 프리앰블 | 출력 토큰 (불필요 코드 억제) | 낮음 (instruction-only) | **프로덕션 wiring 적용** (off/lite/full) |

## 공통 원칙

- 두 통합 모두 **프로젝트별 opt-in**이다. 기본값은 off.
- worker 실행 시 주입은 AgentApp이 이미 쓰는 **세션 프로필 경계**(`CODEX_HOME` / `CLAUDE_CONFIG_DIR` / `--user-data-dir` / `GEMINI_CONFIG_DIR`) 안에서만 한다.
- MCP 설정·룰 파일에는 비밀값을 넣지 않는다(security-model `forbidden`).
- 서드파티 바이너리는 버전 핀 + sha256 + 다운로드 출처를 통합 문서에 기록하고, 바이너리 자체는 `.tooling/`(gitignore)에 둔다.
- 신규 MCP/connector 설치는 `DECISIONS_REQUIRED.md`에 등록 후 진행한다.

## 프로덕션 wiring (적용됨, DEC-20260619-001=A)

- MCP 등록: `worker-launch-adapter.mjs` `resolveAdapter` → claude `--mcp-config` / codex·gemini config dir.
- Ponytail 주입: `dashboard-runtime.mjs` `applyPonytailPreamble`.
- 토글: dashboard 설정 패널 (MCP on/off + 바이너리 경로 + Ponytail 모드).
- 검증: `scripts/validate-integrations.mjs` (11 케이스), dashboard build.
- 남은 것: 인증된 worker 세션에서 실 사이클 검증(Claude/Gemini 로그인 필요).
