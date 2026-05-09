#!/usr/bin/env node
/**
 * Install native git hooks without external dependencies.
 */

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS_DIR = path.join(REPO_ROOT, ".git", "hooks");

if (!existsSync(path.join(REPO_ROOT, ".git"))) {
  console.log("[install-hooks] .git not found; skip. Run again after git init.");
  process.exit(0);
}

const PRE_COMMIT = `#!/bin/sh
# Sync local Claude memory/plans into repo, then stage updated sync files.
node "$(git rev-parse --show-toplevel)/scripts/claude-sync.mjs" --push --quiet-on-noop || exit 1
git add .claude-sync tools/agent-orchestrator/handoff 2>/dev/null || true
`;

const POST_MERGE = `#!/bin/sh
# After pull/merge, copy fresh shared memory/plans into local Claude.
node "$(git rev-parse --show-toplevel)/scripts/claude-sync.mjs" --pull --quiet-on-noop || true
`;

const POST_CHECKOUT = `#!/bin/sh
# After branch switch, re-pull shared memory/plans for that branch.
[ "$3" = "1" ] && node "$(git rev-parse --show-toplevel)/scripts/claude-sync.mjs" --pull --quiet-on-noop || true
`;

async function writeHook(name, body) {
  const target = path.join(HOOKS_DIR, name);
  await mkdir(HOOKS_DIR, { recursive: true });
  await writeFile(target, body, "utf8");
  try {
    await chmod(target, 0o755);
  } catch {
    // Windows can ignore chmod.
  }
  console.log(`[install-hooks] installed ${name}`);
}

await writeHook("pre-commit", PRE_COMMIT);
await writeHook("post-merge", POST_MERGE);
await writeHook("post-checkout", POST_CHECKOUT);
console.log("[install-hooks] done.");
