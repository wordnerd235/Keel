// Keel data store.
//
// Every app page was written for claude.ai's small Firestore-style document store
// (window.claude.use("db")). Keel keeps one store for all apps in the top-level page;
// each app's iframe reaches it through app-bridge.js.
//
// Two backends share one in-memory cache, data[app][collection][docId]:
//   local:    this browser only. Documents in localStorage ("keel:<app>"), photos in IndexedDB.
//   firebase: your Firestore database, synced across devices, with an offline cache.
//             Documents live at keel/<app>/<collection>/<docId>; photos at keel/<app>/_assets/<id>.
//
// All data that crosses into or out of the store is JSON-cloned, which also keeps objects from
// an iframe's JavaScript realm out of the Firestore SDK (it rejects them as "custom objects").

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const randomId = () => {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
};
const codedError = (code, message) => Object.assign(new Error(message), { code });
const ASSETS = "_assets";

export const APP_IDS = [
  "cleaning-rounds", "house-upkeep-ledger", "garden-planner", "pantry-recipe-book",
  "garage-logbook", "cut-to-150", "card-file",
];

// ---------- base64 helpers ----------
export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBlob(b64, type) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type: type || "application/octet-stream" });
}

// Firestore documents max out at 1 MiB, so photos above ~700 KB are re-encoded smaller.
async function fitPhoto(blob, maxBytes = 700_000) {
  if (blob.size <= maxBytes || !/^image\//.test(blob.type || "image/jpeg")) return blob;
  const bmp = await createImageBitmap(blob);
  let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), q = 0.85, out = blob;
  for (let i = 0; i < 6 && out.size > maxBytes; i++) {
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    out = await new Promise((r) => c.toBlob((b) => r(b || out), "image/jpeg", q));
    scale *= 0.85; q = Math.max(0.6, q - 0.07);
  }
  return out;
}

// ---------- IndexedDB (local photos) ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("keel", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("assets");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const tx = d.transaction("assets", mode), st = tx.objectStore("assets");
    let out; const req = fn(st); if (req) req.onsuccess = () => (out = req.result);
    tx.oncomplete = () => { d.close(); res(out); };
    tx.onerror = () => { d.close(); rej(tx.error); };
  });
}

// ---------- the store ----------
export class Store extends EventTarget {
  constructor() {
    super();
    this.mode = null;            // "local" | "firebase"
    this.data = {};              // app -> coll -> id -> doc
    this.loaded = new Set();     // "app/coll" keys whose first snapshot has arrived
    this.waiters = new Map();    // "app/coll" -> [resolve]
    this.listeners = new Map();  // "app/coll" -> Set(fn)
    this.assetUrls = new Map();  // "app/id" -> object URL
    this.assetsReady = new Map();// app -> Promise
    this.unsubs = [];            // Firestore listeners
    this.fb = null;              // { mod, db, uid }
  }

  // ----- lifecycle -----
  async useLocal() {
    this.reset();
    this.mode = "local";
    for (const app of APP_IDS) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem("keel:" + app) || "null"); } catch (e) { /* ignore */ }
      this.data[app] = saved && typeof saved === "object" ? saved : {};
    }
    this.emit("mode");
  }

  async useFirebase(fb) {
    this.reset();
    this.mode = "firebase";
    this.fb = fb;
    this.emit("mode");
  }

  reset() {
    this.unsubs.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
    this.unsubs = [];
    this.data = {}; this.loaded.clear(); this.waiters.clear();
    for (const url of this.assetUrls.values()) URL.revokeObjectURL(url);
    this.assetUrls.clear(); this.assetsReady.clear();
    this.fb = null; this.mode = null;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ----- reading -----
  coll(app, coll) { return ((this.data[app] ||= {})[coll] ||= {}); }

  // Resolves once the collection's first snapshot is in the cache.
  ensure(app, coll) {
    const key = app + "/" + coll;
    if (this.mode === "local" || this.loaded.has(key)) return Promise.resolve();
    if (!this.waiters.has(key)) {
      this.waiters.set(key, []);
      if (this.mode === "firebase") this.attach(app, coll);
    }
    return new Promise((res) => this.waiters.get(key).push(res));
  }

  attach(app, coll) {
    const { mod, db } = this.fb, key = app + "/" + coll;
    const unsub = mod.onSnapshot(mod.collection(db, "keel", app, coll), { includeMetadataChanges: false }, (snap) => {
      const docs = {};
      snap.forEach((d) => { docs[d.id] = d.data(); });
      (this.data[app] ||= {})[coll] = docs;
      if (coll === ASSETS) this.syncAssetUrls(app, docs);
      if (!this.loaded.has(key)) {
        this.loaded.add(key);
        (this.waiters.get(key) || []).forEach((r) => r());
        this.waiters.delete(key);
      }
      this.notify(app, coll);
      this.emit("change", { app, coll });
    }, (err) => {
      console.error("Keel sync error", key, err);
      this.emit("sync-error", { app, coll, error: err });
      // Unblock anyone waiting so the page can still render what it has.
      if (!this.loaded.has(key)) {
        this.loaded.add(key);
        (this.waiters.get(key) || []).forEach((r) => r());
        this.waiters.delete(key);
      }
    });
    this.unsubs.push(unsub);
  }

  async getColl(app, coll) { await this.ensure(app, coll); return clone(this.coll(app, coll)); }
  async getDoc(app, coll, id) { await this.ensure(app, coll); return clone(this.coll(app, coll)[id]); }
  peekColl(app, coll) { return this.coll(app, coll); } // no clone; for read-only summaries

  // fn() is called with no arguments whenever the collection changes. Returns an unsubscribe.
  subscribe(app, coll, fn) {
    const key = app + "/" + coll;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(fn);
    this.ensure(app, coll).then(() => { if (this.listeners.get(key)?.has(fn)) this.call(fn); });
    return () => this.listeners.get(key)?.delete(fn);
  }
  notify(app, coll) {
    const set = this.listeners.get(app + "/" + coll);
    if (set) setTimeout(() => set.forEach((fn) => this.call(fn)), 0);
  }
  call(fn) { try { fn(); } catch (e) { console.error(e); } }

  // ----- writing -----
  async setDoc(app, coll, id, data) {
    data = clone(data);
    if (this.mode === "local") { this.coll(app, coll)[id] = data; this.persist(app); return this.localChanged(app, coll); }
    const { mod, db } = this.fb;
    return this.remote(mod.setDoc(mod.doc(db, "keel", app, coll, id), data));
  }

  async updateDoc(app, coll, id, patch) {
    patch = clone(patch);
    if (this.mode === "local") {
      const cur = this.coll(app, coll)[id];
      if (cur === undefined) throw codedError("not_found", "No document to update: " + coll + "/" + id);
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === "object" && v.__delete__ === true) delete cur[k]; else cur[k] = v;
      }
      this.persist(app); return this.localChanged(app, coll);
    }
    const { mod, db } = this.fb;
    await this.ensure(app, coll);
    if (this.coll(app, coll)[id] === undefined) throw codedError("not_found", "No document to update: " + coll + "/" + id);
    // Field names are taken literally (no dotted paths), matching the claude.ai store.
    const args = [];
    for (const [k, v] of Object.entries(patch)) {
      args.push(new mod.FieldPath(k), v && typeof v === "object" && v.__delete__ === true ? mod.deleteField() : v);
    }
    if (!args.length) return;
    return this.remote(mod.updateDoc(mod.doc(db, "keel", app, coll, id), ...args));
  }

  async deleteDoc(app, coll, id) {
    if (this.mode === "local") { delete this.coll(app, coll)[id]; this.persist(app); return this.localChanged(app, coll); }
    const { mod, db } = this.fb;
    return this.remote(mod.deleteDoc(mod.doc(db, "keel", app, coll, id)));
  }

  newId() { return randomId(); }

  localChanged(app, coll) { this.notify(app, coll); this.emit("change", { app, coll }); }

  persist(app) {
    try { localStorage.setItem("keel:" + app, JSON.stringify(this.data[app] || {})); }
    catch (e) { throw codedError("quota_exceeded", "Storage is full"); }
  }

  // Firestore write promises settle only when the server confirms. Offline, that can take hours,
  // so a page's "Saving..." would hang. The write is already applied to the local cache (and shown)
  // the moment it is queued, so wait briefly for the server and then let the page carry on.
  // A later rejection is reported through the "sync-error" event.
  async remote(promise) {
    let settled = false;
    const p = promise.then(() => { settled = true; }, (err) => {
      settled = true;
      const e = mapFirebaseError(err);
      this.emit("sync-error", { error: e });
      throw e;
    });
    const timeout = new Promise((res) => setTimeout(res, 2500));
    await Promise.race([p, timeout]);
    if (!settled) p.catch(() => {});
  }

  // ----- photos (Card File) -----
  assetUrl(app, id) { return this.assetUrls.get(app + "/" + id) || ""; }

  loadAssets(app) {
    if (this.assetsReady.has(app)) return this.assetsReady.get(app);
    let p;
    if (this.mode === "local") {
      p = idbDo("readonly", (st) => st.getAllKeys()).then(async (keys) => {
        for (const k of keys || []) {
          if (!String(k).startsWith(app + "/")) continue;
          const blob = await idbDo("readonly", (st) => st.get(k));
          if (blob) this.assetUrls.set(k, URL.createObjectURL(blob));
        }
      }).catch((e) => console.warn("Keel: photos unavailable", e));
    } else {
      p = this.ensure(app, ASSETS);
    }
    this.assetsReady.set(app, p);
    return p;
  }

  syncAssetUrls(app, docs) {
    for (const [id, d] of Object.entries(docs)) {
      const k = app + "/" + id;
      if (!this.assetUrls.has(k) && d && d.data) this.assetUrls.set(k, URL.createObjectURL(base64ToBlob(d.data, d.mime)));
    }
    for (const k of [...this.assetUrls.keys()]) {
      if (k.startsWith(app + "/") && !docs[k.slice(app.length + 1)]) { URL.revokeObjectURL(this.assetUrls.get(k)); this.assetUrls.delete(k); }
    }
  }

  async putAsset(app, blob, id = randomId()) {
    const k = app + "/" + id;
    if (this.mode === "local") {
      await idbDo("readwrite", (st) => st.put(blob, k));
    } else {
      blob = await fitPhoto(blob);
      const { mod, db } = this.fb;
      await this.remote(mod.setDoc(mod.doc(db, "keel", app, ASSETS, id), {
        mime: blob.type || "image/jpeg", data: await blobToBase64(blob), bytes: blob.size, createdAt: new Date().toISOString(),
      }));
    }
    if (!this.assetUrls.has(k)) this.assetUrls.set(k, URL.createObjectURL(blob));
    return { id };
  }

  async deleteAsset(app, id) {
    const k = app + "/" + id;
    if (this.mode === "local") await idbDo("readwrite", (st) => st.delete(k));
    else { const { mod, db } = this.fb; await this.remote(mod.deleteDoc(mod.doc(db, "keel", app, ASSETS, id))); }
    if (this.assetUrls.has(k)) { URL.revokeObjectURL(this.assetUrls.get(k)); this.assetUrls.delete(k); }
  }

  async assetBase64(app, id) {
    const url = this.assetUrl(app, id);
    if (!url) return null;
    const blob = await (await fetch(url)).blob();
    return { mime: blob.type || "image/jpeg", data: await blobToBase64(blob) };
  }

  // ----- backup -----
  // Shape: { keel: 1, exportedAt, apps: { app: { coll: { id: doc } } }, assets: { app: { id: { mime, data } } } }
  async exportAll() {
    const out = { keel: 1, exportedAt: new Date().toISOString(), mode: this.mode, apps: {}, assets: {} };
    for (const app of APP_IDS) {
      const colls = await this.listCollections(app);
      out.apps[app] = {};
      for (const c of colls) out.apps[app][c] = await this.getColl(app, c);
      await this.loadAssets(app);
      const ids = [...this.assetUrls.keys()].filter((k) => k.startsWith(app + "/")).map((k) => k.slice(app.length + 1));
      if (ids.length) {
        out.assets[app] = {};
        for (const id of ids) { const a = await this.assetBase64(app, id); if (a) out.assets[app][id] = a; }
      }
    }
    return out;
  }

  // Firestore can't list subcollections from a web client, so the known collections are listed here
  // (from each app's README) and any others already in the cache are added.
  async listCollections(app) {
    const known = {
      "cleaning-rounds": ["rooms", "chores"],
      "house-upkeep-ledger": ["tasks", "systems", "log"],
      "garden-planner": ["settings", "beds", "plantings", "trees"],
      "pantry-recipe-book": ["pantry", "recipes", "shop", "settings"],
      "garage-logbook": ["vehicles", "services"],
      "cut-to-150": ["plan", "weighins", "workouts"],
      "card-file": ["cards"],
    }[app] || [];
    const cached = Object.keys(this.data[app] || {}).filter((c) => c !== ASSETS);
    return [...new Set([...known, ...cached])];
  }

  // Replaces each listed app's data with the backup's. Apps not in the backup are left alone.
  async importAll(backup, onProgress = () => {}) {
    if (!backup || typeof backup !== "object" || !backup.apps) throw new Error("This file isn't a Keel backup.");
    const apps = Object.keys(backup.apps).filter((a) => APP_IDS.includes(a));
    // Work out every write first: delete documents the backup doesn't have, then set the rest.
    const ops = [];
    for (const app of apps) {
      const incoming = backup.apps[app] || {};
      for (const c of await this.listCollections(app)) {
        for (const id of Object.keys(await this.getColl(app, c))) {
          if (!(incoming[c] && id in incoming[c])) ops.push({ del: true, app, c, id });
        }
      }
      for (const [c, docs] of Object.entries(incoming)) {
        for (const [id, doc] of Object.entries(docs || {})) ops.push({ app, c, id, doc: clone(doc) });
      }
    }
    const photos = [];
    for (const app of apps) for (const [id, a] of Object.entries((backup.assets || {})[app] || {})) photos.push({ app, id, a });
    const total = ops.length + photos.length;
    let done = 0;

    if (this.mode === "local") {
      const touched = new Set();
      for (const o of ops) {
        if (o.del) delete this.coll(o.app, o.c)[o.id]; else this.coll(o.app, o.c)[o.id] = o.doc;
        touched.add(o.app + "\n" + o.c);
      }
      for (const app of apps) this.persist(app);
      for (const t of touched) { const [a, c] = t.split("\n"); this.localChanged(a, c); }
      done = ops.length; onProgress(done, total);
    } else {
      const { mod, db } = this.fb;
      for (let i = 0; i < ops.length; i += 400) {
        const batch = mod.writeBatch(db);
        for (const o of ops.slice(i, i + 400)) {
          const ref = mod.doc(db, "keel", o.app, o.c, o.id);
          if (o.del) batch.delete(ref); else batch.set(ref, o.doc);
        }
        await batch.commit().catch((e) => { throw mapFirebaseError(e); });
        done = Math.min(ops.length, i + 400); onProgress(done, total);
      }
    }
    for (const p of photos) { await this.putAsset(p.app, base64ToBlob(p.a.data, p.a.mime), p.id); onProgress(++done, total); }
    if (this.fb) await this.fb.mod.waitForPendingWrites(this.fb.db).catch(() => {});
    return { apps: apps.length, docs: ops.filter((o) => !o.del).length, photos: photos.length };
  }

  hasLocalData() {
    return APP_IDS.some((app) => {
      try { const d = JSON.parse(localStorage.getItem("keel:" + app) || "null"); return d && Object.values(d).some((c) => c && Object.keys(c).length); }
      catch (e) { return false; }
    });
  }
}

// claude.ai's store used codes the pages already check for. Map Firestore's onto them.
export function mapFirebaseError(err) {
  const code = err && err.code;
  if (code === "permission-denied") return codedError("invalid_argument", "No permission to write. Your account may not be on the members list.");
  if (code === "resource-exhausted") return codedError("quota_exceeded", "Storage is full or the daily free limit was reached.");
  if (code === "not-found") return codedError("not_found", err.message);
  if (code === "unavailable") return codedError("unavailable", "Offline. The change will sync when you reconnect.");
  return err instanceof Error ? err : new Error(String(err));
}
