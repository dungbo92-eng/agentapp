# RELEASE_ARTIFACTS

- Generated: 2026-05-13T00:43:44.753Z

## Portable (단일 EXE, 설치 없음)

- Artifact: `dist-desktop/AgentApp-0.1.0-x64.exe`
- Size bytes: 92027769
- SHA256: `d3cb54995f09113d725327c3824180d9a0a2b3e07cadf9100d595d1feb0bda7c`

```powershell
dist-desktop/AgentApp-0.1.0-x64.exe
Get-FileHash -Algorithm SHA256 dist-desktop/AgentApp-0.1.0-x64.exe
```


## NSIS Installer (표준 설치 마법사)

- Artifact: `dist-desktop/AgentApp-Setup-0.1.0-x64.exe`
- Size bytes: 92257966
- SHA256: `06ced1fe4078fee3f765759c96540498b21f13da939dce49c70aa10a0d9435a3`

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
