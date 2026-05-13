# RELEASE_ARTIFACTS

- Generated: 2026-05-13T00:56:34.486Z

## Portable (단일 EXE, 설치 없음)

- Artifact: `dist-desktop/AgentApp-0.1.0-x64.exe`
- Size bytes: 92028884
- SHA256: `3c166e0976ff2007ed64bfbde2100fac75806405cf955ab024d682aa49df64ce`

```powershell
dist-desktop/AgentApp-0.1.0-x64.exe
Get-FileHash -Algorithm SHA256 dist-desktop/AgentApp-0.1.0-x64.exe
```


## NSIS Installer (표준 설치 마법사)

- Artifact: `dist-desktop/AgentApp-Setup-0.1.0-x64.exe`
- Size bytes: 92259005
- SHA256: `98fd595c2665ffa8392a32ec7a98a96308935faa2138677beadd31f81ac15d77`

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
