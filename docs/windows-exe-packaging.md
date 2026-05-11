# Windows EXE Packaging

AgentApp의 Windows 실행 파일은 Electron shell이 dashboard 정적 파일과 로컬 API 서버를 함께 띄우는 구조다.

## 명령

```bash
pnpm desktop:dev          # 개발 중 Electron 창 실행
pnpm desktop:pack         # portable EXE (설치 없이 더블클릭 실행)
pnpm desktop:installer    # NSIS 설치 마법사 EXE
pnpm desktop:all          # portable + NSIS 두 산출물 동시 빌드
pnpm desktop:artifact     # 산출물 크기/SHA256 기록
```

- `desktop:dev`: dashboard 를 빌드한 뒤 Electron 창으로 실행한다.
- `desktop:pack`: dashboard 를 빌드한 뒤 현재 `package.json` 버전의 portable 실행 파일을 만든다. 예: `dist-desktop/AgentApp-0.1.0-x64.exe`. 사용자가 더블클릭 → 임시 폴더에 압축 해제 → 즉시 실행되는 단일 EXE.
- `desktop:installer`: 표준 Windows 설치 마법사(NSIS) EXE 를 만든다. 예: `dist-desktop/AgentApp-Setup-0.1.0-x64.exe`. 설치 경로 선택, 바탕화면/시작 메뉴 바로가기 생성, "프로그램 추가/제거" 등록을 제공한다.
- `desktop:all`: portable 과 NSIS 두 산출물을 한 번에 빌드한다.
- `desktop:artifact`: 마지막에 생성된 portable EXE 의 크기와 SHA256 을 `tools/agent-orchestrator/handoff/RELEASE_ARTIFACTS.md` 에 기록한다.

## 환경 자동 설치

환경 설치는 NSIS post-install prompt가 아니라 설치 후 dashboard 환경 패널에서 실행한다. NSIS 커스텀 prompt는 일부 Windows 11 환경에서 임시 `System.dll` crash를 유발할 수 있어 기본 installer 경로에서 제외했다.

1. 사용자가 `AgentApp-Setup-0.1.0-x64.exe` 를 설치한다.
2. AgentApp 실행 후 dashboard 오른쪽 환경 패널에서 누락 CLI를 확인한다.
3. [누락 AI CLI 자동 설치] 버튼이 `/api/agentapp/environment/install` 을 호출한다.
   - Node.js/Git/pnpm은 `pnpm agent:setup` 기준으로 진단한다.
   - Codex, Claude Code, Gemini CLI는 `npm install -g` 로 설치한다.
   - Cursor는 Windows에서 `winget install Anysphere.Cursor` 로 설치 시도한다.
4. 로그인, MFA, CAPTCHA, 승인창은 자동 처리하지 않는다. 설치 뒤 각 공식 도구에서 사용자가 직접 인증하고 dashboard에서 [재감지]를 누른다.

`build/setup-tools.cmd` 는 수동 복구용 bootstrapper로 유지한다. installer 내부 자동 실행에는 연결하지 않는다.

NSIS 설정은 `package.json` 의 `build.nsis` 블록에서 조정한다. 주요 옵션:

- `oneClick: false` — 경로 선택 등 마법사 UI 표시
- `perMachine: false` — 사용자 계정에 설치 (관리자 권한 불필요)
- `allowToChangeInstallationDirectory: true` — 설치 경로 변경 허용
- `createDesktopShortcut`/`createStartMenuShortcut: true` — 바로가기 자동 생성
- `extraResources` — `setup-tools.cmd` 를 `resources/` 디렉터리에 함께 포함
- `include: build/installer.nsh` 는 사용하지 않는다. NSIS `System.dll` crash 재발을 피하기 위해 post-install custom prompt는 dashboard 쪽으로 옮겼다.

## 런타임 구조

- `scripts/dashboard-server.mjs`: dashboard 정적 파일과 `/api/agentapp/*` 로컬 API를 제공한다.
- `apps/desktop/main.mjs`: Electron 창을 만들고 내부 localhost 서버 URL을 로드한다.
- `apps/dashboard/dist`: Vite로 빌드된 화면 파일.
- `data/`: 개발 모드의 local-only 설정 저장소. git에 올리지 않는다.
- packaged EXE: 계정 alias, ready 상태, 예산은 Electron `userData` 아래에 저장된다.

## 보안 경계

- 실행 파일은 API key, password, OAuth token, session cookie를 포함하지 않는다.
- Claude/Codex/Cursor 로그인은 공식 앱이나 CLI에서 사용자가 직접 한다.
- AgentApp은 `enabled`와 `sessionStatus=ready`인 계정 alias만 모델 라우팅 후보로 사용한다.
- 자동 로그인, 자동 계정 전환, captcha/MFA 우회는 패키징 범위에도 포함하지 않는다.

## 산출물

`dist-desktop/` 은 빌드 산출물이므로 git 에서 제외한다. 릴리즈 파일을 공유할 때만 별도 배포 채널에 올린다.

| 파일 | 용도 |
|---|---|
| `AgentApp-0.1.0-x64.exe` | Portable. 더블클릭만 하면 실행. 설치 흔적 없음 |
| `AgentApp-Setup-0.1.0-x64.exe` | NSIS installer. 경로 선택/바로가기/제거 등록. 환경 설치는 설치 후 dashboard에서 실행 |

공유 전에는 `pnpm desktop:artifact` 를 실행해 portable과 installer의 파일 크기와 SHA256 을 남긴다.
