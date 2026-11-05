// Keel shell: navigation, the Today screen, Settings and sign-in. Each app runs unchanged in its
// own iframe (apps/<id>/index.html) and talks to the shared store through assets/app-bridge.js.

import { Store, APP_IDS, base64ToBlob } from "./store.js";
import * as cloud from "./cloud.js";
import * as ai from "./ai.js";
import * as T from "./today.js";

// ---------- apps ----------
const APPS = [
  { id: "cleaning-rounds", name: "Cleaning Rounds", short: "Chores", group: "Household", icon: "sparkle", blurb: "Chores by room with repeat intervals" },
  { id: "house-upkeep-ledger", name: "House Upkeep Ledger", short: "Upkeep", group: "Household", icon: "house", blurb: "Home maintenance, systems and spending" },
  { id: "garden-planner", name: "Garden Planner", short: "Garden", group: "Household", icon: "sprout", blurb: "Sowing windows, beds and fruit trees" },
  { id: "pantry-recipe-book", name: "Pantry & Recipe Book", short: "Pantry", group: "Household", icon: "pot", blurb: "Pantry stock, recipes and shopping list" },
  { id: "garage-logbook", name: "Garage Logbook", short: "Garage", group: "Personal", icon: "car", blurb: "Car maintenance and service history" },
  { id: "cut-to-150", name: "Cut to 150", short: "Fitness", group: "Personal", icon: "trend", blurb: "Weigh-ins, trend and workouts" },
  { id: "card-file", name: "Card File", short: "Cards", group: "Personal", icon: "card", blurb: "Business cards and contacts" },
];
const APP = Object.fromEntries(APPS.map((a) => [a.id, a]));
const DEFAULT_PINS = ["cleaning-rounds", "pantry-recipe-book", "cut-to-150"];
const REPO_URL = "https://github.com/wordnerd235/Keel";

const ICONS = {
  keel: '<path d="M3 10h18l-2.6 5.2A3 3 0 0 1 15.7 17H8.3a3 3 0 0 1-2.7-1.8z"/><path d="M12 17v4"/><path d="M12 10V3l5 5h-5"/>',
  today: '<path d="M12 3v2M5.6 6.6 7 8M18.4 6.6 17 8M3 14h2M19 14h2"/><path d="M7.5 14a4.5 4.5 0 0 1 9 0"/><path d="M3 18h18"/>',
  sparkle: '<path d="M11 3.5 12.6 8l4.4 1.6-4.4 1.6L11 15.7l-1.6-4.5L5 9.6 9.4 8z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/>',
  house: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  sprout: '<path d="M12 21v-8.5"/><path d="M12 12.5C12 8 15 5 20 5c0 4.5-3 7.5-8 7.5z"/><path d="M12 14.5c0-3.3-2.6-6-7-6 0 3.3 2.6 6 7 6z"/>',
  pot: '<path d="M3 10h18"/><path d="M5 10v5.5A4.5 4.5 0 0 0 9.5 20h5a4.5 4.5 0 0 0 4.5-4.5V10"/><path d="M9.5 6.5c0-1.3 1.2-1.6 1.2-3M13.5 6.5c0-1.3 1.2-1.6 1.2-3"/>',
  car: '<path d="M4 16.5V12l2-4.6A2 2 0 0 1 7.8 6h8.4a2 2 0 0 1 1.8 1.4L20 12v4.5a1 1 0 0 1-1 1h-1.2M6.2 17.5H5a1 1 0 0 1-1-1"/><path d="M4 12h16"/><circle cx="7.8" cy="16.6" r="1.6"/><circle cx="16.2" cy="16.6" r="1.6"/><path d="M9.4 17.2h5.2"/>',
  trend: '<path d="M3 6.5l6 6 4-4 8 8"/><path d="M15 16.5h6v-6"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.8 16c.6-1.4 1.6-2 2.7-2s2.1.6 2.7 2"/><path d="M14 10h4M14 13.5h3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
  arrow: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};
const icon = (name, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s, el = document) => el.querySelector(s);
const appVar = (id) => `--app:var(--c-${id})`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const money = (n) => "$" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
const setPref = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

// ---------- state ----------
const store = new Store();
const S = {
  phase: "boot",        // boot | signin | notmember | ready
  fb: null,             // Firebase handles when configured
  user: null,
  syncError: null,
  online: navigator.onLine,
  route: "today",
  frames: new Map(),    // app id -> { iframe, loading }
  ai: ai.loadPrefs(),
  knownKeys: [],        // "app/collection" for every collection Today reads
};
let readyResolve;
let readyPromise = new Promise((r) => (readyResolve = r));

// ---------- the API app-bridge.js uses ----------
window.keel = {
  store,
  ready: () => readyPromise,
  canWrite: () => S.phase === "ready",
  userId: () => (S.user ? S.user.uid : "local"),
  userName: () => (S.user ? S.user.email || "Signed in" : "This device"),
  themeFor: () => { const t = pref("keel:theme", "system"); return t === "light" || t === "dark" ? t : null; },
  download(filename, b64, type) { saveFile(filename, base64ToBlob(b64, type)); },
  uploadAsset: (app, b64, type) => store.putAsset(app, base64ToBlob(b64, type)),
  sampleLimits: () => (currentProvider() ? ai.limits() : null),
  sampleJson: async (prompt, images) => {
    try { return await ai.readPhotos({ provider: currentProvider(), prefs: S.ai, fb: S.fb }, prompt, images); }
    catch (e) {
      // The pages show their own short message; setup problems also get the real reason here.
      if (e && ["not_granted", "sampling_disabled", "rate_limited", "unavailable"].includes(e.code)) toast(e.message);
      throw e;
    }
  },
};
function currentProvider() { return ai.activeProvider(S.ai, store.mode === "firebase" && !!S.fb); }

function saveFile(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}

// ---------- boot ----------
async function boot() {
  applyTheme();
  fillIcons(document);
  renderChrome();
  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => { S.online = true; renderSync(); });
  window.addEventListener("offline", () => { S.online = false; renderSync(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshToday(); });
  setInterval(refreshToday, 10 * 60 * 1000);
  store.addEventListener("change", scheduleRefresh);
  store.addEventListener("sync-error", (e) => {
    const err = e.detail && e.detail.error;
    S.syncError = err; renderSync();
    toast(err && err.message ? "Didn't sync: " + err.message : "A change didn't sync.");
  });
  T.loadGardenTables().then(scheduleRefresh);
  route();

  if (!cloud.configured()) { await startLocal(); return; }
  try {
    S.fb = await cloud.init();
  } catch (e) {
    console.error(e);
    toast("Couldn't start sync. Using this device only for now.");
    await startLocal(); return;
  }
  cloud.onUser(async (user) => {
    S.user = user;
    if (!user) {
      if (pref("keel:local-only", "") === "1") { await startLocal(); return; }
      await setPhase("signin"); return;
    }
    const m = await cloud.membership(user.uid);
    if (m === "no") { await setPhase("notmember"); return; }
    setPref("keel:local-only", null);
    await store.useFirebase({ mod: S.fb.mod, db: S.fb.db, app: S.fb.app, uid: user.uid });
    await setPhase("ready");
  });
}

async function startLocal() {
  await store.useLocal();
  await setPhase("ready");
}

async function setPhase(phase) {
  const wasReady = S.phase === "ready";
  S.phase = phase;
  // Pages loaded under the previous account or mode must reload.
  for (const [, f] of S.frames) f.iframe.remove();
  S.frames.clear();
  if (phase === "ready") {
    readyResolve();
    // Load every app's data so Today and the badges are complete.
    S.knownKeys = [];
    for (const id of APP_IDS) for (const c of await store.listCollections(id)) { S.knownKeys.push(id + "/" + c); store.subscribe(id, c, scheduleRefresh); }
  } else if (wasReady) {
    readyPromise = new Promise((r) => (readyResolve = r));
  }
  renderChrome();
  route();
}

// ---------- routing ----------
function route() {
  const h = decodeURIComponent((location.hash || "").replace(/^#\/?/, ""));
  S.route = h === "settings" || APP[h] ? h : "today";
  const view = $("#view");
  closeSheet();
  if (S.phase !== "ready") {
    hideFrames();
    view.hidden = false;
    if (S.phase === "boot") view.innerHTML = `<div class="center"><div><div class="spinner"></div><p class="muted small">Opening Keel…</p></div></div>`;
    else if (S.phase === "signin") renderSignIn();
    else if (S.phase === "notmember") renderNotMember();
    renderNavState();
    return;
  }
  if (APP[S.route]) {
    view.hidden = true;
    showFrame(S.route);
    document.title = APP[S.route].name + " · Keel";
  } else {
    hideFrames();
    view.hidden = false;
    if (S.route === "settings") { renderSettings(); document.title = "Settings · Keel"; }
    else { renderToday(); document.title = "Keel"; }
    view.scrollTop = 0;
  }
  renderNavState();
}

function showFrame(id) {
  let f = S.frames.get(id);
  if (!f) {
    const iframe = document.createElement("iframe");
    iframe.className = "frame";
    iframe.title = APP[id].name;
    iframe.src = `apps/${id}/index.html`;
    iframe.setAttribute("allow", "camera; clipboard-write");
    const loading = document.createElement("div");
    loading.className = "frame-loading";
    loading.innerHTML = `<div><div class="spinner"></div>Opening ${esc(APP[id].name)}…</div>`;
    iframe.addEventListener("load", () => { loading.remove(); themeFrame(iframe); });
    $("#main").append(iframe, loading);
    f = { iframe, loading };
    S.frames.set(id, f);
  }
  for (const [k, g] of S.frames) { g.iframe.hidden = k !== id; if (g.loading.isConnected) g.loading.hidden = k !== id; }
}
function hideFrames() { for (const [, g] of S.frames) { g.iframe.hidden = true; if (g.loading.isConnected) g.loading.hidden = true; } }

// ---------- theme ----------
function applyTheme() {
  const t = window.keel.themeFor();
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  for (const [, f] of S.frames) themeFrame(f.iframe);
}
function themeFrame(iframe) {
  try {
    const t = window.keel.themeFor(), root = iframe.contentDocument && iframe.contentDocument.documentElement;
    if (!root) return;
    if (t) root.setAttribute("data-theme", t); else root.removeAttribute("data-theme");
  } catch (e) { /* not loaded yet */ }
}

// ---------- chrome: sidebar, tab bar, sheet ----------
function fillIcons(root) { root.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); }); }

function pins() {
  try { const p = JSON.parse(pref("keel:pins", "null")); if (Array.isArray(p) && p.length === 3 && p.every((x) => APP[x])) return p; } catch (e) { /* default */ }
  return DEFAULT_PINS;
}

function renderChrome() {
  $("#side-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const groups = ["Household", "Personal"];
  $("#side-nav").innerHTML = `
    <a href="#/today" data-route="today"><span class="chip-i today">${icon("today")}</span><span class="grow">Today</span></a>
    ${groups.map((g) => `<div class="nav-label">${g}</div>${APPS.filter((a) => a.group === g).map((a) => `
      <a href="#/${a.id}" data-route="${a.id}" style="${appVar(a.id)}"><span class="chip-i">${icon(a.icon)}</span><span class="grow">${esc(a.name)}</span><span class="badge" data-badge="${a.id}" hidden></span></a>`).join("")}`).join("")}`;
  const p = pins();
  $("#tabbar").innerHTML = `
    <a href="#/today" data-route="today"><span class="ti">${icon("today")}</span><span class="t">Today</span></a>
    ${p.map((id) => `<a href="#/${id}" data-route="${id}" style="${appVar(id)}"><span class="ti">${icon(APP[id].icon)}</span><span class="t">${esc(APP[id].short)}</span><span class="badge" data-badge="${id}" hidden></span></a>`).join("")}
    <button type="button" id="more-btn" aria-haspopup="dialog"><span class="ti">${icon("grid")}</span><span class="t">More</span><span class="badge" data-badge="more" hidden></span></button>`;
  $("#more-btn").addEventListener("click", openSheet);
  $("#tabbar").hidden = S.phase !== "ready";
  $("#shell").dataset.phase = S.phase;
  renderSync();
  renderNavState();
  updateBadges();
}

function renderNavState() {
  document.querySelectorAll("[data-route]").forEach((a) => {
    if (a.dataset.route === S.route) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const more = $("#more-btn");
  if (more) { if (!pins().includes(S.route) && S.route !== "today") more.setAttribute("aria-current", "page"); else more.removeAttribute("aria-current"); }
}

function openSheet() {
  const counts = badgeCounts();
  $("#overlay").innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="All apps">
    <div class="grabber"></div>
    ${["Household", "Personal"].map((g) => `<h2>${g}</h2><div class="grid-apps">${APPS.filter((a) => a.group === g).map((a) => `
      <a href="#/${a.id}" style="${appVar(a.id)}" ${S.route === a.id ? 'aria-current="page"' : ""}><span class="chip-i">${icon(a.icon)}</span>${esc(a.short)}${counts[a.id] ? `<span class="badge">${counts[a.id]}</span>` : ""}</a>`).join("")}</div>`).join("")}
    <h2>Keel</h2>
    <a class="sheet-row" href="#/today"><span class="chip-i today">${icon("today")}</span>Today</a>
    <a class="sheet-row" href="#/settings"><span class="chip-i today">${icon("gear")}</span>Settings, sync and backup</a>
  </div></div>`;
  $("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim" || e.target.closest("a")) closeSheet(); });
  const first = $("#overlay a"); if (first) first.focus();
}
function closeSheet() { $("#overlay").innerHTML = ""; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

function renderSync() {
  const el = $("#side-sync");
  let dot = "", text = "";
  if (S.phase !== "ready") { text = S.phase === "boot" ? "Starting…" : "Not signed in"; }
  else if (store.mode === "local") { text = "Saved on this device"; }
  else if (S.syncError && S.syncError.code === "invalid_argument") { dot = "err"; text = "Sync problem: no permission"; }
  else if (!S.online) { dot = "off"; text = "Offline · changes saved here"; }
  else { dot = "ok"; text = "Synced" + (S.user && S.user.email ? " · " + S.user.email : ""); }
  el.innerHTML = `<span class="dot ${dot}"></span><span>${esc(text)}</span>`;
  el.title = text;
}

// ---------- summaries and badges ----------
function summaries() {
  const out = {};
  for (const id of APP_IDS) {
    try { out[id] = T.SUMMARIES[id](store.data[id] || {}); } catch (e) { console.error("Summary failed for", id, e); out[id] = null; }
  }
  return out;
}
function badgeCounts(sums = summaries()) {
  const c = {};
  for (const id of APP_IDS) c[id] = (sums[id] && sums[id].attention) || 0;
  return c;
}
function updateBadges(sums) {
  if (S.phase !== "ready") { document.querySelectorAll("[data-badge]").forEach((b) => (b.hidden = true)); return; }
  const c = badgeCounts(sums), p = pins();
  document.querySelectorAll("[data-badge]").forEach((b) => {
    const id = b.dataset.badge;
    const n = id === "more" ? APP_IDS.filter((x) => !p.includes(x)).reduce((a, x) => a + c[x], 0) : c[id];
    b.textContent = n > 99 ? "99+" : n; b.hidden = !n;
    if (n) b.setAttribute("aria-label", n + " need attention");
  });
}

let refreshTimer = null;
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshToday, 120); }
function refreshToday() {
  if (S.phase !== "ready") return;
  const sums = summaries();
  updateBadges(sums);
  renderSync();
  if (S.route === "today" && !$("#view").hidden) renderToday(sums, true);
}

// ---------- Today ----------
function greeting() { const h = new Date().getHours(); return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }

function renderToday(sums = summaries(), keepScroll = false) {
  const view = $("#view"), y = view.scrollTop;
  const chores = sums["cleaning-rounds"], upkeep = sums["house-upkeep-ledger"], garage = sums["garage-logbook"];
  const fit = sums["cut-to-150"], pantry = sums["pantry-recipe-book"], garden = sums["garden-planner"], cards = sums["card-file"];
  const chips = [];
  if (chores && chores.attention) chips.push(["cleaning-rounds", `<b>${chores.attention}</b> ${chores.attention === 1 ? "chore" : "chores"} due`]);
  if (upkeep && upkeep.attention) chips.push(["house-upkeep-ledger", `<b>${upkeep.attention}</b> house ${upkeep.attention === 1 ? "task" : "tasks"}`]);
  if (garage && garage.attention) chips.push(["garage-logbook", `<b>${garage.attention}</b> car ${garage.attention === 1 ? "service" : "services"} overdue`]);
  if (pantry && pantry.attention) chips.push(["pantry-recipe-book", `<b>${pantry.attention}</b> to use today`]);
  const total = APP_IDS.reduce((n, id) => n + ((sums[id] && sums[id].attention) || 0), 0);
  if (fit && fit.hasPlan && !fit.weighedToday) chips.push(["cut-to-150", "No weigh-in yet today"]);
  const loading = store.mode === "firebase" && !S.knownKeys.every((k) => store.loaded.has(k));
  const empty = !loading && APP_IDS.every((id) => !Object.values(store.data[id] || {}).some((c) => c && Object.keys(c).length));

  view.innerHTML = `<div class="page">
    <div class="top">
      <div>
        <div class="eyebrow">${esc(new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}</div>
        <h1>${greeting()}</h1>
        <p class="lede">${loading ? "Loading your data…" : empty ? "Welcome to Keel. Your tools are ready." : total ? `${plural(total, "thing")} ${total === 1 ? "needs" : "need"} attention.` : `<span class="allclear">${icon("check")} All caught up.</span>`}</p>
      </div>
      <a class="icon-btn mobile-brand" href="#/settings" aria-label="Settings">${icon("gear")}</a>
    </div>
    ${chips.length ? `<div class="attn">${chips.map(([id, t]) => `<a href="#/${id}" style="${appVar(id)}"><span class="chip-i">${icon(APP[id].icon)}</span><span>${t}</span></a>`).join("")}</div>` : ""}
    ${empty ? emptyBanner() : ""}
    ${loading ? "" : migrateBanner()}
    <div class="cards">
      ${choresCard(chores)}
      ${fitnessCard(fit)}
      ${pantryCard(pantry)}
      ${upkeepCard(upkeep)}
      ${garageCard(garage)}
      ${gardenCard(garden)}
      ${cardsCard(cards)}
    </div>
  </div>`;
  if (keepScroll) view.scrollTop = y;
  drawSparks(fit);
  const mig = $("#migrate-btn"); if (mig) mig.addEventListener("click", migrateLocal);
  const migNo = $("#migrate-no"); if (migNo) migNo.addEventListener("click", () => { setPref("keel:migrate-dismissed", "1"); renderToday(); });
}

function emptyBanner() {
  return `<div class="banner"><span>Nothing is saved yet${store.mode === "firebase" ? " in your account" : " on this device"}. Restore a Keel backup to bring in your data, or open any tool to start fresh.</span><a class="btn small primary" href="#/settings">Restore a backup</a></div>`;
}

function migrateBanner() {
  if (store.mode !== "firebase" || pref("keel:migrate-dismissed", "") === "1" || !store.hasLocalData()) return "";
  const cloudEmpty = APP_IDS.every((id) => !Object.values(store.data[id] || {}).some((c) => c && Object.keys(c).length));
  if (!cloudEmpty) return "";
  return `<div class="banner"><span>This device has data saved from before you signed in. Copy it into your account?</span><span class="row" style="display:flex;gap:8px"><button class="btn small" id="migrate-no">Not now</button><button class="btn small primary" id="migrate-btn">Copy to my account</button></span></div>`;
}

function cardHead(id, extra = "") {
  const a = APP[id];
  return `<a class="card-h" href="#/${id}"><span class="chip-i">${icon(a.icon)}</span><h2>${esc(a.name)}</h2>${extra}<span class="go">Open${icon("arrow")}</span></a>`;
}
const card = (id, body) => `<section class="card" style="${appVar(id)}" aria-label="${esc(APP[id].name)}">${cardHead(id)}${body}</section>`;
const stat = (n, l, tone = "") => `<div><div class="n ${tone}">${n}</div><div class="l">${esc(l)}</div></div>`;

function choresCard(s) {
  if (!s) return card("cleaning-rounds", `<p class="empty-note">Couldn't read the chore chart.</p>`);
  if (!s.total) return card("cleaning-rounds", `<p class="empty-note">No chores yet. Add rooms and chores with how often each should happen.</p>`);
  return card("cleaning-rounds", `
    <div class="stats">${stat(s.late, "Overdue", s.late ? "bad" : "")}${stat(s.today, "Due today", s.today ? "warn" : "")}${stat(s.mins, "Min to catch up")}</div>
    <ul class="rows">${s.top.map((c) => `<li><div class="main-t"><div class="t1">${esc(c.name)}</div><div class="t2">${esc(c.room)}${c.minutes ? ` · ${c.minutes} min` : ""}</div></div><span class="pill ${c.tone}">${esc(c.when)}</span></li>`).join("")}</ul>
    ${s.week ? `<p class="small muted" style="margin:0">${plural(s.week, "more chore")} in the next 7 days.</p>` : ""}`);
}

function upkeepCard(s) {
  if (!s) return card("house-upkeep-ledger", `<p class="empty-note">Couldn't read the ledger.</p>`);
  if (!s.total && !s.systems) return card("house-upkeep-ledger", `<p class="empty-note">No maintenance tasks yet.</p>`);
  return card("house-upkeep-ledger", `
    <div class="stats">${stat(s.late, "Due or overdue", s.late ? "bad" : "")}${stat(s.soon, "Next 30 days", s.soon ? "warn" : "")}${stat(money(s.spent), "Spent in " + s.year)}</div>
    <ul class="rows">${s.top.map((t) => `<li><div class="main-t"><div class="t1">${esc(t.name)}</div><div class="t2">${esc(t.system || "General")}${t.pro ? " · Pro" : ""}</div></div><span class="pill ${t.tone}">${esc(t.when)}</span></li>`).join("")}</ul>`);
}

function garageCard(s) {
  if (!s) return card("garage-logbook", `<p class="empty-note">Couldn't read the logbook.</p>`);
  if (!s.vehicles.length) return card("garage-logbook", `<p class="empty-note">No vehicles yet.</p>`);
  return card("garage-logbook", `<div>${s.vehicles.map((v) => {
    const pill = v.over ? `<span class="pill bad">${v.over} overdue</span>` : v.soon ? `<span class="pill warn">${v.soon} due soon</span>` : `<span class="pill good">All good</span>`;
    return `<div class="veh">
      <div class="main-t" style="flex:1;min-width:0">
        <div class="veh-top"><span class="t1">${esc(v.name)}</span><span class="odo" title="Odometer">${Math.round(v.miles || 0).toLocaleString("en-US")} mi</span></div>
        <div class="t2">${v.next ? `Next: ${esc(v.next.label)}${v.next.when && v.next.status !== "over" ? ` · ${esc(v.next.when)}` : ""}` : esc(v.sub)}</div></div>
      ${pill}</div>`;
  }).join("")}</div>`);
}

function fitnessCard(s) {
  if (!s) return card("cut-to-150", `<p class="empty-note">Couldn't read your weigh-ins.</p>`);
  if (!s.entries.length) return card("cut-to-150", `<p class="empty-note">No weigh-ins yet. Log one to start the trend.</p>`);
  const f1 = (n) => (n == null || isNaN(n) ? "–" : Number(n).toFixed(1));
  const lostTxt = s.lost >= 0 ? `−${f1(s.lost)} lb since start` : `+${f1(Math.abs(s.lost))} lb above start`;
  const when = s.daysSince === 0 ? "today" : s.daysSince === 1 ? "yesterday" : `${s.daysSince} days ago`;
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return card("cut-to-150", `
    <div class="hero">
      <div><div class="big">${f1(s.trend)}<span class="unit">lb</span></div><div class="cap">7-day average</div></div>
      <div style="padding-bottom:4px"><div class="delta">${lostTxt}</div><div class="cap">Last weigh-in ${when}: ${f1(s.latest)} lb</div></div>
    </div>
    <div><div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.pct)}" aria-label="Progress to goal"><i style="width:${s.pct.toFixed(1)}%"></i></div>
      <div class="meter-l"><span>${f1(s.plan.startWeight)}</span><span>${Math.round(s.pct)}% of the way</span><span>${f1(s.plan.goalWeight)}</span></div></div>
    <div class="spark" id="spark"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div class="weekdots" aria-label="This week's workouts">${s.weekDays.map((d, i) => `<i class="${d.lift ? "on" : ""} ${d.walk ? "walk" : ""} ${d.today ? "today" : ""}" title="${d.lift ? "Lifted" : ""}${d.lift && d.walk ? " + " : ""}${d.walk ? "Walk or cardio" : ""}${!d.lift && !d.walk ? "Rest" : ""}">${days[i]}</i>`).join("")}</div>
      <span class="small muted">${s.lifts} of 3 lifts this week</span>
    </div>`);
}

// Sparkline: daily weigh-ins as dots (de-emphasized), the 7-day average as the accent line,
// and the planned pace as a dashed reference. Hover or tap shows the values.
let sparkObserver = null;
function drawSparks(s) {
  const host = $("#spark");
  if (sparkObserver) { sparkObserver.disconnect(); sparkObserver = null; }
  if (!host || !s || !s.entries.length) return;
  const draw = () => {
    const W = Math.max(200, host.clientWidth), H = 92, padL = 4, padR = 4, padT = 8, padB = 8;
    const toT = (d) => new Date(d + "T12:00:00").getTime();
    const DAY = 864e5;
    const pts = s.entries;
    const startT = Math.min(toT(s.plan.startDate), toT(pts[0].date));
    const endT = Math.max(toT(pts[pts.length - 1].date), startT + 7 * DAY, toT(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10)));
    const goalT = toT(s.plan.goalDate), sw = s.plan.startWeight, gw = s.plan.goalWeight;
    const paceAt = (t) => sw + (gw - sw) * Math.max(0, Math.min(1, (t - toT(s.plan.startDate)) / (goalT - toT(s.plan.startDate))));
    const ys = [...pts.map((p) => p.weight), ...pts.map((p) => p.avg), paceAt(startT), paceAt(endT)];
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const x = (t) => padL + ((t - startT) / (endT - startT)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(toT(p.date)).toFixed(1)},${y(p.avg).toFixed(1)}`).join("");
    const pace = `M${x(startT).toFixed(1)},${y(paceAt(startT)).toFixed(1)}L${x(endT).toFixed(1)},${y(paceAt(endT)).toFixed(1)}`;
    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weight trend: ${pts.length} weigh-ins, latest 7-day average ${s.trend.toFixed(1)} lb">
        <path d="${pace}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4" opacity=".7"/>
        ${pts.map((p) => `<circle cx="${x(toT(p.date)).toFixed(1)}" cy="${y(p.weight).toFixed(1)}" r="4" fill="color-mix(in srgb, var(--app) 40%, var(--surface))" stroke="var(--surface)" stroke-width="2"/>`).join("")}
        <path d="${line}" fill="none" stroke="var(--app)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle id="spark-hl" r="5" fill="var(--app)" stroke="var(--surface)" stroke-width="2" style="display:none"/>
        <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" id="spark-hit"/>
      </svg>
      <div class="legend"><span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="color-mix(in srgb, var(--app) 40%, var(--surface))"/></svg>Daily weigh-in</span><span><svg width="16" height="10" aria-hidden="true"><path d="M1 5h14" stroke="var(--app)" stroke-width="2"/></svg>7-day average</span><span><svg width="16" height="10" aria-hidden="true"><path d="M1 5h14" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="3 3"/></svg>Planned pace</span></div>
      <div class="tip" id="spark-tip" hidden></div>`;
    const hit = $("#spark-hit", host), tip = $("#spark-tip", host), hl = $("#spark-hl", host);
    const show = (ev) => {
      const r = hit.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      let best = pts[0], bd = Infinity;
      for (const p of pts) { const d = Math.abs(x(toT(p.date)) - px); if (d < bd) { bd = d; best = p; } }
      const cx = x(toT(best.date)), cy = y(best.avg);
      hl.setAttribute("cx", cx); hl.setAttribute("cy", cy); hl.style.display = "";
      tip.hidden = false;
      tip.innerHTML = `${esc(new Date(best.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }))}<br>${best.weight.toFixed(1)} lb · avg ${best.avg.toFixed(1)}`;
      tip.style.left = Math.max(60, Math.min(W - 60, cx)) + "px"; tip.style.top = (cy - 10) + "px";
    };
    const hide = () => { tip.hidden = true; hl.style.display = "none"; };
    hit.addEventListener("pointermove", show); hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", hide);
  };
  draw();
  sparkObserver = new ResizeObserver(() => { if (Math.abs(host.clientWidth - (Number($("svg", host)?.getAttribute("width")) || 0)) > 4) draw(); });
  sparkObserver.observe(host);
}

function pantryCard(s) {
  if (!s) return card("pantry-recipe-book", `<p class="empty-note">Couldn't read the pantry.</p>`);
  if (!s.items && !s.recipes && !s.shop.length) return card("pantry-recipe-book", `<p class="empty-note">Nothing in the pantry yet.</p>`);
  const shopList = s.shop.slice(0, 4);
  return card("pantry-recipe-book", `
    <div class="stats">${stat(s.shop.length, "On the list")}${stat(s.expiring.length, "Use soon", s.expiring.some((x) => x.tone === "bad") ? "bad" : s.expiring.length ? "warn" : "")}${stat(s.ready.length, "Ready to cook")}</div>
    ${s.expiring.length ? `<div class="sub-h">Use soon</div><ul class="rows">${s.expiring.slice(0, 3).map((x) => `<li><div class="main-t"><div class="t1">${esc(x.name)}</div></div><span class="pill ${x.tone}">${esc(x.when)}</span></li>`).join("")}</ul>` : ""}
    ${shopList.length ? `<div class="sub-h">Shopping list</div><ul class="rows">${shopList.map((x) => `<li><div class="main-t"><div class="t1">${esc(x.name)}</div></div>${x.store ? `<span class="pill">${esc(x.store)}</span>` : ""}</li>`).join("")}</ul>${s.shop.length > 4 ? `<p class="small muted" style="margin:0">and ${s.shop.length - 4} more</p>` : ""}` : ""}
    ${s.ready.length ? `<p class="small" style="margin:0"><span class="muted">You can make:</span> ${s.ready.slice(0, 3).map(esc).join(", ")}${s.ready.length > 3 ? "…" : ""}</p>` : ""}
    ${s.low.length ? `<p class="small" style="margin:0"><span class="muted">Running low:</span> ${s.low.slice(0, 4).map(esc).join(", ")}${s.low.length > 4 ? "…" : ""}</p>` : ""}`);
}

function gardenCard(s) {
  if (!s) return card("garden-planner", `<p class="empty-note">Couldn't read the garden plan.</p>`);
  return card("garden-planner", `
    <p style="margin:0;font-size:14.5px">${esc(s.frost)}</p>
    ${s.now.length ? `<div class="sub-h">Do now</div><ul class="rows">${s.now.slice(0, 3).map((c) => `<li><div class="main-t"><div class="t1">${esc(c.name)}${c.mine ? ` <span class="pill good" style="font-size:11px;padding:3px 6px">In garden</span>` : ""}</div><div class="t2">${esc(c.kind)}</div></div><span class="pill">until ${esc(c.until)}</span></li>`).join("")}</ul>${s.now.length > 3 ? `<p class="small muted" style="margin:0">and ${s.now.length - 3} more</p>` : ""}` : `<p class="empty-note">Nothing to sow or plant this week.</p>`}
    ${s.treeJobs.length ? `<div class="sub-h">Fruit trees this month</div><ul class="rows">${s.treeJobs.slice(0, 2).map((j) => `<li><div class="main-t"><div class="t1">${esc(j.who)}</div><div class="t2" style="white-space:normal">${esc(j.text)}</div></div></li>`).join("")}</ul>${s.treeJobs.length > 2 ? `<p class="small muted" style="margin:0">and ${s.treeJobs.length - 2} more tree jobs</p>` : ""}` : ""}`);
}

function cardsCard(s) {
  if (!s) return card("card-file", `<p class="empty-note">Couldn't read the card file.</p>`);
  if (!s.total) return card("card-file", `<p class="empty-note">No cards yet. Scan or type in a business card.</p>`);
  return card("card-file", `
    <p style="margin:0" class="small muted">${plural(s.total, "card")} saved. Newest:</p>
    <ul class="rows">${s.recent.map((c) => `<li><div class="main-t"><div class="t1">${esc(c.name)}</div>${c.sub ? `<div class="t2">${esc(c.sub)}</div>` : ""}</div></li>`).join("")}</ul>`);
}

async function migrateLocal() {
  const btn = $("#migrate-btn"); if (btn) { btn.disabled = true; btn.textContent = "Copying…"; }
  try {
    const local = new Store(); await local.useLocal();
    const backup = await local.exportAll();
    const r = await store.importAll(backup);
    setPref("keel:migrate-dismissed", "1");
    toast(`Copied ${plural(r.docs, "item")} into your account.`);
  } catch (e) { console.error(e); toast("Couldn't copy: " + (e.message || e)); }
  refreshToday();
}

// ---------- sign-in ----------
function renderSignIn() {
  $("#view").innerHTML = `<div class="center"><div class="auth">
    <div class="brand"><span class="brand-mark">${icon("keel")}</span><span class="brand-name">Keel</span></div>
    <h1>Sign in to see your data</h1>
    <p>Your chores, pantry, cars and the rest sync across your phone and computer.</p>
    <form id="signin" novalidate>
      <label class="field">Email<input class="input" type="email" id="si-email" autocomplete="username" required></label>
      <label class="field">Password<input class="input" type="password" id="si-pass" autocomplete="current-password" required></label>
      <button class="btn primary" type="submit" id="si-go">Sign in</button>
      <p class="status" id="si-msg" role="alert"></p>
    </form>
    <p class="alt"><button class="linkbtn" id="si-reset" type="button">Forgot password?</button></p>
    <p class="alt">Or <button class="linkbtn" id="si-local" type="button">use Keel on this device only</button>, without syncing.</p>
  </div></div>`;
  const msg = $("#si-msg");
  $("#signin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#si-email").value, pass = $("#si-pass").value;
    if (!email || !pass) { msg.className = "status err"; msg.textContent = "Enter your email and password."; return; }
    $("#si-go").disabled = true; msg.className = "status"; msg.textContent = "Signing in…";
    try { await cloud.signIn(email, pass); msg.textContent = ""; }
    catch (err) { msg.className = "status err"; msg.textContent = err.message; $("#si-go").disabled = false; }
  });
  $("#si-reset").addEventListener("click", async () => {
    const email = $("#si-email").value;
    if (!email) { msg.className = "status err"; msg.textContent = "Type your email above first."; return; }
    try { await cloud.resetPassword(email); msg.className = "status ok"; msg.textContent = "Check your email for a link to set a new password."; }
    catch (err) { msg.className = "status err"; msg.textContent = err.message; }
  });
  $("#si-local").addEventListener("click", async () => { setPref("keel:local-only", "1"); await startLocal(); });
}

function renderNotMember() {
  const uid = S.user ? S.user.uid : "";
  $("#view").innerHTML = `<div class="center"><div class="auth">
    <div class="brand"><span class="brand-mark">${icon("keel")}</span><span class="brand-name">Keel</span></div>
    <h1>This account isn't set up for Keel yet</h1>
    <p>You're signed in as <b>${esc(S.user && S.user.email)}</b>, but the database only lets listed members in. In the Firebase console, open <b>Firestore Database</b>, start a collection called <b>members</b>, and add a document whose ID is:</p>
    <div class="code" id="uid">${esc(uid)}</div>
    <button class="btn" id="copy-uid" type="button">Copy ID</button>
    <p class="small">Give the document one field, for example <span class="mono">name</span> = your name. Then reload this page.</p>
    <p class="small muted">Already added it? Check that the rules from <span class="mono">firestore.rules</span> are published (Firestore Database &gt; Rules). Until they are, the database turns everyone away.</p>
    <button class="btn primary" id="nm-reload" type="button">Reload</button>
    <p class="alt"><button class="linkbtn" id="nm-out" type="button">Sign out</button></p>
  </div></div>`;
  $("#copy-uid").addEventListener("click", async () => { try { await navigator.clipboard.writeText(uid); toast("Copied"); } catch (e) { toast("Select the ID and copy it"); } });
  $("#nm-reload").addEventListener("click", () => location.reload());
  $("#nm-out").addEventListener("click", () => cloud.signOutUser());
}

// ---------- settings ----------
function renderSettings() {
  const theme = pref("keel:theme", "system"), p = pins(), prov = currentProvider();
  const provText = prov === "claude" ? `Using Claude (${ai.CLAUDE_MODEL_ID}) with your API key.` : prov === "gemini" ? "Using Gemini through your Firebase project." : "Off. Card File and Pantry hide their scan buttons.";
  let account;
  if (!cloud.configured()) {
    account = `<p>Keel is saving to <b>this browser only</b>. Your phone and computer each keep their own copy.</p>
      <p class="small muted">To sync across devices, connect a free Firebase project. The steps are in <a href="${REPO_URL}/blob/main/SETUP.md" target="_blank" rel="noopener">SETUP.md</a>.</p>`;
  } else if (store.mode === "firebase") {
    account = `<dl class="kv"><dt>Signed in as</dt><dd>${esc(S.user && S.user.email)}</dd><dt>Database</dt><dd class="mono">${esc(cloud.projectId())}</dd><dt>Status</dt><dd>${S.online ? "Online, syncing" : "Offline. Changes are kept and sync when you reconnect."}</dd></dl>
      <div class="row"><button class="btn" id="st-signout" type="button">Sign out</button></div>
      ${store.hasLocalData() ? `<p class="small muted">This device also has data saved from before you signed in. <button class="linkbtn" id="st-migrate" type="button">Copy it into your account</button> (replaces what's in your account for those tools).</p>` : ""}`;
  } else {
    account = `<p>You chose to use Keel on <b>this device only</b>, so nothing syncs.</p>
      <div class="row"><button class="btn primary" id="st-signin" type="button">Sign in to sync</button></div>`;
  }

  $("#view").innerHTML = `<div class="page set">
    <div class="eyebrow">Keel</div>
    <h1>Settings</h1>

    <section aria-labelledby="h-acct"><h2 id="h-acct">Account and sync</h2>${account}</section>

    <section aria-labelledby="h-ai">
      <h2 id="h-ai">Photo reading</h2>
      <p>Lets Card File read business cards and Pantry scan groceries. ${esc(provText)}</p>
      <div style="display:flex;flex-direction:column;gap:8px" role="radiogroup" aria-label="Photo reading">
        ${[
          ["auto", "Automatic", "Claude if you've saved a key below, otherwise Gemini when you're signed in."],
          ["gemini", "Gemini through Firebase", "Free tier of Google's Gemini, through your Firebase project's AI Logic. Needs sign-in."],
          ["claude", "Claude with your API key", "Anthropic's Claude, billed to your Anthropic account (a few cents a scan)."],
          ["off", "Off", "Hide the scan buttons."],
        ].map(([v, b, t]) => `<label class="opt"><input type="radio" name="ai-prov" value="${v}" ${S.ai.provider === v ? "checked" : ""}><span><b>${b}</b><span>${t}</span></span></label>`).join("")}
      </div>
      <label class="field">Anthropic API key
        <input class="input mono" type="password" id="ai-key" autocomplete="off" spellcheck="false" placeholder="${S.ai.claudeKey ? "Saved on this device" : "sk-ant-…"}">
      </label>
      <div class="row"><button class="btn small" id="ai-key-save" type="button">Save key</button>${S.ai.claudeKey ? `<button class="btn small danger" id="ai-key-clear" type="button">Remove key</button>` : ""}<span class="small muted">Kept only in this browser. Never synced or sent anywhere but Anthropic.</span></div>
      <details><summary>Advanced: Gemini model</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
          <p class="small muted">Leave blank to let Keel pick a current Gemini Flash model. Set one if Google renames or retires models.</p>
          <div class="row"><input class="input mono" id="ai-model" style="max-width:320px" value="${esc(S.ai.geminiModel)}" placeholder="${esc(pref("keel:ai-gemini-ok", "gemini-3-flash-preview"))}"><button class="btn small" id="ai-model-save" type="button">Save</button></div>
        </div>
      </details>
    </section>

    <section aria-labelledby="h-look">
      <h2 id="h-look">Appearance</h2>
      <div class="seg" role="group" aria-label="Theme">${[["system", "Match device"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button type="button" data-theme-set="${v}" aria-pressed="${theme === v}">${l}</button>`).join("")}</div>
      <div>
        <p style="margin-bottom:8px">Phone tab bar: pick three tools to keep one tap away.</p>
        <div class="pins">${APPS.map((a) => `<label><input type="checkbox" value="${a.id}" ${p.includes(a.id) ? "checked" : ""}>${esc(a.short)}</label>`).join("")}</div>
        <p class="status" id="pin-msg"></p>
      </div>
    </section>

    <section aria-labelledby="h-backup">
      <h2 id="h-backup">Backup</h2>
      <p>Save everything (all seven tools, including card photos) to one file, or restore from one.</p>
      <div class="row">
        <button class="btn" id="bk-export" type="button">Download a backup</button>
        <label class="btn" for="bk-file">Restore from a file…</label>
        <input type="file" id="bk-file" accept="application/json,.json" class="sr">
      </div>
      <div id="bk-preview"></div>
    </section>

    <section aria-labelledby="h-about">
      <h2 id="h-about">About</h2>
      <p>Keel brings seven Life Tools apps together. Each tool works exactly as it did on its own; Keel adds the Today screen, one place for your data, sync and backup.</p>
      <p class="small muted">Source: <a href="${REPO_URL}" target="_blank" rel="noopener">${REPO_URL.replace("https://", "")}</a></p>
    </section>
  </div>`;

  const on = (id, ev, fn) => { const el = $("#" + id); if (el) el.addEventListener(ev, fn); };
  on("st-signout", "click", async () => { await cloud.signOutUser(); toast("Signed out"); });
  on("st-signin", "click", async () => { setPref("keel:local-only", null); await setPhase("signin"); });
  on("st-migrate", "click", async () => {
    if (!confirm("Copy the data saved on this device into your account? It replaces your account's data for the tools that have local data.")) return;
    try {
      const local = new Store(); await local.useLocal();
      const r = await store.importAll(await local.exportAll());
      setPref("keel:migrate-dismissed", "1"); toast(`Copied ${plural(r.docs, "item")}.`); renderSettings();
    } catch (e) { toast("Couldn't copy: " + (e.message || e)); }
  });

  document.querySelectorAll('input[name="ai-prov"]').forEach((r) => r.addEventListener("change", () => { S.ai.provider = r.value; ai.savePrefs(S.ai); reloadAiFrames(); renderSettings(); }));
  on("ai-key-save", "click", () => {
    const k = $("#ai-key").value.trim();
    if (!k) { toast("Paste your key first"); return; }
    if (!/^sk-ant-/.test(k)) { toast("That doesn't look like an Anthropic key (they start with sk-ant-)"); return; }
    S.ai.claudeKey = k; ai.savePrefs(S.ai); reloadAiFrames(); toast("Key saved on this device"); renderSettings();
  });
  on("ai-key-clear", "click", () => { S.ai.claudeKey = ""; ai.savePrefs(S.ai); reloadAiFrames(); toast("Key removed"); renderSettings(); });
  on("ai-model-save", "click", () => { S.ai.geminiModel = $("#ai-model").value.trim(); ai.savePrefs(S.ai); toast("Saved"); });

  document.querySelectorAll("[data-theme-set]").forEach((b) => b.addEventListener("click", () => {
    setPref("keel:theme", b.dataset.themeSet === "system" ? null : b.dataset.themeSet); applyTheme(); renderSettings();
  }));
  document.querySelectorAll(".pins input").forEach((c) => c.addEventListener("change", () => {
    const chosen = [...document.querySelectorAll(".pins input:checked")].map((x) => x.value);
    const msg = $("#pin-msg");
    if (chosen.length === 3) { setPref("keel:pins", JSON.stringify(chosen)); msg.className = "status ok"; msg.textContent = "Saved."; renderChrome(); }
    else { msg.className = "status"; msg.textContent = `Pick exactly three (${chosen.length} picked).`; }
  }));

  on("bk-export", "click", async () => {
    const btn = $("#bk-export"); btn.disabled = true; btn.textContent = "Preparing…";
    try {
      const data = await store.exportAll();
      const d = new Date(), pad = (n) => String(n).padStart(2, "0");
      saveFile(`keel-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`, new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
      toast("Backup downloaded");
    } catch (e) { console.error(e); toast("Backup failed: " + (e.message || e)); }
    btn.disabled = false; btn.textContent = "Download a backup";
  });
  on("bk-file", "change", async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (err) { showImport(null, "That file isn't valid JSON."); return; }
    if (!data || !data.apps) { showImport(null, "That file isn't a Keel backup."); return; }
    showImport(data);
  });
}

function showImport(data, error) {
  const box = $("#bk-preview");
  if (!box) return;
  if (error) { box.innerHTML = `<p class="status err">${esc(error)}</p>`; return; }
  const rows = Object.entries(data.apps).filter(([id]) => APP[id]).map(([id, colls]) => {
    const n = Object.values(colls || {}).reduce((a, c) => a + Object.keys(c || {}).length, 0);
    const photos = Object.keys((data.assets || {})[id] || {}).length;
    return `<li><div class="main-t"><div class="t1">${esc(APP[id].name)}</div><div class="t2">${plural(n, "item")}${photos ? `, ${plural(photos, "photo")}` : ""}</div></div></li>`;
  });
  box.innerHTML = `<div style="border:1px solid var(--line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px">
    <p><b>Restore this backup?</b> ${data.exportedAt ? `Saved ${esc(new Date(data.exportedAt).toLocaleString())}.` : ""} It replaces what's ${store.mode === "firebase" ? "in your account" : "on this device"} for:</p>
    <ul class="rows">${rows.join("")}</ul>
    <div class="row"><button class="btn primary" id="bk-go" type="button">Replace and restore</button><button class="btn" id="bk-cancel" type="button">Cancel</button></div>
    <div class="progress" hidden id="bk-prog"><i></i></div><p class="status" id="bk-msg"></p></div>`;
  $("#bk-cancel").addEventListener("click", () => { box.innerHTML = ""; });
  $("#bk-go").addEventListener("click", async () => {
    $("#bk-go").disabled = true; $("#bk-cancel").disabled = true;
    const prog = $("#bk-prog"), bar = $("#bk-prog i"), msg = $("#bk-msg");
    prog.hidden = false; msg.className = "status"; msg.textContent = "Restoring…";
    try {
      const r = await store.importAll(data, (done, total) => { bar.style.width = (total ? (done / total) * 100 : 100) + "%"; });
      bar.style.width = "100%"; msg.className = "status ok";
      msg.textContent = `Restored ${plural(r.docs, "item")}${r.photos ? ` and ${plural(r.photos, "photo")}` : ""} across ${plural(r.apps, "tool")}.`;
      for (const [, f] of S.frames) f.iframe.remove();
      S.frames.clear();
      refreshToday();
    } catch (e) { console.error(e); msg.className = "status err"; msg.textContent = "Restore failed: " + (e.message || e); $("#bk-go").disabled = false; $("#bk-cancel").disabled = false; }
  });
}

// Card File and Pantry check for photo reading when they load, so reload them after a change.
function reloadAiFrames() {
  for (const id of ["card-file", "pantry-recipe-book"]) { const f = S.frames.get(id); if (f) { f.iframe.remove(); f.loading.remove(); S.frames.delete(id); } }
}

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---------- offline support ----------
// Skipped on localhost so local edits always show; add ?sw=1 to test offline mode locally.
if ("serviceWorker" in navigator && (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || new URLSearchParams(location.search).has("sw"))) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker not registered", e));
}

boot();
