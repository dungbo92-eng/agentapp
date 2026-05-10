# Decision Notifications

AgentApp의 보류 결정 알림은 외부 메시지를 자동 발송하는 기능이 아니다. 목적은 `DECISIONS_REQUIRED.md`의 pending 항목을 사용자가 놓치지 않도록 로컬 화면, scheduled check, handoff report에 명확히 드러내는 것이다.

## 알림 단계

| Level | 조건 | 동작 |
|---|---|---|
| `clear` | pending decision 없음 | dashboard와 scheduled check에 정상 상태 표시 |
| `attention` | pending decision 1개 이상 | dashboard Approval Queue와 scheduled check 결과에 개수 표시 |
| `blocked` | next task가 pending decision에 막힘 | `NEXT_TASK.md`, `RUN_STATUS.md`, scheduled check에 차단 상태 표시 |

## 기본 노출 위치

- Dashboard `Approval Queue`
- `pnpm agent:scheduled-check`
- `tools/agent-orchestrator/handoff/RUN_STATUS.md`
- `tools/agent-orchestrator/handoff/NEXT_TASK.md`

## 금지 사항

- 사용자 명시 요청 없는 외부 메신저/이메일/API 발송
- 운영 시스템에 알림 이벤트 쓰기
- 계정명, 토큰, 쿠키, 결제 정보 포함
- 승인창, captcha, MFA 우회

## 추후 확장

외부 알림이 필요하면 `DECISIONS_REQUIRED.md`에 별도 decision을 만들고 사용자가 채널, 범위, 빈도, 포함할 정보를 명시해야 한다. 기본 구현은 로컬 표시와 handoff 기록만 수행한다.
