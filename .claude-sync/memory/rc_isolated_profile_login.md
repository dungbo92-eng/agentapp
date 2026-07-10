---
name: rc_isolated_profile_login
description: "AgentApp RC는 격리 CLAUDE_CONFIG_DIR을 쓰므로 계정별 별도 로그인이 필요하고, 미로그인 시 claude가 빈 토큰 stub을 만들어 false-ready를 유발했다"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1dc4d483-51f3-4a83-b98d-87b0e9643c98
---

AgentApp의 `claude --remote-control` 세션은 기본 `~/.claude` 가 아니라 **격리 프로필**
`%APPDATA%\AgentApp\session-profiles\claude-code\<sanitized sessionProfile>` 을
`CLAUDE_CONFIG_DIR` 로 써서 실행된다. 따라서 **PC/Windows 계정마다 그 프로필에 직접
로그인해야** RC 세션이 폰(Claude 앱)에 뜬다. 기본 프로필이 로그인돼 있어도 소용없다.

미로그인 프로필에서 claude 를 실행하면 claude 가 `accessToken`/`refreshToken` 이 빈
문자열이고 `expiresAt: 0` 인 **껍데기 `.credentials.json`** 을 만든다. 이 파일 때문에
과거 `detectAccountSession` 이 `ready` 로 오탐했고(`if (expiresAt && ...)` 에서 `0` 이
falsy 라 만료 검사를 건너뜀), RC 가 hidden 콘솔에 세션을 띄우면 **로그인 프롬프트에서
멈춰 프로세스만 살아있고(`📡 RC ×N` 으로 보임) 폰에는 영영 등록되지 않았다.**
2026-07-10 `0fa3248` (v0.17.3) 에서 토큰 실제 존재까지 검사하도록 수정
(`parseClaudeCredentialState` / `claudeCredentialRejectReason`).

진단 순서: `.credentials.json` 의 accessToken 존재 여부 + `expiresAt` 를 기본 프로필과
격리 프로필에서 **비교**한다. 수동 `claude --remote-control` 은 되는데 앱 RC 만 안 되면
거의 항상 격리 프로필 미로그인이다.

주의: 기본 프로필의 `.credentials.json` 을 격리 프로필로 **복사하지 말 것** — refresh
토큰 rotation 이 서로를 무효화한다. 앱의 계정 '로그인' 으로 정식 OAuth 를 완료할 것.

관련: [[sync_clobber_gotcha]]
