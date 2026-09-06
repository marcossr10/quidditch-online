// Test humo single-player: el juego local debe seguir intacto tras los hooks.
// Liga BR → primer equipo → avanzar días → mercado visible → sin errores.
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import WebSocket from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WEB_PORT = 4299;
const CDP_PORT = 9322;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const fail = (msg) => { console.error("FALLO:", msg); for (const c of children) { try { c.kill(); } catch {} } process.exit(1); };
children.push(spawn("python", ["-m", "http.server", String(WEB_PORT), "--directory", join(ROOT, "build", "bundle")], { stdio: "ignore" }));
const profile = `C:\\Users\\Marcos\\AppData\\Local\\Temp\\opencode\\cdp-solo-${Date.now()}`;
children.push(spawn(CHROME, ["--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" }));

let debuggerUrl = null;
for (let i = 0; i < 60 && !debuggerUrl; i += 1) {
  await sleep(500);
  try {
    const tabs = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json());
    debuggerUrl = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl || null;
  } catch {}
}
if (!debuggerUrl) fail("CDP no arrancó");
const ws = new WebSocket(debuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on("open", r));
let seq = 0;
const pending = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cmd = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => {
  const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) fail(`excepción JS: ${(r.result.exceptionDetails.text || "").slice(0, 200)}`);
  return r.result?.result?.value;
};
const waitFor = async (expression, timeoutMs = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evalJs(expression);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) fail(`timeout: ${expression.slice(0, 100)}`);
    await sleep(800);
  }
};

await cmd("Page.enable");
await cmd("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/index.html` });
await waitFor(`document.querySelector('[data-league-pick="BR"]') ? true : null`);
await evalJs(`document.querySelector('[data-league-pick="BR"]').click()`);
await waitFor(`document.querySelector('[data-team-pick]') ? true : null`);
await evalJs(`document.querySelector('[data-team-pick]').click()`);
const top = await waitFor(`document.querySelector(".topbar") ? document.querySelector(".topbar").innerText.slice(0, 60) : null`);
console.log("OK partida local:", JSON.stringify(top));
const d0 = await evalJs(`document.querySelector(".advance-dock").innerText`);
await evalJs(`document.querySelector("[data-advance]").click()`);
const d1 = await waitFor(`(() => { const t = document.querySelector(".advance-dock").innerText; return t !== ${JSON.stringify(d0)} ? t : null; })()`, 60000);
console.log("OK avance local:", JSON.stringify(d1.slice(0, 60)));
await evalJs(`document.querySelector('[data-view="market"]').click()`);
await waitFor(`document.querySelector("[data-buy],[data-offer]") ? true : null`, 15000);
console.log("OK mercado local visible");
const errPanel = await evalJs(`document.body.innerText.includes("Error de interfaz")`);
if (errPanel) fail("panel de error de interfaz visible");
const st = await evalJs(`window.__qm.state.currentDate`);
console.log("OK fecha estado:", st);
ws.close();
for (const c of children) { try { c.kill(); } catch {} }
console.log("SOLO TEST: TODO OK");
process.exit(0);
