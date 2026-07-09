#!/usr/bin/env node

// RC(모바일 LAN) 자동 활성화 로직 검증. 임시 데이터 dir 로 실제 런타임을 건드리지 않는다.
// AGENTAPP_DATA_DIR 를 import 전에 설정해야 dashboard-runtime 의 DATA_DIR 가 temp 를 쓴다.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "agentapp-autorc-"));
process.env.AGENTAPP_DATA_DIR = dir;
const rt = await import("./dashboard-runtime.mjs");

let failures = 0;
const check = (name, cond) => {
  if (cond) console.log(`[validate-auto-rc] ok ${name}`);
  else { console.error(`[validate-auto-rc] FAIL ${name}`); failures += 1; }
};

try {
  const s0 = await rt.getRuntimeSettings();
  check("autoRcOnSession default true", s0.autoRcOnSession === true);

  // 토큰이 없으면 생성·영속, 두 번째 호출은 같은 토큰 (lanAccessEnabled=false 여도 동작)
  const t1 = await rt.ensureLanAccessToken();
  check("ensureLanAccessToken generates valid token", /^[A-Za-z0-9_-]{16,64}$/.test(t1));
  const t2 = await rt.ensureLanAccessToken();
  check("ensureLanAccessToken stable", t1 === t2);
  const s1 = await rt.getRuntimeSettings();
  check("token persisted", s1.lanAccessToken === t1);

  // 등록된 Claude 계정이 없으면 ready 세션 없음 → auto-rc 발동 안 함
  check("hasReadyClaudeSession false when no accounts", (await rt.hasReadyClaudeSession()) === false);

  // autoRcOnSession 토글 저장/정규화
  await rt.updateRuntimeSettings({ autoRcOnSession: false });
  check("autoRcOnSession persists false", (await rt.getRuntimeSettings()).autoRcOnSession === false);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log(`[validate-auto-rc] done (${failures} failure(s))`);
if (failures > 0) process.exit(1);
