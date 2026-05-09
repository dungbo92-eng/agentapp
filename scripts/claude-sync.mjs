#!/usr/bin/env node
/**
 * Sync shared agent memory/plans between this repo and Claude Code's local home.
 *
 * Repo:
 *   .claude-sync/memory/*.md
 *   .claude-sync/plans/*.md
 *
 * Local Claude Code:
 *   ~/.claude/projects/<encoded-project-path>/memory/*.md
 *   ~/.claude/plans/*.md
 */

import { mkdir, readdir, readFile, writeFile, stat, copyFile, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const SYNC_DIR = path.join(REPO_ROOT, ".claude-sync");
const SYNC_MEMORY = path.join(SYNC_DIR, "memory");
const SYNC_PLANS = path.join(SYNC_DIR, "plans");
const MANIFEST_FILE = path.join(SYNC_DIR, "plans-manifest.json");

const CLAUDE_HOME = path.join(homedir(), ".claude");
const CLAUDE_PLANS = path.join(CLAUDE_HOME, "plans");

const args = new Set(process.argv.slice(2));
const MODE =
  (args.has("--pull") && "pull") ||
  (args.has("--push") && "push") ||
  (args.has("--status") && "status") ||
  "auto";
const VERBOSE = args.has("--verbose") || args.has("-v");
const QUIET_ON_NOOP = args.has("--quiet-on-noop");

function log(...parts) {
  console.log("[agent-sync]", ...parts);
}

function vlog(...parts) {
  if (VERBOSE) log(...parts);
}

function encodeProjectId(absPath) {
  if (platform() === "win32") {
    return absPath.replace(/:/g, "-").replace(/\\/g, "-").replace(/\//g, "-");
  }
  return absPath.replace(/\//g, "-");
}

const PROJECT_ID = encodeProjectId(REPO_ROOT);
const CLAUDE_MEMORY = path.join(CLAUDE_HOME, "projects", PROJECT_ID, "memory");

async function ensureDir(target) {
  await mkdir(target, { recursive: true });
}

async function listMd(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => entry.name);
}

async function safeStat(target) {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

function sameMtime(left, right) {
  return Math.abs(left.mtimeMs - right.mtimeMs) < 1000;
}

async function copyPreserveMtime(src, dst, srcStat) {
  await ensureDir(path.dirname(dst));
  await copyFile(src, dst);
  await utimes(dst, srcStat.atime, srcStat.mtime);
}

async function readManifest() {
  if (!existsSync(MANIFEST_FILE)) return { plans: [] };
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_FILE, "utf8"));
    return Array.isArray(parsed.plans) ? parsed : { plans: [] };
  } catch {
    return { plans: [] };
  }
}

async function writeManifest(manifest) {
  await ensureDir(path.dirname(MANIFEST_FILE));
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function syncStatus(repoPath, localPath) {
  const [repoStat, localStat] = await Promise.all([safeStat(repoPath), safeStat(localPath)]);
  if (!repoStat && !localStat) return "missing-both";
  if (!repoStat) return "only-in-local";
  if (!localStat) return "only-in-repo";
  if (sameMtime(repoStat, localStat)) return "in-sync";
  return repoStat.mtimeMs > localStat.mtimeMs ? "repo-newer" : "local-newer";
}

async function syncFile(repoPath, localPath, mode) {
  const [repoStat, localStat] = await Promise.all([safeStat(repoPath), safeStat(localPath)]);
  if (!repoStat && !localStat) return "missing-both";

  if (mode === "pull") {
    if (!repoStat) return "missing-repo";
    await copyPreserveMtime(repoPath, localPath, repoStat);
    return "pulled";
  }

  if (mode === "push") {
    if (!localStat) return "missing-local";
    await copyPreserveMtime(localPath, repoPath, localStat);
    return "pushed";
  }

  if (!repoStat && localStat) {
    await copyPreserveMtime(localPath, repoPath, localStat);
    return "pushed-new";
  }

  if (repoStat && !localStat) {
    await copyPreserveMtime(repoPath, localPath, repoStat);
    return "pulled-new";
  }

  if (sameMtime(repoStat, localStat)) return "in-sync";

  if (repoStat.mtimeMs > localStat.mtimeMs) {
    await copyPreserveMtime(repoPath, localPath, repoStat);
    return "pulled-repo-newer";
  }

  await copyPreserveMtime(localPath, repoPath, localStat);
  return "pushed-local-newer";
}

async function syncGroup(label, repoDir, localDir, names, touched) {
  await ensureDir(repoDir);
  await ensureDir(localDir);

  for (const name of names) {
    const repoPath = path.join(repoDir, name);
    const localPath = path.join(localDir, name);

    if (MODE === "status") {
      log(`${label}/${name}: ${await syncStatus(repoPath, localPath)}`);
      continue;
    }

    const result = await syncFile(repoPath, localPath, MODE);
    if (result !== "in-sync") touched.count += 1;
    if (VERBOSE || result !== "in-sync") log(`${label}/${name}: ${result}`);
  }
}

async function run() {
  log(`mode=${MODE} projectId=${PROJECT_ID}`);
  vlog(`repo=${REPO_ROOT}`);
  vlog(`claudeMemory=${CLAUDE_MEMORY}`);

  const touched = { count: 0 };

  const memoryNames = new Set([...(await listMd(SYNC_MEMORY)), ...(await listMd(CLAUDE_MEMORY))]);
  await syncGroup("memory", SYNC_MEMORY, CLAUDE_MEMORY, memoryNames, touched);

  const manifest = await readManifest();
  const planNames = new Set(manifest.plans);
  for (const name of await listMd(SYNC_PLANS)) planNames.add(name);
  await syncGroup("plans", SYNC_PLANS, CLAUDE_PLANS, planNames, touched);

  const finalPlans = Array.from(planNames).sort();
  if (
    finalPlans.length !== manifest.plans.length ||
    finalPlans.some((name, index) => name !== manifest.plans[index])
  ) {
    await writeManifest({ plans: finalPlans });
    log(`manifest updated: ${finalPlans.length} plan(s) tracked`);
  }

  if (MODE !== "status" && touched.count === 0 && QUIET_ON_NOOP) return;
  if (MODE !== "status") log(`done. ${touched.count} file(s) touched.`);
}

run().catch((error) => {
  console.error("[agent-sync] FAILED:", error);
  process.exit(1);
});
