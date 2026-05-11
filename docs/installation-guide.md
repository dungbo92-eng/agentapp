# Installation Guide

이 문서는 AgentApp을 새 PC에서 실행하거나, 새 프로젝트를 AgentApp 관리 대상으로 등록할 때의 기본 절차를 정리한다.

## 전제 조건

- Git
- Node.js 20 이상
- pnpm 10 이상
- 정상 인증된 개발 도구: Codex, Claude Code, Cursor, Gemini CLI 등
- GitHub SSH key 또는 사용자가 승인한 git 인증 방식

AgentApp은 자동 로그인, 자동 계정 전환, captcha/MFA 우회, 결제/요금제 변경을 수행하지 않는다.

## 새 PC에서 시작

```bash
git clone git@github.com:dungbo92-eng/agentapp.git agentApp
cd agentApp
pnpm install
pnpm agent:setup
pnpm agent:doctor
pnpm agent:status
pnpm agent:next
pnpm dashboard:prepare
```

`pnpm install`은 postinstall에서 git hooks와 `.claude-sync` 동기화 구조를 점검한다.
`pnpm agent:setup`은 Node.js, Git, pnpm, Codex, Claude Code, Cursor, Gemini CLI의 설치/경로 상태를 점검하고 누락된 도구의 설치 명령을 출력한다.

## 도구 설치와 인증

```bash
pnpm agent:setup
pnpm agent:setup -- --target ai
pnpm agent:setup -- --install --target claude
pnpm agent:setup -- --install --target gemini
```

설치 자동화는 CLI 설치까지만 수행한다. 로그인, 계정 전환, CAPTCHA/MFA, 승인창 처리는 사용자가 공식 도구에서 직접 완료해야 한다.

대표 설치 명령:

```bash
npm install -g @openai/codex
npm install -g @anthropic-ai/claude-code
npm install -g @google/gemini-cli
```

PATH에 들어오지 않는 경우 아래 환경변수로 절대 경로를 지정한다.

```powershell
$env:AGENTAPP_CODEX_COMMAND="C:\path\to\codex.cmd"
$env:AGENTAPP_CLAUDE_COMMAND="C:\path\to\claude.cmd"
$env:AGENTAPP_GEMINI_COMMAND="C:\path\to\gemini.cmd"
$env:AGENTAPP_CURSOR_COMMAND="C:\path\to\cursor.cmd"
```

공식 설치 기준:

- Codex CLI: https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started
- Claude Code: https://docs.anthropic.com/en/docs/claude-code/getting-started
- Gemini CLI: https://google-gemini.github.io/gemini-cli/docs/get-started/

## 사용자 환경 통합 테스트

인증을 마친 뒤 dashboard 실행 한 사이클을 아래 명령으로 점검한다.

```bash
pnpm agent:cycle-test
pnpm agent:cycle-test -- --worker codex --execute --timeout-ms 120000
pnpm agent:cycle-test -- --worker claude-code --execute --timeout-ms 120000
pnpm agent:cycle-test -- --worker gemini-cli --execute --timeout-ms 120000
```

`--execute` 없이는 라우팅 준비 상태만 점검한다. `--execute`는 준비된 로컬 세션 프로필에서 실제 worker를 시작하므로 인증 완료 후 사용한다.

## 필수 점검

```bash
pnpm validate
pnpm agent:doctor
pnpm agent:scheduled-check -- --json
```

정상 기준:

- `agent:doctor` 경고 0개
- `agent:status` memory/plans in-sync
- `agent:scheduled-check`의 `git.synced=true`
- `git status --short` 출력 없음

## 로컬 대시보드

```bash
pnpm dashboard:prepare
pnpm dashboard:dev
```

대시보드는 `apps/dashboard/public/agent-snapshot.json`을 읽는 read-only 화면이다. 외부 서비스에 쓰기 요청을 보내지 않는다.

## 새 프로젝트 등록 기준

새 프로젝트도 기능 개발보다 먼저 공통 동기화 골격을 갖춘다.

필수 파일:

```text
AGENTS.md
CLAUDE.md
.claude-sync/memory/project_state.md
.claude-sync/plans/<project-roadmap>.md
tools/agent-orchestrator/handoff/NEXT_TASK.md
tools/agent-orchestrator/handoff/RUN_STATUS.md
tools/agent-orchestrator/handoff/DECISIONS_REQUIRED.md
tools/agent-orchestrator/task-queue.json
```

필수 흐름:

```bash
pnpm agent:doctor
pnpm agent:status
pnpm agent:next
pnpm validate
```

세부 기준은 `docs/project-baseline-sync.md`를 따른다.

## 작업 완료 흐름

```bash
pnpm validate
pnpm dashboard:build
pnpm agent:progress
pnpm agent:report -- --status completed --summary "작업 요약" --verify "검증 내용"
pnpm agent:next
pnpm agent:prompt -- --all --write
pnpm agent:sync
git status --short
git add <changed-files>
git commit -m "<type>: <summary>"
git push origin main
```

push는 remote가 설정되어 있고 사용자가 승인한 범위에서만 수행한다.

## 안전 경계

세부 보안 모델은 `docs/security-model.md`를 따른다.

금지:

- 자동 로그인
- 자동 계정 전환
- quota 우회
- captcha/MFA/승인창 우회
- 비밀값 저장
- 결제/요금제 변경
- 외부 운영계 쓰기
- force push/history rewrite

보류:

- 배포
- 외부 서비스 `POST`, `PUT`, `PATCH`, `DELETE`
- 운영 DB 변경
- 사용자가 직접 결정해야 하는 제품 방향

허용:

- 로컬 코드/문서 수정
- 로컬 검증
- dashboard snapshot 생성
- memory/plan/handoff 갱신
- 검증된 commit/push

## 자주 쓰는 명령

```bash
pnpm agent:status
pnpm agent:sync
pnpm agent:scheduled-check
pnpm agent:budget
pnpm agent:route -- --task "작업 설명" --complexity routine
pnpm agent:dry-run -- --operation "pnpm validate"
pnpm dashboard:prepare
pnpm dashboard:build
pnpm validate
```
