import { app, BrowserWindow, shell, globalShortcut } from "electron";
import path from "node:path";

let dashboardServer;
let mainWindow;

const debugEnabled = process.env.AGENTAPP_DEBUG === "1" || !app.isPackaged;

async function bootstrapAutoUpdater() {
  if (!app.isPackaged) return;
  if (process.env.AGENTAPP_DISABLE_AUTOUPDATE === "1") return;
  try {
    const updaterModule = await import("electron-updater");
    const autoUpdater = updaterModule.autoUpdater || updaterModule.default?.autoUpdater;
    if (!autoUpdater) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => process.stderr.write("[updater] checking\n"));
    autoUpdater.on("update-available", (info) => {
      process.stderr.write(`[updater] available ${info?.version}\n`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("agentapp:update-available", { version: info?.version });
      }
    });
    autoUpdater.on("update-not-available", () => process.stderr.write("[updater] up-to-date\n"));
    autoUpdater.on("download-progress", (p) => {
      process.stderr.write(`[updater] download ${Math.round(p.percent || 0)}%\n`);
    });
    autoUpdater.on("update-downloaded", (info) => {
      process.stderr.write(`[updater] downloaded ${info?.version}\n`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("agentapp:update-downloaded", { version: info?.version });
      }
      // 사용자가 종료할 때 자동 적용. 즉시 적용은 사용자가 quitAndInstall 명시 호출 시.
    });
    autoUpdater.on("error", (error) => {
      process.stderr.write(`[updater] error: ${error?.message || error}\n`);
    });
    // 첫 체크는 창이 뜨고 5초 후, 이후 30분마다.
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 30 * 60 * 1000);
  } catch (error) {
    process.stderr.write(`[updater] init failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

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
  void bootstrapAutoUpdater();
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
