// Home dashboard: app tiles, download queue, coming up, health.
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
    if (a.state === "ok" && a.queue) parts.push([a.queue.length, "in queue"]);
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

function renderQueue() {
  const box = $("queue");
  box.textContent = "";
  $("queueCount").textContent = data.queue.length ? `(${data.queue.length})` : "";
  if (!data.queue.length) { box.appendChild(el("div", "empty", "Nothing downloading.")); return; }
  for (const q of data.queue) {
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
    row.title = [q.client, q.protocol].filter(Boolean).join(" · ");
    row.addEventListener("click", () => deck.open(q.app, q.link));
    box.appendChild(row);
  }
}

function renderCalendar() {
  const box = $("calendar");
  box.textContent = "";
  $("calCount").textContent = data.calendar.length ? `(${data.calendar.length})` : "";
  if (!data.calendar.length) { box.appendChild(el("div", "empty", `Nothing in the next ${data.days} days.`)); return; }
  let lastDay = "";
  for (const c of data.calendar) {
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
}

function renderHealth() {
  const box = $("health");
  box.textContent = "";
  $("healthCount").textContent = data.health.length ? `(${data.health.length})` : "";
  if (!data.health.length) {
    const ok = data.apps.some((a) => a.state === "ok");
    box.appendChild(el("div", "empty", ok ? "All good - no warnings." : "No health info yet (needs API keys)."));
    return;
  }
  for (const h of data.health) {
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
}

function render(d) {
  data = d;
  if (!data || !data.apps) return;
  renderApps();
  renderQueue();
  renderCalendar();
  renderHealth();
  $("updated").textContent = "Updated " + new Date(data.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

deck.onHome(render);
$("refresh").addEventListener("click", () => { $("updated").textContent = "Refreshing…"; deck.refresh(); });
