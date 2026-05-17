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
  clearAccountQuotaLockout,
  cancelPendingRun,
  retryPendingRun,
  resumeRunWithUserInput,
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
  if (req.method === "POST" && url === "/api/agentapp/accounts/clear-quota") {
    const body = await readBody(req);
    const cleared = await clearAccountQuotaLockout(body.id || body.accountId);
    sendJson(res, 200, { ok: Boolean(cleared), runtime: await readRuntime() });
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
    // body 의 runId 가 지정되면 그 run 만, 없으면 모든 active run 정지.
    // 다중 active run 환경에서 UI 가 "이 프로젝트만 중지" 를 보낼 수 있게 한다.
    sendJson(res, 200, await stopRun(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/handoff/quickswitch") {
    sendJson(res, 200, await quickHandoff(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/runs/pending/cancel") {
    sendJson(res, 200, await cancelPendingRun(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/runs/pending/retry") {
    sendJson(res, 200, await retryPendingRun(await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url === "/api/agentapp/runs/resume") {
    // 사용자가 멈춘 run 에 답변을 입력하고 "이어 진행" 을 누를 때.
    sendJson(res, 200, await resumeRunWithUserInput(await readBody(req)));
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

// 같은 Wi-Fi LAN 에서 폰/태블릿으로 대시보드를 보려는 케이스용. host="0.0.0.0"
// 으로 바인딩한 뒤, 비로컬호스트 요청은 token 을 query (?t=) 또는 헤더
// (X-AgentApp-Token) 로 들고 와야 받아준다. 토큰이 일치하면 응답 직전에
// Set-Cookie 로 같은 토큰을 심어 페이지 내 fetch/assets 도 통과시킨다.
function isLocalhostRequest(req) {
  const raw = String(req.socket?.remoteAddress || "");
  if (!raw) return true; // unknown → 안전하게 로컬 취급 (절대 외부에서 닿지 않음을 가정)
  const lower = raw.toLowerCase();
  return (
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "::ffff:127.0.0.1" ||
    lower.startsWith("::ffff:127.")
  );
}

function extractToken(req) {
  // 1) query ?t=<token>
  const qIdx = req.url?.indexOf("?") ?? -1;
  if (qIdx >= 0) {
    const params = new URLSearchParams(req.url.slice(qIdx + 1));
    const t = params.get("t");
    if (t) return t;
  }
  // 2) header
  const header = req.headers["x-agentapp-token"];
  if (typeof header === "string" && header) return header;
  // 3) cookie agentapp_t=<token>
  const cookie = String(req.headers.cookie || "");
  const m = cookie.match(/(?:^|;\s*)agentapp_t=([^;]+)/);
  if (m && m[1]) return decodeURIComponent(m[1]);
  return "";
}

// 기본 포트 — 모바일 즐겨찾기가 깨지지 않도록 매 시작 동일 포트를 사용한다.
// 51820 은 사설 영역에서 잘 안 쓰이는 값. 사용자가 옮기고 싶으면 env 또는 settings 로 override.
// 포트 충돌 시 51821..51829 순차 시도 후, 그래도 안 되면 OS 임의 할당으로 fallback.
const DEFAULT_DASHBOARD_PORT = 51820;
const PORT_FALLBACK_RANGE = 10;

export async function createDashboardServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const requestedPort = Number(
    options.port
      || process.env.AGENTAPP_DESKTOP_PORT
      || DEFAULT_DASHBOARD_PORT,
  );
  const staticDir = path.resolve(options.staticDir || DEFAULT_STATIC_DIR);
  // LAN access 토큰 — getServerRequireToken() 으로 매 요청마다 최신 setting 을 읽어
  // 토글 변경이 재시작 없이 반영되도록 한다.
  const initialToken = String(options.lanAccessToken || "").trim();
  let activeToken = initialToken;
  async function getActiveToken() {
    try {
      const { getRuntimeSettings } = await import("./dashboard-runtime.mjs");
      const settings = await getRuntimeSettings();
      activeToken = settings.lanAccessEnabled ? String(settings.lanAccessToken || "") : "";
    } catch {
      // settings 읽기 실패 시 이전 값 유지 — 외부 접근 차단이 더 안전.
    }
    return activeToken;
  }

  const server = createServer(async (req, res) => {
    const url = req.url?.split("?")[0] || "/";

    try {
      // 비로컬호스트 요청은 토큰 검증. 매 요청마다 settings 재조회는 cheap (인메모리).
      if (!isLocalhostRequest(req)) {
        const token = await getActiveToken();
        if (!token) {
          sendText(res, 403, "LAN access is disabled. Enable it in the desktop app settings.");
          return;
        }
        const presented = extractToken(req);
        if (presented !== token) {
          sendText(res, 401, "AgentApp token required. Open the URL shown in the desktop dashboard.");
          return;
        }
        // 한 번 통과하면 cookie 로 심어 같은 페이지의 후속 자원 요청도 통과.
        res.setHeader(
          "Set-Cookie",
          `agentapp_t=${encodeURIComponent(token)}; Path=/; SameSite=Lax; Max-Age=2592000`,
        );
      }

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

  // 요청 포트가 사용 중이면 +1..+N 으로 순차 시도, 그래도 실패하면 0 (OS 임의 할당) 으로
  // 마지막 fallback. 일반적으로 첫 번째 시도에서 성공해 모바일 즐겨찾기가 안정적으로 동작.
  const portCandidates = [requestedPort];
  for (let i = 1; i <= PORT_FALLBACK_RANGE; i += 1) {
    portCandidates.push(requestedPort + i);
  }
  portCandidates.push(0); // OS 임의 할당 (절대 실패 안 함)

  let bound = false;
  let lastError = null;
  for (const candidate of portCandidates) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off("error", onError);
          reject(err);
        };
        server.once("error", onError);
        server.listen(candidate, host, () => {
          server.off("error", onError);
          resolve();
        });
      });
      bound = true;
      break;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") throw error;
      // 다음 후보로 진행
    }
  }
  if (!bound) {
    throw lastError || new Error("dashboard-server: all port candidates failed");
  }

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : requestedPort;
  if (actualPort !== requestedPort) {
    process.stderr.write(
      `[dashboard] requested port ${requestedPort} busy, using ${actualPort}\n`,
    );
  }
  // 클라이언트 (Electron renderer, 또는 같은 PC 의 다른 fetch) 가 접속할 때 쓸 URL.
  // host 가 0.0.0.0 / :: (모든 인터페이스) 면 그 주소로는 connect 가 불가능하므로
  // 로컬 클라이언트 URL 은 무조건 127.0.0.1 으로. (LAN 접속은 detectLanIps 가 별도로
  // 실제 인터페이스 IP 를 뽑아 사용함.)
  const clientHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return {
    server,
    url: `http://${clientHost}:${actualPort}/`,
    staticDir,
    host,
    port: actualPort,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createDashboardServer({ port: process.argv[2] ? Number(process.argv[2]) : 5174 });
  console.log(`dashboard=${app.url}`);
}
