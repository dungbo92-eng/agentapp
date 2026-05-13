#!/usr/bin/env node

/**
 * 이미 빌드된 dist-desktop 산출물을 현재 package.json version 의 git
 * tag 로 GitHub release 에 업로드만 수행. release-create 단계가 분리돼서
 * 재빌드 없이 (gh auth 이후) 안전하게 재시도 가능.
 *
 * Usage:
 *   node scripts/desktop-publish.mjs [--notes "release notes"]
 *
 * 전제:
 *   - 현재 commit 에 vX.Y.Z tag 가 이미 push 되어 있어야 함.
 *   - dist-desktop 아래 AgentApp-Setup-X.Y.Z-x64.exe + blockmap + latest.yml 존재.
 *   - gh CLI 설치 + 인증됨 (gh auth login).
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  return new Promise((resolve, reject) => {
    // command 가 .exe / 절대 경로면 shell 우회하고 직접 실행 (Node spawn 이
    // 알아서 quoting 처리). .cmd / .bat 처럼 shell 가 필요한 경우에만 shell:true.
    const isWin = process.platform === "win32";
    const needsShell = isWin && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: needsShell,
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

function parseArgs(argv) {
  const args = { notes: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--notes" && argv[i + 1]) {
      args.notes = String(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const version = pkg.version;
  const tag = `v${version}`;
  const installer = path.join(REPO_ROOT, "dist-desktop", `AgentApp-Setup-${version}-x64.exe`);
  const blockmap = `${installer}.blockmap`;
  const latestYml = path.join(REPO_ROOT, "dist-desktop", "latest.yml");
  const assets = [installer, blockmap, latestYml].filter((file) => existsSync(file));

  if (assets.length === 0) {
    console.error(`[publish] 산출물을 찾지 못했습니다. 먼저 'pnpm desktop:installer' 로 빌드하세요.`);
    process.exit(1);
  }

  const notes = args.notes || `AgentApp ${tag}\n\n자동 빌드 릴리스.`;
  const ghPath = existsSync("C:\\Program Files\\GitHub CLI\\gh.exe")
    ? "C:\\Program Files\\GitHub CLI\\gh.exe"
    : "gh";

  console.log(`[publish] uploading ${assets.length} files to ${tag}…`);
  await run(ghPath, [
    "release",
    "create",
    tag,
    ...assets,
    "--title",
    `AgentApp ${tag}`,
    "--notes",
    notes,
  ]);
  console.log(`[publish] done — https://github.com/dungbo92-eng/agentapp/releases/tag/${tag}`);
}

await main().catch((error) => {
  console.error(`[publish] failed: ${error.message}`);
  process.exit(1);
});
