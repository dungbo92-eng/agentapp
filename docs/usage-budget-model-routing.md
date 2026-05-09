# Usage Budget and Model Routing

AgentApp은 여러 정상 인증 AI 도구를 이어받게 하는 프로젝트다. 이 기능은 계정 제한을 우회하는 자동화가 아니라, 사용자가 보유한 Claude Pro, Codex Plus 같은 계정의 주간 사용량을 로컬에서 계획하고 작업 난이도에 맞는 모델을 추천하는 품질 중심 라우터다.

## 목표

- 프로젝트 품질을 최우선으로 둔다.
- 남은 주간 사용량을 평일, 토요일, 일요일까지 끊김 없이 배분한다.
- 계정 수가 Claude Pro 2개 + Codex Plus 2개인 경우와 Claude Pro 1개 + Codex Plus 1개인 경우를 모두 지원한다.
- 단순 숙지, 설치 안내, 문서 정리에는 중간급 모델/보통 추론을 사용해 예산을 아낀다.
- 자동매매 로직, AI 모델 연동, 아키텍처, 보안, 데이터 손실 가능 변경처럼 복잡한 작업에는 최고 품질 모델/높은 추론을 우선한다.
- 자동 로그인, 자동 계정 전환, 캡차/승인 우회, 제한 우회는 하지 않는다.

## 비목표

- 플랫폼의 주간 제한을 우회하지 않는다.
- 계정 비밀번호, 세션 쿠키, API key, 토큰을 저장하지 않는다.
- 숨겨진 사용량을 스크래핑하거나 보안 절차를 우회하지 않는다.
- 요금제 변경, 결제, 계정 생성, 자동 계정 전환은 하지 않는다.

## 입력 데이터

계정별 설정은 비밀값 없이 로컬 설정으로 관리한다.

```yaml
accounts:
  - id: claude-pro-1
    provider: claude
    plan: pro
    auth: user-managed
    weekly_budget_units: 100
    remaining_units: 64
    reset_day: monday
  - id: codex-plus-1
    provider: codex
    plan: plus
    auth: user-managed
    weekly_budget_units: 100
    remaining_units: 71
    reset_day: monday
```

`weekly_budget_units`는 실제 토큰 수가 아니라 상대 단위다. 플랫폼별 제한 정책이 바뀌어도 사용자가 현재 보이는 남은 사용량을 0-100 단위로 입력하면 같은 로직을 적용할 수 있다.

## 작업 등급

| 등급 | 예시 | 기본 모델 정책 |
|---|---|---|
| `routine` | 프로젝트 숙지, 파일 탐색, Docker 설치 방법, 단순 문서 정리 | Sonnet/보통, Codex 중간 추론 |
| `standard` | 일반 버그 수정, 작은 기능 구현, 테스트 보강 | Sonnet/높음 또는 Codex 높음 |
| `complex` | 자동매매 로직 설계, AI 모델 연동 설계, 아키텍처 결정, 보안 설계 | Opus/매우높음, Codex xhigh |
| `critical` | 데이터 손실 위험, 운영 장애, 대규모 리팩터, 결제/보안 영향 | 최고 품질 모델 우선, 필요 시 사용자 확인 |

## 품질 우선 규칙

1. 작업 위험도와 복잡도가 높으면 예산 절약보다 품질을 우선한다.
2. `complex` 이상은 남은 예산이 부족해도 중간 모델로 강등하지 않고, 작업 분해 또는 사용자 결정을 요청한다.
3. `routine` 작업은 고급 모델을 기본 사용하지 않는다.
4. 긴 작업은 탐색, 설계, 구현, 검증으로 쪼개고 각 단계에 맞는 모델을 선택한다.
5. 모델 선택 이유와 예상 예산 소모를 handoff에 남긴다.

## 주간 예산 배분

토요일, 일요일 작업이 끊기지 않게 주말 예비분을 둔다.

```text
available = sum(account.remaining_units)
days_to_reset = reset_day까지 남은 일수
weekend_reserve = expected_sat_sun_units
weekday_budget = max(0, available - weekend_reserve)
today_budget = weekday_budget / max(1, weekday_days_left)
```

계정 수가 많으면 같은 provider 안에서 사용량이 적게 남은 계정보다 여유 있는 계정을 우선 추천한다. 계정 수가 적으면 routine 작업을 더 강하게 절약 모드로 보내고, complex 작업은 큐에 남기거나 사용자에게 예산 사용 승인을 요청한다.

## 라우팅 로직 초안

```text
classify(task):
  complexity = routine | standard | complex | critical
  risk = low | medium | high
  context_size = small | medium | large
  deadline = normal | urgent

choose_model(task, accounts):
  if task.risk == high or task.complexity in [complex, critical]:
    candidate = best_quality_model(provider_pool)
  else if task.complexity == routine:
    candidate = efficient_model(provider_pool)
  else:
    candidate = balanced_model(provider_pool)

  if projected_usage(candidate) exceeds today_budget:
    if task.complexity == routine:
      downgrade_to_more_efficient_model()
    else:
      split_task_or_request_user_decision()

  reserve_weekend_budget()
  return recommendation(account_id, provider, model, reasoning_effort, why)
```

## 출력 예시

```yaml
recommendation:
  account_id: claude-pro-1
  provider: claude
  model_tier: sonnet
  reasoning_effort: normal
  reason: "프로젝트 숙지 작업이라 깊은 추론보다 예산 보존이 중요함."
  budget:
    estimated_units: 4
    weekend_reserve_after_run: 38
```

```yaml
recommendation:
  account_id: claude-pro-2
  provider: claude
  model_tier: opus
  reasoning_effort: very_high
  reason: "자동매매 로직 설계는 장기 품질과 리스크가 커서 최고 품질 모델을 우선함."
  budget:
    estimated_units: 18
    action_if_insufficient: "작업을 설계/검증 단계로 나누거나 사용자 결정 요청"
```

## 안전 동작

- AgentApp은 추천만 한다. 실제 계정 선택은 사용자가 정상 로그인된 세션에서 수행한다.
- 계정별 사용량은 수동 입력 또는 사용자가 명시 제공한 값만 사용한다.
- 사용량 부족 상태는 `DECISIONS_REQUIRED.md`에 남긴다.
- 자동 전환, 자동 로그인, 제한 우회성 병렬 실행은 금지한다.
