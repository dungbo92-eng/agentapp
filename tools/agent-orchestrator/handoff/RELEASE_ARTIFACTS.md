# RELEASE_ARTIFACTS

- Generated: 2026-05-12T07:06:02.786Z

## Portable (단일 EXE, 설치 없음)

- Artifact: `dist-desktop/AgentApp-0.1.0-x64.exe`
- Size bytes: 92017338
- SHA256: `eb53e43196c73ae16e264a28a41de380e07f126e19988ddd74ec6d11abeaeb58`

```powershell
dist-desktop/AgentApp-0.1.0-x64.exe
Get-FileHash -Algorithm SHA256 dist-desktop/AgentApp-0.1.0-x64.exe
```


## NSIS Installer (표준 설치 마법사)

- Artifact: `dist-desktop/AgentApp-Setup-0.1.0-x64.exe`
- Size bytes: 100957885
- SHA256: `930c86f88a7760865304a0c719da27747a1ea528b8df19b3b89da9d390e89a8a`

```powershell
dist-desktop/AgentApp-Setup-0.1.0-x64.exe
Get-FileHash -Algorithm SHA256 dist-desktop/AgentApp-Setup-0.1.0-x64.exe
```

검증 메모:

- win-unpacked/AgentApp.exe 즉시 실행 확인: 8초 뒤에도 프로세스 유지.
- dist-desktop/AgentApp-Setup-0.1.0-x64.exe UI 경로 즉시 실행 확인: 6초 뒤에도 프로세스 유지.
- dist-desktop/AgentApp-Setup-0.1.0-x64.exe /S /D=%TEMP%\AgentAppInstallSmoke exit code 0.
- silent 설치된 AgentApp.exe 즉시 실행 확인: 8초 뒤에도 프로세스 유지.

## 빌드 명령

```bash
pnpm desktop:pack
pnpm desktop:installer
pnpm desktop:all
pnpm desktop:artifact
```
