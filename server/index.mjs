// Servidor online Quidditch Manager: HTTP (estado) + WebSocket (juego).
// Despliegue: Render.com (free) con `npm start`. PORT lo da el entorno.
import http from "http";
import { WebSocketServer } from "ws";
import { LEAGUES } from "./harness.mjs";
import { loadAllRooms, createRoom, addManager, tickRoom, applyAction, saveRoom, roomInfo } from "./rooms.mjs";

const PORT = Number(process.env.PORT || 8787);
const TICK_MS = 5000;
const SAVE_MS = 15000;
const MIN_DAY_MS = 15000;
const MAX_DAY_MS = 30 * 60 * 1000;

const rooms = loadAllRooms();
console.log(`Salas cargadas: ${rooms.size}`);
for (const room of rooms.values()) {
  const days = tickRoom(room); // catch-up inmediato al arrancar
  if (days) console.log(`Sala ${room.id}: catch-up de ${days} día(s)`);
  saveRoom(room);
  room.lastSave = Date.now();
}

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const broadcastRooms = () => {
  const list = [...rooms.values()].map(roomInfo);
  for (const room of rooms.values()) for (const ws of room.sockets) send(ws, { t: "rooms", rooms: list });
  for (const ws of lobby) send(ws, { t: "rooms", rooms: list });
};
const snapshot = (room, teamId) => ({ t: "snapshot", room: roomInfo(room), myTeam: teamId, state: room.state });

const server = http.createServer((req, res) => {
  if (req.url === "/rooms") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([...rooms.values()].map(roomInfo)));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, game: "quidditch-manager-online", rooms: rooms.size, uptime: process.uptime() }));
});

const wss = new WebSocketServer({ server, perMessageDeflate: true });
const lobby = new Set(); // sockets mirando la lista de salas

wss.on("connection", (ws) => {
  ws.meta = {}; // { roomId, teamId, nick }
  lobby.add(ws);
  send(ws, { t: "rooms", rooms: [...rooms.values()].map(roomInfo) });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === "ping") return send(ws, { t: "pong" });

    if (msg.t === "create") {
      const name = String(msg.name || "Sala").slice(0, 40);
      const leagueId = String(msg.leagueId || "BR");
      if (!LEAGUES.some((l) => l.id === leagueId)) return send(ws, { t: "error", error: "LIGA_INVALIDA" });
      const dayMs = Math.min(MAX_DAY_MS, Math.max(MIN_DAY_MS, Number(msg.dayMs) || 120000));
      const nick = String(msg.nick || "Mánager").slice(0, 24);
      const room = createRoom({ name, leagueId, dayMs, managerName: null, teamId: null });
      rooms.set(room.id, room);
      room.lastSave = Date.now();
      const r = addManager(room, nick, String(msg.teamId || ""));
      if (!r.ok) { rooms.delete(room.id); return send(ws, { t: "error", error: r.error }); }
      attach(ws, room, nick, String(msg.teamId));
      send(ws, snapshot(room, String(msg.teamId)));
      broadcastRooms();
      return;
    }

    if (msg.t === "join") {
      const room = rooms.get(String(msg.roomId || ""));
      if (!room) return send(ws, { t: "error", error: "SALA_NO_EXISTE" });
      const nick = String(msg.nick || "Mánager").slice(0, 24);
      const teamId = String(msg.teamId || "");
      const existing = room.managers.find((m) => m.teamId === teamId);
      if (existing && existing.name !== nick) return send(ws, { t: "error", error: "EQUIPO_OCUPADO" });
      if (!existing) {
        const r = addManager(room, nick, teamId);
        if (!r.ok) return send(ws, { t: "error", error: r.error });
        saveRoom(room);
      }
      attach(ws, room, nick, teamId);
      send(ws, snapshot(room, teamId));
      broadcastRooms();
      return;
    }

    if (msg.t === "leave") { detach(ws); return; }

    if (msg.t === "action") {
      const room = rooms.get(ws.meta.roomId);
      if (!room || !ws.meta.teamId) return send(ws, { t: "error", error: "SIN_SALA" });
      const r = applyAction(room, ws.meta.teamId, msg.action || {});
      if (!r.ok) return send(ws, { t: "error", error: r.error });
      saveRoom(room);
      room.lastSave = Date.now();
      for (const peer of room.sockets) send(peer, snapshot(room, peer.meta.teamId));
      return;
    }
  });

  ws.on("close", () => { lobby.delete(ws); detach(ws); });
});

function attach(ws, room, nick, teamId) {
  detach(ws);
  lobby.delete(ws);
  ws.meta = { roomId: room.id, teamId, nick };
  room.sockets.add(ws);
}

function detach(ws) {
  const room = rooms.get(ws.meta?.roomId);
  if (room) room.sockets.delete(ws);
  ws.meta = {};
  if (![...rooms.values()].some((r) => r.sockets.has(ws))) lobby.add(ws);
}

// Reloj maestro: cada TICK_MS comprueba todas las salas.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const days = tickRoom(room, now);
    if (days > 0) {
      for (const peer of room.sockets) send(peer, snapshot(room, peer.meta.teamId));
    }
    if (room.dirty && now - (room.lastSave || 0) > SAVE_MS) {
      try { saveRoom(room); room.lastSave = now; } catch (e) { console.error("save", room.id, e.message); }
      room.dirty = false;
    }
  }
}, TICK_MS);

server.listen(PORT, () => console.log(`Online listo en puerto ${PORT}`));
