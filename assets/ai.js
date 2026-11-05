// Photo reading for Card File ("Read card") and Pantry ("Scan").
//
// On claude.ai these pages called window.claude.use("sample").json(prompt, { images }). Keel answers
// that call with one of two providers, chosen in Settings:
//
//   gemini: Gemini through Firebase AI Logic, using your Firebase project. Free tier, no key to manage.
//   claude: Claude through the Anthropic API with your own API key, stored only in this browser.
//
// Both get the page's prompt unchanged plus the photos, and must return the JSON the prompt asks for.

const PREFS_KEY = "keel:ai";
// Gemini model names change over time. Keel tries these in order until one answers, remembers the one
// that worked, and lets you set your own in Settings. Checked against Firebase AI Logic in Nov 2026:
// gemini-3-flash-preview answered; gemini-3.8-flash and gemini-flash-latest accepted the request but hung;
// gemini-2.5-flash is closed to new projects.
const GEMINI_MODELS = ["gemini-3-flash-preview", "gemini-3.8-flash", "gemini-flash-latest"];
const GEMINI_ATTEMPT_MS = 60_000; // a model that hasn't answered by then is skipped
const CLAUDE_MODEL = "claude-opus-5-5";
const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const SYSTEM = "You read photos for a household app. Reply with only the JSON the user asks for: no prose, no code fences.";

const codedError = (code, message) => Object.assign(new Error(message), { code });

export function loadPrefs() {
  try { return { provider: "auto", geminiModel: "", claudeKey: "", ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; }
  catch (e) { return { provider: "auto", geminiModel: "", claudeKey: "" }; }
}
export function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }

// Which provider is actually in use: "gemini", "claude" or null (photo reading off).
export function activeProvider(prefs, firebaseReady) {
  if (prefs.provider === "off") return null;
  if (prefs.provider === "claude") return prefs.claudeKey ? "claude" : null;
  if (prefs.provider === "gemini") return firebaseReady ? "gemini" : null;
  // auto: Claude if a key is saved, otherwise Gemini when Firebase is signed in.
  if (prefs.claudeKey) return "claude";
  return firebaseReady ? "gemini" : null;
}

export const limits = () => ({ images: { maxCount: 4, mediaTypes: MEDIA_TYPES, maxBytes: 20 * 1024 * 1024 } });

// Photos are scaled to at most 1600 px on the long side and sent as JPEG. Both models downscale
// larger images anyway, and this keeps requests well under size limits.
async function prepare(images) {
  const out = [];
  for (const { b64, type } of images) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: type || "image/jpeg" });
    let bmp;
    try { bmp = await createImageBitmap(blob); }
    catch (e) { throw codedError("image_rejected", "That photo couldn't be opened."); }
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (s === 1 && MEDIA_TYPES.includes(blob.type) && blob.size < 3_500_000) { out.push({ data: b64, mime: blob.type }); continue; }
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const jpeg = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
    const buf = new Uint8Array(await jpeg.arrayBuffer());
    let str = "";
    for (let i = 0; i < buf.length; i += 0x8000) str += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    out.push({ data: btoa(str), mime: "image/jpeg" });
  }
  return out;
}

// Pull the JSON object or array out of a reply, tolerating code fences or a stray sentence.
export function parseJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const starts = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  if (starts.length) {
    const start = Math.min(...starts), close = t[start] === "{" ? "}" : "]";
    const end = t.lastIndexOf(close);
    if (end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { /* fall through */ } }
  }
  throw codedError("invalid_json", "The reply wasn't valid JSON.");
}

// ---------- Gemini (Firebase AI Logic) ----------
async function viaGemini(fb, prefs, prompt, imgs) {
  const { mod, app } = fb;
  const ai = mod.getAI(app, { backend: new mod.GoogleAIBackend() });
  const remembered = (() => { try { return localStorage.getItem("keel:ai-gemini-ok") || ""; } catch (e) { return ""; } })();
  const order = [...new Set([prefs.geminiModel, remembered, ...GEMINI_MODELS].filter(Boolean))];
  let lastErr = null;
  for (const name of order) {
    try {
      const model = mod.getGenerativeModel(ai, {
        model: name,
        systemInstruction: SYSTEM,
        generationConfig: { responseMimeType: "application/json" },
      });
      const parts = [{ text: prompt }, ...imgs.map((i) => ({ inlineData: { data: i.data, mimeType: i.mime } }))];
      let timer;
      const res = await Promise.race([
        model.generateContent(parts),
        new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("No answer from " + name), { keelTimeout: true })), GEMINI_ATTEMPT_MS); }),
      ]).finally(() => clearTimeout(timer));
      const r = res.response;
      const block = r.promptFeedback && r.promptFeedback.blockReason;
      if (block) throw codedError("refused", "Gemini declined this photo (" + block + ").");
      const text = r.text();
      try { localStorage.setItem("keel:ai-gemini-ok", name); } catch (e) { /* ignore */ }
      return parseJson(text);
    } catch (e) {
      if (e && e.code && ["refused", "invalid_json"].includes(e.code)) throw e;
      if (e && e.keelTimeout) { lastErr = e; continue; }
      const msg = String((e && e.message) || e);
      // A missing or retired model: try the next name.
      if (/not found|404|is not supported|unknown model|no longer available/i.test(msg)) { lastErr = e; continue; }
      throw mapGeminiError(e);
    }
  }
  throw mapGeminiError(lastErr || new Error("No Gemini model answered."));
}

function mapGeminiError(e) {
  const msg = String((e && e.message) || e);
  if (/429|quota|rate|exhausted/i.test(msg)) return codedError("rate_limited", "Gemini's free limit was reached. Wait a minute and try again.");
  if (/api-not-enabled|has not been used|disabled|PERMISSION_DENIED|403/i.test(msg)) return codedError("not_granted", "Firebase AI Logic isn't turned on for this project yet (Firebase console: AI Logic, Get started, Gemini Developer API).");
  if (/image|inline_data|mime/i.test(msg) && /invalid|unsupported/i.test(msg)) return codedError("image_rejected", msg);
  if (/SAFETY|blocked/i.test(msg)) return codedError("refused", msg);
  return Object.assign(new Error(msg), { code: "unavailable" });
}

// ---------- Claude (Anthropic API, your own key) ----------
let anthropicMod = null;
async function viaClaude(prefs, prompt, imgs) {
  anthropicMod ||= await import("./vendor/anthropic.js");
  const { Anthropic } = anthropicMod;
  // The key is typed into Settings and kept only in this browser. dangerouslyAllowBrowser is needed for
  // any in-browser use; it's acceptable here because the key belongs to the person using the page.
  const client = new Anthropic({ apiKey: prefs.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  let res;
  try {
    res = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "medium" },
      // If a safety check declines the request, the API retries it on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          ...imgs.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.data } })),
          { type: "text", text: prompt },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw codedError("not_granted", "Your Anthropic API key was rejected. Check it in Keel's Settings.");
    if (e instanceof Anthropic.PermissionDeniedError) throw codedError("not_granted", "This API key isn't allowed to use " + CLAUDE_MODEL + ".");
    if (e instanceof Anthropic.RateLimitError) throw codedError("rate_limited", "Too many requests just now.");
    if (e instanceof Anthropic.BadRequestError) {
      const msg = String(e.message || "");
      if (/credit|billing|balance/i.test(msg)) throw codedError("not_granted", "Your Anthropic account is out of credits.");
      if (/image/i.test(msg)) throw codedError("image_rejected", msg);
      throw codedError("unavailable", msg);
    }
    if (e instanceof Anthropic.APIConnectionError) throw codedError("unavailable", "Couldn't reach Anthropic. Check your connection.");
    throw Object.assign(new Error(String((e && e.message) || e)), { code: "unavailable" });
  }
  if (res.stop_reason === "refusal") throw codedError("refused", "Claude declined to read this photo.");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson(text);
}

// The call behind sample.json(prompt, { images }). images: [{ b64, type }].
export async function readPhotos({ provider, prefs, fb }, prompt, images) {
  if (!provider) throw codedError("sampling_disabled", "Photo reading is off. Turn it on in Keel's Settings.");
  const imgs = await prepare(images);
  if (provider === "claude") return viaClaude(prefs, prompt, imgs);
  return viaGemini(fb, prefs, prompt, imgs);
}

export const CLAUDE_MODEL_ID = CLAUDE_MODEL;
