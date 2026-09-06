// Test colas de resultados + aislamiento de negociaciones:
// - los partidos de humanos entran en su cola sin duplicarse
// - dos mánagers negocian a la vez sin verse ni pisarse
import { createRoom, addManager, tickRoom, applyAction, snapshotJson } from "./rooms.mjs";

const fail = (msg) => { console.error("FALLO:", msg); process.exit(1); };
const room = createRoom({ name: "R", leagueId: "BR", dayMs: 15000, managerName: null, teamId: null });
let r = addManager(room, "Ana", "T01", null);
if (!r.ok) fail("addManager Ana");
r = addManager(room, "Ben", "T02", null);
if (!r.ok) fail("addManager Ben");

let days = 0;
for (let i = 0; i < 45 && !((room.queues["T01"] || []).length || (room.queues["T02"] || []).length); i += 1) {
  room.lastTickWall = Date.now() - 10 * room.dayMs; // 10 días por tanda
  days += tickRoom(room);
}
const q1 = room.queues["T01"] || [];
const q2 = room.queues["T02"] || [];
console.log(`OK ${days} días simulados: cola T01=${q1.length} T02=${q2.length}`);
if (!q1.length && !q2.length) fail("ningún partido humano en 450 días (imposible en round-robin)");
const sample = q1[0] || q2[0];
if (typeof sample.homeScore !== "number" || !sample.homeId || !sample.date || !Array.isArray(sample.events)) {
  fail("el resultado no trae datos completos para el popup");
}
console.log("OK resultado:", sample.homeId, sample.homeScore + "-" + sample.awayScore, sample.awayId, sample.date);
// Sin duplicados: otro tick sin partidos nuevos no re-encola
const n1 = q1.length;
room.lastTickWall = Date.now() - room.dayMs;
tickRoom(room);
if ((room.queues["T01"] || []).length !== n1 && !((room.queues["T02"] || []).length > q2.length)) {
  // solo falla si T01 cambió sin motivo; T02 puede haber jugado de verdad
  const still = (room.queues["T01"] || []).length;
  const ids = new Set((room.queues["T01"] || []).map((f) => f.id));
  if (ids.size !== still) fail("resultados duplicados en la cola");
}
const pickCand = (teamId, skipIds = []) => room.state.players.find((p) => p.TeamID !== teamId && p.TeamID !== "FREE" && p.leagueId === "BR" && !p.shieldedUntil && !p.listed && !skipIds.includes(p.PlayerID));
const c1 = pickCand("T01");
const c2 = pickCand("T02", [c1.PlayerID]);
let r1 = applyAction(room, "T01", { type: "call", fn: "startNegotiation", args: [c1.PlayerID] });
let r2 = applyAction(room, "T02", { type: "call", fn: "startNegotiation", args: [c2.PlayerID] });
if (!r1.ok || !r2.ok) fail("startNegotiation por call falló");
const neg1 = room.state.onlineNegs["T01"];
const neg2 = room.state.onlineNegs["T02"];
if (!neg1 || neg1.playerId !== c1.PlayerID) fail("neg de T01 perdida");
if (!neg2 || neg2.playerId !== c2.PlayerID) fail("neg de T02 perdida o pisada");
if (room.state.negotiation) fail("negociación global contaminada (la verían todos)");
console.log("OK negociaciones simultáneas aisladas");
// Cada snapshot solo lleva la suya y el estado común queda intacto
const s1 = JSON.parse(snapshotJson(room, "T01"));
const s2 = JSON.parse(snapshotJson(room, "T02"));
const k1 = Object.keys(s1.state.onlineNegs || {});
const k2 = Object.keys(s2.state.onlineNegs || {});
if (k1.length !== 1 || s1.state.onlineNegs["T01"]?.playerId !== c1.PlayerID) fail("snapshot T01 no lleva solo su negociación");
if (k2.length !== 1 || s2.state.onlineNegs["T02"]?.playerId !== c2.PlayerID) fail("snapshot T02 no lleva solo su negociación");
if (Object.keys(room.state.onlineNegs).length !== 2) fail("el strip rompió el estado común");
console.log("OK snapshots con solo tu negociación");
console.log("RESULTS TEST: TODO OK");
process.exit(0);
