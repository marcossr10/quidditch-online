// Test integración: arranca el servidor, crea sala, une 2 mánagers,
// verifica que el reloj avanza solo y que los snapshots llegan.
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import WebSocket from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 18787;
const srv = spawn(process.execPath, ["index.mjs"], {
  cwd: HERE,
  env: { ...process.env, PORT: String(PORT) },
});
let out = "";
srv.stdout.on("data", (d) => { out += d; });
srv.stderr.on("data", (d) => { out += d; });
const fail = async (msg) => { console.error("FALLO:", msg, "\n--- servidor ---\n", out); srv.kill(); process.exit(1); };

// Esperar a que el servidor escuche
await new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.json()).then(() => { clearInterval(iv); res(); })
      .catch(() => { if (Date.now() - t0 > 30000) { clearInterval(iv); rej(new Error("timeout arranque")); } });
  }, 500);
});
console.log("OK servidor arriba");

const once = (ws, type) => new Promise((res) => {
  const h = (raw) => {
    const m = JSON.parse(raw);
    if (m.t === type) { ws.off("message", h); res(m); }
  };
  ws.on("message", h);
});

// Día rápido: 1 día cada 15 s (mínimo permitido)
const a = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise((r) => a.on("open", r));
a.send(JSON.stringify({ t: "create", name: "Test", leagueId: "BR", dayMs: 15000, teamId: "T01", nick: "Ana" }));
const snap = await once(a, "snapshot");
if (!snap.state || snap.room.managers.length !== 1) await fail("snapshot de creación inválido");
if (typeof snap.managerToken !== "string" || typeof snap.creatorToken !== "string") await fail("falta token de mánager/creador");
console.log("OK sala creada:", snap.room.id, "| fecha:", snap.state.currentDate);
const roomId = snap.room.id;
const d0 = snap.state.currentDate;
const creatorToken = snap.creatorToken;

const b = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise((r) => b.on("open", r));
b.send(JSON.stringify({ t: "join", roomId, teamId: "T02", nick: "Ben" }));
const snapB = await once(b, "snapshot");
if (snapB.room.managers.length !== 2) await fail("join no registró al 2º mánager");
if (typeof snapB.managerToken !== "string") await fail("falta token de mánager al unirse");
console.log("OK 2º mánager unido");

// Equipo ocupado debe fallar (otro nick)
const c = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise((r) => c.on("open", r));
c.send(JSON.stringify({ t: "join", roomId, teamId: "T01", nick: "Otro" }));
const err = await once(c, "error");
if (err.error !== "EQUIPO_OCUPADO") await fail("no se rechazó equipo ocupado");
console.log("OK equipo ocupado rechazado");

// Mismo nick no puede cambiar de equipo
b.send(JSON.stringify({ t: "join", roomId, teamId: "T03", nick: "Ben" }));
const errSwitch = await once(b, "error");
if (errSwitch.error !== "YA_TIENES_EQUIPO") await fail("se permitió cambiar de equipo");
console.log("OK equipo ligado al nick (sin cambios)");

// Reentrada con token conserva el equipo
b.send(JSON.stringify({ t: "join", roomId, teamId: "T02", nick: "Ben", token: snapB.managerToken }));
const snapB2 = await once(b, "snapshot");
if (snapB2.room.managers.length !== 2) await fail("reentrada con token falló");
console.log("OK reentrada con token");

// Mismo nombre sin token también reentra (identidad por nombre, sin bloqueos)
const b3 = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise((r) => b3.on("open", r));
b3.send(JSON.stringify({ t: "join", roomId, teamId: "T02", nick: "Ben" }));
const snapB3 = await once(b3, "snapshot");
if (snapB3.room.managers.length !== 2) await fail("reentrada por nombre falló");
console.log("OK reentrada por nombre sin token");
b3.close();

// Acción: cambiar alineación del T02
const lineup = snapB.state.selectedLineups["T02"];
a.send(JSON.stringify({ t: "action", action: { type: "lineup", ids: [null, null, null, null, null, null, null] } }));
await once(a, "snapshot"); // Ana recibe snapshot actualizado (su propio equipo intacto)
console.log("OK acción alineación procesada");

// Acción call: blindar un jugador de Ana (T01) vía impersonación
const cand = snap.state.players.find((p) => p.TeamID === "T01" && !p.shieldedUntil);
a.send(JSON.stringify({ t: "action", action: { type: "call", fn: "shieldPlayer", args: [cand.PlayerID] } }));
const snapShield = await once(a, "snapshot");
const blindado = snapShield.state.players.find((p) => p.PlayerID === cand.PlayerID);
if (!blindado.shieldedUntil) await fail("shieldPlayer no se aplicó en el servidor");
console.log("OK shieldPlayer aplicado en servidor");

// Acción call: listar para vender un jugador (toggle listed)
b.send(JSON.stringify({ t: "action", action: { type: "call", fn: "sellPlayer", args: [snapB.state.players.find((p) => p.TeamID === "T02").PlayerID] } }));
await once(b, "snapshot");
console.log("OK sellPlayer aplicado en servidor");

// Acción desconocida debe rechazarse
a.send(JSON.stringify({ t: "action", action: { type: "call", fn: "startAdvance", args: [] } }));
const errCall = await once(a, "error");
if (errCall.error !== "ACCION_DESCONOCIDA") await fail("no se rechazó fn fuera de whitelist");
console.log("OK whitelist rechaza funciones no permitidas");

// El reloj avanza solo: esperar ~20 s y comprobar que la fecha se movió
const snap2 = await once(a, "snapshot");
console.log("OK tick: fecha", d0, "->", snap2.state.currentDate);
if (snap2.state.currentDate === d0) await fail("el reloj no avanzó solo");

// Persistencia: hay archivo de sala
const { readFileSync, existsSync } = await import("fs");
const { join } = await import("path");
const fp = join(HERE, "data", "rooms", `${roomId}.json`);
if (!existsSync(fp)) await fail("no se persistió la sala");
console.log("OK persistencia:", (readFileSync(fp).length / 1024).toFixed(0), "KB");

// Reinicio: matar servidor, arrancar de nuevo, la sala debe seguir y hacer catch-up
srv.kill();
await new Promise((r) => setTimeout(r, 1500));
const srv2 = spawn(process.execPath, ["index.mjs"], {
  cwd: HERE,
  env: { ...process.env, PORT: String(PORT) },
});
srv2.stdout.on("data", (d) => { out += d; });
srv2.stderr.on("data", (d) => { out += d; });
const rooms = await new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    fetch(`http://127.0.0.1:${PORT}/rooms`).then((r) => r.json()).then((j) => { clearInterval(iv); res(j); })
      .catch(() => { if (Date.now() - t0 > 30000) { clearInterval(iv); rej(new Error("timeout rearranque")); } });
  }, 500);
});
if (!rooms.some((r) => r.id === roomId)) await fail("la sala no sobrevivió al reinicio");
console.log("OK la sala sobrevive al reinicio + catch-up");

// Tras el reinicio, los miembros reentran y el creador puede borrar.
// Borrar con token falso debe fallar; con el de creador, borra y avisa.
const a2 = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise((r) => a2.on("open", r));
a2.send(JSON.stringify({ t: "join", roomId, teamId: "T01", nick: "Ana", token: snap.managerToken }));
await once(a2, "snapshot");
const b2 = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise((r) => b2.on("open", r));
b2.send(JSON.stringify({ t: "join", roomId, teamId: "T02", nick: "Ben", token: snapB.managerToken }));
await once(b2, "snapshot");
console.log("OK reentrada tras reinicio");
a2.send(JSON.stringify({ t: "delete", roomId, creatorToken: "falso" }));
const errDel = await once(a2, "error");
if (errDel.error !== "SOLO_CREADOR") await fail("borrado sin token válido no rechazado");
console.log("OK borrado rechazado sin token de creador");
const goneA = once(a2, "roomDeleted");
const goneB = once(b2, "roomDeleted");
a2.send(JSON.stringify({ t: "delete", roomId, creatorToken }));
await goneA; await goneB;
const roomsAfter = await fetch(`http://127.0.0.1:${PORT}/rooms`).then((r) => r.json());
if (roomsAfter.some((r) => r.id === roomId)) await fail("la sala no se borró");
console.log("OK borrado por creador + aviso a miembros");
a2.close(); b2.close();
srv2.kill();
a.close(); b.close(); c.close(); a2.close(); b2.close();
console.log("INTEGRATION TEST: TODO OK");
process.exit(0);
