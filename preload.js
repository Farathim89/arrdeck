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
  moveApp: (id, where) => ipcRenderer.invoke("settings:move", { id, ...where }),
  findKeys: () => ipcRenderer.invoke("settings:find-keys"),
  keyDir: (remove) => ipcRenderer.invoke("settings:key-dir", remove),
  updateClick: () => ipcRenderer.send("update:click"),
  updateCheck: () => ipcRenderer.send("update:check"),
  openData: () => ipcRenderer.send("settings:open-data"),
  closeSettings: () => ipcRenderer.send("settings:close"),
  onSettings: on("settings"),
  // Home
  refresh: () => ipcRenderer.send("home:refresh"),
  onHome: on("home"),
  onAlerts: on("alerts"),
  open: (id, path) => ipcRenderer.send("home:open", { id, path }),
  queueAction: (app, qid, action) => ipcRenderer.invoke("home:queue-action", { app, qid, action }),
  requestAction: (app, id, action) => ipcRenderer.invoke("home:request-action", { app, id, action }),
  searchMissing: (app, key, all, list) => ipcRenderer.invoke("home:missing-search", { app, key, all: !!all, list }),
  openExternal: (url) => ipcRenderer.send("open-external", url),
});
