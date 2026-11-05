// Smoke test: serve the repo, restore tests/fixture-backup.json, open every tool inside Keel,
// and fail on any page error or missing data. Run: node tests/smoke.mjs  (needs Playwright + Chromium)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const APPS = { "cleaning-rounds": "Wipe counters", "house-upkeep-ledger": "Test smoke alarms", "garden-planner": "Testville", "pantry-recipe-book": "rice", "garage-logbook": "Car", "cut-to-150": "Lose about 20 lb", "card-file": "Pat Example" };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, path.endsWith("/") ? path + "index.html" : path);
  try { res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end("not found"); }
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const errors = [];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Run in "this device only" mode so the test never touches the real Firebase project.
  await context.route("**/assets/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "export default null;" }));
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("page error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g/.test(m.text())) errors.push("console: " + m.text()); });
  await page.goto(base + "#/settings");
  await page.setInputFiles("#bk-file", join(root, "tests/fixture-backup.json"));
  await page.click("#bk-go");
  await page.waitForFunction(() => /Restored/.test(document.querySelector("#bk-msg")?.textContent || ""), null, { timeout: 15000 });
  await page.goto(base + "#/today");
  await page.waitForSelector(".cards .card");
  const cards = await page.$$eval(".cards .card", (els) => els.length);
  if (cards !== 7) errors.push(`Today shows ${cards} cards, expected 7`);
  for (const [id, expect] of Object.entries(APPS)) {
    await page.goto(base + "#/" + id);
    const frame = await (await page.waitForSelector(`iframe[src="apps/${id}/index.html"]`)).contentFrame();
    try { await frame.waitForFunction((t) => document.body.innerText.includes(t), expect, { timeout: 8000 }); console.log("ok  ", id); }
    catch { errors.push(`${id}: never showed "${expect}"`); console.log("FAIL", id); }
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error("\n" + errors.join("\n")); process.exit(1); }
console.log("\nAll tools loaded inside Keel with no errors.");
