// Test de arranque headless: verifica que el motor del juego
// funciona en Node y que el modo onlineAuto avanza sin pausas.
import { qm } from "./harness.mjs";

const fail = (msg) => { console.error("FALLO:", msg); process.exit(1); };

// 1. Crear estado inicial (liga británica, sin mánager humano todavía)
let st = qm.buildInitialState(null, 2025, false, "BR");
if (!st || !st.teams?.length) fail("buildInitialState no devolvió estado válido");
console.log("OK buildInitialState: equipos =", st.teams.length, "| fecha =", st.currentDate);

// 2. Activar modo online: 2 humanos, sin pausas
qm.state = st;
st = qm.state;
const humans = [st.teams[0].TeamID, st.teams[1].TeamID];
st.onlineAuto = true;
st.onlineManagers = humans;
st.managerTeamId = null;
console.log("OK modo online: humanos =", humans.join(","));

// 3. Avanzar 40 días: la fecha debe moverse exactamente 40 días,
//    sin quedarse en 'ready' ni pausar por partidos de humanos.
const d0 = st.currentDate;
for (let i = 0; i < 40; i += 1) {
  if (st.pendingLeagueWrap) qm.startAdvance(true);
  else qm.advanceDay();
  st = qm.state;
  if (st.status === "ready") fail(`día ${i}: estado 'ready' (pausa) con onlineAuto`);
  if (st.pendingMatchId) fail(`día ${i}: pendingMatchId con onlineAuto`);
}
const avanzados = qm.daysBetween(d0, st.currentDate);
console.log("OK 40 ticks: fecha", d0, "->", st.currentDate, "| días =", avanzados);
if (avanzados !== 40) fail(`se esperaban 40 días, fueron ${avanzados}`);

// 4. Debe haberse jugado algún partido (incluidos los de humanos)
const jugados = st.fixtures.filter((f) => f.played).length;
console.log("OK partidos jugados =", jugados);
if (!jugados) fail("no se simuló ningún partido");

// 5. Los humanos no deben haber sido tocados por la IA del mercado:
//    sus alineaciones elegidas se respetan (legalLineup las normaliza, no las resetea)
for (const id of humans) {
  if (!Array.isArray(st.selectedLineups[id])) fail(`humano ${id} sin alineación`);
}
console.log("OK alineaciones humanas presentes");

// 6. Serializa a JSON (persistencia) y recarga
const json = JSON.stringify(st);
const st2 = qm.migrateState ? qm.migrateState(JSON.parse(json)) : JSON.parse(json);
if (st2.currentDate !== st.currentDate) fail("migrateState alteró la fecha");
console.log("OK persistencia JSON:", (json.length / 1024).toFixed(0), "KB");

console.log("BOOT TEST: TODO OK");
process.exit(0);
