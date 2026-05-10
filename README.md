# AgentApp

여러 AI 개발 에이전트가 같은 프로젝트 상태를 읽고, 안전한 작업은 이어서 진행하며, 의사결정이 필요한 작업만 사용자에게 넘기기 위한 에이전트 오케스트레이터 앱입니다.

이 저장소의 1차 목표는 계정 제한을 우회하는 자동 계정 전환이 아니라, 정상 인증된 에이전트/도구들이 같은 memory, plan, handoff 문서를 기준으로 작업을 이어받는 안전한 운영 체계를 만드는 것입니다.

## 핵심 구성

| 경로 | 역할 |
|---|---|
| `AGENTS.md` | Codex/Gemini/기타 MCP 에이전트 공통 규칙 |
| `CLAUDE.md` | Claude Code 자동 로드용 규칙 |
| `.claude-sync/memory` | 현재 상태, 사용자 선호, 장기 메모리 |
| `.claude-sync/plans` | 로드맵/큰 계획 |
| `docs/handoff-completion-protocol.md` | 작업 완료/중단 시 갱신 규칙 |
| `docs/usage-budget-model-routing.md` | 주간 사용량 예산과 모델 선택 방향 |
| `docs/security-model.md` | 비밀값, 계정, 자동화, git/외부 쓰기 보안 경계 |
| `tools/agent-orchestrator` | worker, 승인 정책, handoff 문서 |
| `scripts/claude-sync.mjs` | repo `.claude-sync` ↔ 로컬 `~/.claude` 동기화 |
| `scripts/agent-next.mjs` | 다음 작업 선정 및 프롬프트 생성 |
| `scripts/agent-progress.mjs` | 계획 체크박스 기준 진행률 계산 |

## 새 PC 시작

```bash
git clone <repo-url> agentApp
cd agentApp
pnpm install
pnpm agent:doctor
pnpm agent:status
pnpm agent:next
```

자세한 설치/새 프로젝트 등록 절차는 `docs/installation-guide.md`를 따른다.

## 자주 쓰는 명령

```bash
pnpm agent:sync      # repo와 로컬 Claude memory/plan mtime 기준 동기화
pnpm agent:status    # 동기화 차이 확인
pnpm agent:budget    # 주말 예비분을 고려한 오늘 사용량 예산 계산
pnpm agent:dry-run -- --operation "pnpm validate"
pnpm agent:fallback -- --worker codex --summary "현재 환경에서 직접 실행 불가"
pnpm agent:codex-prompt -- --write
pnpm agent:claude-prompt -- --write
pnpm agent:cursor-prompt -- --write
pnpm agent:prompt -- --all --write
pnpm agent:doctor    # git/hooks/Claude sync 환경 점검
pnpm agent:next      # 다음 에이전트 작업 프롬프트 생성
pnpm agent:progress  # 전체/phase별 로드맵 진행률 계산
pnpm agent:scheduled-check # 자동화용 read-only 상태 점검
pnpm agent:route -- --task "Docker 설치 방법 정리"
pnpm agent:route -- --task "자동매매 로직 설계" --complexity complex
pnpm agent:report -- "작업 요약"
pnpm agent:report -- --status completed --summary "작업 요약" --verify "pnpm validate"
pnpm dashboard:prepare # 로컬 대시보드 snapshot 생성
pnpm dashboard:dev     # 로컬 대시보드 개발 서버
pnpm validate        # 로컬 스크립트 문법 검증
```

## 안전 원칙

- 플랫폼 제한 우회, 자동 계정 로그인, 무조건 승인 클릭 자동화는 만들지 않는다.
- 정상 로그인된 도구/에이전트가 가능한 범위에서 작업을 이어받는다.
- 주간 사용량은 사용자가 보유한 정상 계정의 남은 예산을 계획적으로 배분하는 용도로만 관리한다.
- 모델 선택은 품질 우선이며, 단순 작업은 효율 모델, 복잡한 설계/추론은 최고 품질 모델을 추천한다.
- 개발 구현, 문서화, 테스트, 로컬 검증, handoff 갱신, commit/push는 추가 확인 없이 이어간다.
- 코드 수정, 테스트, 문서화, 로컬 실행은 자동 진행 가능하다.
- 외부 운영계 쓰기, 결제, 배포, 비밀값 변경, 파괴적 파일/DB 작업은 사용자 승인을 요구한다.
- 검증된 변경은 로컬 git commit으로 남긴다.
- remote push는 remote가 설정되고 사용자 승인 범위가 명확할 때 수행한다.

## 프로젝트별 기본 동기화

AgentApp이 관리하는 각 프로젝트는 공통 memory, plan, handoff, git sync 기준을 기본 운영 골격으로 가진다. 새 프로젝트를 등록할 때는 기능 개발보다 먼저 이 기준을 갖춘다. 세부 기준은 `docs/project-baseline-sync.md`를 따른다.

자동화 연동 기준은 `docs/automation-integration.md`에 둔다. 기본 자동화는 상태 점검과 handoff 갱신 중심이며, 실제 예약 생성은 사용자가 명시 요청할 때만 수행한다.

보안 모델은 `docs/security-model.md`를 따른다. 비밀값, 계정, MCP/connector, git remote, 외부 쓰기 경계는 이 문서와 `tools/agent-orchestrator/approval-policy.yaml`을 함께 기준으로 판단한다.

보류 결정 알림 기준은 `docs/decision-notifications.md`에 둔다. 기본 알림은 로컬 dashboard, scheduled check, handoff report에만 표시한다.
