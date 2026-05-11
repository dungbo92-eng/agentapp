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
  applyAccountPreset,
  applyFourAccountPreset,
  readRuntime,
  saveAccountCredential,
  setAccountBudget,
  setAccountEnabled,
  setAccountSession,
  startRun,
  stopRun,
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
  if (req.method === "POST" && url === "/api/agentapp/runs/start") {
    sendJson(res, 200, await startRun(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/runs/stop") {
    sendJson(res, 200, await stopRun());
    return true;
  }
  return false;
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
    const body = await readFile(file);
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
