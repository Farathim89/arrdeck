// Updates from GitHub (Farathim89/arrdeck releases).
//
// ArrDeck is one portable .exe. When a newer release is out, the title bar shows
// "Update x.y.z". A click downloads the new ArrDeck.exe next to the settings
// (ArrDeck-data\update), checks its SHA-256 against the one GitHub gives (or the
// release's SHA256SUMS.txt) and asks to restart. Then a small hidden PowerShell
// waits for ArrDeck to close, puts the new .exe in place of the old one (same
// name, same folder: ArrDeck-data stays) and starts it again. Nothing installs
// without a click. Started with "electron ." (not the .exe): it only links to
// the release page.

const { app, net, dialog, Notification } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = "Farathim89/arrdeck";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE = `https://github.com/${REPO}/releases/latest`;
const ASSET = /^ArrDeck(-[\d.]+)?\.exe$/i;

function isNewer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

module.exports = function createUpdater({ getWin, dataDir, getConfig, saveConfig, onChange, icon, openExternal, showWindow }) {
  const exeFile = process.env.PORTABLE_EXECUTABLE_FILE || null;   // the real ArrDeck.exe
  const canSelfUpdate = app.isPackaged && !!exeFile;
  const updateDir = path.join(dataDir, "update");
  const newExe = path.join(updateDir, "ArrDeck.new.exe");
  let latest = null;        // { version, url, asset } when GitHub has a newer version
  let state = "idle";       // "idle" | "downloading" | "ready"
  let percent = 0;
  let checking = false;
  let lastCheck = null;     // { at, ok, upToDate }

  const changed = () => onChange(info());
  const say = (opts) => dialog.showMessageBox(getWin(), { title: "ArrDeck", noLink: true, ...opts });

  function info() {
    const v = latest ? latest.version : "";
    let pill = null;
    if (state === "downloading") pill = { label: `Downloading ${percent}%`, tip: `Downloading ArrDeck ${v}…` };
    else if (state === "ready") pill = { label: "Restart to update", tip: `ArrDeck ${v} is downloaded. Click to restart into it.` };
    else if (latest) pill = { label: `Update ${v}`, tip: `ArrDeck ${v} is out (you have ${app.getVersion()}). Click to ${canSelfUpdate ? "install" : "download"} it.` };
    return { current: app.getVersion(), latest: v, state, percent, pill, canSelfUpdate, checking, lastCheck };
  }

  async function check(manual = false) {
    if (checking) return;
    checking = true;
    changed();
    try {
      const res = await net.fetch(API, { headers: { Accept: "application/vnd.github+json" } });
      if (res.status === 404) throw Object.assign(new Error("no release yet"), { none: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rel = await res.json();
      const version = String(rel.tag_name || "").replace(/^v/i, "");
      const exe = (rel.assets || []).find((a) => ASSET.test(a.name));
      const sums = (rel.assets || []).find((a) => a.name === "SHA256SUMS.txt");
      lastCheck = { at: Date.now(), ok: true, upToDate: !(version && isNewer(version, app.getVersion())) };
      if (version && isNewer(version, app.getVersion())) {
        latest = {
          version, url: rel.html_url || PAGE,
          asset: exe ? { name: exe.name, url: exe.browser_download_url, size: exe.size,
            sha256: String(exe.digest || "").replace(/^sha256:/i, "").toLowerCase() || null,
            sums: sums ? sums.browser_download_url : null } : null,
        };
        if (manual) click();
        else if (getConfig().updateNotified !== version && Notification.isSupported()) {
          getConfig().updateNotified = version;
          saveConfig();
          const n = new Notification({ title: "ArrDeck update", body: `Version ${version} is out (you have ${app.getVersion()}). Click to update.`, icon });
          n.on("click", () => { showWindow(); click(); });
          n.show();
        }
      } else if (state === "idle") {
        latest = null;
        if (manual) say({ type: "info", message: "ArrDeck is up to date", detail: `You have the newest version, ${app.getVersion()}.` });
      }
    } catch (err) {
      lastCheck = { at: Date.now(), ok: !!err.none, upToDate: !!err.none };
      if (manual) {
        if (err.none) say({ type: "info", message: "ArrDeck is up to date", detail: `No release on GitHub yet. You have ${app.getVersion()}.` });
        else say({ type: "warning", message: "Couldn't check for updates", detail: "GitHub couldn't be reached. Check your internet connection and try again." });
      }
    } finally {
      checking = false;
      changed();
    }
  }

  // The title-bar pill, the notification or "Check for updates".
  async function click() {
    if (state === "ready") return askRestart();
    if (state === "downloading") return;
    if (!latest) return check(true);
    if (!canSelfUpdate || !latest.asset) return openExternal(latest.url);
    const { response } = await say({
      type: "info", message: `ArrDeck ${latest.version} is available`,
      detail: `You have ${app.getVersion()}. It downloads in the background, then asks before restarting. Your settings and sign-ins stay.`,
      buttons: ["Download & install", "What's new", "Later"], defaultId: 0, cancelId: 2,
    });
    if (response === 0) download();
    if (response === 1) openExternal(latest.url);
  }

  async function expectedSha(asset) {
    if (asset.sha256) return asset.sha256;
    if (!asset.sums) return null;
    const res = await net.fetch(asset.sums).catch(() => null);
    const text = res && res.ok ? await res.text() : "";
    const line = text.split(/\r?\n/).find((l) => l.trim().endsWith(asset.name));
    return line ? line.trim().split(/\s+/)[0].toLowerCase() : null;
  }

  async function download() {
    if (state !== "idle" || !latest || !latest.asset) return;
    state = "downloading"; percent = 0; changed();
    const part = newExe + ".download";
    try {
      fs.mkdirSync(updateDir, { recursive: true });
      const want = await expectedSha(latest.asset);
      if (!want) throw new Error("the release has no checksum for ArrDeck.exe");
      const res = await net.fetch(latest.asset.url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || latest.asset.size || 0;
      const hash = crypto.createHash("sha256");
      const out = fs.createWriteStream(part);
      const reader = res.body.getReader();
      let got = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          hash.update(chunk);
          if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
          got += chunk.length;
          const p = total ? Math.floor((got / total) * 100) : 0;
          if (p !== percent) { percent = p; changed(); }
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      if (latest.asset.size && got !== latest.asset.size) throw new Error("the download is incomplete");
      if (hash.digest("hex") !== want) throw new Error("the download's checksum doesn't match");
      try { fs.unlinkSync(newExe); } catch {}
      fs.renameSync(part, newExe);
      state = "ready";
      changed();
      askRestart();
    } catch (err) {
      try { fs.unlinkSync(part); } catch {}
      state = "idle";
      changed();
      const { response } = await say({
        type: "warning", message: "Couldn't download the update", detail: `${err.message}. You can download it from GitHub instead.`,
        buttons: ["Open download page", "Close"], defaultId: 0, cancelId: 1,
      });
      if (response === 0) openExternal(latest ? latest.url : PAGE);
    }
  }

  async function askRestart() {
    const { response } = await say({
      type: "info", message: `ArrDeck ${latest ? latest.version : ""} is ready`,
      detail: "Restart now to finish. Choose Later and it goes in when you close ArrDeck.",
      buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1,
    });
    if (response === 0) { install(true); app.quit(); }
  }

  // A hidden PowerShell (update\install.ps1, log in update\install.log) waits for ArrDeck.exe
  // to close, swaps in the new one and starts it again if asked. It is started through WMI,
  // not as our child: the portable .exe runs ArrDeck in a Windows job that ends every process
  // of ours when ArrDeck closes, the swapper included.
  let installing = false;
  function install(restart) {
    if (installing || state !== "ready" || !exeFile || !fs.existsSync(newExe)) return;
    installing = true;
    getConfig().updatedFrom = app.getVersion();
    saveConfig(true);
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const ps1 = path.join(updateDir, "install.ps1");
    const script = [
      `$ProgressPreference = 'SilentlyContinue'`,
      `$new = ${q(newExe)}; $exe = ${q(exeFile)}; $log = ${q(path.join(updateDir, "install.log"))}`,
      `function Log($m) { Add-Content -LiteralPath $log -Value ((Get-Date -Format s) + ' ' + $m) }`,
      `Log "waiting for ArrDeck to close"`,
      `for ($i = 0; $i -lt 240; $i++) { if (-not (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })) { break }; Start-Sleep -Milliseconds 500 }`,
      `$ok = $false; $err = ''`,
      `for ($i = 0; $i -lt 60 -and -not $ok; $i++) { try { Move-Item -LiteralPath $new -Destination $exe -Force -ErrorAction Stop; $ok = $true } catch { $err = $_.Exception.Message; Start-Sleep -Milliseconds 500 } }`,
      `if ($ok) { Log "new ArrDeck.exe is in place" } else { Log ("couldn't replace ArrDeck.exe: " + $err) }`,
      restart ? `Start-Process -FilePath $exe; Log "started ArrDeck"` : `Log "done (not restarting)"`,
    ].join("\r\n");
    try {
      fs.writeFileSync(ps1, "﻿" + script, "utf8");
      const cmd = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ps1}"`;
      const launcher = "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 };" +
        `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${q(cmd)}; ProcessStartupInformation = $si };` +
        "exit $r.ReturnValue";
      const r = require("child_process").spawnSync("powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(launcher, "utf16le").toString("base64")],
        { windowsHide: true, timeout: 20000 });
      if (r.status !== 0) throw new Error(`WMI start failed (${r.status})`);
    } catch (err) {
      console.error("update install", err);
      installing = false;
    }
  }
  // Downloaded but you chose Later: it goes in when you close ArrDeck (without starting again).
  app.on("will-quit", () => install(false));

  function start() {
    const c = getConfig();
    if (c.updatedFrom && c.updatedFrom !== app.getVersion()) {
      const from = c.updatedFrom;
      c.updatedFrom = null;
      saveConfig();
      if (Notification.isSupported()) new Notification({ title: "ArrDeck", body: `Updated to ${app.getVersion()} (from ${from}).`, icon }).show();
    }
    // Tidy up what an update left (install.log stays until the next update, for checking).
    try { for (const f of fs.readdirSync(updateDir)) if (f !== "install.log") fs.rmSync(path.join(updateDir, f), { force: true }); } catch {}
    const auto = () => getConfig().updateCheck !== false;
    setTimeout(() => { if (auto()) check(false); }, 8000);
    setInterval(() => { if (auto()) check(false); }, 2 * 60 * 60 * 1000);
  }

  // Coming back to the window: look again if the last look is over half an hour old.
  function checkIfStale() {
    if (getConfig().updateCheck === false || checking || state !== "idle") return;
    if (!lastCheck || Date.now() - lastCheck.at > 30 * 60 * 1000) check(false);
  }

  return { start, check, click, info, checkIfStale, page: PAGE };
};
