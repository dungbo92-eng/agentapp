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

**false-ready 경로가 하나 더 있었다** (v0.17.5 에서 수정). `detectAccountSession` 은
`account.credentialStatus === "stored"` 면 세션 검사 자체를 건너뛰고 곧장 `ready` 를
돌려줬다. 그런데 vault 의 비밀번호/API 키는 **로그인 창 자동입력용일 뿐 CLI 인증에
주입되지 않는다** (`worker-launch-adapter`·`electron-login-window` 어디서도 안 읽음).
그래서 "암호 저장됨" 계정은 한 번도 로그인한 적 없어도 초록불 + `📡 RC` 였다. 실측:
`claude-dungbo92-gmail.com` = stub 토큰인데 `ready`. 세션 준비 판정은 항상 실제 세션
아티팩트(+claude 는 OAuth 토큰)로만 해야 한다.

격리 프로필의 hidden RC 세션에는 **응답 불가능한 프롬프트가 3중으로** 있다. 순서대로:
1. 폴더 신뢰 대화상자 → `ensureClaudeFolderTrusted` (v0.17.0)
2. **첫 실행 온보딩(테마 선택)** → `ensureClaudeOnboarded` (v0.17.4). `.claude.json` 의
   `hasCompletedOnboarding: true` 하나면 건너뛴다(PTY A/B 실측).
3. OAuth 로그인 → 사용자가 직접 로그인해야 함.
어느 하나에 걸리면 프로세스는 살아서 `📡 RC ×N` 으로 보이지만 폰엔 등록되지 않는다.

3번은 **본질적으로 숨긴 콘솔로 넘길 수 없다**(사용자 상호작용 필수). 그래서 v0.17.5 에
계정 카드의 **`📱 RC 터미널`** 매크로를 넣었다 — 숨긴 spawn 과 같은 `CLAUDE_CONFIG_DIR`/
cwd/args 를 PowerShell 한 줄(`buildRemoteControlTerminalCommand`)로 만들어 **보이는 사이드
터미널**에 타이핑한다. 사용자가 프롬프트를 직접 보고 응답하며 진행 상황을 확인할 수 있다.
막히면 이 경로를 먼저 쓸 것.

진단 방법: 앱은 hidden 콘솔 stdout 을 버리므로 로그가 없다. 로컬 node-pty 로 **진짜 PTY**
를 만들어 같은 `CLAUDE_CONFIG_DIR`/cwd 로 `claude --remote-control` 을 띄우면 화면을 그대로
캡처할 수 있다. 인증 여부는 `claude --print` 로 확인(단, `ANTHROPIC_BASE_URL`/API 키가 env
에 상속되면 OAuth 없이도 통과하는 착시가 생기니 반드시 제거하고 볼 것).

`.credentials.json` 의 accessToken 존재 여부 + `expiresAt` 를 기본 프로필과 격리 프로필에서
**비교**한다. 수동 `claude --remote-control` 은 되는데 앱 RC 만 안 되면 거의 항상 격리 프로필
문제다. 로그인은 `claude auth login` (앱의 '로그인' 버튼이 이걸 격리 프로필로 실행).

주의: 기본 프로필의 `.credentials.json` 을 격리 프로필로 **복사하지 말 것** — refresh
토큰 rotation 이 서로를 무효화한다. 앱의 계정 '로그인' 으로 정식 OAuth 를 완료할 것.

관련: [[sync_clobber_gotcha]]
