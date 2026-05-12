import { app, BrowserWindow, shell, globalShortcut } from "electron";
import path from "node:path";

let dashboardServer;
let mainWindow;

const debugEnabled = process.env.AGENTAPP_DEBUG === "1" || !app.isPackaged;

async function createMainWindow() {
  process.env.AGENTAPP_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.AGENTAPP_HANDOFF_DIR = path.join(app.getPath("userData"), "handoff");

  const { createDashboardServer } = await import("../../scripts/dashboard-server.mjs");
  dashboardServer = await createDashboardServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: "AgentApp",
    backgroundColor: "#eef1f4",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const levelLabel = ["log", "warn", "error", "info"][level] || "log";
    process.stderr.write(`[renderer:${levelLabel}] ${message} (${sourceId}:${line})\n`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    process.stderr.write(`[renderer:crash] reason=${details.reason} exitCode=${details.exitCode}\n`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    process.stderr.write(`[renderer:load-fail] ${errorCode} ${errorDescription} ${validatedURL}\n`);
  });

  globalShortcut.register("F12", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  if (debugEnabled) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  await mainWindow.loadURL(dashboardServer.url);
}

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  dashboardServer?.server.close();
});
