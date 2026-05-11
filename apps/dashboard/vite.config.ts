import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {
  addAccount,
  deleteAccount,
  detectAndUpdateAccount,
  addProject,
  applyAccountPreset,
  applyFourAccountPreset,
  readRuntime,
  saveAccountCredential,
  setAccountBudget,
  setAccountEnabled,
  setAccountSession,
  runAccountLogin,
  startRun,
  stopRun,
} from "../../scripts/dashboard-runtime.mjs";
import { inspectEnvironment } from "../../scripts/agent-environment-setup.mjs";

async function readBody(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload, null, 2));
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "agent-app-runtime-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = req.url?.split("?")[0] || "";
          if (!url.startsWith("/api/agentapp/")) {
            next();
            return;
          }

          try {
            if (req.method === "GET" && url === "/api/agentapp/runtime") {
              sendJson(res, 200, await readRuntime());
              return;
            }
            if (req.method === "GET" && url === "/api/agentapp/environment") {
              sendJson(res, 200, await inspectEnvironment());
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts") {
              sendJson(res, 200, await addAccount(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/delete") {
              sendJson(res, 200, await deleteAccount(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/preset-four") {
              sendJson(res, 200, await applyFourAccountPreset());
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/preset") {
              sendJson(res, 200, await applyAccountPreset(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/enabled") {
              sendJson(res, 200, await setAccountEnabled(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/session") {
              sendJson(res, 200, await setAccountSession(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/budget") {
              sendJson(res, 200, await setAccountBudget(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/detect") {
              const body = await readBody(req);
              sendJson(res, 200, await detectAndUpdateAccount(body.id || body.accountId));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/login") {
              const body = await readBody(req);
              sendJson(res, 200, await runAccountLogin(body.id || body.accountId));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/accounts/credential") {
              sendJson(res, 200, await saveAccountCredential(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/projects") {
              sendJson(res, 200, await addProject(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/runs/start") {
              sendJson(res, 200, await startRun(await readBody(req)));
              return;
            }
            if (req.method === "POST" && url === "/api/agentapp/runs/stop") {
              sendJson(res, 200, await stopRun());
              return;
            }
            sendJson(res, 404, { error: "not_found" });
          } catch (error) {
            sendJson(res, 500, { error: error instanceof Error ? error.message : "runtime api failed" });
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
});
