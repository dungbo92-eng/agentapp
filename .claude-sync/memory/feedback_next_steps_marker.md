---
name: 다음 작업 마커 규칙 ([NEXT_STEPS] / [NEXT_NONE])
description: worker 가 작업을 끝낼 때 응답 마지막에 다음 작업 후보를 출력하는 일관된 마커 형식. dashboard 의 autoChain 이 이 마커를 파싱해 다음 진행 prompt 를 만든다.
type: feedback
originSessionId: dcf4e48f-61d0-4d33-bc0b-25105b5227f7
---
worker 는 응답의 **맨 마지막**에 다음 두 마커 중 하나를 출력한다. dashboard 가 startRun 시점에 worker prompt 끝에 자동으로 규칙을 첨부하므로(decorateAutoChainPrompt), worker 가 별도 안내를 받지 않아도 적용된다.

다음 작업이 있을 때:
```
[NEXT_STEPS]
- title: <간결한 작업 제목>
  priority: P0|P1|P2  (P0=최우선)
  notes: <한 줄 설명>
- title: <다음 후보>
  priority: P1
  notes: ...
[/NEXT_STEPS]
```

다음 작업이 정말 없을 때 (roadmap 완료 / 사용자 결정 대기 / 자율 진행 불가):
```
[NEXT_NONE] <이유 한 줄>
```

Why:
- 기존 흐름은 worker 가 NEXT_TASK.md 를 갱신하지 않으면 dashboard 가 generic_continuation 으로 같은 자리를 도는 패턴이 있었음.
- CHAIN_DONE 신호도 자주 오용되어 "한 단계 끝남" 과 "전체 끝남" 을 구분 못 하는 사례가 있었음.
- 마커 두 개로 명확히 구분: "다음 후보가 있다" vs "정말 끝났다".

How to apply:
- worker 입장: 모든 작업 완료/중단 시 위 마커 중 하나를 응답 끝에 출력. NEXT_STEPS 항목은 P0=즉시 진행할 작업, P1=중요하지만 다음 cycle, P2=백로그 후보.
- dashboard 입장: tryAutoChain 이 parseNextSteps() 로 마커를 우선 처리. NEXT_NONE → 즉시 stop, NEXT_STEPS → P0 항목을 다음 prompt 의 basePrompt 로 사용 (NEXT_TASK.md 갱신 여부 무관).
- 우선순위: NEXT_STEPS marker > CHAIN_DONE override > NEXT_TASK.md > generic_continuation.
- 마커가 없으면 기존 흐름 (NEXT_TASK.md / generic_continuation) 으로 backward compatible.
