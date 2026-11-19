// Title bar: app tabs with a status dot, back / forward / reload, the settings gear.
const deck = window.arrdeck;
const tabsEl = document.getElementById("tabs");
const backBtn = document.getElementById("back");
const fwdBtn = document.getElementById("forward");
const gearBtn = document.getElementById("settings");
const verEl = document.getElementById("ver");
const updateBtn = document.getElementById("update");
updateBtn.addEventListener("click", () => deck.updateClick());

const STATUS_TEXT = { up: "running", warn: "has warnings", error: "has errors", down: "not answering" };
const HOME_SVG = '<svg class="home" viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>';

let lastKey = "";
function render(s) {
  backBtn.disabled = !s.canBack;
  fwdBtn.disabled = !s.canForward;
  gearBtn.classList.toggle("on", !!s.settingsOpen);
  document.body.classList.toggle("framed", !!s.framed);
  verEl.textContent = s.version ? "v" + s.version : "";
  updateBtn.classList.toggle("hidden", !s.update);
  if (s.update) { updateBtn.textContent = s.update.label; updateBtn.title = s.update.tip || ""; }
  const key = JSON.stringify([s.active, s.tabs]);
  if (key === lastKey) return;
  lastKey = key;
  tabsEl.textContent = "";
  s.tabs.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab" + (t.id === s.active ? " active" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(t.id === s.active));
    const state = STATUS_TEXT[t.status] ? ` - ${STATUS_TEXT[t.status]}` : "";
    b.title = `${t.name}${state} (Ctrl+${i + 1})`;
    if (t.id === "home") {
      b.innerHTML = HOME_SVG;
    } else {
      const dot = document.createElement("i");
      dot.className = "dot " + (t.status || "");
      b.appendChild(dot);
    }
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = t.name;
    b.appendChild(name);
    if (t.badge) {
      const badge = document.createElement("span");
      badge.className = "badge" + (t.status === "error" ? " error" : "");
      badge.textContent = t.badge;
      b.appendChild(badge);
    }
    b.addEventListener("click", () => deck.select(t.id));
    // Drag an app's tab onto another to put it there (Home stays first).
    if (t.id !== "home") {
      b.draggable = true;
      b.dataset.id = t.id;
      b.addEventListener("dragstart", (e) => { dragId = t.id; e.dataTransfer.effectAllowed = "move"; b.classList.add("dragging"); });
      b.addEventListener("dragend", () => { dragId = null; b.classList.remove("dragging"); clearDrop(); });
    }
    b.addEventListener("dragover", (e) => {
      if (!dragId || t.id === dragId) return;
      e.preventDefault();
      clearDrop();
      const r = b.getBoundingClientRect();
      b.classList.add(t.id === "home" || e.clientX < r.left + r.width / 2 ? "dropBefore" : "dropAfter");
    });
    b.addEventListener("drop", (e) => {
      if (!dragId || t.id === dragId) return;
      e.preventDefault();
      const after = b.classList.contains("dropAfter");
      clearDrop();
      // "before" = the tab it should end up in front of (null = the end).
      const ids = s.tabs.map((x) => x.id).filter((x) => x !== "home" && x !== dragId);
      let before = t.id === "home" ? ids[0] : after ? ids[ids.indexOf(t.id) + 1] : t.id;
      if (before === undefined) before = null;
      deck.moveApp(dragId, { before });
    });
    tabsEl.appendChild(b);
  });
}
let dragId = null;
function clearDrop() { tabsEl.querySelectorAll(".dropBefore, .dropAfter").forEach((x) => x.classList.remove("dropBefore", "dropAfter")); }

deck.onState(render);
deck.getState();
deck.onFocus((f) => document.body.classList.toggle("blurred", !f));
backBtn.addEventListener("click", () => deck.nav("back"));
fwdBtn.addEventListener("click", () => deck.nav("forward"));
document.getElementById("reload").addEventListener("click", () => deck.nav("reload"));
gearBtn.addEventListener("click", () => deck.toggleSettings());
