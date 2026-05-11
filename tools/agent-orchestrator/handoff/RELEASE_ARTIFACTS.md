# RELEASE_ARTIFACTS

- Generated: 2026-05-11T05:13:28.447Z

## Portable (단일 EXE, 설치 없음)

- Artifact: `dist-desktop/AgentApp-0.1.0-x64.exe`
- Size bytes: 92006601
- SHA256: `977889027b0a5f1c397e7040ab8005228c76b1ecbbe229b8dab7020a3be8bd54`

```powershell
dist-desktop/AgentApp-0.1.0-x64.exe
Get-FileHash -Algorithm SHA256 dist-desktop/AgentApp-0.1.0-x64.exe
```

## NSIS Installer (표준 설치 마법사 + 환경 자동 설치)

- Artifact: `dist-desktop/AgentApp-Setup-0.1.0-x64.exe`
- Size bytes: 92236801
- SHA256: `8f44343e784b4ae8d24bfc5f298c4ed47484ac3abdf76f570c70a927f39a8517`

흐름:

1. 사용자가 `AgentApp-Setup-0.1.0-x64.exe` 를 더블클릭.
2. 표준 설치 마법사 (경로 변경, 바탕화면/시작 메뉴 바로가기, 제어판 "프로그램 추가/제거" 등록).
3. 설치 마지막 단계에서 "필수 환경(Node.js + AI CLI) 자동 설치?" 메시지박스.
   - 예: `setup-tools.cmd` 가 새 콘솔에서 실행 — winget 으로 Node.js LTS 설치(없으면), npm 으로 Codex/Claude Code/Gemini CLI 설치, winget 으로 Cursor 설치(없으면).
   - 아니오: 나중에 dashboard 환경 패널의 [누락 AI CLI 자동 설치] 버튼으로 같은 흐름 실행.

```powershell
Get-FileHash -Algorithm SHA256 dist-desktop/AgentApp-Setup-0.1.0-x64.exe
```

## 빌드 명령 (개발자용)

```bash
pnpm desktop:pack         # portable 만
pnpm desktop:installer    # NSIS installer 만
pnpm desktop:all          # 둘 다
pnpm desktop:artifact     # portable artifact 정보 기록
```
