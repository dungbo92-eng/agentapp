# Ponytail 통합

출처: <https://github.com/DietrichGebert/ponytail> · MIT · 평가 버전 **v4.7.0** (2026-06)

## 무엇인가

에이전트가 코드를 짜기 전에 "정말 필요한가 → stdlib → 네이티브 → 기존 의존성 → 한 줄 → 최소 구현" 사다리를 거치게 하는 **코드 최소화 instruction 룰**. 출력(코드) 측 토큰을 줄인다. 핵심 룰 전문은 [`ponytail.rule.md`](ponytail.rule.md).

자체 벤치(실제 Claude Code 세션, FastAPI+React repo): LOC −54%, tokens −22%, cost −20%, time −27%, **safety 100% 유지**.

## 왜 안전 정책과 충돌하지 않나

Ponytail 룰은 명시적으로 **검증/에러처리/보안/접근성/명시 요청 사항은 최소화 대상에서 제외**한다("Lazy, not negligent"). AgentApp의 safety-first 원칙·`approval-policy.yaml`와 같은 방향이다. instruction-only라 secret·외부쓰기·바이너리 설치가 없어 **`auto_allowed`(local instruction)** 범위.

## 기존 토큰 최적화 프로토콜과의 관계

`CLAUDE.md`/`AGENTS.md`의 토큰 최적화 프로토콜은 **입력 프롬프트**를 명령서로 압축한다. Ponytail은 **출력 코드**를 최소화한다. 레이어가 달라 상호 보완이지만, 둘 다 "최소" 지향이라 **중복 강조**가 될 수 있다. 합의:

- 프롬프트 압축/모델 라우팅 = 기존 프로토콜 담당.
- 코드 산출 최소화 = Ponytail 담당.
- 같은 말을 두 번 주입하지 않도록, Ponytail 주입은 **코드 작성 작업(standard/complex)** 에서만 켠다.

## 주입 방식 (AgentApp 세션 프로필 경계)

Ponytail 공식 설치는 Claude/Codex 플러그인 마켓플레이스 + lifecycle 훅이다. 하지만 AgentApp의 headless 실행(`claude --print`, `codex exec`, `gemini -p`)과 세션 프로필 모델에는 **프롬프트 프리앰블 주입**이 가장 단순·안전하다(사용자 프로젝트 파일을 건드리지 않음, idempotent).

- AgentApp이 이미 `dashboard-runtime.mjs`의 `decorateAutoChainPrompt`로 STATUS/NEXT_STEPS 규칙을 프리앰블로 붙인다. Ponytail 룰도 같은 자리에 1회 추가한다.
- 모드: `off`(기본) / `lite`(한 줄 포인터) / `full`(룰 전문).
- 멱등성: `[PONYTAIL 규칙]` 마커로 중복 첨부를 막는다.

## dry-run

```bash
pnpm agent:ponytail            # full 모드 프리앰블 미리보기 (아무것도 쓰지 않음)
pnpm agent:ponytail -- --mode lite
```

스크립트: [`scripts/integrate-ponytail.mjs`](../../../../scripts/integrate-ponytail.mjs). 현재는 **프리앰블을 출력만** 한다. 실제 worker 프롬프트 주입은 `dashboard-runtime.mjs` 변경(데스크탑 트리거 경로 → 자동 릴리즈)이라 Phase 13에서 별도 적용.

## 제공 어댑터 (참고용으로 스테이징)

Ponytail repo는 에이전트별 어댑터를 그대로 제공한다: `.claude-plugin/`(플러그인+훅), `.codex-plugin/`, `.cursor/rules/ponytail.mdc`, `.agents/rules/ponytail.md`(범용, 여기 `ponytail.rule.md`), `.github/copilot-instructions.md`, `.openclaw/skills/ponytail-*`. 매니페스트 샘플: [`claude-plugin.json`](claude-plugin.json), [`codex-plugin.json`](codex-plugin.json).
