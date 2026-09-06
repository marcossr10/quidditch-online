// Test colas de resultados: simula ~400 días y verifica que los
// partidos de humanos entran en su cola (para el popup en vivo/rejoin)
// y que no se duplican.
import { createRoom, addManager, tickRoom } from "./rooms.mjs";

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
console.log("RESULTS TEST: TODO OK");
process.exit(0);
