# codebase-memory-mcp 통합

출처: <https://github.com/DeusData/codebase-memory-mcp> · MIT · 평가 버전 **v0.8.1** (2026-06)

## 무엇인가

코드베이스를 **지식 그래프(SQLite)** 로 색인하는 로컬 MCP 서버. 에이전트가 파일을 일일이 읽는 대신 구조 질의(정의 위치, 콜 추적, 영향 분석, 아키텍처 개요)로 답을 얻어 **입력 토큰을 크게 줄인다**. 순수 C/C++ 단일 바이너리 + tree-sitter, 런타임 의존성 0.

노출 툴 14개: `index_repository, index_status, search_code, search_graph, query_graph, trace_path, get_code_snippet, get_graph_schema, get_architecture, list_projects, delete_project, detect_changes, manage_adr, ingest_traces`.

## 보안 posture (AgentApp 기준)

| 항목 | 판정 |
|---|---|
| repo 영향 | **read-only** (파일을 읽기만, 쓰지 않음) |
| 저장 위치 | 로컬 캐시 `~/.cache/codebase-memory-mcp/` (local-only, repo 밖) |
| 비밀값 | MCP 설정·그래프에 secret 없음 |
| 외부 통신 | 색인/질의는 로컬. 변경 감지는 git 폴링(로컬) |
| 공급망 | SLSA L3 provenance, cosign 서명(`.bundle` 동봉), VirusTotal 0, CodeQL |
| 분류 | security-model의 **MCP/connectors = 제한(read-only 우선)** 계층 |

신규 바이너리 설치라 [`DECISIONS_REQUIRED.md`](../../handoff/DECISIONS_REQUIRED.md)의 `DEC-20260619-001`로 등록 후 진행한다.

## 버전 핀 / 무결성

- zip: `codebase-memory-mcp-windows-amd64.zip`
- sha256: `a602ad090ed3f49d86c55472f73f27ad7055222806a82358f2e08513e027f00f`
- cosign 번들: `codebase-memory-mcp-windows-amd64.zip.bundle` (동일 릴리즈)
- 다운로드: `https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.8.1/`

바이너리는 `.tooling/codebase-memory-mcp/`(gitignore)에 두고 repo에 커밋하지 않는다. 업그레이드 시 이 표의 버전/sha를 갱신한다.

## PoC 결과 (2026-06-19, 이 repo 대상)

```
index_repository {"repo_path":"E:/agentApp"}
→ 94 files, 2191 nodes, 4330 edges, git 268 commits, ~6s
→ 자동 제외: .git, data, dist-desktop, node_modules, tmp,
            apps/dashboard/dist, apps/dashboard/node_modules
```

토큰 절감 실측 예:

- `search_code {"project":"E-agentApp","pattern":"applyQuotaLockout"}`
  → 정의(`scripts/dashboard-runtime.mjs:2729-2748`) + 모든 참조처(worker-launch-adapter.mjs:1414/1418 등)를 **~1.4KB JSON**으로 반환.
  → 같은 답을 파일 읽기로 얻으면 `dashboard-runtime.mjs`(184KB) + `worker-launch-adapter.mjs`(81KB) ≈ **265KB**. 약 **99% 절감**.
- `get_architecture {"project":"E-agentApp"}`
  → 566 함수 / 1054 CALLS / 언어·패키지 구조도를 **~1.6KB**로 반환.

## 단발 실행 (MCP 핸드셰이크 없이)

```bash
EXE=.tooling/codebase-memory-mcp/extracted/codebase-memory-mcp.exe
"$EXE" cli index_repository '{"repo_path":"E:/agentApp"}'
"$EXE" cli get_architecture  '{"project":"E-agentApp"}'
"$EXE" cli search_code       '{"project":"E-agentApp","pattern":"selectRoute"}'
```

> Windows에서 PowerShell 5.1은 native exe에 전달하는 JSON의 큰따옴표를 누락시키므로, JSON 인자는 **Git Bash** 또는 stop-parsing(`--%`)으로 전달한다.

## MCP 등록 (세션 프로필별)

AgentApp은 worker별 세션 프로필 경계 안에 등록한다. 예시는 [`mcp-config.example.json`](mcp-config.example.json)(Claude Code/Gemini), [`codex-config.example.toml`](codex-config.example.toml)(Codex).

- 프로덕션에서는 `.tooling/` 대신 안정 설치 경로를 가리킨다.
- 색인 제외 목록에 `.tooling/`, `data/`, `dist-desktop/`를 추가 권장.
- 인자 없이 실행하면 stdio MCP 서버로 동작한다.

## 프로덕션 wiring 설계 (보류 — Phase 13)

`worker-launch-adapter.mjs`의 각 어댑터(`resolveAdapter`)에서 프로젝트가 opt-in이면 세션 프로필 dir에 위 MCP 설정을 1회 기록한다. 이 파일은 데스크탑 트리거 경로라 변경 시 자동 릴리즈가 걸리므로, PoC와 분리된 별도 task로 검토 후 적용한다.
