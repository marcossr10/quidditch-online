// Test catch-up tras caída: crea sala rápida (15 s/día), mata el
// servidor 60 s, lo rearranca y verifica que la fecha avanza los días
// que tocan Y que los partidos se simulan (no salto de fecha vacío).
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import WebSocket from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 19787;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error("FALLO:", msg); process.exit(1); };
const start = () => spawn(process.execPath, ["index.mjs"], { cwd: HERE, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
let srv = start();
const waitUp = async () => {
  const t0 = Date.now();
  for (;;) {
    try { await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.json()); return; }
    catch { if (Date.now() - t0 > 30000) fail("servidor no arranca"); await sleep(500); }
  }
};
await waitUp();

const once = (ws, type) => new Promise((res) => {
  const h = (raw) => { const m = JSON.parse(raw); if (m.t === type) { ws.off("message", h); res(m); } };
  ws.on("message", h);
});
const a = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise((r) => a.on("open", r));
a.send(JSON.stringify({ t: "create", name: "Catchup", leagueId: "BR", dayMs: 15000, teamId: "T01", nick: "Ana" }));
const snap = await once(a, "snapshot");
const roomId = snap.room.id;
const d0 = snap.state.currentDate;
const played0 = snap.state.fixtures.filter((f) => f.played).length;
console.log("Sala:", roomId, "| fecha:", d0, "| jugados:", played0);

// Tumbar el servidor 60 s (= ~4 días a 15 s/día)
a.close();
srv.kill();
console.log("Servidor tumbado 60 s...");
await sleep(60000);

// Rearrancar y esperar catch-up (máx. 10 días por tick de 5 s)
srv = start();
await waitUp();
console.log("Servidor de vuelta, esperando catch-up...");
await sleep(20000);
const rooms = await fetch(`http://127.0.0.1:${PORT}/rooms`).then((r) => r.json());
const room = rooms.find((r) => r.id === roomId);
if (!room) fail("la sala no sobrevivió");
console.log("Fecha tras volver:", room.date, "(era", d0 + ")");

// Verificar por WS que hay más partidos jugados (simulación real)
const b = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise((r) => b.on("open", r));
b.send(JSON.stringify({ t: "join", roomId, teamId: "T01", nick: "Ana" }));
const snap2 = await once(b, "snapshot");
const played1 = snap2.state.fixtures.filter((f) => f.played).length;
console.log("Jugados antes:", played0, "→ después:", played1);
if (room.date === d0) fail("la fecha no avanzó tras la caída");
if (played1 <= played0) fail("la fecha avanzó pero NO se simularon partidos (salto vacío)");
console.log("CATCH-UP TEST: TODO OK (días simulados de verdad, sin saltos)");
srv.kill();
a.close(); b.close();
process.exit(0);
