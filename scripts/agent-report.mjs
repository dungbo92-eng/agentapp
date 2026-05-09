#!/usr/bin/env node

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HANDOFF_DIR = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff");
const RUN_STATUS = path.join(HANDOFF_DIR, "RUN_STATUS.md");

const message = process.argv.slice(2).join(" ").trim();

if (!message) {
  console.error('usage: pnpm agent:report -- "작업 요약"');
  process.exit(1);
}

await mkdir(HANDOFF_DIR, { recursive: true });
await appendFile(RUN_STATUS, `\n## ${new Date().toISOString()}\n\n${message}\n`, "utf8");
console.log(`reported=${RUN_STATUS}`);
