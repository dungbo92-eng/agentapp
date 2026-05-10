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
- [x] `NEXT_TASK.md` 템플릿 확정
- [x] `RUN_STATUS.md` 템플릿 확정
- [x] `DECISIONS_REQUIRED.md` 템플릿 확정
- [x] 작업 종료 시 memory/plan/handoff 갱신 규칙 정리

## Phase 2 — CLI MVP

- [x] `agent-next`가 우선순위/의존성/보류 상태를 반영하도록 개선
- [x] `agent-progress`가 phase별 진행률을 출력하도록 개선
- [x] `agent-report`가 project_state까지 갱신하도록 개선
- [x] 안전 작업/보류 작업을 분류하는 dry-run 명령 추가
- [x] worker별 프롬프트 템플릿 생성 명령 추가

## Phase 3 — Worker 어댑터

- [x] Codex 작업 프롬프트 생성 어댑터
- [x] Claude Code 작업 프롬프트 생성 어댑터
- [x] Cursor 작업 프롬프트 생성 어댑터
- [x] 실패/중단/quota 감지 상태 모델 정의
- [x] worker가 직접 실행할 수 없는 경우 handoff만 남기는 fallback 구현

## Phase 4 — 주간 사용량 예산과 모델 라우팅

- [x] 계정 수/요금제/남은 주간 사용량을 비밀값 없이 기록하는 설정 스키마 작성
- [x] 토요일/일요일 예비 사용량을 남기는 주간 예산 계산 로직 구현
- [x] 작업 난이도(`routine`, `standard`, `complex`, `critical`) 분류 규칙 구현
- [x] 품질 우선 모델 선택 로직 구현
- [x] 사용량 부족 시 작업 분해 또는 사용자 결정 요청 handoff 구현

## Phase 5 — Dashboard

- [x] 로컬 웹 대시보드 기술 선택
- [x] 진행률/다음 작업/보류 결정 화면
- [x] worker 상태 화면
- [x] handoff viewer
- [x] 승인 필요 큐 화면
- [x] 주간 사용량/주말 예비분/모델 추천 화면

## Phase 6 — 자동화 연동

- [x] OS 작업 스케줄러 또는 Codex automation 연동 방식 정리
- [x] 주기적 `agent-next` 실행
- [x] 보류 결정 알림 방식 정리
- [x] git sync 상태 점검 자동화

## Phase 7 — 제품화

- [x] 설치 가이드
- [x] 보안 모델 문서화
- [x] plugin/MCP 확장 전략
- [x] 테스트 시나리오
- [x] 첫 릴리즈 태그

## Phase 8 — 통합 에이전트 UX

- [x] Codex 스타일 dashboard control surface MVP
- [x] dashboard local execution API
- [x] 프로젝트 registry local-only 저장소
- [x] 계정 예산 편집 local-only 저장소
- [x] 계정 enable/disable 토글과 라우팅 제외
- [x] 계정 session ready/login 상태와 동적 계정 수 관리
- [x] Start/Stop과 worker process/handoff 연동
- [x] Windows exe packaging

## Phase 9 — 사용성 강화

- [x] 동적 계정 추가 UX와 provider/login method/session profile 입력
- [x] Windows DPAPI local credential vault
- [x] 모델 override와 Start/Stop 실행 로그
- [x] release artifact checksum과 실행 가이드 정리

## Phase 10 — Worker 실행 어댑터

- [x] worker별 session profile launch adapter
- [x] Codex/Claude/Cursor/Gemini 실행 로그 수집
- [x] 세션 만료 감지 시 needs-login handoff
- [x] validation 결과를 dashboard active run에 연결

## Phase 11 — Tool별 확장

- [ ] Claude Code command-mode adapter profile
- [ ] Gemini CLI command-mode adapter profile
- [ ] tool별 login/session-expired detector 보강
- [ ] doctor에 session profile readiness 진단 추가
