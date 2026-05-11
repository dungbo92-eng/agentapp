#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_FILE = path.join(REPO_ROOT, "package.json");
const PNPM_VERSION = "10.33.2";

const HELP = `Usage:
  pnpm agent:setup
  pnpm agent:setup -- --json
  pnpm agent:setup -- --install [--target core|ai|codex|claude|gemini|cursor]

Checks local prerequisites and prints exact install commands for missing tools.
--install runs only local package/CLI installers. It never logs in, switches accounts,
clicks approvals, bypasses MFA/captcha, or stores secrets.
`;

const INSTALL_SOURCES = {
  codex: "https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started",
  claude: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
  gemini: "https://google-gemini.github.io/gemini-cli/docs/get-started/",
};

function isWindows() {
  return platform() === "win32";
}

function shellCommand(command) {
  return isWindows()
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", command] }
    : { command: "sh", args: ["-lc", command] };
}

const TARGETS = [
  {
    id: "node",
    group: "core",
    label: "Node.js 20+",
    command: "node",
    envOverride: "",
    installCommand: isWindows()
      ? "winget install --id OpenJS.NodeJS.LTS -e --source winget"
      : "Install Node.js 20+ from your OS package manager or https://nodejs.org/",
    installable: isWindows(),
    required: true,
    checker: async () => {
      const major = Number.parseInt(process.versions.node.split(".")[0], 10);
      return {
        ok: major >= 20,
        detail: process.version,
        reason: major >= 20 ? "Node.js runtime is new enough." : "Node.js 20 이상이 필요합니다.",
      };
    },
  },
  {
    id: "git",
    group: "core",
    label: "Git",
    command: "git",
    envOverride: "",
    args: ["--version"],
    installCommand: isWindows()
      ? "winget install --id Git.Git -e --source winget"
      : "Install git from your OS package manager.",
    installable: isWindows(),
    required: true,
  },
  {
    id: "pnpm",
    group: "core",
    label: "pnpm",
    command: "pnpm",
    envOverride: "",
    args: ["--version"],
    installCommand: `corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate`,
    installable: true,
    required: true,
    shellProbe: isWindows(),
  },
  {
    id: "codex",
    group: "ai",
    label: "Codex CLI",
    command: "codex",
    envOverride: "AGENTAPP_CODEX_COMMAND",
    args: ["--version"],
    installCommand: "npm install -g @openai/codex",
    installable: true,
    afterInstall: "codex login",
    docs: INSTALL_SOURCES.codex,
    required: false,
  },
  {
    id: "claude",
    group: "ai",
    label: "Claude Code CLI",
    command: "claude",
    envOverride: "AGENTAPP_CLAUDE_COMMAND",
    args: ["--version"],
    installCommand: "npm install -g @anthropic-ai/claude-code",
    installable: true,
    afterInstall: "claude",
    docs: INSTALL_SOURCES.claude,
    required: false,
  },
  {
    id: "cursor",
    group: "ai",
    label: "Cursor CLI",
    command: "cursor",
    envOverride: "AGENTAPP_CURSOR_COMMAND",
    args: ["--version"],
    installCommand: isWindows()
      ? "winget install --id Anysphere.Cursor -e --source winget"
      : "Install Cursor from https://cursor.com/ and enable the shell command.",
    installable: isWindows(),
    afterInstall: "Open Cursor and sign in manually.",
    required: false,
  },
  {
    id: "gemini",
    group: "ai",
    label: "Gemini CLI",
    command: "gemini",
    envOverride: "AGENTAPP_GEMINI_COMMAND",
    args: ["--version"],
    installCommand: "npm install -g @google/gemini-cli",
    installable: true,
    afterInstall: "gemini auth login",
    docs: INSTALL_SOURCES.gemini,
    required: false,
  },
];

function parseArgs(argv) {
  const options = {
    json: false,
    install: false,
    target: "all",
    strict: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--install") {
      options.install = true;
    } else if (arg === "--target") {
      options.target = argv[index + 1] || "all";
      index += 1;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

async function packageVersion() {
  try {
    const parsed = JSON.parse(await readFile(PACKAGE_FILE, "utf8"));
    return parsed.version || "unknown";
  } catch {
    return "unknown";
  }
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: REPO_ROOT,
      windowsHide: true,
      timeout: options.timeoutMs || 15000,
      ...options.execOptions,
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

async function runShell(command) {
  const shell = shellCommand(command);
  return run(shell.command, shell.args, { timeoutMs: 60000 });
}

async function findCommand(commandName) {
  const probe = isWindows() ? "where.exe" : "which";
  const result = await run(probe, [commandName], { timeoutMs: 5000 });
  if (!result.ok) return "";
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

async function checkTarget(target) {
  if (target.checker) {
    const checked = await target.checker();
    return {
      ...target,
      status: checked.ok ? "ok" : "missing",
      ok: checked.ok,
      detail: checked.detail || "",
      reason: checked.reason || "",
    };
  }

  const override = target.envOverride ? process.env[target.envOverride] || "" : "";
  const commandPath = override || (await findCommand(target.command));
  if (!commandPath) {
    return {
      ...target,
      status: "missing",
      ok: false,
      detail: "",
      reason: target.envOverride
        ? `${target.command} 명령을 찾지 못했습니다. ${target.envOverride} 로 직접 경로를 지정할 수 있습니다.`
        : `${target.command} 명령을 찾지 못했습니다.`,
    };
  }

  const versionResult = target.shellProbe
    ? await runShell(`${target.command} ${(target.args || []).join(" ")}`.trim())
    : await run(commandPath, target.args || ["--version"], { timeoutMs: 8000 });
  return {
    ...target,
    status: "ok",
    ok: true,
    detail: versionResult.ok ? versionResult.stdout.split(/\r?\n/)[0] || commandPath : commandPath,
    reason: override ? `${target.envOverride} 환경변수로 지정됨` : commandPath,
  };
}

function targetMatches(target, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "core" || filter === "ai") return target.group === filter;
  return target.id === filter;
}

export async function inspectEnvironment(options = {}) {
  const targetFilter = options.target || "all";
  const selectedTargets = TARGETS.filter((target) => targetMatches(target, targetFilter));
  const targets = [];
  for (const target of selectedTargets) targets.push(await checkTarget(target));
  const missing = targets.filter((target) => !target.ok);
  const missingRequired = missing.filter((target) => target.required);
  return {
    generatedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    platform: platform(),
    packageVersion: await packageVersion(),
    summary: {
      total: targets.length,
      ok: targets.length - missing.length,
      missing: missing.length,
      missingRequired: missingRequired.length,
      ready: missingRequired.length === 0,
    },
    targets: targets.map((target) => ({
      id: target.id,
      group: target.group,
      label: target.label,
      command: target.command,
      envOverride: target.envOverride,
      status: target.status,
      ok: target.ok,
      required: target.required,
      detail: target.detail,
      reason: target.reason,
      installCommand: target.installCommand,
      afterInstall: target.afterInstall || "",
      docs: target.docs || "",
      installable: target.installable !== false,
    })),
  };
}

function printReport(report) {
  console.log(`[agent-setup] repo=${report.repoRoot}`);
  console.log(`[agent-setup] version=${report.packageVersion}`);
  for (const target of report.targets) {
    const prefix = target.ok ? "[ok]" : target.required ? "[fail]" : "[warn]";
    console.log(`${prefix} ${target.label}: ${target.ok ? target.detail : target.reason}`);
    if (!target.ok) {
      console.log(`      install: ${target.installCommand}`);
      if (target.envOverride) console.log(`      override: set ${target.envOverride}=<absolute command path>`);
      if (target.afterInstall) console.log(`      auth: ${target.afterInstall}`);
    }
  }
  console.log(
    `[agent-setup] ready=${report.summary.ready}; ok=${report.summary.ok}/${report.summary.total}; missing=${report.summary.missing}`,
  );
}

async function executeInstall(targets) {
  for (const target of targets) {
    if (!target.installCommand || target.ok) continue;
    if (!target.installable) {
      console.log(`[skip] ${target.label}: no executable install command`);
      continue;
    }
    console.log(`[install] ${target.label}: ${target.installCommand}`);
    await new Promise((resolve, reject) => {
      const child = spawn(shellCommand(target.installCommand).command, shellCommand(target.installCommand).args, {
        cwd: REPO_ROOT,
        stdio: "inherit",
        shell: false,
        windowsHide: false,
      });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${target.id} install exited ${code}`))));
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    process.exit(0);
  }

  let report = await inspectEnvironment({ target: options.target });
  if (options.install) {
    const missing = report.targets.filter((target) => !target.ok);
    await executeInstall(missing);
    report = await inspectEnvironment({ target: options.target });
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (options.strict && !report.summary.ready) {
    process.exit(1);
  }
}
