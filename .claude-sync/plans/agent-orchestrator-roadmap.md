# Agent Orchestrator Roadmap

이 계획은 계정 제한 우회 도구가 아니라, 여러 정상 인증 에이전트가 작업 상태를 안전하게 이어받게 하는 오케스트레이터를 만들기 위한 로드맵이다.

## Phase 0 — 프로젝트 운영 골격

- [x] `AGENTS.md` 공통 규칙 작성
- [x] `CLAUDE.md` Claude Code 호환 규칙 작성
- [x] `.editorconfig`, `.gitattributes`, `.gitignore` 작성
- [x] `.claude-sync` memory/plan 구조 작성
- [x] git hook 기반 sync 스크립트 작성
- [x] sync 환경 점검 doctor CLI 작성
- [x] 진행률/다음작업/report CLI 초안 작성

## Phase 1 — 안전 정책과 handoff

- [x] `approval-policy.yaml` allow/hold 정책 확정
- [x] `workers.example.yaml` worker registry 예시 확정
- [ ] `NEXT_TASK.md` 템플릿 확정
- [ ] `RUN_STATUS.md` 템플릿 확정
- [ ] `DECISIONS_REQUIRED.md` 템플릿 확정
- [ ] 작업 종료 시 memory/plan/handoff 갱신 규칙 정리

## Phase 2 — CLI MVP

- [ ] `agent-next`가 우선순위/의존성/보류 상태를 반영하도록 개선
- [ ] `agent-progress`가 phase별 진행률을 출력하도록 개선
- [ ] `agent-report`가 project_state까지 갱신하도록 개선
- [ ] 안전 작업/보류 작업을 분류하는 dry-run 명령 추가
- [ ] worker별 프롬프트 템플릿 생성 명령 추가

## Phase 3 — Worker 어댑터

- [ ] Codex 작업 프롬프트 생성 어댑터
- [ ] Claude Code 작업 프롬프트 생성 어댑터
- [ ] Cursor 작업 프롬프트 생성 어댑터
- [ ] 실패/중단/quota 감지 상태 모델 정의
- [ ] worker가 직접 실행할 수 없는 경우 handoff만 남기는 fallback 구현

## Phase 4 — Dashboard

- [ ] 로컬 웹 대시보드 기술 선택
- [ ] 진행률/다음 작업/보류 결정 화면
- [ ] worker 상태 화면
- [ ] handoff viewer
- [ ] 승인 필요 큐 화면

## Phase 5 — 자동화 연동

- [ ] OS 작업 스케줄러 또는 Codex automation 연동 방식 정리
- [ ] 주기적 `agent-next` 실행
- [ ] 보류 결정 알림 방식 정리
- [ ] git sync 상태 점검 자동화

## Phase 6 — 제품화

- [ ] 설치 가이드
- [ ] 보안 모델 문서화
- [ ] plugin/MCP 확장 전략
- [ ] 테스트 시나리오
- [ ] 첫 릴리즈 태그
