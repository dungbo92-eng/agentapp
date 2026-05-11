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
- `desktop:installer`: 표준 Windows 설치 마법사(NSIS) EXE 를 만든다. 예: `dist-desktop/AgentApp-Setup-0.1.0-x64.exe`. 설치 경로 선택, 바탕화면/시작 메뉴 바로가기 생성, "프로그램 추가/제거" 등록, 그리고 설치 마지막 단계에서 **필수 환경(Node.js + AI CLI) 자동 설치** 옵션을 묻는다.
- `desktop:all`: portable 과 NSIS 두 산출물을 한 번에 빌드한다.
- `desktop:artifact`: 마지막에 생성된 portable EXE 의 크기와 SHA256 을 `tools/agent-orchestrator/handoff/RELEASE_ARTIFACTS.md` 에 기록한다.

## 환경 자동 설치 (NSIS installer)

`build/installer.nsh` 와 `build/setup-tools.cmd` 가 NSIS installer 의 마지막 단계에 묶여 있다.

1. installer 가 메인 파일을 모두 복사한 뒤 사용자에게 "필수 환경 자동 설치할까요?" 를 묻는다.
2. **예** 선택 시 `setup-tools.cmd` 가 새 콘솔 창에서 실행된다.
   - `node` 가 PATH 에 없으면 `winget install OpenJS.NodeJS.LTS` 로 설치한다.
   - `npm install -g @openai/codex @anthropic-ai/claude-code @google/gemini-cli` 로 4종 AI CLI 를 설치한다.
   - Cursor 도 winget 으로 설치 시도 (실패해도 무시).
3. **아니오** 선택 시 dashboard 의 환경 패널에서 [누락 AI CLI 자동 설치] 버튼으로 동일 흐름을 트리거할 수 있다.

NSIS 설정은 `package.json` 의 `build.nsis` 블록에서 조정한다. 주요 옵션:

- `oneClick: false` — 경로 선택 등 마법사 UI 표시
- `perMachine: false` — 사용자 계정에 설치 (관리자 권한 불필요)
- `allowToChangeInstallationDirectory: true` — 설치 경로 변경 허용
- `createDesktopShortcut`/`createStartMenuShortcut: true` — 바로가기 자동 생성
- `include: build/installer.nsh` — 커스텀 NSIS 스크립트 (환경 자동 설치 prompt)
- `extraResources` — `setup-tools.cmd` 를 `resources/` 디렉터리에 함께 포함

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
| `AgentApp-Setup-0.1.0-x64.exe` | NSIS installer. 경로 선택/바로가기/제거 등록 + 환경 자동 설치 옵션 |

공유 전에는 `pnpm desktop:artifact` 를 실행해 파일 크기와 SHA256 을 남긴다. NSIS installer 의 해시는 PowerShell `Get-FileHash` 또는 `sha256sum` 으로 별도 기록한다.
