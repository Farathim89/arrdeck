// ArrDeck settings overlay.
const deck = window.arrdeck;
let s = null;

// Where each app shows its API key (the path is opened in the app's tab).
const KEY_HELP = {
  arr3: ["Settings → General → Security → API Key", "/settings/general"],
  arr1: ["Settings → General → Security → API Key", "/settings/general"],
  seerr: ["Settings → General → API Key", "/settings/main"],
  bazarr: ["Settings → General → Security → API Key", "/settings/general"],
};
const STATE_TEXT = {
  ok: ["Working", "ok"], nokey: ["Running - no API key yet", ""], badkey: ["API key not accepted", "bad"],
  down: ["Not answering", "bad"], error: ["Running, but the API gave an error", "bad"],
};

// ---- left menu ----
document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("active", p.id === b.dataset.pane));
}));
document.getElementById("close").addEventListener("click", () => deck.closeSettings());
document.getElementById("backdrop").addEventListener("click", () => deck.closeSettings());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") deck.closeSettings(); });
document.getElementById("openData").addEventListener("click", () => deck.openData());

// ---- simple settings (switches and lists with data-key) ----
document.querySelectorAll("[data-key]").forEach((el) => {
  el.addEventListener("change", async () => {
    const v = el.type === "checkbox" ? el.checked : el.value;
    const r = await deck.setSetting(el.dataset.key, v);
    if (r) show(r);
  });
});

function showSimple() {
  document.querySelectorAll("[data-key]").forEach((el) => {
    const v = s[el.dataset.key];
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = String(v);
  });
  document.getElementById("version").textContent = s.version;
  document.getElementById("dataDir").textContent = s.dataDir;
}

// ---- app cards ----
const cards = {};
// A card per app: made when an app appears (added by you), dropped when it goes.
function syncCards() {
  const list = document.getElementById("appList");
  for (const id of Object.keys(cards)) {
    if (!s.apps.some((a) => a.id === id)) { cards[id].remove(); delete cards[id]; }
  }
  for (const a of s.apps) if (!cards[a.id]) list.appendChild(buildCard(a));
}
function buildCard(a) {
  const tpl = document.getElementById("appTpl");
  {
    const el = tpl.content.firstElementChild.cloneNode(true);
    const q = (c) => el.querySelector(c);
    q(".swatch").style.background = a.color;
    q(".appName").textContent = a.name;
    const url = q(".url"), key = q(".key"), result = q(".result");
    const say = (text, cls = "") => { result.textContent = text; result.className = "note result " + cls; };

    q(".on").addEventListener("change", async (e) => { const r = await deck.setApp(a.id, { on: e.target.checked }); if (r) show(r); });
    url.addEventListener("change", async () => {
      const r = await deck.setApp(a.id, { url: url.value });
      if (r && r.error) say(r.error, "bad");
      else if (r) { say("Address saved.", "ok"); show(r); }
    });
    key.addEventListener("change", async () => {
      const r = await deck.setKey(a.id, key.value);
      key.value = "";
      if (r) show(r);
      test();
    });
    async function test() {
      say("Checking…");
      const r = await deck.testApp(a.id);
      const [text, cls] = STATE_TEXT[r.state] || [r.state, ""];
      say(text + (r.version ? ` (version ${r.version})` : "") + (r.error && r.state !== "badkey" ? ` - ${r.error}` : ""), cls);
      setState(a.id, r.state);
    }
    q(".test").addEventListener("click", test);
    q(".where").addEventListener("click", () => {
      const [where, path] = KEY_HELP[a.kind];
      say(`In ${a.name}: ${where}. Copy it, come back here (Ctrl+,) and paste it in the API key box. Opening that page in ${a.name} now…`);
      setTimeout(() => deck.open(a.id, path), 1800);
    });
    q(".signout").addEventListener("click", async () => {
      await deck.signOut(a.id);
      say(`Signed out of ${a.name} in ArrDeck. Sign in again in its tab.`, "ok");
    });
    q(".forget").addEventListener("click", async () => {
      const r = await deck.setKey(a.id, "");
      if (r) show(r);
      say("API key removed.", "ok");
      setState(a.id, "nokey");
    });
    if (a.custom) {
      const typeLabel = (s.types.find((t) => t.id === a.type) || {}).label;
      q(".kindNote").textContent = typeLabel ? `your tab · ${typeLabel}` : "your tab";
      q(".remove").classList.remove("hidden");
      q(".remove").addEventListener("click", async () => {
        const r = await deck.removeApp(a.id);
        if (r) show(r);
      });
    }
    if (a.kind === "web") {   // a plain web page: no API key
      q(".keyField").classList.add("hidden");
      q(".where").classList.add("hidden");
    }
    cards[a.id] = el;
    return el;
  }
}
function setState(id, state) {
  const el = cards[id] && cards[id].querySelector(".state");
  if (!el) return;
  const [text, cls] = STATE_TEXT[state] || ["", ""];
  el.textContent = text;
  el.className = "state " + cls;
}
function showCards() {
  for (const a of s.apps) {
    const el = cards[a.id];
    if (!el) continue;
    el.classList.toggle("on", a.on);
    el.querySelector(".on").checked = a.on;
    const url = el.querySelector(".url");
    if (document.activeElement !== url) url.value = a.url;
    el.querySelector(".key").placeholder = a.hasKey ? "Saved ✓ - paste a new one to change" : "Paste the API key here";
    el.querySelector(".forget").classList.toggle("hidden", !a.hasKey || a.kind === "web");
  }
}

// ---- add your own app ----
const addName = document.getElementById("addName");
const addUrl = document.getElementById("addUrl");
const addType = document.getElementById("addType");
const addResult = document.getElementById("addResult");
document.getElementById("addBtn").addEventListener("click", async () => {
  const name = addName.value.trim();
  const r = await deck.addApp({ name, url: addUrl.value, type: addType.value });
  if (!r) return;
  if (r.error) { addResult.textContent = r.error; addResult.className = "note result bad"; return; }
  addResult.textContent = `Added ${name}: it has a tab now.`;
  addResult.className = "note result ok";
  addName.value = "";
  addUrl.value = "";
  show(r);
  if (r.added) deck.testApp(r.added).then((t) => setState(r.added, t.state));
});

// ---- updates ----
function showUpdate() {
  const u = s.update;
  const el = document.getElementById("updateState");
  const btn = document.getElementById("updateBtn");
  if (!u) { el.textContent = ""; return; }
  btn.disabled = u.checking || u.state === "downloading";
  if (u.checking) { el.textContent = "Checking…"; btn.textContent = "Check for updates"; }
  else if (u.state === "downloading") { el.textContent = `Downloading ${u.latest}: ${u.percent}%`; btn.textContent = "Downloading…"; }
  else if (u.state === "ready") { el.textContent = `${u.latest} is downloaded.`; btn.textContent = "Restart to update"; }
  else if (u.latest) { el.textContent = `ArrDeck ${u.latest} is out.`; btn.textContent = u.canSelfUpdate ? `Install ${u.latest}` : `Download ${u.latest}`; }
  else {
    btn.textContent = "Check for updates";
    el.textContent = u.lastCheck ? (u.lastCheck.ok ? "You have the newest version." : "Couldn't reach GitHub last time.") : "";
  }
}
document.getElementById("updateBtn").addEventListener("click", () => {
  if (s.update && (s.update.latest || s.update.state !== "idle")) deck.updateClick();
  else deck.updateCheck();
});

function show(next) {
  s = next;
  if (!addType.options.length) for (const t of s.types) addType.add(new Option(t.label, t.id));
  showSimple();
  syncCards();
  showCards();
  showUpdate();
}

deck.getSettings().then((r) => {
  s = r;
  show(r);
  for (const a of s.apps) if (a.on) deck.testApp(a.id).then((t) => setState(a.id, t.state));
});
deck.onSettings(show);
