import { app, BrowserWindow, shell, globalShortcut, Tray, Menu, ipcMain, screen, nativeImage } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let dashboardServer;
let mainWindow;
let tray;
let windowMode = "full"; // "full" | "compact"
let isQuitting = false;
let savedFullBounds = null;

// 컴팩트/풀 모드 사용자 선호도를 재시작 후에도 유지하기 위한 영속 저장.
// userData/window-mode.json 에 { mode: "compact"|"full" } 형태로 기록.
function windowModeFile() {
  try {
    return path.join(app.getPath("userData"), "window-mode.json");
  } catch {
    return "";
  }
}
function loadPersistedWindowMode() {
  const file = windowModeFile();
  if (!file) return "full";
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.mode === "compact" ? "compact" : "full";
  } catch {
    return "full";
  }
}
function savePersistedWindowMode(mode) {
  const file = windowModeFile();
  if (!file) return;
  try {
    writeFileSync(file, JSON.stringify({ mode: mode === "compact" ? "compact" : "full" }), "utf8");
  } catch {
    // best-effort — 영속 저장 실패해도 동작은 그대로.
  }
}

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

// React renderer 가 mount 되기 전에 발생한 update-available/downloaded 이벤트도
// 받을 수 있도록 마지막 상태를 main process 에 캐싱. IPC 로 조회 가능.
//   status = "idle"        — 업데이트 정보 없음 (앱 시작 직후 또는 미패키지 dev)
//          "current"      — 최신 버전 확인 완료 (lastCheckedAt 함께 기록)
//          "checking"     — 현재 업데이트 체크 중
//          "available"    — 새 버전 발견, 다운로드 중
//          "downloaded"   — 다운로드 완료, 재시작 시 적용 (또는 "지금 적용" 가능)
//          "error"        — 체크/다운로드 실패
let latestUpdateStatus = { status: "idle", version: "", lastCheckedAt: 0, error: "" };
// quitAndInstall 호출 가능하도록 autoUpdater 인스턴스를 모듈 스코프에 보관.
let autoUpdaterRef = null;

function emitUpdateStatus() {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("agentapp:update-status", latestUpdateStatus);
  }
  // 다운로드 완료 시 트레이 메뉴에 "지금 재시작하여 적용" 항목 노출.
  rebuildTrayMenu();
}

async function bootstrapAutoUpdater() {
  if (!app.isPackaged) return;
  if (process.env.AGENTAPP_DISABLE_AUTOUPDATE === "1") return;
  try {
    const updaterModule = await import("electron-updater");
    const autoUpdater = updaterModule.autoUpdater || updaterModule.default?.autoUpdater;
    if (!autoUpdater) return;
    autoUpdaterRef = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => {
      process.stderr.write("[updater] checking\n");
      latestUpdateStatus = { ...latestUpdateStatus, status: "checking", error: "" };
      emitUpdateStatus();
    });
    autoUpdater.on("update-available", (info) => {
      process.stderr.write(`[updater] available ${info?.version}\n`);
      latestUpdateStatus = {
        status: "available",
        version: String(info?.version || ""),
        lastCheckedAt: Date.now(),
        error: "",
      };
      // backward-compat (이전 채널 청취자 유지)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("agentapp:update-available", { version: info?.version });
      }
      emitUpdateStatus();
    });
    autoUpdater.on("update-not-available", (info) => {
      process.stderr.write("[updater] up-to-date\n");
      latestUpdateStatus = {
        status: "current",
        version: String(info?.version || app.getVersion() || ""),
        lastCheckedAt: Date.now(),
        error: "",
      };
      emitUpdateStatus();
    });
    autoUpdater.on("download-progress", (p) => {
      process.stderr.write(`[updater] download ${Math.round(p.percent || 0)}%\n`);
    });
    autoUpdater.on("update-downloaded", (info) => {
      process.stderr.write(`[updater] downloaded ${info?.version}\n`);
      latestUpdateStatus = {
        status: "downloaded",
        version: String(info?.version || ""),
        lastCheckedAt: Date.now(),
        error: "",
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("agentapp:update-downloaded", { version: info?.version });
      }
      emitUpdateStatus();
      // 사용자가 종료할 때 자동 적용. 즉시 적용은 trayMenu 또는 헤더 pill 의
      // quitAndInstall 명시 호출 시.
    });
    autoUpdater.on("error", (error) => {
      const msg = error?.message || String(error);
      process.stderr.write(`[updater] error: ${msg}\n`);
      latestUpdateStatus = {
        ...latestUpdateStatus,
        status: "error",
        error: msg,
        lastCheckedAt: Date.now(),
      };
      emitUpdateStatus();
    });
    // 첫 체크는 창이 뜨고 5초 후, 이후 30분마다.
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 30 * 60 * 1000);
  } catch (error) {
    process.stderr.write(`[updater] init failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

// 사용자가 헤더 pill / 트레이 메뉴 / 알림에서 "지금 재시작하여 적용" 을 누를 때
// 호출. autoInstallOnAppQuit 만으로는 사용자가 X 버튼만 누르고 트레이로 내려
// 가면 quit 이벤트가 안 발생해 영원히 적용 안 되는 문제를 해결한다.
function installUpdateNow() {
  if (!autoUpdaterRef) return false;
  if (latestUpdateStatus.status !== "downloaded") return false;
  try {
    isQuitting = true;
    // isSilent=true → UI 없이 백그라운드 설치, isForceRunAfter=true → 설치 후 자동 실행
    autoUpdaterRef.quitAndInstall(true, true);
    return true;
  } catch (error) {
    process.stderr.write(`[updater] quitAndInstall failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return false;
  }
}

// 헤더 pill "지금 확인" 버튼이 누르는 수동 체크. 30 분 자동 체크와 별개로
// 사용자가 즉시 결과를 보고 싶을 때.
async function checkForUpdatesNow() {
  if (!autoUpdaterRef) return { ok: false, reason: "updater_not_initialized" };
  try {
    await autoUpdaterRef.checkForUpdates();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function createMainWindow() {
  process.env.AGENTAPP_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.AGENTAPP_HANDOFF_DIR = path.join(app.getPath("userData"), "handoff");

  // 사용자가 직전 세션에서 선택한 창 모드를 복원한다. 재시작 시 항상 full 로
  // 돌아가던 회귀를 막아 트레이/버튼 동기화의 source of truth 와 영속 상태가
  // 일치하게 한다.
  windowMode = loadPersistedWindowMode();
  const initialDims = windowMode === "compact" ? COMPACT_WINDOW : FULL_WINDOW;

  const { createDashboardServer } = await import("../../scripts/dashboard-server.mjs");
  dashboardServer = await createDashboardServer();

  mainWindow = new BrowserWindow({
    width: initialDims.width,
    height: initialDims.height,
    minWidth: initialDims.minWidth,
    minHeight: initialDims.minHeight,
    alwaysOnTop: windowMode === "compact",
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

  // 컴팩트 모드로 복원된 경우 우하단 위치로 이동 + alwaysOnTop floating 적용.
  // BrowserWindow 의 width/height 만으로는 위치가 가운데로 가서 컴팩트 모드의
  // 사용자 기대(우하단 작은 창) 와 어긋난다.
  if (windowMode === "compact") {
    try {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const area = display?.workArea || { x: 0, y: 0, width: 1280, height: 800 };
      const margin = 16;
      mainWindow.setBounds({
        x: area.x + area.width - COMPACT_WINDOW.width - margin,
        y: area.y + area.height - COMPACT_WINDOW.height - margin,
        width: COMPACT_WINDOW.width,
        height: COMPACT_WINDOW.height,
      });
      mainWindow.setAlwaysOnTop(true, "floating");
    } catch {
      // best-effort — 위치 적용 실패해도 windowMode 자체는 유지.
    }
  }

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
  const template = [
    { label: "열기", click: () => showMainWindow() },
    {
      label: "컴팩트 채팅 모드",
      type: "checkbox",
      checked: compact,
      click: () => setWindowMode(compact ? "full" : "compact"),
    },
  ];
  // 새 버전이 다운로드 완료 상태면 트레이 메뉴에 "지금 재시작하여 적용" 노출.
  // X 버튼 닫기는 quit 이 아니므로 autoInstallOnAppQuit 가 영원히 안 도는
  // 사용자 케이스를 위한 안전한 적용 경로.
  if (latestUpdateStatus.status === "downloaded" && latestUpdateStatus.version) {
    template.push({ type: "separator" });
    template.push({
      label: `v${latestUpdateStatus.version} 으로 지금 재시작하여 적용`,
      click: () => installUpdateNow(),
    });
  }
  template.push({ type: "separator" });
  template.push({
    label: "종료",
    click: () => {
      isQuitting = true;
      app.quit();
    },
  });
  tray.setContextMenu(Menu.buildFromTemplate(template));
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
  savePersistedWindowMode(windowMode);
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
// 현재 설치된 앱 버전 (package.json 의 version 과 동기) — UI 가 "v0.4.1" 같은
// 표기를 헤더에 보여줄 때 사용.
ipcMain.handle("agentapp:get-app-version", () => app.getVersion());
// React renderer 가 mount 되기 전에 발생한 update-available/downloaded 이벤트도
// 따라잡을 수 있도록 마지막 상태를 IPC 로 제공. 첫 렌더에서 한 번 호출하면
// "이미 다운로드된 새 버전 있음" 같은 상태가 즉시 헤더에 반영된다.
ipcMain.handle("agentapp:get-update-status", () => latestUpdateStatus);
// 사용자가 "지금 재시작하여 적용" 을 명시적으로 누를 때 호출. X 버튼만 누르면
// 트레이로 내려가 quit 이벤트가 발생 안 해 autoInstallOnAppQuit 가 영원히
// 동작 안 하던 문제를 해결.
ipcMain.handle("agentapp:install-update", () => installUpdateNow());
// 사용자가 "지금 확인" 으로 즉시 업데이트 체크를 트리거.
ipcMain.handle("agentapp:check-for-updates", () => checkForUpdatesNow());

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
