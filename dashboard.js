// Home dashboard data: download queue, coming up (calendar), health and requests,
// read from each app's API with the API key the user pasted in ArrDeck's settings.
// Runs in the main process (no CORS limits, keys never reach a web page).

const TIMEOUT = 8000;

function apiBase(app) {
  const base = app.url.replace(/\/+$/, "");
  if (app.kind === "arr3") return `${base}/api/v3`;
  if (app.kind === "arr1") return `${base}/api/v1`;
  if (app.kind === "seerr") return `${base}/api/v1`;
  return `${base}/api`;
}

async function get(app, key, path) {
  const headers = { Accept: "application/json" };
  headers[app.kind === "bazarr" ? "X-API-KEY" : "X-Api-Key"] = key;
  const res = await fetch(apiBase(app) + path, { headers, signal: AbortSignal.timeout(TIMEOUT), redirect: "manual" });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("API key not accepted"), { code: "key" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Is anything answering on the app's address? (Any HTTP reply counts, the login page included.)
async function isUp(app) {
  try {
    await fetch(app.url, { signal: AbortSignal.timeout(4000), redirect: "manual" });
    return true;
  } catch {
    return false;
  }
}

const iso = (d) => d.toISOString();
const pct = (size, left) => (size > 0 ? Math.max(0, Math.min(100, Math.round(((size - left) / size) * 100))) : 0);
const records = (x) => (Array.isArray(x) ? x : x && Array.isArray(x.records) ? x.records : []);

function queueItem(app, r) {
  let title = r.title || "";
  let sub = "";
  let link = "/activity/queue";
  if (r.series) {
    title = r.series.title;
    if (r.episode) sub = `S${String(r.episode.seasonNumber).padStart(2, "0")}E${String(r.episode.episodeNumber).padStart(2, "0")} · ${r.episode.title || ""}`;
  } else if (r.movie) {
    title = r.movie.title + (r.movie.year ? ` (${r.movie.year})` : "");
  } else if (r.artist) {
    title = r.artist.artistName;
    if (r.album) sub = r.album.title;
  } else if (r.author) {
    title = r.author.authorName;
    if (r.book) sub = r.book.title;
  }
  const warn = r.trackedDownloadStatus && r.trackedDownloadStatus !== "ok";
  const msg = warn && Array.isArray(r.statusMessages)
    ? r.statusMessages.flatMap((m) => m.messages || []).slice(0, 1).join("")
    : "";
  return {
    app: app.id, title, sub, link,
    progress: pct(r.size, r.sizeleft),
    sizeLeft: r.sizeleft || 0,
    timeLeft: r.timeleft || "",
    status: r.trackedDownloadState || r.status || "",
    warn: !!warn, error: r.trackedDownloadStatus === "error", message: msg,
    client: r.downloadClient || "", protocol: r.protocol || "",
  };
}

function calendarItems(app, list, start, end) {
  const out = [];
  const inRange = (d) => d && new Date(d) >= start && new Date(d) <= end;
  for (const r of list) {
    if (r.series) {
      if (!r.airDateUtc) continue;
      out.push({
        app: app.id, when: r.airDateUtc, timed: true, title: r.series.title,
        sub: `S${String(r.seasonNumber).padStart(2, "0")}E${String(r.episodeNumber).padStart(2, "0")} · ${r.title || ""}`,
        have: !!r.hasFile, link: r.series.titleSlug ? `/series/${r.series.titleSlug}` : "/calendar",
      });
    } else if (app.media === "movie") {
      const kinds = [["inCinemas", "In cinemas"], ["digitalRelease", "Digital release"], ["physicalRelease", "Disc release"]];
      for (const [k, label] of kinds) {
        if (!inRange(r[k])) continue;
        out.push({
          app: app.id, when: r[k], timed: false, title: r.title + (r.year ? ` (${r.year})` : ""), sub: label,
          have: !!r.hasFile, link: r.titleSlug ? `/movie/${r.titleSlug}` : "/calendar",
        });
      }
    } else if (r.artist) {
      if (!r.releaseDate) continue;
      out.push({
        app: app.id, when: r.releaseDate, timed: false, title: r.artist.artistName, sub: r.title,
        have: !!(r.statistics && r.statistics.percentOfTracks >= 100),
        link: r.artist.foreignArtistId ? `/artist/${r.artist.foreignArtistId}` : "/calendar",
      });
    } else if (r.author) {
      if (!r.releaseDate) continue;
      out.push({
        app: app.id, when: r.releaseDate, timed: false, title: r.author.authorName, sub: r.title,
        have: !!(r.statistics && r.statistics.bookFileCount > 0), link: "/calendar",
      });
    }
  }
  return out;
}

// One app's part of the dashboard. Never throws: problems end up in `state`.
async function fetchApp(app, key, days) {
  const res = { id: app.id, name: app.name, kind: app.kind, up: false, state: "", version: "", queue: [], calendar: [], health: [], requests: null, badges: null };
  res.up = await isUp(app);
  if (!res.up) { res.state = "down"; return res; }
  if (app.kind === "web") { res.state = "ok"; return res; }   // a plain web page: no API
  if (!key) { res.state = "nokey"; return res; }
  try {
    if (app.kind === "arr3" || app.kind === "arr1") {
      const status = await get(app, key, "/system/status");
      res.version = status.version || "";
      const jobs = [get(app, key, "/health").then((h) => {
        res.health = (Array.isArray(h) ? h : []).filter((x) => x.type !== "ok").map((x) => ({
          app: app.id, type: x.type, message: x.message, source: x.source, wiki: x.wikiUrl || "",
        }));
      })];
      if (app.media) {
        const inc = { series: "includeSeries=true&includeEpisode=true", movie: "includeMovie=true", album: "includeArtist=true&includeAlbum=true", book: "includeAuthor=true&includeBook=true" }[app.media];
        jobs.push(get(app, key, `/queue?page=1&pageSize=100&${inc}`).then((q) => { res.queue = records(q).map((r) => queueItem(app, r)); }));
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(end.getDate() + days + 1);
        const calInc = { series: "&includeSeries=true", movie: "", album: "&includeArtist=true", book: "&includeAuthor=true" }[app.media];
        jobs.push(get(app, key, `/calendar?start=${iso(start)}&end=${iso(end)}&unmonitored=false${calInc}`).then((c) => {
          res.calendar = calendarItems(app, Array.isArray(c) ? c : [], start, end);
        }));
      }
      await Promise.all(jobs);
    } else if (app.kind === "seerr") {
      const [status, count] = await Promise.all([get(app, key, "/status"), get(app, key, "/request/count")]);
      res.version = status.version || "";
      res.requests = count;
    } else if (app.kind === "bazarr") {
      const badges = await get(app, key, "/badges");
      res.badges = badges && badges.data ? badges.data : badges;
      const h = await get(app, key, "/system/health").catch(() => null);
      const list = h && Array.isArray(h.data) ? h.data : [];
      res.health = list.map((x) => ({ app: app.id, type: "warning", message: `${x.object}: ${x.issue}`, source: "", wiki: "" }));
    }
    res.state = "ok";
  } catch (err) {
    res.state = err.code === "key" ? "badkey" : "error";
    res.error = String(err.message || err);
  }
  return res;
}

async function fetchDashboard(apps, keyFor, days) {
  const parts = await Promise.all(apps.map((a) => fetchApp(a, keyFor(a.id), days)));
  const byTime = (a, b) => new Date(a.when) - new Date(b.when);
  return {
    at: Date.now(),
    apps: parts,
    queue: parts.flatMap((p) => p.queue),
    calendar: parts.flatMap((p) => p.calendar).sort(byTime),
    health: parts.flatMap((p) => p.health),
  };
}

module.exports = { fetchDashboard, isUp };
