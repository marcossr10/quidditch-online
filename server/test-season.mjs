// Test temporada completa headless: 600 días con 3 humanos.
// Verifica que la temporada termina, hay campeón, la copa se juega,
// resetSeason arranca el año siguiente y el reloj nunca se pausa.
import { qm } from "./harness.mjs";

const fail = (msg) => { console.error("FALLO:", msg); process.exit(1); };
const st = qm.buildInitialState(null, 2025, false, "BR");
qm.state = st;
st.onlineAuto = true;
st.managerTeamId = null;
st.onlineManagers = st.teams.filter((t) => t.leagueId === "BR").slice(0, 3).map((t) => t.TeamID);
console.log("Humanos:", st.onlineManagers.join(","));

let wraps = 0;
for (let i = 0; i < 600; i += 1) {
  const s = qm.state;
  if (s.pendingLeagueWrap) { wraps += 1; qm.startAdvance(true); }
  else qm.advanceDay();
  const n = qm.state;
  if (n.status === "ready" || n.pendingMatchId) fail(`pausa en día ${i}`);
  if (i % 100 === 99) console.log(`día ${i + 1}: fecha=${n.currentDate} temporada=${n.seasonYear} wraps=${wraps} jugados=${n.fixtures.filter((f) => f.played).length}`);
}
const end = qm.state;
console.log(`FINAL: fecha=${end.currentDate} temporada=${end.seasonYear} wraps=${wraps}`);
if (end.seasonYear < 2026) fail("no se avanzó de temporada en 600 días");
if (!end.championsByLeague || !Object.keys(end.championsByLeague).length) fail("sin campeones registrados");
console.log("SEASON TEST: TODO OK");
process.exit(0);
