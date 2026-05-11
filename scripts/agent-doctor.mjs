#!/usr/bin/env node
/**
 * Verify that the local machine can safely sync agent state for this repo.
 */

import { access, readFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYNC_DIR = path.join(REPO_ROOT, ".claude-sync");
const SYNC_MEMORY = path.join(SYNC_DIR, "memory");
const SYNC_PLANS = path.join(SYNC_DIR, "plans");
const MANIFEST_FILE = path.join(SYNC_DIR, "plans-manifest.json");
const HANDOFF_DIR = path.join(REPO_ROOT, "tools", "agent-orchestrator", "handoff");
const SYNC_SCRIPT = path.join(REPO_ROOT, "scripts", "claude-sync.mjs");

const CLAUDE_HOME = path.join(homedir(), ".claude");
const CLAUDE_PLANS = path.join(CLAUDE_HOME, "plans");

let warnings = 0;
let failures = 0;

function encodeProjectId(absPath) {
  if (platform() === "win32") {
    return absPath.replace(/:/g, "-").replace(/\\/g, "-").replace(/\//g, "-");
  }
  return absPath.replace(/\//g, "-");
}

const CLAUDE_MEMORY = path.join(CLAUDE_HOME, "projects", encodeProjectId(REPO_ROOT), "memory");

function note(level, label, detail = "") {
  const prefix = level === "ok" ? "[ok]" : level === "warn" ? "[warn]" : "[fail]";
  console.log(`${prefix} ${label}${detail ? `: ${detail}` : ""}`);
  if (level === "warn") warnings += 1;
  if (level === "fail") failures += 1;
}

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function command(commandName, args, options = {}) {
  try {
    const result = await execFileAsync(commandName, args, {
      cwd: REPO_ROOT,
      windowsHide: true,
      ...options,
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    return {
      ok: false,
      stdout: (error.stdout || "").trim(),
      stderr: (error.stderr || error.message || "").trim(),
    };
  }
}

async function checkRequiredPath(label, target) {
  if (await exists(target)) {
    note("ok", label, path.relative(REPO_ROOT, target) || ".");
  } else {
    note("fail", label, `${path.relative(REPO_ROOT, target)} missing`);
  }
}

async function checkNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (major >= 20) {
    note("ok", "node", process.version);
  } else {
    note("fail", "node", `${process.version}; required >=20`);
  }
}

async function checkCommand(label, commandName, args) {
  const result = await command(commandName, args);
  if (result.ok) {
    note("ok", label, result.stdout.split(/\r?\n/)[0]);
  } else {
    note("fail", label, result.stderr || "not available");
  }
}

async function checkPnpm() {
  const result =
    platform() === "win32"
      ? await command("cmd.exe", ["/d", "/s", "/c", "pnpm --version"])
      : await command("pnpm", ["--version"]);

  if (result.ok) {
    note("ok", "pnpm", result.stdout.split(/\r?\n/)[0]);
    return;
  }

  const userAgent = process.env.npm_config_user_agent || "";
  if (userAgent.includes("pnpm")) {
    note("warn", "pnpm", `available in current script, but direct version check failed: ${result.stderr}`);
    return;
  }

  note("fail", "pnpm", result.stderr || "not available");
}

async function checkGitConfig(key, expected) {
  const result = await command("git", ["config", "--global", "--get", key]);
  const actual = result.ok ? result.stdout.trim() : "";
  if (actual === expected) {
    note("ok", `git config ${key}`, expected);
  } else {
    note("warn", `git config ${key}`, `expected ${expected || "(empty)"}, actual ${actual || "(unset)"}`);
  }
}

async function checkHook(name, expectedText) {
  const target = path.join(REPO_ROOT, ".git", "hooks", name);
  if (!(await exists(target))) {
    note("fail", `git hook ${name}`, "missing; run pnpm hooks:install");
    return;
  }

  const body = await readFile(target, "utf8");
  if (body.includes(expectedText)) {
    note("ok", `git hook ${name}`, "installed");
  } else {
    note("warn", `git hook ${name}`, `does not mention ${expectedText}`);
  }
}

async function checkManifest() {
  if (!(await exists(MANIFEST_FILE))) {
    note("fail", "plans manifest", "missing");
    return;
  }

  try {
    const parsed = JSON.parse(await readFile(MANIFEST_FILE, "utf8"));
    if (Array.isArray(parsed.plans)) {
      note("ok", "plans manifest", `${parsed.plans.length} plan(s) tracked`);
    } else {
      note("fail", "plans manifest", "plans must be an array");
    }
  } catch (error) {
    note("fail", "plans manifest", error.message);
  }
}

async function checkSyncStatus() {
  const result = await command(process.execPath, [SYNC_SCRIPT, "--status"]);
  if (!result.ok) {
    note("fail", "agent sync status", result.stderr || result.stdout || "failed");
    return;
  }

  const driftLines = result.stdout
    .split(/\r?\n/)
    .filter((line) => /(repo-newer|local-newer|only-in-local|only-in-repo|missing-)/.test(line));

  if (driftLines.length === 0) {
    note("ok", "agent sync status", "memory/plans in sync");
  } else {
    note("warn", "agent sync status", driftLines.join("; "));
  }
}

async function checkGitRemote() {
  const result = await command("git", ["remote", "-v"]);
  if (!result.ok) {
    note("warn", "git remote", result.stderr || "cannot inspect");
    return;
  }

  if (result.stdout.trim()) {
    note("ok", "git remote", "configured");
  } else {
    note("warn", "git remote", "not configured yet");
  }
}

const WORKER_CLIS = [
  { name: "codex", commandEnv: "AGENTAPP_CODEX_COMMAND", install: "npm install -g @openai/codex" },
  { name: "claude", commandEnv: "AGENTAPP_CLAUDE_COMMAND", install: "npm install -g @anthropic-ai/claude-code" },
  { name: "cursor", commandEnv: "AGENTAPP_CURSOR_COMMAND", install: "winget install --id Anysphere.Cursor -e --source winget" },
  { name: "gemini", commandEnv: "AGENTAPP_GEMINI_COMMAND", install: "npm install -g @google/gemini-cli" },
];

async function findInPath(name) {
  const probe = platform() === "win32" ? "where.exe" : "which";
  const result = await command(probe, [name]);
  if (!result.ok) return "";
  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (platform() !== "win32") return lines[0] || "";
  const direct = lines.find((line) => /\.(exe|cmd|bat)$/i.test(line));
  if (direct) return direct;
  for (const line of lines) {
    for (const extension of [".cmd", ".exe", ".bat"]) {
      const candidate = `${line}${extension}`;
      if (existsSync(candidate)) return candidate;
    }
  }
  return lines[0] || "";
}

async function checkWorkerClis() {
  for (const worker of WORKER_CLIS) {
    const envPath = process.env[worker.commandEnv] || "";
    const found = envPath || (await findInPath(worker.name));
    if (found) {
      note("ok", `worker cli ${worker.name}`, found);
    } else {
      note(
        "warn",
        `worker cli ${worker.name}`,
        `not found in PATH (set ${worker.commandEnv}, or run: ${worker.install})`,
      );
    }
  }
}

async function checkSessionProfiles() {
  try {
    const { readRuntime, detectAccountSession } = await import("./dashboard-runtime.mjs");
    const runtime = await readRuntime();
    if (runtime.accounts.length === 0) {
      note("warn", "session profiles", "no local accounts registered (add one in the dashboard)");
      return;
    }
    for (const account of runtime.accounts) {
      const detection = await detectAccountSession(account);
      const label = `session ${account.provider}/${account.id}`;
      if (detection.sessionStatus === "ready") {
        note("ok", label, detection.reason);
      } else {
        note("warn", label, detection.reason);
      }
    }
  } catch (error) {
    note("warn", "session profiles", error.message);
  }
}

async function checkGitWorkingTree() {
  const result = await command("git", ["status", "--short"]);
  if (!result.ok) {
    note("warn", "git status", result.stderr || "cannot inspect");
    return;
  }

  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    note("ok", "git working tree", "clean");
  } else {
    note("warn", "git working tree", `${lines.length} changed/untracked item(s)`);
  }
}

console.log(`[agent-doctor] repo=${REPO_ROOT}`);

await checkNode();
await checkCommand("git", "git", ["--version"]);
await checkPnpm();

await checkRequiredPath("package.json", path.join(REPO_ROOT, "package.json"));
await checkRequiredPath("pnpm lockfile", path.join(REPO_ROOT, "pnpm-lock.yaml"));
await checkRequiredPath("git repo", path.join(REPO_ROOT, ".git"));
await checkRequiredPath("sync memory", SYNC_MEMORY);
await checkRequiredPath("sync plans", SYNC_PLANS);
await checkRequiredPath("handoff dir", HANDOFF_DIR);
await checkRequiredPath("local Claude memory", CLAUDE_MEMORY);
await checkRequiredPath("local Claude plans", CLAUDE_PLANS);

await checkManifest();
await checkHook("pre-commit", "claude-sync.mjs");
await checkHook("post-merge", "claude-sync.mjs");
await checkHook("post-checkout", "claude-sync.mjs");
await checkGitConfig("core.quotepath", "false");
await checkGitConfig("i18n.commitEncoding", "utf-8");
await checkGitConfig("i18n.logOutputEncoding", "utf-8");
await checkSyncStatus();
await checkGitRemote();
await checkGitWorkingTree();
await checkWorkerClis();
await checkSessionProfiles();

if (failures > 0) {
  console.log(`[agent-doctor] failed: ${failures} failure(s), ${warnings} warning(s)`);
  process.exit(1);
}

console.log(`[agent-doctor] ready: ${warnings} warning(s)`);
