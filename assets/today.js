// Summaries for Keel's Today screen.
//
// Each function reads one app's saved data and returns what that app itself would show at the top:
// the same due-date rules, the same counts. The rules are ported line for line from each app's page
// (apps/<app>/index.html); if an app's rules change, change the matching function here.
// All dates use this device's local calendar day, as the apps do.

const DAY = 864e5;
const docs = (coll) => Object.entries(coll || {}).map(([id, d]) => ({ id, ...d }));

// ---------- Cleaning Rounds ----------
export function chores(data) {
  const dayNum = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  const isoToNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Math.floor(Date.UTC(y, m - 1, d) / DAY); };
  const TODAY = dayNum(new Date());
  const rooms = docs(data.rooms);
  const roomName = (id) => rooms.find((r) => r.id === id)?.name || "Unsorted";
  const dueOf = (c) => c.lastDone ? isoToNum(c.lastDone) + c.everyDays : (c.startDue ? isoToNum(c.startDue) : TODAY);
  const all = docs(data.chores).filter((c) => c.name && c.everyDays).map((c) => {
    const due = dueOf(c), diff = due - TODAY;
    const start = c.lastDone ? isoToNum(c.lastDone) : due - c.everyDays;
    const frac = Math.max(0, Math.min(1, (TODAY - start) / c.everyDays));
    return { ...c, due, diff, frac, roomName: roomName(c.room) };
  }).sort((a, b) => a.diff - b.diff || b.frac - a.frac || a.name.localeCompare(b.name));
  const late = all.filter((c) => c.diff < 0), today = all.filter((c) => c.diff === 0);
  const week = all.filter((c) => c.diff > 0 && c.diff <= 7);
  const mins = [...late, ...today].reduce((a, c) => a + (c.minutes || 0), 0);
  const dueText = (d) => d < 0 ? `${-d}d late` : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`;
  return {
    total: all.length, late: late.length, today: today.length, week: week.length, mins,
    attention: late.length + today.length,
    top: all.slice(0, 4).map((c) => ({ name: c.name, room: c.roomName, when: dueText(c.diff), tone: c.diff < 0 ? "bad" : c.diff === 0 ? "warn" : c.diff <= 3 ? "soon" : "ok", minutes: c.minutes || 0 })),
  };
}

// ---------- House Upkeep Ledger ----------
export function upkeep(data) {
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addMonths = (d, n) => {
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(d.getDate(), last)); return r;
  };
  const dueOf = (t) => {
    if (t.lastDone) return addMonths(parse(t.lastDone), Number(t.everyMonths) || 12);
    const now = today(); const m = (Number(t.month) || now.getMonth() + 1) - 1;
    let y = now.getFullYear(); if (m < now.getMonth()) y++;
    return new Date(y, m + 1, 0);
  };
  const status = (t) => {
    const days = Math.round((dueOf(t) - today()) / DAY);
    if (days < 0) return { tone: "bad", label: `${-days}d late`, days };
    if (days === 0) return { tone: "bad", label: "today", days };
    if (days <= 30) return { tone: "soon", label: `in ${days}d`, days };
    return { tone: "ok", label: days < 60 ? `in ${days}d` : `in ${Math.round(days / 30.4)}mo`, days };
  };
  const systems = docs(data.systems);
  const sts = docs(data.tasks).map((t) => ({ t, s: status(t) })).sort((a, b) => a.s.days - b.s.days);
  const yr = String(today().getFullYear());
  const spent = docs(data.log).filter((l) => (l.date || "").startsWith(yr)).reduce((a, l) => a + (Number(l.cost) || 0), 0);
  const late = sts.filter((x) => x.s.days <= 0).length;
  return {
    total: sts.length, late, soon: sts.filter((x) => x.s.days > 0 && x.s.days <= 30).length,
    systems: systems.length, spent, year: yr, attention: late,
    top: sts.slice(0, 4).map(({ t, s }) => ({ name: t.title, when: s.label, tone: s.tone, pro: !!t.pro, system: systems.find((x) => x.id === t.systemId)?.name || "" })),
  };
}

// ---------- Garage Logbook ----------
export function garage(data) {
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const addMonths = (s, n) => { const d = parseDate(s); d.setMonth(d.getMonth() + n); return d; };
  const services = docs(data.services);
  const vServices = (v) => services.filter((s) => s.vehicleId === v.id).sort((a, b) => (b.date.localeCompare(a.date)) || (b.miles - a.miles));
  function milesPerDay(v) {
    const pts = [...(v.readings || []), ...vServices(v).map((s) => ({ date: s.date, miles: s.miles }))]
      .filter((p) => p.date && Number.isFinite(p.miles)).sort((a, b) => a.date.localeCompare(b.date));
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[pts.length - 1];
    const days = (parseDate(b.date) - parseDate(a.date)) / DAY;
    if (days < 14 || b.miles <= a.miles) return null;
    return (b.miles - a.miles) / days;
  }
  function dueItems(v) {
    const hist = vServices(v), rate = milesPerDay(v), now = parseDate(todayISO());
    const first = hist[hist.length - 1];
    return (v.schedule || []).map((it) => {
      let last = hist.find((s) => (s.items || []).includes(it.label)), assumed = false;
      if (!last && first) { last = first; assumed = true; }
      if (!last) return { it, status: "none", rank: 2, score: 0 };
      const milesLeft = it.nextMiles ? it.nextMiles - v.miles : it.miles ? last.miles + it.miles - v.miles : null;
      const dueDate = it.months ? addMonths(last.date, it.months) : null;
      const daysLeft = dueDate ? Math.round((dueDate - now) / DAY) : null;
      const projDays = milesLeft != null && rate ? milesLeft / rate : null;
      const effDays = Math.min(daysLeft ?? Infinity, projDays ?? Infinity);
      let status = "ok";
      if ((milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft <= 0)) status = "over";
      else if ((milesLeft != null && milesLeft <= 750) || (daysLeft != null && daysLeft <= 30) || effDays <= 30) status = "soon";
      const rank = { over: 0, soon: 1, ok: 3 }[status];
      const score = Math.min(milesLeft != null ? milesLeft / 30 : Infinity, daysLeft ?? Infinity, projDays ?? Infinity);
      return { it, last, assumed, milesLeft, dueDate, daysLeft, projDays, status, rank, score };
    }).sort((a, b) => a.rank - b.rank || a.score - b.score);
  }
  const vehicles = docs(data.vehicles).map((v) => {
    const due = dueItems(v);
    const over = due.filter((d) => d.status === "over"), soon = due.filter((d) => d.status === "soon");
    const next = due.find((d) => d.status !== "none");
    let nextText = "";
    if (next) {
      if (next.status === "over") nextText = "overdue";
      else if (next.milesLeft != null && (next.daysLeft == null || next.milesLeft / 30 < next.daysLeft)) nextText = `in ${Math.round(next.milesLeft).toLocaleString("en-US")} mi`;
      else if (next.daysLeft != null) nextText = next.daysLeft < 60 ? `in ${next.daysLeft}d` : `in ${Math.round(next.daysLeft / 30.4)}mo`;
    }
    return {
      id: v.id, name: v.name, sub: [v.year, v.make, v.model].filter(Boolean).join(" "), miles: v.miles, milesAt: v.milesAt,
      over: over.length, soon: soon.length, next: next ? { label: next.it.label, status: next.status, when: nextText } : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { vehicles, attention: vehicles.reduce((n, v) => n + v.over, 0), soon: vehicles.reduce((n, v) => n + v.soon, 0) };
}

// ---------- Cut to 150 ----------
export function fitness(data) {
  const toD = (s) => new Date(s + "T12:00:00");
  const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 10); };
  // Same generic fallback as the Cut to 150 page; the saved plan replaces every value.
  const DEF = { startWeight: 165, startDate: iso(new Date()), goalWeight: 150, goalDate: iso(new Date(Date.now() + 140 * DAY)), calories: 2000, protein: 130, steps: 8000 };
  const today = iso(new Date());
  const planDoc = (data.plan || {}).current;
  const plan = { ...DEF, ...(planDoc || {}) };
  const entries = docs(data.weighins).filter((e) => e && e.date && typeof e.weight === "number").sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  const list = entries.map((e) => {
    const t = toD(e.date).getTime();
    const win = entries.filter((x) => { const u = toD(x.date).getTime(); return u <= t && u > t - 7 * DAY; });
    return { ...e, avg: win.reduce((s, x) => s + x.weight, 0) / win.length };
  });
  const last = list[list.length - 1] || null;
  const now = toD(today), dow = (now.getDay() + 6) % 7; // Monday start
  const week = Array.from({ length: 7 }, (_, i) => iso(new Date(now.getTime() - (dow - i) * DAY)));
  const workouts = docs(data.workouts);
  const lifts = week.filter((ds) => workouts.some((w) => w.date === ds && w.kind === "lift")).length;
  const walks = week.filter((ds) => workouts.some((w) => w.date === ds && w.kind === "walk")).length;
  let pace = null;
  if (last) {
    const lastT = toD(last.date).getTime();
    const earlier = list.filter((e) => toD(e.date).getTime() <= lastT - 10 * DAY);
    const ref = earlier.length ? earlier[earlier.length - 1] : null;
    if (ref) pace = (ref.avg - last.avg) / ((lastT - toD(ref.date).getTime()) / (7 * DAY));
  }
  const lost = last ? plan.startWeight - last.avg : null;
  const pct = last ? Math.max(0, Math.min(100, (lost / (plan.startWeight - plan.goalWeight)) * 100)) : 0;
  const daysSince = last ? Math.round((toD(today) - toD(last.date)) / DAY) : null;
  return {
    hasPlan: !!planDoc, plan, entries: list.map((e) => ({ date: e.date, weight: e.weight, avg: e.avg })),
    trend: last ? last.avg : null, latest: last ? last.weight : null, lastDate: last ? last.date : null, daysSince,
    lost, pct, pace, lifts, walks, weekDays: week.map((ds) => ({ ds, lift: workouts.some((w) => w.date === ds && w.kind === "lift"), walk: workouts.some((w) => w.date === ds && w.kind === "walk"), today: ds === today })),
    weighedToday: daysSince === 0,
    attention: 0,
  };
}

// ---------- Pantry & Recipe Book ----------
export function pantry(data) {
  const STAPLES = new Set(["water", "ice"]);
  const sing = (w) => { if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y"; if (w.length > 4 && /(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2); if (w.length > 3 && w.endsWith("s") && !/(ss|us)$/.test(w)) return w.slice(0, -1); return w; };
  const norm = (s) => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean).map(sing);
  const contains = (hay, needle) => { if (!needle.length) return false; for (let i = 0; i + needle.length <= hay.length; i++) { let ok = true; for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) { ok = false; break; } if (ok) return true; } return false; };
  const isOptional = (line) => /\boptional\b/i.test(line) || /^\s*~/.test(line) || /\bto taste\b/i.test(line) && /\b(salt|pepper)\b/i.test(line);
  const items = docs(data.pantry);
  const matchLine = (line) => { const toks = norm(line); if (toks.some((t) => STAPLES.has(t)) && toks.length <= 3) return { staple: true }; let best = null, bl = 0; for (const p of items) { const n = norm(p.name); if (n.length > bl && contains(toks, n)) { best = p; bl = n.length; } } return best; };
  const analyze = (r) => { const lines = (r.ingredients || []).filter((l) => l.trim()); const out = lines.map((l) => ({ opt: isOptional(l), have: !!matchLine(l) })); const req = out.filter((x) => !x.opt); return { req: req.length, missing: req.filter((x) => !x.have).length }; };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const daysUntil = (iso) => { if (!iso) return null; const d = new Date(iso + "T00:00:00"); if (isNaN(d)) return null; return Math.round((d - today()) / DAY); };
  const recipes = docs(data.recipes);
  const ready = recipes.map((r) => ({ r, a: analyze(r) })).filter((x) => x.a.req > 0 && x.a.missing === 0).map((x) => x.r.title);
  const expiring = items.map((p) => ({ name: p.name, n: daysUntil(p.expires) })).filter((x) => x.n !== null && x.n <= 5).sort((a, b) => a.n - b.n)
    .map((x) => ({ name: x.name, when: x.n < 0 ? `expired ${-x.n}d ago` : x.n === 0 ? "use today" : `use in ${x.n}d`, tone: x.n <= 0 ? "bad" : "warn" }));
  const shop = docs(data.shop).filter((x) => !x.done).sort((a, b) => (a.added || 0) - (b.added || 0));
  return {
    items: items.length, recipes: recipes.length, ready, expiring, low: items.filter((p) => p.low).map((p) => p.name),
    shop: shop.map((x) => ({ name: x.name, store: x.store || "" })), attention: expiring.filter((x) => x.tone === "bad").length,
  };
}

// ---------- Garden Planner ----------
// The crop and fruit-tree tables are read from the Garden Planner page itself so there is one copy.
let gardenTables = null;
export async function loadGardenTables(url = "apps/garden-planner/index.html") {
  if (gardenTables) return gardenTables;
  try {
    const src = await (await fetch(url)).text();
    const a = src.indexOf("const CROPS = ["), b = src.indexOf("const TK = {");
    if (a < 0 || b < a) throw new Error("tables not found");
    // eslint-disable-next-line no-new-func
    gardenTables = new Function(src.slice(a, b) + "\nreturn { CROPS, FRUIT, FRUIT_ALL };")();
  } catch (e) {
    console.warn("Keel: couldn't read the garden tables", e);
    gardenTables = { CROPS: [], FRUIT: {}, FRUIT_ALL: [] };
  }
  return gardenTables;
}

export function garden(data, tables = gardenTables || { CROPS: [], FRUIT: {}, FRUIT_ALL: [] }) {
  const DEFAULT_SETTINGS = { zone: "6b", lastFrost: "04-20", firstFrost: "10-20", location: "", isDefault: true };
  const settings = { ...DEFAULT_SETTINGS, ...((data.settings || {}).garden || {}) };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const YEAR = today.getFullYear();
  const md = (s, y = YEAR) => { const [m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  const LF = md(settings.lastFrost), FF = md(settings.firstFrost);
  const KIND = { indoor: "Start indoors", sow: "Sow outside", trans: "Transplant out", fall: "Fall planting" };
  const windows = (c) => {
    const out = [];
    const w = (kind, base, r) => out.push({ kind, start: addDays(base, r[0] * 7), end: addDays(base, r[1] * 7) });
    if (c.indoor) w("indoor", LF, c.indoor);
    if (c.sow) w("sow", LF, c.sow);
    if (c.trans) w("trans", LF, c.trans);
    if (c.fall) w("fall", FF, c.fall);
    return out;
  };
  const beds = docs(data.beds), plantings = docs(data.plantings), trees = docs(data.trees);
  const mine = new Set(plantings.map((p) => p.crop));
  const shady = beds.length > 0 && beds.every((b) => b.sun === "part" || b.sun === "shade");
  let now = [], next = [];
  const horizon = addDays(today, 14);
  for (const c of tables.CROPS) for (const w of windows(c)) {
    if (w.start <= today && w.end >= addDays(today, -3)) now.push({ c, w });
    else if (w.start > today && w.start <= horizon) next.push({ c, w });
  }
  if (shady) { const keep = (x) => x.c.sun === "part" || mine.has(x.c.id); now = now.filter(keep); next = next.filter(keep); }
  const soon = next.length;
  const order = Object.keys(KIND);
  now.sort((a, b) => order.indexOf(a.w.kind) - order.indexOf(b.w.kind) || (mine.has(b.c.id) - mine.has(a.c.id)) || a.c.name.localeCompare(b.c.name));
  const frostIn = Math.round((FF - today) / DAY), lfIn = Math.round((LF - today) / DAY);
  let frost = "";
  if (frostIn >= 0 && frostIn <= 21) frost = `First fall frost expected in ${frostIn} days (${fmt(FF)}).`;
  else if (lfIn >= 0 && lfIn <= 28) frost = `Last spring frost expected in ${lfIn} days (${fmt(LF)}).`;
  else if (today > FF) frost = `Past the average first frost (${fmt(FF)}). Hardy greens, garlic and cover crops are what's left to tend.`;
  else if (today < LF) frost = `${lfIn} days until the average last frost (${fmt(LF)}).`;
  else frost = `${frostIn} frost-free days left (first frost ${fmt(FF)}).`;
  const m = today.getMonth() + 1, inMonth = (t) => t.m[0] <= m && m <= t.m[1];
  const kinds = [...new Set(trees.map((t) => t.kind))].filter((k) => tables.FRUIT[k]);
  const treeJobs = [];
  kinds.forEach((k) => tables.FRUIT[k].tasks.filter(inMonth).forEach((x) => treeJobs.push({ who: tables.FRUIT[k].name, text: x.t })));
  if (kinds.length) tables.FRUIT_ALL.filter(inMonth).forEach((x) => treeJobs.push({ who: "All trees", text: x.t }));
  const active = plantings.filter((p) => p.status !== "done").length;
  return {
    zone: settings.zone, frost, active, beds: beds.length, trees: trees.length, soon,
    now: now.map(({ c, w }) => ({ name: c.name, kind: KIND[w.kind], until: fmt(w.end), mine: mine.has(c.id) })),
    treeJobs, attention: 0,
  };
}

// ---------- Card File ----------
export function cards(data) {
  const list = docs(data.cards).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return {
    total: list.length, attention: 0,
    recent: list.slice(0, 3).map((c) => ({ name: c.name || c.company || "Unnamed card", sub: [c.title, c.company].filter(Boolean).join(" · ") })),
  };
}

export const SUMMARIES = {
  "cleaning-rounds": chores, "house-upkeep-ledger": upkeep, "garage-logbook": garage, "cut-to-150": fitness,
  "pantry-recipe-book": pantry, "garden-planner": garden, "card-file": cards,
};
