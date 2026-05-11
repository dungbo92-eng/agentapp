# Windows EXE Packaging

AgentApp의 Windows 실행 파일은 Electron shell이 dashboard 정적 파일과 로컬 API 서버를 함께 띄우는 구조다.

## 명령

```bash
pnpm desktop:dev
pnpm desktop:pack
pnpm desktop:artifact
```

- `desktop:dev`: dashboard를 빌드한 뒤 Electron 창으로 실행한다.
- `desktop:pack`: dashboard를 빌드한 뒤 현재 `package.json` 버전의 portable 실행 파일을 만든다. 예: `dist-desktop/AgentApp-0.1.0-x64.exe`.
- `desktop:artifact`: 생성된 EXE의 크기와 SHA256을 `tools/agent-orchestrator/handoff/RELEASE_ARTIFACTS.md`에 기록한다.

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

`dist-desktop/`은 빌드 산출물이므로 git에서 제외한다. 릴리즈 파일을 공유할 때만 별도 배포 채널에 올린다.

공유 전에는 `pnpm desktop:artifact`를 실행해 파일 크기와 SHA256을 남긴다.
