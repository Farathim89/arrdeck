// Home > Server: start and stop the apps of an "Arr server" folder - the Windows setup that runs Sonarr & co.
// without Docker (start-all.ps1, stop-all.ps1 and status.ps1 in it). ArrDeck only calls those scripts, so they
// stay the one place that knows how each app starts. The tab shows only when such a folder is found:
// "Arr server" next to ArrDeck's own folder (or inside it), or the folder set in config.serverDir.
const fs = require("fs");
const path = require("path");
const { execFile, spawnSync } = require("child_process");

const SCRIPTS = ["start-all.ps1", "stop-all.ps1", "status.ps1"];
const isServerDir = (d) => !!d && SCRIPTS.every((f) => fs.existsSync(path.join(d, f)));

function findServerDir(exeHome, configured) {
  const candidates = [configured, path.join(path.dirname(exeHome), "Arr server"), path.join(exeHome, "Arr server")];
  return candidates.find(isServerDir) || null;
}

const PS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

// [{ id, name, port, installed, running }] from status.ps1 -Json
function serverStatus(dir) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", [...PS, "-File", path.join(dir, "status.ps1"), "-Json"], { windowsHide: true, timeout: 30000 }, (err, out) => {
      if (err) return reject(err);
      try { const v = JSON.parse(String(out).trim() || "[]"); resolve(Array.isArray(v) ? v : [v]); } catch (e) { reject(e); }
    });
  });
}

// Runs start-all.ps1 / stop-all.ps1 (for some apps, or all) without a window. Started through WMI, not as our
// child: the portable .exe runs ArrDeck in a Windows job that ends every process of ours when ArrDeck closes,
// and the apps started here must keep running after that.
function runServer(dir, action, ids) {
  const script = path.join(dir, action === "stop" ? "stop-all.ps1" : "start-all.ps1");
  const only = (ids || []).filter((id) => /^[a-z0-9-]+$/i.test(id));
  const cmd = `powershell.exe ${PS.join(" ")} -WindowStyle Hidden -File "${script}"` + (only.length ? ` -Only ${only.join(",")}` : "");
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const launcher = "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 };" +
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${q(cmd)}; ProcessStartupInformation = $si };` +
    "exit $r.ReturnValue";
  const r = spawnSync("powershell.exe", [...PS, "-EncodedCommand", Buffer.from(launcher, "utf16le").toString("base64")], { windowsHide: true, timeout: 20000 });
  if (r.status !== 0) throw new Error(`couldn't start ${path.basename(script)} (${r.status})`);
}

module.exports = { findServerDir, serverStatus, runServer };
