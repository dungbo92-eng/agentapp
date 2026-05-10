# Session Profile Routing

AgentApp은 여러 AI 계정을 하나의 브라우저 세션에 억지로 섞지 않는다. 계정마다 독립된 session profile을 두고, dashboard는 그중 `enabled=true`이고 `sessionStatus=ready`인 profile만 작업 후보로 사용한다.

## 계정 예시

사용자가 아래 계정을 가진 경우:

- Codex: `dunbo92@gmail.com`
- Claude: `dunbo92@gmail.com`
- Codex: `dungdy92@gmail.com`
- Claude: `dungdy92@gmail.com`

AgentApp은 기본적으로 다음처럼 서로 다른 profile descriptor를 만든다.

```text
codex/dunbo92-gmail-com
claude/dunbo92-gmail-com
codex/dungdy92-gmail-com
claude/dungdy92-gmail-com
```

이 descriptor는 “어떤 도구의 어떤 로컬 세션을 써야 하는지”를 가리키는 이름이다. 실제 세션은 사용자가 공식 앱, CLI, 또는 분리된 브라우저 프로필에서 정상 로그인해 준비한다.

## 자동 선택 기준

Start 실행 시 runtime은 아래 순서로 후보를 좁힌다.

1. 선택한 worker와 맞는 provider만 남긴다.
2. enable이 꺼진 계정을 제외한다.
3. `ready`가 아닌 session profile을 제외한다.
4. 작업 난이도와 남은 로컬 예산 단위에 맞는 model profile을 고른다.
5. 사용자가 model override를 고른 경우 추천 모델 대신 override 값을 run state에 기록한다.

routine 작업은 효율 모델을 우선하고, complex/critical 작업은 품질 우선 모델을 고른다. 주말 예비분을 남기는 예산 정책은 `docs/usage-budget-model-routing.md`를 따른다.

## Credential Vault

password/API key가 필요한 계정은 dashboard에서 입력할 수 있다. 값은 repo에 저장하지 않고 Windows DPAPI로 암호화한 local vault에 저장한다.

- 저장 위치: `data/credential-vault.json` 또는 desktop 앱 `userData/data/credential-vault.json`
- runtime 저장값: `credentialRef`, `credentialStatus`
- 금지: plaintext secret, session cookie, OAuth token, captcha/MFA 정보 저장

worker adapter는 필요한 경우 credential reference만 보고 vault를 조회한다. 복호화된 값은 로그, handoff, memory, snapshot에 남기지 않는다.

## 제한선

AgentApp이 자동으로 할 수 있는 일:

- ready session profile 중 작업에 맞는 profile 선택
- 로컬 예산 차감과 run state 기록
- handoff와 dashboard 실행 로그 갱신

AgentApp이 하지 않는 일:

- captcha, MFA, OAuth consent, 승인창 자동 클릭
- 플랫폼 제한 회피 목적의 강제 계정 전환
- session cookie 저장 또는 복제
- 결제, 요금제, quota 변경

세션이 만료되었거나 보안 확인이 필요하면 해당 계정은 `needs-login`으로 두고 사용자가 공식 경로에서 다시 로그인한 뒤 `Ready`로 바꾼다.
