import { app, BrowserWindow, shell, globalShortcut, Tray, Menu, ipcMain, screen, nativeImage } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

let dashboardServer;
let mainWindow;
let tray;
let windowMode = "full"; // "full" | "compact"
let isQuitting = false;
let savedFullBounds = null;

const PRELOAD_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.mjs");

const debugEnabled = process.env.AGENTAPP_DEBUG === "1" || !app.isPackaged;

// 트레이 백그라운드 상태에서 .exe 가 또 실행되면 두 번째 프로세스는 즉시 종료하고
// 첫 번째 인스턴스가 기존 창을 띄운다. dev 모드 (electron .) 에서는 lock 을
// 잡지 않아도 무방하지만 동일 동작을 시키기 위해 같은 경로를 따른다.
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      showMainWindow();
    }
  });
}

const FULL_WINDOW = { width: 1440, height: 920, minWidth: 1120, minHeight: 760 };
const COMPACT_WINDOW = { width: 380, height: 560, minWidth: 320, minHeight: 420 };

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
    width: FULL_WINDOW.width,
    height: FULL_WINDOW.height,
    minWidth: FULL_WINDOW.minWidth,
    minHeight: FULL_WINDOW.minHeight,
    title: "AgentApp",
    backgroundColor: "#eef1f4",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 가 require('electron') 을 쓰려면 sandbox 꺼야 함
      devTools: true,
      preload: PRELOAD_PATH,
    },
  });

  mainWindow.on("close", (event) => {
    // X 버튼은 트레이로 내리는 동작. 실제 종료는 트레이 메뉴 또는 isQuitting flag.
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (tray) {
        tray.displayBalloon?.({
          title: "AgentApp",
          content: "트레이에서 계속 실행 중입니다. 아이콘 클릭으로 다시 열 수 있어요.",
        });
      }
    }
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
  await bootstrapTray();
  void bootstrapAutoUpdater();
  void bootstrapAccountProbe();
}

async function bootstrapAccountProbe() {
  // 앱이 켜진 후 8초 뒤, 그 다음부터 30분마다 quota 잠금된 계정을 ping 해
  // 토큰이 실제로 살아 있는지 확인. provider 점검 보상 등으로 reset 시각보다
  // 일찍 풀린 경우 자동 잠금 해제.
  if (!app.isPackaged && process.env.AGENTAPP_FORCE_PROBE !== "1") return;
  const probeOnce = async () => {
    try {
      const mod = await import("../../scripts/dashboard-runtime.mjs");
      if (typeof mod.probeAllLockedAccounts !== "function") return;
      const result = await mod.probeAllLockedAccounts();
      if (result && result.tried > 0) {
        process.stderr.write(`[probe] ${result.unlocked}/${result.tried} accounts unlocked\n`);
        if (mainWindow && !mainWindow.isDestroyed() && result.unlocked > 0) {
          mainWindow.webContents.send("agentapp:accounts-unlocked", result);
        }
      }
    } catch (error) {
      process.stderr.write(`[probe] ${error instanceof Error ? error.message : String(error)}\n`);
    }
  };
  setTimeout(probeOnce, 8000);
  setInterval(probeOnce, 30 * 60 * 1000);
}

async function bootstrapTray() {
  if (tray) return;
  let icon;
  try {
    // 패키지본은 .exe 파일 아이콘을 추출. dev 모드는 electron 기본 아이콘을 사용.
    if (app.isPackaged) {
      icon = await app.getFileIcon(app.getPath("exe"), { size: "small" });
    }
  } catch {
    icon = undefined;
  }
  if (!icon || icon.isEmpty()) {
    // dev / 아이콘 추출 실패 시 1x1 투명 PNG 라도 넣어 Tray 생성을 막지 않게.
    icon = nativeImage.createFromBuffer(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR4nGNgGAWjYBSMglEwCkYBJQAABzgAAW0HQfMAAAAASUVORK5CYII=",
        "base64",
      ),
    );
  }
  tray = new Tray(icon);
  tray.setToolTip("AgentApp — 멀티 에이전트 오케스트레이터");
  rebuildTrayMenu();
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());
}

function rebuildTrayMenu() {
  if (!tray) return;
  const compact = windowMode === "compact";
  const menu = Menu.buildFromTemplate([
    { label: "열기", click: () => showMainWindow() },
    {
      label: "컴팩트 채팅 모드",
      type: "checkbox",
      checked: compact,
      click: () => setWindowMode(compact ? "full" : "compact"),
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function setWindowMode(nextMode) {
  if (!mainWindow || mainWindow.isDestroyed()) return windowMode;
  const target = nextMode === "compact" ? "compact" : "full";
  if (target === windowMode) return windowMode;

  if (target === "compact") {
    // 전환 직전 full 모드 bounds 저장 → 복귀 시 복원.
    savedFullBounds = mainWindow.getBounds();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display?.workArea || { x: 0, y: 0, width: 1280, height: 800 };
    const w = COMPACT_WINDOW.width;
    const h = COMPACT_WINDOW.height;
    const margin = 16;
    mainWindow.setMinimumSize(COMPACT_WINDOW.minWidth, COMPACT_WINDOW.minHeight);
    mainWindow.setBounds({
      x: area.x + area.width - w - margin,
      y: area.y + area.height - h - margin,
      width: w,
      height: h,
    });
    mainWindow.setAlwaysOnTop(true, "floating");
    mainWindow.setSkipTaskbar(false);
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(FULL_WINDOW.minWidth, FULL_WINDOW.minHeight);
    if (savedFullBounds) {
      mainWindow.setBounds(savedFullBounds);
    } else {
      mainWindow.setSize(FULL_WINDOW.width, FULL_WINDOW.height);
      mainWindow.center();
    }
  }

  windowMode = target;
  rebuildTrayMenu();
  if (!mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("agentapp:window-mode-changed", windowMode);
  }
  return windowMode;
}

ipcMain.handle("agentapp:set-window-mode", (_event, mode) => setWindowMode(mode));
ipcMain.handle("agentapp:hide-to-tray", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  return true;
});
ipcMain.handle("agentapp:get-window-mode", () => windowMode);

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  // 트레이로 내려 있을 때는 종료하지 않는다. 트레이 메뉴의 '종료' 가
  // isQuitting=true 로 명시적으로 종료시킨다.
  if (process.platform !== "darwin" && isQuitting) app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  dashboardServer?.server.close();
  tray?.destroy();
});
