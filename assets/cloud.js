// Firebase: sign-in and the shared database. Loaded only when assets/firebase-config.js has a config.
import config from "./firebase-config.js";

let fb = null;

export const configured = () => !!(config && config.apiKey && config.projectId);
export const projectId = () => (config && config.projectId) || "";

// For testing against the Firebase emulators: open Keel with ?emulator=1 (or set
// localStorage "keel:emulator" to "1"). Never used in normal operation.
function emulatorWanted() {
  try {
    if (new URLSearchParams(location.search).get("emulator") === "1") localStorage.setItem("keel:emulator", "1");
    return localStorage.getItem("keel:emulator") === "1";
  } catch (e) { return false; }
}

export async function init() {
  if (fb) return fb;
  if (!configured()) return null;
  const mod = await import("./vendor/firebase.js");
  const app = mod.initializeApp(config);
  const auth = mod.initializeAuth(app, { persistence: [mod.indexedDBLocalPersistence, mod.browserLocalPersistence] });
  let localCache;
  try { localCache = mod.persistentLocalCache({ tabManager: mod.persistentMultipleTabManager() }); }
  catch (e) { localCache = mod.memoryLocalCache(); }
  const db = mod.initializeFirestore(app, { localCache, ignoreUndefinedProperties: true });
  if (emulatorWanted()) {
    mod.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    mod.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  fb = { mod, app, auth, db, user: null };
  return fb;
}

export function onUser(cb) {
  if (!fb) return () => {};
  return fb.mod.onAuthStateChanged(fb.auth, (u) => { fb.user = u; cb(u); });
}

export async function signIn(email, password) {
  try { await fb.mod.signInWithEmailAndPassword(fb.auth, email.trim(), password); }
  catch (e) { throw new Error(authMessage(e)); }
}
export async function resetPassword(email) {
  try { await fb.mod.sendPasswordResetEmail(fb.auth, email.trim()); }
  catch (e) { throw new Error(authMessage(e)); }
}
export async function signOutUser() { if (fb) await fb.mod.signOut(fb.auth); }

// Firestore rules only let accounts listed in the "members" collection read or write.
// Returns "yes", "no" or "unknown" (offline with no cached answer).
export async function membership(uid) {
  const cacheKey = "keel:member:" + uid;
  try {
    const snap = await fb.mod.getDoc(fb.mod.doc(fb.db, "members", uid));
    const ok = snap.exists();
    try { localStorage.setItem(cacheKey, ok ? "yes" : "no"); } catch (e) { /* ignore */ }
    return ok ? "yes" : "no";
  } catch (e) {
    if (e && e.code === "permission-denied") return "no";
    try { return localStorage.getItem(cacheKey) || "unknown"; } catch (e2) { return "unknown"; }
  }
}

function authMessage(e) {
  const c = (e && e.code) || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) return "That email and password didn't match an account.";
  if (/too-many-requests/.test(c)) return "Too many tries. Wait a few minutes, or reset your password.";
  if (/network-request-failed/.test(c)) return "Couldn't reach Firebase. Check your connection.";
  if (/operation-not-allowed/.test(c)) return "Email/Password sign-in isn't turned on in the Firebase console yet.";
  return (e && e.message) || "Sign-in failed.";
}
