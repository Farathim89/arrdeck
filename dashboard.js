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
    // For the queue buttons: the queue entry, what to search for again, waiting on a delay?
    qid: r.id, pending: r.status === "delay",
    media: r.episodeId ? { episodeId: r.episodeId } : r.movieId ? { movieId: r.movieId }
      : r.albumId ? { albumId: r.albumId } : r.bookId ? { bookId: r.bookId } : null,
  };
}

// The app's search command for one episode / movie / album / book.
function searchBody(m) {
  m = m || {};
  return m.episodeId ? { name: "EpisodeSearch", episodeIds: [m.episodeId] }
    : m.movieId ? { name: "MoviesSearch", movieIds: [m.movieId] }
    : m.albumId ? { name: "AlbumSearch", albumIds: [m.albumId] }
    : m.bookId ? { name: "BookSearch", bookIds: [m.bookId] } : null;
}

// ---- missing & cutoff unmet (the apps' "Wanted") -----------------------------------------
// missing: monitored but not downloaded yet. cutoff: downloaded, but not in the quality the
// profile wants yet. Newest first. `all` / `cutoffAll` = the app's own "search all" commands
// (names as in each app's frontend/src/Commands/commandNames). `sort` = a sort key the app's
// Wanted controllers accept (they quietly ignore unknown ones).
const WANTED = {
  series: { inc: "&includeSeries=true", sort: "episodes.airDateUtc", all: "MissingEpisodeSearch", cutoffAll: "CutoffUnmetEpisodeSearch" },
  movie: { inc: "", sort: "movieMetadata.year", all: "MissingMoviesSearch", cutoffAll: "CutoffUnmetMoviesSearch" },
  album: { inc: "&includeArtist=true", sort: "releaseDate", all: "MissingAlbumSearch", cutoffAll: "CutoffUnmetAlbumSearch" },
  book: { inc: "&includeAuthor=true", sort: "releaseDate", all: "MissingBookSearch", cutoffAll: "CutoffUnmetBookSearch" },
};
const MISSING_PAGE = 50;
function wantedItem(app, r, list = "missing") {
  const item = wantedItemOf(app, r);
  if (item.link === "/wanted/missing") item.link = `/wanted/${list === "cutoff" ? "cutoffunmet" : "missing"}`;
  return item;
}
function wantedItemOf(app, r) {
  const ep = (s, e) => `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;
  if (app.media === "series") {
    return { app: app.id, title: (r.series && r.series.title) || "?", sub: `${ep(r.seasonNumber, r.episodeNumber)} · ${r.title || ""}`,
      when: r.airDateUtc || "", media: { episodeId: r.id }, link: r.series && r.series.titleSlug ? `/series/${r.series.titleSlug}` : "/wanted/missing" };
  }
  if (app.media === "movie") {
    return { app: app.id, title: r.title + (r.year ? ` (${r.year})` : ""), sub: r.studio || "",
      when: r.digitalRelease || r.physicalRelease || r.inCinemas || "", media: { movieId: r.id }, link: r.titleSlug ? `/movie/${r.titleSlug}` : "/wanted/missing" };
  }
  if (app.media === "album") {
    return { app: app.id, title: (r.artist && r.artist.artistName) || "?", sub: r.title || "", when: r.releaseDate || "",
      media: { albumId: r.id }, link: r.artist && r.artist.foreignArtistId ? `/artist/${r.artist.foreignArtistId}` : "/wanted/missing" };
  }
  return { app: app.id, title: (r.author && r.author.authorName) || "?", sub: r.title || "", when: r.releaseDate || "",
    media: { bookId: r.id }, link: "/wanted/missing" };
}
async function fetchWanted(app, key, list = "missing") {
  const w = WANTED[app.media];
  if (!w) return { total: 0, items: [] };
  const base = `/wanted/${list === "cutoff" ? "cutoff" : "missing"}?page=1&pageSize=${MISSING_PAGE}&monitored=true${w.inc}`;
  let r = null;
  try {
    r = await get(app, key, base + (w.sort ? `&sortKey=${w.sort}&sortDirection=descending` : ""));
  } catch (err) {
    if (err.code === "key") throw err;
    r = await get(app, key, base).catch(() => null);   // an older app that doesn't know that sort
  }
  if (!r) return { total: 0, items: [] };
  const items = records(r).map((x) => wantedItem(app, x, list));
  items.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));   // newest first within the page
  return { total: Number(r.totalRecords) || items.length, items };
}
// Search one item, or (item = null) everything the app has missing / below cutoff.
async function searchMissing(app, key, item, list = "missing") {
  if (!key) throw new Error(`no API key for ${app.name}`);
  if (!item) {
    const w = WANTED[app.media];
    if (!w) throw new Error("nothing to search for");
    return send(app, key, "POST", "/command", { name: list === "cutoff" ? w.cutoffAll : w.all });
  }
  const body = searchBody(item.media);
  if (!body) throw new Error("nothing to search for");
  return send(app, key, "POST", "/command", body);
}

// ---- Seerr requests ----------------------------------------------------------------------
// Seerr's request list has TMDB ids, not titles: look each one up once and remember it.
const titleCache = new Map();
async function mediaTitle(app, key, type, tmdbId) {
  const k = `${app.url}|${type}|${tmdbId}`;
  if (titleCache.has(k)) return titleCache.get(k);
  let t = { title: `${type === "tv" ? "Series" : "Movie"} #${tmdbId}`, year: "" };
  try {
    const m = await get(app, key, `/${type === "tv" ? "tv" : "movie"}/${tmdbId}`);
    t = { title: m.title || m.name || t.title, year: String(m.releaseDate || m.firstAirDate || "").slice(0, 4) };
    titleCache.set(k, t);
  } catch {}
  return t;
}
// Request status: 1 waiting for approval, 2 approved, 3 declined (4 failed, 5 completed in newer Seerr).
// Media status: 3 processing, 4 partly available, 5 available.
async function requestItem(app, key, r) {
  const type = r.type === "tv" ? "tv" : "movie";
  const tmdbId = r.media && r.media.tmdbId;
  const { title, year } = tmdbId ? await mediaTitle(app, key, type, tmdbId) : { title: "?", year: "" };
  const seasons = Array.isArray(r.seasons) ? r.seasons.map((s) => s.seasonNumber).filter((n) => n != null) : [];
  return {
    app: app.id, id: r.id, type, title, year, is4k: !!r.is4k,
    seasons: type === "tv" && seasons.length ? (seasons.length > 4 ? `${seasons.length} seasons` : `Season ${seasons.join(", ")}`) : "",
    by: (r.requestedBy && (r.requestedBy.displayName || r.requestedBy.username || r.requestedBy.email)) || "",
    at: r.createdAt || "", status: r.status, mediaStatus: r.media ? r.media.status : 0,
    link: tmdbId ? `/${type}/${tmdbId}` : "/requests",
  };
}
async function requestAction(app, key, id, action) {
  if (!key) throw new Error(`no API key for ${app.name}`);
  if (action !== "approve" && action !== "decline") throw new Error("unknown action");
  return send(app, key, "POST", `/request/${encodeURIComponent(id)}/${action}`);
}

// The Home queue's buttons. action: "remove" | "blocklist" (remove + find another) | "search" | "grab".
async function send(app, key, method, path, body) {
  const headers = { Accept: "application/json", "X-Api-Key": key };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(apiBase(app) + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT), redirect: "manual",
  });
  if (res.status === 401 || res.status === 403) throw new Error("API key not accepted");
  if (!res.ok) throw new Error(`${app.name} said HTTP ${res.status}`);
}
async function queueAction(app, key, item, action) {
  if (!key) throw new Error(`no API key for ${app.name}`);
  const id = encodeURIComponent(item.qid);
  if (action === "remove") return send(app, key, "DELETE", `/queue/${id}?removeFromClient=true&blocklist=false`);
  // Blocklisting the release makes the app look for another one by itself.
  if (action === "blocklist") return send(app, key, "DELETE", `/queue/${id}?removeFromClient=true&blocklist=true&skipRedownload=false`);
  if (action === "grab") return send(app, key, "POST", `/queue/grab/${id}`);
  if (action === "search") {
    const body = searchBody(item.media);
    if (!body) throw new Error("nothing to search for");
    return send(app, key, "POST", "/command", body);
  }
  throw new Error("unknown action");
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
  const res = { id: app.id, name: app.name, kind: app.kind, hasQueue: !!app.media, up: false, state: "", version: "", queue: [], calendar: [], health: [], requests: null, pending: [], recent: [], wanted: [], missing: 0, cutoff: [], cutoffTotal: 0, badges: null };
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
        jobs.push(fetchWanted(app, key).then((w) => { res.wanted = w.items; res.missing = w.total; }).catch(() => {}));
        jobs.push(fetchWanted(app, key, "cutoff").then((w) => { res.cutoff = w.items; res.cutoffTotal = w.total; }).catch(() => {}));
      }
      await Promise.all(jobs);
    } else if (app.kind === "seerr") {
      const [status, count, pending, recent] = await Promise.all([
        get(app, key, "/status"), get(app, key, "/request/count"),
        get(app, key, "/request?take=50&skip=0&filter=pending&sort=added"),
        get(app, key, "/request?take=15&skip=0&filter=all&sort=modified"),
      ]);
      res.version = status.version || "";
      res.requests = count;
      const list = (x) => (x && Array.isArray(x.results) ? x.results : []);
      res.pending = await Promise.all(list(pending).map((r) => requestItem(app, key, r)));
      res.recent = await Promise.all(list(recent).filter((r) => r.status !== 1).map((r) => requestItem(app, key, r)));
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
    wanted: parts.flatMap((p) => p.wanted),
    cutoff: parts.flatMap((p) => p.cutoff),
    requests: parts.flatMap((p) => p.pending),
    recentRequests: parts.flatMap((p) => p.recent),
    calendar: parts.flatMap((p) => p.calendar).sort(byTime),
    health: parts.flatMap((p) => p.health),
  };
}

module.exports = { fetchDashboard, isUp, queueAction, requestAction, searchMissing };
