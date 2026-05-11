#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { platform, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function safeSpawnCwd() {
  if (REPO_ROOT.includes(`${path.sep}app.asar${path.sep}`) || REPO_ROOT.endsWith(`${path.sep}app.asar`)) {
    return tmpdir();
  }
  if (!existsSync(REPO_ROOT)) return tmpdir();
  return REPO_ROOT;
}
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

function windowsSystemRoot() {
  return process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
}

function windowsSystemCommand(commandName) {
  return path.join(windowsSystemRoot(), "System32", commandName);
}

function windowsShell() {
  return process.env.ComSpec || process.env.COMSPEC || windowsSystemCommand("cmd.exe");
}

function windowsToolPathEntries(baseEnv = process.env) {
  const root = windowsSystemRoot();
  const userProfile = baseEnv.USERPROFILE || "";
  const appData = baseEnv.APPDATA || (userProfile ? path.join(userProfile, "AppData", "Roaming") : "");
  const localAppData = baseEnv.LOCALAPPDATA || (userProfile ? path.join(userProfile, "AppData", "Local") : "");
  return [
    path.join(root, "System32"),
    path.join(root, "System32", "Wbem"),
    path.join(root, "System32", "WindowsPowerShell", "v1.0"),
    path.join(root, "System32", "OpenSSH"),
    path.join(root, "SysWOW64"),
    root,
    "C:\\Program Files\\nodejs",
    "C:\\Program Files\\Git\\cmd",
    "C:\\Program Files\\Git\\bin",
    appData ? path.join(appData, "npm") : "",
    localAppData ? path.join(localAppData, "Programs", "cursor", "resources", "app", "bin") : "",
    localAppData ? path.join(localAppData, "Microsoft", "WindowsApps") : "",
  ];
}

function installEnv(baseEnv = process.env) {
  if (!isWindows()) return { ...baseEnv };
  const nextEnv = { ...baseEnv };
  const pathKey = Object.keys(nextEnv).find((key) => key.toLowerCase() === "path") || "Path";
  for (const key of Object.keys(nextEnv)) {
    if (key.toLowerCase() === "path" && key !== pathKey) delete nextEnv[key];
  }
  const entries = [...windowsToolPathEntries(nextEnv), nextEnv[pathKey] || ""]
    .flatMap((entry) => String(entry).split(";"))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const seen = new Set();
  nextEnv[pathKey] = entries
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(";");
  return nextEnv;
}

function shellCommand(command) {
  return isWindows()
    ? { command: windowsShell(), args: ["/d", "/s", "/c", command] }
    : { command: "sh", args: ["-lc", command] };
}

function needsWindowsShell(command) {
  return isWindows() && /\.(cmd|bat)$/i.test(command);
}

function commandInvocation(command, args, shellOverride) {
  if (shellOverride !== undefined) return { command, args, shell: shellOverride };
  if (!needsWindowsShell(command)) return { command, args, shell: false };
  return {
    command: windowsShell(),
    args: ["/d", "/s", "/c", "call", command, ...args],
    shell: false,
  };
}

function executableFromPathProbe(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!isWindows()) return lines[0] || "";

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
      const commandPath = await findCommand("node");
      if (!commandPath) {
        return {
          ok: false,
          detail: "",
          reason: "Node.js CLI를 찾지 못했습니다. AI CLI 설치에는 npm이 포함된 Node.js LTS가 필요합니다.",
        };
      }
      const versionResult = await run(commandPath, ["--version"], { timeoutMs: 8000 });
      const version = versionResult.ok ? versionResult.stdout.split(/\r?\n/)[0] || process.version : process.version;
      const major = Number.parseInt(version.replace(/^v/, "").split(".")[0], 10);
      return {
        ok: major >= 20,
        detail: `${version} (${commandPath})`,
        reason: major >= 20 ? "Node.js CLI is new enough." : "Node.js 20 이상이 필요합니다.",
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
  const execOptions = options.execOptions || {};
  const invocation = commandInvocation(command, args, execOptions.shell);
  try {
    const result = await execFileAsync(invocation.command, invocation.args, {
      cwd: safeSpawnCwd(),
      windowsHide: true,
      timeout: options.timeoutMs || 15000,
      ...execOptions,
      env: installEnv(execOptions.env || process.env),
      shell: invocation.shell,
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
  const probe = isWindows() ? windowsSystemCommand("where.exe") : "which";
  const result = await run(probe, [commandName], { timeoutMs: 5000 });
  if (!result.ok) return "";
  return executableFromPathProbe(result.stdout);
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
  const versionOutput = [versionResult.stdout, versionResult.stderr].filter(Boolean).join("\n").trim();
  return {
    ...target,
    status: "ok",
    ok: true,
    detail: versionResult.ok ? versionOutput.split(/\r?\n/)[0] || commandPath : commandPath,
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
    autoInstall: {
      aiCli: process.env.AGENTAPP_AUTO_INSTALL_AI_CLI !== "0",
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

export async function installMissingTargets(options = {}) {
  const onLog = typeof options.onLog === "function" ? options.onLog : () => {};
  const targetFilter = options.target || "all";
  let report = await inspectEnvironment({ target: targetFilter });
  const missing = report.targets.filter((target) => !target.ok && target.installable !== false && target.installCommand);
  if (missing.length === 0) {
    onLog({ level: "info", message: "설치가 필요한 도구가 없습니다." });
    return { report, installed: [], failed: [] };
  }
  const installed = [];
  const failed = [];
  for (const target of missing) {
    onLog({ level: "info", message: `[install] ${target.label}: ${target.installCommand}` });
    const { command, args } = shellCommand(target.installCommand);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: safeSpawnCwd(),
          env: installEnv(),
          shell: false,
          windowsHide: true,
        });
        child.stdout.on("data", (chunk) => {
          for (const line of String(chunk).split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) onLog({ level: "info", message: trimmed });
          }
        });
        child.stderr.on("data", (chunk) => {
          for (const line of String(chunk).split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) onLog({ level: "warn", message: trimmed });
          }
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`${target.id} install exited ${code}`)),
        );
      });
      installed.push(target.id);
      onLog({ level: "info", message: `[done] ${target.label}` });
    } catch (error) {
      failed.push({ id: target.id, error: error instanceof Error ? error.message : String(error) });
      onLog({ level: "error", message: `[fail] ${target.label}: ${error instanceof Error ? error.message : error}` });
    }
  }
  report = await inspectEnvironment({ target: targetFilter });
  return { report, installed, failed };
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
      const shell = shellCommand(target.installCommand);
      const child = spawn(shell.command, shell.args, {
        cwd: safeSpawnCwd(),
        env: installEnv(),
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
