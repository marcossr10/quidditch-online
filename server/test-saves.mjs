// Test E2E slots: 2 partidas solo, cambio entre ellas, borrado,
// persistencia tras recarga y slot online con rejoin.
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import WebSocket from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const WEB_PORT = 4399;
const WS_PORT = 8887;
const CDP_PORT = 9422;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const children = [];
const fail = (msg) => { console.error("FALLO:", msg); for (const c of children) { try { c.kill(); } catch {} } process.exit(1); };
children.push(spawn("python", ["-m", "http.server", String(WEB_PORT), "--directory", join(ROOT, "build", "bundle")], { stdio: "ignore" }));
children.push(spawn(process.execPath, ["index.mjs"], { cwd: HERE, env: { ...process.env, PORT: String(WS_PORT) }, stdio: "ignore" }));
children.push(spawn(CHROME, ["--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=C:\\Users\\Marcos\\AppData\\Local\\Temp\\opencode\\cdp-saves-${Date.now()}`, "about:blank"], { stdio: "ignore" }));

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
let pageLoaded = false;
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.method === "Page.loadEventFired") pageLoaded = true;
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails || {};
    console.log("PAGE EX:", (d.text || "") + " | " + ((d.exception && d.exception.description) || d.stackTrace || "").toString().slice(0, 400));
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const reloadAndWait = async () => {
  pageLoaded = false;
  await cmd("Page.reload");
  const t0 = Date.now();
  while (!pageLoaded) {
    if (Date.now() - t0 > 30000) fail("la página no recargó");
    await sleep(300);
  }
  await sleep(1500);
};
const cmd = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => {
  const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) fail(`excepción JS en [${expression.slice(0, 120)}]: ${JSON.stringify(r.result.exceptionDetails).slice(0, 500)}`);
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
const click = async (sel) => { await evalJs(`document.querySelector('${sel}').click()`); };

// 1. Arranque limpio: sin slots → selector de liga (NO menú)
await cmd("Page.enable");
await cmd("Runtime.enable");
await cmd("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/index.html` });
await waitFor(`document.querySelector('[data-league-pick="BR"]') ? true : null`);
const menuAtBoot = await evalJs(`document.body.innerText.includes("My games") || document.body.innerText.includes("Mis partidas")`);
if (menuAtBoot) fail("menú mostrado sin partidas");
console.log("OK arranque limpio → liga");

// 2. Partida A: BR, primer equipo, avanzar hasta que cambie la fecha
await click('[data-league-pick="BR"]');
await waitFor(`document.querySelector('[data-team-pick]') ? true : null`);
const teamA = await evalJs(`document.querySelector('[data-team-pick]').dataset.teamPick`);
await click('[data-team-pick]');
await waitFor(`document.querySelector(".topbar") ? true : null`);
const teamAName = await evalJs(`document.querySelector(".topbar").innerText.split("\\n")[0]`);
const dA0 = await evalJs(`window.__qm.state.currentDate`);
let dA1 = dA0;
for (let i = 0; i < 6 && dA1 === dA0; i += 1) {
  await click('[data-advance]');
  await sleep(2500);
  dA1 = await evalJs(`window.__qm.state.currentDate`);
}
if (dA1 === dA0) fail("la fecha no avanzó tras varios avances");
await evalJs(`window.__qm.stopAdvance()`);
await sleep(500);
const dA2 = await evalJs(`window.__qm.state.currentDate`);
console.log(`OK partida A (${teamA}): fecha ${dA0} → ${dA2}`);

// 3. Menú Partidas: 1 slot
await click('[data-action="reset"]');
await waitFor(`document.querySelector('[data-save="load"]') ? true : null`);
const slots1 = await evalJs(`document.querySelectorAll('[data-save="load"]').length`);
if (slots1 !== 1) fail(`se esperaba 1 slot, hay ${slots1}`);
console.log("OK menú con 1 slot");

// 4. Partida B: nueva → otro equipo
await click('[data-save="new-solo"]');
await waitFor(`document.querySelector('[data-league-pick="BR"]') ? true : null`);
await click('[data-league-pick="BR"]');
await waitFor(`document.querySelectorAll('[data-team-pick]').length > 1 ? true : null`);
const teamB = await evalJs(`[...document.querySelectorAll('[data-team-pick]')][1].dataset.teamPick`);
await evalJs(`[...document.querySelectorAll('[data-team-pick]')][1].click()`);
await waitFor(`document.querySelector(".topbar") ? true : null`);
const teamBName = await evalJs(`document.querySelector(".topbar").innerText.split("\\n")[0]`);
console.log(`OK partida B (${teamB})`);
if (teamB === teamA) fail("A y B mismo equipo, el test no discrimina");

// 5. Volver a A: equipo y fecha intactos
await click('[data-action="reset"]');
await waitFor(`document.querySelectorAll('[data-save="load"]').length === 2 ? true : null`);
console.log("OK menú con 2 slots");
await evalJs(`[...document.querySelectorAll('[data-save="load"]')].find((b) => (b.closest(".panel").querySelector("h3")?.innerText || "").trim() === ${JSON.stringify(teamAName)}).click()`);
await waitFor(`document.querySelector(".topbar") ? true : null`);
const backTeam = await evalJs(`window.__qm.state.managerTeamId`);
const backDate = await evalJs(`window.__qm.state.currentDate`);
if (backTeam !== teamA || backDate !== dA2) fail(`al volver a A: equipo=${backTeam} (era ${teamA}) fecha=${backDate} (era ${dA2})`);
console.log("OK cambio A→B→A sin pérdidas");

// 6. Borrar B
await click('[data-action="reset"]');
await waitFor(`document.querySelectorAll('[data-save="load"]').length === 2 ? true : null`);
await evalJs(`[...document.querySelectorAll('[data-save="delete"]')].find((b) => (b.closest(".panel").querySelector("h3")?.innerText || "").trim() === ${JSON.stringify(teamBName)}).click()`);
await waitFor(`document.querySelectorAll('[data-save="load"]').length === 1 ? true : null`);
console.log("OK borrado de B");

// 7. Recarga: el menú persiste con A
await reloadAndWait();
await waitFor(`document.querySelector('[data-save="load"]') ? true : null`, 30000);
await evalJs(`document.querySelector('[data-save="load"]').click()`);
await waitFor(`document.querySelector(".topbar") ? true : null`);
const reTeam = await evalJs(`window.__qm.state.managerTeamId`);
if (reTeam !== teamA) fail("tras recarga no volvió A");
console.log("OK persistencia tras recarga");

// 8. Slot online: unirse a sala, aparece en Partidas, rejoin tras recarga
await click('[data-action="reset"]');
await waitFor(`document.querySelector('[data-save="online"]') ? true : null`);
await click('[data-save="online"]');
await waitFor(`document.querySelector('[data-online="connect"]') ? true : null`);
await evalJs(`{ const i = document.querySelector('[data-online-input="url"]'); i.value = "ws://127.0.0.1:${WS_PORT}"; i.dispatchEvent(new Event("change", { bubbles: true })); }`);
await evalJs(`{ const i = document.querySelector('[data-online-input="nick"]'); i.value = "Saver"; i.dispatchEvent(new Event("change", { bubbles: true })); }`);
await click('[data-online="connect"]');
await waitFor(`document.querySelector('[data-online="create"]') ? true : null`);
await evalJs(`{ const s = document.querySelector('[data-online-input="cteam"]'); s.value = s.options[1].value; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
await evalJs(`{ const s = document.querySelector('[data-online-input="cspeed"]'); s.value = "30"; s.dispatchEvent(new Event("change", { bubbles: true })); }`);
await click('[data-online="create"]');
await waitFor(`document.querySelector(".topbar") ? true : null`, 30000);
console.log("OK unido a sala online");
await click('[data-action="reset"]');
await waitFor(`document.querySelectorAll('[data-save="load"]').length === 2 ? true : null`);
console.log("OK slot online en Partidas (solo A + online)");
await reloadAndWait();
await waitFor(`document.querySelectorAll('[data-save="load"]').length === 2 ? true : null`, 30000);
await evalJs(`[...document.querySelectorAll('[data-save="load"]')].find((b) => (b.closest(".panel").querySelector("h3")?.innerText || "").trim() !== ${JSON.stringify(teamAName)}).click()`);
await waitFor(`document.querySelector(".topbar") ? true : null`, 30000);
const dock = await evalJs(`document.querySelector(".advance-dock").innerText`);
if (!/Live|En vivo/i.test(dock)) fail(`rejoin online falló: ${dock}`);
console.log("OK rejoin online desde el menú");

// El lobby separa "Tus partidas online" con botón de reentrada
await click('[data-action="reset"]');
await waitFor(`document.querySelector('[data-save="online"]') ? true : null`);
await click('[data-save="online"]');
await waitFor(`document.querySelector('[data-online="connect"]') ? true : null`);
await evalJs(`{ const i = document.querySelector('[data-online-input="url"]'); i.value = "ws://127.0.0.1:${WS_PORT}"; i.dispatchEvent(new Event("change", { bubbles: true })); }`);
await evalJs(`{ const i = document.querySelector('[data-online-input="nick"]'); i.value = "Saver"; i.dispatchEvent(new Event("change", { bubbles: true })); }`);
await click('[data-online="connect"]');
await waitFor(`[...document.querySelectorAll("h2")].some((h) => /Your online games|Tus partidas online/.test(h.innerText)) ? true : null`, 30000);
const rejoinBtn = await evalJs(`[...document.querySelectorAll("h2")].find((h) => /Your online games|Tus partidas online/.test(h.innerText)).closest("section").querySelector('[data-save="load"]') ? true : false`);
if (!rejoinBtn) fail("sin botón de reentrada en Tus partidas online");
console.log("OK lobby separa Tus partidas online");

// Volver del lobby a liga y de liga a Mis partidas
await evalJs(`[...document.querySelectorAll('[data-online]')].find((b) => b.dataset.online === "back").click()`);
await waitFor(`document.querySelector('[data-league-pick="BR"]') ? true : null`);
const backBtn = await evalJs(`document.querySelector('[data-save="menu"]') ? true : false`);
if (!backBtn) fail("liga sin botón Volver a Mis partidas");
await click('[data-save="menu"]');
await waitFor(`[...document.querySelectorAll("h1")].some((h) => /My games|Mis partidas/.test(h.innerText)) ? true : null`);
console.log("OK liga → Mis partidas");

ws.close();
for (const c of children) { try { c.kill(); } catch {} }
console.log("SAVES TEST: TODO OK");
process.exit(0);
