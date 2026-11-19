// Finds the apps' API keys in their own settings files on this PC, so you don't have to
// copy-paste them: Sonarr / Radarr / Lidarr / Readarr / Prowlarr keep theirs in config.xml,
// Seerr / Overseerr / Jellyseerr in settings.json, Bazarr in config.yaml.
// Looks in C:\ProgramData and %LOCALAPPDATA% (Windows installs), near ArrDeck's own folder
// (a Docker "appdata" folder next to it, say) and in folders you pick.
// Runs in the main process: the keys go straight into ArrDeck's encrypted settings.

const fs = require("fs");
const path = require("path");

const FILES = new Set(["config.xml", "settings.json", "config.yaml"]);
const SKIP = /^(node_modules|\.git|mediacover|logs?|backups?|cache|code cache|gpucache|definitions|updates?|asp|tmp|temp|windows|program files.*|\$recycle\.bin|system volume information)$/i;
// App types by name in the file or its folders. Chaptarr is a Readarr fork; Whisparr has no tab here.
const TYPE_WORDS = [["jellyseerr", "seerr"], ["overseerr", "seerr"], ["seerr", "seerr"], ["sonarr", "sonarr"], ["radarr", "radarr"],
  ["lidarr", "lidarr"], ["readarr", "readarr"], ["chaptarr", "readarr"], ["prowlarr", "prowlarr"], ["bazarr", "bazarr"]];

function typeFromText(text) {
  const t = String(text || "").toLowerCase();
  for (const [word, type] of TYPE_WORDS) if (t.includes(word)) return type;
  return null;
}
// The nearest folder name that says which app it is (…\appdata\sonarr-anime\config.xml → sonarr).
function typeFromPath(file) {
  const parts = path.dirname(file).split(/[\\/]/).reverse();
  for (const p of parts.slice(0, 4)) { const t = typeFromText(p); if (t) return t; }
  return null;
}

function walk(root, depth, out, budget) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (budget.left-- <= 0) return;
    const full = path.join(root, e.name);
    if (e.isFile() && FILES.has(e.name.toLowerCase())) out.push(full);
    else if (e.isDirectory() && depth > 0 && !e.name.startsWith(".") && !SKIP.test(e.name)) walk(full, depth - 1, out, budget);
  }
}

function readSmall(file) {
  try {
    if (fs.statSync(file).size > 512 * 1024) return "";
    return fs.readFileSync(file, "utf8");
  } catch { return ""; }
}

// One settings file → { type, port, key, file } or null.
function parse(file) {
  const name = path.basename(file).toLowerCase();
  const text = readSmall(file);
  if (!text) return null;
  if (name === "config.xml") {
    const key = (/<ApiKey>\s*([0-9a-f]{20,})\s*<\/ApiKey>/i.exec(text) || [])[1];
    if (!key) return null;
    const port = Number((/<Port>\s*(\d+)\s*<\/Port>/i.exec(text) || [])[1]) || null;
    const type = typeFromText((/<InstanceName>([^<]*)<\/InstanceName>/i.exec(text) || [])[1]) || typeFromPath(file);
    return type ? { type, port, key, file } : null;
  }
  if (name === "settings.json") {
    let j;
    try { j = JSON.parse(text); } catch { return null; }
    const key = j && j.main && j.main.apiKey;
    if (!key) return null;
    return { type: "seerr", port: null, key: String(key), file };
  }
  if (name === "config.yaml") {
    if (typeFromPath(file) !== "bazarr") return null;
    const key = (/^auth:\s*$[\s\S]*?^\s+apikey:\s*['"]?([0-9a-z]{16,})['"]?\s*$/im.exec(text) || [])[1];
    if (!key) return null;
    const port = Number((/^general:\s*$[\s\S]*?^\s+port:\s*['"]?(\d+)/im.exec(text) || [])[1]) || null;
    return { type: "bazarr", port, key, file };
  }
  return null;
}

// Where to look: Windows installs, around ArrDeck's own folder, and your folders.
function searchRoots(exeHome, extra = []) {
  const roots = [];
  const add = (dir, depth) => { if (dir && fs.existsSync(dir) && !roots.some((r) => r.dir.toLowerCase() === dir.toLowerCase())) roots.push({ dir, depth }); };
  for (const d of extra) add(d, 4);
  add(process.env.ProgramData || "C:\\ProgramData", 1);
  add(process.env.LOCALAPPDATA, 1);
  if (exeHome) { add(path.dirname(exeHome), 3); }
  return roots;
}

// The ArrDeck type of an app: a custom tab's type, or the built-in id.
const appType = (a) => (a.type ? (a.type === "web" ? null : a.type) : a.id === "jellyseerr" ? "seerr" : a.id);
const appPort = (a) => { try { const u = new URL(a.url); return Number(u.port) || (u.protocol === "https:" ? 443 : 80); } catch { return null; } };

// Finds files, then matches them to apps: same type and same port, else the only one of that type.
function findKeys(apps, { exeHome, extraDirs = [] } = {}) {
  const files = [];
  const budget = { left: 20000 };
  for (const r of searchRoots(exeHome, extraDirs)) walk(r.dir, r.depth, files, budget);
  const found = files.map(parse).filter(Boolean);
  const results = [];
  const used = new Set();
  const want = apps.filter((a) => appType(a));
  // 1: exact port matches. 2: the only file left of a type, for the only switched-on app of
  // that type still without one. 3: the same for switched-off apps.
  const open = (x) => !results.some((r) => r.id === x.id);
  for (const pass of [1, 2, 3]) {
    for (const a of want) {
      if (!open(a)) continue;
      const t = appType(a);
      const left = found.filter((f) => f.type === t && !used.has(f.file));
      let hit = null;
      if (pass === 1) hit = left.find((f) => f.port && f.port === appPort(a)) || null;
      else {
        const group = want.filter((x) => appType(x) === t && open(x) && !!x.on === (pass === 2));
        if (!!a.on === (pass === 2) && left.length === 1 && group.length === 1) hit = left[0];
      }
      if (hit) { used.add(hit.file); results.push({ id: a.id, file: hit.file, key: hit.key }); }
    }
  }
  return { results, searched: searchRoots(exeHome, extraDirs).map((r) => r.dir), files: found.length };
}

module.exports = { findKeys };
