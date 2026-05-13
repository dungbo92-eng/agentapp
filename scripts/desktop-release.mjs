#!/usr/bin/env node

/**
 * AgentApp 데스크탑 배포 자동화 스크립트.
 *
 * Usage:
 *   node scripts/desktop-release.mjs [--bump patch|minor|major] [--notes "release notes"]
 *
 * 동작:
 *   1. package.json 의 version 을 bump (--bump 옵션, 기본 patch).
 *   2. pnpm desktop:installer 실행 (NSIS installer + latest.yml + blockmap 생성).
 *   3. git commit 'chore: release vX.Y.Z' + tag vX.Y.Z + push (tag 포함).
 *   4. gh release create / gh release upload 로 dist-desktop/ 산출물 업로드.
 *
 * 전제 조건:
 *   - GitHub CLI (gh) 설치 + 인증됨 (`gh auth status`).
 *   - 현재 브랜치가 main 이고 working tree clean (autobump 외 변경 없음).
 *
 * 결과:
 *   - GitHub release 에 -Setup-X.Y.Z.exe + latest.yml 업로드.
 *   - 사용자 앱이 다음 실행 시 electron-updater 로 자동 감지 → 다운로드 → 종료 시 적용.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG_FILE = path.join(REPO_ROOT, "package.json");

function parseArgs(argv) {
  const args = { bump: "patch", notes: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--bump" && val) {
      args.bump = String(val).toLowerCase();
      i += 1;
    } else if (key === "--notes" && val) {
      args.notes = String(val);
      i += 1;
    }
  }
  return args;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function bumpVersion(current, kind) {
  const parts = String(current || "0.0.0").split(".").map((piece) => Number(piece) || 0);
  while (parts.length < 3) parts.push(0);
  if (kind === "major") return `${parts[0] + 1}.0.0`;
  if (kind === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkgRaw = await readFile(PKG_FILE, "utf8");
  const pkg = JSON.parse(pkgRaw);
  const oldVersion = pkg.version;
  const newVersion = bumpVersion(oldVersion, args.bump);
  pkg.version = newVersion;
  await writeFile(PKG_FILE, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(`[release] ${oldVersion} -> ${newVersion}`);

  try {
    // 1) 빌드
    await run("pnpm", ["desktop:installer"]);

    // 2) git commit + tag
    await run("git", ["add", "package.json"]);
    await run("git", ["commit", "-m", `chore: release v${newVersion}`]);
    await run("git", ["tag", `v${newVersion}`]);
    await run("git", ["push", "origin", "HEAD"]);
    await run("git", ["push", "origin", `v${newVersion}`]);

    // 3) gh release 생성 + 자산 업로드
    const installer = path.join(REPO_ROOT, "dist-desktop", `AgentApp-Setup-${newVersion}-x64.exe`);
    const blockmap = `${installer}.blockmap`;
    const latestYml = path.join(REPO_ROOT, "dist-desktop", "latest.yml");
    const assets = [installer, blockmap, latestYml].filter((file) => existsSync(file));
    if (assets.length === 0) {
      throw new Error("배포할 산출물을 찾지 못했습니다. dist-desktop 디렉터리를 확인하세요.");
    }

    const notes = args.notes || `AgentApp v${newVersion}\n\n자동 빌드 릴리스.`;
    await run("gh", [
      "release",
      "create",
      `v${newVersion}`,
      ...assets,
      "--title",
      `AgentApp v${newVersion}`,
      "--notes",
      notes,
    ]);

    console.log(`[release] done — v${newVersion} published.`);
  } catch (error) {
    // 실패 시 version 롤백 (이미 commit 됐다면 별도 처리 필요).
    pkg.version = oldVersion;
    await writeFile(PKG_FILE, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    console.error(`[release] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
