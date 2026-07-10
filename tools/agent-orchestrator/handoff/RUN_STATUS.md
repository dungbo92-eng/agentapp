# RUN_STATUS

## 2026-07-10T_terminal_conpty_packaging_fix

이어받기: 직전 세션(`1dc4d483`)이 **세션 한도**로 중단됨. 중단 시점 진단 워크플로우(`w71ql6174`)도 대부분 한도로 실패(7개 중 rc-phone-regression 1개만 완료). 새 세션에서 직접 조사해 이어감.

사용자 3대 증상 규명:
1. **인앱 터미널 `Cannot find module '../build/Release/conpty.node'`** → 근본원인 = 순수 패키징 버그. `@homebridge/node-pty-prebuilt-multiarch` 는 N-API(node-addon-api ^7) 기반이라 ABI 무관(리빌드 불필요)인데, electron-builder 가 node_modules 수집 시 `build/Release/*.node` 를 통째로 드롭. `build.files` 화이트리스트에 node-pty 명시 포함이 없어서 winpty/conpty 바이너리가 asar 에 안 실림 → 설치앱에서 `require('../build/Release/conpty.node')` MODULE_NOT_FOUND. **설치앱 실측 확인**: `app.asar.unpacked/.../node-pty-prebuilt-multiarch` 에 `deps/`·`lib/`·`prebuilds/linux` 만 있고 `build/` 통째 부재.
2. **`E:\agentApp` 하드코딩 경로 (사용자별 설치 경로 상이)** → shipped 코드는 이미 포터블: main.mjs 가 `AGENTAPP_DATA_DIR`/`AGENTAPP_HANDOFF_DIR` 를 `app.getPath("userData")` 로 세팅(L193-194), 코드 경로는 `import.meta.url`, dashboard-server 가 app.asar 감지 시 `process.cwd()` 폴백 + 스냅샷의 `X:\agentApp` 를 사용자 워크스페이스로 serve 시 치환. `E:\agentApp` 잔존은 문서/예시/스냅샷(비실행 or 치환됨)뿐 — **기능적 하드코딩 버그 없음**.
3. **RC 세션 폰 미표시** → 런타임 데이터 실측: 주요 프로젝트 2개(agentApp, sytleOsjang) `remoteControl=false`(토글 off), RC 켠 건 D:\python(autoTr) 1개뿐. **코드 버그 아닌 프로젝트 토글 상태** — 사용자가 원하는 프로젝트의 📱 토글을 켜면 해결.

수정(#1 실제 코드 변경):
- **package.json `build.files`**: `node_modules/@homebridge/node-pty-prebuilt-multiarch/**/*` 명시 포함(→ electron-builder 가 build/Release 를 수집해 asar 인덱스에 unpacked 로 기록). `.pdb`(~28MB)·`.map`·`.test.js`·`src/`·`deps/`(winpty 빌드 소스, 런타임 불요) 제외로 경량화(node-pty 8.4M).
- **scripts/after-pack.cjs**(신규 afterPack 훅): 팩 결과 unpacked 에 `conpty.node`/`pty.node` 없으면 **빌드 실패**시키는 릴리즈 가드 — 깨진 터미널 재릴리즈(v0.15~v0.17 회귀) 재발 차단. (`build/` 는 gitignore 라 추적되는 `scripts/` 에 배치.)
- **apps/desktop/main.mjs**: 인앱 터미널 기본 cwd 를 packaged 시 예측불가한 `process.cwd()`(System32 등) 대신 `app.getPath("home")` 폴백.

검증(실측): `electron-builder --dir --win --x64` 2회(훅 이동 전/후) → afterPack 가드 통과 + `app.asar.unpacked/.../build/Release/` 에 conpty.node(312832)/pty.node/winpty-agent.exe/winpty.dll 실파일 확인, `.pdb` 0개. node-pty 패키지 전체 asarUnpack 대상이라 `lib/windowsPtyAgent.js`(unpacked)에서 `../build/Release/conpty.node`(unpacked) 직접 로드 — asar 리다이렉트 불필요. `node --check` 전체, `pnpm validate` 통과(runtime-race 50/50, e2e-server 7/7 포함).

Git: commit + main push + desktop 릴리즈(patch — 패키징 버그 수정).

미검증(업데이트 후 사용자 확인): 실제 설치앱 재설치/자동업데이트 후 인앱 터미널 실행(N-API 라 Electron 42 에서 로드돼야 함).

## 2026-07-09T_rc_account_project_cross_product

사용자 요청: 선택된 프로젝트가 2개면 계정을 나눠 총 2세션이 아니라, **각 계정이 프로젝트마다 세션을 열어야** 함(계정 2 × 프로젝트 2 = 계정마다 2세션, 총 4세션).

수정: `listRemoteControlTargets` 를 라운드로빈 → **ready 계정 × 선택 프로젝트 교차곱**으로 변경. 순수 함수 `buildRemoteControlTargets(accounts, projects)` 로 분리(테스트용). 프로젝트 없으면 계정당 1세션 폴백 유지. main.mjs 세션 키는 이미 `accountId::projectId` 라 유니크 — 각 (계정,프로젝트) 쌍이 독립 세션. 계정 카드 배지 `📡 RC ×N` 의 N = 그 계정의 프로젝트 세션 수.

검증: node --check; validate-remote-control 31/31(신규: 교차곱 개수/계정별 프로젝트 매핑/폴백); dashboard:build 통과.

Git: commit + main push + desktop 릴리즈(patch).

## 2026-07-09T_rc_trust_dialog_root_cause_and_project_toggle

사용자 보고: (1) "2개 켜졌다는데 폰에 아무 세션도 안 보임", (2) 프로젝트별로 모바일 세션 켤지 선택하게.

**근본 원인 규명(#1, 실측)**: `claude --remote-control` 은 **interactive TTY 필수**(비-TTY면 `--print` 로 빠져 "Input must be provided..." 즉시 실패 — 실측). 숨긴 Start-Process 는 TTY 를 준다(실측 stdin/stdout isTTY=true). 계정 프로필도 인증 정상(`--print`→OK). 그런데도 폰에 안 뜸. 이유 = **미신뢰 폴더에서 interactive 진입 시 "이 폴더를 신뢰?" 대화상자에 (창이 숨겨져) 멈춰 RC 등록이 안 됨.** 프로필 `.claude.json` 신뢰 폴더는 tmpdir 1개뿐이었고, dev cwd=E:\agentApp 는 미신뢰였음. **폰 실측으로 확정**: 신뢰된 tmpdir 세션 → 폰에 뜸 / 미신뢰 폴더 → 안 뜸 / 미신뢰 폴더를 사전신뢰 처리 → 다시 뜸(dungdy92 계정, 3회 A/B 확인).

**수정**:
- **worker-launch-adapter**: `normalizeClaudeCwd(p)`(claude 프로젝트 키 형식 = forward-slash + 드라이브 대문자, `--print` 로 claude 실제 키가 `E:/agentApp` 임을 확인해 일치 검증) + `ensureClaudeFolderTrusted(configDir, cwd)`(spawn 전 `.claude.json` 의 `projects[key].hasTrustDialogAccepted=true` 기록, best-effort, 멱등). `buildRemoteControlSpec` 이 cwd 를 normalize 하고 신뢰 처리 후 반환. **이게 폰 미표시의 진짜 수정.**
- **arg 견고화**: `Start-Process -ArgumentList` 가 공백/따옴표 인자를 재파싱하며 쪼개던 버그(실측: 복잡한 `-e` 인자 실행 실패) → `quoteWindowsArg`(MSVCRT 규칙)로 단일 커맨드라인 문자열 구성. 프로젝트명에 공백 있어도 세션명 안 깨짐.
- **프로젝트별 토글(#2)**: `normalizeProject` 에 `remoteControl`(기본 on), `updateProject()` 추가. `listRemoteControlTargets` 가 `remoteControl!==false` 프로젝트만. server `POST /api/agentapp/projects/update`. UI 프로젝트 행에 📱 토글(on/off, 흐림 표시) + `toggleProjectRemoteControl`.

검증: node --check 3파일; validate-remote-control 27/27(신규: normalizeClaudeCwd, ensureClaudeFolderTrusted 기록/멱등, arg 공백, updateProject); pnpm validate(runtime-race 사전 플래키만 FAIL); dashboard:build 통과. **폰 실측 A/B/C** 로 근본원인·수정 확정.

Git: commit + main push + desktop 릴리즈(minor — 프로젝트 토글 기능 + RC 실동작 수정).

## 2026-07-09T_rc_hidden_window_and_per_project

사용자 요청: (1) RC cmd 창이 뜬다 → 창 완전 숨김(백그라운드), (2) 숨겨도 모바일 세션은 사용 가능해야 함, (3) RC 세션 프로젝트 경로 기본값이 이상 → **프로젝트 경로마다 세션 생성**(경로 4개면 4세션).

근본 원인(창): 기존 `spawnRemoteControlConsole` 은 `cmd /c ... {detached:true, windowsHide:true, stdio:ignore}`. `detached`=`DETACHED_PROCESS` 라 자식이 콘솔을 못 받고, `claude`(Ink TUI)가 스스로 `AllocConsole` → **보이는 창**을 만든다. `windowsHide` 로는 이 창을 못 막는다.

수정:
- **worker-launch-adapter**: `spawnRemoteControlConsole` 을 **PowerShell `Start-Process -WindowStyle Hidden -PassThru`** 로 교체. Start-Process 는 stdio 를 리다이렉트하지 않으므로 claude 가 **실제 콘솔 TTY** 를 확보(→`--print` 로 안 빠짐 = 모바일 원격제어 유지)하고 그 콘솔 창은 숨겨진다. `-PassThru` 로 실제 PID 를 stdout 에 받아 tree-kill 에 사용. 15s 가드. `buildRemoteControlLaunchScript(spec)`(순수 함수, env/args/cwd 를 안전 이스케이프) 분리·export. 반환을 `Promise<{pid,reason}>` 으로 변경. 비 win32 는 기존 detached 폴백.
- **dashboard-runtime**: `listRemoteControlTargets()` 추가 — 등록된 **프로젝트 경로마다** ready Claude 계정을 라운드로빈 배정해 `{account,project}` 목록 반환. 유효 경로 없으면 계정당 1세션(기본 cwd) 폴백. `existsSync` import.
- **main.mjs**: 계정당 1세션 → **타깃(프로젝트)당 1세션**. rcSessions 키 `accountId::projectId`. spawn 을 `await`(PID 수신)로, `isPidAlive(pid)`(process.kill(pid,0)) 로 liveness/중복 스킵/상태 재판정. spec 에 `{name:프로젝트명, workspace:프로젝트경로}` 주입. status 에 projectId/projectName 포함.
- **main.tsx**: RC status 타입에 projectId/projectName. 계정당 다중 세션을 running 우선 집계 + 실행 프로젝트명 tooltip, 배지 `📡 RC ×N`.
- **validate-remote-control**: 신규 시그니처 검증 케이스 추가(21/21 통과) — launch script 의 Start-Process/Hidden/PassThru/WorkingDirectory/env/따옴표 이스케이프, workspace override, listRemoteControlTargets [].

검증: node --check 3파일; validate-remote-control 21/21; pnpm validate 는 validate-runtime-race(사전 플래키, write 경로 무관)만 FAIL 나머지 통과(integrations 11, remote-control 21); pnpm dashboard:build 통과. **실측**: 무해한 node 프로세스를 hidden Start-Process 로 띄워 PID 캡처 + 생존 확인(창 안 뜸). 실 claude 세션+폰 end-to-end 는 업데이트 후 사용자 확인 필요.

Git: commit + main push + desktop 릴리즈(minor — 프로젝트별 세션 기능 추가).

## 2026-07-09T_claude_session_expiry_detection

사용자: "AgentApp에 세션 있을텐데 걔로 바로 remote control 못 시켜? 내가 뭘 해야하니?" — RC 가 계정 프로필로 떴는데 로그인을 다시 요구.

진단: AgentApp Claude 세션 프로필의 `.credentials.json` 은 존재하지만 **OAuth 토큰이 2026-06-03 에 만료**(5주 전, dungbo92/leemg 둘 다). `claude --print` 테스트 = `401 Invalid authentication credentials`. 그런데 `detectAccountSession`/`hasSessionArtifacts` 는 **파일 존재만** 보고 ready 로 판정 → **오탐**. 그래서 죽은 세션에 RC 를 띄워 로그인 요구. (인증은 키체인 아님, 프로필의 `.credentials.json` 에 저장됨.)

수정: `dashboard-runtime.mjs` 에 `readClaudeTokenExpiry(sessionProfile)` 추가. `detectAccountSession` 의 claude ready 경로에서 `.credentials.json` 의 `claudeAiOauth.expiresAt` 를 읽어 **7일 넘게 만료면 needs-login** 으로(만료일 + '로그인' 안내 reason). → 만료 계정은 상태등 🔴, `listReadyClaudeAccounts` 에서 제외돼 RC 가 죽은 세션을 안 띄운다.

검증(실 데이터): 두 Claude 계정 모두 needs-login 으로 재판정, `listReadyClaudeAccounts` 2→0. pnpm validate(remote-control/integrations/configs) 통과.

사용자 액션: 각 Claude 계정을 AgentApp 에서 **한 번 재로그인**(계정 카드 '로그인' 버튼) → 토큰 갱신 → 이후 RC 자동 연결.

Git: commit + main push + desktop 릴리즈(patch).

## 2026-06-20T_rc_hidden_console_working

사용자: "remote control 켜진거 맞냐? 안 켜졌는데" — v0.15.1 에서 내가 "상태등만"을 "기능 제거"로 과하게 해석해 실제로 꺼져 있었음. 정정하고 제대로 작동하게 붙임.

근본 원인 확정: node-pty **win32 prebuilt 자체가 없음**(`prebuilds/win32-x64` 비어 있고 `build/Release` 없음) + Electron ABI + `npmRebuild:false` → 패키지에서 pty 못 뜸(= v0.15.0 conpty 크래시). `claude --remote-control` 은 Ink TUI라 TTY 필요, 파이프로 실행하면 `--print` 로 빠져 실패.

해결 (node-pty 버리고 숨긴 콘솔):
- worker-launch-adapter: `buildRemoteControlSpec` + `spawnRemoteControlConsole` — `cmd /c <claude.cmd> --remote-control <name>` 을 `detached + stdio:ignore + windowsHide:true` 로 실행 → **보이는 창 없이 TTY 확보** (node-pty 불필요).
- dashboard-runtime: `remoteControlAutoStart`(기본 on), `listReadyClaudeAccounts` 복원.
- main.mjs: 시작 시 ready Claude 계정마다 spawn, stop/quit 시 `taskkill /T` tree-kill, IPC get/start/stop. conpty 미사용 → 크래시 없음.
- preload/main.tsx: `remoteControl` API + 계정 카드에 세션 상태등(🟢 ready/🟡 paused/🔴 needs-login) + 실행 중이면 📡 RC 표시.
- `validate-remote-control`(10) 복원 + 체인 등록.

**실계정 E2E 검증(핵심)**: 실 runtime(`AppData/Roaming/agent-app/data`) + 실 세션 프로필로 `listReadyClaudeAccounts`→spawn 을 돌려, ready Claude 2계정(dungbo92-gmail / leemg-hanilnetworks) 모두 `claude --remote-control` 세션이 **12초 생존(TTY 확보)** 함을 확인 후 정리. 콘솔 spawn 메커니즘은 별도로 3회(Start-Process hidden, node windowsHide 등) 재현.

검증: pnpm dashboard:build 통과; validate-remote-control 10/10; node --check 전체; 실계정 spawn 2/2 생존. (validate-runtime-race 플래키 무관.)

Git: commit + main push + desktop 릴리즈(patch).

## 2026-06-20T_rc_crash_fix_status_light

사용자 보고: 설치 앱에서 `Cannot find module '../build/Release/conpty.node'` 오류. + "그냥 왼쪽 계정에 초록/빨강 상태등만 있어도 될듯".

원인: v0.15.0 의 remote-control 자동실행이 시작 시 node-pty(conpty.node)를 로드하는데, 패키징 앱에서 `conpty.node` 가 asar 에서 해결되지 않아 매 시작 로드 실패가 떴다.

수정 (de-scope):
- remote-control PTY 자동실행 + 패널 + IPC + preload API + `buildRemoteControlSpec` + `listReadyClaudeAccounts` + `remoteControlAutoStart` + `validate-remote-control` **전부 제거** (v0.15.0 되돌림). 시작 시 pty 로드 안 함 → conpty 오류 사라짐.
- 대신 왼쪽 계정 카드 이름 옆 **세션 상태등** 추가: ready=🟢, paused=🟡, needs-login/기타=🔴 (`account.sessionStatus` 기반).
- 원격제어가 필요하면 사용자가 계정별로 터미널에서 `claude --remote-control` 직접 실행 (상태등으로 어느 계정이 살아있는지 확인).
- 참고: in-app 터미널의 node-pty 는 lazy 로드라 시작 크래시와 별개. 패키지 conpty.node 해결은 후속 과제.

검증: pnpm dashboard:build 통과; validate-integrations 11/11 (pnpm validate 내); node --check 전체 통과; dangling ref 0 grep. (validate-runtime-race 플래키 무관.)

Git: commit + main push + desktop 릴리즈(patch).

## 2026-06-20T_claude_remote_control

사용자 정정: "RC" = LAN 대시보드가 아니라 **`claude --remote-control`** (Claude CLI 내장 원격제어, `claude --help` 에 존재). 계정별로 그 명령을 실행만 하면 됨. 지난 auto-rc(LAN) 는 오해였음.

**되돌림 (v0.14.0 LAN auto-rc revert)**: main.mjs 시작 auto-bind + get-lan-access 필드(manualEnabled/autoActivated/autoRcOnSession) + needsRestart 변경, main.tsx 토글/힌트/manualEnabled, dashboard-runtime `autoRcOnSession`/`ensureLanAccessToken`/`hasReadyClaudeSession`, validate-auto-rc 전부 제거. 수동 "모바일 접속" 토글은 원래대로.

**구현 (제대로)**:
- dashboard-runtime: `remoteControlAutoStart`(기본 on), `listReadyClaudeAccounts()`(enabled+ready Claude 계정 목록).
- worker-launch-adapter: `buildRemoteControlSpec(account)` — claude 경로 + 계정 `CLAUDE_CONFIG_DIR` + args `["--remote-control", <name>]` + cwd.
- main.mjs: 시작 시 ready Claude 계정마다 node-pty 로 `claude --remote-control <계정명>` spawn·유지, 앱 종료 시 정리. IPC get/start/stop + data/exit 이벤트.
- preload: `remoteControl` API. main.tsx: 원격제어 패널(세션 목록 상태 + 시작/중지 버튼).
- `validate-remote-control.mjs`(9 케이스) 추가, pnpm validate 체인에 auto-rc 대체 등록.

동작: 앱 켜지면 ready Claude 계정마다 remote-control 세션 자동 실행 → 폰 Claude 앱/웹에서 같은 계정 로그인 → 원격 조종. LAN·방화벽·Tailscale 불필요.

검증: pnpm dashboard:build 통과; validate-remote-control 9/9 + validate-integrations 11/11 (pnpm validate 내); node --check 전체. (validate-runtime-race 플래키 무관.)
미검증(불가): 실제 세션이 폰에 잡히는 end-to-end — remote-control 실행은 사용자 Claude 계정에 붙는 외부 부작용이라 여기서 자동 실행하지 않음. 업데이트 후 사용자 확인 필요.

Git: commit + main push + desktop 릴리즈(기능=minor).

## 2026-06-20T_auto_rc_on_claude_session

사용자 요청: 앱 시작 시 Claude 계정 세션을 체크해 살아있으면 모바일 원격 접속(RC/LAN)을 자동으로 켜라 — 모바일에서 Claude 세션 사용.

구현:
- `dashboard-runtime.mjs`: `normalizeSettings`에 `autoRcOnSession`(기본 on) 추가. `hasReadyClaudeSession()`(enabled Claude 계정 중 `detectAccountSession`=ready 있으면 true), `ensureLanAccessToken()`(lanAccessEnabled 무관하게 토큰 생성·영속) 추가.
- `apps/desktop/main.mjs`: 시작 시 `effectiveLan = lanAccessEnabled || (autoRcOnSession && hasReadyClaudeSession())`. auto면 토큰 보장 후 0.0.0.0 바인딩. **lanAccessEnabled 설정은 안 바꿈** → 세션 없으면 다음 시작 때 자동으로 127.0.0.1. `get-lan-access`가 `enabled`(effective=바인딩됨), `manualEnabled`, `autoActivated`, `autoRcOnSession` 반환, `needsRestart`=수동 on & 미바인딩만.
- `main.tsx` 모바일 패널: 수동 체크박스는 `manualEnabled` 반영, "Claude 세션 있으면 자동 켜기(RC)" 토글 + "자동 켜짐" 힌트 추가.
- `scripts/validate-auto-rc.mjs`(6케이스) 추가, `pnpm validate` 체인 등록.

동작: 앱 켤 때 Claude 세션 ready면 → 모바일 접속 자동 ON → 폰에서 토큰 URL 로 대시보드 접속해 Claude worker 구동. 세션 없으면 자동 OFF. 사용자가 자동 끄면 수동 토글로만.

검증: pnpm dashboard:build 통과; validate-auto-rc 6/6, validate-integrations 11/11 (pnpm validate 체인 내); node --check 전체 통과. (validate-runtime-race 는 이 PC 사전 환경 플래키 — 무관.)

Git: commit + main push + desktop 릴리즈(기능=minor).

## 2026-06-19T_external_tool_integration_eval

사용자 요청: codebase-memory-mcp + Ponytail 두 OSS 를 AgentApp 에 붙일 수 있는지 평가/체크.

수행:
- **codebase-memory-mcp v0.8.1 contained PoC**: Windows 바이너리 + cosign 번들을 `.tooling/`(gitignore)에 다운로드(sha256 a602ad…), `cli index_repository` 로 이 repo 색인 — 94 files / 2191 nodes / 4330 edges / git 268 commits, ~6s, node_modules 등 7개 디렉터리 자동 제외. `search_code applyQuotaLockout` → 정의+참조처 ~1.4KB JSON(파일 직독 265KB 대비 ~99%↓), `get_architecture` → 구조도 ~1.6KB. 전역 `install` 대신 세션 프로필 경계 등록 설계로 contained.
- **Ponytail v4.7.0 dry-run**: 핵심 룰/플러그인 매니페스트 스테이징, `scripts/integrate-ponytail.mjs`(+ `pnpm agent:ponytail`) 로 off/lite/full 프리앰블 합성 + 멱등성 검증. instruction-only, safety 가드 보존 확인.
- 통합 문서 `tools/agent-orchestrator/integrations/**`, `plugins.example.yaml` 레지스트리, roadmap Phase 13, task-queue 3건, `DEC-20260619-001`, project_state 갱신.

검증:
- pnpm validate 중 validate-configs / validate-quota-parser / validate-e2e-server 통과, 신규 스크립트 node --check 통과.
- validate-runtime-race FAIL — **사전 존재 환경 플래키**(이 PC에서 50-way 동시 write 시 Windows `rename` EPERM). 변경 파일에 runtime/*.mjs 없음(git status로 확인), 본 작업과 무관.

Git: 커밋 + main push 완료. **자동 릴리즈 건너뜀** — package.json 이 트리거 경로지만 변경은 CLI 스크립트 alias + 문서뿐이라 데스크탑/대시보드/런타임 동작 변화 없음.

Next: DEC-20260619-001 결정 후 worker-launch-adapter MCP 등록 + dashboard 토글(Phase 13 프로덕션 wiring).

## 2026-06-04T_handoff_context_injection

사용자 보고 — 같은 프로젝트인데 worker 가 매번 절반쯤 다시 시작하는 "띄엄띄엄" 현상. 직전 세션 분석:

원인 (직전 worker 진단):
1. `claude --print` 같은 fresh 세션은 이전 추론·대화가 0. 인계는 오로지 파일에만 의존.
2. `decorateAutoChainPrompt` 가 다음 작업 제목 + 규칙만 붙임. 직전 worker 의 `lastMessage` (가장 풍부한 인계 자료) 는 다음 프롬프트에 전혀 안 들어감.
3. project 마다 handoff 기록률 편차 (sytleOsjang 의 RUN_STATUS 기록률 3%). 다음 세션이 깜깜이로 시작.

수정 (`scripts/dashboard-runtime.mjs`):
- `buildHandoffContext(prevRun, lastMessageText)` 추가. 직전 작업 제목 + 최종 보고 본문(마지막 ~900자, STATUS/CHAIN_DONE/NEXT_STEPS 마커 라인 제거) 을 `## 직전 세션 인계` 블록으로 묶어 다음 프롬프트 앞에 주입.
- `tryAutoChain` 의 `chainPrompt` 조립을 `decorateAutoChainPrompt(\`${handoffContext}${basePrompt}\`)` 로 변경. generic_continuation 처럼 작업 지시가 약할수록 직전 맥락이 더 결정적.
- 중복 게이트(`recentPrompts`) 의 자카드 유사도가 헤더·규칙 노이즈로 거짓 양성 내는 문제 보정. `extractTaskCore(prompt)` 가 공통관리 헤더 / 인계 블록 / 규칙 블록을 떼어내고 실제 작업 지시만 추출해 비교 대상으로 사용.

검증:
- pnpm validate 통과 (quota parser / runtime race / e2e server 전부 ok).
- pnpm dashboard:build 통과.
- buildHandoffContext sanity 4 케이스 — 빈 입력 / NEXT_STEPS 마커 제거 / 이중 split 시 실제 작업만 추출 / 900자 초과 시 앞부분 생략 — 모두 통과.

호환성: 직전 prompt/lastMessage 가 비면 빈 문자열을 반환해 기존 흐름과 동일. `decorateAutoChainPrompt` 의 idempotent 마커 첨부도 그대로.

이어받기 메타: 직전 에이전트가 토큰 한도로 빌드 직전에 중단 → 이 세션이 같은 git working tree 에서 inline sanity test + build 검증 + handoff/commit/push/release 까지 마감.

## 2026-05-17T_writeruntime_race_and_fixed_port

사용자 보고: (1) "프로젝트/계정 설정이 다 날아감" (2) "모바일 접속 포트가 매 시작 바뀜".

원인:
1. **writeRuntime race** — 같은 프로세스의 await 사이 두 호출이 동시에 들어가면 각자 fd 로 같은 .bak 파일을 열어 OS 레벨에서 interleave. 짧은 쓰기 위에 긴 쓰기의 꼬리가 남아 .bak 가 invalid JSON 으로 corrupt → 다음 writeRuntime 의 readDiskRuntimeRaw 가 null 반환 → accounts safety net 우회 → 빈 accounts 가 그대로 live 에 persist. 게다가 safety net 이 accounts 만 보호하고 projects 는 무보호.
2. **포트 random** — dashboard-server 가 port=0 (OS 임의 할당) 로 listen → 매 재시작마다 다른 포트 → 모바일 즐겨찾기 깨짐.

수정:
- `writeRuntime` 을 `withRuntimeLock` 으로 직렬화. 동시 호출은 chain 으로 순차 처리.
- `atomicWriteJson` — `<file>.tmp-<pid>-<ts>-<rand>` 에 다 쓴 뒤 `rename` 으로 교체. partial write 로 인한 corrupt 차단.
- 백업은 `copyFile(live → .bak)` 로 변경 (단일 syscall, write 보다 안전).
- safety net 에 projects 도 추가.
- `readRuntime` 이 live 가 비어 있으면 .bak 자동 복구 시도.
- `dashboard-server` 기본 포트 `51820`, 충돌 시 +1..+10 시도 후 OS 임의 할당 fallback. 단일 인스턴스에선 항상 51820.

검증:
- 같은 PC 에서 사용자 데이터 복구: `.bak` 가 손상 (끝부분 잔여 바이트) 됐지만 본문 4 accounts + 4 projects 살아 있어 `.recovered` 로 추출 후 live 에 병합.
- 100 동시 빈 writeRuntime 부하 테스트: accounts/projects 모두 보존, live/.bak 둘 다 valid JSON.
- 포트 시퀀스: 첫 인스턴스 51820, 2 번째 51821, 3 번째 51822 (fallback 정상).

## 2026-05-16T_loopback_url_when_lan_bind

v0.5.0 / v0.5.1 에서 사용자가 "모바일 접속" 토글을 켠 뒤 재시작하면 빈 화면만 뜨는 회귀. 원인: dashboard-server 가 bind host 와 client URL 을 같은 변수로 만들어, host=0.0.0.0 일 때 `http://0.0.0.0:<port>/` 라는 connect 불가 URL 을 반환. Electron renderer 가 그걸 그대로 loadURL → did-fail-load → 빈 화면.

수정: `createDashboardServer` 가 bind host 와 별개로 client URL 의 host 를 도출. 0.0.0.0 / :: 면 127.0.0.1 으로 강제. LAN IP 는 detectLanIps 가 networkInterfaces 로 별도 수집하므로 영향 없음.

검증: 0.0.0.0 bind 시 host 는 그대로 0.0.0.0, url 만 http://127.0.0.1:<port>/. validate 통과.

## 2026-05-16T_tailscale_label

v0.5.0 의 LAN 접속은 0.0.0.0 으로 바인딩해 모든 IPv4 인터페이스를 받아주기 때문에 PC 에 Tailscale 만 설치하면 이미 동작. UX 만 보강:

- main.mjs: `classifyIp` 추가 — 100.64.0.0/10 (Tailscale CGNAT), 192.168 / 10 / 172.16-31 (LAN), 169.254 (link-local, 숨김), 그 외 public. 인터페이스 이름이 "Tailscale" 이면 그 이름도 hint.
- getLanAccess 가 `entries: [{ url, address, kind, interface }]` 와 `hasTailscale` 추가 반환.
- main.tsx: URL 마다 보라(Tailscale)/파랑(LAN)/빨강(public) 배지 + 인터페이스 이름. Tailscale 감지 안 됐을 때 설치 링크 안내, 감지됐을 때는 "보라는 어디서든, 파랑은 같은 Wi-Fi" 한 줄 도움말.

11/11 classify 단위 테스트 통과 (100.64-127 / 100.128+ / 192.168 / 10/8 / 172.16-31 vs 172.32 / link-local / 이름 기반 fallback).

## 2026-05-16T_mobile_lan_access

같은 Wi-Fi 의 모바일/태블릿에서 호스팅 없이 대시보드 보고 싶다는 요청. 추가:

- settings: `lanAccessEnabled` (bool, default false), `lanAccessToken` (32자, 켤 때 자동 생성·영속). normalizeSettings 가 토글 ON 일 때만 토큰 새로 만들고 그 뒤에는 유지.
- scripts/dashboard-server.mjs: 비로컬호스트 요청에 token 검증 미들웨어. query `?t=`, header `X-AgentApp-Token`, cookie `agentapp_t` 셋 다 받음. 첫 통과 시 cookie 심어 같은 페이지 자원 요청 통과.
- apps/desktop/main.mjs: 시작 시 settings 읽어 host=0.0.0.0 또는 127.0.0.1 결정. `agentapp:get-lan-access` IPC 가 현재 bind 상태 + token + 자동 감지한 LAN IPv4 들로 URL 배열 반환. needsRestart 도 동봉.
- preload: `getLanAccess` 추가.
- main.tsx: contextRail 에 "모바일 접속" 패널 신규. 토글, 재시작 필요 경고, URL 목록 클릭 → 복사. token = URL 의 ?t= 부분이라 즐겨찾기 한 번 저장으로 재접속 가능.

검증: 설정 lifecycle 토글 on/off 시 토큰 생성·영속 OK, validate / dashboard build 통과.

## 2026-05-16T_preload_esm_fix

v0.4.3 재설치 후에도 버전 pill / 트레이로 버튼 / 컴팩트 모드 IPC 가 동작하지 않는 회귀 분석.

원인: `apps/desktop/preload.mjs` 가 `const { contextBridge, ipcRenderer } = require("electron")` 로 시작하는데, 확장자가 `.mjs` 라 Electron 28+ 가 이 preload 를 ESM 으로 해석한다. ESM 에는 `require()` 가 정의돼 있지 않아 첫 줄에서 ReferenceError 로 preload 가 silently 실패 → `window.agentapp` 미정의 → renderer 의 `desktopApi === undefined` → IPC 의존 UI 가 전부 사라지고 컴팩트 모드 클릭이 main 프로세스로 전달되지 않음.

수정:
- `import { contextBridge, ipcRenderer } from "electron";` 로 전환. sandbox 는 main.mjs 의 webPreferences 에서 이미 false 라 ESM import 가 동작.
- preload 상단 주석에 원인/주의사항 명시.

`node --check` 통과, dashboard build 통과. 사용자 환경에서는 v0.4.4 설치 후 IPC 가 살아나야 함.

## 2026-05-16T_repeat_account_breakout

사용자 worker-launches 로그 분석에서 발견한 4 가지 회귀 보완:

1. **`[에러분석]` 태그 미인식** — 코드는 `[오류분석]` 만 maintenance 로 인식하던 패턴이라 사용자가 `[에러분석]` 으로 쓰면 분류가 general 로 떨어져 회사 계정 우선 라우팅이 작동하지 않았다. classifyTaskDomain 의 명시 태그 정규식을 동의어 변형(오류/에러 × 분석/진단/디버그/디버깅/수정, 단독 디버그, 검증, 프로세스 분석, 코드 리뷰, 로그 분석, 스키마)으로 확장.
2. **새로운 거절문 형태 미감지** — 실제 회사 계정 거절문 `"현재 본 조직은 Claude를 ... 도입 초기 단계입니다. C# 코드, T-SQL, 스키마, 에러 분석 등 순수 개발 작업에만 응답 가능합니다. ... 추후 사용 정책이 확장되면 별도 안내드립니다."` 가 기존 ORG_POLICY_PATTERNS 일부만 매칭하던 상태. `/도입\s*초기\s*단계/`, `/순수\s*(?:개발|코딩)\s*작업/`, `/(?:개발\s*작업|코딩\s*작업)\s*에(?:만|\s*한해)/`, `/추후\s*(?:사용\s*)?정책이?\s*확장되면/` 4 개 패턴 추가. 실제 거절문 7 개 패턴 매칭 + 정상 응답 false positive 0 확인.
3. **같은 prompt + 같은 계정 반복 spawn 자동 감지** — startRun 에 30 분 윈도 dedupe 로직 추가. runHistory 에서 prompt 정규화(태그/구두점/대소문자 제거 후 포함 관계) 일치 + 같은 accountId 가 (a) 2 회 이상이고 그 중 하나라도 policy_blocked/quota_limited/failed 였거나, (b) 3 회 이상이면 그 계정을 자동으로 `excludeAccountIds` 에 추가. 사용자가 같은 prompt 를 반복 입력하거나 autoChain 이 같은 자리를 돌 때 회사 계정에 같은 거절을 계속 받던 핵심 패턴을 dashboard 레벨에서 차단.
4. **컴팩트 모드 영속성** — 기존엔 windowMode 가 메모리에만 존재해 재시작 시 항상 "full" 로 복귀. `apps/desktop/main.mjs` 에 `loadPersistedWindowMode()`/`savePersistedWindowMode(mode)` 추가, `userData/window-mode.json` 에 `{ mode }` 기록. `createMainWindow` 가 시작 시 로드해 BrowserWindow width/height/alwaysOnTop 을 그에 맞춰 만들고, compact 면 우하단 위치까지 적용. `setWindowMode` 에서 변경 시 저장. 트레이 메뉴 ↔ UI 버튼 ↔ 영속 상태가 단일 source of truth (windowMode) 로 일치.

검증:
- classifyTaskDomain 9 케이스 (`[에러분석]`, `[오류분석]`, `[에러 분석]`, `[디버그]`, `[버그수정]`, `[검증]`, `[프로세스분석]`, general 2 건) 모두 통과.
- ORG_POLICY_PATTERNS 실제 거절문 매칭 7 패턴 / 정상 응답 false positive 0.
- pnpm validate 통과.

사용자 환경 참고:
- 현재 worker-launches 로그상 launch-prompt 에 NEXT_STEPS 규칙이 없어 v0.4.0 미적용 상태로 보임. 앱 재시작 시 electron-updater 가 v0.4.X 를 자동 설치하면 NEXT_STEPS/반복 감지/컴팩트 영속성이 한꺼번에 적용된다.

## 2026-05-16T_next_steps_marker

worker 가 작업을 끝낼 때 다음 작업 후보를 일관된 형식으로 출력하는 마커 규칙 도입. 기존 흐름은 worker 가 NEXT_TASK.md 를 갱신하지 않으면 dashboard 가 generic_continuation 으로 같은 자리를 돌거나, CHAIN_DONE 신호 오용 (한 단계 끝남을 전체 끝남으로) 으로 무한 chain 이 끊기는 패턴이 있었음.

마커 형식:
- `[NEXT_STEPS]` ~ `[/NEXT_STEPS]` 블록 — 다음 작업 후보 리스트 (title / priority P0~P2 / notes)
- `[NEXT_NONE] <이유>` — 다음 작업 정말 없음 (즉시 종료)

구현:
- `scripts/dashboard-runtime.mjs`:
  - 모듈 상단에 STATUS_MARKER_RULE / CHAIN_DONE_PROMPT_RULE / NEXT_STEPS_RULE 상수 + `decorateAutoChainPrompt(prompt)` helper (idempotent — `[NEXT_STEPS 규칙]` 마커로 중복 첨부 방지).
  - `parseNextSteps(text)` 함수 추가. `[NEXT_NONE]` 우선 → `{done: true, reason}`. `[NEXT_STEPS]` 블록 → 항목 파싱 + P0/P1/P2 정렬 → `{done: false, steps: [...]}`.
  - `tryAutoChain` 에서 chainDone 처리보다 먼저 `parseNextSteps(lastMessage)` 호출. NEXT_NONE → 즉시 stop, P0 항목 있으면 basePrompt 로 사용 (chainReason="next_steps_marker"). 우선순위: NEXT_STEPS > CHAIN_DONE override > NEXT_TASK.md > generic_continuation.
  - `startRun` 이 autoChainEnabled 일 때 input.prompt 끝에 STATUS/CHAIN_DONE/NEXT_STEPS 규칙을 자동 첨부. 첫 run 부터 worker 가 마커 규칙을 알게 됨. decorate 는 idempotent 이므로 chain run 에서 재가공돼도 중복 없음.

검증:
- pnpm validate 통과 (validate-quota-parser 모두 OK).
- parseNextSteps 7 케이스 (NEXT_NONE 단독/이유누락, NEXT_STEPS 단일/다중/priority 정렬/priority 누락 기본값, 마커 없음 fallback, NEXT_NONE+NEXT_STEPS 우선순위) 모두 통과.
- decorateAutoChainPrompt 3 케이스 (마커 첨부, idempotent, 빈 prompt) 통과.

호환성:
- 마커가 없으면 기존 흐름 (NEXT_TASK.md / generic_continuation) 그대로. backward compatible.
- 기존 CHAIN_DONE 처리는 그대로 유지 (override cap 1 회, autoChainOverrideOnChainDone=false 기본).

## 2026-05-16T_routing_polish

라우팅 일관성 정리 후속 보완 4 건:

1. `ORG_POLICY_PATTERNS` false positive 수정. 기존 `/.../C#\s*(?:코드|개발)\s*(?:만|외)|T-SQL|스키마|에러 분석/` 가 `T-SQL`/`스키마`/`에러 분석` 단독 매칭을 허용해, maintenance 분류 보수화 후 회사 계정이 더 정확하게 받는 정상 응답(`T-SQL 스키마를 검토하겠습니다`)까지 policy_blocked 로 잘못 분류하는 위험이 있었음. 거절 컨텍스트(`만`/`외`/`이외`/`이외에는`/`에 한해`) 와 함께 매칭하도록 패턴을 좁히고, 어순 역전 (`외에는 T-SQL`) 도 별도 패턴으로 추가. 13 케이스 테스트 (정상 응답 4 + 실제 거절문 6 + 어순 변형 + 정상 false-positive risk 2) 중 12 통과, 미통과 1 건은 기존 패턴도 못 잡던 영문 케이스 (관련 없음).
2. `selectRoute` 반환 구조에 `domainPreferred`/`preferAccountDomain` 필드 추가, reason 문자열에 도메인 필터 적용 여부를 한국어로 노출 ("유지보수 작업 분류 — hanilnetworks.com 도메인 계정 우선" / "유지보수 작업 분류였으나 도메인 후보 없어 일반 풀로 폴백"). UI 가 추가 가공 없이 사용자에게 라우팅 의도를 보여줄 수 있다.
3. `MAINTENANCE_DOMAIN` 코드 상수 (`"hanilnetworks.com"`) 를 `settings.maintenanceDomain` 으로 노출. `normalizeSettings` 가 소문자 정규화 + 기본값 `"hanilnetworks.com"` 적용. 빈 문자열 지정 시 도메인 우선 자체가 비활성화돼 어떤 사이트에서도 일반 풀 라우팅이 가능. 사이트별 override 경로 확보.
4. `tryQuotaRetry` 의 `retryCount` 카운터 공유 의도를 주석으로 명확화. policy retry 가 먼저 1 회 발동한 경우 quota retry 는 `quotaRetryMaxAttempts - 1` 만큼만 추가 시도 — 이는 정책+한도 연쇄 cascade 방지 목적이며 분리하면 cascade 폭주 위험이 증가하므로 의도된 동작으로 유지.

검증:
- pnpm validate 통과
- ORG_POLICY_PATTERNS 13 케이스 (정상 응답 4 / 거절문 6 / 어순 변형 1 / 동일 키워드 정상 결합 2) 분리 검증
- selectRoute 6 케이스 (일반 / maintenance / 회사 계정 비활성 / quota lock / 도메인 보너스 제거 / domainPreferred 필드)

## 2026-05-16T_account_routing_consistency

라우팅이 "멍청하게 동작"하는 4가지 원인을 정리해서 한꺼번에 수정.

원인:
1. `routeScore` 의 `domainBonus=+500` 이 다른 가중치를 압도해 회사 계정이 항상 1순위가 되면서 UI 추천 모델과 실제 라우팅이 어긋날 수 있었음.
2. `classifyTaskDomain` 이 약한 단어(`로그`/`\btest\b`/`분석`) 단독으로도 maintenance 로 분류 → "로그인 기능 추가", "테스트 코드 작성" 같은 일반 작업이 회사 계정으로 잘못 라우팅됨.
3. 정책 거절 시 24h `applyQuotaLockout` 자동 잠금 → 다음 cycle 에 회사 정책상 정상 통과될 작업까지 막아 사용성을 해침. policy retry 가 1 회만 시도 후 종료하므로 추가 잠금이 불필요.
4. `quickHandoff` 가 `routeReadyAccount()` 검사 없이 인계 후보를 골라 quota-lock/auth-mismatch 계정으로 이어가 retry 폭주 가능. `tryAutoChain` 의 `hasNewTask` 정확 일치 비교 때문에 "DB 마이그레이션" vs "DB 마이그레이션 진행" 처럼 같은 작업이 반복 spawn 가능.

수정:
- `scripts/dashboard-runtime.mjs`:
  - `classifyTaskDomain` 을 명시 태그(`[오류분석]`/`[검증]`/`[버그수정]` 등) 최우선 + 강한 키워드(오류분석/디버그/C#/T-SQL/스택트레이스) 위주로 보수화. 약한 단어 단독 매칭 제거.
  - `routeScore` 의 `domainBonus=+500` 제거. 도메인 우선은 `selectRoute` 의 1차 후보 필터(`accountMatchesDomain`) 로 처리 → preferDomain 계정만 후보 → 없으면 전체 풀로 자동 폴백. 점수는 loadBalance + modelRank 만으로 결정되므로 UI 추천 모델과 실제 라우팅이 항상 일치.
  - `quickHandoff` 자동 후보 선택에 `routeReadyAccount()` 추가.
  - `tryAutoChain` 의 `hasNewTask` 비교를 정규화(공백/구두점/태그 제거 후 소문자) 한 뒤 포함 관계로 판정.
- `scripts/worker-launch-adapter.mjs`:
  - early/late `policy_blocked` 분기에서 `applyQuotaLockout(now + 24h)` 호출 제거. `tryPolicyRetry` 만 호출해 다른 provider 로 1 회 failover.

검증:
- pnpm validate 통과 (validate-quota-parser 모두 OK).
- classifyTaskDomain 12 케이스 (명시 태그/일반/강한 키워드/이전 오분류) 모두 기대 결과 일치.

영향:
- 동일 지시 반복 발사 위험 — quota retry 2 회 + policy retry 1 회 + autoChain depth 8 한도는 유지. autoChain 의 NEXT_TASK 유사도 비교로 "한 글자 차이" 패턴 차단.
- 백그라운드 동시 실행 — `DISPATCH_LOCKS` + `isAliveActiveRun` + `isContinuation` 가드 모두 유지.
- 회사 계정 잠금-복구 순환 제거 — 정책 거절 발생해도 같은 작업이 다음 cycle 에 또 회사 계정으로 가는 건 분류 단계에서 이미 차단됨.

## 2026-05-16T_policy_detect_before_complete

worker-launches 14:38 구간 분석으로 회귀 확인: Claude Enterprise 의 정책 거절은 worker 가 exit code 0 으로 정상 종료하면서 본문에만 거절문을 내놓는 형태라, 기존 `if (result.code === 0)` 분기가 먼저 잡혀 `completed` 로 마감 → autoChain 이 같은 hanilnetworks 계정으로 NEXT_TASK 를 또 spawn 하는 토큰 폭주 발생.

수정:
- `worker-launch-adapter.mjs` 의 success 분기 진입 전에 `detectInterruption(combinedOutput + lastMessage)` 으로 policy_blocked 우선 분류. 해당하면 24h quota lockout 후 `tryPolicyRetry` 로 1 회만 다른 provider/계정 시도.
- `tryPolicyRetry` 가 startRun 으로 `excludeAccountIds: [failedAccountId]`, `excludeProviders: [failedProvider]`, `preferAccountDomain: ""` 명시 전달 → 회사 도메인 보너스 회귀 방지.
- `selectRoute` 가 `excludeAccountIds` 필터 신규 지원, startRun 이 모든 input 의 exclusion/도메인 옵션 통과.

검증: detectInterruption 정책 텍스트 매칭 OK, selectRoute 3 시나리오 (초기 회사계정 / cross-provider retry / same-provider-different-account) 모두 OK.

## 2026-05-16T_policy_retry_cap

worker-launches 폴더 분석으로 "한 번 지시 → N개 run spawn" 폭주 원인 두 가지 확인:
(1) `isAliveActiveRun` 화이트리스트가 adapter.status="queued" 를 제외해서 ~200ms 내 중복 dispatch 가 가드를 우회. (2) policy_blocked 에서 `tryQuotaRetry` 를 그대로 호출해 같은 조직 정책에 막히는 다른 계정으로 cascading.

수정 적용:
- 새 `tryPolicyRetry` — policyRetryCount 별도 counter, 1 회만 시도, 다른 provider 우선.
- `classifyTaskDomain` + `routeScore` 의 `preferAccountDomain` — 오류/분석/C#/T-SQL/검증 등 유지보수성 prompt 는 회사 계정(@hanilnetworks.com)으로 1순위 라우팅.
- `stopRun` 이 `runtime.cancelChainAt` + stopped run 의 `cancelRetryChain: true` 를 마킹, `tryQuotaRetry`/`tryAutoChain`/`tryPolicyRetry` 가 사이클 진입 직전 `chainCancelled` 로 차단.
- 컴팩트 모드 UI/IPC 양방향 동기화, single-instance lock 도 같이 정리.

검증: pnpm validate 통과, dashboard build 통과, selectRoute smoke test 통과.

## 2026-05-09

- AgentApp 초기 프로젝트 골격 생성.
- 공통 규칙, memory/plan sync, 승인 정책, worker 예시, handoff 구조 추가.

## 2026-05-09T10:02:41.545Z

초기 골격 생성 및 검증 완료: git init, pnpm install, hook 설치, pnpm validate, pnpm agent:progress, pnpm agent:next, pnpm agent:status 통과.

## 2026-05-09T10:13:02.135Z

sync 환경 점검을 우선 보강: scripts/agent-doctor.mjs 추가, package/docs 연결, pnpm agent:doctor 및 pnpm validate 통과. 남은 경고는 git remote 미설정과 첫 커밋 전 working tree 상태.

## 2026-05-09T10:46:27.935Z

approval-policy.yaml allow/hold 정책 확정: default hold, auto_allowed, hold_for_user, deny, completion_requirements 정리. git remote origin=git@github.com:dungbo92-eng/agentapp.git 등록, 기본 브랜치 main 설정.

## 2026-05-09T10:50:27.141Z

workers.example.yaml registry 예시 확정: Codex, Claude Code, Cursor, Gemini CLI를 user-managed/manual launch worker로 정리하고 auto_allowed/hold_for_user/denied capabilities와 handoff 입출력 규칙을 명시.

## 2026-05-09T10:53:12.586Z

NEXT_TASK.md 템플릿 확정: agent-next 생성물을 Required Reads, Execution Rules, Completion Checklist, Handoff Updates, Context Snapshot 구조로 강화하고 worker registry 발췌를 포함하도록 변경.

## 2026-05-09T10:57:05.021Z

- Status: completed
- Summary: RUN_STATUS.md 템플릿 확정: agent-report가 Status/Summary/Verification/Git/Decisions/Next 필드를 가진 구조화 로그를 추가하도록 변경.
- Verification: pnpm validate 통과; pnpm agent:progress=30%
- Git: pending commit/push
- Decisions: none
- Next: DECISIONS_REQUIRED.md 템플릿 확정

## 2026-05-09T12:40:55.975Z

- Status: completed
- Summary: 개발 방향 추가: 주간 사용량 예산, 주말 예비분, 품질 우선 모델 라우팅, 작업 난이도별 모델 선택 정책을 문서/roadmap/policy/worker registry에 반영.
- Verification: pnpm validate 통과; pnpm agent:progress=26%
- Git: pending commit/push
- Decisions: 사용량 입력 방식은 수동 우선인지 read-only 화면 값 허용인지 추후 결정
- Next: DECISIONS_REQUIRED.md 템플릿 확정

## 2026-05-09T12:45:02.452Z

- Status: completed
- Summary: DECISIONS_REQUIRED.md 템플릿 확정: decision queue를 ID/상태/우선순위/카테고리/차단 범위/옵션/권장안/결정 후 작업 구조로 정리.
- Verification: pending final validation
- Git: pending commit/push
- Decisions: 기존 대기 항목 3개를 새 템플릿으로 유지
- Next: 작업 종료 시 memory/plan/handoff 갱신 규칙 정리

## 2026-05-09T12:45:39.066Z

- Status: completed
- Summary: DECISIONS_REQUIRED.md 템플릿 검증 완료: 대기/해결 decision queue 구조 확정.
- Verification: pnpm validate 통과; pnpm agent:doctor 통과(변경분 경고만 존재); pnpm agent:status in-sync
- Git: pending commit/push
- Decisions: 대기 항목 3개 유지
- Next: 작업 종료 시 memory/plan/handoff 갱신 규칙 정리

## 2026-05-09T12:50:52.064Z

- Status: completed
- Summary: 작업 종료 시 memory/plan/handoff 갱신 규칙 정리: docs/handoff-completion-protocol.md 추가, agent-next Required Reads에 완료 프로토콜 포함, 개발 구현 자율 진행 원칙 반영.
- Verification: pnpm validate 통과; pnpm agent:progress=30%
- Git: pending commit/push
- Decisions: DEC-20260509-002 worker 실행 범위 resolved: auto_allowed 로컬 개발 작업은 자율 진행
- Next: agent-next 우선순위/의존성/보류 상태 반영 개선

## 2026-05-09T12:54:18.102Z

- Status: completed
- Summary: agent-next 선택 로직 개선: task-queue.json 추가, 우선순위/의존성/보류 decision을 반영하고 roadmap fallback을 유지하도록 변경.
- Verification: pnpm validate 통과; pnpm agent:next가 usage-budget-schema를 선택
- Git: pending commit/push
- Decisions: DEC-20260509-001이 dashboard task를 보류하도록 task queue에 반영
- Next: 계정 수/요금제/남은 주간 사용량 설정 스키마 작성

## 2026-05-09T12:57:17.793Z

- Status: completed
- Summary: 사용량 예산 설정 스키마 작성: usage-budget.schema.json/example.json 추가, validate-configs로 JSON 설정 검증을 pnpm validate에 통합.
- Verification: pnpm validate 통과; pnpm agent:next가 모델 추천 CLI 초안을 선택; pnpm agent:progress=35%
- Git: pending commit/push
- Decisions: usage 입력 방식 DEC-20260509-003은 대기 유지, MVP는 수동 입력 가능한 스키마부터 진행
- Next: 작업 난이도별 모델 추천 CLI 초안 작성

## 2026-05-09T13:03:12.571Z

- Status: completed
- Summary: 작업 난이도별 모델 추천 CLI 초안 작성: pnpm agent:route 추가, routine/standard/complex/critical 분류와 품질 우선 추천, 예산/주말 예비분 경고 출력 구현.
- Verification: pnpm validate 통과; routine/complex/critical route 예시 실행 통과
- Git: pending commit/push
- Decisions: none
- Next: 토요일/일요일 예비 사용량을 남기는 주간 예산 계산 로직 구현

## 2026-05-09T13:06:29.959Z

- Status: completed
- Summary: 주간 예산 계산 로직 구현: pnpm agent:budget 추가, reset day/주말 예비분/오늘 권장 사용량/provider별 잔여 단위 계산.
- Verification: pnpm validate 통과; pnpm agent:budget -- --date 2026-05-09 실행 통과; pnpm agent:progress=42%
- Git: pending commit/push
- Decisions: none
- Next: 사용량 부족 시 작업 분해 또는 사용자 결정 요청 handoff 구현

## 2026-05-09T13:09:42.465Z

- Status: completed
- Summary: 사용량 부족 handoff 구현: agent:route --write-decision 옵션 추가, low budget 예시 설정 추가, needs_decision 상태 검증.
- Verification: pnpm validate 통과; low config complex route가 needs_decision 반환; pnpm agent:progress=44%
- Git: pending commit/push
- Decisions: 실제 decision queue에는 테스트 항목을 쓰지 않음
- Next: agent-progress phase별 진행률 출력 개선

## 2026-05-09T13:11:33.275Z

- Status: completed
- Summary: agent-progress phase별 출력 개선: 전체 진행률과 Phase별 진행률, 다음 미완료 항목을 함께 출력하도록 변경.
- Verification: pnpm validate 통과; pnpm agent:progress phase별 출력 확인; progress=47%
- Git: pending commit/push
- Decisions: none
- Next: agent-report가 project_state까지 갱신하도록 개선

## 2026-05-09T13:13:16.014Z

- Status: completed
- Summary: agent-report project_state 갱신 개선: RUN_STATUS 추가와 동시에 project_state.md 최근 보고 섹션을 갱신하도록 구현.
- Verification: pnpm validate 통과; pnpm agent:progress=49%
- Git: pending commit/push
- Decisions: none
- Next: 안전 작업/보류 작업을 분류하는 dry-run 명령 추가

## 2026-05-09T21:11:52.142Z

- Status: completed
- Summary: 안전 작업/보류 작업 dry-run 분류 CLI(agent:dry-run)를 추가하고 approval-policy 기반으로 auto_allowed/hold_for_user/deny 판정을 검증했다.
- Verification: pnpm validate 통과; pnpm agent:dry-run auto/hold/deny 예시 통과; pnpm agent:progress=51%
- Git: pending commit/push
- Decisions: none
- Next: worker별 프롬프트 템플릿 생성 명령 추가

## 2026-05-09T21:16:12.245Z

- Status: completed
- Summary: worker registry와 NEXT_TASK를 기반으로 Codex/Claude Code/Cursor/Gemini CLI별 시작 프롬프트를 생성하는 agent:prompt CLI를 추가했다.
- Verification: pnpm validate 통과; pnpm agent:prompt -- --worker codex 출력 확인; pnpm agent:prompt -- --all --json 통과; pnpm agent:prompt -- --all --write로 4개 프롬프트 생성; pnpm agent:progress=53%
- Git: pending commit/push
- Decisions: none
- Next: Codex 작업 프롬프트 생성 어댑터

## 2026-05-09T21:22:27.816Z

- Status: completed
- Summary: Codex Desktop 전용 작업 프롬프트 어댑터를 agent:prompt 자동 형식과 agent:codex-prompt alias로 추가하고, Codex 실행 계약/안전 분류/모델 라우팅/완료 보고 지침을 생성 프롬프트에 포함했다.
- Verification: pnpm validate 통과; pnpm agent:codex-prompt -- --write 통과; pnpm agent:prompt -- --worker codex --json에서 Codex Adapter 섹션 확인; pnpm agent:progress=56%
- Git: pending commit/push
- Decisions: none
- Next: Claude Code 작업 프롬프트 생성 어댑터

## 2026-05-09T21:24:38.840Z

- Status: completed
- Summary: Claude Code 전용 작업 프롬프트 어댑터를 agent:prompt 자동 형식과 agent:claude-prompt alias로 추가하고, CLAUDE.md 자동 로드/AGENTS.md 공통 정책/터미널 루트 실행/Claude 모델 라우팅 지침을 생성 프롬프트에 포함했다.
- Verification: pnpm validate 통과; pnpm agent:claude-prompt -- --write 통과; pnpm agent:prompt -- --worker claude-code --json에서 Claude Code Adapter 섹션 확인; pnpm agent:progress=58%
- Git: pending commit/push
- Decisions: none
- Next: Cursor 작업 프롬프트 생성 어댑터

## 2026-05-09T21:26:45.972Z

- Status: completed
- Summary: Cursor 전용 작업 프롬프트 어댑터를 agent:prompt 자동 형식과 agent:cursor-prompt alias로 추가하고, workspace 열기/IDE agent 붙여넣기/좁은 범위 편집/비밀값 저장 금지 지침을 생성 프롬프트에 포함했다.
- Verification: pnpm validate 통과; pnpm agent:cursor-prompt -- --write 통과; pnpm agent:prompt -- --worker cursor --json에서 Cursor Adapter 섹션 확인; pnpm agent:progress=60%
- Git: pending commit/push
- Decisions: none
- Next: 실패/중단/quota 감지 상태 모델 정의

## 2026-05-09T21:29:52.172Z

- Status: completed
- Summary: worker 실행/중단/실패/quota 상태 모델을 JSON schema와 예시 파일로 정의하고, validate-configs에서 상태/이유/비밀값 금지/정책 판정을 검증하도록 추가했다.
- Verification: pnpm validate 통과; worker-run-state.example status=blocked reason=hold_for_user contains_secrets=false 확인; pnpm agent:progress=63%
- Git: pending commit/push
- Decisions: none
- Next: worker가 직접 실행할 수 없는 경우 handoff만 남기는 fallback 구현

## 2026-05-09T21:36:19.496Z

- Status: completed
- Summary: 직접 실행 불가 환경에서 worker를 실행하지 않고 handoff-only 상태를 남기는 agent:fallback CLI를 추가했다. dry-run 검증으로 HANDOFF_ONLY/run-state/RUN_STATUS 생성 내용을 확인했다.
- Verification: pnpm validate 통과; pnpm agent:fallback -- --worker codex --reason tool_error --summary 현재환경직접실행불가 --dry-run --json 통과; pnpm agent:progress=65% Phase3=100%
- Git: pending commit/push
- Decisions: none
- Next: 로컬 웹 대시보드 기술 선택

## 2026-05-09T21:40:15.005Z

- Status: completed
- Summary: 로컬 웹 대시보드 기술을 Vite + React + TypeScript read-only SPA로 결정하고 docs/dashboard-technology.md에 근거와 초기 구조를 기록했다. 첫 UI 결정도 로컬 대시보드 착수로 해결 처리하고 task queue를 다음 화면 작업으로 열었다.
- Verification: pnpm validate 통과; pnpm agent:progress=67%; pnpm agent:next=진행률/다음 작업/보류 결정 화면; pnpm agent:dry-run 로컬 대시보드 파일 생성 auto_allowed 확인
- Git: pending commit/push
- Decisions: DEC-20260509-001 resolved
- Next: 진행률/다음 작업/보류 결정 화면

## 2026-05-09T21:47:06.047Z

- Status: completed
- Summary: 진행률/다음 작업/보류 결정 화면을 위한 Vite + React + TypeScript 로컬 대시보드 MVP를 추가하고, dashboard snapshot 생성 스크립트로 progress/next task/decisions/latest run/task queue/usage budget을 표시하도록 구현했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; dev server http://127.0.0.1:5173 응답 200; pnpm agent:progress=70%
- Git: pending commit/push
- Decisions: none
- Next: worker 상태 화면

## 2026-05-09T21:49:55.286Z

- Status: completed
- Summary: 대시보드에 worker 상태 화면을 추가했다. snapshot 생성 시 workers.example.yaml과 worker run-state 예시/기록을 합쳐 worker별 최신 상태, 이유, 최근 task를 표시한다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; snapshot workers=4 next=handoff viewer; pnpm agent:progress=72%
- Git: pending commit/push
- Decisions: none
- Next: handoff viewer

## 2026-05-09T21:54:52.576Z

- Status: completed
- Summary: 대시보드에 handoff viewer를 추가했다. snapshot 생성 시 NEXT_TASK, RUN_STATUS, DECISIONS_REQUIRED를 읽어 문서별 상태, 다음 항목, 줄 수, excerpt를 제공하고 UI에서 읽기 전용으로 확인할 수 있게 했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; handoff_documents=3; pnpm agent:progress=74%
- Git: pending commit/push
- Decisions: none
- Next: 승인 필요 큐 화면

## 2026-05-09T21:58:44.172Z

- Status: completed
- Summary: 대시보드에 승인 필요 큐 화면을 추가했다. approval-policy.yaml의 hold_for_user/deny/user_required 경계와 DECISIONS_REQUIRED 대기 항목, hold/blocked task를 snapshot에 모아 UI에서 확인할 수 있게 했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; approval pending=1 holdRules=10 denyRules=3; pnpm agent:progress=77%
- Git: pending commit/push
- Decisions: none
- Next: 주간 사용량/주말 예비분/모델 추천 화면

## 2026-05-10T02:19:14.446Z

- Status: completed
- Summary: 대시보드에 주간 사용량/주말 예비분/모델 추천 화면을 추가하고, 프로젝트별 공통 memory/plan/git sync를 기본 운영 골격으로 문서화했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; usage accounts=2 recommendations=4; pnpm agent:progress=79% Phase5=100%
- Git: pending commit/push
- Decisions: none
- Next: OS 작업 스케줄러 또는 Codex automation 연동 방식 정리

## 2026-05-10T02:21:30.533Z

- Status: completed
- Summary: OS 작업 스케줄러/Codex automation 연동 방식을 정리했다. 자동화는 read-only 점검과 handoff 갱신 중심으로 제한하고, 실제 예약 생성은 사용자 명시 요청 시에만 수행하도록 문서화했다.
- Verification: pnpm validate 통과; pnpm agent:progress=81% Phase6=25%; pnpm dashboard:prepare 통과
- Git: pending commit/push
- Decisions: none
- Next: 주기적 agent-next 실행 방식 구현

## 2026-05-10T02:24:19.564Z

- Status: completed
- Summary: 주기적 agent-next 실행을 위한 agent:scheduled-check CLI를 추가했다. 기본은 read-only 상태 점검이며, --write-next/--write-report/--prepare-dashboard 옵션으로 handoff 갱신 범위를 명시하게 했다.
- Verification: pnpm agent:scheduled-check -- --json 통과; pnpm agent:scheduled-check -- --write-next --prepare-dashboard --json 통과; pnpm validate 통과; pnpm agent:progress=84%
- Git: pending commit/push
- Decisions: none
- Next: 보류 결정 알림 방식 정리

## 2026-05-10T02:27:44.107Z

- Status: completed
- Summary: 보류 결정 알림 방식을 정리하고 agent:scheduled-check에 pending decision 개수와 level 요약을 추가했다. 기본 알림은 dashboard, scheduled check, handoff report에만 표시한다.
- Verification: pnpm agent:scheduled-check -- --json pending_decisions=1 level=attention; pnpm validate 통과; pnpm dashboard:build 통과; pnpm agent:progress=86%
- Git: pending commit/push
- Decisions: none
- Next: git sync 상태 점검 자동화

## 2026-05-10T02:29:50.701Z

- Status: completed
- Summary: git sync 상태 자동 점검을 agent:scheduled-check에 추가했다. branch, upstream, remote 설정 여부, ahead/behind, synced 상태를 read-only로 요약한다.
- Verification: pnpm agent:scheduled-check -- --json git.upstream=origin/main git.synced=true; pnpm validate 통과; pnpm agent:progress=88% Phase6=100%
- Git: pending commit/push
- Decisions: none
- Next: 설치 가이드

## 2026-05-10T02:42:39.947Z

- Status: completed
- Summary: 설치 가이드를 추가하고 새 PC/새 프로젝트 등록 시 공통 memory/plan/handoff/git sync를 기본 세팅으로 확인하는 절차를 문서화했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; pnpm agent:progress=91%; pnpm agent:scheduled-check 통과
- Git: pending commit/push
- Decisions: none
- Next: 보안 모델 문서화

## 2026-05-10T02:47:55.833Z

- Status: completed
- Summary: 보안 모델 문서를 추가해 비밀값, 계정, MCP/connector, 자동화, git remote, 외부 쓰기 경계를 제품화 기준으로 정리했다.
- Verification: pnpm validate 통과; pnpm agent:progress=93%
- Git: pending commit/push
- Decisions: none
- Next: plugin/MCP 확장 전략

## 2026-05-10T02:50:23.864Z

- Status: completed
- Summary: plugin/MCP 확장 전략 문서를 추가해 Browser, Figma, GitHub, OpenAI Developers, local tools를 권한 계층별로 분류하고 외부 쓰기와 connector 변경은 decision queue로 보류하는 기준을 정리했다.
- Verification: pnpm validate 통과; pnpm agent:progress=95%
- Git: pending commit/push
- Decisions: none
- Next: 테스트 시나리오

## 2026-05-10T02:52:33.861Z

- Status: completed
- Summary: 제품화 테스트 시나리오 문서를 추가해 새 PC 시작, handoff 이어받기, 예산 라우팅, 승인 정책, scheduled check, dashboard smoke, git sync, 보안 경계, plugin/MCP fallback 검증 절차를 정리했다.
- Verification: pnpm validate 통과; pnpm agent:progress=98%
- Git: pending commit/push
- Decisions: none
- Next: 첫 릴리즈 태그

## 2026-05-10T02:55:06.320Z

- Status: completed
- Summary: v0.0.1 CHANGELOG를 추가하고 Phase 7 첫 릴리즈 태그 작업을 완료 상태로 정리했다. 전체 roadmap 진행률은 100%다.
- Verification: pnpm validate 통과; pnpm agent:progress=100%
- Git: pending commit/tag/push
- Decisions: none
- Next: none

## 2026-05-10T03:13:01.788Z

- Status: completed
- Summary: dashboard를 단순 상태판에서 통합 에이전트 콘솔 UX로 개편했다. 좌측 프로젝트/계정 등록, 중앙 프롬프트 입력과 Start/Stop, 모델 라우팅, 우측 queue/usage, handoff/plan/worker 패널을 추가했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 브라우저 DOM에서 Projects/Accounts/Prompt/Start/Stop/Phase8 확인; Start/Stop 클릭 테스트 통과
- Git: pending commit/push
- Decisions: none
- Next: dashboard local execution API

## 2026-05-10T07:23:10.353Z

- Status: completed
- Summary: dashboard local runtime API를 추가해 Claude/Codex Google A/B 계정 프리셋, 비밀값 없는 로컬 계정 예산 저장, 프로젝트 registry 저장, Start 모델/계정 자동 라우팅과 예산 차감, Stop run history 기록을 구현했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 브라우저에서 claude-google-a/codex-google-b 표시, Start=codex-google/gpt-5.4 라우팅, Stop 상태 확인
- Git: pending commit/push
- Decisions: none
- Next: Start/Stop과 worker process/handoff 연동

## 2026-05-10T07:28:32.467Z

- Status: completed
- Summary: 등록된 AI 계정에 enabled 토글을 추가했다. 사용자가 계정을 삭제하지 않고 on/off를 바꿀 수 있고, disabled 계정은 모델/계정 자동 라우팅 후보에서 제외된다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 브라우저에서 계정 checkbox 6개 확인; off/on 토글 확인; disabled codex-google-b 상태에서 codex-google-a로 라우팅 확인
- Git: pending commit/push
- Decisions: none
- Next: Start/Stop과 worker process/handoff 연동

## 2026-05-10T07:42:09.880Z

- Status: completed
- Summary: dashboard 계정에 needs-login/ready 세션 상태를 추가하고 Ready 계정만 자동 라우팅에 사용하도록 변경했다. Start/Stop은 DASHBOARD_RUN.md와 run-states/dashboard-current.json을 갱신해 prompt 본문은 local-only로 두면서 실행 상태를 handoff에 남긴다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 브라우저에서 Ready 전환 전 Ready 세션 없음 차단, Ready 전환 후 codex-google-a/gpt-5.4 라우팅, Start/Stop handoff path 표시 확인
- Git: not recorded
- Decisions: none
- Next: Windows exe packaging

## 2026-05-10T07:55:33.314Z

- Status: completed
- Summary: Windows portable EXE packaging 기반을 추가했다. Electron desktop shell, 정적 dashboard/local API 서버, userData local-only 저장 경로, desktop:dev/desktop:pack 스크립트를 추가하고 dist-desktop/AgentApp-0.0.1-x64.exe 생성을 확인했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; dashboard-server 스모크 테스트 통과; pnpm desktop:pack 통과; EXE 산출물 E:\\agentApp\\dist-desktop\\AgentApp-0.0.1-x64.exe 확인
- Git: not recorded
- Decisions: none
- Next: none

## 2026-05-10T08:30:11.166Z

- Status: completed
- Summary: 사용자별 계정 수가 다른 상황을 위해 dashboard 계정 준비 흐름을 개선했다. 이후 고정 조합 방식은 동적 Add account 방식으로 대체했다. EXE 공유를 위해 desktop:artifact checksum 산출도 추가했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; 계정 준비 API 확인; pnpm desktop:artifact -- --json 통과
- Git: not recorded
- Decisions: none
- Next: none

## 2026-05-10T13:59:56.452Z

- Status: completed
- Summary: dashboard 계정 설정을 고정 조합에서 동적 Add account 흐름으로 전면 교체했다. provider/login method/email/session profile/password/API key 입력을 지원하고, secret은 Windows DPAPI local vault에 암호화 저장하며 runtime에는 credential reference만 남긴다. Start 화면에는 모델 override와 active run line log를 추가했다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; vault-runtime-test 통과; in-app browser에서 Add account/AI tool/Google/Model/GPT-5.5/Prompt/Start 표시 확인
- Git: not recorded
- Decisions: none
- Next: worker별 session profile launch adapter

## 2026-05-10T14:17:20.025Z

- Status: completed
- Summary: worker launch adapter를 추가해 Start가 실제 launch request를 처리하도록 연결했다. Codex는 session-profile별 CODEX_HOME으로 codex exec를 실행하고, Cursor는 session-profile별 user-data-dir로 창을 연다. launch 전 pnpm validate preflight를 실행해 결과를 active run에 반영하고, login/session expired 패턴이 보이면 계정을 needs-login으로 되돌리며 needs_user handoff를 남긴다.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과; worker-launch-adapter-test 통과; in-app browser에서 Projects/Accounts/Prompt/Workers/Connection policy 표시 확인
- Git: not recorded
- Decisions: none
- Next: Claude Code command-mode adapter profile

## 2026-05-10T14:35:02.421Z

- Status: completed
- Summary: 대시보드 UI를 한글로 통일하고 계정 삭제 버튼, 입력/버튼 툴팁, 남은 사용량/주간 예산 설명을 추가했다. 계정 삭제 API를 붙이고 삭제 시 로컬 credential vault 정리까지 반영했다.
- Verification: pnpm validate; pnpm dashboard:build; Edge headless DOM/screenshot; temp account delete API verified
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-10T23:02:58.933Z

- Status: completed
- Summary: Phase 11 Claude Code command-mode adapter profile 추가
- Verification: pnpm validate; pnpm agent:progress
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-10T23:18:42.248Z

- Status: completed
- Summary: dashboard 계정 UX 자동화: 폼 collapsible, 세션 자동 감지, plan별 사용량 자동
- Verification: pnpm validate; pnpm dashboard:build; live API test (add+detect)
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T01:01:02.737Z

- Status: completed
- Summary: Phase 11 완료 (4/4): Gemini adapter, detector 보강, doctor session readiness 진단
- Verification: pnpm validate; pnpm agent:doctor; pnpm agent:progress=100%
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T03:14:25.871Z

- Status: completed
- Summary: v0.1.0 사용자 환경 설치/점검, dashboard UX polish, cycle test CLI, Windows EXE 재패키징 완료
- Verification: pnpm validate; pnpm dashboard:build; pnpm agent:setup; pnpm agent:cycle-test; dashboard-server smoke; pnpm desktop:pack; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: Claude/Gemini CLI 설치 또는 env override 후 authenticated cycle 재검증

## 2026-05-11T04:38:13.960Z

- Status: completed
- Summary: 사용자/배포 PC 모두에서 누락 AI CLI 를 자동 설치할 수 있도록 dashboard install API + UI 버튼을 추가하고 EXE 를 재패키징했다.
- Verification: pnpm validate; pnpm dashboard:build; pnpm agent:cycle-test --execute (timeout_stopped); pnpm desktop:pack; pnpm desktop:artifact sha256=bdb25a...
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T06:00:06.940Z

- Status: completed
- Summary: NSIS System.dll crash 진단 후 installer를 custom prompt 없는 표준 NSIS로 재빌드하고 silent 설치/실행 검증까지 완료
- Verification: win-unpacked AgentApp.exe 8초 생존; pnpm desktop:installer; installer UI 경로 6초 생존; installer /S temp 설치 exit 0; 설치된 AgentApp.exe 8초 생존; uninstaller /S exit 0; pnpm validate; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: 사용자 PC에서 AgentApp-Setup-0.1.0-x64.exe 더블클릭 설치 확인 후 dashboard 환경 패널에서 누락 CLI 자동 설치 실행

## 2026-05-11T06:11:47.980Z

- Status: completed
- Summary: dashboard AI CLI auto-install now starts on main screen and Windows packaged install uses absolute cmd/where paths
- Verification: PATH-empty agent:setup ai json; pnpm validate; pnpm dashboard:build; pnpm desktop:installer; silent installer smoke; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: 사용자 PC에서 앱 실행 후 Claude/Gemini CLI 자동 설치 로그 확인, 이후 수동 인증 후 cycle-test 실행

## 2026-05-11T06:15:48.544Z

- Status: completed
- Summary: dashboard now auto-installs missing core tools and AI CLIs on main screen; Windows packaged install resolves cmd/where and common Node/Git/Cursor/npm paths without relying on PATH
- Verification: PATH-empty agent:setup all json; pnpm validate; pnpm dashboard:build; pnpm desktop:installer; silent installer smoke with auto-install disabled; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: 앱을 일반 실행하면 누락된 Claude/Gemini CLI 자동 설치가 시작됩니다. 설치 후 Claude/Gemini 수동 인증을 완료하고 authenticated cycle-test를 실행하세요.

## 2026-05-11T07:37:25.813Z

- Status: blocked
- Summary: Installed Claude/Gemini CLI, fixed Windows npm shim execution for worker adapters, updated Gemini CLI launch syntax, rebuilt installer, and ran cycle tests. Remaining blocker is user authentication: Codex session profile returns 401, Claude/Gemini login profiles are empty, Cursor opens but requires manual UI completion.
- Verification: node scripts/agent-environment-setup.mjs --target all --json: all 7 ok; node scripts/agent-doctor.mjs: CLI ok, auth warnings only; Codex cycle-test reached CLI and logged 401; Cursor cycle opened window with validation passed; pnpm.cmd validate; pnpm.cmd dashboard:build; pnpm.cmd desktop:installer; silent installer smoke; pnpm.cmd desktop:artifact
- Git: not recorded
- Decisions: none
- Next: Complete the opened Codex/Claude/Gemini login flows manually, then click 재감지 or rerun node scripts/user-environment-cycle-test.mjs --worker <worker> --execute.

## 2026-05-11T08:35:50.111Z

- Status: completed
- Summary: 로그인/계정 확인 흐름을 콘솔 창 대신 백그라운드 실행 + 인증 URL 자동 브라우저 오픈 방식으로 변경했고 Windows installer/portable을 재패키징했습니다.
- Verification: pnpm validate; node scripts\\agent-environment-setup.mjs --target all --json; node scripts\\agent-doctor.mjs; pnpm dashboard:build; pnpm desktop:installer; pnpm desktop:pack; silent installer install/uninstall smoke
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T08:50:00.101Z

- Status: completed
- Summary: 로그인/계정 확인 흐름을 콘솔 창 없이 백그라운드에서 실행하고, CLI 출력 인증 URL을 기본 브라우저로 자동 오픈하도록 변경했습니다. Windows .cmd shim은 숨김 cmd 래퍼로 실행해 cmd.exe ENOENT와 콘솔 창 노출을 줄였고 installer/portable을 최종 재패키징했습니다.
- Verification: pnpm validate; node scripts\\agent-environment-setup.mjs --target all --json; node scripts\\agent-doctor.mjs; pnpm desktop:installer; pnpm desktop:pack; silent installer install/uninstall smoke; pnpm desktop:artifact
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-11T12:35:00.000Z

- Status: completed
- Summary: 컨텍스트 자동화 4종 한꺼번에 구현. (1) 계정 한도 임박 시 dashboard 펄스 강조 + 1분 throttle 비프음, (2) 현재 실행을 다른 준비된 계정으로 한 번에 인계하는 quickHandoff API/UI(빠른 계정 후보 단축버튼 포함), (3) Ready 전환 시 같은 provider의 pendingRuns 첫 항목 자동 dispatch, (4) selectRoute에 lastUsedAt 기반 load balance bonus. ToS 준수: 자동 로그인/강제 계정 전환/CAPTCHA·MFA 우회는 구현하지 않음.
- Verification: pnpm validate 통과; pnpm dashboard:build 통과(237 KB, css 14.5 KB)
- Git: committed
- Decisions: none
- Next: 패키징 EXE 재빌드는 사용자 시간대에 진행 예정

## 2026-05-13T08:33:28.160Z

- Status: completed
- Summary: 자동 라우팅 run 의 provider fallback, auto pending dispatch, stale quota lock 해제를 수정했습니다. Codex 세션 인증이 남아 있는데도 한도 잠금 때문에 ready 후보에서 제외되는 경우를 명확히 표시하고, 재감지/ready 전환 시 잠금을 지우도록 했습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress; selectRoute/startRun 시뮬레이션
- Git: pending
- Decisions: none
- Next: 현재 변경 검토 후 commit/push, 릴리즈 트리거 여부 확인

## 2026-05-13T08:37:50.301Z

- Status: completed
- Summary: 자동 라우팅 provider fallback 수정은 검증 후 commit/push 완료했습니다. 릴리즈 트리거 대상 변경이지만 이 PC에 gh CLI가 없어 GitHub Release 발행은 보류했고 DEC-20260513-001에 도구 점검을 기록했습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress; pnpm agent:next; pnpm agent:sync; pnpm agent:status; selectRoute/startRun 시뮬레이션; git push origin main
- Git: commit befa6d7 pushed to origin/main
- Decisions: DEC-20260513-001 pending: gh CLI missing, release skipped
- Next: gh CLI 설치/인증 후 pnpm desktop:release -- --bump patch 실행

## 2026-05-13T08:43:52.870Z

- Status: completed
- Summary: 정정: gh CLI는 설치되어 있었고 현재 shell PATH에만 없었습니다. 풀 경로 인증 확인 후 desktop-release fallback으로 v0.2.1 GitHub Release를 발행했습니다.
- Verification: C:\\Program Files\\GitHub CLI\\gh.exe auth status; pnpm desktop:release -- --bump patch; gh release view v0.2.1
- Git: release commit 9e6af68 and tag v0.2.1 pushed to origin/main
- Decisions: DEC-20260513-001 resolved
- Next: Claude/Gemini authenticated cycle 재검증

## 2026-05-13T09:02:02.948Z

- Status: completed
- Summary: 컴팩트 채팅 모드를 좌측 프로젝트 리스트와 우측 작업 패널로 재배치했습니다. 우측 상단은 프롬프트 입력/시작 버튼으로 고정하고, 프로젝트 요약과 최신 실행/진행 로그만 남겨 나머지 메타 정보는 숨겼습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; Browser visual check http://127.0.0.1:5173 compact mode
- Git: pending
- Decisions: none
- Next: commit/push/release

## 2026-05-13T09:02:57.210Z

- Status: completed
- Summary: 컴팩트 채팅 모드를 좌측 프로젝트 리스트와 우측 작업 패널로 재배치했습니다. 우측 상단은 프롬프트 입력/시작 버튼으로 고정하고, 프로젝트 요약과 최신 실행/진행 로그만 남겨 나머지 메타 정보는 숨겼습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress; pnpm agent:next; pnpm agent:sync; pnpm agent:status; Browser visual check http://127.0.0.1:5173 compact mode
- Git: pending
- Decisions: none
- Next: commit/push/release

## 2026-05-13T09:06:05.787Z

- Status: completed
- Summary: 컴팩트 채팅 모드 레이아웃을 좌측 프로젝트 리스트/우측 작업 패널로 단순화했고, v0.2.2 릴리즈까지 발행했습니다.
- Verification: pnpm validate; pnpm --dir apps/dashboard exec tsc --noEmit; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress; pnpm agent:next; pnpm agent:sync; pnpm agent:status; Browser visual check; gh release view v0.2.2
- Git: commit dab5f22 pushed; release commit 0f3393f and tag v0.2.2 pushed
- Decisions: none
- Next: Claude/Gemini authenticated cycle 재검증

## 2026-05-13T09:25:14.737Z

- Status: completed
- Summary: Claude quota reset 문자열 May 18, 6am Asia/Seoul 파싱을 정확히 처리하고, active quota lock은 재감지/준비 전환/pending 자동 시작으로 풀리지 않게 수정했습니다. 설치 앱 로컬 상태도 Claude 잠금 2026-05-18 06:00 KST, Codex dungbo92 로컬 예산 ok로 보정했습니다.
- Verification: pnpm validate; pnpm dashboard:build; parseQuotaReset sample => 2026-05-17T21:00:00.000Z
- Git: not recorded
- Decisions: none
- Next: commit/push/release

## 2026-05-13T09:29:42.738Z

- Status: completed
- Summary: Claude quota reset dated lockout 수정분을 commit/push했고, 자동 업데이트용 v0.2.3 patch release를 발행했습니다.
- Verification: pnpm validate; pnpm dashboard:build; gh release view v0.2.3
- Git: commit b76d469 pushed; release commit 7967461 and tag v0.2.3 pushed
- Decisions: none
- Next: Claude/Gemini authenticated cycle 재검증

## 2026-05-14T01:58:59.362Z

- Status: completed
- Summary: Codex dungbo92 계정의 오탐 quota lock을 해제했고, 작업/문서의 'API Rate Limit' 문구만으로 Codex 계정이 1시간 fallback 잠금되지 않도록 파서와 worker 종료 분류를 강화했습니다. 잠금 점검 probe도 Codex routine 모델을 사용하도록 바꿨습니다.
- Verification: pnpm validate; pnpm dashboard:build; parseQuotaReset soft API Rate Limit => null; c4 quotaResetAt cleared
- Git: not recorded
- Decisions: none
- Next: commit/push/release

## 2026-05-14T02:02:05.085Z

- Status: completed
- Summary: Codex quota false-positive fix를 v0.2.7로 릴리즈했습니다. c4 Codex dungbo92 계정의 잘못된 자동 잠금은 해제된 상태입니다.
- Verification: pnpm validate; pnpm dashboard:build; gh release view v0.2.7
- Git: commit 21e1c22 pushed; release commit 1e520de and tag v0.2.7 pushed
- Decisions: none
- Next: Claude/Gemini authenticated cycle 재검증

## 2026-05-14T06:33:04.942Z

- Status: completed
- Summary: stale activeRun 복구를 추가했습니다. worker PID가 사라졌고 last-message가 있으면 dashboard가 자동으로 run을 완료 처리해 다음 에이전트 실행을 막지 않습니다. 현재 멈춘 run-1778736452149도 완료 처리했습니다.
- Verification: pnpm validate; pnpm dashboard:build; run-1778736452149 activeRun cleared
- Git: not recorded
- Decisions: none
- Next: commit/push/release

## 2026-05-14T06:35:29.560Z

- Status: completed
- Summary: stale activeRun 복구 패치를 v0.2.9로 릴리즈했습니다. run-1778736452149는 완료 처리되어 activeRun이 비었고, 다음 에이전트 실행을 막지 않습니다.
- Verification: pnpm validate; pnpm dashboard:build; gh release view v0.2.9; activeRun null
- Git: commit 754015f pushed; release commit 45c1e53 and tag v0.2.9 pushed
- Decisions: none
- Next: D:\\sytleOsjang 변경 13개 파일 검증/커밋 또는 다음 에이전트 인계

## 2026-05-14T06:47:09.520Z

- Status: completed
- Summary: stale activeRun 복구 릴리즈(v0.2.9) 후 stuck run-1778736452149를 완료 처리했고, 이어받은 D:\\sytleOsjang 쇼퍼 i18n 변경을 보정해 c11dcdd로 commit/push했습니다.
- Verification: AgentApp: pnpm validate; pnpm dashboard:build; gh release view v0.2.9; activeRun null. sytleOsjang: pnpm typecheck; git diff --check.
- Git: AgentApp main pushed: 754015f, 45c1e53, 8446764. sytleOsjang main pushed: c11dcdd.
- Decisions: none
- Next: AgentApp 다음 제품 작업: Claude/Gemini CLI authenticated cycle 재검증. sytleOsjang 다음 작업: i18n 잔여 화면 브라우저 런타임 확인 및 문구 품질 보정.

## 2026-05-14T07:37:58.292Z

- Status: completed
- Summary: Codex run-1778742204233은 프로세스가 exitCode 1로 종료되고 최종 메시지를 남기지 않아 실패 처리됐습니다. quota/auth 증거는 없고, 로그상 누락된 handoff 파일 조회와 PowerShell parser error 이후 i18n 검색 중 종료됐습니다. 실패/강종 후 미커밋 변경이 남으면 run에 interruptedWorktree를 기록하고 대시보드에 파일 수/목록을 표시하도록 v0.2.10 릴리즈했습니다.
- Verification: pnpm validate; pnpm dashboard:build; gh release view v0.2.10; run-1778742204233 interruptedWorktree fileCount=6
- Git: commit 75430d9 pushed; release commit d14858a and tag v0.2.10 pushed
- Decisions: none
- Next: D:\\sytleOsjang에 남은 6개 변경 파일을 검토해 이어서 완료/커밋하거나 폐기 판단

## 2026-05-16T17:30:00.000Z

- Status: completed
- Summary: 사용자 환경에서 보고된 토큰 폭주 3대 원인 차단 + Claude Code 라이브 타임라인. (1) startRun 에 살아있는 activeRun 가드, dispatchPendingForAccount 에 in-memory account-lock 으로 백그라운드 다중 실행 차단. (2) tryAutoChain 의 CHAIN_DONE 처리 기본 = stop, override 는 settings 명시 시에만 + cap 3→1, autoChainMaxDepth 30→8. (3) tryQuotaRetry 후속 run 에 autoChain:false 강제, quotaRetryMaxAttempts 3→2 — quota×chain 곱셈 폭주 차단. (4) Claude 어댑터에 --output-format stream-json --verbose 적용, interpretClaudeStreamLine 가 NDJSON 을 💬/🔧/🤔/↳/⚠/▶/▣ 한 줄로 변환해 event log 실시간 표시; lastMessage 는 result.finalText 로 저장. v0.3.0 릴리즈 발행.
- Verification: pnpm validate (validate-quota-parser 15 케이스 통과 — token-drain 가드 2 + stream-json 파서 6 신규 포함); pnpm dashboard:build; pnpm desktop:release -- --bump minor; gh release view v0.3.0; AgentApp-Setup-0.3.0-x64.exe + latest.yml 업로드 확인.
- Git: commits 0a10bbd (token-drain fix), 13b2304 (Claude stream-json), 79bbd7d (release v0.3.0), 93d3912/(이번 commit)(decisions doc) pushed; tag v0.3.0 pushed.
- Decisions: DEC-20260516-001 resolved (gh CLI 설치 + OAuth 인증 후 release 발행 완료)
- Next: 다음 작업은 사용자 지시 대기. 보류 항목 DEC-20260509-003 (주간 사용량 입력 방식) 만 남음.

## 2026-05-16T02:37:47.857Z

- Status: completed
- Summary: 데스크탑 단일 인스턴스 잠금 + 트레이/창 컴팩트 모드 양방향 동기화 마무리
- Verification: pnpm validate && pnpm dashboard:build
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-16T02:42:11.328Z

- Status: blocked
- Summary: Claude/Gemini CLI 설치/인증 재검증: Claude CLI 직접 호출은 정상이나 dashboard runtime이 두 Claude 계정 모두 quota-lock으로 제외; Gemini CLI는 미인증·dashboard 미등록
- Verification: claude --print 직접 호출=정상응답; gemini -p=Auth method missing; agent:cycle-test --worker claude-code --execute=blocked(라우팅 후보 0); agent:cycle-test --worker gemini-cli=blocked(활성 계정 없음); pnpm agent:doctor=ready(2 warnings)
- Git: not recorded
- Decisions: DEC-20260516-002 pending(Gemini 인증+등록), DEC-20260516-003 pending(Claude 잠금 일치성)
- Next: DEC-20260516-002/003 사용자 결정 후 cycle-test 재실행

## 2026-05-16T11:36:15.694Z

- Status: completed
- Summary: Dashboard 현재 실행 패널을 selectedProject 기준으로 필터링하도록 수정. activeRun.projectId === selectedProjectRecord.id 인 경우만 ChatConversation/pendingRuns/runHistory 노출. 다른 프로젝트가 글로벌 슬롯을 점유 중이면 사용자에게 명시 메시지 표시. topbar nowDoing/StatusPill 도 선택된 프로젝트 기준.
- Verification: pnpm dashboard:build; pnpm validate
- Git: not recorded
- Decisions: none
- Next: 사용자 환경에서 실제로 프로젝트 전환 시 현재 실행 패널이 비워지는지 시각 확인

## 2026-05-16T11:42:00.978Z

- Status: blocked
- Summary: v0.4.5 현재 실행 패널 프로젝트 전환 검증: 소스에서 selectedProject 기준 activeRun 필터와 다른 프로젝트 글로벌 슬롯 안내 문구 존재를 확인했고 pnpm validate/pnpm dashboard:build 통과. 설치된 앱에서 프로젝트 A Start 후 프로젝트 B 전환 시 실제 안내 노출 여부는 사용자 시각 확인 결과가 필요함.
- Verification: pnpm validate; pnpm dashboard:build
- Git: not recorded
- Decisions: none
- Next: 사용자 환경에서 v0.4.5 설치 앱 프로젝트 전환 시 '다른 프로젝트에서 실행 중인 작업이 있어 글로벌 슬롯은 점유 중입니다.' 안내 노출 여부를 알려주면 완료/회귀 처리

## 2026-05-16T11:45:14.475Z

- Status: blocked
- Summary: v0.4.5 시각 검증 handoff 커밋(c112410)을 push한 뒤 apps/dashboard snapshot 변경이 자동 릴리즈 트리거에 해당해 v0.4.6 patch 릴리즈를 발행함. 릴리즈 자산은 NSIS Setup, blockmap, latest.yml 업로드 확인. 실제 설치 앱 프로젝트 전환 안내 노출 여부는 사용자 시각 확인 대기.
- Verification: pnpm validate; pnpm dashboard:build; pnpm desktop:release -- --bump patch; gh release view v0.4.6
- Git: not recorded
- Decisions: none
- Next: 사용자 환경에서 v0.4.6 자동 업데이트 적용 후 프로젝트 A Start → 프로젝트 B 전환 시 글로벌 슬롯 안내 노출 여부 확인

## 2026-05-16T14:31:31.185Z

- Status: completed
- Summary: hanilnetworks.com 회사 계정으로 선택된 run 의 프롬프트 시작 구문을 [에러분석] 으로 자동 정규화하도록 dashboard runtime/launch adapter 를 보강했다. validate-quota-parser 에 prefix 추가/정규화/개인 계정 미적용 회귀 테스트를 추가하고 session profile routing 문서에 규칙을 기록했다.
- Verification: pnpm validate; pnpm agent:doctor; pnpm agent:status; pnpm agent:progress
- Git: not recorded
- Decisions: none
- Next: Claude/Gemini CLI 인증 cycle 재검증은 기존 NEXT_TASK 그대로 유지

## 2026-05-16T14:35:40.881Z

- Status: completed
- Summary: hanilnetworks.com 회사 계정 프롬프트 시작 태그 패치를 main 에 push했고, 자동 패치 릴리즈 v0.4.7 을 발행했다. 릴리즈 자산은 NSIS Setup, blockmap, latest.yml 업로드 확인.
- Verification: pnpm validate; pnpm desktop:release -- --bump patch; gh release view v0.4.7; pnpm agent:status
- Git: not recorded
- Decisions: none
- Next: Claude/Gemini CLI 인증 cycle 재검증은 기존 NEXT_TASK 그대로 유지

## 2026-05-17T23:22:11.487Z

- Status: completed
- Summary: runtime 0-byte corruption recovery hardening and local account/project restore
- Verification: pnpm validate; pnpm dashboard:build
- Git: not recorded
- Decisions: none
- Next: Desktop release patch after commit/push

## 2026-05-17T23:25:06.701Z

- Status: completed
- Summary: runtime corruption fix pushed and desktop release v0.8.5 published; local AppData runtime restored with 5 accounts and 2 projects
- Verification: pnpm validate; pnpm dashboard:build; pnpm desktop:release -- --bump patch; gh release view v0.8.5
- Git: not recorded
- Decisions: none
- Next: Monitor installed app update; if a project is still missing, re-add it from the dashboard

## 2026-05-18T00:00:39.752Z

- Status: completed
- Summary: dashboard 중앙 실행 화면을 유지하고 우측 접이식 도구 사이드바를 추가했다. 브라우저/터미널은 우측 탭으로 이동했고 코드 리더는 git 변경 파일, 파일 내용, 추가 라인 마킹, raw diff를 표시한다.
- Verification: pnpm --dir apps/dashboard build; pnpm validate; Browser DOM check: tool rail open, browser/status/terminal/code tabs, code changed files and added-line markers
- Git: not recorded
- Decisions: none
- Next: 설치 앱에서 우측 도구 사이드바와 Electron webview/PTY 터미널 동작을 확인한 뒤 자동 릴리즈 수행

## 2026-05-18T00:17:34.019Z

- Status: completed
- Summary: AgentApp 버벅임 원인을 분석해 죽은 worker PID가 activeRuns에 남아 activeRun으로 계속 복구되는 런타임 루프를 수정했고, Windows EPERM/EBUSY rename 재시도를 추가했다.
- Verification: pnpm validate; pnpm dashboard:build
- Git: not recorded
- Decisions: none
- Next: 현재 실행 중인 설치 앱은 기존 코드로 로컬 API도 응답 지연되므로 앱 완전 종료 후 새 릴리즈 적용 확인

## 2026-05-18T00:21:54.652Z

- Status: completed
- Summary: stale active run 루프 수정 커밋을 main에 push했고 desktop 자동 업데이트용 v0.8.7 NSIS 릴리즈를 발행했다.
- Verification: pnpm validate; pnpm dashboard:build; pnpm desktop:release -- --bump patch
- Git: not recorded
- Decisions: none
- Next: 현재 실행 중인 AgentApp 구버전 프로세스를 완전 종료한 뒤 v0.8.7 업데이트 적용 확인

## 2026-05-18T05:57:15.205Z

- Status: completed
- Summary: worker-launches run 디렉터리와 런타임 불일치 원인을 이어 분석했다. 실행 프로세스/launch 디렉터리는 생성됐지만 runtime active/runHistory 레코드가 concurrent read/write race로 유실되어 앱에 표시되지 않았다. readRuntime maintenance 저장을 최신 디스크 재읽기 기반으로 바꾸고, missing run 이벤트를 metadata 기반 active 복구로 보강했다.
- Verification: pnpm validate; pnpm dashboard:build; pnpm agent:doctor; pnpm agent:progress
- Git: not recorded
- Decisions: none
- Next: 현재 떠 있는 설치 앱은 구버전 writer가 AppData runtime을 계속 덮어쓸 수 있으므로 새 릴리즈 적용 후 재시작 확인

## 2026-05-18T06:00:57.268Z

- Status: completed
- Summary: runtime active run 보존 패치를 main에 push했고 desktop 자동 업데이트용 v0.9.1 NSIS 릴리즈를 발행했다. run-1779082262470은 실제 작업이 완료되어 last-message와 sytleOsjang commit 58f070b가 확인됐지만, 현재 실행 중인 구버전 앱이 AppData runtime을 다시 recovered stub으로 덮어쓰므로 앱 재시작/업데이트가 필요하다.
- Verification: pnpm validate; pnpm dashboard:build; pnpm desktop:release -- --bump patch; gh release view v0.9.1
- Git: not recorded
- Decisions: none
- Next: AgentApp v0.9.1 적용 후 새 worker run이 activeRuns에 유지되고 완료 시 runHistory에 정상 표시되는지 확인

## 2026-05-19T02:25:46.405Z

- Status: completed
- Summary: 원격 main 최신 상태를 확인했고, compact 화면이 완료된 run의 stale activeRuns/currentStatus 때문에 계속 진행 중처럼 보이는 표시 문제를 수정했다. stale DASHBOARD_RUN handoff도 completed로 정리했다.
- Verification: git fetch --all --prune; pnpm validate; pnpm dashboard:build; Browser compact smoke test
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-19T02:29:39.551Z

- Status: completed
- Summary: compact 실행 상태 불일치 수정 커밋을 main에 push했고, 자동 업데이트용 v0.10.2 NSIS 릴리즈를 발행했다. GitHub Release에는 NSIS setup, blockmap, latest.yml이 업로드됐다.
- Verification: pnpm validate; pnpm dashboard:build; pnpm --dir apps/dashboard build; Browser compact smoke test; gh release view v0.10.2
- Git: not recorded
- Decisions: none
- Next: See tools/agent-orchestrator/handoff/NEXT_TASK.md

## 2026-05-19T03:10:01.363Z

- Status: completed
- Summary: Codex 계정이 실제로는 사용 가능한데 소진처럼 보이던 quota 표시를 정리했다. 잠긴 계정만 사용 가능 수에서 제외하고, Codex의 timezone 없는 try again at 시간은 로컬 시간으로 해석하도록 수정했다.
- Verification: pnpm validate; pnpm dashboard:build; Browser quota UI check
- Git: not recorded
- Decisions: none
- Next: 자동 업데이트 릴리즈 적용 후 설치 앱에서 Codex 계정이 Plus · 사용 가능으로 보이는지 확인

## 2026-05-19T03:13:34.669Z

- Status: completed
- Summary: Codex quota 표시/로컬 reset 시간 수정 커밋을 main에 push했고, 자동 업데이트용 v0.10.3 NSIS 릴리즈를 발행했다. GitHub Release에는 NSIS setup, blockmap, latest.yml이 업로드됐다.
- Verification: pnpm validate; pnpm dashboard:build; Browser quota UI check; gh release view v0.10.3
- Git: not recorded
- Decisions: none
- Next: 설치 앱 업데이트 적용 후 계정 화면에서 Codex는 Plus · 사용 가능, Claude만 reset 시각 포함 잠금으로 보이는지 확인

## 2026-05-16T18:30:00.000Z

- Status: completed
- Summary: DEC-20260516-003 (Claude dashboard 한도 잠금 false-positive) 해결. worker-launch-adapter.mjs 의 stream-json onLine 훅이 이미 quotaScanLine 가드로 JSON envelope 를 차단하고 result.finalText 또는 plain text fallback 만 parseQuotaReset 에 넘기도록 구현돼 있음을 확인. 회귀 방지를 위해 validate-quota-parser 에 tool_result/assistant text 가 finalText 를 노출하지 않는다는 케이스 2개 추가. 사용자는 leemg 계정의 기존 false-positive 잠금 1회만 dashboard '강제 해제' 버튼으로 풀면 됨. DEC-20260516-002 (Gemini CLI OAuth) 는 사용자 본인 OAuth 가 필요한 agent 범위 밖 항목이라 대기 유지.
- Verification: pnpm validate (validate-quota-parser 17 케이스 + race + e2e 통과)
- Git: (이번 commit) pushed.
- Decisions: DEC-20260516-003 resolved (Option C). DEC-20260516-002 still pending (user-required OAuth).
- Next: 사용자 지시 대기. Gemini 인증은 사용자가 진행 후 dashboard Add account 만 누르면 됨.
