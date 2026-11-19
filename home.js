// Home dashboard: sub-tabs (Overview, Downloads, Coming up, Health, Requests, Alerts),
// app tiles, the download queue with its buttons, Seerr requests with Approve / Decline.
const deck = window.arrdeck;
const $ = (id) => document.getElementById(id);
let data = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const appInfo = (id) => (data && data.apps.find((a) => a.id === id)) || { name: id, color: "#fff" };
function tag(id) {
  const a = appInfo(id);
  const t = el("span", "tag", a.name);
  t.style.borderColor = a.color;
  return t;
}
function bytes(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 1 ? 1 : 0)} ${u[i]}`;
}
// "00:12:30" / "1.02:03:04" → "12m" / "1d 2h"
function timeLeft(t) {
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)/.exec(t || "");
  if (!m) return "";
  const [d, h, min] = [Number(m[1] || 0), Number(m[2]), Number(m[3])];
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${min}m`;
  return `${min || 1}m`;
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function dayLabel(d) {
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

const STATE = {
  ok: ["Running", "ok"], nokey: ["Running · no API key", "dim"], badkey: ["API key not accepted", "bad"],
  down: ["Not answering", "bad"], error: ["API error", "bad"],
};

function renderApps() {
  const box = $("apps");
  box.textContent = "";
  for (const a of data.apps) {
    const t = el("button", "tile");
    t.type = "button";
    const name = el("div", "name");
    const bar = el("i", "bar"); bar.style.background = a.color;
    name.append(bar, el("span", null, a.name));
    t.appendChild(name);
    let [text, cls] = STATE[a.state] || ["…", "dim"];
    if (a.state === "ok" && a.health.length) {
      const err = a.health.some((h) => h.type === "error");
      text = `${a.health.length} health ${a.health.length === 1 ? "issue" : "issues"}`;
      cls = err ? "bad" : "warn";
    }
    t.appendChild(el("span", "st " + cls, text));
    const info = el("div", "info");
    const parts = [];
    if (a.state === "ok" && a.hasQueue) parts.push([a.queue.length, "in queue"], [a.missing || 0, "missing"]);
    if (a.requests) parts.push([a.requests.pending || 0, "pending"], [a.requests.processing || 0, "processing"], [a.requests.available || 0, "available"]);
    if (a.badges) parts.push([a.badges.episodes || 0, "episodes"], [a.badges.movies || 0, "movies"]);
    if (a.version) parts.push(["v" + a.version, ""]);
    parts.forEach(([n, label], i) => {
      if (i) info.append(" · ");
      info.append(el("b", null, String(n)), label ? " " + label : "");
    });
    if (a.requests || a.badges) info.prepend(a.badges ? "Missing subtitles: " : "Requests: ");
    if (parts.length) t.appendChild(info);
    t.title = `Open ${a.name}${a.version ? " " + a.version : ""} - ${a.url}`;
    t.addEventListener("click", () => deck.open(a.id, a.requests ? "/requests" : null));
    box.appendChild(t);
  }
  $("keyHint").classList.toggle("hidden", !data.apps.some((a) => a.state === "nokey"));
}

// ---- sub-tabs ------------------------------------------------------------------------------
const TABS = ["overview", "downloads", "calendar", "missing", "health", "requests", "alerts"];
let tab = "overview";
try { const t = localStorage.getItem("homeTab"); if (TABS.includes(t)) tab = t; } catch {}
function showTab(t) {
  if (!TABS.includes(t)) t = "overview";
  if ($(t + "Tab") && $(t + "Tab").classList.contains("hidden")) t = "overview";
  tab = t;
  try { localStorage.setItem("homeTab", t); } catch {}
  document.querySelectorAll("#subtabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === "p-" + t));
  window.scrollTo(0, 0);
}
document.querySelectorAll("#subtabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
// Ctrl+Left / Ctrl+Right steps through the sub-tabs.
document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
  const shown = TABS.filter((t) => !$(t + "Tab") || !$(t + "Tab").classList.contains("hidden"));
  const i = shown.indexOf(tab);
  showTab(shown[(i + (e.key === "ArrowRight" ? 1 : -1) + shown.length) % shown.length]);
  e.preventDefault();
});
// The count on a sub-tab (and in its boxes' headings). cls: "warn" / "bad" / "gold" colours it.
function setCount(name, n, cls = "") {
  document.querySelectorAll(`[data-n="${name}"]`).forEach((x) => { x.textContent = n ? String(n) : ""; x.className = "n " + cls; });
  document.querySelectorAll(`[data-count="${name}"]`).forEach((x) => { x.textContent = n ? `(${n})` : ""; });
}
// On Overview a list stops after a few; "See all" goes to its own tab.
function seeAll(box, name, total, shown) {
  if (total <= shown) return;
  const b = el("button", "seeAll", `See all ${total} →`);
  b.type = "button";
  b.addEventListener("click", () => showTab(name));
  box.appendChild(b);
}

// ---- downloads -----------------------------------------------------------------------------
function queueRow(q) {
  const row = el("div", "item" + (q.error ? " error" : q.warn ? " warn" : ""));
  const mid = el("div");
  mid.style.minWidth = "0";
  mid.append(el("div", "title", q.title));
  if (q.sub) mid.append(el("div", "sub", q.sub));
  const right = el("div", "right");
  right.append(el("b", null, `${q.progress}%`));
  const extra = [q.timeLeft && timeLeft(q.timeLeft), q.sizeLeft && bytes(q.sizeLeft) + " left", q.status].filter(Boolean).join(" · ");
  if (extra) right.append(el("div", null, extra));
  const prog = el("div", "progress");
  const fill = el("i"); fill.style.width = q.progress + "%";
  prog.appendChild(fill);
  row.append(tag(q.app), mid, right, prog);
  if (q.message) row.append(el("div", "msg", q.message));
  row.append(queueButtons(q));
  row.title = [q.client, q.protocol].filter(Boolean).join(" · ");
  row.addEventListener("click", () => deck.open(q.app, q.link));
  return row;
}
function renderQueue(box, limit) {
  box.textContent = "";
  if (!data.queue.length) { box.appendChild(el("div", "empty", "Nothing downloading.")); return; }
  data.queue.slice(0, limit).forEach((q) => box.appendChild(queueRow(q)));
  seeAll(box, "downloads", data.queue.length, limit);
}

// Search again / Remove… / Grab now, under a queue row. Their answer shows next to them.
function queueButtons(q) {
  const bar = el("div", "qactions");
  const note = el("span", "qnote");
  const add = (label, action, tip) => {
    const b = el("button", "qbtn", label);
    b.type = "button";
    b.title = tip;
    b.addEventListener("click", async (e) => {
      e.stopPropagation();   // not the row's "open in the app"
      bar.querySelectorAll("button").forEach((x) => (x.disabled = true));
      note.textContent = "…";
      note.className = "qnote";
      const r = await deck.queueAction(q.app, q.qid, action);
      bar.querySelectorAll("button").forEach((x) => (x.disabled = false));
      if (!r || r.cancelled) { note.textContent = ""; return; }
      note.textContent = r.message;
      note.className = "qnote " + (r.ok ? "ok" : "bad");
    });
    bar.appendChild(b);
  };
  if (q.pending) add("Grab now", "grab", "Skip the delay and send it to the download client now");
  if (q.media) add("Search again", "search", "Look for this episode / movie / album again (keeps this download)");
  // Remove… asks right here (also deletes it in the download client).
  const ask = el("button", "qbtn", "Remove…");
  ask.type = "button";
  ask.title = "Remove it from the queue and the download client (asks first)";
  ask.addEventListener("click", (e) => {
    e.stopPropagation();
    bar.textContent = "";
    bar.classList.add("asking");
    bar.append(el("span", "qask", `Remove from ${appInfo(q.app).name} and ${q.client || "the download client"}?`));
    add("Remove", "remove", "Remove it (what it downloaded so far goes too)");
    add("Remove and find another", "blocklist", "Blocklist this release, so the app looks for a different one");
    const cancel = el("button", "qbtn", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", (ev) => { ev.stopPropagation(); bar.replaceWith(queueButtons(q)); });
    bar.append(cancel, note);
  });
  bar.append(ask, note);
  return bar;
}

// ---- coming up -----------------------------------------------------------------------------
function renderCalendar(box, limit) {
  box.textContent = "";
  if (!data.calendar.length) { box.appendChild(el("div", "empty", `Nothing in the next ${data.days} days.`)); return; }
  let lastDay = "";
  for (const c of data.calendar.slice(0, limit)) {
    const d = new Date(c.when);
    const label = dayLabel(d);
    if (label !== lastDay) {
      box.appendChild(el("div", "day" + (label === "Today" ? " today" : ""), label));
      lastDay = label;
    }
    const row = el("div", "item");
    const mid = el("div");
    mid.style.minWidth = "0";
    mid.append(el("div", "title", c.title), el("div", "sub", c.sub || ""));
    const right = el("div", "right");
    if (c.have) right.append(el("span", "have", "✓ Have it"));
    else if (c.timed) right.append(d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
    row.append(tag(c.app), mid, right);
    row.addEventListener("click", () => deck.open(c.app, c.link));
    box.appendChild(row);
  }
  seeAll(box, "calendar", data.calendar.length, limit);
}

// ---- missing & cutoff unmet ----------------------------------------------------------------
// The Missing tab shows one of two lists (the switch at its top): Missing, or Cutoff unmet
// (have it, but not in the quality the profile wants yet). Folder-style, so it stays tidy:
// one closed line per app → click: one line per show / artist / author (movies: the movies)
// → click: its episodes / albums / books. The full list is fetched when you open an app.
const LISTS = {
  missing: { total: (a) => a.missing || 0, word: "missing", none: "Nothing missing.", all: "Search all missing…" },
  cutoff: { total: (a) => a.cutoffTotal || 0, word: "below cutoff", none: "Everything meets its cutoff.", all: "Search all below cutoff…" },
};
const UNIT = { series: ["episode", "episodes"], album: ["album", "albums"], book: ["book", "books"], movie: ["movie", "movies"] };
let wantedView = "missing";
try { if (localStorage.getItem("wantedView") === "cutoff") wantedView = "cutoff"; } catch {}
const openApps = new Set();     // "list|app" that are open
const openGroups = new Set();   // "list|app|group" that are open
const fullLists = new Map();    // "list|app" -> { total, items } | { loading } | { error }
document.querySelectorAll("#wantedSwitch button").forEach((b) => b.addEventListener("click", () => {
  wantedView = b.dataset.view;
  try { localStorage.setItem("wantedView", wantedView); } catch {}
  if (data) renderMissing();
}));
const fmtDate = (w) => (w ? new Date(w).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
const mediaKey = (w) => JSON.stringify(w.media || {});

function missingButton(label, run, cls = "") {
  const b = el("button", "qbtn" + cls, label);
  b.type = "button";
  b.addEventListener("click", async (e) => {
    e.stopPropagation();   // not the line's open / close
    await run(b);
  });
  return b;
}
async function runSearch(bar, note, appId, keys, all, list) {
  bar.querySelectorAll("button").forEach((x) => (x.disabled = true));
  note.textContent = "…";
  note.className = "qnote";
  const r = await deck.searchMissing(appId, keys, all, list);
  bar.querySelectorAll("button").forEach((x) => (x.disabled = false));
  if (!r) { note.textContent = ""; return; }
  note.textContent = r.message;
  note.className = "qnote " + (r.ok ? "ok" : "bad");
}
function searchAllBar(a, list) {
  const L = LISTS[list];
  const bar = el("div", "qactions");
  const note = el("span", "qnote");
  bar.append(note, missingButton(L.all, () => {
    bar.textContent = "";
    bar.classList.add("asking");
    bar.append(el("span", "qask", `Search your indexers for all ${L.total(a)} ${L.word} in ${a.name}? It can take a while.`));
    bar.append(missingButton("Search all", () => runSearch(bar, note, a.id, null, true, list), " go"));
    bar.append(missingButton("Cancel", () => bar.replaceWith(searchAllBar(a, list))), note);
  }));
  return bar;
}
// A line that opens / closes: ▸ / ▾, its text, then whatever is on the right.
function folderLine(cls, open, onToggle, ...parts) {
  const line = el("div", "fline " + cls + (open ? " open" : ""));
  line.append(el("span", "chev", open ? "▾" : "▸"), ...parts);
  line.tabIndex = 0;
  line.addEventListener("click", onToggle);
  line.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } });
  return line;
}
// Open an app's list: fetch it (once, again when its count changes or on Refresh).
async function loadList(a, list) {
  const k = `${list}|${a.id}`;
  fullLists.set(k, { loading: true });
  renderMissing();
  const r = await deck.wantedList(a.id, list);
  fullLists.set(k, r && r.ok ? { total: r.total, items: r.items } : { error: (r && r.message) || "Couldn't read the list." });
  renderMissing();
}
function itemRow(a, w, list, sub) {
  const row = el("div", "item mitem");
  const mid = el("div");
  mid.style.minWidth = "0";
  mid.append(el("div", "title", sub ? w.sub || w.title : w.title));
  if (!sub && w.sub) mid.append(el("div", "sub", w.sub));
  const right = el("div", "right", fmtDate(w.when));
  const bar = el("div", "qactions");
  const note = el("span", "qnote");
  bar.append(note, missingButton("Search", () => runSearch(bar, note, a.id, [mediaKey(w)], false, list)));
  const open = el("button", "qbtn link", "Open");
  open.type = "button";
  open.title = `Open it in ${a.name}`;
  open.addEventListener("click", (e) => { e.stopPropagation(); deck.open(a.id, w.link); });
  bar.append(open);
  row.append(mid, right, bar);
  return row;
}
function renderAppList(a, list, body) {
  const k = `${list}|${a.id}`;
  const got = fullLists.get(k);
  if (!got || (got.items && got.total !== LISTS[list].total(a))) { loadList(a, list); return; }
  if (got.loading) { body.appendChild(el("div", "empty", "Loading…")); return; }
  if (got.error) { body.appendChild(el("div", "empty bad", got.error)); return; }
  const unit = UNIT[a.media] || UNIT.movie;
  // Movies: one line each. Others: one line per show / artist / author, newest first.
  if (a.media === "movie") { got.items.forEach((w) => body.appendChild(itemRow(a, w, list, false))); return; }
  const groups = new Map();
  for (const w of got.items) {
    if (!groups.has(w.title)) groups.set(w.title, []);
    groups.get(w.title).push(w);
  }
  const sorted = [...groups.entries()].sort((x, y) => new Date(y[1][0].when || 0) - new Date(x[1][0].when || 0));
  for (const [title, items] of sorted) {
    const gk = `${k}|${title}`;
    const open = openGroups.has(gk);
    const bar = el("div", "qactions");
    const note = el("span", "qnote");
    bar.append(note, missingButton(items.length > 1 ? `Search these ${items.length}` : "Search", () => runSearch(bar, note, a.id, items.map(mediaKey), false, list)));
    const line = folderLine("group", open, () => { if (openGroups.has(gk)) openGroups.delete(gk); else openGroups.add(gk); renderMissing(); },
      el("span", "gname", title), el("span", "gcount", plural(items.length, unit)), el("span", "gdate", `newest ${fmtDate(items[0].when)}`), bar);
    body.appendChild(line);
    if (open) {
      const inner = el("div", "ginner");
      items.forEach((w) => inner.appendChild(itemRow(a, w, list, true)));
      body.appendChild(inner);
    }
  }
  if (got.total > got.items.length) body.appendChild(el("p", "note more", `Showing ${got.items.length} of ${got.total}; the rest are in ${a.name}: Wanted.`));
}
function renderMissing() {
  const list = wantedView;
  const L = LISTS[list];
  document.querySelectorAll("#wantedSwitch button").forEach((b) => b.classList.toggle("active", b.dataset.view === list));
  const apps = data.apps.filter((a) => a.hasQueue && a.state === "ok");
  for (const [k, X] of Object.entries(LISTS)) {
    const n = apps.reduce((t, a) => t + X.total(a), 0);
    const c = document.querySelector(`#wantedSwitch [data-view="${k}"] .n`);
    if (c) c.textContent = n ? String(n) : "";
  }
  const box = $("missing");
  const scroll = window.scrollY;
  box.textContent = "";
  if (!apps.length) { box.appendChild(el("div", "empty", "Needs the apps' API keys (Settings → Apps → Find my API keys).")); return; }
  for (const a of apps) {
    const total = L.total(a);
    const k = `${list}|${a.id}`;
    const open = openApps.has(k) && total > 0;
    const sec = el("section", "box fbox");
    const name = el("span", "aname", a.name);
    name.style.borderColor = a.color;
    const right = total ? searchAllBar(a, list) : el("span");
    sec.appendChild(folderLine("app" + (total ? "" : " empty"), open,
      () => { if (!total) return; if (openApps.has(k)) openApps.delete(k); else openApps.add(k); renderMissing(); },
      name, el("span", "gcount", total ? `${total} ${L.word}` : L.none), right));
    if (open) {
      const body = el("div", "fbody");
      renderAppList(a, list, body);
      sec.appendChild(body);
    }
    box.appendChild(sec);
  }
  window.scrollTo(0, scroll);
}
// Refresh also re-reads the open lists.
$("refresh").addEventListener("click", () => { fullLists.clear(); });

// ---- health --------------------------------------------------------------------------------
function renderHealth(box, limit) {
  box.textContent = "";
  if (!data.health.length) {
    const ok = data.apps.some((a) => a.state === "ok");
    box.appendChild(el("div", "empty", ok ? "All good - no warnings." : "No health info yet (needs API keys)."));
    return;
  }
  // Errors first.
  const list = [...data.health].sort((a, b) => (a.type === "error" ? 0 : 1) - (b.type === "error" ? 0 : 1));
  for (const h of list.slice(0, limit)) {
    const row = el("div", "hitem");
    row.append(tag(h.app), el("span", "htype " + h.type, h.type), el("div", null, h.message));
    if (h.wiki) {
      const b = el("button", "wiki", "Help");
      b.type = "button";
      b.addEventListener("click", () => deck.openExternal(h.wiki));
      row.append(b);
    } else row.append(el("span"));
    box.appendChild(row);
  }
  seeAll(box, "health", list.length, limit);
}

// ---- Seerr requests ------------------------------------------------------------------------
const REQ_STATUS = { 1: ["Waiting", "warn"], 2: ["Approved", "ok"], 3: ["Declined", "bad"], 4: ["Failed", "bad"], 5: ["Done", "ok"] };
const MEDIA_STATUS = { 3: "downloading", 4: "partly available", 5: "available" };
function ago(when) {
  const s = (Date.now() - new Date(when)) / 1000;
  if (!when || isNaN(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function requestRow(r, withButtons) {
  const row = el("div", "item req");
  const mid = el("div");
  mid.style.minWidth = "0";
  mid.append(el("div", "title", r.title + (r.year ? ` (${r.year})` : "")));
  mid.append(el("div", "sub", [r.type === "tv" ? "Series" : "Movie", r.seasons, r.is4k ? "4K" : "", r.by ? `by ${r.by}` : "", ago(r.at)].filter(Boolean).join(" · ")));
  const right = el("div", "right");
  const [st, cls] = REQ_STATUS[r.status] || ["", ""];
  if (!withButtons && st) right.append(el("b", "rstate " + cls, st));
  if (!withButtons && MEDIA_STATUS[r.mediaStatus]) right.append(el("div", null, MEDIA_STATUS[r.mediaStatus]));
  row.append(tag(r.app), mid, right);
  if (withButtons) {
    const bar = el("div", "qactions");
    const note = el("span", "qnote");
    for (const [label, action, tip] of [["Approve", "approve", "Approve: Seerr sends it to Sonarr / Radarr"], ["Decline", "decline", "Decline the request"]]) {
      const b = el("button", "qbtn" + (action === "approve" ? " go" : ""), label);
      b.type = "button";
      b.title = tip;
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        bar.querySelectorAll("button").forEach((x) => (x.disabled = true));
        note.textContent = "…";
        note.className = "qnote";
        const res = await deck.requestAction(r.app, r.id, action);
        bar.querySelectorAll("button").forEach((x) => (x.disabled = false));
        if (!res) { note.textContent = ""; return; }
        note.textContent = res.message;
        note.className = "qnote " + (res.ok ? "ok" : "bad");
      });
      bar.appendChild(b);
    }
    bar.appendChild(note);
    row.appendChild(bar);
  }
  row.addEventListener("click", () => deck.open(r.app, r.link));
  return row;
}
function renderRequests(box, list, limit, withButtons, empty) {
  box.textContent = "";
  if (!list.length) { box.appendChild(el("div", "empty", empty)); return; }
  list.slice(0, limit).forEach((r) => box.appendChild(requestRow(r, withButtons)));
  seeAll(box, "requests", list.length, limit);
}

// ---- alerts --------------------------------------------------------------------------------
let alertList = [];
function renderAlerts() {
  const box = $("alerts");
  box.textContent = "";
  setCount("alerts", alertList.length);
  if (!alertList.length) { box.appendChild(el("div", "empty", "No alerts yet.")); return; }
  for (const a of alertList) {
    const row = el("div", "alert");
    const time = new Date(a.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    const mid = el("div");
    mid.style.minWidth = "0";
    mid.append(el("div", "title", a.title), el("div", "sub", (a.body || "").replace(/\n/g, " · ")));
    row.append(el("span", "atime", time), mid);
    row.addEventListener("click", () => (a.tab === "home" ? showTab("overview") : deck.open(a.tab, null)));
    box.appendChild(row);
  }
}
deck.onAlerts((list) => { alertList = list || []; renderAlerts(); });

// ---- all of it -----------------------------------------------------------------------------
function render(d) {
  data = d;
  if (!data || !data.apps) return;
  const requests = data.requests || [];
  const hasSeerr = data.apps.some((a) => a.kind === "seerr" && a.state === "ok");
  $("requestsTab").classList.toggle("hidden", !hasSeerr);
  $("ov-requestsBox").classList.toggle("hidden", !hasSeerr);
  setCount("downloads", data.queue.length, data.queue.some((q) => q.error) ? "bad" : data.queue.some((q) => q.warn) ? "warn" : "");
  setCount("calendar", data.calendar.length);
  const missing = data.apps.reduce((n, a) => n + (a.hasQueue && a.state === "ok" ? a.missing || 0 : 0), 0);
  setCount("missing", missing);
  $("missingTab").classList.toggle("hidden", !data.apps.some((a) => a.hasQueue));
  setCount("health", data.health.length, data.health.some((h) => h.type === "error") ? "bad" : data.health.length ? "warn" : "");
  setCount("requests", requests.length, requests.length ? "gold" : "");
  renderApps();
  renderQueue($("ov-downloads"), 4);
  renderCalendar($("ov-calendar"), 6);
  renderHealth($("ov-health"), 4);
  renderRequests($("ov-requests"), requests, 4, true, "Nothing waiting.");
  renderQueue($("downloads"), Infinity);
  renderCalendar($("calendar"), Infinity);
  renderHealth($("health"), Infinity);
  renderMissing();
  renderRequests($("requests"), requests, Infinity, true, "Nothing waiting for approval.");
  renderRequests($("recentRequests"), data.recentRequests || [], Infinity, false, "No requests yet.");
  if (tab === "requests" && !hasSeerr) showTab("overview");
  $("updated").textContent = "Updated " + new Date(data.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

deck.onHome(render);
showTab(tab);
renderAlerts();
$("refresh").addEventListener("click", () => { $("updated").textContent = "Refreshing…"; deck.refresh(); });
