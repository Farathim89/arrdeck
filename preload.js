// Bridge for ArrDeck's own pages (title bar, settings, Home). The apps' web pages don't get this.
const { contextBridge, ipcRenderer } = require("electron");

const on = (channel) => (fn) => {
  const h = (_e, v) => fn(v);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld("arrdeck", {
  // title bar
  getState: () => ipcRenderer.invoke("state:get"),
  onState: on("state"),
  onFocus: on("focus"),
  select: (id) => ipcRenderer.send("tab:select", id),
  nav: (action) => ipcRenderer.send("tab:nav", action),
  toggleSettings: () => ipcRenderer.send("settings:toggle"),
  // settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", { key, value }),
  setApp: (id, patch) => ipcRenderer.invoke("settings:app", { id, patch }),
  setKey: (id, key) => ipcRenderer.invoke("settings:key", { id, key }),
  testApp: (id) => ipcRenderer.invoke("settings:test", id),
  signOut: (id) => ipcRenderer.invoke("settings:signout", id),
  addApp: (app) => ipcRenderer.invoke("settings:add-app", app),
  removeApp: (id) => ipcRenderer.invoke("settings:remove-app", id),
  updateClick: () => ipcRenderer.send("update:click"),
  updateCheck: () => ipcRenderer.send("update:check"),
  openData: () => ipcRenderer.send("settings:open-data"),
  closeSettings: () => ipcRenderer.send("settings:close"),
  onSettings: on("settings"),
  // Home
  refresh: () => ipcRenderer.send("home:refresh"),
  onHome: on("home"),
  open: (id, path) => ipcRenderer.send("home:open", { id, path }),
  openExternal: (url) => ipcRenderer.send("open-external", url),
});
