---
name: 계정 라우팅 정책 (회사 계정 / 정책 거절 / UI 일관성)
description: AgentApp 라우팅에서 회사 계정 우선 적용 범위, 정책 거절 처리 방향, UI 표시 모델과 실제 라우팅 일관성 규칙
type: feedback
originSessionId: dcf4e48f-61d0-4d33-bc0b-25105b5227f7
---
회사 계정(@hanilnetworks.com)이 조직 정책상 허용하는 작업: 오류분석, 검증행위, 프로세스 분석, 버그 수정, C#, T-SQL.
- 이 범위 작업만 회사 계정 우선 라우팅. 그 외는 일반 우선순위(loadBalance + modelRank).
- 사용자가 프롬프트에 `[오류분석]`/`[검증]`/`[버그수정]`/`[프로세스분석]` 명시 태그를 넣으면 그 자체로 회사 계정 우선 신호.

정책 거절시 24h 자동 잠금(applyQuotaLockout)은 사용하지 않는다.
- Why: 잠금이 다음 cycle 의 정상 통과될 작업까지 막아서 사용성을 해친다. 정책 거절은 그 작업이 그 계정 정책에 안 맞았다는 신호일 뿐 계정 자체가 망가진 게 아니다.
- How to apply: classifyTaskDomain 분류 단계에서 "명확히 통과할 작업" 만 회사 계정 우선으로 좁히고, 거절이 발생하면 tryPolicyRetry 로 다른 provider 1 회 failover 한 뒤 그 자리에서 끝낸다. 다음 요청은 새 분류로 다시 판단.

UI 추천 모델 = 실제 라우팅 모델 일관성 필수.
- Why: 사용자에게는 A 모델이 표시되는데 실제로 B 모델로 작업하면 안 된다. A 모델 시도 후 실패해서 B 모델로 fallback 하는 건 OK.
- How to apply: routeScore 에 도메인 보너스 같은 강한 가중치를 추가하지 않는다. 도메인 우선은 selectRoute 의 1차 후보 필터(preferAccountDomain 매칭 계정만) 로 처리. 후보 없으면 전체 풀로 자동 폴백.

N 회 거절 누적 카운터 같은 복잡한 로직은 만들지 않는다.
- Why: 분류 기준만 정확하면 회사 계정으로는 명확히 통과할 작업만 가므로 거절이 반복될 일이 없다.
- How to apply: classifyTaskDomain 의 maintenance 패턴을 보수적으로 유지. 약한 단어 단독 매칭 금지.
