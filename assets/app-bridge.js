/*
 * app-bridge.js: runs inside each app's iframe and gives the page the same
 * window.claude.use(...) calls it had on claude.ai, backed by Keel's shared store
 * in the parent page (assets/store.js).
 *
 *   <script src="../../assets/app-bridge.js" data-app="garage-logbook"></script>
 *
 * Supported, as on claude.ai:
 *   "db"        collection(name) .doc(id?) .add() .orderBy(field, dir) .onSnapshot() .get()
 *               doc("coll/id") .set() .update() .delete() .onSnapshot() .get()
 *   "user"      can() -> true once you're signed in (or using this device only)
 *   "downloads" save({ filename, data }) -> a normal browser download
 *   "assets"    upload(blob) / delete(id) for photos, plus claude.assetUrl(id) for <img src>
 *   "sample"    json(prompt, { images }) through the photo-reading provider set in Keel's Settings
 *               (null when none is set up, so the pages hide their scan buttons)
 *
 * Opened on its own (not inside Keel), the page redirects to Keel with this app selected.
 */
(() => {
  const me = document.currentScript;
  const APP = me.dataset.app;
  let host = null;
  try { if (window.parent !== window && window.parent.keel && window.parent.keel.store) host = window.parent.keel; } catch (e) { /* cross-origin */ }
  if (!host) {
    const root = new URL("../../", me.src);
    location.replace(root.href + "#/" + APP);
    return;
  }
  const store = host.store;

  // Clone with this frame's JSON so pages always get objects from their own realm
  // (Array.isArray works across frames, but instanceof checks would not).
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const rethrow = (e) => {
    const err = new Error((e && e.message) || String(e));
    if (e && e.code) err.code = e.code;
    throw err;
  };
  const mine = new Set(); // unsubscribe functions, released when the frame unloads
  addEventListener("pagehide", () => { mine.forEach((u) => { try { u(); } catch (e) {} }); mine.clear(); });

  function docSnap(coll, id, d) {
    return { id, exists: d !== undefined, data: () => clone(d), ref: new DocRef(coll, id) };
  }

  class DocRef {
    constructor(coll, id) { this.collection = coll; this.id = id; this.path = coll + "/" + id; }
    async set(data) { try { await store.setDoc(APP, this.collection, this.id, clone(data)); } catch (e) { rethrow(e); } }
    async update(patch) { try { await store.updateDoc(APP, this.collection, this.id, clone(patch)); } catch (e) { rethrow(e); } }
    async delete() { try { await store.deleteDoc(APP, this.collection, this.id); } catch (e) { rethrow(e); } }
    async get() { const d = await store.getDoc(APP, this.collection, this.id); return docSnap(this.collection, this.id, clone(d)); }
    onSnapshot(cb, onErr) {
      const fire = () => {
        const d = store.peekColl(APP, this.collection)[this.id];
        try { cb(docSnap(this.collection, this.id, clone(d))); } catch (e) { onErr ? onErr(e) : console.error(e); }
      };
      const unsub = store.subscribe(APP, this.collection, fire);
      mine.add(unsub);
      return () => { unsub(); mine.delete(unsub); };
    }
  }

  class Query {
    constructor(name, order) { this.name = name; this.order = order || null; }
    doc(id) { return new DocRef(this.name, id || store.newId()); }
    async add(data) { const ref = this.doc(); await ref.set(data); return ref; }
    orderBy(field, dir = "asc") { return new Query(this.name, { field, dir }); }
    snap(docs) {
      const entries = Object.keys(docs).map((id) => docSnap(this.name, id, docs[id]));
      if (this.order) {
        const { field, dir } = this.order, s = dir === "desc" ? -1 : 1;
        entries.sort((a, b) => { const x = a.data()[field], y = b.data()[field]; return (x > y ? 1 : x < y ? -1 : 0) * s; });
      }
      return { docs: entries, size: entries.length, empty: entries.length === 0, forEach: (f) => entries.forEach(f) };
    }
    async get() { return this.snap(clone(await store.getColl(APP, this.name))); }
    onSnapshot(cb, onErr) {
      const fire = () => {
        try { cb(this.snap(clone(store.peekColl(APP, this.name)))); } catch (e) { onErr ? onErr(e) : console.error(e); }
      };
      const unsub = store.subscribe(APP, this.name, fire);
      mine.add(unsub);
      return () => { unsub(); mine.delete(unsub); };
    }
  }

  const db = {
    collection: (name) => new Query(name),
    doc: (path) => { const i = path.lastIndexOf("/"); return new DocRef(path.slice(0, i), path.slice(i + 1)); },
  };

  const user = { can: async () => host.canWrite(), id: host.userId(), name: host.userName() };

  // Blobs, typed arrays and strings are turned into base64 here, in the page's own realm,
  // so nothing realm-specific is handed to the parent.
  async function toB64(data) {
    let blob;
    if (data instanceof Blob) blob = data;
    else if (typeof data === "string") blob = new Blob([data]);
    else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) blob = new Blob([data]);
    else blob = new Blob([JSON.stringify(data)]);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(s), type: blob.type };
  }

  const downloads = {
    save: async ({ filename, data, type }) => {
      const { b64, type: t } = await toB64(data);
      host.download(filename || "download", b64, type || t || "application/octet-stream");
      return { ok: true };
    },
  };

  const assets = {
    upload: async (blob, opts = {}) => {
      const { b64 } = await toB64(blob);
      try { return clone(await host.uploadAsset(APP, b64, opts.type || blob.type || "image/jpeg")); } catch (e) { rethrow(e); }
    },
    delete: async (id) => { try { await store.deleteAsset(APP, id); } catch (e) { rethrow(e); } },
  };

  function sampleApi() {
    const limits = host.sampleLimits();
    if (!limits) return null;
    return {
      limits: async () => clone(host.sampleLimits()),
      json: async (prompt, opts = {}) => {
        if (opts.signal && opts.signal.aborted) { const e = new Error("Stopped"); e.code = "cancelled"; throw e; }
        const images = [];
        for (const img of opts.images || []) { const { b64, type } = await toB64(img); images.push({ b64, type: img.type || type || "image/jpeg" }); }
        const job = host.sampleJson(String(prompt), images);
        const aborted = new Promise((_, rej) => {
          if (opts.signal) opts.signal.addEventListener("abort", () => { const e = new Error("Stopped"); e.code = "cancelled"; rej(e); }, { once: true });
        });
        try { return clone(await Promise.race([job, aborted])); } catch (e) { rethrow(e); }
      },
    };
  }

  window.claude = {
    use: async (name) => {
      if (name === "db") { await host.ready(); return db; }
      if (name === "user") { await host.ready(); return user; }
      if (name === "downloads") return downloads;
      if (name === "assets") { await host.ready(); await store.loadAssets(APP); return assets; }
      if (name === "sample") { await host.ready(); return sampleApi(); }
      return null;
    },
    // Card File builds <img src> synchronously; photos are preloaded by use("assets").
    assetUrl: (id) => store.assetUrl(APP, id),
  };

  // Keep the page's theme in step with Keel's setting.
  try {
    const t = host.themeFor();
    if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
  } catch (e) { /* ignore */ }
})();
