import { app, BrowserWindow, shell, globalShortcut, Tray, Menu, ipcMain, screen, nativeImage, Notification } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

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

  // LAN 접속 토글에 따라 host 를 결정. 켜져 있으면 0.0.0.0 으로 바인딩해 같은 Wi-Fi
  // 안의 모바일/태블릿에서 토큰 URL 로 접근 가능. 토글 변경은 앱 재시작 후 적용
  // (이미 listen 한 서버의 bind 주소는 바꿀 수 없음).
  let initialLanSettings = { lanAccessEnabled: false, lanAccessToken: "" };
  try {
    const { getRuntimeSettings } = await import("../../scripts/dashboard-runtime.mjs");
    const s = await getRuntimeSettings();
    initialLanSettings = {
      lanAccessEnabled: Boolean(s.lanAccessEnabled),
      lanAccessToken: String(s.lanAccessToken || ""),
    };
  } catch {
    // settings 읽기 실패 시 안전 default (LAN off).
  }

  const { createDashboardServer } = await import("../../scripts/dashboard-server.mjs");
  dashboardServer = await createDashboardServer({
    host: initialLanSettings.lanAccessEnabled ? "0.0.0.0" : "127.0.0.1",
    lanAccessToken: initialLanSettings.lanAccessToken,
  });

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
      // 인앱 브라우저 (<webview> 태그) 활성화. React 안에서 <webview src="..." />
      // 로 외부 사이트를 안전한 격리 환경에서 렌더할 수 있다.
      webviewTag: true,
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

  // Windows Electron 의 잘 알려진 입력 캡처 손실 — BrowserWindow.focus() 는
  // OS 창 활성화만 처리하고 webContents (renderer) 의 키보드 입력 캡처는 보장
  // 하지 않는다. 다른 앱/오버레이/webview 로 포커스가 갔다가 돌아오면 입력창에
  // 커서가 안 잡혀 사용자가 "최소화 후 복귀" 같은 회피 동작을 해야 한다.
  // 창 활성화 이벤트마다 webContents.focus() 를 명시 호출해 입력 캡처를 복원.
  const refocusWebContents = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
      wc.focus();
    } catch {
      // best-effort — 일부 상태에서는 focus() 가 throw 할 수 있어 안전 처리.
    }
  };
  mainWindow.on("focus", refocusWebContents);
  mainWindow.on("show", refocusWebContents);
  mainWindow.on("restore", refocusWebContents);
  // alwaysOnTop / fullscreen / 모드 전환 직후도 키 캡처 복원이 필요.
  mainWindow.on("always-on-top-changed", refocusWebContents);
  mainWindow.on("ready-to-show", refocusWebContents);

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

  void bootstrapNotificationDispatcher();

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

// OS 알림 — dashboard-runtime 의 notifications 배열을 2 초마다 polling 해
// 새 항목이 보이면 Electron Notification 으로 발송. dashboard UI 가 toast 로 표시
// 하든 dismiss 하든 무관하게, 한 알림 id 는 한 번만 OS 알림으로 발송된다.
// 사용자가 dashboard 를 트레이로 내려도 OS 알림으로 작업 완료/대기/사용자 답변
// 필요 같은 이벤트를 인지할 수 있다.
const seenNotificationIds = new Set();
async function bootstrapNotificationDispatcher() {
  let osSupported = Notification.isSupported();
  if (!osSupported) {
    process.stderr.write("[notify] Electron Notification not supported on this platform\n");
  }
  const tick = async () => {
    try {
      const mod = await import("../../scripts/dashboard-runtime.mjs");
      const runtime = await mod.readRuntime();
      const notifs = Array.isArray(runtime.notifications) ? runtime.notifications : [];
      for (const n of notifs) {
        if (!n?.id || seenNotificationIds.has(n.id)) continue;
        seenNotificationIds.add(n.id);
        if (osSupported) {
          try {
            const urgency = n.kind === "awaiting" || n.kind === "blocked" || n.kind === "error" ? "critical" : "normal";
            const notif = new Notification({
              title: String(n.title || "AgentApp"),
              body: String(n.message || ""),
              urgency,
              silent: false,
            });
            // 사용자가 OS 알림 클릭하면 dashboard 창을 다시 띄움
            notif.on("click", () => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
              }
            });
            notif.show();
          } catch (error) {
            process.stderr.write(`[notify] show failed: ${error?.message || error}\n`);
          }
        }
      }
      // seen set 정리 — 너무 커지지 않게.
      if (seenNotificationIds.size > 200) {
        const arr = Array.from(seenNotificationIds);
        seenNotificationIds.clear();
        arr.slice(-100).forEach((id) => seenNotificationIds.add(id));
      }
    } catch {
      /* runtime not ready yet; ignore */
    }
  };
  // 첫 tick 은 2 초 후, 이후 2 초 간격으로.
  setTimeout(() => { void tick(); }, 2000);
  setInterval(() => { void tick(); }, 2000);
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
  // 트레이 클릭 / OS 알림 클릭으로 들어온 직후엔 webContents 입력 캡처가
  // 안 살아 있는 경우가 많다. focus 이벤트 핸들러가 또 호출해주지만, 명시적
  // 으로 한 번 더 부른다.
  const wc = mainWindow.webContents;
  if (wc && !wc.isDestroyed()) {
    try { wc.focus(); } catch { /* best-effort */ }
  }
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
    // 모드 토글 직후 (alwaysOnTop 변경 / 창 크기 재배치) webContents 입력 캡처가
    // 끊기는 경우가 있어 명시 복원.
    try { mainWindow.webContents.focus(); } catch { /* best-effort */ }
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

// ===== 인앱 터미널 (node-pty 기반) =====
// renderer 가 terminal:create 로 새 PTY 시작 → main 이 stdout 을 terminal:data 로
// 푸시 → renderer 의 xterm.js 가 화면에 그림. renderer 입력은 terminal:write 로 전달.
// 다중 탭을 위해 sessionId 로 관리. renderer 가 종료(unmount)할 때 terminal:kill 호출.
const ptySessions = new Map();
let ptyModule = null;
async function loadPtyModule() {
  if (ptyModule) return ptyModule;
  try {
    // Homebridge 의 node-pty prebuilt fork — Windows 에서 ConPTY 바이너리를
    // postinstall 시 자동 복사하므로 winpty native 빌드가 필요 없음. Linux/macOS
    // 도 prebuilt 제공. CommonJS native 모듈이라 createRequire 로 로드.
    const { createRequire } = await import("node:module");
    const requireFn = createRequire(import.meta.url);
    ptyModule = requireFn("@homebridge/node-pty-prebuilt-multiarch");
    return ptyModule;
  } catch (error) {
    process.stderr.write(`[pty] load failed: ${error?.message || error}\n`);
    return null;
  }
}
function defaultShell() {
  if (process.platform === "win32") {
    // Windows 10 / 11 / Server 2019+ 는 powershell.exe, 그 외 fallback cmd.
    return process.env.COMSPEC || "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}
ipcMain.handle("agentapp:terminal-create", async (_event, options = {}) => {
  const pty = await loadPtyModule();
  if (!pty) return { ok: false, reason: "node-pty 로드 실패. native module 빌드를 확인하세요." };
  const sessionId = String(options?.sessionId || `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const cwd = String(options?.cwd || process.cwd());
  const cols = Number(options?.cols || 100);
  const rows = Number(options?.rows || 28);
  const shell = String(options?.shell || defaultShell());
  try {
    const proc = pty.spawn(shell, [], {
      name: "xterm-color",
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: "xterm-256color" },
    });
    ptySessions.set(sessionId, proc);
    proc.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("agentapp:terminal-data", { sessionId, data });
      }
    });
    proc.onExit(({ exitCode, signal }) => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("agentapp:terminal-exit", { sessionId, exitCode, signal });
      }
      ptySessions.delete(sessionId);
    });
    return { ok: true, sessionId, shell, cwd };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
});
ipcMain.handle("agentapp:terminal-write", (_event, options = {}) => {
  const sessionId = String(options?.sessionId || "");
  const data = String(options?.data || "");
  const proc = ptySessions.get(sessionId);
  if (!proc) return { ok: false, reason: "no-session" };
  try {
    proc.write(data);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
});
ipcMain.handle("agentapp:terminal-resize", (_event, options = {}) => {
  const sessionId = String(options?.sessionId || "");
  const cols = Math.max(1, Number(options?.cols || 100));
  const rows = Math.max(1, Number(options?.rows || 28));
  const proc = ptySessions.get(sessionId);
  if (!proc) return { ok: false, reason: "no-session" };
  try {
    proc.resize(cols, rows);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
});
ipcMain.handle("agentapp:terminal-kill", (_event, options = {}) => {
  const sessionId = String(options?.sessionId || "");
  const proc = ptySessions.get(sessionId);
  if (!proc) return { ok: false, reason: "no-session" };
  try {
    proc.kill();
    ptySessions.delete(sessionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
});
// 앱 종료 시 모든 PTY 세션 정리.
app.on("before-quit", () => {
  for (const proc of ptySessions.values()) {
    try { proc.kill(); } catch { /* ignore */ }
  }
  ptySessions.clear();
});

// 같은 Wi-Fi 의 폰/태블릿에서 대시보드 접속할 때 사용. main 이 알고 있는 정보는
// 현재 LAN bind 여부 + 시작 시 적용된 token + 추정 LAN IP. URL 변경 (settings toggle)
// 은 다음 앱 재시작 후 반영되므로 needsRestart 도 함께 알려준다.
// 같은 PC 에 여러 인터페이스가 있을 때 (Wi-Fi + Tailscale + Docker bridge 등) 어떤
// IP 가 어디서 쓰는 건지 사용자가 헷갈리지 않도록 종류로 분류.
//   - tailscale: 100.64.0.0/10 (Tailscale CGNAT 대역, 인터넷 어디서나 본인 기기끼리 P2P)
//   - lan: 192.168/16, 10/8, 172.16-31/12 (집/회사 사설망, 같은 Wi-Fi 한정)
//   - link-local: 169.254/16 (DHCP 실패 시 자체 할당, 보통 무시)
//   - public: 그 외 (외부 노출 가능, 거의 안 잡힘 — 잡혀도 토큰 보호하긴 하지만 권장 안 함)
function classifyIp(address, interfaceName) {
  const ip = String(address || "");
  const parts = ip.split(".").map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return "other";
  }
  const [a, b] = parts;
  if (a === 100 && b >= 64 && b <= 127) return "tailscale";
  if (a === 192 && b === 168) return "lan";
  if (a === 10) return "lan";
  if (a === 172 && b >= 16 && b <= 31) return "lan";
  if (a === 169 && b === 254) return "link-local";
  // 인터페이스 이름이 명백히 Tailscale 인 경우도 같이 분류 (Windows 의 "Tailscale" adapter 등)
  if (/tailscale/i.test(String(interfaceName || ""))) return "tailscale";
  return "public";
}

function detectLanIps() {
  try {
    const interfaces = networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(interfaces || {})) {
      for (const info of interfaces[name] || []) {
        if (info && info.family === "IPv4" && !info.internal) {
          const kind = classifyIp(info.address, name);
          // link-local 은 UX 에 노출 안 함 (DHCP 못 받은 상태라 의미 없음)
          if (kind === "link-local") continue;
          candidates.push({ address: info.address, interface: name, kind });
        }
      }
    }
    // tailscale 먼저, 그 다음 LAN, 그 다음 나머지 — UI 가 목록 순서대로 보여줘도 권장 순.
    const priority = { tailscale: 0, lan: 1, public: 2, other: 3 };
    candidates.sort((a, b) => (priority[a.kind] ?? 9) - (priority[b.kind] ?? 9));
    return candidates;
  } catch {
    return [];
  }
}
ipcMain.handle("agentapp:get-lan-access", async () => {
  let runtimeSettings = { lanAccessEnabled: false, lanAccessToken: "" };
  try {
    const { getRuntimeSettings } = await import("../../scripts/dashboard-runtime.mjs");
    runtimeSettings = await getRuntimeSettings();
  } catch {
    /* best-effort */
  }
  const boundHost = dashboardServer?.host || "127.0.0.1";
  const port = dashboardServer?.port || 0;
  const isLanBound = boundHost === "0.0.0.0" || boundHost === "::";
  const lanIps = isLanBound ? detectLanIps() : [];
  const token = String(runtimeSettings.lanAccessToken || "");
  const enabledNow = Boolean(runtimeSettings.lanAccessEnabled);
  // 각 IP 의 종류 (tailscale/lan/public) 까지 같이 내려 UI 에서 배지로 구분 가능하게.
  // urls 는 호환 위해 평탄한 string 배열로 유지, entries 가 풍부한 정보.
  const entries = isLanBound && token
    ? lanIps.map((ip) => ({
        url: `http://${ip.address}:${port}/?t=${encodeURIComponent(token)}`,
        address: ip.address,
        kind: ip.kind,
        interface: ip.interface,
      }))
    : [];
  return {
    enabled: enabledNow,
    boundLan: isLanBound,
    needsRestart: enabledNow !== isLanBound,
    token,
    port,
    urls: entries.map((entry) => entry.url),
    entries,
    ips: lanIps.map((ip) => ip.address),
    // Tailscale 가 PC 에 설치돼 있는지 (인터페이스에 100.64/10 가 잡히는지) 힌트.
    hasTailscale: lanIps.some((ip) => ip.kind === "tailscale"),
  };
});

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
