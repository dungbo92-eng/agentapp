# Worker Launch Adapters

AgentApp의 worker launch adapter는 ready session profile을 실제 로컬 도구 실행으로 연결하는 층이다. 목적은 정상 인증된 도구를 project handoff와 안전하게 이어붙이는 것이지, 로그인이나 플랫폼 제한을 우회하는 것이 아니다.

## 공통 흐름

1. dashboard `Start`가 계정, 모델, session profile을 라우팅한다.
2. adapter가 `data/worker-launches/<run-id>` 아래 launch prompt, validate log, worker log를 만든다.
3. `pnpm validate` preflight를 먼저 실행한다.
4. preflight가 통과하면 worker별 adapter mode를 선택한다.
5. 실행 결과, log path, handoff 상태를 runtime과 `DASHBOARD_RUN.md`에 기록한다.

## 기본 adapter mode

- `command`
  설명: 비대화형 CLI 실행이 가능한 worker.
  현재: Codex, Claude Code, Gemini CLI
- `open-window`
  설명: session profile 디렉터리로 앱 창을 열고 사용자가 그 안에서 이어가는 worker.
  현재: Cursor
- `manual`
  설명: machine-specific command profile이 없어서 worker prompt 파일만 준비하는 fallback.
  현재: (사용 안 함)

## Session Profile 디렉터리

- Codex: `data/session-profiles/codex/<session-profile>`
  여기서는 `CODEX_HOME`으로 사용한다.
- Cursor: `data/session-profiles/cursor/<session-profile>`
  여기서는 `--user-data-dir`로 사용한다.
- Claude Code: `data/session-profiles/claude-code/<session-profile>`
  여기서는 `CLAUDE_CONFIG_DIR`로 사용한다. settings, projects, todos, plans 가 이 디렉터리 아래에 분리된다.
- Gemini CLI: `data/session-profiles/gemini-cli/<session-profile>`
  여기서는 `GEMINI_CONFIG_DIR` 로 사용한다. settings, auth, history 가 이 디렉터리 아래에 분리된다.

이 디렉터리는 repo 밖이 아니라 local-only data 저장소 아래에 있지만 `.gitignore` 대상이므로 git에 올라가지 않는다.

## Claude Code adapter 동작

- 명령: `claude --print --permission-mode acceptEdits [--model <model>]`
- prompt 는 stdin 으로 전달한다 (`-p`/`--print` 모드에서 인자 없이 stdin 입력).
- `CLAUDE_CONFIG_DIR` 환경변수로 세션 프로필별 설정/히스토리 디렉터리를 분리한다.
- `AGENTAPP_CLAUDE_COMMAND` 환경변수가 있으면 그 경로를 우선한다.
- 모델 라우팅은 `auto`, `best_available`, `opus`, `sonnet`, `haiku` 와 `claude-*` 식별자를 받는다.
- 워커 stdout 은 `data/worker-launches/<run-id>/last-message.txt` 에 저장된다.
- login/session expired 패턴이 보이면 해당 계정을 `needs-login` 으로 되돌리고 `needs_user` handoff 를 남긴다.

## Preflight와 로그

모든 adapter는 launch 전에 `pnpm validate`를 실행한다.

- 성공: active run에 `validation.status=passed`
- 실패: worker launch를 중단하고 `validation_failed` handoff를 남김

log 파일:

- `data/worker-launches/<run-id>/launch-prompt.md`
- `data/worker-launches/<run-id>/validate.log`
- `data/worker-launches/<run-id>/worker.log`
- `data/worker-launches/<run-id>/metadata.json`

## Login Needed 감지

worker output에서 `login`, `sign in`, `session expired`, `authentication` 같은 패턴을 감지하면:

- 해당 account를 `needs-login`으로 바꾼다.
- run 상태를 `needs_user`로 마감한다.
- handoff reason은 `missing_credentials`로 남긴다.

이 감지는 login 우회가 아니라 “세션이 다시 필요하다”는 신호를 남기는 용도다.

## Gemini CLI adapter 동작

- 명령: `gemini -p [--model <model>]`
- prompt 는 stdin 으로 전달한다.
- `GEMINI_CONFIG_DIR` 환경변수로 세션 프로필별 설정/인증 디렉터리를 분리한다.
- `AGENTAPP_GEMINI_COMMAND` 환경변수가 있으면 그 경로를 우선한다.
- 모델 라우팅은 `auto`, `best_available`, `gemini-*` 식별자를 받는다.
- 워커 stdout 은 `data/worker-launches/<run-id>/last-message.txt` 에 저장된다.

## 남은 확장 포인트

- tool별 output parser 정교화
- session profile 준비 상태를 더 명확히 진단하는 doctor 명령
