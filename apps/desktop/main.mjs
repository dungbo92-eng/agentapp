import { app, BrowserWindow, shell } from "electron";
import path from "node:path";

let dashboardServer;
let mainWindow;

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
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

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
  dashboardServer?.server.close();
});
