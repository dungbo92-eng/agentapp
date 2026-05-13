// Renderer 와 main 사이에서 윈도우 모드 토글, 트레이 숨김 같은 OS-side
// 동작만 노출하는 좁은 IPC bridge. dashboard runtime API 는 그대로
// fetch 로 쓰면 되므로 여기서는 윈도우 컨트롤만 다룬다.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agentapp", {
  setWindowMode: (mode) => ipcRenderer.invoke("agentapp:set-window-mode", mode),
  hideToTray: () => ipcRenderer.invoke("agentapp:hide-to-tray"),
  getWindowMode: () => ipcRenderer.invoke("agentapp:get-window-mode"),
  onWindowModeChanged: (handler) => {
    const subscription = (_event, mode) => {
      try {
        handler(mode);
      } catch {
        /* renderer handler crashed — swallow to avoid breaking main */
      }
    };
    ipcRenderer.on("agentapp:window-mode-changed", subscription);
    return () => ipcRenderer.removeListener("agentapp:window-mode-changed", subscription);
  },
});
