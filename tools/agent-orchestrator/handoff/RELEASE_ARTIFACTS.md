# RELEASE_ARTIFACTS

- Generated: 2026-05-11T12:32:55.337Z

## Portable (단일 EXE, 설치 없음)

- Artifact: `dist-desktop/AgentApp-0.1.0-x64.exe`
- Size bytes: 92009658
- SHA256: `00702a8e40d426ec24ee19545402c2e99691f230a458addcbd4db0c64bd32fcb`

```powershell
dist-desktop/AgentApp-0.1.0-x64.exe
Get-FileHash -Algorithm SHA256 dist-desktop/AgentApp-0.1.0-x64.exe
```


## NSIS Installer (표준 설치 마법사)

- Artifact: `dist-desktop/AgentApp-Setup-0.1.0-x64.exe`
- Size bytes: 92239451
- SHA256: `efe6baa6f31858eaa1bf102eb00de71bbc478063d30b4084a4d1e21957f80f80`

```powershell
dist-desktop/AgentApp-Setup-0.1.0-x64.exe
Get-FileHash -Algorithm SHA256 dist-desktop/AgentApp-Setup-0.1.0-x64.exe
```

검증 메모:

- win-unpacked/AgentApp.exe 즉시 실행 확인: 8초 뒤에도 프로세스 유지.
- dist-desktop/AgentApp-Setup-0.1.0-x64.exe UI 경로 즉시 실행 확인: 6초 뒤에도 프로세스 유지.
- dist-desktop/AgentApp-Setup-0.1.0-x64.exe /S /D=D:\agentApp\tmp\AgentAppInstallSmoke exit code 0.
- silent 설치된 AgentApp.exe 즉시 실행 확인: 8초 뒤에도 프로세스 유지.

## 빌드 명령

```bash
pnpm desktop:pack
pnpm desktop:installer
pnpm desktop:all
pnpm desktop:artifact
```
