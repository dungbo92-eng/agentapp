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
  // 인앱 터미널 (node-pty 기반) — 다중 세션을 sessionId 로 구분.
  terminal: {
    create: (options) => ipcRenderer.invoke("agentapp:terminal-create", options || {}),
    write: (sessionId, data) => ipcRenderer.invoke("agentapp:terminal-write", { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke("agentapp:terminal-resize", { sessionId, cols, rows }),
    kill: (sessionId) => ipcRenderer.invoke("agentapp:terminal-kill", { sessionId }),
    onData: (handler) => onChannel("agentapp:terminal-data", handler),
    onExit: (handler) => onChannel("agentapp:terminal-exit", handler),
  },
  // 클립보드 paste — prompt textarea 에서 이미지/엑셀 테이블을 paste 했을 때
  // renderer 가 호출. 이미지는 PNG 로 userData/clipboard-attachments/ 에 저장하고
  // 그 절대 경로를 반환 → renderer 가 prompt 본문에 "[clipboard image: <path>]"
  // 형태로 삽입 → worker (claude/codex) 가 그 경로를 Read tool 로 읽어 분석.
  // 엑셀 테이블은 HTML/CSV 를 받아 main 에서 markdown table 로 변환 후 반환.
  clipboard: {
    // 현재 클립보드 내용 종류 + preview 를 반환. UI 가 paste 직전 어떤 종류로
    // 처리할지 결정할 때 사용.
    inspect: () => ipcRenderer.invoke("agentapp:clipboard-inspect"),
    // 이미지가 있으면 임시 파일로 저장하고 경로 반환. 없으면 null.
    saveImage: (options) => ipcRenderer.invoke("agentapp:clipboard-save-image", options || {}),
    // HTML/text 를 markdown 으로 변환해 반환. 엑셀/구글 시트의 셀 영역을 복사한
    // 경우 HTML <table> 이 들어 있어 markdown table 로 변환된다.
    asMarkdown: () => ipcRenderer.invoke("agentapp:clipboard-as-markdown"),
  },
});
