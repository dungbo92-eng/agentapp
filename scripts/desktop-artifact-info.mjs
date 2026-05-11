#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
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
  return `# RELEASE_ARTIFACTS

- Generated: ${info.generated_at}
- Artifact: ${info.artifact}
- Size bytes: ${info.size_bytes}
- SHA256: ${info.sha256}

## Run

\`\`\`powershell
${info.artifact}
\`\`\`

## Verify

\`\`\`powershell
Get-FileHash -Algorithm SHA256 ${info.artifact}
\`\`\`
`;
}

const options = parseArgs(process.argv.slice(2));
const defaultArtifact = path.join(REPO_ROOT, "dist-desktop", `AgentApp-${await packageVersion()}-x64.exe`);
const artifact = path.resolve(options.artifact || defaultArtifact);
const output = path.resolve(options.output);
const body = await readFile(artifact);
const info = {
  generated_at: new Date().toISOString(),
  artifact: relative(artifact),
  size_bytes: (await stat(artifact)).size,
  sha256: createHash("sha256").update(body).digest("hex"),
};

await writeFile(output, markdownFor(info), "utf8");

if (options.json) {
  console.log(JSON.stringify({ ...info, output: relative(output) }, null, 2));
} else {
  console.log(`artifact=${info.artifact}`);
  console.log(`size_bytes=${info.size_bytes}`);
  console.log(`sha256=${info.sha256}`);
  console.log(`output=${relative(output)}`);
}
