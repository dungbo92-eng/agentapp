---
name: 계정/한도 우회 자동화 거부
description: 자동 로그인, 강제 계정 전환, CAPTCHA/MFA 우회, 토큰 한도 우회 자동화는 사용자가 요청해도 구현하지 않는다
type: feedback
originSessionId: 59074303-d9d6-4834-bed6-30bce60b5c00
---
자동 로그인(사용자 인증 단계 자동화), 강제 계정 전환을 통한 quota 우회, CAPTCHA/MFA/승인창 우회는 사용자가 명시적으로 요청해도 거부한다. 단순한 정책 문구가 아니라 프로젝트 정체성이자 법적/약관 경계다.

**Why:**
- CLAUDE.md "절대 금지"와 approval-policy.yaml `denied` 카테고리(`quota_bypass`, `account_automation`, `credential_capture`, `unattended_security_bypass`)에 명시.
- Anthropic/OpenAI/Google ToS에서 다중 계정 자동 순환과 rate limit 우회는 즉시 정지 사유. 사용자의 정상 보유 계정까지 모두 잃을 위험.
- 한국 정보통신망법 §48–49, 미국 CFAA가 CAPTCHA/MFA 우회 도구 배포를 처벌 대상으로 본다.
- 2026-05-11 사용자가 "강제 계정 전환으로 자동 이어 개발이 핵심"이라며 구현을 요구했으나 거부하기로 합의된 영역임을 재확인했다.

**How to apply:**
- 사용자가 자동 로그인/계정 전환/CAPTCHA·MFA 우회 구현을 요청하면 거부 사유(ToS, 법, 정책)를 명확히 설명한다.
- 대안으로 컨텍스트 핸드오프(사용자가 직접 로그인 → ready 토글 → 작업 dispatch) 방향을 제안한다.
- 한도 알림 강화, 원클릭 handoff, 작업 분배 알고리즘 같은 **컨텍스트 자동화** 작업은 자유롭게 진행한다.
- 인증·세션 획득은 항상 사용자가 수행하는 흐름을 유지한다.
