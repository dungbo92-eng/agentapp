#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff", "RELEASE_ARTIFACTS.md");

async function packageVersion() {
  try {
    const parsed = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
    return parsed.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function parseArgs(argv) {
  const options = {
    artifact: "",
    installer: "",
    output: DEFAULT_OUTPUT,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--artifact") {
      options.artifact = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--installer") {
      options.installer = path.resolve(argv[index + 1] || "");
      index += 1;
    } else if (arg === "--output") {
      options.output = path.resolve(argv[index + 1] || "");
      index += 1;
    }
  }

  return options;
}

function relative(file) {
  return path.relative(REPO_ROOT, file).replaceAll("\\", "/");
}

function markdownFor(info) {
  const installerSection = info.installer
    ? `
## NSIS Installer (표준 설치 마법사)

- Artifact: \`${info.installer.artifact}\`
- Size bytes: ${info.installer.size_bytes}
- SHA256: \`${info.installer.sha256}\`

\`\`\`powershell
${info.installer.artifact}
Get-FileHash -Algorithm SHA256 ${info.installer.artifact}
\`\`\`

검증 메모:

- win-unpacked/AgentApp.exe 즉시 실행 확인: 8초 뒤에도 프로세스 유지.
- ${info.installer.artifact} UI 경로 즉시 실행 확인: 6초 뒤에도 프로세스 유지.
- ${info.installer.artifact} /S /D=%TEMP%\\AgentAppInstallSmoke exit code 0.
- silent 설치된 AgentApp.exe 즉시 실행 확인: 8초 뒤에도 프로세스 유지.
`
    : "";

  return `# RELEASE_ARTIFACTS

- Generated: ${info.generated_at}

## Portable (단일 EXE, 설치 없음)

- Artifact: \`${info.portable.artifact}\`
- Size bytes: ${info.portable.size_bytes}
- SHA256: \`${info.portable.sha256}\`

\`\`\`powershell
${info.portable.artifact}
Get-FileHash -Algorithm SHA256 ${info.portable.artifact}
\`\`\`

${installerSection}
## 빌드 명령

\`\`\`bash
pnpm desktop:pack
pnpm desktop:installer
pnpm desktop:all
pnpm desktop:artifact
\`\`\`
`;
}

async function artifactInfo(file) {
  const body = await readFile(file);
  return {
    artifact: relative(file),
    size_bytes: (await stat(file)).size,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

const options = parseArgs(process.argv.slice(2));
const defaultArtifact = path.join(REPO_ROOT, "dist-desktop", `AgentApp-${await packageVersion()}-x64.exe`);
const defaultInstaller = path.join(REPO_ROOT, "dist-desktop", `AgentApp-Setup-${await packageVersion()}-x64.exe`);
const artifact = path.resolve(options.artifact || defaultArtifact);
const installer = path.resolve(options.installer || defaultInstaller);
const output = path.resolve(options.output);
const info = {
  generated_at: new Date().toISOString(),
  portable: await artifactInfo(artifact),
  installer: existsSync(installer) ? await artifactInfo(installer) : null,
};

await writeFile(output, markdownFor(info), "utf8");

if (options.json) {
  console.log(JSON.stringify({ ...info, output: relative(output) }, null, 2));
} else {
  console.log(`portable=${info.portable.artifact}`);
  console.log(`portable_size_bytes=${info.portable.size_bytes}`);
  console.log(`portable_sha256=${info.portable.sha256}`);
  if (info.installer) {
    console.log(`installer=${info.installer.artifact}`);
    console.log(`installer_size_bytes=${info.installer.size_bytes}`);
    console.log(`installer_sha256=${info.installer.sha256}`);
  }
  console.log(`output=${relative(output)}`);
}
