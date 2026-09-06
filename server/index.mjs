// Servidor online Quidditch Manager: HTTP (estado) + WebSocket (juego).
// Despliegue: Render.com (free) con `npm start`. PORT lo da el entorno.
import http from "http";
import { WebSocketServer } from "ws";
import { LEAGUES } from "./harness.mjs";
import { loadAllRooms, createRoom, addManager, tickRoom, applyAction, saveRoom, roomInfo, deleteRoomFile, newToken, snapshotJson } from "./rooms.mjs";

const PORT = Number(process.env.PORT || 8787);
const SERVER_VERSION = "1.9.0";
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
  for (const room of rooms.values()) for (const ws of room.sockets) send(ws, { t: "rooms", rooms: list, serverVersion: SERVER_VERSION });
  for (const ws of lobby) send(ws, { t: "rooms", rooms: list, serverVersion: SERVER_VERSION });
};
// snapshotJson() vive en rooms.mjs: serializa dentro del swap para que
// cada mánager solo reciba SU negociación. sendRaw envía el string tal cual.
const sendRaw = (ws, str) => { if (ws.readyState === 1) ws.send(str); };

const server = http.createServer((req, res) => {
  if (req.url === "/rooms") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([...rooms.values()].map(roomInfo)));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, game: "quidditch-manager-online", version: SERVER_VERSION, rooms: rooms.size, uptime: process.uptime() }));
});

const wss = new WebSocketServer({ server, perMessageDeflate: true });
const lobby = new Set(); // sockets mirando la lista de salas

wss.on("connection", (ws) => {
  ws.meta = {}; // { roomId, teamId, nick }
  lobby.add(ws);
  send(ws, { t: "rooms", rooms: [...rooms.values()].map(roomInfo), serverVersion: SERVER_VERSION });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t === "ping") return send(ws, { t: "pong" });

    if (msg.t === "create") {
      const name = String(msg.name || "Sala").slice(0, 40);
      const leagueId = String(msg.leagueId || "BR");
      if (!LEAGUES.some((l) => l.id === leagueId)) return send(ws, { t: "error", error: "LIGA_INVALIDA" });
      const dayMs = Math.min(MAX_DAY_MS, Math.max(MIN_DAY_MS, Number(msg.dayMs) || 120000));
      const nick = String(msg.nick || "Mánager").trim().slice(0, 24) || "Mánager";
      const room = createRoom({ name, leagueId, dayMs, managerName: nick, teamId: null });
      rooms.set(room.id, room);
      room.lastSave = Date.now();
      const r = addManager(room, nick, String(msg.teamId || ""), null);
      if (!r.ok) { rooms.delete(room.id); return send(ws, { t: "error", error: r.error }); }
      attach(ws, room, nick, String(msg.teamId));
      sendRaw(ws, snapshotJson(room, String(msg.teamId), { managerToken: r.token, creatorToken: room.creatorToken }));
      broadcastRooms();
      return;
    }

    if (msg.t === "join") {
      const room = rooms.get(String(msg.roomId || ""));
      if (!room) return send(ws, { t: "error", error: "SALA_NO_EXISTE" });
      const nick = String(msg.nick || "Mánager").trim().slice(0, 24) || "Mánager";
      const teamId = String(msg.teamId || "");
      // Salas creadas antes de los tokens: el primer mánager (quien la
      // creó en la práctica) adopta el rol de creador al reentrar.
      if (!room.creatorToken && room.managers[0] && room.managers[0].name.toLowerCase() === nick.toLowerCase()) {
        room.creatorToken = newToken();
        room.creatorNick = room.managers[0].name;
      }
      const r = addManager(room, nick, teamId, msg.token ? String(msg.token) : null);
      if (!r.ok) return send(ws, { t: "error", error: r.error });
      saveRoom(room);
      attach(ws, room, nick, teamId);
      const extra = { managerToken: r.token };
      if (room.creatorNick && room.creatorNick.toLowerCase() === nick.toLowerCase()) extra.creatorToken = room.creatorToken;
      sendRaw(ws, snapshotJson(room, teamId, extra));
      broadcastRooms();
      return;
    }

    if (msg.t === "delete") {
      const room = rooms.get(String(msg.roomId || ""));
      if (!room) return send(ws, { t: "error", error: "SALA_NO_EXISTE" });
      if (!room.creatorToken || msg.creatorToken !== room.creatorToken) {
        return send(ws, { t: "error", error: "SOLO_CREADOR" });
      }
      for (const peer of room.sockets) send(peer, { t: "roomDeleted", roomId: room.id });
      rooms.delete(room.id);
      deleteRoomFile(room.id);
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
      for (const peer of room.sockets) sendRaw(peer, snapshotJson(room, peer.meta.teamId));
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
      for (const peer of room.sockets) sendRaw(peer, snapshotJson(room, peer.meta.teamId));
    }
    if (room.dirty && now - (room.lastSave || 0) > SAVE_MS) {
      try { saveRoom(room); room.lastSave = now; } catch (e) { console.error("save", room.id, e.message); }
      room.dirty = false;
    }
  }
}, TICK_MS);

server.listen(PORT, () => console.log(`Online listo en puerto ${PORT}`));
