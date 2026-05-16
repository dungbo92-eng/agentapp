// Renderer 와 main 사이에서 윈도우 모드 토글, 트레이 숨김 같은 OS-side
// 동작만 노출하는 좁은 IPC bridge. dashboard runtime API 는 그대로
// fetch 로 쓰면 되므로 여기서는 윈도우 컨트롤만 다룬다.
//
// 파일 확장자가 .mjs 라 Electron 28+ 는 이 preload 를 ESM 으로 해석한다.
// ESM 에는 require() 가 정의돼 있지 않아 `const { contextBridge } = require("electron")`
// 로 쓰면 ReferenceError 로 preload 가 silently 실패 → window.agentapp 미정의 →
// renderer 의 desktopApi 가 undefined 가 되어 버전 pill, 트레이로 버튼, 컴팩트 모드 IPC
// 호출이 모두 동작 안 함. 반드시 ESM import 문을 사용한다 (sandbox=false 가 main.mjs
// 의 webPreferences 에 이미 적용돼 있어야 import 가 동작).
import { contextBridge, ipcRenderer } from "electron";

function onChannel(channel, handler) {
  const subscription = (_event, payload) => {
    try {
      handler(payload);
    } catch {
      /* renderer handler crashed — swallow to avoid breaking main */
    }
  };
  ipcRenderer.on(channel, subscription);
  return () => ipcRenderer.removeListener(channel, subscription);
}

contextBridge.exposeInMainWorld("agentapp", {
  setWindowMode: (mode) => ipcRenderer.invoke("agentapp:set-window-mode", mode),
  hideToTray: () => ipcRenderer.invoke("agentapp:hide-to-tray"),
  getWindowMode: () => ipcRenderer.invoke("agentapp:get-window-mode"),
  onWindowModeChanged: (handler) => onChannel("agentapp:window-mode-changed", handler),
  // 버전/업데이트 표시용 IPC. 헤더가 "v0.4.1" 또는 "v0.4.1 → v0.4.2 사용 가능"
  // 같은 상태를 보여줄 수 있도록 현재 설치 버전과 최신 업데이트 상태를 노출.
  getAppVersion: () => ipcRenderer.invoke("agentapp:get-app-version"),
  getUpdateStatus: () => ipcRenderer.invoke("agentapp:get-update-status"),
  onUpdateAvailable: (handler) => onChannel("agentapp:update-available", handler),
  onUpdateDownloaded: (handler) => onChannel("agentapp:update-downloaded", handler),
  // 통합 상태 채널 — checking/current/available/downloaded/error 모두 한 채널로 받음.
  onUpdateStatus: (handler) => onChannel("agentapp:update-status", handler),
  // 사용자가 "지금 재시작하여 적용" 을 누를 때. X 버튼만 누르면 트레이로 내려가
  // quit 이 발생 안 해 autoInstallOnAppQuit 가 동작 안 하는 문제를 직접 해결.
  installUpdate: () => ipcRenderer.invoke("agentapp:install-update"),
  // 30 분 자동 체크와 별개로 사용자가 즉시 확인하고 싶을 때.
  checkForUpdates: () => ipcRenderer.invoke("agentapp:check-for-updates"),
  // 같은 Wi-Fi 의 폰/태블릿에서 대시보드 접속용. 현재 LAN bind 상태 + 적용된 token
  // + 추정 LAN IP 와 그로 만든 접속 URL 들. UI 는 이걸 받아 QR / 복사 버튼을 띄운다.
  getLanAccess: () => ipcRenderer.invoke("agentapp:get-lan-access"),
});
