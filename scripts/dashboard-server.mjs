#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addAccount,
  deleteAccount,
  detectAndUpdateAccount,
  runAccountLogin,
  addProject,
  deleteProject,
  readProjectMeta,
  updateRuntimeSettings,
  probeAccountLockout,
  probeAllLockedAccounts,
  applyAccountPreset,
  applyFourAccountPreset,
  readRuntime,
  saveAccountCredential,
  setAccountBudget,
  setAccountEnabled,
  setAccountSession,
  startRun,
  stopRun,
  quickHandoff,
} from "./dashboard-runtime.mjs";
import { inspectEnvironment, installMissingTargets } from "./agent-environment-setup.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STATIC_DIR = path.join(REPO_ROOT, "apps", "dashboard", "dist");

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
]);

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url === "/api/agentapp/runtime") {
    sendJson(res, 200, await readRuntime());
    return true;
  }
  if (req.method === "GET" && url === "/api/agentapp/environment") {
    sendJson(res, 200, await inspectEnvironment());
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/environment/install") {
    const body = await readBody(req);
    const logs = [];
    const result = await installMissingTargets({
      target: body.target || "all",
      onLog: (entry) => logs.push({ at: new Date().toISOString(), ...entry }),
    });
    sendJson(res, 200, { ...result, logs });
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts") {
    sendJson(res, 200, await addAccount(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/delete") {
    sendJson(res, 200, await deleteAccount(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/preset-four") {
    sendJson(res, 200, await applyFourAccountPreset());
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/preset") {
    sendJson(res, 200, await applyAccountPreset(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/enabled") {
    sendJson(res, 200, await setAccountEnabled(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/session") {
    sendJson(res, 200, await setAccountSession(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/budget") {
    sendJson(res, 200, await setAccountBudget(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/detect") {
    const body = await readBody(req);
    sendJson(res, 200, await detectAndUpdateAccount(body.id || body.accountId));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/login") {
    const body = await readBody(req);
    sendJson(res, 200, await runAccountLogin(body.id || body.accountId));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/credential") {
    sendJson(res, 200, await saveAccountCredential(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/projects") {
    sendJson(res, 200, await addProject(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/projects/delete") {
    sendJson(res, 200, await deleteProject(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/projects/browse") {
    sendJson(res, 200, await browseDirectory(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/projects/meta") {
    sendJson(res, 200, await readProjectMeta(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/settings") {
    sendJson(res, 200, await updateRuntimeSettings(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/accounts/probe") {
    const body = await readBody(req);
    if (body && (body.id || body.accountId)) {
      sendJson(res, 200, await probeAccountLockout(body.id || body.accountId, { force: Boolean(body.force) }));
    } else {
      sendJson(res, 200, await probeAllLockedAccounts({ force: Boolean(body?.force) }));
    }
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/runs/start") {
    sendJson(res, 200, await startRun(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/runs/stop") {
    sendJson(res, 200, await stopRun());
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/handoff/quickswitch") {
    sendJson(res, 200, await quickHandoff(await readBody(req)));
    return true;
  }
  return false;
}

async function browseDirectory(options = {}) {
  if (!process.versions.electron) {
    return { path: "", reason: "browse_dialog_unavailable" };
  }
  try {
    const electron = await import("electron");
    const electronModule = electron.default || electron;
    const { dialog, BrowserWindow } = electronModule;
    if (!dialog) return { path: "", reason: "dialog_unavailable" };
    const focused = BrowserWindow?.getFocusedWindow?.() || BrowserWindow?.getAllWindows?.()[0];
    const dialogOptions = {
      title: options.title || "프로젝트 경로 선택",
      defaultPath: options.defaultPath || undefined,
      properties: ["openDirectory", "createDirectory"],
    };
    const result = focused
      ? await dialog.showOpenDialog(focused, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { path: "", canceled: true };
    }
    return { path: result.filePaths[0] };
  } catch (error) {
    return { path: "", reason: error instanceof Error ? error.message : String(error) };
  }
}

function runtimeWorkspaceRoot() {
  if (process.env.AGENTAPP_WORKSPACE) return process.env.AGENTAPP_WORKSPACE;
  // Packaged EXE: AGENTAPP_DATA_DIR points at Electron userData (e.g.
  // %APPDATA%\agent-app\data). That folder is the app's private cache, not a
  // workspace the user codes in — return "" so the dashboard hides the self
  // project card instead of showing an irrelevant path as the first project.
  if (process.env.AGENTAPP_DATA_DIR) {
    const dataDir = process.env.AGENTAPP_DATA_DIR.toLowerCase();
    if (
      dataDir.includes(`${path.sep}appdata${path.sep}`) ||
      dataDir.includes(`${path.sep}library${path.sep}application support${path.sep}`) ||
      dataDir.includes(`${path.sep}.config${path.sep}`)
    ) {
      return "";
    }
    return path.dirname(process.env.AGENTAPP_DATA_DIR);
  }
  if (REPO_ROOT.includes(`${path.sep}app.asar${path.sep}`) || REPO_ROOT.endsWith(`${path.sep}app.asar`)) {
    return process.cwd();
  }
  return REPO_ROOT;
}

function rewriteSnapshotPaths(buffer) {
  let text = buffer.toString("utf8");
  const workspace = runtimeWorkspaceRoot();
  if (workspace) {
    // Replace any baked-in dev-time absolute paths so the user PC sees its
    // own workspace instead of D:\agentApp or E:\agentApp.
    text = text.replace(/[A-Za-z]:\\\\agentApp/g, workspace.replace(/\\/g, "\\\\"));
    text = text.replace(/[A-Za-z]:\\agentApp/g, workspace);
  } else {
    // Packaged EXE without a real user workspace: clear repo_root so the UI
    // hides the self-project card and shows registered external projects only.
    try {
      const parsed = JSON.parse(text);
      parsed.repo_root = "";
      text = JSON.stringify(parsed, null, 2);
    } catch {
      // Snapshot is not JSON; leave as-is.
    }
  }
  return Buffer.from(text, "utf8");
}

async function serveStatic(req, res, staticDir, url) {
  const requested = decodeURIComponent(url === "/" ? "/index.html" : url);
  const candidate = path.resolve(staticDir, `.${requested}`);

  if (!candidate.startsWith(staticDir)) {
    sendText(res, 403, "forbidden");
    return;
  }

  let file = candidate;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
  } catch {
    file = path.join(staticDir, "index.html");
  }

  try {
    let body = await readFile(file);
    if (path.basename(file) === "agent-snapshot.json") {
      body = rewriteSnapshotPaths(body);
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES.get(path.extname(file)) || "application/octet-stream");
    res.end(body);
  } catch {
    sendText(res, 404, "not found");
  }
}

export async function createDashboardServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port || process.env.AGENTAPP_DESKTOP_PORT || 0);
  const staticDir = path.resolve(options.staticDir || DEFAULT_STATIC_DIR);

  const server = createServer(async (req, res) => {
    const url = req.url?.split("?")[0] || "/";

    try {
      if (url.startsWith("/api/agentapp/")) {
        const handled = await handleApi(req, res, url);
        if (!handled) sendJson(res, 404, { error: "not_found" });
        return;
      }

      await serveStatic(req, res, staticDir, url);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "dashboard server failed" });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    server,
    url: `http://${host}:${actualPort}/`,
    staticDir,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createDashboardServer({ port: process.argv[2] ? Number(process.argv[2]) : 5174 });
  console.log(`dashboard=${app.url}`);
}
