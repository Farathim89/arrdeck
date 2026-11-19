// ===========================================================================
// ArrDeck — Sonarr, Radarr, Lidarr, Prowlarr, Seerr (and Readarr, Bazarr,
// Jellyseerr) in one window.
//
// Layout: the window shows our title bar with a tab per app (titlebar.html).
// Each app's web UI runs in its own WebContentsView under it, with its own
// saved session (partition), so every app keeps its own sign-in between runs.
// Home (home.html) is a dashboard built from the apps' APIs. Settings open as
// an overlay view on top.
// ===========================================================================

const {
  app, BrowserWindow, WebContentsView, ipcMain, shell, session, nativeTheme, safeStorage, screen,
  Tray, Menu, Notification, dialog,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { APPS, STYLE_FOR_KIND, TYPES, CUSTOM_COLORS } = require("./apps");
const { fetchDashboard, isUp, queueAction, requestAction, searchMissing, fetchWanted, FULL_LIST } = require("./dashboard");
const createUpdater = require("./update");
const { findKeys } = require("./keyfinder");

// ---- data folder -----------------------------------------------------------
// Fully portable: settings and sign-ins live in "ArrDeck-data" next to ArrDeck.exe
// (the single .exe unpacks itself to Temp and says where it really is in
// PORTABLE_EXECUTABLE_DIR). "--data-dir=<folder>" uses another folder (tests).
// Started with "electron ." while developing: the project's own ArrDeck-data.
const dataArg = process.argv.find((a) => a.startsWith("--data-dir="));
const exeHome = process.env.PORTABLE_EXECUTABLE_DIR
  || (app.isPackaged ? path.dirname(process.execPath) : __dirname);
const DATA = dataArg ? path.resolve(dataArg.slice(11)) : path.join(exeHome, "ArrDeck-data");
app.setPath("userData", DATA);
app.setPath("sessionData", DATA);
app.setPath("crashDumps", path.join(DATA, "Crashpad"));
app.setPath("logs", path.join(DATA, "logs"));
const CONFIG_FILE = path.join(DATA, "config.json");

const DEFAULTS = {
  apps: {},              // id -> { on, url, path }
  keys: {},              // id -> { enc, v } (API keys, encrypted with Windows' DPAPI)
  zoom: {},              // id -> zoom level
  highContrast: true,    // the High contrast look inside the apps
  homeDays: 7,
  refreshSecs: 60,
  updateCheck: true,     // look for a new ArrDeck on GitHub now and then
  custom: [],            // apps you added: { id, name, url, type }
  order: [],             // your tab order (app ids)
  minimizeToTray: true,  // minimise = into the tray (keeps watching downloads)
  closeToTray: false,    // ✕ = into the tray instead of quitting
  startWithWindows: false,
  startMenu: false,      // a Start menu entry (outside ArrDeck's folder, so opt-in)
  notifyDownloads: true, // "Downloaded: …" when something leaves the queue finished
  notifyHealth: true,    // new health warnings / errors, an app that stops answering
  notifyRequests: true,  // a new Seerr request waiting for approval
  keyDirs: [],           // extra folders to look for API keys in
  lastTab: "home",
  window: null,
};
function readConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) }; } catch { return { ...DEFAULTS }; }
}
let config = readConfig();
let saveTimer = null;
function saveConfig(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      fs.mkdirSync(DATA, { recursive: true });
      fs.writeFileSync(CONFIG_FILE + ".tmp", JSON.stringify(config, null, 2));
      fs.renameSync(CONFIG_FILE + ".tmp", CONFIG_FILE);
    } catch (err) { console.error("config", err); }
  };
  if (now) write(); else saveTimer = setTimeout(write, 500);
}

// ArrDeck ignores the Windows theme. A Windows contrast theme would make Chromium swap
// every page colour for Windows' own ("forced colours"): switch that off for good, so
// ArrDeck's and the apps' own colours always show. (See also ignoreWindowsTheme.)
app.commandLine.appendSwitch("disable-blink-features", "ForcedColors");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const APP_ID = "com.farathim.arrdeck";
app.setAppUserModelId(APP_ID);
// Started by Windows at sign-in ("Start with Windows"): straight to the tray.
const startHidden = process.argv.includes("--hidden");
let isQuitting = false;

const ICON = path.join(__dirname, "build", "icon.ico");
const PRELOAD = path.join(__dirname, "preload.js");
const TITLE_H = 38;
const BG = "#000000";
const OWN = { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true };

// ---- apps ------------------------------------------------------------------
// The built-in apps, then the ones you added yourself (config.custom: { id, name, url, type }).
function appList() {
  const custom = (config.custom || []).filter((c) => TYPES[c.type]).map((c, i) => ({
    id: c.id, name: c.name, url: c.url, kind: TYPES[c.type].kind, media: TYPES[c.type].media,
    on: true, color: CUSTOM_COLORS[i % CUSTOM_COLORS.length], custom: true, type: c.type,
  }));
  const list = APPS.concat(custom).map((a) => {
    const c = config.apps[a.id] || {};
    return {
      ...a, on: c.on ?? a.on, url: (c.url || a.url).replace(/\/+$/, ""), path: c.path || "",
      name: (c.name || "").trim() || a.name, defaultName: a.name,
    };
  });
  // Your order (Settings > Apps arrows, or drag a tab); apps not in it keep their place after.
  const order = config.order || [];
  const rank = (a) => { const i = order.indexOf(a.id); return i < 0 ? order.length + list.indexOf(a) : i; };
  return list.sort((a, b) => rank(a) - rank(b));
}
// Move a tab: before another one (dragging), or one place up / down (the arrows).
function moveApp(id, { before, dir } = {}) {
  const ids = appList().map((a) => a.id);
  const from = ids.indexOf(id);
  if (from < 0) return;
  ids.splice(from, 1);
  let to = from;
  if (dir) {
    // Skip the switched-off apps, so one click moves one tab.
    const all = appList();
    const on = (x) => (all.find((a) => a.id === x) || {}).on;
    to = from + (dir < 0 ? -1 : 0);
    if (dir < 0) { while (to > 0 && !on(ids[to])) to--; } else { while (to < ids.length && !on(ids[to])) to++; to++; }
    to = Math.max(0, Math.min(ids.length, to));
  } else if (before === null) to = ids.length;
  else if (ids.includes(before)) to = ids.indexOf(before);
  ids.splice(to, 0, id);
  config.order = ids;
  saveConfig();
}
function cleanUrl(u) {
  u = String(u || "").trim().replace(/\/+$/, "");
  if (!u) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) && !/^https?:\/\//i.test(u)) return null;   // ftp://, file://…
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  try { if (!new URL(u).hostname) return null; } catch { return null; }
  return u;
}
const enabledApps = () => appList().filter((a) => a.on);
const appById = (id) => appList().find((a) => a.id === id);
function setAppConfig(id, patch) {
  config.apps[id] = { ...(config.apps[id] || {}), ...patch };
  saveConfig();
}

function getKey(id) {
  const k = config.keys[id];
  if (!k) return "";
  try { return k.enc ? safeStorage.decryptString(Buffer.from(k.v, "base64")) : k.v; } catch { return ""; }
}
function setKey(id, key) {
  key = String(key || "").trim();
  if (!key) delete config.keys[id];
  else if (safeStorage.isEncryptionAvailable()) config.keys[id] = { enc: true, v: safeStorage.encryptString(key).toString("base64") };
  else config.keys[id] = { enc: false, v: key };
  saveConfig();
}

// ---- High contrast styles ---------------------------------------------------
// The .user.css files are Stylus user styles: drop the ==UserStyle== header and
// the @-moz-document wrapper, keep the rules.
function userStyleBody(text) {
  text = text.replace(/\/\*\s*==UserStyle==[\s\S]*?==\/UserStyle==\s*\*\//, "");
  const m = /@-moz-document[^{]*\{/.exec(text);
  if (!m) return text;
  return text.slice(m.index + m[0].length, text.lastIndexOf("}"));
}
const styleCache = {};
function styleFor(kind) {
  const file = STYLE_FOR_KIND[kind];
  if (!file) return "";
  if (!(file in styleCache)) {
    try { styleCache[file] = userStyleBody(fs.readFileSync(path.join(__dirname, "themes", file), "utf8")); } catch { styleCache[file] = ""; }
  }
  return styleCache[file];
}
// Bits the shared style files don't cover yet (Seerr's eye button by the password box).
const EXTRA_STYLE = {
  seerr: ".input-action { background-color: #332b00 !important; border-color: #ffd700 !important; color: #ffd700 !important; }",
};
const NO_FORCED_COLORS = ":root, *, *::before, *::after { forced-color-adjust: none !important; }";

// ---- window & views ----------------------------------------------------------
let win = null;
let settingsView = null;
const views = new Map();   // id -> { view, app, loaded, failed, css: [], retry }
let active = null;
let dash = null;           // last dashboard result
let dashTimer = null;
const status = {};         // id -> "up" | "down" | "warn" | "error" | ""

const wc = (id = active) => (views.get(id) ? views.get(id).view.webContents : null);

// A thin border round the window (drawn by the title-bar page behind the views),
// none when maximised or full screen.
const framed = () => !!win && !win.isMaximized() && !win.isFullScreen();
function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  const top = win.isFullScreen() ? 0 : TITLE_H;
  const edge = framed() ? 1 : 0;
  const b = { x: edge, y: top, width: Math.max(0, width - 2 * edge), height: Math.max(0, height - top - edge) };
  for (const v of views.values()) v.view.setBounds(b);
  if (settingsView) settingsView.setBounds(b);
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}
// Plex sign-in (Seerr's "Sign in with Plex") opens plex.tv in a pop-up.
const isPlexAuth = (url) => /^https:\/\/([a-z0-9-]+\.)*plex\.tv(\/|$)/i.test(url);

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

async function applyCss(entry) {
  const c = entry.view.webContents;
  for (const key of entry.css) c.removeInsertedCSS(key).catch(() => {});
  entry.css = [];
  if (!entry.app) return;   // Home styles itself
  const parts = [NO_FORCED_COLORS];
  const style = config.highContrast ? `${styleFor(entry.app.kind)}\n${EXTRA_STYLE[entry.app.kind] || ""}` : "";
  if (style) {
    // The style as it is (it has the rules for html / body / :root), plus a copy with every rule
    // raised above the page's own: Seerr marks some colours !important with a class
    // (Tailwind's "!bg-gray-700/80"), which beats a plain "input { … !important }".
    parts.push(style, `:root:not(#arrdeck-boost) {\n${style}\n}`);
  }
  for (const css of parts) {
    try { entry.css.push(await c.insertCSS(css)); } catch {}
  }
}

// Ignore the Windows theme: dark mode, normal contrast and no forced (contrast theme) colours,
// whatever Windows is set to. Chromium's own page emulation does it per page and keeps it
// across navigations.
function ignoreWindowsTheme(c) {
  try {
    if (!c.debugger.isAttached()) c.debugger.attach("1.3");
    c.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-color-scheme", value: "dark" },
        { name: "forced-colors", value: "none" },
        { name: "prefers-contrast", value: "no-preference" },
      ],
    }).catch(() => {});
  } catch (err) { console.error("theme", err.message); }
}

function errorPage(a, desc) {
  const esc = (s) => String(s).replace(/[<>&"]/g, "");
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#fff;font:15px 'Segoe UI',sans-serif;forced-color-adjust:none">
    <div style="text-align:center;border:2px solid #fff;padding:28px 40px;max-width:560px">
    <h2 style="color:#ffd700;margin-top:0">${esc(a.name)} isn't answering</h2>
    <p>Nothing replies at <b>${esc(a.url)}</b> (${esc(desc)}).</p>
    <p>Is ${esc(a.name)} running? ArrDeck tries again by itself every 15 seconds, or press <b style="color:#ffd700">F5</b>.</p>
    <p style="color:#ccc">The address can be changed in ArrDeck's settings (gear, top right).</p></div></body>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

function loadApp(entry, url) {
  const a = entry.app;
  entry.loaded = true;
  entry.failed = false;
  clearInterval(entry.retry);
  entry.view.webContents.loadURL(url || a.url + (a.path || "")).catch(() => {});
}

function createAppView(a) {
  const view = new WebContentsView({
    webPreferences: { partition: `persist:${a.id}`, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  view.setBackgroundColor(BG);
  view.setVisible(false);
  const entry = { view, app: a, loaded: false, failed: false, css: [], retry: null };
  const c = view.webContents;
  c.setZoomLevel(config.zoom[a.id] || 0);
  c.on("dom-ready", () => applyCss(entry));
  ignoreWindowsTheme(c);
  c.on("before-input-event", onShortcut);
  c.on("did-fail-load", (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;   // -3 = aborted (normal)
    entry.failed = true;
    status[a.id] = "down";
    sendState();
    c.loadURL(errorPage(a, desc)).catch(() => {});
    clearInterval(entry.retry);
    entry.retry = setInterval(async () => {
      if (await isUp(entry.app)) loadApp(entry);
    }, 15000);
  });
  // Remember where you were in each app (not the login page).
  const remember = (_e, url) => {
    if (!sameOrigin(url, entry.app.url)) return;
    const u = new URL(url);
    const p = u.pathname + u.search + u.hash;
    const base = new URL(entry.app.url).pathname.replace(/\/+$/, "");
    const rel = p.startsWith(base) ? p.slice(base.length) : p;
    if (/^\/?(login|logout)/i.test(rel)) return;
    setAppConfig(a.id, { path: rel === "/" ? "" : rel });
    if (a.id === active) sendState();
  };
  c.on("did-navigate", remember);
  c.on("did-navigate-in-page", remember);
  c.on("page-title-updated", () => { if (a.id === active) sendState(); });

  // Links: the app's own pages stay here; others open in your browser.
  c.on("will-navigate", (e, url) => {
    if (sameOrigin(url, entry.app.url) || url.startsWith("data:")) return;
    e.preventDefault();
    openExternal(url);
  });
  c.setWindowOpenHandler(({ url }) => {
    if (isPlexAuth(url) || url === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: { parent: win, width: 600, height: 760, autoHideMenuBar: true, backgroundColor: BG, icon: ICON },
      };
    }
    if (sameOrigin(url, entry.app.url)) c.loadURL(url);
    else openExternal(url);
    return { action: "deny" };
  });
  win.contentView.addChildView(view);
  views.set(a.id, entry);
  return entry;
}

function createHomeView() {
  const view = new WebContentsView({ webPreferences: OWN });
  view.setBackgroundColor(BG);
  view.setVisible(false);
  const entry = { view, app: null, loaded: true, failed: false, css: [] };
  ignoreWindowsTheme(view.webContents);
  view.webContents.on("before-input-event", onShortcut);
  view.webContents.on("will-navigate", (e) => e.preventDefault());
  view.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  view.webContents.on("did-finish-load", () => { if (dash) view.webContents.send("home", homePayload()); if (alerts.length) view.webContents.send("alerts", alerts); });
  view.webContents.loadFile(path.join(__dirname, "home.html"));
  win.contentView.addChildView(view);
  views.set("home", entry);
}

// Make the views match the enabled apps (after a settings change too).
function syncViews() {
  const wanted = enabledApps();
  for (const [id, entry] of views) {
    if (id === "home") continue;
    const a = wanted.find((x) => x.id === id);
    if (!a) {
      clearInterval(entry.retry);
      win.contentView.removeChildView(entry.view);
      entry.view.webContents.close();
      views.delete(id);
      continue;
    }
    const urlChanged = a.url !== entry.app.url;
    entry.app = a;
    if (urlChanged && entry.loaded) loadApp(entry, a.url);
  }
  for (const a of wanted) if (!views.has(a.id)) createAppView(a);
  if (!views.has(active)) select("home");
  if (settingsView) win.contentView.addChildView(settingsView);   // keep on top
  layout();
  sendState();
  updateTrayMenu();
}

function select(id) {
  if (!views.has(id)) id = "home";
  active = id;
  config.lastTab = id;
  saveConfig();
  for (const [vid, entry] of views) entry.view.setVisible(vid === id);
  const entry = views.get(id);
  if (entry.app && !entry.loaded) loadApp(entry);
  if (!settingsView) entry.view.webContents.focus();
  if (id === "home") refreshDashboard();
  sendState();
}

function sendState() {
  if (!win) return;
  const c = wc();
  const health = dash ? dash.health.length : 0;
  win.webContents.send("state", {
    active,
    tabs: [{ id: "home", name: "Home", status: health ? (dash.health.some((h) => h.type === "error") ? "error" : "warn") : "", badge: health || "" }]
      .concat(enabledApps().map((a) => ({ id: a.id, name: a.name, status: status[a.id] || "" }))),
    canBack: !!(c && c.navigationHistory.canGoBack()),
    canForward: !!(c && c.navigationHistory.canGoForward()),
    settingsOpen: !!settingsView,
    framed: framed(),
    version: app.getVersion(),
    update: updater ? updater.info().pill : null,
  });
}

function navAction(action) {
  const entry = views.get(active);
  if (!entry) return;
  const c = entry.view.webContents;
  if (action === "back" && c.navigationHistory.canGoBack()) c.navigationHistory.goBack();
  else if (action === "forward" && c.navigationHistory.canGoForward()) c.navigationHistory.goForward();
  else if (action === "reload") {
    if (!entry.app) refreshDashboard(true);
    else if (entry.failed || !entry.loaded) loadApp(entry);
    else c.reload();
  } else if (action === "home" && entry.app) loadApp(entry, entry.app.url);
}

function zoom(dir) {
  const entry = views.get(active);
  if (!entry) return;
  const c = entry.view.webContents;
  const level = dir === 0 ? 0 : Math.max(-4, Math.min(5, c.getZoomLevel() + dir * 0.5));
  c.setZoomLevel(level);
  config.zoom[active] = level;
  saveConfig();
}

function cycle(step) {
  const ids = [...views.keys()];
  const order = ["home", ...enabledApps().map((a) => a.id)].filter((id) => ids.includes(id));
  const i = order.indexOf(active);
  select(order[(i + step + order.length) % order.length]);
}

function onShortcut(event, input) {
  if (input.type !== "keyDown") return;
  const key = input.key;
  const ctrl = input.control || input.meta;
  let action = null;
  if (key === "F5" || (ctrl && !input.shift && key.toLowerCase() === "r")) action = () => navAction("reload");
  else if (key === "F11") action = () => { win.setFullScreen(!win.isFullScreen()); };
  else if (input.alt && !ctrl && key === "ArrowLeft") action = () => navAction("back");
  else if (input.alt && !ctrl && key === "ArrowRight") action = () => navAction("forward");
  else if (input.alt && !ctrl && key === "Home") action = () => navAction("home");
  else if (ctrl && !input.alt && key === ",") action = toggleSettings;
  else if (ctrl && key === "Tab") action = () => cycle(input.shift ? -1 : 1);
  else if (ctrl && !input.alt && /^[1-9]$/.test(key)) {
    const order = ["home", ...enabledApps().map((a) => a.id)];
    const id = order[Number(key) - 1];
    if (id) action = () => select(id);
  } else if (ctrl && input.shift && key.toLowerCase() === "i") action = () => { const c = wc(); if (c) c.toggleDevTools(); };
  else if (ctrl && !input.alt && (key === "=" || key === "+")) action = () => zoom(1);
  else if (ctrl && !input.alt && (key === "-" || key === "_")) action = () => zoom(-1);
  else if (ctrl && !input.alt && key === "0") action = () => zoom(0);
  else if (key === "Escape" && settingsView) action = closeSettings;
  if (action) { event.preventDefault(); action(); }
}

// ---- window state --------------------------------------------------------------
function windowState() {
  const s = config.window;
  if (s && s.width && s.height) {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return s.x < a.x + a.width - 100 && s.x + s.width > a.x + 100 && s.y >= a.y - 10 && s.y < a.y + a.height - 100;
    });
    if (visible) return s;
  }
  return { width: 1280, height: 720 };   // first start: 720p
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const b = maximized || win.isFullScreen() ? (config.window || win.getNormalBounds()) : win.getBounds();
  config.window = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
  saveConfig(true);
}

function createWindow() {
  const st = windowState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height, minWidth: 900, minHeight: 560,
    title: "ArrDeck", icon: ICON, backgroundColor: BG, show: false,
    titleBarStyle: "hidden",
    // 1px shorter than our bar, so the white line under it runs under Windows' buttons too.
    titleBarOverlay: { color: BG, symbolColor: "#ffffff", height: TITLE_H - 1 },
    webPreferences: OWN,
  });
  // (Maximising a hidden window shows it: started in the tray, maximise on first show instead.)
  if (st.maximized && !startHidden) win.maximize();
  else if (st.maximized) win.once("show", () => win.maximize());
  // The portable .exe runs ArrDeck from a copy in Temp: tell Windows the real ArrDeck.exe,
  // so "Pin to taskbar" pins that one (and the pinned button starts it again).
  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE;
    win.setAppDetails({ appId: APP_ID, appIconPath: exe, appIconIndex: 0, relaunchCommand: `"${exe}"`, relaunchDisplayName: "ArrDeck" });
  }
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  ignoreWindowsTheme(win.webContents);
  win.webContents.on("before-input-event", onShortcut);
  win.loadFile(path.join(__dirname, "titlebar.html"));
  win.once("ready-to-show", () => { if (!startHidden || !tray) win.show(); });
  // ✕ quits, or goes to the tray (Settings > Window & alerts). Minimise can go to the tray too.
  win.on("close", (e) => {
    saveWindowState();
    if (!isQuitting && config.closeToTray && tray) { e.preventDefault(); win.hide(); trayHint(); }
  });
  win.on("minimize", () => {
    if (isQuitting || !config.minimizeToTray || !tray) return;
    win.hide();
    trayHint();
  });
  win.on("focus", () => { win.webContents.send("focus", true); markAlertsSeen(); if (!settingsView && wc()) wc().focus(); });
  win.on("blur", () => win.webContents.send("focus", false));
  for (const ev of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(ev, () => { layout(); sendState(); });
  win.on("app-command", (_e, cmd) => {
    if (cmd === "browser-backward") navAction("back");
    if (cmd === "browser-forward") navAction("forward");
  });
  win.webContents.on("focus", () => setTimeout(() => { if (win.isFocused() && !settingsView && wc()) wc().focus(); }, 0));

  createHomeView();
  for (const a of enabledApps()) createAppView(a);
  layout();
  select(views.has(config.lastTab) ? config.lastTab : "home");
  // Load the other apps in the background, one by one, so switching is instant.
  let delay = 1500;
  for (const [id, entry] of views) {
    if (!entry.app || entry.loaded) continue;
    setTimeout(() => { if (views.get(id) === entry && !entry.loaded) loadApp(entry); }, delay);
    delay += 1200;
  }
  startDashboard();
}

// ---- Home dashboard ------------------------------------------------------------
function homePayload() {
  const list = enabledApps();
  return {
    ...dash,
    days: config.homeDays,
    apps: (dash ? dash.apps : []).filter((p) => list.some((a) => a.id === p.id)).map((p) => {
      const a = list.find((x) => x.id === p.id);
      return { ...p, color: a.color, url: a.url };
    }),
  };
}
let dashBusy = false;
async function refreshDashboard(force = false) {
  if (dashBusy) return;
  if (!force && dash && Date.now() - dash.at < 15000) return;
  dashBusy = true;
  try {
    const prev = dash;
    dash = await fetchDashboard(enabledApps(), getKey, config.homeDays);
    notifyChanges(prev, dash);
    for (const p of dash.apps) {
      const e = views.get(p.id);
      if (!p.up) status[p.id] = "down";
      else if (p.health.some((h) => h.type === "error")) status[p.id] = "error";
      else if (p.health.length) status[p.id] = "warn";
      else status[p.id] = "up";
      // It came back: reload the error page.
      if (p.up && e && e.failed) loadApp(e);
    }
    const home = views.get("home");
    if (home) home.view.webContents.send("home", homePayload());
    sendState();
  } catch (err) {
    console.error("dashboard", err);
  } finally {
    dashBusy = false;
  }
}
function startDashboard() {
  clearInterval(dashTimer);
  refreshDashboard(true);
  dashTimer = setInterval(() => refreshDashboard(true), Math.max(15, config.refreshSecs) * 1000);
}

// ---- notifications -----------------------------------------------------------------
// Compares two dashboard reads: a download that left the queue nearly done (= imported),
// a new health warning / error, an app that stopped answering. The first read only learns.
const appName = (id) => (appById(id) || { name: id }).name;
// ArrDeck also keeps its alerts itself (Windows' pop-ups can be switched off): the last 30 for
// Home's "Recent alerts", a red dot on the tray icon and a flashing taskbar button until you look.
const alerts = [];
let unseenAlerts = 0;
function markAlertsSeen() {
  if (!unseenAlerts) return;
  unseenAlerts = 0;
  updateTrayIcon();
  if (win) win.flashFrame(false);
}
function notify(title, body, tabId) {
  alerts.unshift({ at: Date.now(), title, body, tab: tabId || "home" });
  alerts.length = Math.min(alerts.length, 30);
  const home = views.get("home");
  if (home) home.view.webContents.send("alerts", alerts);
  if (!(win && win.isVisible() && win.isFocused())) {
    unseenAlerts++;
    updateTrayIcon();
    if (win && win.isVisible()) win.flashFrame(true);
  }
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, icon: ICON, silent: false });
    n.on("click", () => { showWindow(); if (tabId) select(tabId); });
    n.show();
  } else if (tray) {
    tray.displayBalloon({ iconType: "info", title, content: body });
  }
}
function notifyChanges(prev, next) {
  if (!prev || !next) return;
  const qKey = (q) => `${q.app}|${q.title}|${q.sub}`;
  if (config.notifyDownloads) {
    const now = new Set(next.queue.map(qKey));
    // Only apps that answered both times (a down app's queue looks empty).
    const okNow = new Set(next.apps.filter((p) => p.state === "ok").map((p) => p.id));
    const done = prev.queue.filter((q) => !now.has(qKey(q)) && okNow.has(q.app) && !q.error
      && (q.progress >= 90 || /import/i.test(q.status)));
    if (done.length === 1) notify(`Downloaded: ${done[0].title}`, [done[0].sub, appName(done[0].app)].filter(Boolean).join(" · "), done[0].app);
    else if (done.length > 1) notify(`${done.length} downloads finished`, done.slice(0, 4).map((q) => q.title + (q.sub ? ` (${q.sub.split(" · ")[0]})` : "")).join("\n"), "home");
  }
  if (config.notifyRequests) {
    const seenReq = new Set((prev.requests || []).map((r) => `${r.app}|${r.id}`));
    const okBefore = new Set(prev.apps.filter((p) => p.state === "ok").map((p) => p.id));
    const fresh = (next.requests || []).filter((r) => okBefore.has(r.app) && !seenReq.has(`${r.app}|${r.id}`));
    for (const r of fresh.slice(0, 3)) {
      notify(`New request: ${r.title}${r.year ? ` (${r.year})` : ""}`, [r.seasons, r.is4k ? "4K" : "", r.by ? `by ${r.by}` : ""].filter(Boolean).join(" · "), "home");
    }
  }
  if (config.notifyHealth) {
    const hKey = (h) => `${h.app}|${h.type}|${h.message}`;
    const seen = new Set(prev.health.map(hKey));
    const fresh = next.health.filter((h) => (h.type === "error" || h.type === "warning") && !seen.has(hKey(h)));
    for (const h of fresh.slice(0, 3)) notify(`${appName(h.app)}: ${h.type === "error" ? "error" : "warning"}`, h.message, h.app);
    for (const p of next.apps) {
      const before = prev.apps.find((x) => x.id === p.id);
      if (before && before.up && !p.up) notify(`${p.name} isn't answering`, `Nothing replies at ${(appById(p.id) || {}).url || ""}. Is it still running?`, p.id);
      if (before && !before.up && p.up) notify(`${p.name} is back`, "It's answering again.", p.id);
    }
  }
}

// ---- tray & start with Windows ---------------------------------------------------------
let tray = null;
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function quitApp() {
  isQuitting = true;
  app.quit();
}
function trayHint() {
  if (config.trayHintShown || !tray) return;
  config.trayHintShown = true;
  saveConfig();
  tray.displayBalloon({ iconType: "info", title: "ArrDeck is still running", content: "It's in the tray and keeps an eye on your downloads. Right-click the icon for your apps or Quit." });
}
function updateTrayMenu() {
  if (!tray) return;
  const tabs = [{ id: "home", name: "Home" }, ...enabledApps()];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show ArrDeck", click: showWindow },
    { type: "separator" },
    ...tabs.map((t) => ({ label: t.name, click: () => { showWindow(); select(t.id); } })),
    { type: "separator" },
    { label: "Settings", click: () => { showWindow(); openSettings(); } },
    { label: "Check for updates", click: () => { if (updater) updater.check(true); } },
    { type: "separator" },
    { label: "Quit ArrDeck", click: quitApp },
  ]));
}
function updateTrayIcon() {
  if (!tray) return;
  tray.setImage(unseenAlerts ? path.join(__dirname, "build", "tray-alert.png") : ICON);
  tray.setToolTip(unseenAlerts ? `ArrDeck - ${unseenAlerts} new alert${unseenAlerts === 1 ? "" : "s"}` : "ArrDeck");
}
function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip("ArrDeck");
  tray.on("click", () => (win && win.isVisible() && !win.isMinimized() && win.isFocused() ? win.hide() : showWindow()));
  updateTrayMenu();
}
// Windows starts ArrDeck at sign-in, in the tray. The portable .exe registers its own path.
const loginExe = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
// A Start menu entry (opt-in, the one thing outside ArrDeck's folder): search for ArrDeck, pin it
// from there, and Windows shows ArrDeck's notifications reliably (it wants a shortcut with our app id).
const startMenuLink = () => path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "ArrDeck.lnk");
function applyStartMenu() {
  if (!app.isPackaged) return;
  const lnk = startMenuLink();
  try {
    if (config.startMenu) {
      shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? "replace" : "create", {
        target: loginExe(), appUserModelId: APP_ID, icon: loginExe(), iconIndex: 0,
        description: "Sonarr, Radarr, Lidarr, Prowlarr and Seerr in one window",
      });
    } else if (fs.existsSync(lnk)) {
      // Only remove it if it's ours.
      const d = (() => { try { return shell.readShortcutLink(lnk); } catch { return {}; } })();
      if (d.appUserModelId === APP_ID) fs.unlinkSync(lnk);
    }
  } catch (err) { console.error("start menu", err); }
}
function applyStartWithWindows() {
  if (!app.isPackaged) return;   // "electron ." while developing: don't register electron.exe
  try {
    app.setLoginItemSettings({ openAtLogin: !!config.startWithWindows, path: loginExe(), args: ["--hidden"] });
  } catch (err) { console.error("login item", err); }
}
const startsWithWindows = () => {
  if (!app.isPackaged) return !!config.startWithWindows;
  try { return app.getLoginItemSettings({ path: loginExe(), args: ["--hidden"] }).openAtLogin; } catch { return false; }
};

// ---- settings overlay ------------------------------------------------------------
function publicSettings() {
  return {
    apps: appList().map((a) => ({
      id: a.id, name: a.name, defaultName: a.defaultName, url: a.url, on: a.on, kind: a.kind, color: a.color,
      hasKey: !!config.keys[a.id], custom: !!a.custom, type: a.type || "",
    })),
    minimizeToTray: config.minimizeToTray,
    closeToTray: config.closeToTray,
    startWithWindows: startsWithWindows(),
    startMenu: !!config.startMenu,
    portable: !!process.env.PORTABLE_EXECUTABLE_FILE,
    notifyDownloads: config.notifyDownloads,
    notifyHealth: config.notifyHealth,
    notifyRequests: config.notifyRequests,
    keyDirs: config.keyDirs || [],
    types: Object.entries(TYPES).map(([id, t]) => ({ id, label: t.label })),
    updateCheck: config.updateCheck !== false,
    update: updater ? updater.info() : null,
    highContrast: config.highContrast,
    homeDays: config.homeDays,
    refreshSecs: config.refreshSecs,
    version: app.getVersion(),
    dataDir: DATA,
  };
}
function openSettings() {
  if (settingsView || !win) return;
  settingsView = new WebContentsView({ webPreferences: OWN });
  settingsView.setBackgroundColor("#00000000");
  ignoreWindowsTheme(settingsView.webContents);
  settingsView.webContents.on("before-input-event", onShortcut);
  settingsView.webContents.on("will-navigate", (e) => e.preventDefault());
  settingsView.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  win.contentView.addChildView(settingsView);
  layout();
  settingsView.webContents.loadFile(path.join(__dirname, "settings.html"));
  settingsView.webContents.once("did-finish-load", () => settingsView && settingsView.webContents.focus());
  sendState();
}
function closeSettings() {
  if (!settingsView) return;
  const v = settingsView;
  settingsView = null;
  win.contentView.removeChildView(v);
  v.webContents.close();
  if (wc()) wc().focus();
  sendState();
}
const toggleSettings = () => (settingsView ? closeSettings() : openSettings());
const pushSettings = () => { if (settingsView) settingsView.webContents.send("settings", publicSettings()); };

// Messages only count from our own pages.
const ownPage = (e) => {
  try { return e.senderFrame && e.senderFrame.url.startsWith("file://"); } catch { return false; }
};

ipcMain.handle("state:get", (e) => { if (ownPage(e)) setTimeout(sendState, 0); return null; });
ipcMain.on("tab:select", (e, id) => { if (ownPage(e)) { closeSettings(); select(String(id)); } });
ipcMain.on("tab:nav", (e, action) => { if (ownPage(e)) navAction(String(action)); });
ipcMain.on("settings:toggle", (e) => { if (ownPage(e)) toggleSettings(); });
ipcMain.on("settings:close", (e) => { if (ownPage(e)) closeSettings(); });
ipcMain.handle("settings:get", (e) => (ownPage(e) ? publicSettings() : null));
ipcMain.handle("settings:set", (e, { key, value } = {}) => {
  if (!ownPage(e)) return null;
  if (key === "highContrast") {
    config[key] = !!value;
    for (const entry of views.values()) applyCss(entry);
  } else if (key === "homeDays") {
    config.homeDays = Math.max(1, Math.min(31, Number(value) || 7));
    refreshDashboard(true);
  } else if (["updateCheck", "minimizeToTray", "closeToTray", "notifyDownloads", "notifyHealth", "notifyRequests"].includes(key)) {
    config[key] = !!value;
  } else if (key === "startMenu") {
    config.startMenu = !!value;
    applyStartMenu();
  } else if (key === "startWithWindows") {
    config.startWithWindows = !!value;
    applyStartWithWindows();
  } else if (key === "refreshSecs") {
    config.refreshSecs = Math.max(15, Math.min(3600, Number(value) || 60));
    startDashboard();
  } else return null;
  saveConfig();
  return publicSettings();
});
ipcMain.handle("settings:app", (e, { id, patch } = {}) => {
  if (!ownPage(e) || !appById(id)) return null;
  const p = {};
  if (patch && "on" in patch) p.on = !!patch.on;
  if (patch && typeof patch.url === "string") {
    const u = cleanUrl(patch.url);
    if (!u) return { error: "That address doesn't look right." };
    if (u !== appById(id).url) { p.url = u; p.path = ""; }
  }
  if (patch && typeof patch.name === "string") {
    // Rename the tab (empty = its own name back). Your own tabs keep it in their entry too.
    const name = patch.name.trim().slice(0, 40);
    const own = (config.custom || []).find((c) => c.id === id);
    if (own) { if (name) own.name = name; } else p.name = name;
  }
  setAppConfig(id, p);
  syncViews();
  refreshDashboard(true);
  return publicSettings();
});
// Tab order: the arrows in Settings (dir -1 / 1) or dragging a tab (before = the tab it lands on).
ipcMain.handle("settings:move", (e, { id, dir, before } = {}) => {
  if (!ownPage(e) || !appById(id)) return null;
  moveApp(id, dir ? { dir: dir < 0 ? -1 : 1 } : { before: before ?? null });
  syncViews();
  pushSettings();
  return publicSettings();
});
// Read the API keys from the apps' own settings files on this PC.
ipcMain.handle("settings:find-keys", async (e) => {
  if (!ownPage(e)) return null;
  const apps = appList().filter((a) => a.kind !== "web");
  const { results, searched, files } = findKeys(apps, { exeHome, extraDirs: config.keyDirs || [] });
  const report = [];
  for (const a of apps) {
    const r = results.find((x) => x.id === a.id);
    if (!r) { report.push({ id: a.id, name: a.name, status: "notfound" }); continue; }
    const same = getKey(a.id) === r.key;
    if (!same) setKey(a.id, r.key);
    report.push({ id: a.id, name: a.name, status: same ? "same" : "saved", file: r.file });
  }
  if (report.some((r) => r.status === "saved")) refreshDashboard(true);
  return { report, searched, files, settings: publicSettings() };
});
ipcMain.handle("settings:key-dir", async (e, remove) => {
  if (!ownPage(e)) return null;
  if (typeof remove === "string") config.keyDirs = (config.keyDirs || []).filter((d) => d !== remove);
  else {
    const r = await dialog.showOpenDialog(win, { title: "Where are your apps' settings?", properties: ["openDirectory"] });
    if (r.canceled || !r.filePaths[0]) return publicSettings();
    config.keyDirs = [...new Set([...(config.keyDirs || []), r.filePaths[0]])];
  }
  saveConfig();
  return publicSettings();
});
// Your own tabs: another Sonarr / Radarr / … or any local web page.
ipcMain.handle("settings:add-app", (e, { name, url, type } = {}) => {
  if (!ownPage(e)) return null;
  name = String(name || "").trim().slice(0, 40);
  const u = cleanUrl(url);
  if (!name) return { error: "Give it a name." };
  if (!u) return { error: "That address doesn't look right (e.g. http://127.0.0.1:8080)." };
  if (!TYPES[type]) type = "web";
  const id = "custom-" + Date.now().toString(36);
  config.custom = [...(config.custom || []), { id, name, url: u, type }];
  saveConfig();
  syncViews();
  refreshDashboard(true);
  pushSettings();
  return { ...publicSettings(), added: id };
});
ipcMain.handle("settings:remove-app", async (e, id) => {
  if (!ownPage(e) || !(config.custom || []).some((c) => c.id === id)) return null;
  config.custom = config.custom.filter((c) => c.id !== id);
  delete config.apps[id];
  delete config.keys[id];
  delete config.zoom[id];
  saveConfig();
  syncViews();
  await session.fromPartition(`persist:${id}`).clearStorageData().catch(() => {});
  refreshDashboard(true);
  pushSettings();
  return publicSettings();
});
ipcMain.handle("settings:key", (e, { id, key } = {}) => {
  if (!ownPage(e) || !appById(id)) return null;
  setKey(id, key);
  refreshDashboard(true);
  return publicSettings();
});
ipcMain.handle("settings:test", async (e, id) => {
  if (!ownPage(e) || !appById(id)) return null;
  const { fetchDashboard: fd } = require("./dashboard");
  const r = await fd([appById(id)], getKey, 1);
  const p = r.apps[0];
  return { state: p.state, version: p.version, error: p.error || "" };
});
ipcMain.handle("settings:signout", async (e, id) => {
  if (!ownPage(e) || !appById(id)) return null;
  await session.fromPartition(`persist:${id}`).clearStorageData();
  const entry = views.get(id);
  if (entry) loadApp(entry, entry.app.url);
  return true;
});
ipcMain.on("settings:open-data", (e) => { if (ownPage(e)) shell.openPath(DATA); });
ipcMain.on("home:refresh", (e) => { if (ownPage(e)) refreshDashboard(true); });
// The Home queue's buttons (Remove asks on the page first: it also deletes the download in the client).
ipcMain.handle("home:queue-action", async (e, { app: appId, qid, action } = {}) => {
  if (!ownPage(e) || !dash) return null;
  const a = appById(String(appId));
  const item = dash.queue.find((q) => q.app === appId && String(q.qid) === String(qid));
  if (!a || !item) return { ok: false, message: "It's not in the queue any more." };
  if (!["remove", "blocklist", "search", "grab"].includes(action)) return null;
  try {
    await queueAction(a, getKey(a.id), item, action);
    if (action !== "search") setTimeout(() => refreshDashboard(true), 1500);   // the queue changed
    const done = { remove: "Removed.", blocklist: "Removed - looking for another release.", search: "Searching…", grab: "Sent to the download client." };
    return { ok: true, message: done[action] };
  } catch (err) {
    return { ok: false, message: `Didn't work: ${err.message}` };
  }
});
// Missing / Cutoff unmet on Home. The tab asks for an app's whole list when you open it;
// it's kept here too, so the Search buttons can only search what's really on it.
const wantedLists = new Map();   // "appId|list" -> items
ipcMain.handle("home:wanted-list", async (e, { app: appId, list } = {}) => {
  if (!ownPage(e)) return null;
  const a = appById(String(appId));
  if (!a) return null;
  list = list === "cutoff" ? "cutoff" : "missing";
  try {
    const r = await fetchWanted(a, getKey(a.id), list, FULL_LIST);
    wantedLists.set(`${a.id}|${list}`, r.items);
    return { ok: true, total: r.total, items: r.items };
  } catch (err) {
    return { ok: false, message: `Couldn't read the list: ${err.message}` };
  }
});
// Search some of them (one episode, or all of a show's), or (all) everything on the app's list.
ipcMain.handle("home:missing-search", async (e, { app: appId, keys, all, list } = {}) => {
  if (!ownPage(e)) return null;
  const a = appById(String(appId));
  if (!a) return null;
  list = list === "cutoff" ? "cutoff" : "missing";
  let items = null;
  if (!all) {
    const mine = wantedLists.get(`${a.id}|${list}`) || [];
    const wanted = new Set(Array.isArray(keys) ? keys.map(String) : []);
    items = mine.filter((w) => wanted.has(JSON.stringify(w.media || {})));
    if (!items.length) return { ok: false, message: "It's not on the list any more." };
  }
  try {
    await searchMissing(a, getKey(a.id), items, list);
    const p = dash && dash.apps.find((x) => x.id === a.id);
    const n = p ? (list === "cutoff" ? p.cutoffTotal : p.missing) : 0;
    const what = list === "cutoff" ? "below cutoff" : "missing";
    return { ok: true, message: all ? `${a.name} is searching for all ${n ? n + " " : ""}${what}.` : items.length > 1 ? `Searching for ${items.length}…` : "Searching…" };
  } catch (err) {
    return { ok: false, message: `Didn't work: ${err.message}` };
  }
});
// Seerr requests on Home: Approve / Decline.
ipcMain.handle("home:request-action", async (e, { app: appId, id, action } = {}) => {
  if (!ownPage(e) || !dash) return null;
  const a = appById(String(appId));
  const item = (dash.requests || []).find((r) => r.app === appId && String(r.id) === String(id));
  if (!a || !item) return { ok: false, message: "It's not waiting any more." };
  if (action !== "approve" && action !== "decline") return null;
  try {
    await requestAction(a, getKey(a.id), item.id, action);
    setTimeout(() => refreshDashboard(true), 1200);
    return { ok: true, message: action === "approve" ? "Approved." : "Declined." };
  } catch (err) {
    return { ok: false, message: `Didn't work: ${err.message}` };
  }
});
ipcMain.on("home:open", (e, { id, path: p } = {}) => {
  if (!ownPage(e)) return;
  closeSettings();
  const entry = views.get(String(id));
  if (!entry || !entry.app) return;
  const target = typeof p === "string" && p.startsWith("/") ? entry.app.url + p : null;
  select(entry.app.id);
  if (target) loadApp(entry, target);
});
ipcMain.on("update:click", (e) => { if (ownPage(e) && updater) updater.click(); });
ipcMain.on("update:check", (e) => { if (ownPage(e) && updater) updater.check(true); });
ipcMain.on("open-external", (e, url) => { if (ownPage(e)) openExternal(String(url)); });

// ---- start -------------------------------------------------------------------
app.on("second-instance", () => showWindow());
let updater = null;
app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  updater = createUpdater({
    getWin: () => win, dataDir: DATA, getConfig: () => config, saveConfig, icon: ICON, openExternal, showWindow,
    onChange: () => { sendState(); pushSettings(); },
  });
  createTray();
  createWindow();
  applyStartMenu();
  applyStartWithWindows();   // keeps the sign-in entry pointing at this .exe, wherever it is now
  updater.start();
});
app.on("before-quit", () => { isQuitting = true; saveWindowState(); });
app.on("window-all-closed", () => app.quit());
