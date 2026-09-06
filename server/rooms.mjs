// Gestión de salas + reloj virtual + persistencia.
// DISEÑO DEL RELOJ (crítico):
// - Cada sala tiene dayMs (ms reales por día de juego) y lastTickWall.
// - owed = floor((ahora - lastTickWall) / dayMs): días que TOCAN por reloj.
// - Se simulan (máx. MAX_DAYS_PER_TICK por ciclo) y lastTickWall avanza
//   SOLO por los días simulados. Lo no simulado queda pendiente.
// - La fecha del juego SOLO se mueve vía advanceDay(). Jamás se deriva
//   de la fecha del juego cuántos días simular: el reloj manda.
// - Al despertar (tras dormir Render o reinicio), el tick calcula owed
//   con el reloj y hace catch-up: parece 24/7 sin serlo.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { qm } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, "data", "rooms");
mkdirSync(DATA_DIR, { recursive: true });

export const MAX_DAYS_PER_TICK = 10;

const rid = () => Math.random().toString(36).slice(2, 8);

function roomPath(id) { return join(DATA_DIR, `${id}.json`); }

function atomicWrite(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export const newToken = () => Math.random().toString(36).slice(2, 14);

export function saveRoom(room) {
  atomicWrite(roomPath(room.id), JSON.stringify({
    version: 2,
    meta: {
      id: room.id, name: room.name, leagueId: room.leagueId,
      dayMs: room.dayMs, createdAt: room.createdAt,
      managers: room.managers,
      creatorToken: room.creatorToken || null,
      creatorNick: room.creatorNick || null,
    },
    lastTickWall: room.lastTickWall,
    knownPlayed: room.knownPlayed || [],
    queues: room.queues || {},
    state: room.state,
  }));
}

function loadRoomFile(id) {
  try {
    const raw = JSON.parse(readFileSync(roomPath(id), "utf8"));
    let st = raw.state;
    if (qm.migrateState) { try { st = qm.migrateState(st); } catch { /* seguir con el estado tal cual */ } }
    return { ...raw, state: st };
  } catch {
    return null;
  }
}

export function loadAllRooms() {
  const rooms = new Map();
  let files = [];
  try { files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && !f.endsWith(".tmp")); } catch { files = []; }
  for (const f of files) {
    const id = f.slice(0, -5);
    const raw = loadRoomFile(id);
    if (!raw?.state) continue;
    const room = {
      id, name: raw.meta.name, leagueId: raw.meta.leagueId,
      dayMs: raw.meta.dayMs, createdAt: raw.meta.createdAt,
      managers: raw.meta.managers || [],
      creatorToken: raw.meta.creatorToken || null,
      creatorNick: raw.meta.creatorNick || null,
      lastTickWall: Math.min(raw.lastTickWall || Date.now(), Date.now()),
      knownPlayed: Array.isArray(raw.knownPlayed) ? raw.knownPlayed : raw.state.fixtures.filter((f) => f.played).map((f) => f.id),
      queues: raw.queues && typeof raw.queues === "object" ? raw.queues : {},
      state: raw.state, sockets: new Set(), dirty: false,
    };
    room.knownSet = new Set(room.knownPlayed);
    // Reafirmar modo online tras cargar (por si migrateState lo tocó)
    room.state.onlineAuto = true;
    room.state.managerTeamId = null;
    room.state.onlineManagers = room.managers.map((m) => m.teamId);
    rooms.set(id, room);
  }
  return rooms;
}

export function createRoom({ name, leagueId, dayMs, managerName, teamId }) {
  const state = qm.buildInitialState(null, 2025, false, leagueId);
  const room = {
    id: rid(), name, leagueId, dayMs, createdAt: Date.now(),
    managers: [], lastTickWall: Date.now(), state,
    creatorToken: newToken(), creatorNick: managerName || null,
    knownPlayed: [], knownSet: new Set(), queues: {},
    sockets: new Set(), dirty: true,
  };
  state.onlineAuto = true;
  state.managerTeamId = null;
  state.onlineManagers = [];
  if (managerName && teamId) addManager(room, managerName, teamId);
  // Primera simulación inmediata para calentar (día 0)
  saveRoom(room);
  return room;
}

export function addManager(room, name, teamId, token = null) {
  const nick = String(name || "").trim().slice(0, 24) || "Mánager";
  const claim = room.managers.find((m) => m.teamId === teamId);
  if (claim) {
    // El equipo ya tiene dueño: solo reentra el mismo mánager (mismo
    // nombre). El nombre es la identidad: se guarda y se reconoce.
    // Si trae token nuevo se actualiza; sin token también entra.
    if (claim.name.toLowerCase() !== nick.toLowerCase()) return { ok: false, error: "EQUIPO_OCUPADO" };
    if (token) claim.token = token;
    room.dirty = true;
    return { ok: true, token: claim.token || null };
  }
  const team = room.state.teams.find((t) => t.TeamID === teamId && t.leagueId === room.leagueId);
  if (!team) return { ok: false, error: "EQUIPO_INVALIDO" };
  // Un mánager, un equipo: no se puede cambiar de equipo en la misma sala.
  if (room.managers.some((m) => m.name.toLowerCase() === nick.toLowerCase())) {
    return { ok: false, error: "YA_TIENES_EQUIPO" };
  }
  const entry = { name: nick, teamId, token: token || newToken() };
  room.managers.push(entry);
  room.state.onlineManagers = room.managers.map((m) => m.teamId);
  room.dirty = true;
  return { ok: true, token: entry.token };
}

export function deleteRoomFile(id) {
  try { unlinkSync(roomPath(id)); } catch {}
}

// Un tick del reloj: devuelve nº de días simulados.
export function tickRoom(room, now = Date.now()) {
  if (now < room.lastTickWall) room.lastTickWall = now; // sesgo de reloj
  const owed = Math.floor((now - room.lastTickWall) / room.dayMs);
  if (owed <= 0) return 0;
  const days = Math.min(owed, MAX_DAYS_PER_TICK);
  const prev = qm.state;
  qm.state = room.state;
  try {
    for (let i = 0; i < days; i += 1) {
      if (room.state.pendingLeagueWrap) qm.startAdvance(true);
      else qm.advanceDay();
    }
  } finally {
    room.state = qm.state;
    qm.state = prev;
  }
  room.lastTickWall += days * room.dayMs;
  room.dirty = true;
  // Avisar resultados: partidos recién jugados de equipos humanos van
  // a su cola (el cliente los muestra en el popup, en vivo o al reentrar).
  if (!room.knownSet) room.knownSet = new Set(room.knownPlayed || []);
  const humans = new Set(room.managers.map((m) => m.teamId));
  for (const fixture of room.state.fixtures) {
    if (!fixture.played || room.knownSet.has(fixture.id)) continue;
    room.knownSet.add(fixture.id);
    if (!humans.has(fixture.homeId) && !humans.has(fixture.awayId)) continue;
    const copy = JSON.parse(JSON.stringify(fixture));
    for (const teamId of [fixture.homeId, fixture.awayId]) {
      if (!humans.has(teamId)) continue;
      room.queues[teamId] = room.queues[teamId] || [];
      room.queues[teamId].push(copy);
      if (room.queues[teamId].length > 15) room.queues[teamId] = room.queues[teamId].slice(-15);
    }
  }
  room.knownPlayed = [...room.knownSet];
  return days;
}

// Acciones permitidas por nombre y nº de argumentos. Se ejecutan con
// impersonación (managerTeamId = equipo del jugador) para reutilizar
// las validaciones del juego single-player sin duplicar lógica.
const ONLINE_CALLABLE = {
  buyPlayer: 2, sellPlayer: 1, sellPlayerToLeague: 1, shieldPlayer: 1,
  renewContract: 2, promoteStarter: 1, demoteStarter: 1,
  startNegotiation: 1, startIntlNegotiation: 1, submitNegotiation: 2,
  acceptNegotiationCounter: 0, withdrawNegotiation: 0,
};

// Aplica una acción de un mánager sobre el estado autoritativo.
// Devuelve { ok } o { ok:false, error }.
export function applyAction(room, teamId, action) {
  if (!room.managers.some((m) => m.teamId === teamId)) return { ok: false, error: "SIN_EQUIPO" };
  const prev = qm.state;
  qm.state = room.state;
  try {
    if (action.type === "lineup") {
      const ids = Array.isArray(action.ids) ? action.ids.slice(0, 7) : null;
      if (!ids) return { ok: false, error: "ALINEACION_INVALIDA" };
      const squad = new Set(qm.playersFor(teamId).map((p) => p.PlayerID));
      const clean = ids.map((id) => (typeof id === "string" && squad.has(id) ? id : null));
      room.state.selectedLineups[teamId] = clean;
      room.dirty = true;
      return { ok: true };
    }
    if (action.type === "call") {
      const arity = ONLINE_CALLABLE[action.fn];
      if (arity === undefined) return { ok: false, error: "ACCION_DESCONOCIDA" };
      const args = Array.isArray(action.args) ? action.args.slice(0, arity) : [];
      if (args.length !== arity) return { ok: false, error: "ARGS_INVALIDOS" };
      if (!args.every((a) => ["string", "number", "boolean"].includes(typeof a))) {
        return { ok: false, error: "ARGS_INVALIDOS" };
      }
      const fnRef = qm[action.fn];
      if (typeof fnRef !== "function") return { ok: false, error: "ACCION_DESCONOCIDA" };
      room.state.managerTeamId = teamId;
      try { fnRef(...args); } finally { room.state.managerTeamId = null; }
      room.dirty = true;
      return { ok: true };
    }
    return { ok: false, error: "ACCION_DESCONOCIDA" };
  } finally {
    room.state = qm.state;
    qm.state = prev;
  }
}

export function roomInfo(room) {
  return {
    id: room.id, name: room.name, leagueId: room.leagueId,
    dayMs: room.dayMs, createdAt: room.createdAt,
    date: room.state.currentDate, seasonYear: room.state.seasonYear,
    creatorNick: room.creatorNick || null,
    managers: room.managers.map((m) => ({ name: m.name, teamId: m.teamId })),
  };
}
