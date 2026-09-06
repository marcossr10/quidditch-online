// Test cliente online: Chrome headless (CDP) contra bundle + servidor real.
// Flujo: Liga Online → conectar → crear sala (30 s/día) → ver partido en vivo,
// avanzar el reloj solo, navegar plantilla, salir.
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import WebSocket from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WEB_PORT = 4199;
const WS_PORT = 8787;
const CDP_PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error("FALLO:", msg); cleanup(); process.exit(1); };
const children = [];
function cleanup() { for (const c of children) { try { c.kill(); } catch {} } }

// 1. Servidor web del bundle
children.push(spawn("python", ["-m", "http.server", String(WEB_PORT), "--directory", join(ROOT, "build", "bundle")], { stdio: "ignore" }));
// 2. Servidor online
children.push(spawn(process.execPath, ["index.mjs"], { cwd: HERE, env: { ...process.env, PORT: String(WS_PORT) }, stdio: "ignore" }));
// 3. Chrome headless con CDP
children.push(spawn(CHROME, [`--headless`, `--disable-gpu`, `--no-sandbox`, `--no-first-run`, `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=C:\\Users\\Marcos\\AppData\\Local\\Temp\\opencode\\cdp-profile-${Date.now()}`, "about:blank"], { stdio: "ignore" }));

// Esperar CDP
let debuggerUrl = null;
for (let i = 0; i < 60 && !debuggerUrl; i += 1) {
  await sleep(500);
  try {
    const tabs = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json());
    debuggerUrl = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl || null;
  } catch {}
}
if (!debuggerUrl) fail("Chrome CDP no arrancó");

const ws = new WebSocket(debuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.on("open", r));
let seq = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const cmd = (method, params = {}) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const evalJs = async (expression, timeoutMs = 30000) => {
  const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) fail(`excepción JS: ${r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails).slice(0, 300)}`);
  return r.result?.result?.value;
};
const waitFor = async (expression, timeoutMs = 60000, pollMs = 1000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evalJs(expression);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) fail(`timeout esperando: ${expression.slice(0, 120)}`);
    await sleep(pollMs);
  }
};

await cmd("Page.enable");
await cmd("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/index.html` });
await waitFor(`document.querySelector('[data-online="open"]') ? true : null`);
console.log("OK juego cargado, botón online presente");

// Ir al lobby
await evalJs(`document.querySelector('[data-online="open"]').click()`);
await waitFor(`document.querySelector('[data-online="connect"]') ? true : null`);
console.log("OK lobby online visible");

// Rellenar nick + conectar
await evalJs(`{ const i = document.querySelector('[data-online-input="nick"]'); i.value = "Tester"; i.dispatchEvent(new Event("change", { bubbles: true })); }`);
await evalJs(`document.querySelector('[data-online="connect"]').click()`);
await waitFor(`document.querySelector('[data-online="create"]') ? true : null`);
console.log("OK conectado al servidor, formulario de sala visible");

// Elegir equipo + velocidad 30 s/día + crear
await evalJs(`{ const s = document.querySelector('[data-online-input="cteam"]'); s.value = "T01"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
await evalJs(`{ const s = document.querySelector('[data-online-input="cspeed"]'); s.value = "30"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
await evalJs(`document.querySelector('[data-online="create"]').click()`);
const topbar = await waitFor(`document.querySelector(".topbar") ? document.querySelector(".topbar").innerText.slice(0, 120) : null`, 30000);
console.log("OK dentro de la sala:", JSON.stringify(topbar));
const dock = await evalJs(`document.querySelector(".advance-dock").innerText`);
if (!/En vivo|Live/i.test(dock)) fail(`dock no muestra En vivo: ${dock}`);
console.log("OK dock en vivo:", JSON.stringify(dock.slice(0, 80)));
const delBtn = await evalJs(`document.querySelector('[data-online="delete-room"]') ? document.querySelector('[data-online="delete-room"]').innerText : null`);
if (!delBtn) fail("no aparece el botón Borrar sala en la barra");
console.log("OK botón Borrar sala visible:", JSON.stringify(delBtn));

// El reloj avanza solo: la fecha del dock cambia (30 s/día → esperar hasta 75 s)
const d0 = await evalJs(`document.querySelector(".advance-dock").innerText`);
const d1 = await waitFor(`(() => { const t = document.querySelector(".advance-dock").innerText; return t !== ${JSON.stringify(d0)} ? t : null; })()`, 90000);
console.log("OK el reloj avanza solo:", JSON.stringify(d1.slice(0, 100)));

// El partido del día 1 (T01 juega) llega como popup de resultado
const modal = await waitFor(`document.querySelector(".modal-backdrop") ? document.querySelector(".modal-backdrop").innerText.slice(0, 120) : null`, 90000);
console.log("OK popup resultado:", JSON.stringify(modal));
await evalJs(`document.querySelector('[data-close-result]').click()`);
await sleep(1500);
const modalGone = await evalJs(`document.querySelector(".modal-backdrop") ? false : true`);
if (!modalGone) fail("el popup no se cerró");
console.log("OK popup cerrado con Continuar");

// Navegar a plantilla y tocar alineación (promote/demote eco online)
await evalJs(`document.querySelector('[data-view="squad"]').click()`);
await waitFor(`document.querySelector("[data-promote],[data-demote]") ? true : null`, 15000);
console.log("OK vista plantilla con acciones de alineación");

// Salir recarga y cae en Mis partidas con el slot online guardado
await evalJs(`document.querySelector('[data-online="exit"]').click()`);
await sleep(3000);
await waitFor(`[...document.querySelectorAll("h1")].some((h) => /My games|Mis partidas/.test(h.innerText)) ? true : null`, 30000);
await waitFor(`document.querySelector('[data-save="load"]') ? true : null`, 15000);
console.log("OK salir recarga al menú de partidas con slot online");

ws.close();
cleanup();
console.log("CLIENT TEST: TODO OK");
process.exit(0);
