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

// Windows 에서 gh.exe 가 PATH 에 없으면 알려진 설치 경로를 직접 찾아 사용한다.
// (winget install GitHub.cli 결과가 PATH 에 자동 추가되지 않는 환경에서
// 자동 릴리즈 사이클이 막히는 걸 막기 위함.)
function resolveGhCommand() {
  if (process.platform !== "win32") return "gh";
  const candidates = [
    process.env.AGENTAPP_GH_COMMAND,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "GitHub CLI", "gh.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "GitHub CLI", "gh.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "GitHub CLI", "gh.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "GitHubCLI", "gh.exe"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "gh";
}

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

// Windows shim 도구 (pnpm/npm/npx/yarn) 는 PATH 의 .CMD 파일이라 spawn 이
// 직접 실행 못 한다. PATH 를 훑어 절대 .cmd/.exe 경로로 변환해서 spawn 에
// 넘기면 shell:true 의 quoting 위험 없이 직접 실행할 수 있다.
function resolveCommandOnWindows(command) {
  if (process.platform !== "win32") return command;
  if (path.isAbsolute(command) || command.includes(path.sep)) return command;
  if (/\.(exe|cmd|bat)$/i.test(command)) return command;
  const pathEnv = process.env.PATH || process.env.Path || "";
  const pathExt = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const dirs = pathEnv.split(";").filter(Boolean);
  for (const dir of dirs) {
    for (const ext of pathExt) {
      const candidate = path.join(dir, command + ext);
      if (existsSync(candidate)) return candidate;
    }
    // 확장자가 이미 붙은 경우 (드물지만 안전망)
    const bare = path.join(dir, command);
    if (existsSync(bare) && /\.(exe|cmd|bat)$/i.test(bare)) return bare;
  }
  return command;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const resolved = resolveCommandOnWindows(command);
    // .cmd / .bat 은 cmd.exe 로 실행돼야 하므로 shell:true.
    // .exe / 절대 .exe 경로면 spawn 직접 실행 (quoting 안전).
    const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved);
    // shell:true 면 command 가 cmd.exe 에 그대로 전달되는데 공백 포함 경로
    // ("C:\Program Files\...") 가 따옴표 없이 들어가면 cmd 가 첫 토큰을 잘못
    // 해석한다. 그래서 공백이 있으면 큰따옴표로 감싼다.
    const finalCommand = needsShell && /\s/.test(resolved) && !/^".*"$/.test(resolved)
      ? `"${resolved}"`
      : resolved;
    const child = spawn(finalCommand, args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: needsShell,
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
    const ghCommand = resolveGhCommand();
    await run(ghCommand, [
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
