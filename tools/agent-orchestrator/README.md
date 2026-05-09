# Agent Orchestrator

여러 AI 개발 에이전트가 같은 작업 상태를 이어받기 위한 운영 디렉터리다.

## 파일

| 파일 | 역할 |
|---|---|
| `approval-policy.yaml` | 자동 진행 가능/사용자 승인 필요 기준 |
| `workers.example.yaml` | worker registry 예시 |
| `roadmap.yaml` | 기계가 읽기 쉬운 로드맵 초안 |
| `handoff/NEXT_TASK.md` | 다음 에이전트가 수행할 작업 |
| `handoff/RUN_STATUS.md` | 최근 실행 결과 |
| `handoff/DECISIONS_REQUIRED.md` | 사용자 결정 필요 항목 |

## 원칙

- 이 디렉터리는 계정 제한 우회용이 아니다.
- 각 worker는 사용자가 정상 인증한 도구/세션에서만 동작한다.
- 자동 실행은 `approval-policy.yaml`의 `auto_allowed` 범위로 제한한다.
- 위험하거나 불확실한 작업은 handoff/decision queue로 넘긴다.

## 환경 점검

새 PC나 새 에이전트 세션에서는 먼저 아래 명령으로 sync 환경을 확인한다.

```bash
pnpm agent:doctor
```

이 명령은 git hooks, `.claude-sync`, 로컬 `~/.claude` 경로, git UTF-8 설정, 현재 sync 상태를 점검한다.
