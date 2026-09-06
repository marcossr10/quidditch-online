import { LEAGUES, leagueById } from "./leagues.js";
import { WORLD_CUP } from "./worldcup.js";
import { YOUTH } from "./data/Youth.js";

const SAVE_KEY = "quidditch-manager-save-v2";
const SAVE_BACKUP_KEY = "quidditch-manager-save-backup";
const CAREER_SAVE_KEY = "quidditch-career-save-v1";
const CAREER_BACKUP_KEY = "quidditch-career-save-backup";
const GAME_VERSION = "1.4.0";
const START_YEAR = 2025;

// --- Estado de sesión online (declarado arriba: render() lo lee al arrancar) ---
// PON AQUÍ la dirección de tu servidor en Render cuando lo despliegues.
// Tus amigos no tendrán que escribir nada: en itch.io se usa sola.
const ONLINE_PROD_URL = "wss://TU-SERVIDOR.onrender.com";
function onlineDefaultUrl() {
  try {
    if (typeof location === "undefined") return "ws://localhost:8787";
    const host = location.hostname || "";
    const remoto = location.protocol === "https:" && host !== "localhost" && host !== "127.0.0.1";
    if (remoto && ONLINE_PROD_URL.indexOf("TU-SERVIDOR") < 0) return ONLINE_PROD_URL;
  } catch { /* noop */ }
  return "ws://localhost:8787";
}
let onlineLobby = false;
let onlineSocket = null;
let onlineRooms = [];
let onlineNick = "";
let onlineUrl = onlineDefaultUrl();
let onlineMyTeam = null;
let onlineRoomId = null;
let onlineRoomName = "";
let onlineError = "";
let onlineErrorAt = 0;
let onlineReconnects = 0;
let onlineCreate = { name: "", leagueId: "BR", teamId: "", daySec: 120 };
let onlineJoinTeam = {};

// --- Internacionalización (i18n) ---
// Idiomas disponibles: inglés (en) y español (es). Por defecto el juego arranca en inglés.
// Las cadenas se traducen en línea con _(es, en); los nombres de equipos y jugadores NO se traducen.
const LANGS = { en: "English", es: "Español" };
const LANG_KEY = "quidditch-manager-lang";
let UI_LANG = (typeof localStorage !== "undefined" && localStorage.getItem(LANG_KEY)) || "en";
function _(es, en) {
  if (UI_LANG === "es") return es == null ? "" : es;
  return en == null ? (es == null ? "" : es) : en;
}
function setLang(lang, rerender = true) {
  UI_LANG = lang === "es" ? "es" : "en";
  try { if (typeof localStorage !== "undefined") localStorage.setItem(LANG_KEY, UI_LANG); } catch (e) {}
  if (state && state.lang !== UI_LANG) { try { state.lang = UI_LANG; } catch (e) {} }
  if (rerender) { try { render(); } catch (e) {} }
}
function langSelector() {
  return `<label class="lang-select"><span class="muted">${_("Idioma", "Language")}</span><select data-lang>${Object.keys(LANGS).map((code) => `<option value="${code}" ${UI_LANG === code ? "selected" : ""}>${LANGS[code]}</option>`).join("")}</select></label>`;
}
const POS_NAMES = {
  en: { Chaser: "Chaser", Beater: "Beater", Keeper: "Keeper", Seeker: "Seeker", Reserve: "Reserve" },
  es: { Chaser: "Cazador", Beater: "Bateador", Keeper: "Guardián", Seeker: "Buscador", Reserve: "Suplente" },
};
const ATTR_NAMES = {
  en: { Speed: "Speed", ShotAccuracy: "Shot Accuracy", BatPower: "Bat Power", BatAccuracy: "Bat Accuracy", Reflexes: "Reflexes", Saving: "Saving", Agility: "Agility" },
  es: { Speed: "Velocidad", ShotAccuracy: "Precisión de tiro", BatPower: "Potencia de bate", BatAccuracy: "Precisión de bate", Reflexes: "Reflejos", Saving: "Paradas", Agility: "Agilidad" },
};
function posName(p) { return (POS_NAMES[UI_LANG] && POS_NAMES[UI_LANG][p]) || p; }
function attrName(a) { return (ATTR_NAMES[UI_LANG] && ATTR_NAMES[UI_LANG][a]) || a; }
const MONEY = new Intl.NumberFormat("es-ES");
const DATE = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });
const SHORT_DATE = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" });
const REQUIRED_SLOTS = ["Chaser", "Chaser", "Chaser", "Beater", "Beater", "Keeper", "Seeker"];
const COMPETITIONS = { league: "Liga", eurocup: "Copa Europea", worldcup: "Copa del Mundo de Quidditch", champions: "Torneo de Campeones" };
const LEAGUE_PRIZES = [50000, 40000, 32500, 26000, 21000, 17000, 13500, 10500, 8000, 6000, 4500, 3250, 2250, 1500];
const GALA_MIN_APPS = 10;
const CROSS_LEAGUE_FEE = 70000;
function leaguePrizeFor(position) { return LEAGUE_PRIZES[position - 1] || 0; }
const EURO_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const YOUTH_POOL = (() => {
  const pool = {};
  LEAGUES.forEach((league) => { pool[league.id] = (YOUTH[league.id] || []).map((row) => ({ ...row, leagueId: league.id })); });
  return pool;
})();

const app = document.querySelector("#app");
let lastLoadError = null;
let state = buildInitialState();
try {
  const loaded = loadState();
  if (loaded) state = loaded;
} catch (bootError) {
  console.error("No se pudo restaurar el guardado al arrancar:", bootError);
}
if (state && state.managerTeamId && !state.worldCup) {
  try { stabilizeAiFinances(); } catch (bailoutError) { console.error("Saneo financiero falló al arrancar:", bailoutError); }
}
let advanceTimer = null;
let activeView = "home";
let selectedTeamId = null;
let selectedPlayerId = null;
let selectedLeagueId = null;
let marketTab = "buy";
let homeMode = "league";
let confirmReset = false;
let titlesFilter = "league";
let titlesIntlFilter = "league";
let titlesEntity = "teams";
let titlesPlayerFilter = "worldcup";
let homeFeedTab = "league";
let careerSetup = null;
let careerSetupRandom = null;
let careerSetupCustom = null;
let careerCompTab = "liga";

function leagueInfo() { return leagueById(state.leagueId); }
function cupName() { return leagueInfo().cupName; }
function cupShortName() { return leagueInfo().cupShortName; }
function leagueTeamsPreview(league) {
  const players = [...(league.Players || []), ...(league.TransferMarket || [])];
  return league.Teams.map((team) => {
    const squad = players.filter((player) => player.TeamID === team.TeamID);
    const real = squad.length ? squad.reduce((sum, player) => sum + rating(player), 0) / squad.length : Number(team.OVR || 70);
    return { ...team, budget: Math.round(Number(team["Budget(G)"] || 0) / 2), realOVR: Math.round(real) };
  });
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function seasonStart(year) { return `${year}-11-01`; }
function leagueEnd(year) { return `${year + 1}-06-29`; }
function seasonFinish(year) { return leagueEnd(year); }
function cupYear() { return state.seasonYear + 1; }
function cupSemiFinal1Date(year) { return dateKey(year, 8, 5); }
function cupSemiFinal2Date(year) { return dateKey(year, 8, 10); }
function cupFinalDate(year) { return dateKey(year, 8, 15); }
function galaDate(year) { return dateKey(year, 8, 20); }
function worldCupYear() { return state.seasonYear + 1; }
function worldCupSeasonFor(year) { return (year + 1) % 4 === 2; }
function isWorldCupSeason() { return worldCupSeasonFor(state.seasonYear); }
function championsCupSeason(year) { return (year + 1) % 2 === 1; }
function wcGroupDate(year, jornada) { return dateKey(year, 7, 1 + (jornada - 1) * 4); }
function wcQuarterDate(year, partido) { return dateKey(year, 7, 14 + partido); }
function wcSemiDate(year, partido) { return dateKey(year, 7, 22 + partido); }
function wcThirdPlaceDate(year) { return dateKey(year, 7, 29); }
function wcFinalDate(year) { return dateKey(year, 7, 31); }
function euroYear() { return state.seasonYear + 1; }
function isEuroCupSeason(year) { return (year + 1) % 3 === 0; }
function euroGroupDate(year, jornada) {
  const date = new Date(`${year + 1}-01-14T12:00:00`);
  date.setDate(date.getDate() + (jornada - 1) * 21);
  return date.toISOString().slice(0, 10);
}
function euroR16Date(year) { return dateKey(year + 1, 3, 18); }
function euroQfDate(year) { return dateKey(year + 1, 4, 8); }
function euroSfDate(year) { return dateKey(year + 1, 4, 29); }
function euroFinalDate(year) { return dateKey(year + 1, 5, 20); }
function championsR1Date(year) { return dateKey(year + 1, 7, 5); }
function championsQfDate(year) { return dateKey(year + 1, 7, 12); }
function championsSfDate(year) { return dateKey(year + 1, 7, 19); }
function championsFinalDate(year) { return dateKey(year + 1, 7, 26); }
function daysBetween(start, end) { return Math.round((new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000); }
function addDays(date, days) { const copy = new Date(`${date}T12:00:00`); copy.setDate(copy.getDate() + days); return copy.toISOString().slice(0, 10); }
function dateKey(year, month, day) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function formatDate(date, short = false) { return (short ? SHORT_DATE : DATE).format(new Date(`${date}T12:00:00`)); }
function money(value) { return `${MONEY.format(Math.round(value || 0))} G`; }
function monthKey(date) { return date.slice(0, 7); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function playerValue(player) { return Math.max(500, Number(player["Value(G)"] || 0)); }
function releaseClause(player) { return Math.max(playerValue(player) * 1.8, Number(player["ReleaseClause(G)"] || 0)); }
function isInMarket(player) { return player.TeamID === "FREE" || player.listed; }
function buyPrice(player) { return isInMarket(player) ? playerValue(player) : releaseClause(player); }
function clauseLocked(player) { return Boolean(player.clauseLockUntil) && player.clauseLockUntil > state.currentDate; }
function isShielded(player) { return Boolean(player.shieldedUntil) && player.shieldedUntil > state.currentDate; }
function shieldEndDate() { return `${state.seasonYear + 1}-08-31`; }
function rating(player) {
  const performance = (Number(player.form || 70) - 70) * 0.08 + (Number(player.morale || 70) - 70) * 0.04;
  return Number(player.OVR || 60) * 0.58 + Number(player.Value1 || 60) * 0.21 + Number(player.Value2 || 60) * 0.21 + performance;
}
function matchRating(player) { return rating(player) * (0.55 + 0.45 * clamp(Number(player.stamina ?? 100), 0, 100) / 100); }
function roleWeight(player, role) { return player.Position === role ? matchRating(player) + 18 : matchRating(player) - 80; }
function lineupFromIds(teamId, selectedIds = [], sourceState = state) {
  const squad = playersFor(teamId, sourceState);
  const lineup = [];
  const used = new Set();
  const pickFromPool = (pool, slot) => pool.filter((player) => !used.has(player.PlayerID)).sort((a, b) => roleWeight(b, slot) - roleWeight(a, slot))[0];
  REQUIRED_SLOTS.forEach((slot) => {
    const preferred = selectedIds
      .map((id) => squad.find((player) => player.PlayerID === id))
      .find((player) => player && !used.has(player.PlayerID) && !player.injured && (player.Position === slot || player.Position === "Reserve"));
    const healthySlot = pickFromPool(squad.filter((player) => !player.injured && (player.Position === slot || player.Position === "Reserve")), slot);
    const chosen = preferred || healthySlot;
    lineup.push(chosen ? chosen.PlayerID : null);
    if (chosen) used.add(chosen.PlayerID);
  });
  return lineup;
}
function makePlayer(row, origin) {
  return { ...row, origin, listed: origin === "market", morale: Number(row.Morale ?? 72), form: Number(row.Form ?? 72), injured: row.Injured === "Yes", injuryDays: row.Injured === "Yes" ? 14 + Math.floor(Math.random() * 43) : 0, stamina: 100, goals: 0, snitches: 0, saves: 0, blocks: 0, appearances: 0, euroGoals: 0, euroSnitches: 0, euroSaves: 0, euroBlocks: 0, euroApps: 0, goalsConceded: 0, reputation: 0, intlReputation: 0, worldCupTitles: 0, clauseLockUntil: null, shieldedUntil: null };
}

function buildInitialState(teamId = null, year = START_YEAR, zeroStats = false, leagueId = "BR") {
  const teams = [];
  const players = [];
  const selectedLineups = {};
  LEAGUES.forEach((league) => {
    const leagueTeams = league.Teams.map((team) => ({ ...team, leagueId: league.id, budget: Math.round(Number(team["Budget(G)"] || 0) / 2), leagueTitles: zeroStats ? 0 : Number(team.LeagueTitles || 0), cupTitles: 0, euroCupTitles: 0, championsTitles: 0, ReputationStars: clamp(Number(team.ReputationStars) || 3, 1, 5) }));
    const leaguePlayers = [
      ...league.Players.map((player) => makePlayer({ ...player, leagueId: league.id, PlayerID: `${league.id}-${player.PlayerID}` }, "team")),
      ...league.TransferMarket.map((player) => makePlayer({ ...player, leagueId: league.id, PlayerID: `${league.id}-${player.PlayerID}` }, "market")),
    ];
    leagueTeams.forEach((team) => { selectedLineups[team.TeamID] = defaultLineup(leaguePlayers.filter((player) => player.TeamID === team.TeamID)); });
    teams.push(...leagueTeams);
    players.push(...leaguePlayers);
  });
  const welcomeEuro = isEuroCupSeason(year) ? [`${_("La Copa Europea", "The European Cup")} ${year + 1} ${_("se juega de enero a mayo: cada liga envía a sus mejores según su coeficiente (hasta 4 equipos, mínimo 1), marcadas en azul en la clasificación de la temporada anterior.", "is played from January to May: each league sends its best by coefficient (up to 4 teams, minimum 1), marked in blue in the previous season's table.")}`] : [];
  const welcomeChampions = championsCupSeason(year) ? [`${_("El Torneo de Campeones", "The Champions Tournament")} ${year + 1} ${_("se juega en verano cada dos años: los campeones de todas las ligas se miden en un bracket (primeros de julio). El campeón entre campeones gana 150.000 G.", "is played in summer every two years: the champions of all leagues meet in a bracket (early July). The champion of champions wins 150,000 G.")}`] : [];
  const newState = { managerTeamId: teamId, leagueId, seasonYear: year, currentDate: seasonStart(year), status: "idle", lang: "en", teams, players, fixtures: [], standings: [], leagueStandings: {}, leagueHistory: {}, championsByLeague: {}, feed: [`${_("Nueva partida: temporada", "New game: season")} ${year}/${year + 1}. ${_("La liga empieza el 1 de noviembre.", "The league starts on 1 November.")}`, ...welcomeEuro, ...welcomeChampions], lastResult: null, pendingMatchId: null, selectedLineups, paidWeeks: [], pendingWarning: null, pendingLeagueWrap: false, leagueTitleAwardedFor: null, clausePurchasesByMonth: {}, cupAwarded: false, cupWrapPending: false, galaPending: false, galaResult: null, galaModal: false, zeroStats, wcFinalModal: false, euroCup: null, euroCupResult: null, euroCupResults: [], euroCupAwarded: false, championsCup: null, championsCupResult: null, championsCupResults: [], championsCupAwarded: false, backgroundCupsAwarded: {}, leagueFunds: {}, youthReleased: [] };
  const seededYouth = releaseYouthToMarket(newState, 4 + Math.floor(Math.random() * 3), leagueId);
  if (seededYouth.length) newState.feed.push(`${_("La próxima generación ya está aquí: los primeros jóvenes llegan al mercado", "The next generation is here: the first youngsters arrive on the market")} (${seededYouth.slice(0, 6).join(", ")}...).`);
  newState.leagueHistory = initialLeagueHistory(newState);
  newState.fixtures = buildSeasonFixtures(newState, year);
  if (isEuroCupSeason(year)) newState.fixtures = [...newState.fixtures, ...setupEuroCup(newState, year)].sort(sortFixtures);
  recalcStandings(newState);  return newState;
}

function initialLeagueHistory(stateLike) {
  const history = {};
  LEAGUES.forEach((league) => {
    const teams = stateLike.teams.filter((team) => team.leagueId === league.id).slice().sort((a, b) => computedTeamOVR(a, stateLike) - computedTeamOVR(b, stateLike) || Number(b.leagueTitles || 0) - Number(a.leagueTitles || 0) || a.Name.localeCompare(b.Name));
    history[league.id] = teams.map((team) => team.TeamID);
  });
  return history;
}

function euroLeagueMatchDates(stateLike) {
  if (!stateLike.managerTeamId) return [];
  const manager = teamById(stateLike.managerTeamId, stateLike);
  if (!manager) return [];
  const dates = new Set();
  stateLike.fixtures.filter((fixture) => fixture.competition === "league" && fixture.leagueId === manager.leagueId && (fixture.homeId === manager.TeamID || fixture.awayId === manager.TeamID)).forEach((fixture) => dates.add(fixture.date));
  return [...dates];
}

function adjustEuroDate(candidate, blockedDates) {
  let date = candidate;
  while (blockedDates.includes(date)) date = addDays(date, 1);
  return date;
}

function championsBlockedDates(stateLike) {
  const blocked = new Set();
  stateLike.fixtures.filter((fixture) => fixture.competition !== "champions").forEach((fixture) => blocked.add(fixture.date));
  return [...blocked];
}

function euroLeaguesByStrength(stateLike = state) {
  return LEAGUES
    .filter((league) => league.european !== false)
    .map((league) => {
      const teams = stateLike.teams.filter((team) => team.leagueId === league.id);
      const strength = teams.length ? teams.reduce((sum, team) => sum + computedTeamOVR(team, stateLike), 0) / teams.length : 0;
      return { league, strength };
    })
    .sort((a, b) => b.strength - a.strength || a.league.name.localeCompare(b.league.name));
}

function euroQualifyingSpots(stateLike = state) {
  const TOTAL = EURO_GROUPS.length * 4;
  const ranked = euroLeaguesByStrength(stateLike);
  const totalStrength = ranked.reduce((sum, row) => sum + row.strength, 0) || 1;
  const spots = {};
  ranked.forEach((row) => { spots[row.league.id] = clamp(row.league.euroSpots ?? Math.floor((row.strength / totalStrength) * TOTAL), 1, 4); });
  let sum = Object.values(spots).reduce((a, b) => a + b, 0);
  let up = 0;
  while (sum < TOTAL && up < ranked.length) { if (spots[ranked[up].league.id] < 4) { spots[ranked[up].league.id] += 1; sum += 1; } up += 1; }
  let down = ranked.length - 1;
  while (sum > TOTAL && down >= 0) { if (spots[ranked[down].league.id] > 1) { spots[ranked[down].league.id] -= 1; sum -= 1; } down -= 1; }
  return { ranked, spots };
}

function euroCupParticipants(stateLike) {
  const { ranked, spots } = euroQualifyingSpots(stateLike);
  const groups = {};
  EURO_GROUPS.forEach((letter) => { groups[letter] = []; });
  ranked.forEach(({ league }, leagueIndex) => {
    const need = spots[league.id] || 0;
    const history = stateLike.leagueHistory?.[league.id] || [];
    const picked = [];
    history.forEach((teamId) => { if (picked.length < need && stateLike.teams.some((team) => team.TeamID === teamId && team.leagueId === league.id)) picked.push(teamId); });
    if (picked.length < need) {
      const used = new Set(picked);
      stateLike.teams.filter((team) => team.leagueId === league.id && !used.has(team.TeamID)).sort((a, b) => computedTeamOVR(b, stateLike) - computedTeamOVR(a, stateLike) || a.Name.localeCompare(b.Name)).slice(0, need - picked.length).forEach((team) => picked.push(team.TeamID));
    }
    picked.forEach((teamId, participantIndex) => {
      let chosen = null;
      const start = (leagueIndex * 2 + participantIndex * 3) % 8;
      for (let g = 0; g < 8; g += 1) {
        const letter = EURO_GROUPS[(start + g) % 8];
        if (groups[letter].length >= 4) continue;
        if (groups[letter].some((tid) => stateLike.teams.find((team) => team.TeamID === tid)?.leagueId === league.id)) continue;
        chosen = letter;
        break;
      }
      if (!chosen) { for (const letter of EURO_GROUPS) { if (groups[letter].length < 4) { chosen = letter; break; } } }
      if (chosen) groups[chosen].push(teamId);
    });
  });
  return groups;
}

function buildEuroCupGroupFixtures(stateLike, year) {
  const groups = euroCupParticipants(stateLike);
  const blocked = euroLeagueMatchDates(stateLike);
  const fixtures = [];
  EURO_GROUPS.forEach((letter) => {
    const g = groups[letter] || [];
    const pairings = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    pairings.forEach((pair, index) => {
      const home = g[pair[0]];
      const away = g[pair[1]];
      if (!home || !away) return;
      fixtures.push(makeFixture({ id: `E${year}-G${letter}-${index + 1}`, date: adjustEuroDate(euroGroupDate(year, Math.floor(index / 2) + 1), blocked), competition: "eurocup", round: `Grupo ${letter}`, homeId: home, awayId: away }));
    });
  });
  return fixtures;
}

function buildEuroCupFixtures(stateLike, year) {
  const fixtures = buildEuroCupGroupFixtures(stateLike, year);
  const blocked = euroLeagueMatchDates(stateLike);
  const koDate = (base) => adjustEuroDate(base, blocked);
  for (let i = 1; i <= 8; i += 1) fixtures.push(makeFixture({ id: `E${year}-R16-${i}`, date: koDate(euroR16Date(year)), competition: "eurocup", round: "Octavos de final", homeId: null, awayId: null }));
  for (let i = 1; i <= 4; i += 1) fixtures.push(makeFixture({ id: `E${year}-QF-${i}`, date: koDate(euroQfDate(year)), competition: "eurocup", round: "Cuartos de final", homeId: null, awayId: null }));
  for (let i = 1; i <= 2; i += 1) fixtures.push(makeFixture({ id: `E${year}-SF-${i}`, date: koDate(euroSfDate(year)), competition: "eurocup", round: "Semifinal", homeId: null, awayId: null }));
  fixtures.push(makeFixture({ id: `E${year}-F`, date: koDate(euroFinalDate(year)), competition: "eurocup", round: "Final", homeId: null, awayId: null }));
  return fixtures;
}

function setupEuroCup(stateLike, year) {
  const groups = euroCupParticipants(stateLike);
  stateLike.euroCup = { year: year + 1, groups, done: false };
  stateLike.euroCupResult = null;
  stateLike.euroCupAwarded = false;
  return buildEuroCupFixtures(stateLike, year);
}

function repairEuroCupGroups() {
  if (!state.euroCup || !state.euroCup.year) return;
  const groups = euroCupParticipants(state);
  let changed = false;
  EURO_GROUPS.forEach((letter) => {
    const stored = (state.euroCup.groups || {})[letter] || [];
    const storedValid = stored.length === 4 && stored.every((tid) => state.teams.some((team) => team.TeamID === tid));
    if (storedValid) return;
    const fresh = groups[letter] || [];
    const same = stored.length === 4 && fresh.length === 4 && stored.slice().sort().join("|") === fresh.slice().sort().join("|");
    if (same) return;
    const oldFixtures = state.fixtures.filter((fixture) => fixture.competition === "eurocup" && fixture.round === `Grupo ${letter}`);
    const playedByKey = new Map();
    oldFixtures.filter((fixture) => fixture.played).forEach((fixture) => {
      const key = [fixture.homeId, fixture.awayId].sort().join("|");
      playedByKey.set(key, fixture);
    });
    state.fixtures = state.fixtures.filter((fixture) => !(fixture.competition === "eurocup" && fixture.round === `Grupo ${letter}`));
    const year = state.euroCup.year - 1;
    const blocked = euroLeagueMatchDates(state);
    const pairings = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    pairings.forEach((pair, index) => {
      const home = fresh[pair[0]];
      const away = fresh[pair[1]];
      if (!home || !away) return;
      const builder = makeFixture({ id: `E${year}-G${letter}-${index + 1}`, date: adjustEuroDate(euroGroupDate(year, Math.floor(index / 2) + 1), blocked), competition: "eurocup", round: `Grupo ${letter}`, homeId: home, awayId: away });
      const prev = playedByKey.get([home, away].sort().join("|"));
      if (prev) {
        builder.played = true;
        builder.homeScore = prev.homeScore;
        builder.awayScore = prev.awayScore;
        builder.events = prev.events;
        builder.scorers = prev.scorers;
        builder.snitchPlayerId = prev.snitchPlayerId;
        builder.winnerId = prev.winnerId;
        builder.loserId = prev.loserId;
        builder.forfeit = prev.forfeit;
      }
      state.fixtures.push(builder);
    });
    state.euroCup.groups[letter] = fresh;
    changed = true;
  });
  if (changed) {
    state.fixtures.sort(sortFixtures);
    state.fixtures.filter((fixture) => fixture.competition === "eurocup" && fixture.round.startsWith("Grupo") && !fixture.played && fixture.date <= state.currentDate && fixture.homeId !== state.managerTeamId && fixture.awayId !== state.managerTeamId).sort(sortFixtures).forEach((fixture) => simulateMatch(fixture));
    updatePlayerValues();
    const patched = EURO_GROUPS.filter((letter) => (groups[letter] || []).length < 4).length;
    pushFeed(`${"Copa Europea"}: ${"corregida la composición de los grupos"} (${patched ? `${patched} ${"grupos con 4 equipos"}` : "todos completos"}).`, `${"European Cup"}: ${"the group composition was fixed"} (${patched ? `${patched} ${"groups with 4 teams"}` : "all complete"}).`);
  }
}

function migrateState(parsed) {
  if (!parsed || !Array.isArray(parsed.teams) || !Array.isArray(parsed.players) || !Array.isArray(parsed.fixtures)) return buildInitialState();
  try {
    parsed.leagueId = leagueById(parsed.leagueId).id;
    if (parsed.seasonYear == null) parsed.seasonYear = START_YEAR;
    if (parsed.currentDate == null) parsed.currentDate = seasonStart(parsed.seasonYear);
    if (parsed.status == null) parsed.status = "idle";
    if (parsed.feed == null) parsed.feed = [];
    if (parsed.lastResult == null) parsed.lastResult = null;
    if (parsed.pendingMatchId == null) parsed.pendingMatchId = null;
    if (parsed.selectedLineups == null) parsed.selectedLineups = {};
    if (parsed.paidWeeks == null) parsed.paidWeeks = [];
    if (parsed.pendingWarning == null) parsed.pendingWarning = null;
    if (parsed.pendingLeagueWrap == null) parsed.pendingLeagueWrap = false;
    if (parsed.leagueTitleAwardedFor == null) parsed.leagueTitleAwardedFor = null;
    if (parsed.clausePurchasesByMonth == null) parsed.clausePurchasesByMonth = {};
    if (parsed.cupAwarded == null) parsed.cupAwarded = false;
    if (parsed.cupWrapPending == null) parsed.cupWrapPending = false;
    if (parsed.galaPending == null) parsed.galaPending = false;
    if (parsed.galaResult == null) parsed.galaResult = null;
    if (parsed.galaModal == null) parsed.galaModal = false;
    if (parsed.negotiation == null) parsed.negotiation = null;
    if (parsed.zeroStats == null) parsed.zeroStats = false;
    if (parsed.worldCupResults == null) parsed.worldCupResults = [];
    if (parsed.worldCupPlayedYear == null) parsed.worldCupPlayedYear = null;
    if (parsed.wcFinalModal == null) parsed.wcFinalModal = false;
    if (parsed.leagueStandings == null) parsed.leagueStandings = {};
    if (parsed.leagueHistory == null) parsed.leagueHistory = initialLeagueHistory(parsed);
    if (parsed.euroCup == null) parsed.euroCup = null;
    if (parsed.euroCupResult == null) parsed.euroCupResult = null;
    if (parsed.euroCupResults == null) parsed.euroCupResults = [];
    if (parsed.euroCupAwarded == null) parsed.euroCupAwarded = false;
    if (parsed.championsByLeague == null) parsed.championsByLeague = {};
    if (parsed.championsCup == null) parsed.championsCup = null;
    if (parsed.championsCupResult == null) parsed.championsCupResult = null;
    if (parsed.championsCupResults == null) parsed.championsCupResults = [];
    if (parsed.championsCupAwarded == null) parsed.championsCupAwarded = false;
    if (parsed.backgroundCupsAwarded == null) parsed.backgroundCupsAwarded = {};
    if (parsed.leagueFunds == null) parsed.leagueFunds = {};
    Object.keys(parsed.leagueFunds).forEach((leagueId) => { parsed.leagueFunds[leagueId] = Math.max(0, Math.round(Number(parsed.leagueFunds[leagueId]) || 0)); });
    if (parsed.careerMode == null) parsed.careerMode = false;
    if (parsed.careerPlayerId == null) parsed.careerPlayerId = null;
    if (parsed.career == null) parsed.career = null;
    parsed.lang = parsed.lang === "es" ? "es" : "en";
    if (parsed.career) {
      parsed.career.money = Number(parsed.career.money ?? 0);
      parsed.career.moneyWeek = Number(parsed.career.moneyWeek ?? -1);
      parsed.career.lifetimeEarned = Number(parsed.career.lifetimeEarned ?? 0);
      parsed.career.lifetimeSpent = Number(parsed.career.lifetimeSpent ?? 0);
      parsed.career.notice = parsed.career.notice ?? null;
      parsed.career.wc = parsed.career.wc ?? null;
      parsed.career.wcFinalModal = Boolean(parsed.career.wcFinalModal ?? false);
      parsed.career.nextOfferAt = parsed.career.nextOfferAt ?? null;
      parsed.career.bets = Array.isArray(parsed.career.bets) ? parsed.career.bets : [];
      parsed.career.sponsor = parsed.career.sponsor ?? null;
      parsed.career.mansion = parsed.career.mansion ?? null;
      parsed.career.offers = (parsed.career.offers || []).map((o) => ({ ...o, expiresAt: o.expiresAt || addDays(parsed.currentDate, 30), crossLeague: Boolean(o.crossLeague) }));
      const cpl = parsed.careerPlayerId ? parsed.players.find((p) => p.PlayerID === parsed.careerPlayerId) : null;
      if (cpl) {
        const galas = (parsed.career.awards || []).filter((a) => String(a).indexOf("Escoba de Oro Internacional") !== 0 && String(a).indexOf("Escoba de Oro ") === 0).length;
        const intlGalas = (parsed.career.awards || []).filter((a) => String(a).indexOf("Escoba de Oro Internacional") === 0).length;
        cpl.reputation = Math.min(10, galas);
        cpl.intlReputation = Math.min(10, intlGalas);
        cpl.celebrity = clamp(Number(cpl.celebrity ?? 0), 0, 10);
      }
    }
    if (parsed.youthReleased == null) parsed.youthReleased = [];
    if (!isEuroCupSeason(parsed.seasonYear)) {
      parsed.euroCup = null;
      parsed.euroCupResult = null;
      parsed.euroCupResults = [];
      parsed.euroCupAwarded = false;
      parsed.fixtures = parsed.fixtures.filter((fixture) => fixture.competition !== "eurocup");
    }
    if (championsCupSeason(parsed.seasonYear) && !parsed.fixtures.some((fixture) => fixture.competition === "champions")) {
      parsed.championsCup = null;
      parsed.championsCupResult = null;
      parsed.championsCupResults = parsed.championsCupResults || [];
      parsed.championsCupAwarded = false;
    }
    parsed.teams.forEach((team) => {
      team.budget = Number(team.budget ?? team["Budget(G)"] ?? 0);
      team.leagueTitles = Number(team.leagueTitles ?? team.LeagueTitles ?? 0);
      team.cupTitles = Number(team.cupTitles ?? 0);
      team.euroCupTitles = Number(team.euroCupTitles ?? 0);
      team.championsTitles = Number(team.championsTitles ?? 0);
      team.leagueId = team.leagueId || parsed.leagueId;
    });
    parsed.players.forEach((player) => {
      player.listed = Boolean(player.listed);
      player.goals = Number(player.goals ?? 0);
      player.snitches = Number(player.snitches ?? 0);
      player.appearances = Number(player.appearances ?? 0);
      player.injured = Boolean(player.injured);
      player.injuryDays = Number(player.injuryDays ?? (player.injured ? 21 : 0));
      player.stamina = Number(player.stamina ?? 100);
      player.saves = Number(player.saves ?? 0);
      player.blocks = Number(player.blocks ?? 0);
      player.euroGoals = Number(player.euroGoals ?? 0);
      player.euroSnitches = Number(player.euroSnitches ?? 0);
      player.euroSaves = Number(player.euroSaves ?? 0);
      player.euroBlocks = Number(player.euroBlocks ?? 0);
      player.euroApps = Number(player.euroApps ?? 0);
      player.goalsConceded = Number(player.goalsConceded ?? 0);
      player.reputation = Number(player.reputation ?? 0);
      player.intlReputation = Number(player.intlReputation ?? 0);
      player.celebrity = clamp(Number(player.celebrity ?? 0), 0, 10);
      player.worldCupTitles = Number(player.worldCupTitles ?? 0);
      player.clauseLockUntil = player.clauseLockUntil || null;
      player.shieldedUntil = player.shieldedUntil || null;
      player.negotiationBlockedUntil = player.negotiationBlockedUntil || null;
      player.leagueId = player.leagueId || (player.TeamID === "FREE" ? parsed.leagueId : (teamById(player.TeamID, parsed)?.leagueId || parsed.leagueId));
      const intrinsic = intrinsicValue(player);
      const value = Number(player["Value(G)"]);
      if (Number.isFinite(value) && value > 0) {
        const clamped = Math.max(intrinsic * 0.65, Math.min(value, intrinsic * 1.35));
        player["Value(G)"] = Math.round(clamped);
      }
      player["ReleaseClause(G)"] = Math.max(Math.round(player["Value(G)"] * 1.8), 2000);
    });
    if (!parsed.fixtures.some((fixture) => fixture.competition)) parsed.fixtures = buildSeasonFixtures(parsed, parsed.seasonYear);
    parsed.fixtures.forEach((fixture) => {
      if (fixture.competition === "worldcup" || fixture.competition === "eurocup" || fixture.competition === "champions") return;
      if (!fixture.leagueId) fixture.leagueId = parsed.leagueId;
    });
    const fixtureIdMap = new Map();
    parsed.fixtures.forEach((fixture) => {
      if (fixture.competition !== "league") return;
      const lid = fixture.leagueId || parsed.leagueId;
      const oldId = fixture.id;
      if (typeof oldId === "string" && !oldId.startsWith(`L${lid}-`)) {
        const newId = oldId.replace(/^L/, `L${lid}-`);
        fixtureIdMap.set(oldId, newId);
        fixture.id = newId;
      }
    });
    if (parsed.pendingMatchId) {
      const oldPending = parsed.pendingMatchId;
      if (fixtureIdMap.has(oldPending)) {
        const managerFixture = parsed.fixtures.find((fixture) => fixture.id === fixtureIdMap.get(oldPending) && (fixture.homeId === parsed.managerTeamId || fixture.awayId === parsed.managerTeamId));
        parsed.pendingMatchId = (managerFixture && managerFixture.id) || fixtureIdMap.get(oldPending);
      }
    }
    if (parsed.lastResult && parsed.lastResult.id && fixtureIdMap.has(parsed.lastResult.id)) parsed.lastResult.id = fixtureIdMap.get(parsed.lastResult.id);
    Object.keys(parsed.selectedLineups).forEach((teamId) => {
      if (teamId === parsed.managerTeamId) parsed.selectedLineups[teamId] = realignLineup(Array.isArray(parsed.selectedLineups[teamId]) ? parsed.selectedLineups[teamId] : [], playersFor(teamId, parsed));
      else parsed.selectedLineups[teamId] = legalLineup(teamId, parsed.selectedLineups[teamId] || [], false, parsed);
    });
    const isWcSave = Boolean(parsed.worldCup && parsed.worldCup.mode === "worldcup");
    if (!isWcSave && !parsed.teams.some((team) => team.leagueId !== parsed.leagueId)) {
      const previousState = state;
      state = parsed;
      try {
        LEAGUES.forEach((league) => {
          if (league.id === parsed.leagueId) return;
          const teams = league.Teams.map((team) => ({ ...team, leagueId: league.id, budget: Math.round(Number(team["Budget(G)"] || 0) / 2), leagueTitles: parsed.zeroStats ? 0 : Number(team.LeagueTitles || 0), cupTitles: 0, euroCupTitles: 0, championsTitles: 0, ReputationStars: clamp(Number(team.ReputationStars) || 3, 1, 5) }));
          const players = [...league.Players.map((player) => makePlayer({ ...player, leagueId: league.id, PlayerID: `${league.id}-${player.PlayerID}` }, "team")), ...league.TransferMarket.map((player) => makePlayer({ ...player, leagueId: league.id, PlayerID: `${league.id}-${player.PlayerID}` }, "market"))];
          teams.forEach((team) => { parsed.selectedLineups[team.TeamID] = defaultLineup(players.filter((player) => player.TeamID === team.TeamID)); });
          parsed.teams.push(...teams);
          parsed.players.push(...players);
          parsed.fixtures.push(...buildLeagueSchedule(teams, parsed.seasonYear, league.id).map((fixture) => ({ ...fixture, leagueId: league.id })));
        });
        parsed.leagueHistory = initialLeagueHistory(parsed);
        parsed.fixtures.filter((fixture) => fixture.competition === "league" && fixture.leagueId && fixture.leagueId !== parsed.leagueId && !fixture.played && fixture.date <= parsed.currentDate).sort(sortFixtures).forEach((fixture) => simulateMatch(fixture));
        updatePlayerValues();
        parsed.euroCup = null;
        parsed.euroCupResult = null;
        parsed.euroCupAwarded = false;
      } finally {
        state = previousState;
      }
    }
    recalcStandings(parsed);
    const previousState = state;
    state = parsed;
    try { ensureAISquads(); } finally { state = previousState; }
    return parsed;
  } catch (error) {
    console.error("migrateState: fallo al normalizar alguna parte de la partida; se conserva tal cual para no perder progreso.", error);
    if (!parsed || !Array.isArray(parsed.teams) || !Array.isArray(parsed.players) || !Array.isArray(parsed.fixtures)) return buildInitialState();
    if (parsed.leagueId == null) parsed.leagueId = leagueById(parsed.leagueId).id;
    if (parsed.seasonYear == null) parsed.seasonYear = START_YEAR;
    if (parsed.currentDate == null) parsed.currentDate = seasonStart(parsed.seasonYear);
    if (parsed.status == null) parsed.status = "idle";
    const previousState = state;
    state = parsed;
    try { recalcStandings(parsed); } catch (recalcError) { console.error("recalcStandings falló al recuperar la partida:", recalcError); }
    try { ensureAISquads(); } catch (aiError) { console.error("ensureAISquads falló al recuperar la partida:", aiError); }
    state = previousState;
    if (parsed.lang === "es") UI_LANG = "es"; else UI_LANG = "en";
    try { if (typeof localStorage !== "undefined") localStorage.setItem(LANG_KEY, UI_LANG); } catch (e) {}
    return parsed;
  }
}

function loadState() {
  try {
    const rawCareer = localStorage.getItem(CAREER_SAVE_KEY);
    if (rawCareer) {
      const parsed = JSON.parse(rawCareer);
      if (parsed && parsed.careerMode) {
        const migrated = migrateState(parsed);
        if (migrated.careerMode && migrated.career && migrated.careerPlayerId) return migrated;
      }
    }
  } catch (error) { console.error("No se pudo cargar la partida de carrera:", error); }
  let saved = null;
  try { saved = localStorage.getItem(SAVE_KEY); } catch (error) { console.error("storage no disponible:", error); lastLoadError = (error && error.message) || String(error); return buildInitialState(); }
  const rawBackup = (() => { try { return localStorage.getItem(SAVE_BACKUP_KEY); } catch (e) { return null; } })();
  if (saved) {
    let parsed = null;
    try { parsed = JSON.parse(saved); } catch (error) {
      console.error("La partida guardada no se pudo leer, se intenta con la copia de seguridad:", error);
      parsed = null;
    }
    if (parsed) {
      try {
        const migrated = migrateState(parsed);
        if (migrated.managerTeamId || (migrated.teams || []).some((team) => team.TeamID === migrated.managerTeamId)) return migrated;
      } catch (migrateError) {
        console.error("migrateState falló al cargar la partida, se intenta con la copia de seguridad:", migrateError);
      }
      try { localStorage.setItem(SAVE_BACKUP_KEY, saved); } catch (backupError) { console.error("no se pudo crear la copia de seguridad:", backupError); }
    }
  }
  if (rawBackup) {
    try {
      const migrated = migrateState(JSON.parse(rawBackup));
      if (migrated.managerTeamId || (migrated.teams || []).some((team) => team.TeamID === migrated.managerTeamId)) {
        pushFeed("Partida recuperada desde la copia de seguridad.", "Partida recuperada desde la copia de seguridad.");
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(migrated)); } catch (restoreError) { console.error("no se pudo restaurar la copia:", restoreError); }
        return migrated;
      }
    } catch (backupError) {
      console.error("La copia de seguridad tampoco pudo leerse:", backupError);
    }
  }
  return buildInitialState();
}
function saveState() {
  if (globalThis.__qmHeadless || state.onlineAuto) return;
  try {
    localStorage.setItem(state.careerMode ? CAREER_SAVE_KEY : SAVE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("No se pudo guardar la partida:", error);
    pushFeed(_("AVISO: no se pudo guardar la partida automáticamente. Usa el botón \"Guardar\" para exportarla a un archivo.", "WARNING: the game could not be saved automatically. Use the \"Save\" button to export it to a file."), _("AVISO: no se pudo guardar la partida automáticamente. Usa el botón \"Guardar\" para exportarla a un archivo.", "WARNING: the game could not be saved automatically. Use the \"Save\" button to export it to a file."));
  }
}
function exportGame() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quidditch-save-${state.currentDate}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  pushFeed("Partida guardada en archivo.", "Partida guardada en archivo.");
  saveAndRender();
}
function importGameFile(file) {
  if (state.onlineAuto) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = migrateState(JSON.parse(reader.result));
      stopAdvance();
      state = parsed;
      activeView = "home";
      selectedTeamId = null;
      marketTab = "buy";
      confirmReset = false;
      pushFeed("Partida cargada desde archivo.", "Partida cargada desde archivo.");
      saveAndRender();
    } catch {
      pushFeed("No se pudo leer el archivo de partida.", "No se pudo leer el archivo de partida.");
      saveAndRender();
    }
  };
  reader.readAsText(file);
}
function openImportPicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) importGameFile(file);
  });
  input.click();
}
function teamById(teamId, sourceState = state) { return sourceState.teams.find((team) => team.TeamID === teamId); }
function humanTeamIds(sourceState = state) {
  if (sourceState.onlineManagers && sourceState.onlineManagers.length) return sourceState.onlineManagers;
  return sourceState.managerTeamId ? [sourceState.managerTeamId] : [];
}
function isHumanTeam(teamId, sourceState = state) { return teamId != null && humanTeamIds(sourceState).includes(teamId); }
function autoSim(sourceState = state) {
  if (globalThis.__qmHeadless) return true;
  if (sourceState && sourceState.onlineAuto) return true;
  return sourceState !== state && Boolean(state.onlineAuto);
}
function teamName(teamId) { return teamById(teamId)?.Name || "Por decidir"; }
function playersFor(teamId, sourceState = state) { return sourceState.players.filter((player) => player.TeamID === teamId); }
function playerById(playerId, sourceState = state) { return sourceState.players.find((player) => player.PlayerID === playerId); }
function pushFeed(es, en, scope = "league") { state.feed.unshift({ es, en, scope }); state.feed = state.feed.slice(0, 24); }
function feedText(item) { if (typeof item === "string") return item; if (item && item.es != null) return UI_LANG === "es" ? item.es : (item.en || item.es); return (item && item.text) || ""; }
function feedScope(item) { return typeof item === "string" ? "league" : ((item && item.scope) || "league"); }
function fixtureFeedScope(fixture) {
  if (fixture.competition === "eurocup" || fixture.competition === "worldcup" || fixture.competition === "champions") return "world";
  return fixture.leagueId && fixture.leagueId !== state.leagueId ? "world" : "league";
}
function renderFeedPanel() {
  const items = state.feed.filter((item) => feedScope(item) === homeFeedTab);
  const rows = items.length
    ? items.map((item) => `<div class="feed-item"><span>•</span><span>${feedText(item)}</span><span></span></div>`).join("")
    : `<p class="muted">${homeFeedTab === "league" ? _("Aún no hay noticias de tu liga.", "No news from your league yet.") : _("Aún no hay noticias del mundo.", "No news from the world yet.")}</p>`;
  return `
    <div class="tabs">
      <button data-feed-tab="league" class="${homeFeedTab === "league" ? "active" : ""}">${_("Liga", "League")}</button>
      <button data-feed-tab="world" class="${homeFeedTab === "world" ? "active" : ""}">${_("Mundo", "World")}</button>
    </div>
    <div class="feed">${rows}</div>
  `;
}

function buildSeasonFixtures(sourceState, year) {
  const fixtures = [];
  LEAGUES.forEach((league) => {
    const teams = sourceState.teams.filter((team) => team.leagueId === league.id);
    if (!teams.length) return;
    fixtures.push(...buildLeagueSchedule(teams, year, league.id).map((fixture) => ({ ...fixture, leagueId: league.id })));
  });
  return fixtures.sort(sortFixtures);
}
function sortFixtures(a, b) { return a.date.localeCompare(b.date) || a.id.localeCompare(b.id); }
function makeFixture(data) { return { played: false, homeScore: null, awayScore: null, events: [], scorers: [], snitchPlayerId: null, winnerId: null, loserId: null, forfeit: false, ...data }; }

function worldCupTeamsList() { return WORLD_CUP.Teams.map((team) => ({ ...team, budget: Number(team["Budget(G)"] || 0) / 2, leagueTitles: 0, cupTitles: 0, squadPlayerIds: [] })); }
function worldCupPlayersList() { return WORLD_CUP.Players.map((player) => makePlayer({ ...player, Morale: 72, Form: 72, Injured: "No" }, "team")); }

const WC_SQUAD_SHAPE = ["Chaser", "Chaser", "Chaser", "Chaser", "Beater", "Beater", "Beater", "Keeper", "Keeper", "Seeker", "Seeker"];
function nationalPool() {
  return state.players.map((player) => ({ ...player, leagueId: player.leagueId || state.leagueId }));
}
function composeNationalSquad(team, pool) {
  const usable = (pool || []).filter((player) => (!player.injured) && (player.Nationality || "").toLowerCase() === (team.Country || "").toLowerCase() && ["Chaser", "Beater", "Keeper", "Seeker"].includes(player.Position));
  const picked = [];
  const used = new Set();
  WC_SQUAD_SHAPE.forEach((position) => {
    const best = usable.filter((player) => !used.has(player.PlayerID) && player.Position === position).sort((a, b) => rating(b) - rating(a))[0];
    if (best) { used.add(best.PlayerID); picked.push(best); }
  });
  if (picked.length < 7) return null;
  return picked;
}
function buildWorldCupPlayerFromLeague(leaguePlayer, teamId, slot) {
  const copy = makePlayer({ ...leaguePlayer, Morale: Number(leaguePlayer.morale ?? 72), Form: Number(leaguePlayer.form ?? 72), Injured: leaguePlayer.injured ? "Yes" : "No" }, "team");
  copy.PlayerID = `${teamId}-${slot}-${leaguePlayer.PlayerID.replace(/\s/g, "")}`;
  copy.sourcePlayerId = leaguePlayer.PlayerID;
  copy.sourceNationality = (leaguePlayer.Nationality || "").toLowerCase();
  copy.TeamID = teamId;
  return copy;
}
function wcSeeding(teamsList = worldCupTeamsList()) {
  const ranked = teamsList.slice().sort((a, b) => Number(a.OVR || 0) - Number(b.OVR || 0)).map((team) => team.TeamID);
  const pots = [ranked.slice(0, 4), ranked.slice(4, 8), ranked.slice(8, 12), ranked.slice(12, 16)];
  pots.forEach((pot) => { for (let i = pot.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [pot[i], pot[j]] = [pot[j], pot[i]]; } });
  const letters = ["A", "B", "C", "D"];
  const groups = { A: [], B: [], C: [], D: [] };
  pots.forEach((pot) => { pot.forEach((teamId, index) => { groups[letters[index]].push(teamId); }); });
  return { groups, ranked };
}

function buildWorldCupState(year = worldCupYear(), league = null) {
  const teams = worldCupTeamsList();
  const players = [];
  const pool = nationalPool();
  const excelByTeam = worldCupPlayersList().reduce((acc, player) => { (acc[player.TeamID] = acc[player.TeamID] || []).push(player); return acc; }, {});
  teams.forEach((team) => {
    const composed = composeNationalSquad(team, pool);
    if (composed) {
      const roster = composed.map((player, index) => buildWorldCupPlayerFromLeague(player, team.TeamID, index + 1));
      team.squadPlayerIds = roster.map((player) => player.PlayerID);
      team.squadSources = roster.map((player) => ({ playerId: player.sourcePlayerId, nationality: player.sourceNationality, name: player.Name }));
      players.push(...roster);
      team.OVR = Math.round(roster.reduce((sum, player) => sum + rating(player), 0) / roster.length);
    } else {
      const fallback = (excelByTeam[team.TeamID] || []).map((player) => ({ ...player, TeamID: team.TeamID }));
      team.squadPlayerIds = fallback.map((player) => player.PlayerID);
      team.squadSources = fallback.map((player) => ({ playerId: player.PlayerID, nationality: (player.Nationality || "").toLowerCase(), name: player.Name }));
      players.push(...fallback);
    }
  });
  const { groups } = wcSeeding(teams);
  const fixtures = [];
  const fixturesInGroup = (letter) => {
    const g = groups[letter];
    const pairings = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
    pairings.forEach((pair, index) => {
      const home = g[pair[0]];
      const away = g[pair[1]];
      fixtures.push(makeFixture({ id: `W${year}-G${letter}-${index + 1}`, date: wcGroupDate(year, Math.floor(index / 2) + 1), competition: "worldcup", round: `Grupo ${letter}`, homeId: home, awayId: away }));
    });
  };
  ["A", "B", "C", "D"].forEach(fixturesInGroup);
  [0, 1, 2, 3].forEach((index) => {
    fixtures.push(makeFixture({ id: `W${year}-QF${index + 1}`, date: wcQuarterDate(year, index), competition: "worldcup", round: "Cuartos de final", homeId: null, awayId: null }));
  });
  [0, 1].forEach((index) => {
    fixtures.push(makeFixture({ id: `W${year}-SF${index + 1}`, date: wcSemiDate(year, index), competition: "worldcup", round: "Semifinal", homeId: null, awayId: null }));
  });
  fixtures.push(makeFixture({ id: `W${year}-3P`, date: wcThirdPlaceDate(year), competition: "worldcup", round: "Tercer puesto", homeId: null, awayId: null }));
  fixtures.push(makeFixture({ id: `W${year}-F`, date: wcFinalDate(year), competition: "worldcup", round: "Final", homeId: null, awayId: null }));
  const newState = {
    managerTeamId: null,
    seasonYear: year,
    currentDate: wcGroupDate(year, 1),
    status: "idle",
    teams,
    players,
    fixtures: fixtures.sort(sortFixtures),
    standings: [],
    feed: [`${_("Copa del Mundo de Quidditch", "Quidditch World Cup")} ${year}: ${_("16 selecciones, 4 grupos. Elige la selección que vas a dirigir.", "16 national teams, 4 groups. Pick the team you will manage.")}`],
    lastResult: null,
    pendingMatchId: null,
    selectedLineups: {},
    paidWeeks: [],
    pendingWarning: null,
    pendingLeagueWrap: false,
    leagueTitleAwardedFor: null,
    clausePurchasesByMonth: {},
    cupAwarded: false,
    cupWrapPending: false,
    galaPending: false,
    galaResult: null,
    galaModal: false,
    zeroStats: false,
    wcFinalModal: false,
    worldCup: { mode: "worldcup", year, groups },
  };
  teams.forEach((team) => { newState.selectedLineups[team.TeamID] = defaultLineup(players.filter((player) => player.TeamID === team.TeamID)); });
  recalcStandings(newState);
  return newState;
}

function wcGroupTables(targetState = state) {
  const fixtures = targetState.fixtures.filter((fixture) => fixture.competition === "worldcup" && fixture.round.startsWith("Grupo"));
  const letters = ["A", "B", "C", "D"];
  const tables = {};
  letters.forEach((letter) => {
    const units = targetState.teams.filter((team) => (targetState.worldCup?.groups?.[letter] || []).includes(team.TeamID));
    const rows = units.map((team) => ({ teamId: team.TeamID, name: team.Name, played: 0, wins: 0, draws: 0, losses: 0, for: 0, against: 0, diff: 0, points: 0 }));
    const byTeam = Object.fromEntries(rows.map((row) => [row.teamId, row]));
    fixtures.filter((fixture) => (targetState.worldCup?.groups?.[letter] || []).includes(fixture.homeId)).forEach((fixture) => {
      const home = byTeam[fixture.homeId];
      const away = byTeam[fixture.awayId];
      if (!home || !away || !fixture.played) return;
      home.played += 1; away.played += 1;
      home.for += fixture.homeScore; home.against += fixture.awayScore;
      away.for += fixture.awayScore; away.against += fixture.homeScore;
      if (fixture.homeScore > fixture.awayScore) { home.wins += 1; away.losses += 1; home.points += 3; }
      else if (fixture.homeScore < fixture.awayScore) { away.wins += 1; home.losses += 1; away.points += 3; }
      else { home.draws += 1; away.draws += 1; home.points += 1; away.points += 1; }
    });
    rows.forEach((row) => { row.diff = row.for - row.against; });
    tables[letter] = rows.sort((a, b) => b.points - a.points || b.diff - a.diff || b.for - a.for || a.name.localeCompare(b.name));
  });
  return tables;
}

function wcGroupLeaders(targetState = state) {
  const tables = wcGroupTables(targetState);
  const result = {};
  ["A", "B", "C", "D"].forEach((letter) => {
    const rows = tables[letter];
    if (rows.length < 4 || rows.some((row) => row.played < 3)) return;
    result[letter] = { first: rows[0].teamId, second: rows[1].teamId };
  });
  return result;
}

function resolveWorldCupBracket() {
  if (!state.worldCup) return;
  const leaders = wcGroupLeaders(state);
  const byRound = (round) => state.fixtures.filter((fixture) => fixture.competition === "worldcup" && fixture.round === round);
  const qf = byRound("Cuartos de final");
  const sf = byRound("Semifinal");
  const third = byRound("Tercer puesto")[0];
  const final = byRound("Final")[0];
  if (Object.keys(leaders).length === 4 && qf.some((fixture) => !fixture.homeId)) {
    qf[0].homeId = leaders.A.first; qf[0].awayId = leaders.B.second;
    qf[1].homeId = leaders.B.first; qf[1].awayId = leaders.A.second;
    qf[2].homeId = leaders.C.first; qf[2].awayId = leaders.D.second;
    qf[3].homeId = leaders.D.first; qf[3].awayId = leaders.C.second;
    pushFeed("Fase de grupos terminada: se sortean los cuartos de final del Mundial.", "Fase de grupos terminada: se sortean los cuartos de final del Mundial.", "world");
  }
  if (sf[0] && !sf[0].homeId && qf[0].winnerId && qf[1].winnerId) { sf[0].homeId = qf[0].winnerId; sf[0].awayId = qf[1].winnerId; }
  if (sf[1] && !sf[1].homeId && qf[2].winnerId && qf[3].winnerId) { sf[1].homeId = qf[2].winnerId; sf[1].awayId = qf[3].winnerId; }
  if (third && !third.homeId && sf[0]?.loserId && sf[1]?.loserId) { third.homeId = sf[0].loserId; third.awayId = sf[1].loserId; }
  if (final && !final.homeId && sf[0]?.winnerId && sf[1]?.winnerId) { final.homeId = sf[0].winnerId; final.awayId = sf[1].winnerId; }
}

function buildLeagueSchedule(teams, year, leagueId) {
  const activeTeams = teams.map((team) => team.TeamID);
  if (activeTeams.length % 2 === 1) activeTeams.push("BYE");
  const rounds = activeTeams.length - 1;
  const half = activeTeams.length / 2;
  const rotation = seededShuffle([...activeTeams], year + (leagueId ? leagueId.charCodeAt(0) * 7 : 0));
  const interval = Math.max(1, Math.round(daysBetween(seasonStart(year), leagueEnd(year)) / (rounds - 1)));
  const fixtures = [];
  const prefix = leagueId ? `L${leagueId}-` : "L";
  for (let round = 0; round < rounds; round += 1) {
    const date = addDays(seasonStart(year), round * interval);
    const pairs = [];
    for (let index = 0; index < half; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      if (left === "BYE" || right === "BYE") continue;
      const flip = (year + round + index + (leagueId ? leagueId.charCodeAt(0) : 0)) % 2 === 1;
      pairs.push({ homeId: flip ? right : left, awayId: flip ? left : right });
    }
    const orderedPairs = seededShuffle(pairs, year + (leagueId ? leagueId.charCodeAt(0) * 7 : 0) + round * 37 + 11);
    orderedPairs.forEach((pair, index) => {
      fixtures.push(makeFixture({ id: `${prefix}${year}-${String(round + 1).padStart(2, "0")}-${index}`, date, competition: "league", round: `Jornada ${round + 1}`, homeId: pair.homeId, awayId: pair.awayId }));
    });
    rotation.splice(1, 0, rotation.pop());
  }
  return fixtures;
}

function seededShuffle(items, seed) {
  const output = [...items];
  let value = seed * 9301 + 49297;
  for (let index = output.length - 1; index > 0; index -= 1) { value = (value * 9301 + 49297) % 233280; const swap = value % (index + 1); [output[index], output[swap]] = [output[swap], output[index]]; }
  return output;
}

function defaultLineup(players) {
  const selected = [];
  REQUIRED_SLOTS.forEach((slot) => {
    const best = players.filter((player) => !selected.includes(player.PlayerID) && !player.injured && player.Position === slot).sort((a, b) => roleWeight(b, slot) - roleWeight(a, slot))[0];
    selected.push(best ? best.PlayerID : null);
  });
  return selected;
}

function affordableFreeAgent(team, position) {
  const pool = state.players
    .filter((player) => player.TeamID === "FREE" && player.leagueId === team.leagueId && (position === null || player.Position === position))
    .filter((player) => Number(team.budget || 0) >= buyPrice(player));
  return aiRecoveryNeeded(team)
    ? pool.slice().sort((a, b) => Number(a["Salary(G/week)"] || 0) - Number(b["Salary(G/week)"] || 0) || rating(b) - rating(a))[0]
    : pool.slice().sort((a, b) => rating(b) - rating(a))[0];
}

function ensureAISquads() {
  const REQUIRED_BY_POSITION = { Chaser: 3, Beater: 2, Keeper: 1, Seeker: 1 };
  state.teams.forEach((team) => {
    if (isHumanTeam(team.TeamID) && !state.careerMode) return;
    const squad = playersFor(team.TeamID);
    const have = { Chaser: 0, Beater: 0, Keeper: 0, Seeker: 0 };
    squad.filter((player) => !player.injured).forEach((player) => { have[player.Position] = (have[player.Position] || 0) + 1; });
    const picks = [];
    ["Chaser", "Beater", "Keeper", "Seeker"].forEach((position) => {
      const deficit = REQUIRED_BY_POSITION[position] - (have[position] || 0);
      for (let i = 0; i < Math.max(0, deficit); i += 1) picks.push(position);
    });
    picks.forEach((position) => {
      const player = affordableFreeAgent(team, position) || affordableFreeAgent(team, null);
      if (!player) return;
      const price = buyPrice(player);
      if (completeTransfer(player, team.TeamID, price, `${team.Name} ficha a ${player.Name} por ${money(price)} para completar la plantilla.`)) return;
    });
  });
  state.teams.forEach((team) => {
    if (isHumanTeam(team.TeamID) && !state.careerMode) return;
    state.selectedLineups[team.TeamID] = defaultLineup(playersFor(team.TeamID));
  });
}

function legalLineup(teamId, preferredIds = [], requireHealthy = true, sourceState = state) {
  const lineup = lineupFromIds(teamId, preferredIds, sourceState);
  if (!requireHealthy) return lineup;
  return lineup.map((playerId) => playerId && sourceState.players.find((player) => player.PlayerID === playerId)?.injured ? null : playerId);
}

function realignLineup(oldLineup, players) {
  const byId = Object.fromEntries((players || []).map((player) => [player.PlayerID, player]));
  const used = new Set();
  return REQUIRED_SLOTS.map((slot) => {
    const match = (oldLineup || []).find((id) => id && !used.has(id) && byId[id] && (byId[id].Position === slot || byId[id].Position === "Reserve"));
    if (!match) return null;
    used.add(match);
    return match;
  });
}

function lineupIssue(teamId, sourceState = state) {
  const lineup = sourceState.selectedLineups?.[teamId] || [];
  if (teamId === sourceState.managerTeamId && !autoSim(sourceState)) {
    const byId = Object.fromEntries(playersFor(teamId, sourceState).map((player) => [player.PlayerID, player]));
    const ok = REQUIRED_SLOTS.every((slot, i) => {
      const player = byId[lineup[i]];
      return player && player.TeamID === teamId && !player.injured && (player.Position === slot || player.Position === "Reserve");
    });
    return { ok, lineup: lineup.slice(0, REQUIRED_SLOTS.length).filter(Boolean) };
  }
  const validated = legalLineup(teamId, lineup, true, sourceState);
  return { ok: validated.filter(Boolean).length === REQUIRED_SLOTS.length, lineup: validated };
}

function prepareLineup(teamId, autoFix = true, sourceState = state) {
  if (autoFix && (autoSim(sourceState) || teamId !== sourceState.managerTeamId)) sourceState.selectedLineups[teamId] = legalLineup(teamId, sourceState.selectedLineups?.[teamId] || [], true, sourceState);
  return lineupIssue(teamId, sourceState).ok;
}

function lineupFor(teamId) {
  if (autoSim() || teamId !== state.managerTeamId) prepareLineup(teamId, true);
  return playersFor(teamId).filter((player) => (state.selectedLineups[teamId] || []).includes(player.PlayerID));
}

function teamPower(teamId) {
  const lineup = lineupFor(teamId);
  const byRole = (role) => lineup.filter((player) => player.Position === role);
  const avg = (list, fallback = 70) => (list.length ? list.reduce((sum, player) => sum + matchRating(player), 0) / list.length : fallback);
  const avgStat = (field) => lineup.length ? lineup.reduce((sum, player) => sum + Number(player[field] || 70), 0) / lineup.length : 70;
  return { attack: avg(byRole("Chaser")), control: avg(byRole("Beater")), defense: avg(byRole("Keeper")) * 0.75 + avg(byRole("Beater")) * 0.25, seeker: avg(byRole("Seeker")), form: avgStat("form"), morale: avgStat("morale") };
}

function randomNormal() { return (Math.random() + Math.random() + Math.random() + Math.random()) / 4; }
function computedTeamOVR(team, sourceState = state) {
  const squad = (sourceState.players || []).filter((player) => player.TeamID === team.TeamID);
  if (squad.length >= 7) return Math.round(squad.reduce((sum, player) => sum + rating(player), 0) / squad.length);
  return Number(team.OVR || 70);
}

function teamTrophyBonus(teamId) {
  let bonus = 0;
  Object.values(state.leagueStandings || {}).forEach((rows) => { if (rows && rows[0] && rows[0].teamId === teamId) bonus += 1; });
  const club = teamById(teamId);
  const lid = club?.leagueId || state.leagueId;
  const cupWinner = state.fixtures.find((fixture) => fixture.competition === "cup" && fixture.leagueId === lid && fixture.round === "Final")?.winnerId;
  if (cupWinner === teamId) bonus += 1;
  if (state.euroCupResult?.champion?.id === teamId) bonus += 1;
  if (state.championsCupResult?.champion?.id === teamId) bonus += 1;
  return bonus;
}

function seasonReputationTarget(team) {
  const rows = state.leagueStandings?.[team.leagueId] || state.standings;
  const index = rows.findIndex((row) => row.teamId === team.TeamID);
  let positionScore = 3;
  if (index >= 0 && rows.length > 1) positionScore = 1 + Math.round((rows.length - 1 - index) / (rows.length - 1) * 4);
  return clamp(positionScore + Math.min(2, teamTrophyBonus(team.TeamID)), 1, 5);
}

function recalculateReputations() {
  state.teams.forEach((team) => {
    const current = clamp(Number(team.ReputationStars) || 3, 1, 5);
    const target = seasonReputationTarget(team);
    const delta = target - current;
    if (delta === 0) return;
    const next = clamp(current + (delta > 0 ? 1 : -1), 1, 5);
    team.ReputationStars = next;
    if (team.leagueId === state.leagueId) pushFeed(`${team.Name}: ${"su reputación"} ${delta > 0 ? "sube" : "baja"} ${"de"} ${current}★ ${"a"} ${next}★ ${"por sus resultados."}`, `${team.Name}: ${"its reputation"} ${delta > 0 ? "rises" : "falls"} ${"from"} ${current}★ ${"to"} ${next}★ ${"due to its results."}`);
  });
}
function playerName(playerId) { return state.players.find((player) => player.PlayerID === playerId)?.Name || "Jugador"; }
function pickBestPlayer(teamId, position) { return lineupFor(teamId).filter((player) => player.Position === position).sort((a, b) => rating(b) - rating(a))[0]; }

function pickWeightedChaser(chasers) {
  const weights = chasers.map((player) => Math.max(1, matchRating(player) * matchRating(player)));
  let total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = Math.random() * total;
  for (let index = 0; index < chasers.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return chasers[index];
  }
  return chasers[chasers.length - 1];
}

function assignGoals(teamId, goals, euro = false) {
  const chasers = lineupFor(teamId).filter((player) => player.Position === "Chaser");
  const scorers = [];
  for (let index = 0; index < goals; index += 1) {
    const player = pickWeightedChaser(chasers);
    if (!player) continue;
    player.goals += 1;
    if (euro) player.euroGoals += 1;
    const row = scorers.find((item) => item.playerId === player.PlayerID);
    if (row) row.goals += 1;
    else scorers.push({ playerId: player.PlayerID, teamId, goals: 1 });
  }
  return scorers;
}

function scorerLine(scorers) {
  if (!scorers.length) return "Sin goleadores de quaffle.";
  return scorers.sort((a, b) => b.goals - a.goals).slice(0, 6).map((item) => `${playerName(item.playerId)} ${item.goals}`).join(" · ");
}

function applyPerformanceStats(fixture, homeGoals, awayGoals) {
  const isEuro = fixture.competition === "eurocup";
  const credit = (teamId, conceded) => {
    const lineup = lineupFor(teamId);
    const keeper = lineup.find((player) => player.Position === "Keeper");
    if (keeper) {
      keeper.saves = (keeper.saves || 0) + Math.max(1, Math.round(conceded * (0.35 + matchRating(keeper) / 160) + randomNormal() * 2));
      keeper.goalsConceded = (keeper.goalsConceded || 0) + conceded;
      if (isEuro) { keeper.euroSaves = (keeper.euroSaves || 0) + Math.max(1, Math.round(conceded * (0.35 + matchRating(keeper) / 160) + randomNormal() * 2)); }
    }
    lineup.filter((player) => player.Position === "Beater").forEach((beater) => {
      beater.blocks = (beater.blocks || 0) + Math.max(1, Math.round(conceded * (0.12 + matchRating(beater) / 260) + randomNormal()));
      beater.goalsConceded = (beater.goalsConceded || 0) + conceded;
      if (isEuro) beater.euroBlocks = (beater.euroBlocks || 0) + Math.max(1, Math.round(conceded * (0.12 + matchRating(beater) / 260) + randomNormal()));
    });
  };
  credit(fixture.homeId, awayGoals);
  credit(fixture.awayId, homeGoals);
}

function simulateMatch(fixture) {
  if (!fixture.homeId || !fixture.awayId || fixture.played) return fixture;
  const homeReady = prepareLineup(fixture.homeId, true);
  const awayReady = prepareLineup(fixture.awayId, true);
  if (!homeReady || !awayReady) return simulateForfeit(fixture, homeReady, awayReady);

  const home = teamPower(fixture.homeId);
  const away = teamPower(fixture.awayId);
  const homeGoalEdge = home.attack - away.defense + (home.control - away.control) * 0.24 + 5;
  const awayGoalEdge = away.attack - home.defense + (away.control - home.control) * 0.24;
  const homeGoals = Math.max(0, Math.round(8 + homeGoalEdge / 6 + (randomNormal() - 0.5) * 3.5));
  const awayGoals = Math.max(0, Math.round(8 + awayGoalEdge / 6 + (randomNormal() - 0.5) * 3.5));
  const seekerEdge = home.seeker - away.seeker + (home.morale - away.morale) * 0.06 + (home.form - away.form) * 0.08;
  const homeCaughtSnitch = Math.random() < Math.max(0.30, Math.min(0.70, 0.5 + seekerEdge / 95 + (homeGoals - awayGoals) * 0.015));
  const homeScore = homeGoals * 10 + (homeCaughtSnitch ? 150 : 0);
  const awayScore = awayGoals * 10 + (homeCaughtSnitch ? 0 : 150);
  const snitchTeam = homeCaughtSnitch ? fixture.homeId : fixture.awayId;
  const snitchPlayer = pickBestPlayer(snitchTeam, "Seeker");
  const isEuro = fixture.competition === "eurocup";
  const scorers = [...assignGoals(fixture.homeId, homeGoals, isEuro), ...assignGoals(fixture.awayId, awayGoals, isEuro)];
  applyPerformanceStats(fixture, homeGoals, awayGoals);

  fixture.played = true;
  fixture.homeScore = homeScore;
  fixture.awayScore = awayScore;
  fixture.scorers = scorers;
  fixture.snitchPlayerId = snitchPlayer?.PlayerID || null;
  fixture.winnerId = homeScore > awayScore ? fixture.homeId : homeScore < awayScore ? fixture.awayId : null;
  fixture.loserId = fixture.winnerId === null ? null : fixture.winnerId === fixture.homeId ? fixture.awayId : fixture.homeId;
  fixture.events = [`${competitionLabel(fixture)}: ${fixture.round}`, `${homeGoals}-${awayGoals} en goles de quaffle`, `${snitchPlayer ? snitchPlayer.Name : teamName(snitchTeam)} captura la snitch para ${teamName(snitchTeam)} (+150)`, scorerLine(scorers)];
  if (snitchPlayer) snitchPlayer.snitches += 1;
  if (isEuro && snitchPlayer) snitchPlayer.euroSnitches += 1;
  applyPlayerAftermath(fixture.homeId, homeScore, awayScore, isEuro);
  applyPlayerAftermath(fixture.awayId, awayScore, homeScore, isEuro);
  applyMatchRewards(fixture);
  recalcStandings(state);
  settleBetsForFixture(fixture);
  return fixture;
}

function simulateForfeit(fixture, homeReady, awayReady) {
  const homeWins = homeReady && !awayReady;
  const bothFail = !homeReady && !awayReady;
  fixture.played = true;
  fixture.forfeit = true;
  fixture.homeScore = bothFail ? 0 : homeWins ? 150 : 0;
  fixture.awayScore = bothFail ? 0 : homeWins ? 0 : 150;
  fixture.winnerId = bothFail ? fixture.homeId : homeWins ? fixture.homeId : fixture.awayId;
  fixture.loserId = fixture.winnerId === fixture.homeId ? fixture.awayId : fixture.homeId;
  fixture.events = [`${competitionLabel(fixture)}: ${fixture.round}`, bothFail ? _("Ambos equipos incumplen la alineación: se resuelve 0-0.", "Both teams fail to field a legal lineup: it is settled 0-0.") : `${teamName(fixture.loserId)} ${_("no puede alinear 7 jugadores sanos por posición y pierde 150-0.", "cannot field 7 fit players per position and loses 150-0.")}`];
  applyMatchRewards(fixture);
  recalcStandings(state);
  return fixture;
}

function applyPlayerAftermath(teamId, scored, conceded, isEuro = false) {
  const won = scored > conceded;
  playersFor(teamId).forEach((player) => {
    if (!(state.selectedLineups[teamId] || []).includes(player.PlayerID)) return;
    const preStamina = Number(player.stamina ?? 100);
    player.appearances += 1;
    if (isEuro) player.euroApps += 1;
    player.form = clamp(Number(player.form || 70) + (won ? 3 : -2) + Math.round(Math.random() * 4 - 2), 35, 100);
    player.morale = clamp(Number(player.morale || 70) + (won ? 4 : -3), 30, 100);
    player.stamina = clamp(preStamina - (24 + Math.round(Math.random() * 10)), 20, 100);
    if (Math.random() < (preStamina < 45 ? 0.027 : 0.012)) { player.injured = true; player.injuryDays = 14 + Math.floor(Math.random() * 43); if (state.careerMode && state.career && player.PlayerID === state.careerPlayerId) pushFeed(`${"Lesión: ¡"}${player.Name} ${"se ha lesionado! Estará"} ${player.injuryDays} ${"días de baja."}`, `${"Injury: "}${player.Name} ${"is injured! He will be out for"} ${player.injuryDays} ${"days."}`); }
  });
}

function applyMatchRewards(fixture) {
  const gate = (teamId) => 1200 + Number(teamById(teamId)?.ReputationStars || 3) * 700;
  if (fixture.homeScore === fixture.awayScore) { teamById(fixture.homeId).budget += 2000 + gate(fixture.homeId); teamById(fixture.awayId).budget += 2000 + gate(fixture.awayId); return; }
  const homeGate = gate(fixture.homeId);
  const awayGate = gate(fixture.awayId);
  teamById(fixture.winnerId).budget += 5000 + (fixture.winnerId === fixture.homeId ? homeGate : awayGate);
  teamById(fixture.loserId).budget += fixture.winnerId === fixture.homeId ? awayGate : homeGate;
}

function ageValueFactor(player) {
  const age = Number(player.Age || 0);
  if (age <= 22) return 1.05;
  if (age <= 27) return 1;
  if (age <= 30) return 0.9;
  return Math.max(0.4, 0.9 - (age - 30) * 0.05);
}

function intrinsicValue(player) {
  const base = Math.max(55, rating(player));
  let value = Math.max(500, Math.round((base - 55) * 800 * ageValueFactor(player)));
  if (base >= 95) value = Math.round(value * 1.45);
  return value;
}

function updatePlayerValues() {
  const leagueChampions = new Set();
  Object.values(state.leagueStandings || {}).forEach((rows) => { if (rows && rows[0]) leagueChampions.add(rows[0].teamId); });
  const cupChampions = new Set();
  LEAGUES.forEach((league) => {
    const final = state.fixtures.find((fixture) => fixture.competition === "cup" && fixture.leagueId === league.id && fixture.round === "Final");
    if (final?.winnerId) cupChampions.add(final.winnerId);
  });
  const euroChampionId = state.euroCupResult?.champion?.id || null;
  const wcResults = state.worldCupResults || [];
  const lastWc = state.worldCupPlayedYear === state.seasonYear ? wcResults[wcResults.length - 1] || null : null;
  const wcChampionPlayerIds = new Set();
  (lastWc?.championSources || []).forEach((source) => {
    state.players.forEach((player) => {
      if (player.PlayerID === source.playerId && (player.Nationality || "").toLowerCase() === source.nationality) wcChampionPlayerIds.add(player.PlayerID);
    });
  });
  const activePool = (pos) => state.players.filter((p) => p.Position === pos && p.TeamID !== "FREE" && Number(p.appearances || 0) > 0);
  const avgRateByPosition = {};
  const topPlayers = new Set();
  ["Chaser", "Beater", "Keeper", "Seeker"].forEach((pos) => {
    const pool = activePool(pos);
    avgRateByPosition[pos] = pool.length ? pool.reduce((sum, p) => sum + positionRate(p), 0) / pool.length : 0;
    pool.slice().sort((a, b) => positionRate(b) - positionRate(a)).slice(0, Math.max(1, Math.floor(pool.length * 0.2))).forEach((p) => topPlayers.add(p.PlayerID));
  });
  state.players.forEach((player) => {
    const apps = Number(player.appearances || 0);
    let factor = 0;
    if (apps) {
      const avgRate = avgRateByPosition[player.Position] || 0;
      factor = clamp(positionRate(player) / Math.max(0.1, avgRate) - 1, -1, 1) * 0.5;
    }
    if (leagueChampions.has(player.TeamID)) factor += 0.15;
    if (cupChampions.has(player.TeamID)) factor += 0.1;
    if (player.TeamID === euroChampionId) factor += 0.15;
    if (wcChampionPlayerIds.has(player.PlayerID)) factor += 0.12;
    if (topPlayers.has(player.PlayerID)) factor += 0.08;
    factor += 0.12 * Number(player.reputation || 0);
    factor += 0.18 * Number(player.intlReputation || 0);
    factor += 0.12 * Number(player.worldCupTitles || 0);
    factor += 0.05 * Number(player.celebrity || 0);
    factor = clamp(factor, -0.6, 2.5);
    const target = intrinsicValue(player) * (1 + factor);
    const current = Number(player["Value(G)"] || 0);
    const updated = Math.max(400, Math.round(current * 0.65 + target * 0.35));
    player["Value(G)"] = updated;
    player["ReleaseClause(G)"] = Math.max(Math.round(updated * 1.8), 2000);
  });
}

function developmentDelta(player) {
  const age = Number(player.Age || 0);
  const apps = Math.min(14, Number(player.appearances || 0));
  let base = 0;
  if (age <= 21) base = 2.0 + (21 - age) * 0.32;
  else if (age === 22) base = 0.7;
  else if (age === 23) base = 0.5;
  else if (age === 24) base = 0.3;
  else if (age <= 27) base = (Math.random() - 0.38) * 0.6;
  else if (age <= 30) base = -0.3;
  else base = -0.3 - (age - 30) * 0.4;
  const playFactor = 0.6 + 0.4 * (apps / 12);
  const rnd = (Math.random() - 0.5) * 0.8;
  return clamp(Math.round(base * playFactor + rnd), -3, 3);
}

function renewalSalary(player) {
  const current = Number(player["Salary(G/week)"] || 0) || 200;
  const age = Number(player.Age || 0);
  const market = Math.round(playerValue(player) / 90);
  const growth = age >= 34 ? 0.92 : age >= 30 ? 1.02 : 1.08;
  const hardCap = age >= 34 ? Math.round(current * 0.95) : age >= 30 ? Math.round(current * 1.05) : Math.round(current * 1.15);
  const capped = Math.min(market, hardCap);
  const base = Math.round(current * growth);
  const young = age < 30 ? Math.max(base, Math.round(current)) : base;
  return Math.round(Math.min(Math.max(young, Math.round(market * 0.6)), capped));
}

function releaseToMarket(player) {
  if (isCareerPlayer(player)) return;
  const oldTeam = player.TeamID;
  player.TeamID = "FREE";
  player.listed = true;
  player.ContractYears = 0;
  Object.keys(state.selectedLineups || {}).forEach((teamId) => {
    if (teamId === oldTeam) state.selectedLineups[teamId] = (state.selectedLineups[teamId] || []).map((id) => (id === player.PlayerID ? null : id));
  });
  pushFeed(`${player.Name} queda libre en el mercado.`, `${player.Name} queda libre en el mercado.`);
}

function releaseYouthToMarket(targetState, countForLeague, matchLeagueId) {
  const targetId = matchLeagueId || targetState.leagueId;
  if (!Array.isArray(targetState.youthReleased)) targetState.youthReleased = [];
  const releasedHere = [];
  LEAGUES.forEach((league) => {
    const available = (YOUTH_POOL[league.id] || []).filter((row) => !targetState.youthReleased.includes(`${league.id}-${row.PlayerID}`));
    if (!available.length) return;
    const count = Math.min(countForLeague, available.length);
    const chosen = available.slice().sort(() => Math.random() - 0.5).slice(0, count);
    chosen.forEach((row) => {
      const id = `${league.id}-${row.PlayerID}`;
      targetState.youthReleased.push(id);
      targetState.players.push(makePlayer({ ...row, leagueId: league.id, PlayerID: id, TeamID: "FREE" }, "market"));
      if (league.id === targetId) releasedHere.push(row.Name);
    });
  });
  return releasedHere;
}

function retirementProbability(player) {
  const age = Number(player.Age || 0);
  if (age < 34) return 0;
  const base = age >= 40 ? 0.88 : [0.1, 0.18, 0.28, 0.42, 0.58, 0.72][age - 34];
  const starFactor = Number(player.OVR || 0) >= 90 ? 0.5 : 1;
  return base * starFactor;
}

function retirePlayer(player) {
  if (isCareerPlayer(player)) return;
  const clubRef = player.TeamID === "FREE" ? null : teamName(player.TeamID);
  const fromManager = player.TeamID === state.managerTeamId;
  state.players = state.players.filter((p) => p.PlayerID !== player.PlayerID);
  Object.keys(state.selectedLineups || {}).forEach((teamId) => {
    state.selectedLineups[teamId] = (state.selectedLineups[teamId] || []).map((id) => (id === player.PlayerID ? null : id));
  });
  pushFeed(fromManager
    ? `${"Tu jugador"} ${player.Name} ${"se retira a los"} ${player.Age} ${"años"} ${"tras una gran carrera"}${clubRef ? ` ${"en"} ${clubRef}` : ""}.`
    : `${player.Name} ${"se retira a los"} ${player.Age} ${"años"}${clubRef ? ` ${"tras su etapa en"} ${clubRef}` : ""}.`, fromManager
    ? `${"Your player"} ${player.Name} ${"retires at"} ${player.Age} ${"years"} ${"after a great career"}${clubRef ? ` ${"at"} ${clubRef}` : ""}.`
    : `${player.Name} ${"retires at"} ${player.Age} ${"years"}${clubRef ? ` ${"after his spell at"} ${clubRef}` : ""}.`);
}

function endOfSeasonProcessing() {
  const changes = [];
  const retiring = [];
  state.players.forEach((player) => {
    player.Age = Number(player.Age || 0) + 1;
    if (isCareerPlayer(player)) {
      player.ContractYears = Math.max(1, Number(player.ContractYears ?? 0));
      const delta = developmentDelta(player);
      if (delta !== 0) {
        changes.push(`${player.Name} ${delta > 0 ? "+" + delta + " OVR" : delta + " OVR"}`);
        player.OVR = clamp(Number(player.OVR || 0) + delta, 40, 99);
        player.Value1 = clamp(Number(player.Value1 || 0) + delta, 40, 99);
        player.Value2 = clamp(Number(player.Value2 || 0) + delta, 40, 99);
      }
      return;
    }
    const delta = developmentDelta(player);
    if (delta !== 0) {
      changes.push(`${player.Name} ${delta > 0 ? "+" + delta + " OVR" : delta + " OVR"}`);
      player.OVR = clamp(Number(player.OVR || 0) + delta, 40, 99);
      player.Value1 = clamp(Number(player.Value1 || 0) + delta, 40, 99);
      player.Value2 = clamp(Number(player.Value2 || 0) + delta, 40, 99);
    }
    if (Math.random() < retirementProbability(player)) {
      retiring.push(player);
      return;
    }
    if (player.TeamID === "FREE") { player.ContractYears = 0; return; }
    player.ContractYears = Math.max(0, Number(player.ContractYears ?? 0) - 1);
    if (player.ContractYears > 0) return;
    if (player.TeamID === state.managerTeamId) {
      pushFeed(`${player.Name} no ha renovado y queda libre en el mercado.`, `${player.Name} no ha renovado y queda libre en el mercado.`);
      releaseToMarket(player);
      return;
    }
    const salary = renewalSalary(player);
    const team = teamById(player.TeamID);
    const renew = team && Number(team.budget || 0) >= 0 && team.budget > salary * 8 && Math.random() < 0.9;
    if (renew) {
      player.ContractYears = 2 + Math.floor(Math.random() * 3);
      player["Salary(G/week)"] = salary;
    } else {
      releaseToMarket(player);
    }
  });
  retiring.forEach((player) => retirePlayer(player));
  if (changes.length) pushFeed(`Fin de temporada: ${changes.filter((item) => item.includes("+")).length} jugadores suben de nivel y ${changes.filter((item) => item.includes("-")).length} bajan.`, `Fin de temporada: ${changes.filter((item) => item.includes("+")).length} jugadores suben de nivel y ${changes.filter((item) => item.includes("-")).length} bajan.`);
}

function renewContract(playerId, years = 3) {
  const player = state.players.find((p) => p.PlayerID === playerId);
  if (!player || player.TeamID !== state.managerTeamId) return;
  const manager = teamById(state.managerTeamId);
  if (manager && Number(manager.budget || 0) < 0) {
    pushFeed(`${"No puedes renovar a"} ${player.Name}: ${"tu club está en números negativos."}`, `${"You cannot renew"} ${player.Name}: ${"your club is in the red."}`);
    saveAndRender();
    return;
  }
  const newSalary = renewalSalary(player);
  player.ContractYears = years;
  player["Salary(G/week)"] = newSalary;
  pushFeed(`${"Has renovado a"} ${player.Name} ${"por"} ${years} ${"años"} (${money(newSalary)}/${"sem"}).`, `${"You have renewed"} ${player.Name} ${"for"} ${years} ${"years"} (${money(newSalary)}/${"wk"}).`);
  saveAndRender();
}

function shieldSlotsUsed() {
  return state.players.filter((p) => p.TeamID === state.managerTeamId && isShielded(p)).length;
}

function shieldPlayer(playerId) {
  const player = state.players.find((p) => p.PlayerID === playerId);
  if (!player || player.TeamID !== state.managerTeamId || isShielded(player)) return;
  if (shieldSlotsUsed() >= 2) {
    pushFeed("Ya tienes 2 jugadores blindados esta temporada: quita o espera al final de temporada para blindar a otro.", "Ya tienes 2 jugadores blindados esta temporada: quita o espera al final de temporada para blindar a otro.");
    saveAndRender();
    return;
  }
  player.shieldedUntil = shieldEndDate();
  player["Salary(G/week)"] = Math.round(Number(player["Salary(G/week)"] || 0) * 1.1);
  pushFeed(`${player.Name} queda blindado frente a compras hasta el ${formatDate(player.shieldedUntil, true)}. Su salario sube un 10% (${money(player["Salary(G/week)"])}/sem).`, `${player.Name} queda blindado frente a compras hasta el ${formatDate(player.shieldedUntil, true)}. Su salario sube un 10% (${money(player["Salary(G/week)"])}/sem).`);
  saveAndRender();
}

function computeStandings(teams, fixtures) {
  const rows = teams.map((team) => ({ teamId: team.TeamID, name: team.Name, played: 0, wins: 0, draws: 0, losses: 0, for: 0, against: 0, diff: 0, points: 0 }));
  const byTeam = Object.fromEntries(rows.map((row) => [row.teamId, row]));
  fixtures.filter((fixture) => fixture.played).forEach((fixture) => {
    const home = byTeam[fixture.homeId];
    const away = byTeam[fixture.awayId];
    if (!home || !away) return;
    home.played += 1; away.played += 1;
    home.for += fixture.homeScore; home.against += fixture.awayScore;
    away.for += fixture.awayScore; away.against += fixture.homeScore;
    if (fixture.homeScore > fixture.awayScore) { home.wins += 1; away.losses += 1; home.points += 3; }
    else if (fixture.homeScore < fixture.awayScore) { away.wins += 1; home.losses += 1; away.points += 3; }
    else { home.draws += 1; away.draws += 1; home.points += 1; away.points += 1; }
  });
  rows.forEach((row) => { row.diff = row.for - row.against; });
  return rows.sort((a, b) => b.points - a.points || b.diff - a.diff || b.for - a.for || a.name.localeCompare(b.name));
}

function recalcStandings(targetState) {
  const leagueIds = [...new Set(targetState.teams.map((team) => team.leagueId).filter(Boolean))];
  targetState.leagueStandings = {};
  leagueIds.forEach((lid) => {
    const teams = targetState.teams.filter((team) => team.leagueId === lid);
    const fixtures = targetState.fixtures.filter((fixture) => fixture.competition === "league" && fixture.leagueId === lid);
    targetState.leagueStandings[lid] = computeStandings(teams, fixtures);
  });
  targetState.standings = targetState.leagueStandings[targetState.leagueId] || [];
}

function managerStanding() {
  const index = state.standings.findIndex((row) => row.teamId === state.managerTeamId);
  return index >= 0 ? { ...state.standings[index], position: index + 1 } : { position: 0, points: 0, played: 0, diff: 0 };
}
function competitionLabel(fixture) {
  if (fixture.competition === "cup") return cupShortName();
  return COMPETITIONS[fixture.competition] || "Partido";
}

function nextManagerFixture(includeToday = true) {
  if (!state.managerTeamId) return null;
  return state.fixtures.filter((fixture) => !fixture.played).filter((fixture) => includeToday ? fixture.date >= state.currentDate : fixture.date > state.currentDate).filter((fixture) => fixture.homeId === state.managerTeamId || fixture.awayId === state.managerTeamId).filter((fixture) => !String(fixture.homeId).startsWith("@") && !String(fixture.awayId).startsWith("@")).sort(sortFixtures)[0] || null;
}

function fixturesOn(date) {
  return state.fixtures.filter((fixture) => !fixture.played && fixture.date === date).filter((fixture) => fixture.homeId && fixture.awayId).filter((fixture) => !String(fixture.homeId).startsWith("@") && !String(fixture.awayId).startsWith("@"));
}

function nextPlayableDate() {
  const nextFixture = state.fixtures.filter((fixture) => !fixture.played && fixture.date >= state.currentDate).filter((fixture) => fixture.homeId && fixture.awayId).filter((fixture) => !String(fixture.homeId).startsWith("@") && !String(fixture.awayId).startsWith("@")).sort(sortFixtures)[0];
  return nextFixture?.date || seasonFinish(state.seasonYear);
}

function simulateNonManagerMatchesOnDate(date) {
  fixturesOn(date).filter((fixture) => autoSim() || (fixture.homeId !== state.managerTeamId && fixture.awayId !== state.managerTeamId)).forEach((fixture) => {
    simulateMatch(fixture);
    pushFeed(`${formatDate(date, true)} · ${competitionLabel(fixture)}: ${teamName(fixture.homeId)} ${fixture.homeScore}-${fixture.awayScore} ${teamName(fixture.awayId)}`, `${formatDate(date, true)} · ${competitionLabel(fixture)}: ${teamName(fixture.homeId)} ${fixture.homeScore}-${fixture.awayScore} ${teamName(fixture.awayId)}`, fixtureFeedScope(fixture));
  });
  resolveCupFinal();
  completeCupIfDone();
  resolveBackgroundCupFinals();
  completeBackgroundCups();
  resolveEuroCupBracket();
  completeEuroCupIfDone();
  resolveChampionsCupBracket();
  completeChampionsCupIfDone();
  resolveWorldCupBracket();
  finishWorldCupIfDone();
}

function payWeeklySalaries() {
  const week = Math.floor(daysBetween(seasonStart(state.seasonYear), state.currentDate) / 7);
  const key = `${state.seasonYear}-${week}`;
  if (state.paidWeeks.includes(key)) return;
  state.teams.forEach((team) => {
    const payroll = playersFor(team.TeamID).reduce((sum, player) => sum + Number(player["Salary(G/week)"] || 0), 0);
    team.budget -= payroll;
  });
  state.paidWeeks.push(key);
  stabilizeAiFinances();
  guaranteeAISquads();
}

function guaranteeAISquads() {
  state.teams.filter((team) => state.careerMode || !isHumanTeam(team.TeamID)).forEach((team) => {
    if (!lineupIssue(team.TeamID, state).ok) {
      rebalanceSquad(team);
      if (team.TeamID === state.managerTeamId && !lineupIssue(team.TeamID, state).ok) {
        state.selectedLineups[team.TeamID] = defaultLineup(playersFor(team.TeamID));
      }
    }
  });
}

function teamPayroll(teamId) {
  return playersFor(teamId).reduce((sum, player) => sum + Number(player["Salary(G/week)"] || 0), 0);
}

function aiRecoveryNeeded(team) {
  if (isHumanTeam(team.TeamID)) return false;
  const budget = Number(team.budget || 0);
  return budget < 0 || budget < teamPayroll(team.TeamID) * 4;
}

function cheapestFreeAgent(leagueId, position) {
  const pool = state.players
    .filter((player) => player.TeamID === "FREE" && player.leagueId === leagueId && (position === null || player.Position === position))
    .sort((a, b) => Number(a["Salary(G/week)"] || 0) - Number(b["Salary(G/week)"] || 0) || rating(b) - rating(a));
  return pool[0];
}

function rebalanceSquad(team) {
  const demands = { Chaser: 3, Beater: 2, Keeper: 1, Seeker: 1 };
  for (let guard = 0; guard < 20; guard += 1) {
    const squad = playersFor(team.TeamID);
    const counts = { Chaser: 0, Beater: 0, Keeper: 0, Seeker: 0 };
    squad.filter((player) => !player.injured).forEach((player) => { const key = player.Position; if (key in counts) counts[key] += 1; });
    const under = Object.keys(demands).find((position) => counts[position] < demands[position]);
    if (!under) break;
    const over = Object.keys(demands).find((position) => counts[position] > demands[position]);
    if (over) {
      const surplus = squad.filter((player) => player.Position === over && !isShielded(player)).sort((a, b) => Number(b["Salary(G/week)"]) - Number(a["Salary(G/week)"]) || rating(b) - rating(a))[0];
      if (!surplus) break;
      const value = offloadPlayer(surplus);
      const replacement = affordableFreeAgent(team, under) || affordableFreeAgent(team, null);
      if (!replacement) break;
      const price = buyPrice(replacement);
      if (completeTransfer(replacement, team.TeamID, price, `${team.Name} ajusta su plantilla: traspasa a ${surplus.Name} (${money(value)}) y ficha a ${replacement.Name} por ${money(price)}.`)) continue;
    } else {
      const replacement = affordableFreeAgent(team, under) || affordableFreeAgent(team, null);
      if (!replacement) break;
      const price = buyPrice(replacement);
      if (completeTransfer(replacement, team.TeamID, price, `${team.Name} ${_("ficha a", "signs")} ${replacement.Name} ${_("por", "for")} ${money(price)} ${_("por necesidad económica.", "out of financial need.")}`)) continue;
    }
  }
}

function stabilizeAiFinances() {
  state.teams.filter(aiRecoveryNeeded).forEach((team) => {
    // 1) Vende suplentes caros fuera de lo imprescindible (once + 2 recambios)
    const lineup = state.selectedLineups[team.TeamID] || [];
    const keepCount = REQUIRED_SLOTS.length + 2;
    const candidates = playersFor(team.TeamID)
      .filter((player) => !isShielded(player))
      .map((player) => ({ player, starter: lineup.includes(player.PlayerID), salary: Number(player["Salary(G/week)"] || 0) }))
      .sort((a, b) => (a.starter ? 1 : 0) - (b.starter ? 1 : 0) || b.salary - a.salary);
    while (candidates.length && playersFor(team.TeamID).length > keepCount) {
      const candidate = candidates.shift();
      if (!candidate || candidate.starter) break;
      const value = offloadPlayer(candidate.player);
      pushFeed(`${team.Name} vende a ${candidate.player.Name} (${money(value)}) para ajustar sus finanzas.`, `${team.Name} vende a ${candidate.player.Name} (${money(value)}) para ajustar sus finanzas.`);
    }
    // 2) Si sigue en números rojos, cambia al jugador más caro por un suplente más barato
    let guard = 0;
    while (aiRecoveryNeeded(team) && guard < 6 && playersFor(team.TeamID).length > REQUIRED_SLOTS.length) {
      guard += 1;
      const expensive = playersFor(team.TeamID)
        .filter((player) => !isShielded(player))
        .sort((a, b) => Number(b["Salary(G/week)"] || 0) - Number(a["Salary(G/week)"] || 0))[0];
      if (!expensive) break;
      if (playersFor(team.TeamID).some((player) => player.PlayerID !== expensive.PlayerID && player.Position === expensive.Position)) {
        const value = offloadPlayer(expensive);
        pushFeed(`${team.Name} traspasa a ${expensive.Name} (${money(value)}) por un jugador con menor salario.`, `${team.Name} traspasa a ${expensive.Name} (${money(value)}) por un jugador con menor salario.`);
      } else if (cheapestFreeAgent(team.leagueId, expensive.Position)) {
        const value = offloadPlayer(expensive);
        pushFeed(`${team.Name} ${"traspasa a"} ${expensive.Name} (${money(value)}) ${"y ficha un sustituto más barato."}`, `${team.Name} ${"transfers"} ${expensive.Name} (${money(value)}) ${"and signs a cheaper replacement."}`);
      } else break;
    }
    // 3) Garantiza un once legal (por posición) con jugadores baratos
    rebalanceSquad(team);
    // 4) Rescate de deuda: los clubes insalvables vuelven a ser viables
    if ((Number(team.budget || 0) < 0 || Number(team.budget || 0) < teamPayroll(team.TeamID)) && team.debtRescuedFor !== state.seasonYear) {
      const grant = Math.max(18000, Math.ceil(teamPayroll(team.TeamID) * 20));
      team.budget = grant;
      team.debtRescuedFor = state.seasonYear;
      pushFeed(`${team.Name} reestructura su deuda con un plan de rescate del club: vuelve a operar con ${money(grant)} de presupuesto.`, `${team.Name} reestructura su deuda con un plan de rescate del club: vuelve a operar con ${money(grant)} de presupuesto.`);
    }
    if (team.TeamID === state.managerTeamId) return;
    state.selectedLineups[team.TeamID] = legalLineup(team.TeamID, state.selectedLineups[team.TeamID] || [], false);
  });
}

function marketActivity() {
  if (state.worldCup) return;
  const dateSeed = daysBetween(seasonStart(state.seasonYear), state.currentDate);
  if (dateSeed % 5 !== 0 && Math.random() > 0.09) return;
  const aiTeams = state.teams.filter((team) => !isHumanTeam(team.TeamID) && team.leagueId === state.leagueId);
  aiTeams.forEach((team) => {
    if (playersFor(team.TeamID).filter((player) => isShielded(player)).length >= 2) return;
    if (Math.random() > 0.045) return;
    const lineup = state.selectedLineups[team.TeamID] || [];
    const candidates = playersFor(team.TeamID)
      .filter((player) => !player.listed && !isShielded(player) && Number(player.ContractYears ?? 0) >= 1)
      .map((player) => ({ player, value: rating(player), wage: Math.round(Number(player["Salary(G/week)"] || 0) * 1.1) }))
      .filter((candidate) => (lineup.includes(candidate.player.PlayerID) || candidate.value >= 82) && Number(team.budget || 0) >= candidate.wage * 8)
      .sort((a, b) => b.value - a.value);
    const top = candidates[0];
    if (!top) return;
    const player = top.player;
    if (Number(team.budget || 0) < top.wage * 10) return;
    player.shieldedUntil = shieldEndDate();
    player["Salary(G/week)"] = top.wage;
    pushFeed(`${team.Name} ${"blinda a"} ${player.Name} ${"hasta"} ${formatDate(player.shieldedUntil, true)}: ${"se compromete a pagarle un 10% más y no podrá venderlo esta temporada."}`, `${team.Name} ${"shields"} ${player.Name} ${"until"} ${formatDate(player.shieldedUntil, true)}: ${"commits to paying him 10% more and cannot sell him this season."}`);
  });
  if (Math.random() < 0.5) {
    const sellers = aiTeams.map((team) => playersFor(team.TeamID).filter((player) => !player.listed && !isShielded(player) && !state.selectedLineups[team.TeamID]?.includes(player.PlayerID))).flat();
    const player = sellers[Math.floor(Math.random() * sellers.length)];
    if (player) { player.listed = true; pushFeed(`${teamName(player.TeamID)} pone a ${player.Name} en el mercado.`, `${teamName(player.TeamID)} pone a ${player.Name} en el mercado.`); }
    return;
  }
  const buyers = aiTeams.filter((team) => team.budget > 6000 && Number(team.budget || 0) > teamPayroll(team.TeamID) * 6);
  const buyer = buyers[Math.floor(Math.random() * buyers.length)];
  const pool = state.players.filter((player) => player.leagueId === state.leagueId && player.TeamID !== buyer?.TeamID && !isShielded(player) && Number(buyer?.budget || 0) - buyPrice(player) > teamPayroll(buyer?.TeamID || "FREE") * 6 && (player.TeamID === "FREE" || player.listed || Math.random() < 0.05));
  const target = pool.sort((a, b) => rating(b) - rating(a))[Math.floor(Math.random() * Math.min(8, pool.length))];
  if (!buyer || !target) return;
  const price = buyPrice(target);
  if (buyer.budget < price || price <= 0) return;
  completeTransfer(target, buyer.TeamID, price, `${buyer.Name} ficha a ${target.Name}${target.TeamID === state.managerTeamId ? " desde tu equipo" : ""}.`);
}

function completeTransfer(player, buyerId, price, feedMessage) {
  if (!player || isCareerPlayer(player) || isShielded(player) || player.TeamID === buyerId) return false;
  const oldTeamId = player.TeamID;
  const buyer = teamById(buyerId);
  if (!buyer || buyer.budget < price) return false;
  const wasClause = oldTeamId !== "FREE" && !player.listed;
  buyer.budget -= price;
  if (oldTeamId !== "FREE") teamById(oldTeamId).budget += price;
  player.TeamID = buyerId;
  player.leagueId = buyer ? buyer.leagueId : player.leagueId;
  player.listed = false;
  player.ContractYears = Math.max(2, Number(player.ContractYears || 0));
  if (wasClause) player.clauseLockUntil = addDays(state.currentDate, 61);
  state.selectedLineups[buyerId] = isHumanTeam(buyerId) ? (state.selectedLineups[buyerId] || []) : legalLineup(buyerId, state.selectedLineups[buyerId] || [], false);
  if (oldTeamId && oldTeamId !== "FREE") {
    if (isHumanTeam(oldTeamId)) {
      const lineup = state.selectedLineups[oldTeamId] || [];
      if (lineup.includes(player.PlayerID)) state.selectedLineups[oldTeamId] = lineup.map((id) => (id === player.PlayerID ? null : id));
    } else {
      state.selectedLineups[oldTeamId] = legalLineup(oldTeamId, state.selectedLineups[oldTeamId] || [], false);
    }
  }
  pushFeed(feedMessage, feedMessage);
  return true;
}

function awardLeagueTitle() {
  const top = state.standings[0];
  if (top && !state.leagueTitleAwardedFor) {
    const team = teamById(top.teamId);
    if (team) team.leagueTitles += 1;
    state.championsByLeague = state.championsByLeague || {};
    state.championsByLeague[state.leagueId] = top.teamId;
    state.leagueTitleAwardedFor = state.seasonYear;
  }
  state.standings.forEach((row, index) => {
    const team = teamById(row.teamId);
    if (!team) return;
    const prize = leaguePrizeFor(index + 1);
    if (prize) team.budget = Number(team.budget || 0) + prize;
  });
  const managerRow = state.standings.find((row) => row.teamId === state.managerTeamId);
  const managerPosition = managerRow ? state.standings.indexOf(managerRow) + 1 : null;
  const managerPrize = managerRow ? leaguePrizeFor(managerPosition) : 0;
  pushFeed(`Final de la liga: ${state.standings[0]?.name || ""} termina primero. Todos los equipos reciben un premio por puesto.`, `Final de la liga: ${state.standings[0]?.name || ""} termina primero. Todos los equipos reciben un premio por puesto.`);
  if (managerRow && managerPrize) pushFeed(`Premio por puesto (${managerPosition}.º): ${money(managerPrize)} para ${managerRow.name}.`, `Premio por puesto (${managerPosition}.º): ${money(managerPrize)} para ${managerRow.name}.`);
}

function cupFixtures() { return state.fixtures.filter((fixture) => fixture.competition === "cup" && fixture.leagueId === state.leagueId); }
function cupFinal() { return state.fixtures.find((fixture) => fixture.competition === "cup" && fixture.leagueId === state.leagueId && fixture.round === "Final") || null; }
function cupSeededTeams() { return state.standings.slice(0, 4).map((row) => row.teamId); }
function leagueIsFinished() { return !state.fixtures.some((fixture) => fixture.competition === "league" && fixture.leagueId === state.leagueId && !fixture.played); }

function startCupPhase() {
  if (cupFixtures().length) return;
  const year = cupYear();
  const seeds = cupSeededTeams();
  const sf1 = makeFixture({ id: `C${state.seasonYear}-SF1`, date: cupSemiFinal1Date(year), competition: "cup", round: "Semifinal 1", homeId: seeds[0], awayId: seeds[3], leagueId: state.leagueId });
  const sf2 = makeFixture({ id: `C${state.seasonYear}-SF2`, date: cupSemiFinal2Date(year), competition: "cup", round: "Semifinal 2", homeId: seeds[1], awayId: seeds[2], leagueId: state.leagueId });
  const cupFinalFixture = makeFixture({ id: `C${state.seasonYear}-F`, date: cupFinalDate(year), competition: "cup", round: "Final", homeId: null, awayId: null, leagueId: state.leagueId });
  state.fixtures = [...state.fixtures, sf1, sf2, cupFinalFixture].sort(sortFixtures);
  startBackgroundCups(year);
  state.players.forEach((player) => { player.stamina = 100; player.injured = false; player.injuryDays = 0; });
  state.pendingLeagueWrap = false;
  state.currentDate = addDays(cupSemiFinal1Date(year), -1);
  pushFeed(`${cupName()}: ${"el 1º se mide al 4º (5 de agosto) y el 2º al 3º (10 de agosto); la final es el 15 de agosto. El campeón se lleva 150.000 G y el subcampeón 60.000 G."}`, `${cupName()}: ${"1st faces 4th (5 August) and 2nd faces 3rd (10 August); the final is on 15 August. The champion takes 150,000 G and the runner-up 60,000 G."}`);
}

function startChampionsPhase() {
  if (cupFixtures().length) { startCupPhase(); return; }
  setupChampionsCupIfNeeded();
  if (!state.championsCup) { startCupPhase(); return; }
  state.pendingLeagueWrap = false;
  state.currentDate = addDays(championsR1Date(state.seasonYear), -1);
  state.players.forEach((player) => { player.stamina = 100; player.injured = false; player.injuryDays = 0; });
  homeMode = "champions";
  pushFeed(`${"Torneo de Campeones"} ${cupYear()}: ${"los campeones de todas las ligas se miden en el bracket (5, 12, 19 y 26 de julio). Después se jugará la"} ${cupShortName()} ${"en agosto. El campeón entre campeones gana 150.000 G y el subcampeón 60.000 G."}`, `${"Champions Tournament"} ${cupYear()}: ${"the champions of all leagues meet in the bracket (5, 12, 19 and 26 July). Then the"} ${cupShortName()} ${"is played in August. The champion of champions wins 150,000 G and the runner-up 60,000 G."}`);
}

function startBackgroundCups(year) {
  LEAGUES.forEach((league) => {
    if (league.id === state.leagueId) return;
    const seeds = (state.leagueStandings?.[league.id] || []).slice(0, 4).map((row) => row.teamId);
    if (seeds.length < 4) return;
    const sf1 = makeFixture({ id: `BC${state.seasonYear}-${league.id}-SF1`, date: cupSemiFinal1Date(year), competition: "cup", round: "Semifinal 1", homeId: seeds[0], awayId: seeds[3], leagueId: league.id });
    const sf2 = makeFixture({ id: `BC${state.seasonYear}-${league.id}-SF2`, date: cupSemiFinal2Date(year), competition: "cup", round: "Semifinal 2", homeId: seeds[1], awayId: seeds[2], leagueId: league.id });
    const cupFinalFixture = makeFixture({ id: `BC${state.seasonYear}-${league.id}-F`, date: cupFinalDate(year), competition: "cup", round: "Final", homeId: null, awayId: null, leagueId: league.id });
    state.fixtures = [...state.fixtures, sf1, sf2, cupFinalFixture].sort(sortFixtures);
  });
}

function resolveCupFinal() {
  const final = cupFinal();
  if (!final || (final.homeId && final.awayId)) return;
  const semis = state.fixtures.filter((fixture) => fixture.competition === "cup" && fixture.leagueId === state.leagueId && fixture.round.startsWith("Semifinal"));
  if (semis.length !== 2 || semis.some((fixture) => !fixture.played)) return;
  final.homeId = semis[0].winnerId;
  final.awayId = semis[1].winnerId;
  pushFeed(`Final de la ${cupName()}: ${teamName(final.homeId)} vs ${teamName(final.awayId)}, el 15 de agosto.`, `Final de la ${cupName()}: ${teamName(final.homeId)} vs ${teamName(final.awayId)}, el 15 de agosto.`);
}

function resolveCupFinalFor(leagueId) {
  const final = state.fixtures.find((fixture) => fixture.competition === "cup" && fixture.leagueId === leagueId && fixture.round === "Final");
  if (!final || (final.homeId && final.awayId)) return;
  const semis = state.fixtures.filter((fixture) => fixture.competition === "cup" && fixture.leagueId === leagueId && fixture.round.startsWith("Semifinal"));
  if (semis.length !== 2 || semis.some((fixture) => !fixture.played)) return;
  final.homeId = semis[0].winnerId;
  final.awayId = semis[1].winnerId;
}

function resolveBackgroundCupFinals() {
  LEAGUES.forEach((league) => { if (league.id !== state.leagueId) resolveCupFinalFor(league.id); });
}

function completeBackgroundCups() {
  LEAGUES.forEach((league) => {
    if (league.id === state.leagueId || state.backgroundCupsAwarded?.[league.id]) return;
    const final = state.fixtures.find((fixture) => fixture.competition === "cup" && fixture.leagueId === league.id && fixture.round === "Final");
    if (!final || !final.played) return;
    const champion = teamById(final.winnerId);
    if (!champion) return;
    champion.budget += 150000;
    champion.cupTitles = Number(champion.cupTitles || 0) + 1;
    let message = `${league.cupName}: ${champion.Name} ${_("se proclama campeón y gana", "is proclaimed champion and wins")} ${money(150000)}.`;
    const runnerUp = teamById(final.loserId);
    if (runnerUp) { runnerUp.budget += 60000; message += ` ${runnerUp.Name} ${_("es subcampeón y gana", "is runner-up and wins")} ${money(60000)}.`; }
    pushFeed(message, message, "world");
    state.backgroundCupsAwarded = { ...(state.backgroundCupsAwarded || {}), [league.id]: true };
  });
}

function completeCupIfDone() {
  const final = cupFinal();
  if (!final || !final.played || state.cupAwarded) return;
  const champion = teamById(final.winnerId);
  const runnerUp = teamById(final.loserId);
  if (!champion) return;
  champion.budget += 150000;
  champion.cupTitles = Number(champion.cupTitles || 0) + 1;
  let message = `${cupName()}: ${champion.Name} ${_("se proclama campeón y gana", "is proclaimed champion and wins")} ${money(150000)}.`;
  if (runnerUp) { runnerUp.budget += 60000; message += ` ${runnerUp.Name} ${_("es subcampeón y gana", "is runner-up and wins")} ${money(60000)}.`; }
  pushFeed(message, message);
  state.cupAwarded = true;
  state.cupWrapPending = true;
  state.galaPending = true;
  pushFeed(`${"Tras la copa llega la gala: el 20 de agosto se elige al Mejor Jugador de la Temporada de la"} ${leagueInfo().name} ${"(una Escoba de Oro por liga)."}`, `${"After the cup comes the gala: on 20 August the Best Player of the Season of the"} ${leagueInfo().name} ${"(one Golden Broom per league)."}`);
}

function applyWcSquadBonusTo(targetState, sources, effect) {
  if (!sources.length) return [];
  const names = [];
  const claimed = new Set();
  targetState.players.forEach((player) => {
    const playerNat = (player.Nationality || "").toLowerCase();
    const source = sources.find((item) => !claimed.has(item) && item.nationality === playerNat && (
      (item.playerId && item.playerId === player.PlayerID) || (item.name || "").toLowerCase() === (player.Name || "").toLowerCase()
    ));
    if (!source) return;
    claimed.add(source);
    effect(player);
    names.push(player.Name);
  });
  return names;
}

function startWorldCup() {
  stopAdvance();
  const year = worldCupYear();
  const league = clone(state);
  league.worldCup = null;
  state = buildWorldCupState(year, league);
  state.worldCup.league = league;
  state.managerTeamId = autoAssignWorldCupTeam(league);
  if (league.onlineAuto) { state.onlineAuto = true; state.onlineManagers = []; state.managerTeamId = null; }
  activeView = "home";
  selectedTeamId = null;
  marketTab = "buy";
  confirmReset = false;
  const assigned = teamById(state.managerTeamId);
  pushFeed(`${"Copa del Mundo de Quidditch"} ${year}: ${"diriges a"} ${assigned ? assigned.Name : "una selección"} ${"(asignada por el país de tu club)."}`, `${"Quidditch World Cup"} ${year}: ${"you manage"} ${assigned ? assigned.Name : "a national team"} ${"(assigned by your club's country)."}`, "world");
  saveAndRender();
}

function autoAssignWorldCupTeam(league) {
  const club = (league?.teams || []).find((team) => team.TeamID === league?.managerTeamId);
  const clubCountry = ((club?.Country || "").trim().toLowerCase());
  const wcTeams = state.teams.slice().sort((a, b) => computedTeamOVR(b) - computedTeamOVR(a));
  const byCountry = (team) => (team.Country || "").trim().toLowerCase();
  if (clubCountry) {
    const direct = wcTeams.find((team) => byCountry(team) === clubCountry);
    if (direct) return direct.TeamID;
  }
  const leagueCountries = new Set(leagueById(league?.leagueId || "BR").Teams.map((team) => (team.Country || "").trim().toLowerCase()));
  const fromLeague = wcTeams.find((team) => leagueCountries.has(byCountry(team)));
  if (fromLeague) return fromLeague.TeamID;
  return wcTeams[0].TeamID;
}

function teamByName(teamId) { return teamById(teamId) || { Name: "Selección" }; }

function worldCupFinalFixture() { return state.worldCup ? state.fixtures.find((fixture) => fixture.competition === "worldcup" && fixture.round === "Final") || null : null; }

function finishWorldCupIfDone() {
  if (!state.worldCup || state.worldCup.done) return;
  const final = worldCupFinalFixture();
  if (!final || !final.played) return;
  const year = state.seasonYear;
  const champion = final.winnerId ? teamById(final.winnerId) : null;
  const runnerUp = final.loserId ? teamById(final.loserId) : null;
  const thirdFixture = state.fixtures.find((fixture) => fixture.competition === "worldcup" && fixture.round === "Tercer puesto");
  const third = thirdFixture?.winnerId ? teamById(thirdFixture.winnerId) : null;
  const wcFeed = state.feed.slice(0, 24);
  const groups = JSON.parse(JSON.stringify(wcGroupTables(state)));
  const championSources = champion ? (state.teams.find((t) => t.TeamID === champion.TeamID) || {}).squadSources || [] : [];
  const runnerUpSources = runnerUp ? (state.teams.find((t) => t.TeamID === runnerUp.TeamID) || {}).squadSources || [] : [];
  const thirdSources = third ? (state.teams.find((t) => t.TeamID === third.TeamID) || {}).squadSources || [] : [];
  const result = { year, champion: champion ? { id: champion.TeamID, name: champion.Name } : null, runnerUp: runnerUp ? { id: runnerUp.TeamID, name: runnerUp.Name } : null, third: third ? { id: third.TeamID, name: third.Name } : null, groups, championSources };
  const league = state.worldCup.league || buildInitialState(state.managerTeamId);
  league.currentDate = addDays(wcFinalDate(year), 1);
  league.worldCupResults = league.worldCupResults || [];
  league.worldCupResults.push(result);
  league.worldCupPlayedYear = year - 1;
  league.worldCup = null;
  league.pendingLeagueWrap = true;
  league.feed = [...wcFeed, ...league.feed].slice(0, 24);
  const boosted = [];
  const boostedRunners = [];
  const boostedThird = [];
  applyWcSquadBonusTo(league, championSources, (player) => {
    player.worldCupTitles = Number(player.worldCupTitles || 0) + 1;
    player.OVR = clamp(Number(player.OVR || 0) + 1, 40, 99);
    player.form = 100;
    player.morale = 100;
    boosted.push(player.Name);
  });
  applyWcSquadBonusTo(league, runnerUpSources, (player) => {
    player.form = Math.max(Number(player.form || 0), 90);
    player.morale = Math.max(Number(player.morale || 0), 90);
    boostedRunners.push(player.Name);
  });
  applyWcSquadBonusTo(league, thirdSources, (player) => {
    player.form = Math.max(Number(player.form || 0), 85);
    player.morale = Math.max(Number(player.morale || 0), 85);
    boostedThird.push(player.Name);
  });
  league.feed.unshift({ text: `${champion ? champion.Name : "—"} ${_("se proclama campeón del mundo de Quidditch", "is proclaimed Quidditch world champion")} ${year}.${champion && league.managerTeamId && state.managerTeamId && champion.TeamID === state.managerTeamId ? ` ${_("¡Tu selección es la campeona!", "Your national team are the champions!")}` : ""}`, scope: "world" });
  if (boosted.length) league.feed.unshift({ es: `Los campeones del mundo ${champion.Name} vuelven a sus clubes con la moral por las nubes (+1 OVR, forma y moral al 100): ${boosted.length} jugadores.`, en: `The world champions ${champion.Name} return to their clubs with morale through the roof (+1 OVR, form and morale at 100): ${boosted.length} players.`, scope: "world" });
  if (boostedRunners.length) league.feed.unshift({ es: `Los subcampeones del mundo ${runnerUp.Name} vuelven a sus clubes con la moral alta (forma y moral al 90): ${boostedRunners.length} jugadores.`, en: `The world runners-up ${runnerUp.Name} return to their clubs with high morale (form and morale at 90): ${boostedRunners.length} players.`, scope: "world" });
  if (boostedThird.length) league.feed.unshift({ es: `Los bronces del mundial ${third.Name} vuelven a sus clubes motivados (forma y moral al 85): ${boostedThird.length} jugadores.`, en: `The world bronze medallists ${third.Name} return to their clubs motivated (form and morale at 85): ${boostedThird.length} players.`, scope: "world" });
  if (league.careerMode && league.career) {
    league.career.lastMatch = null;
    league.career.wcFinalModal = true;
    if (state.career) {
      league.career.wc = state.career.wc || league.career.wc || null;
      league.career.money = Number(state.career.money ?? league.career.money ?? 0);
      league.career.lifetimeEarned = Number(state.career.lifetimeEarned ?? league.career.lifetimeEarned ?? 0);
      league.career.lifetimeSpent = Number(state.career.lifetimeSpent ?? league.career.lifetimeSpent ?? 0);
      league.career.moneyWeek = Number(state.career.moneyWeek ?? league.career.moneyWeek ?? -1);
      league.career.playerOfMatch = Number(state.career.playerOfMatch ?? league.career.playerOfMatch ?? 0);
      const wcRoster = state.players.find((p) => p.sourcePlayerId === league.career.wc?.playerId);
      const clubPlayer = league.careerPlayerId ? league.players.find((p) => p.PlayerID === league.careerPlayerId) : null;
      if (wcRoster && clubPlayer) {
        clubPlayer.form = Math.max(Number(clubPlayer.form || 70), Number(wcRoster.form || 70));
        clubPlayer.morale = Math.max(Number(clubPlayer.morale || 70), Number(wcRoster.morale || 70));
        clubPlayer["Value(G)"] = Math.max(Number(clubPlayer["Value(G)"] || 0), Number(wcRoster["Value(G)"] || 0));
      }
    }
    if (league.career.wc) {
      league.career.wc.final = { year, champion: champion ? { id: champion.TeamID, name: champion.Name } : null, championed: champion ? champion.TeamID === league.career.wc.teamId : false, runnerUp: runnerUp ? { id: runnerUp.TeamID, name: runnerUp.Name } : null, third: third ? { id: third.TeamID, name: third.Name } : null };
      league.career.wc.result = { year, champion: champion ? { id: champion.TeamID, name: champion.Name } : null, championed: champion ? champion.TeamID === league.career.wc.teamId : false, runnerUp: runnerUp ? { id: runnerUp.TeamID, name: runnerUp.Name } : null, third: third ? { id: third.TeamID, name: third.Name } : null };
    }
  }
  league.wcFinalModal = true;
  state = league;
  saveAndRender();
}

function euroCupFixtures() { return state.fixtures.filter((fixture) => fixture.competition === "eurocup"); }
function euroFinalFixture() { return state.fixtures.find((fixture) => fixture.competition === "eurocup" && fixture.round === "Final") || null; }

function euroGroupTables(targetState = state) {
  const fixtures = targetState.fixtures.filter((fixture) => fixture.competition === "eurocup" && fixture.round.startsWith("Grupo"));
  const tables = {};
  EURO_GROUPS.forEach((letter) => {
    const units = targetState.teams.filter((team) => (targetState.euroCup?.groups?.[letter] || []).includes(team.TeamID));
    const rows = units.map((team) => ({ teamId: team.TeamID, name: team.Name, played: 0, wins: 0, draws: 0, losses: 0, for: 0, against: 0, diff: 0, points: 0 }));
    const byTeam = Object.fromEntries(rows.map((row) => [row.teamId, row]));
    fixtures.filter((fixture) => (targetState.euroCup?.groups?.[letter] || []).includes(fixture.homeId)).forEach((fixture) => {
      const home = byTeam[fixture.homeId];
      const away = byTeam[fixture.awayId];
      if (!home || !away || !fixture.played) return;
      home.played += 1; away.played += 1;
      home.for += fixture.homeScore; home.against += fixture.awayScore;
      away.for += fixture.awayScore; away.against += fixture.homeScore;
      if (fixture.homeScore > fixture.awayScore) { home.wins += 1; away.losses += 1; home.points += 3; }
      else if (fixture.homeScore < fixture.awayScore) { away.wins += 1; home.losses += 1; away.points += 3; }
      else { home.draws += 1; away.draws += 1; home.points += 1; away.points += 1; }
    });
    rows.forEach((row) => { row.diff = row.for - row.against; });
    tables[letter] = rows.sort((a, b) => b.points - a.points || b.diff - a.diff || b.for - a.for || a.name.localeCompare(b.name));
  });
  return tables;
}

function euroGroupLeaders(targetState = state) {
  const tables = euroGroupTables(targetState);
  const result = {};
  EURO_GROUPS.forEach((letter) => {
    const rows = tables[letter];
    if (!rows || rows.length < 4 || rows.some((row) => row.played < 3)) return;
    result[letter] = { first: rows[0].teamId, second: rows[1].teamId };
  });
  return result;
}

function resolveEuroCupBracket() {
  if (!state.euroCup) return;
  const leaders = euroGroupLeaders();
  const byRound = (round) => state.fixtures.filter((fixture) => fixture.competition === "eurocup" && fixture.round === round);
  const r16 = byRound("Octavos de final");
  const qf = byRound("Cuartos de final");
  const sf = byRound("Semifinal");
  const final = byRound("Final")[0];
  if (Object.keys(leaders).length === 8 && r16.some((fixture) => !fixture.homeId)) {
    const pairs = [["A", "B"], ["C", "D"], ["E", "F"], ["G", "H"], ["B", "A"], ["D", "C"], ["F", "E"], ["H", "G"]];
    pairs.forEach((pair, index) => { r16[index].homeId = leaders[pair[0]].first; r16[index].awayId = leaders[pair[1]].second; });
    pushFeed("Fase de grupos de la Copa Europea terminada: se sortean los octavos de final.", "Fase de grupos de la Copa Europea terminada: se sortean los octavos de final.", "world");
  }
  for (let i = 0; i < 4; i += 1) {
    const fixture = qf[i];
    if (fixture && !fixture.homeId && r16[i].winnerId && r16[i + 4].winnerId) { fixture.homeId = r16[i].winnerId; fixture.awayId = r16[i + 4].winnerId; }
  }
  if (sf[0] && !sf[0].homeId && qf[0].winnerId && qf[1].winnerId) { sf[0].homeId = qf[0].winnerId; sf[0].awayId = qf[1].winnerId; }
  if (sf[1] && !sf[1].homeId && qf[2].winnerId && qf[3].winnerId) { sf[1].homeId = qf[2].winnerId; sf[1].awayId = qf[3].winnerId; }
  if (final && !final.homeId && sf[0]?.winnerId && sf[1]?.winnerId) { final.homeId = sf[0].winnerId; final.awayId = sf[1].winnerId; }
  state.fixtures.filter((fixture) => fixture.competition === "eurocup" && !fixture.played && fixture.date <= state.currentDate && fixture.homeId && fixture.awayId && fixture.homeId !== state.managerTeamId && fixture.awayId !== state.managerTeamId).forEach((fixture) => simulateMatch(fixture));
}

function completeEuroCupIfDone() {
  if (!state.euroCup || state.euroCupAwarded) return;
  const final = euroFinalFixture();
  if (!final || !final.played) return;
  const champion = final.winnerId ? teamById(final.winnerId) : null;
  const runnerUp = final.loserId ? teamById(final.loserId) : null;
  if (!champion) return;
  champion.budget = Number(champion.budget || 0) + 250000;
  champion.euroCupTitles = Number(champion.euroCupTitles || 0) + 1;
  let message = `${_("Copa Europea", "European Cup")} ${state.euroCup.year}: ${champion.Name} ${_("se proclama campeón y gana", "is proclaimed champion and wins")} ${money(250000)}.`;
    if (runnerUp) { runnerUp.budget = Number(runnerUp.budget || 0) + 100000; message += ` ${runnerUp.Name} ${_("es subcampeón y gana", "is runner-up and wins")} ${money(100000)}.`; }
  pushFeed(message, message, "world");
  state.euroCupAwarded = true;
  state.euroCup.done = true;
  state.euroCupResult = { year: state.euroCup.year, champion: champion ? { id: champion.TeamID, name: champion.Name } : null, runnerUp: runnerUp ? { id: runnerUp.TeamID, name: runnerUp.Name } : null };
  state.euroCupResults = state.euroCupResults || [];
  state.euroCupResults.push(state.euroCupResult);
}

function championsParticipants(stateLike) {
  const ids = [];
  LEAGUES.forEach((league) => {
    let team = null;
    const champId = stateLike.championsByLeague?.[league.id];
    if (champId) team = teamById(champId, stateLike);
    if (!team) {
      team = stateLike.teams.filter((t) => t.leagueId === league.id).sort((a, b) => computedTeamOVR(b, stateLike) - computedTeamOVR(a, stateLike))[0];
    }
    if (team && team.TeamID !== "BYE") ids.push(team.TeamID);
  });
  return ids;
}

function shuffleRandom(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setupChampionsCup(stateLike, year) {
  const participants = championsParticipants(stateLike);
  const seeds = participants.sort((a, b) => computedTeamOVR(teamById(b, stateLike), stateLike) - computedTeamOVR(teamById(a, stateLike), stateLike));
  if (seeds.length < 8) return [];
  const N = seeds.length;
  const fixtures = [];
  const blocked = championsBlockedDates(stateLike);
  const koDate = (base) => adjustEuroDate(base, blocked);
  const pref = `CT${year}`;
  const byes = Math.max(0, 16 - N);
  const r1Count = N - 8;
  const r1Ids = [];
  const r1Teams = shuffleRandom(seeds.slice(byes));
  for (let i = 0; i < r1Count; i += 1) {
    const id = `${pref}-R1-${i + 1}`;
    r1Ids.push(id);
    fixtures.push(makeFixture({ id, date: koDate(championsR1Date(year)), competition: "champions", round: "Dieciseisavos de final", homeId: r1Teams[i], awayId: r1Teams[r1Teams.length - 1 - i] }));
  }
  const entrants = [];
  for (let b = 0; b < byes; b += 1) entrants.push(seeds[b]);
  for (let i = 0; i < r1Count; i += 1) entrants.push(`@${r1Ids[i]}`);
  for (let q = 0; q < 4; q += 1) {
    fixtures.push(makeFixture({ id: `${pref}-QF-${q + 1}`, date: koDate(championsQfDate(year)), competition: "champions", round: "Cuartos de final", homeId: entrants[q * 2], awayId: entrants[q * 2 + 1] }));
  }
  for (let s = 0; s < 2; s += 1) {
    const id = `${pref}-SF-${s + 1}`;
    fixtures.push(makeFixture({ id, date: koDate(championsSfDate(year)), competition: "champions", round: "Semifinal", homeId: `@${pref}-QF-${s + 1}`, awayId: `@${pref}-QF-${s === 0 ? 4 : 3}` }));
  }
  fixtures.push(makeFixture({ id: `${pref}-F`, date: koDate(championsFinalDate(year)), competition: "champions", round: "Final", homeId: `@${pref}-SF-1`, awayId: `@${pref}-SF-2` }));
  stateLike.championsCup = { year: year + 1, participants: seeds.length, done: false };
  stateLike.championsCupResult = null;
  stateLike.championsCupAwarded = false;
  return fixtures;
}

function resolveChampionsCupBracket() {
  const winnerOf = (id) => {
    const fixture = state.fixtures.find((item) => item.id === id && item.competition === "champions");
    return fixture && fixture.played && fixture.winnerId ? fixture.winnerId : null;
  };
  let changed = false;
  state.fixtures.filter((fixture) => fixture.competition === "champions").forEach((fixture) => {
    if (fixture.homeId && String(fixture.homeId).startsWith("@")) {
      const winner = winnerOf(String(fixture.homeId).slice(1));
      if (winner) { fixture.homeId = winner; changed = true; }
    }
    if (fixture.awayId && String(fixture.awayId).startsWith("@")) {
      const winner = winnerOf(String(fixture.awayId).slice(1));
      if (winner) { fixture.awayId = winner; changed = true; }
    }
  });
  if (changed) {
    state.fixtures.filter((fixture) => fixture.competition === "champions" && !fixture.played && fixture.date <= state.currentDate && fixture.homeId && fixture.awayId && !String(fixture.homeId).startsWith("@") && !String(fixture.awayId).startsWith("@") && fixture.homeId !== state.managerTeamId && fixture.awayId !== state.managerTeamId).forEach((fixture) => simulateMatch(fixture));
  }
}

function completeChampionsCupIfDone() {
  if (!state.championsCup || state.championsCupAwarded) return;
  const final = state.fixtures.find((fixture) => fixture.competition === "champions" && fixture.round === "Final");
  if (!final || !final.played) return;
  const champion = final.winnerId ? teamById(final.winnerId) : null;
  const runnerUp = final.loserId ? teamById(final.loserId) : null;
  if (!champion) return;
  const year = state.championsCup.year || state.seasonYear + 1;
  champion.budget = Number(champion.budget || 0) + 150000;
  champion.championsTitles = Number(champion.championsTitles || 0) + 1;
  let message = `${_("Torneo de Campeones", "Champions Tournament")} ${year}: ${champion.Name} ${_("se corona campeón entre los campeones y gana", "is crowned champion of champions and wins")} ${money(150000)}.`;
    if (runnerUp) { runnerUp.budget = Number(runnerUp.budget || 0) + 60000; message += ` ${runnerUp.Name} ${_("es subcampeón y gana", "is runner-up and wins")} ${money(60000)}.`; }
  pushFeed(message, message, "world");
  state.championsCupAwarded = true;
  state.championsCup.done = true;
  state.championsCupResult = { year, champion: { id: champion.TeamID, name: champion.Name }, runnerUp: runnerUp ? { id: runnerUp.TeamID, name: runnerUp.Name } : null };
  state.championsCupResults = state.championsCupResults || [];
  state.championsCupResults.push(state.championsCupResult);
}

function setupChampionsCupIfNeeded() {
  if (!championsCupSeason(state.seasonYear)) return;
  if (state.fixtures.some((fixture) => fixture.competition === "champions")) return;
  catchUpBackgroundLeagues();
  Object.keys(state.leagueStandings || {}).forEach((lid) => {
    const top = (state.leagueStandings[lid] || [])[0];
    if (top) state.championsByLeague[lid] = top.teamId;
  });
  state.fixtures = [...state.fixtures, ...setupChampionsCup(state, state.seasonYear)].sort(sortFixtures);
}

function catchUpChampionsCup() {
  setupChampionsCupIfNeeded();
  if (!state.championsCup) return;
  const cutoff = addDays(cupSemiFinal1Date(cupYear()), -1);
  let guard = 0;
  while (guard < 64) {
    resolveChampionsCupBracket();
    const due = state.fixtures
      .filter((fixture) => fixture.competition === "champions" && !fixture.played && fixture.date <= cutoff && fixture.homeId && fixture.awayId && !String(fixture.homeId).startsWith("@") && !String(fixture.awayId).startsWith("@") && fixture.homeId !== state.managerTeamId && fixture.awayId !== state.managerTeamId)
      .sort(sortFixtures);
    if (!due.length) break;
    due.forEach((fixture) => {
      simulateMatch(fixture);
      pushFeed(`${formatDate(fixture.date, true)} · ${competitionLabel(fixture)}: ${teamName(fixture.homeId)} ${fixture.homeScore}-${fixture.awayScore} ${teamName(fixture.awayId)}`, `${formatDate(fixture.date, true)} · ${competitionLabel(fixture)}: ${teamName(fixture.homeId)} ${fixture.homeScore}-${fixture.awayScore} ${teamName(fixture.awayId)}`, "world");
    });
    resolveChampionsCupBracket();
    guard += 1;
  }
  completeChampionsCupIfDone();
}

function positionRate(player) {
  const apps = Number(player.appearances || 0);
  if (!apps) return 0;
  if (player.Position === "Chaser") return Number(player.goals || 0) / apps;
  if (player.Position === "Beater") { const gc = Number(player.goalsConceded || 0); return gc ? Number(player.blocks || 0) / gc : 0; }
  if (player.Position === "Keeper") { const gc = Number(player.goalsConceded || 0); return gc ? Number(player.saves || 0) / gc : 0; }
  if (player.Position === "Seeker") return Number(player.snitches || 0) / apps;
  return 0;
}

function positionTotal(player) {
  if (player.Position === "Chaser") return Number(player.goals || 0);
  if (player.Position === "Beater") return Number(player.blocks || 0);
  if (player.Position === "Keeper") return Number(player.saves || 0);
  if (player.Position === "Seeker") return Number(player.snitches || 0);
  return 0;
}

function positionPerformance(peers, player) {
  const rates = peers.map((p) => positionRate(p));
  const maxRate = Math.max(...rates, 0);
  const avgRate = rates.reduce((sum, value) => sum + value, 0) / Math.max(1, rates.length);
  const rateSpan = maxRate - avgRate;
  const rawRateScore = rateSpan > 0 ? clamp((positionRate(player) - avgRate) / rateSpan, 0, 1) : 0.5;
  const rateScore = rawRateScore * clamp(Number(player.appearances || 0) / 13, 0.6, 1);
  return 15 + rateScore * 35;
}

function seasonPlayerScore(player, leagueId = state.leagueId, noRandom = false) {
  const apps = Number(player.appearances || 0);
  if (apps < GALA_MIN_APPS) return 0;
  const peers = state.players.filter((p) => p.leagueId === leagueId && p.Position === player.Position && p.TeamID !== "FREE" && Number(p.appearances || 0) >= GALA_MIN_APPS);
  if (!peers.length) return 0;
  const performance = positionPerformance(peers, player);
  const consistency = Math.min(15, apps * 1.1);
  const quality = clamp((Number(player.OVR || 60) - 60) / 2, 0, 20);
  const form = clamp((Number(player.form || 70) - 70) / 6, 0, 5);
  return performance + consistency + quality + form + (noRandom ? 0 : (Math.random() - 0.5) * 2);
}

function worldPlayerScore(player, noRandom = false) {
  const apps = Number(player.appearances || 0);
  if (apps < GALA_MIN_APPS) return 0;
  const peers = state.players.filter((p) => p.Position === player.Position && p.TeamID !== "FREE" && Number(p.appearances || 0) >= GALA_MIN_APPS);
  if (!peers.length) return 0;
  const performance = positionPerformance(peers, player);
  const consistency = Math.min(15, apps * 1.1);
  const quality = clamp((Number(player.OVR || 60) - 60) / 2, 0, 20);
  const form = clamp((Number(player.form || 70) - 70) / 6, 0, 5);
  return performance + consistency + quality + form + (noRandom ? 0 : (Math.random() - 0.5) * 2);
}

function awardGalaWinner(winner) {
  winner.reputation = Math.min(10, Number(winner.reputation || 0) + 1);
  winner.form = 100;
  winner.morale = 100;
  winner.OVR = clamp(Number(winner.OVR || 0) + 1, 40, 99);
  winner["Value(G)"] = Math.round(Number(winner["Value(G)"] || 0) * 1.05);
}

function awardIntlGala(winner) {
  winner.intlReputation = Math.min(10, Number(winner.intlReputation || 0) + 1);
  winner.form = 100;
  winner.morale = 100;
  winner.OVR = clamp(Number(winner.OVR || 0) + 1, 40, 99);
  winner["Value(G)"] = Math.round(Number(winner["Value(G)"] || 0) * 1.05);
}

function leagueGalaWinner(leagueId, noRandom = false) {
  const leagueChampion = (state.leagueStandings?.[leagueId] || [])[0]?.teamId || null;
  let cupChampion = null;
  if (leagueId === state.leagueId) {
    cupChampion = cupFinal()?.winnerId || null;
  } else {
    const final = state.fixtures.find((fixture) => fixture.competition === "cup" && fixture.leagueId === leagueId && fixture.round === "Final");
    cupChampion = final?.winnerId || null;
  }
  const euroChampionId = state.euroCupResult?.champion?.id || null;
  const championsChampionId = state.championsCupResult?.champion?.id || null;
  const worldChampionIds = worldChampionPlayerIds();
  const ranked = state.players
    .filter((player) => player.leagueId === leagueId && player.TeamID !== "FREE")
    .map((player) => ({ player, base: seasonPlayerScore(player, leagueId, noRandom) }))
    .map((entry) => {
      const score = entry.base
        + (entry.player.TeamID === leagueChampion ? 35 : 0)
        + (entry.player.TeamID === cupChampion ? 25 : 0)
        + (entry.player.TeamID === euroChampionId ? 45 : 0)
        + (entry.player.TeamID === championsChampionId ? 40 : 0)
        + (worldChampionIds.has(entry.player.PlayerID) ? 55 : 0);
      return { player: entry.player, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked.length ? ranked.slice(0, 3) : [];
}

function holdGala() {
  LEAGUES.forEach((league) => {
    if (league.id === state.leagueId) return;
    const podium = leagueGalaWinner(league.id);
    const winner = podium[0]?.player;
    if (winner) awardGalaWinner(winner);
  });
  const podium = leagueGalaWinner(state.leagueId);
  const winner = podium[0]?.player;
  if (!winner) return;
  awardGalaWinner(winner);

  if (state.careerMode && state.career && isCareerPlayer(winner)) {
    state.career.awards.push(`Escoba de Oro ${state.seasonYear}/${state.seasonYear + 1} (${leagueInfo().name})`);
    pushFeed(`Gala: ¡${winner.Name} es elegido Mejor Jugador de la ${leagueInfo().name}! Tu leyenda crece.`, `Gala: ¡${winner.Name} es elegido Mejor Jugador de la ${leagueInfo().name}! Tu leyenda crece.`);
  }

  const intlResult = computeIntlGala();
  if (intlResult) {
    awardIntlGala(intlResult.winner);
    if (state.careerMode && state.career && isCareerPlayer(intlResult.winner)) {
      state.career.awards.push(`Escoba de Oro Internacional ${state.seasonYear}/${state.seasonYear + 1}`);
      pushFeed(`${"Gala"}: ${winner.Name} ${"es elegido Mejor Jugador del Mundo. ¡Histórico!"}`, `${"Gala"}: ${winner.Name} ${"is chosen World Player of the Year. Historic!"}`);
    }
  }

  state.galaResult = {
    seasonYear: state.seasonYear,
    winnerId: winner.PlayerID,
    winnerName: winner.Name,
    winnerTeamId: winner.TeamID,
    winnerTeam: teamName(winner.TeamID),
    podium: podium.map((entry) => ({ name: entry.player.Name, team: teamName(entry.player.TeamID), score: Math.round(entry.score) })),
    intl: intlResult ? { winnerId: intlResult.winner.PlayerID, winnerName: intlResult.winner.Name, winnerTeam: teamName(intlResult.winner.TeamID), podium: intlResult.podium.map((entry) => ({ name: entry.player.Name, team: teamName(entry.player.TeamID), score: Math.round(entry.score) })) } : null,
  };
  state.galaPending = false;
  state.galaModal = true;
  state.currentDate = galaDate(cupYear());
  pushFeed(`Gala: ${winner.Name} (${teamName(winner.TeamID)}) es elegido Mejor Jugador de la Temporada de la ${leagueInfo().name} ${state.seasonYear}/${state.seasonYear + 1}: Escoba de Oro.`, `Gala: ${winner.Name} (${teamName(winner.TeamID)}) es elegido Mejor Jugador de la Temporada de la ${leagueInfo().name} ${state.seasonYear}/${state.seasonYear + 1}: Escoba de Oro.`);
  if (intlResult) pushFeed(`Gala: ${intlResult.winner.Name} (${teamName(intlResult.winner.TeamID)}) es elegido Mejor Jugador del Mundo: Escoba de Oro Internacional.`, `Gala: ${intlResult.winner.Name} (${teamName(intlResult.winner.TeamID)}) es elegido Mejor Jugador del Mundo: Escoba de Oro Internacional.`, "world");
}

function computeIntlGala(noRandom = false) {
  const leagueChampions = {};
  Object.keys(state.leagueStandings || {}).forEach((lid) => {
    const rows = state.leagueStandings[lid];
    if (rows && rows[0]) leagueChampions[lid] = rows[0].teamId;
  });
  const cupChampions = {};
  LEAGUES.forEach((league) => {
    if (league.id === state.leagueId) { cupChampions[league.id] = cupFinal()?.winnerId || null; return; }
    const final = state.fixtures.find((fixture) => fixture.competition === "cup" && fixture.leagueId === league.id && fixture.round === "Final");
    cupChampions[league.id] = final?.winnerId || null;
  });
  const euroChampionId = state.euroCupResult?.champion?.id || null;
  const championsChampionId = state.championsCupResult?.champion?.id || null;
  const worldChampionIds = worldChampionPlayerIds();
  const ranked = state.players
    .filter((player) => player.TeamID !== "FREE")
    .map((player) => ({ player, base: worldPlayerScore(player, noRandom) }))
    .map((entry) => {
      const lid = entry.player.leagueId || state.leagueId;
      const score = entry.base
        + (entry.player.TeamID === leagueChampions[lid] ? 35 : 0)
        + (entry.player.TeamID === cupChampions[lid] ? 15 : 0)
        + (entry.player.TeamID === euroChampionId ? 60 : 0)
        + (entry.player.TeamID === championsChampionId ? 55 : 0)
        + (worldChampionIds.has(entry.player.PlayerID) ? 70 : 0);
      return { player: entry.player, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked.length ? { winner: ranked[0].player, podium: ranked.slice(0, 3) } : null;
}

function worldChampionPlayerIds() {
  const wcResults = state.worldCupResults || [];
  const lastWc = state.worldCupPlayedYear === state.seasonYear ? wcResults[wcResults.length - 1] || null : null;
  const wcChampionSources = lastWc?.championSources || [];
  const worldChampionIds = new Set();
  wcChampionSources.forEach((source) => {
    state.players.forEach((player) => {
      if (player.PlayerID === source.playerId && (player.Nationality || "").toLowerCase() === source.nationality) worldChampionIds.add(player.PlayerID);
    });
  });
  return worldChampionIds;
}

function wrapBackgroundLeagues() {
  Object.keys(state.leagueStandings || {}).forEach((lid) => {
    if (lid === state.leagueId) return;
    const rows = state.leagueStandings[lid];
    const top = rows[0];
    if (top) { const team = teamById(top.teamId); if (team) team.leagueTitles = Number(team.leagueTitles || 0) + 1; state.championsByLeague[lid] = top.teamId; }
    rows.forEach((row, index) => { const team = teamById(row.teamId); if (team) { const prize = leaguePrizeFor(index + 1); if (prize) team.budget = Number(team.budget || 0) + prize; } });
  });
}

function catchUpBackgroundLeagues() {
  state.fixtures.filter((fixture) => fixture.competition === "league" && fixture.leagueId && fixture.leagueId !== state.leagueId && !fixture.played).sort(sortFixtures).forEach((fixture) => simulateMatch(fixture));
  recalcStandings(state);
}

function resetSeason(nextYear) {
  state.leagueHistory = {};
  Object.keys(state.leagueStandings || {}).forEach((lid) => { state.leagueHistory[lid] = (state.leagueStandings[lid] || []).map((row) => row.teamId); });
  wrapBackgroundLeagues();
  recalculateReputations();
  endOfSeasonProcessing();
  if (state.careerMode && state.career) careerSeasonWrap();
  const newYouth = releaseYouthToMarket(state, 3 + Math.floor(Math.random() * 4));
  if (newYouth.length) pushFeed(`${"Nueva generación de jóvenes promesas llega al mercado"} (${newYouth.slice(0, 6).join(", ")}${newYouth.length > 6 ? "... " + "y más" : ""}).`, `${"A new generation of young prospects arrives on the market"} (${newYouth.slice(0, 6).join(", ")}${newYouth.length > 6 ? "... " + "and more" : ""}).`);
  state.seasonYear = nextYear;
  state.currentDate = seasonStart(nextYear);
  state.status = "idle";
  state.pendingMatchId = null;
  state.pendingWarning = null;
  state.pendingLeagueWrap = false;
  state.lastResult = null;
  state.leagueTitleAwardedFor = null;
  state.cupAwarded = false;
  state.cupWrapPending = false;
  state.galaPending = false;
  state.galaResult = null;
  state.galaModal = false;
  state.paidWeeks = [];
  state.clausePurchasesByMonth = {};
  state.backgroundCupsAwarded = {};
  state.championsCup = null;
  state.championsCupResult = null;
  state.championsCupAwarded = false;
  pushFeed(`Comienza la temporada ${nextYear}/${nextYear + 1}.`, `Comienza la temporada ${nextYear}/${nextYear + 1}.`, "league");
  state.feed = state.feed.slice(0, 24);
  state.fixtures = buildSeasonFixtures(state, nextYear);
  if (isEuroCupSeason(nextYear)) state.fixtures = [...state.fixtures, ...setupEuroCup(state, nextYear)].sort(sortFixtures);
  state.players.forEach((player) => {
    player.goals = 0;
    player.snitches = 0;
    player.saves = 0;
    player.blocks = 0;
    player.appearances = 0;
    player.euroGoals = 0;
    player.euroSnitches = 0;
    player.euroSaves = 0;
    player.euroBlocks = 0;
    player.euroApps = 0;
    player.goalsConceded = 0;
    player.injured = false;
    player.injuryDays = 0;
    player.stamina = 100;
  });
  ensureAISquads();
  state.selectedLineups = {};
  state.teams.forEach((team) => {
    state.selectedLineups[team.TeamID] = defaultLineup(playersFor(team.TeamID));
  });
  recalcStandings(state);
}

function advanceDay() {
  if (state.careerMode && state.career) {
    const cp = careerPlayer();
    if (cp) {
      const week = Math.floor(daysBetween(seasonStart(state.seasonYear), state.currentDate) / 7);
      if (week !== (state.career.moneyWeek ?? -1)) {
        state.career.moneyWeek = week;
        const salary = Number(cp["Salary(G/week)"] || 0);
        const living = careerLivingCost();
        state.career.money = (state.career.money || 0) + salary;
        state.career.lifetimeEarned = (state.career.lifetimeEarned || 0) + salary;
        if (state.career.sponsor && state.career.sponsor.season === state.seasonYear) {
          const sponsorWeekly = Number(state.career.sponsor.weekly || 0);
          state.career.money += sponsorWeekly;
          state.career.lifetimeEarned = (state.career.lifetimeEarned || 0) + sponsorWeekly;
        }
        if (state.career.mansion === state.seasonYear) {
          cp.morale = clamp(Number(cp.morale || 70) + 2, 30, 100);
        }
        state.career.lifetimeSpent = (state.career.lifetimeSpent || 0) + living;
        state.career.money -= living;
        if (state.career.money < 0) {
          state.career.money = 0;
          cp.morale = clamp(Number(cp.morale || 70) - 8, 30, 100);
          pushFeed(`${cp.Name} no ha podido pagar sus necesidades esta semana: su moral baja.`, `${cp.Name} no ha podido pagar sus necesidades esta semana: su moral baja.`);
        }
      }
    }
  }
  state.players.forEach((player) => {
    const stamina = Number(player.stamina ?? 100);
    player.stamina = Math.min(100, stamina + 4);
    if (player.injured) {
      player.injuryDays = Math.max(0, Number(player.injuryDays ?? 0) - 1);
      if (player.injuryDays === 0) { player.injured = false; pushFeed(`${player.Name} ${"se recupera de su lesión."}`, `${player.Name} ${"recovers from his injury."}`); }
    }
  });
  if (state.fixtures.some((fixture) => fixture.competition === "league" && fixture.leagueId === state.leagueId && !fixture.played)) payWeeklySalaries();
  simulateNonManagerMatchesOnDate(state.currentDate);
  if (state.championsCup?.done && !state.pendingLeagueWrap && !cupFixtures().length) {
    startCupPhase();
    homeMode = "league";
    stopAdvance();
    state.status = "idle";
    saveAndRender();
    return;
  }
  marketActivity();
  maybeGenerateCareerOffers();
  updatePlayerValues();
  guaranteeAISquads();
  if (state.cupWrapPending) { state.pendingLeagueWrap = true; state.cupWrapPending = false; }
  if (state.pendingLeagueWrap) { stopAdvance(); state.status = "idle"; saveAndRender(); return; }
  let managerToday = fixturesOn(state.currentDate).find((fixture) => fixture.homeId === state.managerTeamId || fixture.awayId === state.managerTeamId);
  if (!managerToday && !state.worldCup) {
    managerToday = state.fixtures.find((fixture) => fixture.competition !== "league" && fixture.competition !== "worldcup" && !fixture.played && fixture.date <= state.currentDate && fixture.homeId && fixture.awayId && (fixture.homeId === state.managerTeamId || fixture.awayId === state.managerTeamId));
  }
  if (managerToday && !autoSim()) {
    stopAdvance();
    state.status = "ready";
    state.pendingMatchId = managerToday.id;
    homeMode = managerToday.competition === "eurocup" ? "euro" : managerToday.competition === "champions" ? "champions" : "league";
    pushFeed(`${"Día de partido"}: ${competitionLabel(managerToday)} · ${teamName(managerToday.homeId)} ${"vs"} ${teamName(managerToday.awayId)}.`, `${"Matchday"}: ${competitionLabel(managerToday)} · ${teamName(managerToday.homeId)} ${"vs"} ${teamName(managerToday.awayId)}.`, fixtureFeedScope(managerToday));
    saveAndRender();
    return;
  }
  if (!state.pendingLeagueWrap && leagueIsFinished() && state.currentDate >= leagueEnd(state.seasonYear) && !state.leagueTitleAwardedFor) {
    stopAdvance();
    awardLeagueTitle();
    state.pendingLeagueWrap = true;
    state.status = "idle";
    saveAndRender();
    return;
  }
  state.currentDate = addDays(state.currentDate, 1);
  saveAndRender();
}

function managerLineupIsComplete() {
  if (state.careerMode) return true;

  return lineupIssue(state.managerTeamId).ok;
}

function startAdvance(force = false) {
  if (state.pendingLeagueWrap) {
    if (!leagueIsFinished() && !cupFixtures().length) { state.pendingLeagueWrap = false; }
    else {
      catchUpBackgroundLeagues();
      const final = cupFinal();
      if (final && final.played && state.galaPending) { holdGala(); saveAndRender(); return; }
      if (final && final.played) resetSeason(state.seasonYear + 1);
      else if (isWorldCupSeason() && !state.worldCup && state.worldCupPlayedYear !== state.seasonYear) { if (state.careerMode && state.career) startCareerWorldCup(); else startWorldCup(); saveAndRender(); return; }
      else if (championsCupSeason(state.seasonYear) && !state.championsCup?.done) { startChampionsPhase(); }
      else { startCupPhase(); }
      saveAndRender();
      return;
    }
  }
  if (state.status === "ready") {
    if (!force && !managerLineupIsComplete()) {
      state.pendingWarning = true;
      saveAndRender();
      return;
    }
    state.pendingWarning = null;
    simulateManagerMatch();
    return;
  }
  state.status = "running";
  saveAndRender();
  advanceTimer = window.setInterval(advanceDay, wcAutoSpeed());
}
function wcAutoSpeed() {
  if (!state.worldCup || !state.managerTeamId) return 120;
  const hasMatches = Boolean(nextManagerFixture(true));
  return hasMatches ? 120 : 900;
}
function stopAdvance() { if (advanceTimer) window.clearInterval(advanceTimer); advanceTimer = null; if (state.status === "running") state.status = "idle"; }
function simulateManagerMatch() {
  if (state.careerMode) { simulateCareerMatch(); return; }
  const fixture = state.fixtures.find((item) => item.id === state.pendingMatchId) || nextManagerFixture(true);
  if (!fixture) return;
  state.status = "simulating";
  saveAndRender();
  window.setTimeout(() => {
    simulateMatch(fixture);
    state.lastResult = clone(fixture);
    state.pendingMatchId = null;
    state.status = "idle";
    pushFeed(`${competitionLabel(fixture)}: ${teamName(fixture.homeId)} ${fixture.homeScore}-${fixture.awayScore} ${teamName(fixture.awayId)}.`, `${competitionLabel(fixture)}: ${teamName(fixture.homeId)} ${fixture.homeScore}-${fixture.awayScore} ${teamName(fixture.awayId)}.`, fixtureFeedScope(fixture));
    resolveCupFinal();
    completeCupIfDone();
    resolveBackgroundCupFinals();
    completeBackgroundCups();
    resolveEuroCupBracket();
    completeEuroCupIfDone();
    resolveChampionsCupBracket();
    completeChampionsCupIfDone();
    resolveWorldCupBracket();
    finishWorldCupIfDone();
    updatePlayerValues();
    saveAndRender();
  }, 2300);
}
function saveAndRender() { saveState(); render(); }
function chooseTeam(teamId) { stopAdvance(); const prevSave = (() => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } })(); if (prevSave) { try { localStorage.setItem(SAVE_BACKUP_KEY, prevSave); } catch (e) {} } localStorage.removeItem(SAVE_KEY); lastLoadError = null; state = buildInitialState(teamId, START_YEAR, Boolean(document.getElementById("zeroStatsOption")?.checked), selectedLeagueId || "BR"); activeView = "home"; selectedTeamId = null; marketTab = "buy"; confirmReset = false; saveAndRender(); }
function chooseLeague(leagueId) { selectedLeagueId = leagueById(leagueId).id; saveState(); render(); }

function teamRecentSuccess(team) {
  const year = state.seasonYear;
  let score = 0;
  if (state.leagueTitleAwardedFor === year && state.championsByLeague?.[team.leagueId] === team.TeamID) score += 3;
  const final = cupFinal();
  if (final && final.played && final.winnerId === team.TeamID) score += 2;
  if (state.championsCupAwarded && state.championsCup?.winnerTeamId === team.TeamID) score += 3;
  if (state.euroCupAwarded && state.euroCup?.winnerTeamId === team.TeamID) score += 3;
  const rows = state.leagueStandings?.[team.leagueId] || state.standings || [];
  if (rows.findIndex((r) => r.teamId === team.TeamID) === 0) score += 1;
  return score;
}

function canNegotiate(player) {
  if (!player) return false;
  if (player.TeamID === "FREE" || player.TeamID === state.managerTeamId) return false;
  if (player.leagueId && player.leagueId !== state.leagueId) return false;
  if (isShielded(player) || clauseLocked(player) || isInMarket(player)) return false;
  if (player.negotiationBlockedUntil && player.negotiationBlockedUntil > state.currentDate) return false;
  return true;
}

function canIntlNegotiate(player) {
  if (!player) return false;
  if (state.careerMode || state.worldCup) return false;
  if (player.TeamID === "FREE" || player.TeamID === state.managerTeamId) return false;
  if (!player.leagueId || player.leagueId === state.leagueId) return false;
  if (isShielded(player) || clauseLocked(player)) return false;
  if (player.negotiationBlockedUntil && player.negotiationBlockedUntil > state.currentDate) return false;
  return true;
}

function negotiationChance(player, fee, salary, intl = false) {
  const currentSalary = Math.max(1, Number(player["Salary(G/week)"] || 0));
  if (intl && salary < Math.round(currentSalary * 1.0)) return 0;
  if (fee >= releaseClause(player)) return 100;
  const myTeam = teamById(state.managerTeamId);
  const theirTeam = teamById(player.TeamID);
  if (!myTeam || !theirTeam) return 0;
  const myRep = Number(myTeam.ReputationStars || 3);
  const theirRep = Number(theirTeam.ReputationStars || 3);
  const rows = state.leagueStandings?.[state.leagueId] || state.standings || [];
  const myPos = (rows.findIndex((r) => r.teamId === myTeam.TeamID) + 1) || 13;
  const theirPos = (rows.findIndex((r) => r.teamId === theirTeam.TeamID) + 1) || 13;
  const mySuccess = teamRecentSuccess(myTeam);
  const theirSuccess = teamRecentSuccess(theirTeam);
  let chance = 55;
  chance += (myRep - theirRep) * 5;
  chance += (theirPos - myPos) * 1.2;
  chance += (mySuccess - theirSuccess) * 4;
  chance += (Number(player.morale || 70) - 70) * -0.5;
  chance += (salary / currentSalary - 1) * 40;
  chance += (fee / Math.max(1, playerValue(player)) - 1) * 15;
  return clamp(chance, 3, 97);
}

function startNegotiation(playerId) {
  const player = playerById(playerId);
  if (!player || !canNegotiate(player)) return;
  state.negotiation = { playerId, round: 1, fee: Math.round(playerValue(player) * 0.8), salary: Number(player["Salary(G/week)"] || 0) };
  saveAndRender();
}

function startIntlNegotiation(playerId) {
  const player = playerById(playerId);
  if (!player || !canIntlNegotiate(player)) return;
  state.negotiation = { playerId, round: 1, intl: true, fee: Math.round(playerValue(player)), salary: Number(player["Salary(G/week)"] || 0) };
  saveAndRender();
}

function submitNegotiation(fee, salary) {
  const neg = state.negotiation;
  const player = neg && playerById(neg.playerId);
  if (!player) { state.negotiation = null; saveAndRender(); return; }
  const isIntl = Boolean(neg.intl);
  const manager = teamById(state.managerTeamId);
  const value = Math.round(playerValue(player));
  const currentSalary = Number(player["Salary(G/week)"] || 0) || 200;
  const minFee = Math.round(value * 0.55);
  const maxFee = isIntl ? Math.round(value * 2) : Math.round(value * 1.1);
  const minSalary = isIntl ? Math.round(currentSalary * 1.0) : Math.round(currentSalary * 0.7);
  const maxSalary = isIntl ? Math.round(currentSalary * 1.5) : Math.round(currentSalary * 1.2);
  const extra = isIntl ? CROSS_LEAGUE_FEE : 0;
  if (fee < minFee || fee > maxFee || salary < minSalary || salary > maxSalary) { neg.result = { success: false, text: `Tarifa entre ${money(minFee)} y ${money(maxFee)}, y salario entre ${money(minSalary)} y ${money(maxSalary)}/sem.` }; saveAndRender(); return; }
  if (manager && Number(manager.budget || 0) < fee + extra) { neg.result = { success: false, text: `No tienes suficiente presupuesto: necesitas ${money(fee + extra)}${isIntl ? ` (${money(fee)} + ${money(CROSS_LEAGUE_FEE)} de traspaso de liga)` : ""} y dispones de ${money(manager.budget)}.` }; saveAndRender(); return; }
  const chance = negotiationChance(player, fee, salary, isIntl);
  const roll = Math.random() * 100;
  if (roll < chance * 0.6) {
    const originLeagueId = player.leagueId;
    const ok = completeTransfer(player, state.managerTeamId, fee, `${player.Name} acepta tu oferta de ${money(fee)}${isIntl ? ` y pagas ${money(CROSS_LEAGUE_FEE)} por el traspaso de liga` : ""} y ficha por ${money(salary)}/sem.`);
    if (ok) {
      player["Salary(G/week)"] = salary;
      if (isIntl) {
        manager.budget = Number(manager.budget || 0) - CROSS_LEAGUE_FEE;
        state.leagueFunds[originLeagueId] = Number(state.leagueFunds[originLeagueId] || 0) + CROSS_LEAGUE_FEE;
      }
    }
    neg.result = { success: true, text: ok ? `${player.Name} acepta tu oferta de ${money(fee)}${isIntl ? ` y pagas ${money(CROSS_LEAGUE_FEE)} por el traspaso de liga` : ""} y ficha por ${money(salary)}/sem. ¡Bienvenido a ${manager.Name}!` : "No se ha podido completar la transferencia." };
    saveAndRender();
    return;
  }
  if (roll < chance * 0.85) {
    const mid = Math.round((playerValue(player) * 1.05 + fee) / 2);
    const midSal = Math.round((currentSalary * 1.1 + salary) / 2);
    neg.round = 2;
    neg.fee = mid;
    neg.salary = midSal;
    pushFeed(`${player.Name} ${"no está del todo convencido y contraoferta:"} ${money(mid)} ${"y"} ${money(midSal)}/${"sem"}. ${"Tienes la última palabra."}`, `${player.Name} ${"is not entirely convinced and counter-offers:"} ${money(mid)} ${"and"} ${money(midSal)}/${"wk"}. ${"You have the final say."}`);
    saveAndRender();
    return;
  }
  player.morale = clamp(Number(player.morale || 70) + 3, 0, 100);
  player.negotiationBlockedUntil = addDays(state.currentDate, 31);
  neg.result = { success: false, text: `${player.Name} ${_("rechaza tu oferta: está bien donde está. Su moral sube un poco y no podrás ofertarle de nuevo este mes.", "rejects your offer: he is fine where he is. His morale rises a bit and you will not be able to bid for him again this month.")}` };
  pushFeed(`${player.Name} rechaza tu oferta de ${money(fee)}.`, `${player.Name} rechaza tu oferta de ${money(fee)}.`);
  saveAndRender();
}

function acceptNegotiationCounter() {
  const neg = state.negotiation;
  const player = neg && playerById(neg.playerId);
  if (!player) { state.negotiation = null; saveAndRender(); return; }
  const isIntl = Boolean(neg.intl);
  const manager = teamById(state.managerTeamId);
  const extra = isIntl ? CROSS_LEAGUE_FEE : 0;
  if (manager && Number(manager.budget || 0) < neg.fee + extra) { neg.result = { success: false, text: `No tienes suficiente presupuesto: necesitas ${money(neg.fee + extra)}${isIntl ? ` (+${money(CROSS_LEAGUE_FEE)} de traspaso de liga)` : ""} y dispones de ${money(manager.budget)}.` }; saveAndRender(); return; }
  const originLeagueId = player.leagueId;
  const ok = completeTransfer(player, state.managerTeamId, neg.fee, `${player.Name} acepta tu contraoferta de ${money(neg.fee)}${isIntl ? ` y pagas ${money(CROSS_LEAGUE_FEE)} por el traspaso de liga` : ""} y ficha por ${money(neg.salary)}/sem.`);
  if (ok) {
    player["Salary(G/week)"] = neg.salary;
    if (isIntl) {
      manager.budget = Number(manager.budget || 0) - CROSS_LEAGUE_FEE;
      state.leagueFunds[originLeagueId] = Number(state.leagueFunds[originLeagueId] || 0) + CROSS_LEAGUE_FEE;
    }
  }
  neg.result = { success: true, text: ok ? `Acuerdo cerrado: ${player.Name} firma por ${money(neg.fee)} y ${money(neg.salary)}/sem${isIntl ? ` (pagas ${money(CROSS_LEAGUE_FEE)} por el traspaso de liga)` : ""}. ¡Bienvenido a ${manager.Name}!` : "No se ha podido completar la transferencia." };
  saveAndRender();
}

function withdrawNegotiation() {
  const neg = state.negotiation;
  const player = neg && playerById(neg.playerId);
  if (!player) { state.negotiation = null; saveAndRender(); return; }
  player.morale = clamp(Number(player.morale || 70) - 8, 0, 100);
  const angry = Math.random() < 0.35;
  if (angry) player.listed = true;
  neg.result = { success: false, text: angry
    ? `${player.Name} se mosquea por tu rechazo y pide salir al mercado: su moral baja y queda transferible.`
    : `${player.Name} se mosquea por tu rechazo: su moral baja.` };
  pushFeed(angry
    ? `${player.Name} se mosquea por tu rechazo y pide salir al mercado: su moral baja y queda transferible.`
    : `${player.Name} se mosquea por tu rechazo: su moral baja.`, angry
    ? `${player.Name} se mosquea por tu rechazo y pide salir al mercado: su moral baja y queda transferible.`
    : `${player.Name} se mosquea por tu rechazo: su moral baja.`);
  saveAndRender();
}

function buyPlayer(playerId, useClause = false) {
  const player = state.players.find((item) => item.PlayerID === playerId);
  const manager = teamById(state.managerTeamId);
  if (!player || !manager || player.TeamID === state.managerTeamId) return;
  const isClause = player.TeamID !== "FREE" && !player.listed;
  if (isShielded(player)) { pushFeed(`${player.Name} ${"está blindado: nadie puede comprarlo esta temporada."}`, `${player.Name} ${"is shielded: nobody can buy him this season."}`); saveAndRender(); return; }
  const month = monthKey(state.currentDate);
  const spent = Number(state.clausePurchasesByMonth[month] || 0);
  if (isClause && clauseLocked(player)) { pushFeed(`${player.Name} ${"está protegido por cláusula: no puede ser clausulado hasta el"} ${formatDate(player.clauseLockUntil, true)}.`, `${player.Name} ${"is protected by a release clause: he cannot be bought out until"} ${formatDate(player.clauseLockUntil, true)}.`); saveAndRender(); return; }
  if (isClause && spent >= 2) { pushFeed("Este mes solo puedes pagar 2 cláusulas.", "This month you can only pay 2 release clauses."); saveAndRender(); return; }
  const price = buyPrice(player);
  if (manager.budget < price) return;
  if (isClause) state.clausePurchasesByMonth[month] = spent + 1;
  completeTransfer(player, state.managerTeamId, price, `Has fichado a ${player.Name} por ${money(price)}.`);
  saveAndRender();
}
function sellPlayer(playerId) {
  const player = state.players.find((item) => item.PlayerID === playerId);
  if (!player || player.TeamID !== state.managerTeamId) return;
  if (isShielded(player)) { pushFeed(`${player.Name} ${"está blindado: no se puede poner en venta esta temporada."}`, `${player.Name} ${"is shielded: he cannot be put up for sale this season."}`); saveAndRender(); return; }
  player.listed = !player.listed;
  pushFeed(player.listed ? `${player.Name} queda transferible.` : `${player.Name} sale del mercado.`, player.listed ? `${player.Name} queda transferible.` : `${player.Name} sale del mercado.`);
  saveAndRender();
}

function offloadPlayer(player) {
  if (isCareerPlayer(player)) return 0;
  const owner = player.TeamID === "FREE" ? null : teamById(player.TeamID);
  const saleValue = Math.max(0, Math.floor(playerValue(player) / 2));
  if (owner) owner.budget = Number(owner.budget || 0) + saleValue;
  player.TeamID = "FREE";
  player.listed = true;
  if (owner) {
    const lineup = state.selectedLineups[owner.TeamID] || [];
    if (lineup.includes(player.PlayerID)) state.selectedLineups[owner.TeamID] = lineup.map((id) => (id === player.PlayerID ? null : id));
  }
  return saleValue;
}

function sellPlayerToLeague(playerId) {
  const player = state.players.find((item) => item.PlayerID === playerId);
  const manager = teamById(state.managerTeamId);
  if (!player || !manager || player.TeamID !== state.managerTeamId) return;
  if (isShielded(player)) { pushFeed(`${player.Name} ${"está blindado: no se puede vender esta temporada."}`, `${player.Name} ${"is shielded: he cannot be sold this season."}`); saveAndRender(); return; }
  const saleValue = offloadPlayer(player);
  pushFeed(`${player.Name} se vende a la liga por ${money(saleValue)}.`, `${player.Name} se vende a la liga por ${money(saleValue)}.`);
  saveAndRender();
}
function slotIndexForPromotion(teamId, playerId) {
  const player = playersFor(teamId).find((p) => p.PlayerID === playerId);
  const lineup = state.selectedLineups[teamId] || [];
  const candidates = REQUIRED_SLOTS.map((slot, i) => ({ slot, i }));
  const positionCandidates = player && player.Position !== "Reserve" ? candidates.filter((item) => item.slot === player.Position) : candidates;
  return positionCandidates.find((item) => !lineup[item.i])?.i ?? -1;
}

function promoteStarter(playerId) {
  const teamId = state.managerTeamId;
  const player = state.players.find((item) => item.PlayerID === playerId);
  if (!player || player.TeamID !== teamId || player.injured) return;
  const lineup = state.selectedLineups[teamId] || [];
  if (lineup.includes(playerId)) return;
  const nextLineup = [...lineup];
  const slots = REQUIRED_SLOTS.map((slot, i) => ({ slot, i }));
  const targetSlots = player.Position === "Reserve" ? slots : slots.filter((item) => item.slot === player.Position);
  const occupantAt = (slot) => { const id = nextLineup[slot.i]; return id && state.players.find((p) => p.PlayerID === id); };
  const freeSlot = targetSlots.find((item) => !nextLineup[item.i]);
  if (freeSlot) {
    while (nextLineup.length <= freeSlot.i) nextLineup.push(null);
    nextLineup[freeSlot.i] = playerId;
    state.selectedLineups[teamId] = nextLineup;
    saveAndRender();
    return;
  }
  const candidates = targetSlots
    .map((item) => ({ item, occupant: occupantAt(item) }))
    .filter((entry) => entry.occupant);
  const injuredSwap = candidates.find((entry) => entry.occupant.injured);
  const reserveSwap = candidates.find((entry) => entry.occupant.Position === "Reserve");
  const weakestSwap = candidates.sort((a, b) => matchRating(a.occupant) - matchRating(b.occupant))[0];
  const swap = injuredSwap || reserveSwap || weakestSwap;
  if (swap) {
    nextLineup[swap.item.i] = playerId;
    state.selectedLineups[teamId] = nextLineup;
    pushFeed(`${player.Name} entra al once por ${swap.occupant.Name}.`, `${player.Name} entra al once por ${swap.occupant.Name}.`);
    saveAndRender();
    return;
  }
  pushFeed(_("No hay hueco libre de " + posName(player.Position) + " en el once. Haz suplente a uno primero.", "There is no free slot for " + posName(player.Position) + " in the lineup. Make one a sub first."), _("No hay hueco libre de " + posName(player.Position) + " en el once. Haz suplente a uno primero.", "There is no free slot for " + posName(player.Position) + " in the lineup. Make one a sub first."));
  saveAndRender();
}

function demoteStarter(playerId) {
  const teamId = state.managerTeamId;
  const lineup = state.selectedLineups[teamId] || [];
  if (!lineup.includes(playerId)) return;
  const slotIndex = lineup.indexOf(playerId);
  const nextLineup = [...lineup];
  nextLineup[slotIndex] = null;
  state.selectedLineups[teamId] = nextLineup;
  saveAndRender();
}
function resetGame() {
  if (state.onlineAuto) return;
  if (!confirmReset) { confirmReset = true; render(); return; }
  if (state.careerMode) { careerGameReset(); return; }
  stopAdvance(); localStorage.removeItem(SAVE_KEY); state = buildInitialState(null, START_YEAR, false, state.leagueId || "BR"); activeView = "home"; selectedTeamId = null; marketTab = "buy"; confirmReset = false; render();
}
function render() {
  if (globalThis.__qmHeadless) return;
  try {
    if (careerSetup) { app.innerHTML = renderCareerSetup(); bindEvents(); return; }
    if (state.careerMode) { renderCareer(); return; }
if (!state.managerTeamId) {
      if (onlineLobby) { app.innerHTML = renderOnlineLobby(); bindEvents(); return; }
      if (!selectedLeagueId) {
        app.innerHTML = renderLeagueSelect();
        bindEvents();
        return;
      }
      app.innerHTML = renderTeamSelect();
      bindEvents();
      return;
    }

    const manager = teamById(state.managerTeamId);
    if (!manager && autoSim()) { app.innerHTML = renderOnlineWaiting(); bindEvents(); return; }
    const standing = managerStanding();
    const standingLabel = state.worldCup
      ? (() => {
          const tables = wcGroupTables(state);
          for (const letter of ["A", "B", "C", "D"]) {
            const idx = (tables[letter] || []).findIndex((row) => row.teamId === state.managerTeamId);
            if (idx >= 0) return `${idx + 1}.º grupo ${letter} · ${(tables[letter][idx] || {}).points || 0} pts`;
          }
          return "Fase de grupos";
        })()
      : `${standing.position}.º · ${standing.points} pts`;
    app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div><strong>${manager.Name}</strong><span>${state.worldCup ? _("Mundial", "World Cup") + " " + state.seasonYear + " · " + formatDate(state.currentDate) + " · " + _("versión", "version") + " " + GAME_VERSION : manager.Country + " · " + formatDate(state.currentDate) + " · " + _("versión", "version") + " " + GAME_VERSION}</span></div>
        <div class="center"><strong>${state.worldCup ? standingLabel : `${standing.position}.º · ${standing.points} pts`}</strong><span>${state.worldCup ? _("Fase de grupos del Mundial", "World Cup group stage") : `${standing.played} ${_("PJ", "MP")} · ${_("DG", "GD")} ${standing.diff}`}</span></div>
        <div class="right"><strong>${state.worldCup ? _("Plantilla fija", "Fixed squad") : money(manager.budget)}</strong><span>${state.worldCup ? _("Sin mercado de fichajes", "No transfer market") : _("Presupuesto disponible", "Available budget")}</span></div>
      </header>
      <nav class="nav">
        ${navButton("home", _("Inicio", "Home"))}
        ${navButton("squad", _("Plantilla", "Squad"))}
        ${state.worldCup ? "" : navButton("market", _("Mercado", "Market"))}
        ${navButton("fixtures", _("Partidos", "Matches"))}
        ${navButton("team", _("Equipo", "Team"))}
        <button data-action="reset" class="danger">${confirmReset ? _("Confirmar nueva partida", "Confirm new game") : _("Nueva partida", "New game")}</button>
        ${confirmReset ? `<button data-action="cancel-reset">${_("Cancelar", "Cancel")}</button>` : ""}
        <button data-action="save-file" class="save-file" title="${_("Guardar partida en un archivo", "Save game to a file")}">${_("Guardar", "Save")}</button>
        <button data-action="load-file" class="save-file" title="${_("Cargar partida desde un archivo", "Load game from a file")}">${_("Cargar", "Load")}</button>
        <span class="nav-lang">${langSelector()}</span>
        ${navButton("titles", _("Títulos", "Titles"), "push-right")}
        ${state.onlineAuto ? `<button data-online="exit" class="danger" title="${_("Salir de la liga online", "Leave the online league")}">${_("Salir", "Leave")}</button>` : ""}
      </nav>
      ${renderView()}
      ${renderAdvanceDock()}
      ${state.negotiation ? renderNegotiationModal() : state.pendingWarning ? renderWarningModal() : state.lastResult ? renderResultModal() : state.wcFinalModal ? renderWcFinalModal() : state.galaModal ? renderGalaModal() : ""}
    </div>
  `;
    bindEvents();
  } catch (error) {
    console.error(error);
    stopAdvance();
    if (!teamById(state.managerTeamId)) state.managerTeamId = null;
    activeView = "home";
    homeMode = "league";
    selectedTeamId = null;
    selectedPlayerId = null;
    try {
      render();
    } catch (secondError) {
      console.error(secondError);
      app.innerHTML = `<main class="screen"><section class="panel"><h2>${_("Error de interfaz", "Interface error")}</h2><p class="muted">${_("Ha ocurrido un error al dibujar la pantalla, pero tu partida no se ha perdido. Usa el botón \"Guardar\" para exportar un archivo de seguridad y recarga la página.", "An error occurred while drawing the screen, but your game was not lost. Use the \"Save\" button to export a backup file and reload the page.")}</p></section></main>`;
      bindEvents();
    }
  }
}

function navButton(view, label, extraClass = "") {
  return `<button data-view="${view}" class="${activeView === view ? "active" : ""} ${extraClass}">${label}</button>`;
}

function renderTeamSelect() {
  const league = leagueById(selectedLeagueId || "BR");
  const teams = leagueTeamsPreview(league);
  return `
    <main class="screen">
      <div class="title-row">
        <div>
          <h1>Quidditch Manager</h1>
          <p class="muted">${league.description}</p>
        </div>
        <div class="title-side" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
          ${langSelector()}
          <span class="pill">${league.name} · ${_("Versión", "Version")} ${GAME_VERSION}</span>
        </div>
      </div>
      <div class="form-row">
        <button data-load-file class="primary" title="${_("Cargar una partida guardada en un archivo", "Load a saved game from a file")}">${_("Cargar partida guardada", "Load saved game")}</button>
        <button data-back-league>← ${_("Cambiar de liga", "Change league")}</button>
      </div>
      <label class="option-check">
        <input type="checkbox" id="zeroStatsOption" checked />
        <span>${_("Empezar con las estadísticas desde cero: los equipos parten con 0 ligas y 0 copas.", "Start with statistics from zero: teams begin with 0 leagues and 0 cups.")}</span>
      </label>
      <section class="team-pick">
        ${teams.map((team) => `
          <button data-team-pick="${team.TeamID}">
            <span class="team-name">${team.Name}</span><br />
            <span class="muted">${team.Country}</span><br /><br />
            <span class="pill">OVR ${team.realOVR}</span>
            <span class="pill">${money(team.budget)}</span>
            <span class="pill">${team.ReputationStars}★</span>
          </button>
        `).join("")}
      </section>
    </main>
  `;
}

function renderLeagueSelect() {
  return `
    <main class="screen">
      ${lastLoadError ? `
      <div class="panel" style="border-color:#c0392b; margin-bottom:16px">
        <h2 style="color:#c0392b">${_("Tu partida guardada no se pudo leer", "Your saved game could not be read")}</h2>
        <p class="muted">${_("Al recargar, la partida automática dio este error:", "On reload, the automatic save gave this error:")}<br /><code>${lastLoadError.replace(/</g, "&lt;")}</code></p>
        <p class="muted"><b>${_("No se ha borrado nada:", "Nothing was deleted:")}</b> ${_("tu partida sigue guardada (y además en una copia de seguridad). Para recuperarla cuando lo haya arreglado, no empieces una partida nueva: primero dame el detalle del error de arriba.", "your game is still saved (and also in a backup). To recover it once I fix it, do not start a new game: first give me the error detail above.")}</p>
      </div>
      ` : ""}
      <div class="title-row">
        <div>
          <h1>Quidditch Manager</h1>
          <p class="muted">${_("Elige la liga que quieres dirigir. Cada liga tiene su propia copa, sus títulos y su mercado de fichajes.", "Choose the league you want to manage. Each league has its own cup, its titles and its transfer market.")}</p>
        </div>
        <div class="title-side" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
          ${langSelector()}
          <span class="pill">${_("Versión", "Version")} ${GAME_VERSION}</span>
        </div>
      </div>
      <div class="form-row">
        <button data-load-file class="primary" title="${_("Cargar una partida guardada en un archivo", "Load a saved game from a file")}">${_("Cargar partida guardada", "Load saved game")}</button>
        <button data-career-start class="primary" title="${_("Juega como un único jugador: tu club lo gestiona la IA, tú entrenas, juegas, recibes ofertas y construyes tu leyenda.", "Play as a single player: your club is run by the AI, you train, play, receive offers and build your legend.")}">${_("Carrera de Jugador", "Player Career")}</button>
        <button data-online="open" class="primary" title="${_("Juega online: el tiempo avanza solo en el servidor, entra a ver la temporada y gestiona tu equipo en vivo.", "Play online: time advances on its own on the server, join to watch the season and manage your team live.")}">${_("Liga Online", "Online League")}</button>
      </div>
      <section class="league-pick">
        ${LEAGUES.map((league) => `
          <button data-league-pick="${league.id}">
            <span class="team-name">${league.name}</span><br />
            <span class="muted">${league.description}</span><br /><br />
            <span class="pill">${league.Teams.length} ${_("equipos", "teams")}</span>
            <span class="pill">${_("Copa", "Cup")}: ${league.cupShortName}</span>
          </button>
        `).join("")}
      </section>
    </main>
  `;
}

function renderWorldCupHome() {
  const selected = state.managerTeamId ? teamById(state.managerTeamId) : null;
  const final = worldCupFinalFixture();
  const nextFixture = state.managerTeamId ? nextManagerFixture(true) : null;
  const tables = wcGroupTables(state);
  const qf = state.fixtures.filter((fixture) => fixture.competition === "worldcup" && fixture.round === "Cuartos de final");
  const sf = state.fixtures.filter((fixture) => fixture.competition === "worldcup" && fixture.round === "Semifinal");
  const third = state.fixtures.find((fixture) => fixture.competition === "worldcup" && fixture.round === "Tercer puesto");
  const bracketRow = (fixture, fallbackHome, fallbackAway) => {
    if (!fixture) return "";
    const home = fixture.homeId ? teamName(fixture.homeId) : fallbackHome || _("Por decidir", "TBD");
    const away = fixture.awayId ? teamName(fixture.awayId) : fallbackAway || _("Por decidir", "TBD");
    const result = fixture.played ? `<b>${fixture.homeScore}-${fixture.awayScore}</b>` : _("Pendiente", "Pending");
    return `<div class="cup-match"><span class="pill">${formatDate(fixture.date, true)}</span><span><strong>${home}</strong> ${_("vs", "vs")} <strong>${away}</strong></span><span class="result">${result}</span></div>`;
  };
  return `
    <main class="screen grid two">
      <section class="panel">
        <div class="title-row"><h2>${_("Copa del Mundo de Quidditch", "Quidditch World Cup")} ${state.seasonYear}</h2><span class="pill">${selected ? _("Diriges a ", "You manage ") + selected.Name : _("Mundial", "World Cup")}</span></div>
        ${final && final.played
          ? `<div class="cup-champion"><div><b>${teamName(final.winnerId)}</b><span class="muted">${_("Se proclama campeón del mundo de Quidditch", "is proclaimed Quidditch world champion")} ${state.seasonYear}.</span></div></div>`
          : `<p class="muted">${_("Fase de grupos (1, 5 y 9 de julio) → cuartos (14-17) → semifinales (22-23) → tercer puesto (29) y final (31). Tienes días de descanso entre partidos para recuperar a tus jugadores.", "Group stage (1, 5 and 9 July) → quarters (14-17) → semi-finals (22-23) → third place (29) and final (31). You have rest days between matches to recover your players.")}</p>`}
        ${[["A", tables.A], ["B", tables.B], ["C", tables.C], ["D", tables.D]].map(([letter, rows]) => `
          <h3>${_("Grupo", "Group")} ${letter}</h3>
          <div class="table-scroll compact">
            <table class="league-table">
              <thead><tr><th></th><th>${_("Selección", "Team")}</th><th>${_("PJ", "MP")}</th><th>${_("G", "W")}</th><th>${_("E", "D")}</th><th>${_("P", "L")}</th><th>GF</th><th>GC</th><th>${_("DG", "GD")}</th><th>Pts</th></tr></thead>
              <tbody>
                ${rows.map((row, index) => `
                  <tr data-wc-team="${row.teamId}" class="clickable">
                    <td class="rank">${index + 1}</td>
                    <td>${row.name}${row.teamId === state.managerTeamId ? " <span class='status-good'>★</span>" : ""}</td>
                    <td>${row.played}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td>
                    <td>${row.for}</td><td>${row.against}</td><td>${row.diff}</td><td><b>${row.points}</b></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`).join("")}
      </section>
      <aside class="grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Próximo partido", "Next match")}</h2><span class="pill">${nextFixture ? formatDate(nextFixture.date, true) : _("Mundial", "World Cup")}</span></div>
          ${nextFixture
            ? `
              <div class="scoreline">
                <span>${nextFixture.homeId ? teamName(nextFixture.homeId) : _("Por decidir", "TBD")}</span>
                <b>${_("vs", "vs")}</b>
                <span>${nextFixture.awayId ? teamName(nextFixture.awayId) : _("Por decidir", "TBD")}</span>
              </div>
              <p class="muted">${competitionLabel(nextFixture)} · ${nextFixture.round}. ${_("Al llegar al día del partido el avance se pausa para que puedas tocar la alineación.", "When the matchday arrives, advance pauses so you can tweak the lineup.")}</p>
            `
            : `<p class="muted">${final && final.played ? _("El Mundial ha terminado.", "The World Cup has finished.") : _("No hay más partidos pendientes para tu selección.", "No more matches pending for your national team.")}</p>`}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Eliminatorias", "Knockouts")}</h2><span class="pill">${_("Bracket", "Bracket")}</span></div>
          <div class="cup-bracket">
            ${qf.map((fixture) => bracketRow(fixture, _("1º grupo", "Group 1st"), _("2º grupo", "Group 2nd"))).join("")}
            ${sf.map((fixture) => bracketRow(fixture)).join("")}
            ${bracketRow(third)}
            ${bracketRow(final, _("Ganador SF1", "SF1 winner"), _("Ganador SF2", "SF2 winner"))}
          </div>
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Tu selección", "Your national team")}</h2><span class="pill">${selected ? Math.round(computedTeamOVR(selected)) + " OVR" : ""}</span></div>
          ${selected
            ? `<div class="feed">${playersFor(selected.TeamID).sort((a, b) => rating(b) - rating(a)).map((player) => `<div class="feed-item"><span>${posName(player.Position)}</span><span>${player.Name}</span><span>${player.OVR}</span></div>`).join("")}</div>`
            : `<p class="muted">${_("Selecciona una selección para ver su plantilla.", "Pick a national team to see its squad.")}</p>`}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Noticias", "News")}</h2><span class="pill">${homeFeedTab === "league" ? _("Tu liga", "Your league") : _("Mundo", "World")}</span></div>
          ${renderFeedPanel()}
        </section>
      </aside>
    </main>
  `;
}

function renderView() {
  if (state.worldCup) {
    if (activeView === "squad") return renderWorldCupGroupView("squad");
    if (activeView === "fixtures") return renderWorldCupGroupView("fixtures");
    if (activeView === "titles") return renderWorldCupHistory();
    if (activeView === "team") return renderTeamPage(selectedTeamId || state.managerTeamId);
    if (activeView === "player") return renderPlayerPage(selectedPlayerId);
    return renderWorldCupHome();
  }
  if (activeView === "squad") return renderSquad();
  if (activeView === "market") return renderMarket();
  if (activeView === "fixtures") return renderFixtures();
  if (activeView === "team") return renderTeamPage(selectedTeamId || state.managerTeamId);
  if (activeView === "player") return renderPlayerPage(selectedPlayerId);
  if (activeView === "titles") return renderTitles();
  return renderHome();
}

function renderWorldCupGroupView(mode) {
  if (mode === "squad") {
    const lineupIds = state.selectedLineups[state.managerTeamId] || [];
    const squad = playersFor(state.managerTeamId).sort((a, b) => lineupIds.includes(b.PlayerID) - lineupIds.includes(a.PlayerID) || rating(b) - rating(a));
    return `
      <main class="screen grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Plantilla de ", "Squad of ")}${teamName(state.managerTeamId)}</h2><span class="pill">${_("Selección nacional · fija", "National team · fixed")}</span></div>
          ${renderPlayerTable(squad, "squad")}
        </section>
      </main>
    `;
  }
  const grouped = state.fixtures.reduce((acc, fixture) => { acc[fixture.date] = acc[fixture.date] || []; acc[fixture.date].push(fixture); return acc; }, {});
  return `
    <main class="screen">
      <section class="panel">
        <div class="title-row"><h2>${_("Calendario del Mundial", "World Cup schedule")} ${state.seasonYear}</h2><span class="pill">1 → 31 ${_("de julio", "July")}</span></div>
        <div class="fixture-list">
          ${Object.entries(grouped).map(([date, fixtures]) => fixtures.map((fixture) => `
            <div class="fixture">
              <span class="pill">${formatDate(date, true)}</span>
              <span><strong>${competitionLabel(fixture)}</strong> · ${fixture.round}: <strong>${fixture.homeId ? teamName(fixture.homeId) : _("Por decidir", "TBD")}</strong> ${_("vs", "vs")} <strong>${fixture.awayId ? teamName(fixture.awayId) : _("Por decidir", "TBD")}</strong></span>
              <span class="result">${fixture.played ? `${fixture.homeScore}-${fixture.awayScore}` : _("Pendiente", "Pending")}</span>
            </div>
          `).join("")).join("")}
        </div>
      </section>
    </main>
  `;
}

function worldCupTitlesFor(teamId) {
  const results = state.worldCup?.league?.worldCupResults || state.worldCupResults || [];
  return results.filter((result) => result.champion && result.champion.id === teamId).length;
}

function renderWorldCupHistory() {
  const results = (state.worldCup?.league?.worldCupResults || state.worldCupResults || []).slice().reverse();
  if (!results.length) return `<main class="screen"><section class="panel"><div class="title-row"><h2>${_("Títulos", "Trophies")}</h2></div><p class="muted">${_("Todavía no hay campeón del mundo registrado.", "No world champion registered yet.")}</p></section></main>`;
  return `
    <main class="screen">
      <section class="panel">
        <div class="title-row"><h2>${_("Palmarés del Mundial", "World Cup honours")}</h2><span class="pill">${results.length} ${_("edición(es)", "edition(s)")}</span></div>
        ${results.map((result) => `
          <div class="cup-champion">
            <div><b>${result.year}: ${result.champion ? result.champion.name : "—"}</b><span class="muted">${_("Campeón del mundo", "World champion")} · ${_("subcampeón", "runner-up")} ${result.runnerUp ? result.runnerUp.name : "—"}${result.third ? " · " + _("3º", "3rd") + " " + result.third.name : ""}</span></div>
          </div>`).join("")}
      </section>
    </main>
  `;
}

function renderHome() {
  const next = nextManagerFixture(true);
  const cupFinalFixture = cupFinal();
  const cupDone = Boolean(cupFinalFixture && cupFinalFixture.played);
  const champion = cupDone && cupFinalFixture.winnerId ? teamById(cupFinalFixture.winnerId) : null;
  const wrapIntro = state.pendingLeagueWrap && leagueIsFinished() && !cupDone;
  const wrapDone = state.pendingLeagueWrap && cupDone;
  const cupLive = !state.pendingLeagueWrap && cupFixtures().length > 0;
  const euroActive = Boolean(state.euroCup && Number(state.currentDate.slice(0, 4)) >= (state.euroCup.year || state.seasonYear + 1));
  const showEuro = euroActive && homeMode === "euro";
  const championsActive = Boolean(state.championsCup && championsCupSeason(state.seasonYear));
  const showChampions = championsActive && homeMode === "champions";
  const statsScope = showEuro ? "euro" : showChampions ? "champions" : "league";
  const mainTitle = showChampions ? _("Torneo de Campeones", "Champions Tournament") : showEuro ? _("Copa Europea", "European Cup") : wrapDone || cupLive ? cupName() : wrapIntro ? _("Clasificación final", "Final standings") : _("Clasificación", "Standings");
  const mainPill = showChampions ? money(150000) : showEuro ? money(250000) : wrapDone || cupLive ? money(150000) : _("Actualización automática", "Automatic update");
  const mainContent = showChampions
    ? renderChampionsHome()
    : showEuro
    ? renderEuroHome()
    : wrapDone
      ? `
        <div class="cup-champion">
          <div><b>${champion ? champion.Name : "—"}</b><span class="muted">${_("Se proclama campeón de la", "is proclaimed champion of the")} ${cupName()} ${_("y gana", "and wins")} ${money(150000)}.</span></div>
        </div>
        ${renderCupBracket()}
        <br />
        ${state.galaPending && !state.galaResult
          ? `<button data-gala class="primary">${_("Celebrar la gala (20 de agosto)", "Hold the gala (20 August)")}</button>`
          : `
            ${state.galaResult ? `
              <div class="cup-champion">
                <div><b>${state.galaResult.winnerName}</b><span class="muted">${_("Elegido Mejor Jugador de la Temporada de la", "Chosen Best Player of the Season of the")} ${leagueInfo().name} ${state.galaResult.seasonYear}/${state.galaResult.seasonYear + 1} · ${state.galaResult.winnerTeam} · ${_("Escoba de Oro", "Golden Broom")}.</span></div>
              </div>
              ${state.galaResult.intl ? `
              <div class="cup-champion">
                <div><b>${state.galaResult.intl.winnerName}</b><span class="muted">${_("Elegido Mejor Jugador del Mundo", "Chosen World Player of the Year")} ${state.galaResult.seasonYear}/${state.galaResult.seasonYear + 1} · ${state.galaResult.intl.winnerTeam} · ${_("Escoba de Oro Internacional", "International Golden Broom")}.</span></div>
              </div>
              ` : ""}
            ` : ""}
            <button data-next-season class="primary">${_("Siguiente temporada", "Next season")}</button>`}
      `
      : wrapIntro
        ? `
        <div class="cup-champion">
          <div><b>${state.standings[0]?.name || "—"}</b><span class="muted">${_("Se proclama campeón de la liga", "is proclaimed league champion")} ${state.seasonYear}/${state.seasonYear + 1}.</span></div>
        </div>
        ${renderLeagueTable(true)}
        ${isWorldCupSeason() && state.worldCupPlayedYear !== state.seasonYear
          ? `<div class="cup-champion"><div><b>${_("Copa del Mundo de Quidditch", "Quidditch World Cup")} ${state.seasonYear + 1}</b><span class="muted">${_("Este verano se disputa el Mundial. Elige una selección nacional y dirígela en la fase de grupos y el bracket.", "This summer the World Cup is played. Pick a national team and lead it through the group stage and the bracket.")}</span></div></div>`
          : championsCupSeason(state.seasonYear)
            ? `<p class="muted">${_("Al acabar la liga se juega el Torneo de Campeones", "When the league ends, the Champions Tournament is played")} ${state.seasonYear + 1}: ${_("los campeones de todas las ligas en un bracket (5, 12, 19 y 26 de julio). El campeón entre campeones se lleva", "the champions of all leagues in a bracket (5, 12, 19 and 26 July). The champion of champions takes")} ${money(150000)}. ${_("Después llegará la", "Then comes the")} ${cupName()} ${_("en agosto.", "in August.")}</p>`
            : `<p class="muted">${_("Los 4 primeros se clasifican para la", "The top 4 qualify for the")} ${cupName()}: ${_("semifinales el 5 y el 10 de agosto, final el 15 de agosto. El campeón se lleva", "semi-finals on 5 and 10 August, final on 15 August. The champion takes")} ${money(150000)} ${_("y el subcampeón", "and the runner-up")} ${money(60000)}.</p>`}
        <br />
        <button data-start-cup class="primary">${isWorldCupSeason() && state.worldCupPlayedYear !== state.seasonYear ? _("Jugar la Copa del Mundo", "Play the World Cup") : championsCupSeason(state.seasonYear) ? _("Comenzar el Torneo de Campeones", "Start the Champions Tournament") : `${_("Avanzar a la", "Advance to the")} ${cupShortName()}`}</button>
      `
      : cupLive ? renderCupBracket() : renderLeagueTable();
  return `
    <main class="screen grid two">
      <section class="panel">
        <div class="title-row">
          <h2>${mainTitle}</h2>
          <div class="form-row">
            <span class="pill">${mainPill}</span>
          </div>
        </div>
        ${euroActive || championsActive ? `
          <div class="tabs">
          <button data-home-mode="league" class="${homeMode === "league" ? "active" : ""}">${_("Liga", "League")}</button>
          ${euroActive ? `<button data-home-mode="euro" class="${homeMode === "euro" ? "active" : ""}">${_("Copa Europea", "European Cup")}</button>` : ""}
          ${championsActive ? `<button data-home-mode="champions" class="${homeMode === "champions" ? "active" : ""}">${_("Torneo de Campeones", "Champions Tournament")}</button>` : ""}
        </div>` : ""}
        ${mainContent}
      </section>
      <aside class="grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Próximo partido", "Next match")}</h2><span class="pill">${next ? formatDate(next.date, true) : _("Final", "End")}</span></div>
          ${next ? `
            <div class="scoreline">
              <span>${teamName(next.homeId)}</span>
              <b>${_("vs", "vs")}</b>
              <span>${teamName(next.awayId)}</span>
            </div>
            <p class="muted">${competitionLabel(next)} · ${next.round}. ${_("Al llegar al día del partido el avance se pausa para que puedas tocar la alineación.", "When the match day arrives, the advance pauses so you can adjust the lineup.")}</p>
          ` : `<p class="muted">${cupFixtures().length && !cupFinal()?.played ? `${_("Tu equipo ya no disputa la", "Your team no longer plays the")} ${cupName()}.` : _("No quedan partidos pendientes para tu equipo.", "No pending matches left for your team.")}</p>`}
        </section>
        ${showEuro ? `<section class="panel">${euroEliminatoriasHtml()}</section>` : ""}
        <section class="panel">
          <div class="title-row"><h2>${_("Máximos puntuadores", "Top scorers")}</h2><span class="pill">Quaffle${showEuro ? " · " + _("Europa", "Europe") : showChampions ? " · " + _("Torneo", "Tournament") : ""}</span></div>
          ${renderStatsTable("goals", statsScope)}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Buscadores", "Seekers")}</h2><span class="pill">Snitchs${showEuro ? " · " + _("Europa", "Europe") : showChampions ? " · " + _("Torneo", "Tournament") : ""}</span></div>
          ${renderStatsTable("snitches", statsScope)}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Noticias", "News")}</h2><span class="pill">${homeFeedTab === "league" ? _("Tu liga", "Your league") : _("Mundo", "World")}</span></div>
          ${renderFeedPanel()}
        </section>
      </aside>
    </main>
  `;
}

function euroBracketRow(fixture) {
  if (!fixture) return "";
  if (!fixture.homeId || !fixture.awayId) return `<div class="cup-match"><span class="pill">${formatDate(fixture.date, true)}</span><span><span class="muted">Por decidir</span></span><span class="result">Pendiente</span></div>`;
  const home = String(fixture.homeId).startsWith("@") ? "Ganador" : teamName(fixture.homeId);
  const away = String(fixture.awayId).startsWith("@") ? "Ganador" : teamName(fixture.awayId);
  if (home === "Ganador" || away === "Ganador") return `<div class="cup-match"><span class="pill">${formatDate(fixture.date, true)}</span><span><span class="muted">Por decidir</span></span><span class="result">${fixture.played ? `<b>${fixture.homeScore}-${fixture.awayScore}</b>` : "Pendiente"}</span></div>`;
  const result = fixture.played ? `<b>${fixture.homeScore}-${fixture.awayScore}</b>` : "Pendiente";
  return `<div class="cup-match"><span class="pill">${formatDate(fixture.date, true)}</span><span><strong>${home}</strong> vs <strong>${away}</strong></span><span class="result">${result}</span></div>`;
}
function euroBracketBlock(title, fixtures, emptyText) {
  const rows = fixtures.map((fixture) => euroBracketRow(fixture)).join("");
  return `
    <div class="cup-title">${title}</div>
    <div class="cup-bracket">
      ${rows || `<p class="muted">${emptyText}</p>`}
    </div>`;
}
function euroEliminatoriasHtml() {
  const final = euroFinalFixture();
  const r16 = state.fixtures.filter((fixture) => fixture.competition === "eurocup" && fixture.round === "Octavos de final");
  const qf = state.fixtures.filter((fixture) => fixture.competition === "eurocup" && fixture.round === "Cuartos de final");
  const sf = state.fixtures.filter((fixture) => fixture.competition === "eurocup" && fixture.round === "Semifinal");
  const groupsDone = euroGroupLeaders().length >= 8;
  return `
    <div class="title-row"><h2>${_("Eliminatorias", "Knockouts")}</h2><span class="pill">${_("Copa Europea", "European Cup")}</span></div>
    ${euroBracketBlock(_("Octavos de final", "Round of 16"), r16, groupsDone ? _("Se sortean los octavos de final.", "The round of 16 is drawn.") : _("Termina la fase de grupos para conocer los octavos.", "Finish the group stage to know the round of 16."))}
    ${euroBracketBlock(_("Cuartos de final", "Quarter-finals"), qf, _("Se resolverá tras los octavos de final.", "Resolved after the round of 16."))}
    ${euroBracketBlock(_("Semifinales", "Semi-finals"), sf, _("Se resolverá tras los cuartos de final.", "Resolved after the quarter-finals."))}
    ${euroBracketBlock(_("Final", "Final"), final ? [final] : [], _("Se resolverá tras las semifinales.", "Resolved after the semi-finals."))}
  `;
}

function renderChampionsHome() {
  const r16 = state.fixtures.filter((fixture) => fixture.competition === "champions" && fixture.round === "Dieciseisavos de final");
  const qf = state.fixtures.filter((fixture) => fixture.competition === "champions" && fixture.round === "Cuartos de final");
  const sf = state.fixtures.filter((fixture) => fixture.competition === "champions" && fixture.round === "Semifinal");
  const final = state.fixtures.filter((fixture) => fixture.competition === "champions" && fixture.round === "Final");
  const nextChampions = state.fixtures.filter((fixture) => fixture.competition === "champions" && !fixture.played && (fixture.homeId === state.managerTeamId || fixture.awayId === state.managerTeamId)).sort(sortFixtures)[0];
  const nextChampionsBlock = nextChampions
    ? `
      <div class="title-row"><h3>${_("Próximo partido", "Next match")}</h3><span class="pill">${formatDate(nextChampions.date, true)}</span></div>
      <div class="scoreline">
        <span>${teamName(nextChampions.homeId)}</span>
        <b>${_("vs", "vs")}</b>
        <span>${teamName(nextChampions.awayId)}</span>
      </div>
      <p class="muted">${nextChampions.round}. ${_("Al llegar al día del partido el avance se pausa.", "When the matchday arrives, advance pauses.")}</p>`
    : "";
  return `
    ${state.championsCup?.done && state.championsCupResult
      ? `<div class="cup-champion"><div><b>${state.championsCupResult.champion.name}</b><span class="muted">${_("Campeón del Torneo de Campeones", "Champions Tournament winner")} ${state.championsCupResult.year} · ${money(150000)}.${state.championsCupResult.runnerUp ? ` ${_("Subcampeón", "Runner-up")}: ${state.championsCupResult.runnerUp.name} (${money(60000)}).` : ""}</span></div></div>`
      : `<p class="muted">${_("El Torneo de Campeones", "The Champions Tournament")} ${state.championsCup?.year || state.seasonYear + 1} ${_("se juega en julio: los campeones de todas las ligas se miden en un bracket (primeros de julio). El campeón entre campeones gana", "is played in July: the champions of all leagues meet in a bracket (early July). The champion of champions wins")} ${money(150000)} ${_("y el subcampeón", "and the runner-up")} ${money(60000)}.</p>`}
    ${nextChampionsBlock}
    ${r16.length ? euroBracketBlock(_("Dieciseisavos de final", "Round of 16"), r16, "") : ""}
    ${euroBracketBlock(_("Cuartos de final", "Quarter-finals"), qf, _("Se resolverá tras las eliminatorias previas.", "Resolved after the previous rounds."))}
    ${euroBracketBlock(_("Semifinales", "Semi-finals"), sf, _("Se resolverá tras los cuartos de final.", "Resolved after the quarter-finals."))}
    ${euroBracketBlock(_("Final", "Final"), final, _("Se resolverá tras las semifinales.", "Resolved after the semi-finals."))}
  `;
}

function renderEuroHome() {
  repairEuroCupGroups();
  const final = euroFinalFixture();
  const nextEuro = state.fixtures.filter((fixture) => fixture.competition === "eurocup" && !fixture.played && (fixture.homeId === state.managerTeamId || fixture.awayId === state.managerTeamId)).sort(sortFixtures)[0];
  const tables = euroGroupTables();
  const nextEuroBlock = nextEuro
    ? `
      <div class="title-row"><h3>${_("Próximo partido europeo", "Next European match")}</h3><span class="pill">${formatDate(nextEuro.date, true)}</span></div>
      <div class="scoreline">
        <span>${teamName(nextEuro.homeId)}</span>
        <b>${_("vs", "vs")}</b>
        <span>${teamName(nextEuro.awayId)}</span>
      </div>
      <p class="muted">${nextEuro.round}. ${_("Al llegar al día del partido el avance se pausa.", "When the matchday arrives, advance pauses.")}</p>`
    : "";
  return `
    ${final && final.played
      ? `<div class="cup-champion"><div><b>${teamName(final.winnerId)}</b><span class="muted">${_("Campeón de la Copa Europea", "European Cup champion")} ${state.euroCup?.year || ""} · ${money(250000)} ${_("al campeón", "to the champion")}, ${money(100000)} ${_("al subcampeón", "to the runner-up")}.</span></div></div>`
      : `<p class="muted">${_("Fase de grupos (enero y febrero) → octavos (marzo) → cuartos (abril) → semifinales (28-29 abril) y final (20 mayo). Los partidos se intercalan con la liga.", "Group stage (January and February) → round of 16 (March) → quarters (April) → semi-finals (28-29 April) and final (20 May). Matches are interleaved with the league.")}</p>`}
    ${nextEuroBlock}
    <div class="euro-groups">
      ${EURO_GROUPS.map((letter) => {
        const rows = tables[letter] || [];
        if (!rows.length) return "";
        return `
          <h3>${_("Grupo", "Group")} ${letter}</h3>
          <div class="table-scroll compact">
            <table class="league-table">
              <thead><tr><th></th><th>${_("Equipo", "Team")}</th><th>${_("PJ", "MP")}</th><th>${_("G", "W")}</th><th>${_("E", "D")}</th><th>${_("P", "L")}</th><th>GF</th><th>GC</th><th>${_("DG", "GD")}</th><th>Pts</th></tr></thead>
              <tbody>
                ${rows.map((row, index) => `
                  <tr data-open-team="${row.teamId}" class="clickable">
                    <td class="rank">${index + 1}</td>
                    <td>${row.name}${row.teamId === state.managerTeamId ? " <span class='status-good'>★</span>" : ""}</td>
                    <td>${row.played}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td>
                    <td>${row.for}</td><td>${row.against}</td><td>${row.diff}</td><td><b>${row.points}</b></td>
                  </tr>`).join("")}
              </tbody>
            </table>
          </div>`;
      }).join("")}
    </div>
  `;
}

function renderLeagueTable(showPrizes = false) {
  const euroSpots = isEuroCupSeason(state.seasonYear + 1) ? (euroQualifyingSpots().spots[state.leagueId] || 0) : 0;
  return `
    <div class="table-scroll">
      <table class="league-table">
        <thead><tr><th></th><th>${_("Equipo", "Team")}</th><th>${_("PJ", "MP")}</th><th>${_("G", "W")}</th><th>${_("E", "D")}</th><th>${_("P", "L")}</th><th>GF</th><th>GC</th><th>${_("DG", "GD")}</th><th>Pts</th>${showPrizes ? `<th>${_("Premio", "Prize")}</th>` : ""}</tr></thead>
        <tbody>
          ${state.standings.map((row, index) => `
            <tr class="clickable${index < euroSpots ? " euro-qualified" : ""}" data-open-team="${row.teamId}">
              <td class="rank">${index + 1}</td><td>${row.name}</td><td>${row.played}</td><td>${row.wins}</td><td>${row.draws}</td><td>${row.losses}</td><td>${row.for}</td><td>${row.against}</td><td>${row.diff}</td><td><b>${row.points}</b></td>${showPrizes ? `<td>${money(leaguePrizeFor(index + 1))}</td>` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${euroSpots ? `<p class="muted small">${_("La raya azul marca los", "The blue line marks the")} ${euroSpots} ${_("primeros, que se clasifican para la Copa Europea", "top teams, who qualify for the European Cup")} ${state.seasonYear + 2}.</p>` : ""}
    </div>
  `;
}

function renderCupBracket() {
  const list = cupFixtures();
  const seeds = cupSeededTeams();
  const sf1 = list.find((fixture) => fixture.round === "Semifinal 1") || null;
  const sf2 = list.find((fixture) => fixture.round === "Semifinal 2") || null;
  const final = cupFinal();
  const matchRow = (seedHome, seedAway, fixture, fallbackDate) => {
    const home = fixture ? fixture.homeId : seeds[seedHome];
    const away = fixture ? fixture.awayId : seeds[seedAway];
    const result = fixture && fixture.played ? `<b>${fixture.homeScore}-${fixture.awayScore}</b>` : _("Pendiente", "Pending");
    return `<div class="cup-match"><span class="pill">${fixture ? formatDate(fixture.date, true) : fallbackDate}</span><span><strong>${teamName(home)}</strong> ${_("vs", "vs")} <strong>${teamName(away)}</strong></span><span class="result">${result}</span></div>`;
  };
  const finalHome = final ? final.homeId : (sf1 && sf1.winnerId ? sf1.winnerId : null);
  const finalAway = final ? final.awayId : (sf2 && sf2.winnerId ? sf2.winnerId : null);
  const finalResult = final && final.played ? `<b>${final.homeScore}-${final.awayScore}</b>` : _("Pendiente", "Pending");
  const finalNames = finalHome && finalAway ? `<strong>${teamName(finalHome)}</strong> ${_("vs", "vs")} <strong>${teamName(finalAway)}</strong>` : _("Por decidir", "TBD");
  const finalDate = final ? formatDate(final.date, true) : formatDate(cupFinalDate(cupYear()), true);
  return `
    <div class="cup-bracket">
      <div class="cup-title">${cupName()} · ${money(150000)} ${_("al campeón", "to the champion")} · ${money(60000)} ${_("al subcampeón", "to the runner-up")}</div>
      ${matchRow(0, 3, sf1, formatDate(cupSemiFinal1Date(cupYear()), true))}
      ${matchRow(1, 2, sf2, formatDate(cupSemiFinal2Date(cupYear()), true))}
      <div class="cup-match final"><span class="pill">${finalDate}</span><span>${finalNames}</span><span class="result">${finalResult}</span></div>
    </div>
  `;
}

function renderStatsTable(kind, scope = "league") {
  const key = scope === "euro" ? (kind === "goals" ? "euroGoals" : "euroSnitches") : kind;
  const appsKey = scope === "euro" ? "euroApps" : null;
  const championsTeams = scope === "champions" ? new Set(state.fixtures.filter((fixture) => fixture.competition === "champions").flatMap((fixture) => [fixture.homeId, fixture.awayId]).filter((id) => id && !String(id).startsWith("@"))) : null;
  const rows = state.players
    .filter((player) => {
      if (scope === "euro" && Number(player[appsKey] || 0) <= 0) return false;
      if (scope === "league" && player.leagueId !== state.leagueId) return false;
      if (scope === "champions" && !championsTeams.has(player.TeamID)) return false;
      return Number(player[key] || 0) > 0;
    })
    .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0) || rating(b) - rating(a)).slice(0, 8);
  if (!rows.length) return `<p class="muted">${_("Todavía no hay registros.", "No records yet.")}</p>`;
  const label = kind === "goals" ? _("Goles", "Goals") : _("Snitchs", "Snitches");
  return `
    <div class="table-scroll compact">
      <table class="data-table compact-table">
        <thead><tr><th>${_("Jugador", "Player")}</th><th>${_("Equipo", "Team")}</th><th>${label}</th></tr></thead>
        <tbody>${rows.map((player) => `<tr class="clickable" data-open-player="${player.PlayerID}"><td>${player.Name}</td><td>${teamName(player.TeamID)}</td><td><b>${player[key]}</b></td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderSquad() {
  const lineupIds = state.selectedLineups[state.managerTeamId] || [];
  const squad = playersFor(state.managerTeamId).sort((a, b) => lineupIds.includes(b.PlayerID) - lineupIds.includes(a.PlayerID) || rating(b) - rating(a));
  const starters = squad.filter((player) => lineupIds.includes(player.PlayerID));
  const avg = starters.reduce((sum, player) => sum + rating(player), 0) / Math.max(1, starters.length);
    const roleText = ["Chaser", "Beater", "Keeper", "Seeker"].map((role) => `${posName(role)}: ${starters.filter((player) => player.Position === role).length}/${REQUIRED_SLOTS.filter((slot) => slot === role).length}`).join(" · ");
  return `
    <main class="screen grid">
      <section class="metric-row">
        <div class="metric"><span class="muted">${_("Titulares", "Starters")}</span><b>${starters.length}/7</b></div>
        <div class="metric"><span class="muted">${_("Media VII", "Avg VII")}</span><b>${avg.toFixed(1)}</b></div>
        <div class="metric"><span class="muted">${_("Lesionados", "Injured")}</span><b>${squad.filter((p) => p.injured).length}</b></div>
        <div class="metric"><span class="muted">${_("Cansados", "Tired")}</span><b>${squad.filter((p) => (p.stamina ?? 100) < 60).length}</b></div>
        <div class="metric"><span class="muted">${_("Transferibles", "Transferable")}</span><b>${squad.filter((p) => p.listed).length}</b></div>
      </section>
      <section class="panel">
        <div class="title-row"><h2>${_("Plantilla y alineación", "Squad and lineup")}</h2><span class="pill">${roleText}</span></div>
        ${renderPlayerTable(squad, "squad")}
      </section>
    </main>
  `;
}

function seasonStatLine(player) {
  if (player.Position === "Keeper") return `${player.saves ?? 0} ${_("paradas", "saves")}`;
  if (player.Position === "Beater") return `${player.blocks ?? 0} ${_("bloqueos", "blocks")}`;
  if (player.Position === "Seeker") return `${player.snitches ?? 0} ${_("snitch", "snitch")}`;
  return `${player.goals ?? 0} ${_("goles", "goals")}`;
}

function renderPlayerTable(players, mode) {
  const lineupIds = state.selectedLineups[state.managerTeamId] || [];
  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>${_("Rol", "Role")}</th><th>${_("Jugador", "Player")}</th><th>Pos</th><th>OVR</th><th>${_("Edad", "Age")}</th><th>${_("Atributos", "Attributes")}</th><th>${_("Valor", "Value")}</th><th>${_("Salario", "Wage")}</th><th>${_("Moral", "Morale")}</th><th>${_("Forma", "Form")}</th><th>${_("Cond", "Cond")}</th><th>${_("Contrato", "Contract")}</th><th></th></tr></thead>
        <tbody>
          ${players.map((player) => {
            const starter = lineupIds.includes(player.PlayerID);
            const tired = (player.stamina ?? 100) < 60;
            return `
              <tr class="clickable" data-open-player="${player.PlayerID}">
                <td>${starter ? "<span class='status-good'>" + _("Titular", "Starter") + "</span>" : _("Suplente", "Bench")}</td>
                <td><b>${player.Name}</b>${player.reputation ? " <span class='status-good' title='" + _("Escoba de Oro", "Golden Broom") + "'>EO ×" + player.reputation + "</span>" : ""}${player.intlReputation ? " <span class='status-good' title='" + _("Escoba de Oro Internacional", "International Golden Broom") + "'>EOI ×" + player.intlReputation + "</span>" : ""}${player.worldCupTitles ? " <span class='status-good' title='" + _("Mundial de Quidditch", "Quidditch World Cup") + "'>M ×" + player.worldCupTitles + "</span>" : ""}${player.injured ? " <span class='status-bad'>" + _("Les.", "Inj.") + " " + (player.injuryDays ?? 0) + "d</span>" : ""}${tired ? " <span class='status-warn'>" + _("Cansado", "Tired") + "</span>" : ""}<br /><span class='muted small'>${mode === "market" ? (player.TeamID === "FREE" ? _("Agente libre", "Free agent") : teamName(player.TeamID)) : seasonStatLine(player)}</span></td>
                <td>${posName(player.Position)}</td>
                <td>${player.OVR}</td>
                <td>${player.Age}</td>
                <td>${attrName(player.Attribute1)} ${player.Value1} · ${attrName(player.Attribute2)} ${player.Value2}</td>
                <td>${money(playerValue(player))}</td>
                <td>${money(player["Salary(G/week)"])}/sem</td>
                <td>${player.morale ?? 0}</td>
                <td>${player.form ?? 0}</td>
                <td class="${tired ? "text-warn" : ""}">${Math.round(player.stamina ?? 100)}</td>
                <td>${player.ContractYears ?? 0}a${Number(player.ContractYears ?? 0) <= 1 ? " <span class='status-warn'>Renovar</span>" : ""}</td>
                <td>${renderPlayerAction(player, mode, starter)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPlayerAction(player, mode, starter) {
  if (state.careerMode) return "";
  if (state.worldCup) {
    if (player.TeamID !== state.managerTeamId) return "";
    return `
      ${starter
        ? `<button data-demote="${player.PlayerID}">${_("Hacer suplente", "Make sub")}</button>`
        : `<button data-promote="${player.PlayerID}" ${player.injured ? "disabled" : ""}>${_("Hacer titular", "Make starter")}</button>`}
    `;
  }
  if (player.leagueId && player.leagueId !== state.leagueId) {
    if (mode !== "market") return "";
    if (player.TeamID === "FREE") return "";
    if (isShielded(player)) return `<button data-intl-offer="${player.PlayerID}" disabled>${_("Blindado hasta", "Shielded until")} ${formatDate(player.shieldedUntil, true)}</button>`;
    if (clauseLocked(player)) return `<button data-intl-offer="${player.PlayerID}" disabled>${_("Cláusula bloqueada hasta", "Clause locked until")} ${formatDate(player.clauseLockUntil, true)}</button>`;
    const manager = teamById(state.managerTeamId);
    const minIntlTotal = Math.round(playerValue(player) * 0.55) + CROSS_LEAGUE_FEE;
    return `<button data-intl-offer="${player.PlayerID}" ${manager && Number(manager.budget || 0) < minIntlTotal ? "disabled" : ""} title="${_("Negociación internacional: hasta 200% del valor y 150% del salario, +70.000 G por el traspaso de liga", "International negotiation: up to 200% of value and 150% of wage, +70,000 G for the cross-league transfer")}">${_("Oferta intl. (hasta 200%)", "Intl. offer (up to 200%)")}</button>`;
  }
  if (mode === "squad") {
    const shielded = isShielded(player);
    return `
      ${starter
        ? `<button data-demote="${player.PlayerID}">${_("Hacer suplente", "Make sub")}</button>`
        : `<button data-promote="${player.PlayerID}" ${player.injured ? "disabled" : ""}>${_("Hacer titular", "Make starter")}</button>`}
      ${shielded ? "" : `<button data-sell="${player.PlayerID}">${player.listed ? _("Retirar", "Withdraw") : _("Vender", "Sell")}</button>`}
      ${shielded ? "" : `<button data-sell-league="${player.PlayerID}">${_("Vender a la liga", "Sell to league")}</button>`}
      ${Number(player.ContractYears ?? 0) <= 2 ? `<button data-renew="${player.PlayerID}">${_("Renovar", "Renew")} (${money(renewalSalary(player))}/sem)</button>` : ""}
      ${shielded
        ? `<span class="status-good">${_("Blindado hasta", "Shielded until")} ${formatDate(player.shieldedUntil, true)}</span>`
        : shieldSlotsUsed() >= 2
          ? `<span class="status-warn">${_("Límite: 2 blindados por temporada", "Limit: 2 shielded per season")}</span>`
          : `<button data-shield="${player.PlayerID}" title="${_("Pagar un 10% más de salario esta temporada para que nadie pueda comprarlo", "Pay 10% more wage this season so nobody can buy him")}">${_("Blindar +10%", "Shield +10%")}</button>`}
    `;
  }
  if (player.TeamID === state.managerTeamId) return "";
  if (isShielded(player)) return `<button data-buy="${player.PlayerID}" disabled>${_("Blindado hasta", "Shielded until")} ${formatDate(player.shieldedUntil, true)}</button>`;
  const manager = teamById(state.managerTeamId);
  const price = buyPrice(player);
  const locked = clauseLocked(player);
  const label = player.TeamID === "FREE" || player.listed ? `${_("Fichar", "Sign")} ${money(price)}` : `${_("Pag. cláusula", "Pay clause")} ${money(price)}`;
  const buyButton = `<button data-buy="${player.PlayerID}" ${manager.budget < price || (locked && !isInMarket(player)) ? "disabled" : ""}>${locked && !isInMarket(player) ? `${_("Cláusula bloqueada hasta", "Clause locked until")} ${formatDate(player.clauseLockUntil, true)}` : label}</button>`;
  const offerButton = canNegotiate(player)
    ? `<button data-offer="${player.PlayerID}">${_("Hacer oferta (55–110%)", "Make offer (55–110%)")}</button>`
    : "";
  return `${buyButton}${offerButton}`;
}

function foreignLeagues(ownLeagueId) {
  const counts = {};
  state.players.forEach((player) => {
    if (player.leagueId && player.leagueId !== ownLeagueId && player.TeamID !== "FREE" && player.TeamID !== state.managerTeamId) counts[player.leagueId] = (counts[player.leagueId] || 0) + 1;
  });
  return LEAGUES.filter((league) => counts[league.id]).map((league) => ({ id: league.id, name: league.name, count: counts[league.id] }));
}

function renderMarket() {
  const buyPool = state.players.filter((player) => player.leagueId === state.leagueId && player.TeamID !== state.managerTeamId && (player.TeamID === "FREE" || player.listed)).sort((a, b) => rating(b) - rating(a));
  const intlPool = state.players.filter((player) => player.leagueId && player.leagueId !== state.leagueId && player.TeamID !== "FREE" && player.TeamID !== state.managerTeamId).sort((a, b) => rating(b) - rating(a));
  const squad = playersFor(state.managerTeamId).sort((a, b) => rating(b) - rating(a));
  return `
    <main class="screen grid">
      <section class="panel">
        <div class="title-row"><h2>${_("Mercado", "Market")}</h2><span class="pill">${_("Agentes libres, transferibles y cláusulas", "Free agents, transferable and clauses")}</span></div>
        <div class="tabs">
          <button data-market-tab="buy" class="${marketTab === "buy" ? "active" : ""}">${_("Comprar", "Buy")}</button>
          <button data-market-tab="intl" class="${marketTab === "intl" ? "active" : ""}">${_("Internacional", "International")}</button>
          <button data-market-tab="sell" class="${marketTab === "sell" ? "active" : ""}">${_("Vender", "Sell")}</button>
        </div>
        ${marketTab === "buy" ? renderPlayerTable(buyPool, "market") : marketTab === "intl" ? `${intlPool.length ? renderPlayerTable(intlPool, "market") : `<p class="muted">${_("No hay jugadores de otras ligas disponibles para negociar.", "No players from other leagues available to negotiate.")}</p>`}<div class="title-row" style="margin-top:14px"><h2>${_("Fondos de traspaso por liga", "Transfer funds by league")}</h2><span class="pill">70.000 G ${_("por fichaje", "per signing")}</span></div><p class="muted small">${_("Cada vez que un jugador se marcha de su liga, los 70.000 G del traspaso se acumulan en el fondo de esa liga (no van a su club). Se guardan para futuras mejoras del campeonato.", "Every time a player leaves his league, the 70,000 G transfer fee accumulates in that league's fund (it doesn't go to his club). It is saved for future improvements to the championship.")}</p><div class="table-scroll"><table class="data-table"><thead><tr><th>${_("Liga", "League")}</th><th>${_("Jugadores negociables", "Negotiable players")}</th><th>${_("Fondo acumulado", "Accumulated fund")}</th></tr></thead><tbody>${foreignLeagues(state.leagueId).map((entry) => `<tr><td><b>${entry.name}</b></td><td>${entry.count}</td><td>${money(state.leagueFunds?.[entry.id] || 0)}</td></tr>`).join("")}</tbody></table></div>` : renderPlayerTable(squad, "squad")}
      </section>
    </main>
  `;
}

function careerEliminatoriasPreview() {
  if (!state.careerMode || !state.career) return [];
  const rows = [];
  const year = cupYear();
  const seen = (competition) => state.fixtures.some((fixture) => fixture.competition === competition);
  if (!seen("cup")) {
    rows.push({ date: cupSemiFinal1Date(year), competition: "cup", round: "Semifinal 1", homeId: null, awayId: null });
    rows.push({ date: cupSemiFinal2Date(year), competition: "cup", round: "Semifinal 2", homeId: null, awayId: null });
    rows.push({ date: cupFinalDate(year), competition: "cup", round: "Final", homeId: null, awayId: null });
  }
  if (isEuroCupSeason(state.seasonYear) && !seen("eurocup")) {
    const blocked = euroLeagueMatchDates(state);
    rows.push({ date: adjustEuroDate(euroR16Date(year), blocked), competition: "eurocup", round: "Octavos de final", homeId: null, awayId: null });
    rows.push({ date: adjustEuroDate(euroQfDate(year), blocked), competition: "eurocup", round: "Cuartos de final", homeId: null, awayId: null });
    rows.push({ date: adjustEuroDate(euroSfDate(year), blocked), competition: "eurocup", round: "Semifinal", homeId: null, awayId: null });
    rows.push({ date: adjustEuroDate(euroFinalDate(year), blocked), competition: "eurocup", round: "Final", homeId: null, awayId: null });
  }
  if (championsCupSeason(state.seasonYear) && !seen("champions")) {
    const blocked = championsBlockedDates(state);
    rows.push({ date: adjustEuroDate(championsR1Date(year), blocked), competition: "champions", round: "Dieciseisavos de final", homeId: null, awayId: null });
    rows.push({ date: adjustEuroDate(championsQfDate(year), blocked), competition: "champions", round: "Cuartos de final", homeId: null, awayId: null });
    rows.push({ date: adjustEuroDate(championsSfDate(year), blocked), competition: "champions", round: "Semifinal", homeId: null, awayId: null });
    rows.push({ date: adjustEuroDate(championsFinalDate(year), blocked), competition: "champions", round: "Final", homeId: null, awayId: null });
  }
  return rows;
}

function renderFixtures() {
  const visible = state.fixtures.filter((fixture) => fixture.leagueId === state.leagueId || fixture.competition === "eurocup" || fixture.competition === "champions" || (fixture.competition === "worldcup" && state.worldCup));
  visible.push(...careerEliminatoriasPreview());
  const grouped = visible.reduce((acc, fixture) => { acc[fixture.date] = acc[fixture.date] || []; acc[fixture.date].push(fixture); return acc; }, {});
  const endLabel = cupFinal()?.date || seasonFinish(state.seasonYear);
  return `
    <main class="screen">
      <section class="panel">
        <div class="title-row"><h2>${_("Calendario completo", "Full schedule")}</h2><span class="pill">${seasonStart(state.seasonYear)} → ${endLabel}</span></div>
        <div class="fixture-list">
          ${Object.entries(grouped).map(([date, fixtures]) => fixtures.map((fixture) => `
            <div class="fixture">
              <span class="pill">${formatDate(date, true)}</span>
              <span><strong>${competitionLabel(fixture)}</strong> · ${fixture.round}: <strong>${String(fixture.homeId).startsWith("@") ? _("Por decidir", "TBD") : teamName(fixture.homeId)}</strong> vs <strong>${String(fixture.awayId).startsWith("@") ? _("Por decidir", "TBD") : teamName(fixture.awayId)}</strong></span>
              <span class="result">${fixture.played ? `${fixture.homeScore}-${fixture.awayScore}` : _("Pendiente", "Pending")}</span>
            </div>
          `).join("")).join("")}
        </div>
      </section>
    </main>
  `;
}

function renderTeamPage(teamId) {
  const team = teamById(teamId);
  const isNational = state.worldCup || team.TeamID.startsWith("W");
  const leagueRows = state.leagueStandings?.[team.leagueId] || state.standings;
  const standingIndex = leagueRows.findIndex((row) => row.teamId === teamId);
  const row = leagueRows[standingIndex] || { points: 0, diff: 0 };
  const squad = playersFor(teamId).sort((a, b) => rating(b) - rating(a));
  return `
    <main class="screen grid">
      <section class="panel">
        <div class="title-row">
          <div><h2>${team.Name}</h2><span class="muted">${team.Country} · ${team.ReputationStars}★ ${_("reputación", "reputation")}${isNational ? ` · ${worldCupTitlesFor(teamId)} ${_("Mundiales", "World Cups")}` : ` · ${leagueById(team.leagueId || state.leagueId).name} · ${team.leagueTitles} ${_("Ligas", "Leagues")} · ${team.cupTitles ?? 0} ${_("Copas", "Cups")} · ${team.euroCupTitles ?? 0} ${_("Copas Europeas", "European Cups")} · ${team.championsTitles ?? 0} ${_("Torneos de Campeones", "Champions Tournaments")}`}</span></div>
          <span class="pill">${standingIndex >= 0 ? standingIndex + 1 + ".º · " + row.points + " pts · DG " + row.diff : "—"}</span>
        </div>
        <section class="metric-row">
          <div class="metric"><span class="muted">${_("OVR real", "Real OVR")}</span><b>${Math.round(computedTeamOVR(team))}</b></div>
          <div class="metric"><span class="muted">${_("Presupuesto", "Budget")}</span><b>${money(team.budget)}</b></div>
          <div class="metric"><span class="muted">${_("Jugadores", "Players")}</span><b>${squad.length}</b></div>
        </section>
      </section>
      <section class="panel">
        <div class="title-row"><h2>${_("Jugadores", "Players")}</h2><span class="pill">${_("Cláusulas disponibles", "Available clauses")}</span></div>
        ${renderPlayerTable(squad, teamId === state.managerTeamId ? "squad" : "market")}
      </section>
    </main>
  `;
}

function playerTrophyRows(player) {
  const club = teamById(player.TeamID);
  return [
    { name: `${player.reputation}`, label: _("Escoba de Oro", "Golden Broom"), value: player.reputation },
    { name: `${player.intlReputation}`, label: _("Escoba de Oro Internacional", "International Golden Broom"), value: player.intlReputation },
    { name: `${player.worldCupTitles}`, label: _("Mundiales", "World Cups"), value: player.worldCupTitles },
  ]
    .concat(club ? [{ name: `${club.leagueTitles}`, label: `${_("Ligas", "Leagues")} (${leagueById(club.leagueId || state.leagueId).name})`, value: club.leagueTitles }] : [])
    .concat(club ? [{ name: `${club.cupTitles ?? 0}`, label: `${_("Copas", "Cups")} (${leagueById(club.leagueId || state.leagueId).name})`, value: club.cupTitles ?? 0 }] : [])
    .concat(club ? [{ name: `${club.euroCupTitles ?? 0}`, label: _("Copas Europeas", "European Cups"), value: club.euroCupTitles ?? 0 }] : [])
    .concat(club ? [{ name: `${club.championsTitles ?? 0}`, label: _("Torneos de Campeones", "Champions Tournaments"), value: club.championsTitles ?? 0 }] : [])
    .map((row) => ({ ...row, value: Number(row.value ?? 0) }))
    .filter((row) => row.value > 0);
}

function renderPlayerPage(playerId) {
  const player = playerById(playerId);
  if (!player) return `<main class="screen"><section class="panel"><p class="muted">${_("Jugador no encontrado.", "Player not found.")}</p><button data-back-player class="primary">${_("Volver", "Back")}</button></section></main>`;
  const club = player.TeamID === "FREE" ? null : teamById(player.TeamID);
  const league = leagueById(player.leagueId || state.leagueId);
  const trophies = playerTrophyRows(player);
  return `
    <main class="screen grid">
      <section class="panel">
        <div class="title-row">
          <div><h2>${player.Name}</h2><span class="muted">${posName(player.Position)} · ${player.Nationality || player.Country || "—"} · ${player.TeamID === "FREE" ? "Agente libre" : club ? club.Name : "Sin equipo"}</span></div>
          <span class="pill">${club ? club.ReputationStars + "★" : "—"}</span>
        </div>
        <section class="metric-row">
          <div class="metric"><span class="muted">${_("OVR", "OVR")}</span><b>${player.OVR}</b></div>
          <div class="metric"><span class="muted">${_("Edad", "Age")}</span><b>${player.Age}</b></div>
          <div class="metric"><span class="muted">${_("Valor", "Value")}</span><b>${money(playerValue(player))}</b></div>
          <div class="metric"><span class="muted">${_("Cláusula", "Clause")}</span><b>${money(player["ReleaseClause(G)"] ?? playerValue(player) * 1.8)}</b></div>
          <div class="metric"><span class="muted">${_("Salario", "Wage")}</span><b>${money(player["Salary(G/week)"])}/sem</b></div>
        </section>
        <section class="metric-row">
          <div class="metric"><span class="muted">${_("Forma", "Form")}</span><b>${player.form ?? 0}</b></div>
          <div class="metric"><span class="muted">${_("Moral", "Morale")}</span><b>${player.morale ?? 0}</b></div>
          <div class="metric"><span class="muted">${_("Condición", "Condition")}</span><b>${player.stamina ?? 0}</b></div>
          <div class="metric"><span class="muted">${_("Contrato", "Contract")}</span><b>${player.ContractYears ?? 0}a</b></div>
          <div class="metric"><span class="muted">${_("Cláusula bloqueada", "Clause locked")}</span><b>${clauseLocked(player) ? formatDate(player.clauseLockUntil, true) : _("No", "No")}</b></div>
          <div class="metric"><span class="muted">${_("Blindado", "Shielded")}</span><b>${isShielded(player) ? formatDate(player.shieldedUntil, true) : _("No", "No")}</b></div>
        </section>
        <p><b>${_("Atributos", "Attributes")}:</b> ${attrName(player.Attribute1)} ${player.Value1} · ${attrName(player.Attribute2)} ${player.Value2}</p>
      </section>
      <section class="panel">
        ${club ? `
          <div class="title-row"><h2>${_("Club", "Club")}</h2><span class="pill">${league.name}</span></div>
          <p>${club.Name} <span class="muted">· ${club.Country}</span> — <b>${club.leagueTitles} ${_("ligas", "leagues")} · ${club.cupTitles ?? 0} ${_("copas", "cups")} · ${club.euroCupTitles ?? 0} ${_("copas europeas", "European cups")} · ${club.championsTitles ?? 0} ${_("torneos de campeones", "champions tournaments")}</b></p>
          <div class="form-row"><button data-open-team="${club.TeamID}" class="primary">${_("Ver página del club", "View club page")}</button></div>
        ` : `
          <div class="title-row"><h2>${_("Club", "Club")}</h2><span class="pill">${_("Agente libre", "Free agent")}</span></div>
          <p class="muted">${_("Este jugador no tiene club en este momento.", "This player currently has no club.")}</p>
        `}
      </section>
      <section class="panel">
        <div class="title-row"><h2>${_("Estadísticas de temporada", "Season stats")}</h2><span class="pill">${player.appearances ?? 0} ${_("partidos", "matches")}</span></div>
        <div class="table-scroll">
          <table class="data-table">
            <tbody>
              <tr><td>${_("Partidos", "Matches")}</td><td><b>${player.appearances ?? 0}</b></td></tr>
              <tr><td>${_("Goles", "Goals")}</td><td><b>${player.goals ?? 0}</b></td></tr>
              <tr><td>${_("Snitches", "Snitches")}</td><td><b>${player.snitches ?? 0}</b></td></tr>
              <tr><td>Paradas</td><td><b>${player.saves ?? 0}</b></td></tr>
              <tr><td>Bloqueos</td><td><b>${player.blocks ?? 0}</b></td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="title-row"><h2>${_("Títulos y trofeos", "Titles & trophies")}</h2><span class="pill">${trophies.length ? trophies.reduce((sum, t) => sum + t.value, 0) : "0"}</span></div>
        ${trophies.length
          ? `<div class="table-scroll"><table class="data-table">
              <tbody>${trophies.map((t) => `<tr><td>${t.label}</td><td><b>${t.value}</b></td></tr>`).join("")}</tbody>
            </table></div>`
          : `<p class="muted">${_("Aún no ha ganado ningún título. Necesita grandes actuaciones individuales o un club dominante.", "Has not won any title yet. He needs great individual performances or a dominant club.")}</p>`}
      </section>
      <section class="panel">
        <div class="form-row">
          ${state.careerMode && state.career
            ? `<span class="muted">${_("Modo carrera: sin acciones de traspaso ni blindaje.", "Career mode: no transfer or shielding actions.")}</span>`
            : `${player.TeamID === state.managerTeamId
              ? (isShielded(player)
                ? `<span class="status-good">${_("Blindado frente a compras hasta el", "Shielded from purchases until")} ${formatDate(player.shieldedUntil, true)}</span>`
                : shieldSlotsUsed() >= 2
                  ? `<span class="status-warn">${_("Límite alcanzado: solo puedes blindar a 2 jugadores por temporada", "Limit reached: you can only shield 2 players per season")}</span>`
                  : `<button data-shield="${player.PlayerID}" class="primary" title="${_("Pagar un 10% más de salario esta temporada para que nadie pueda comprarlo", "Pay 10% more wage this season so nobody can buy him")}">${_("Blindar +10% salario", "Shield +10% wage")}</button>`)
              : (canNegotiate(player)
                ? `<button data-offer="${player.PlayerID}" class="primary">${_("Hacer oferta (55–110%)", "Make offer (55–110%)")}</button>`
                : (canIntlNegotiate(player)
                  ? `<button data-intl-offer="${player.PlayerID}" class="primary" title="${_("Negociación internacional: hasta 200% del valor y 150% del salario, +70.000 G por el traspaso de liga", "International negotiation: up to 200% of value and 150% of wage, +70,000 G for the cross-league transfer")}">${_("Oferta internacional (hasta 200%/150%)", "International offer (up to 200%/150%)")}</button>`
                  : ""))}`}
          <button data-back-player>← ${_("Volver", "Back")}</button>
        </div>
      </section>
    </main>
  `;
}

function renderTitles() {
  if (titlesEntity === "players") return renderPlayerTitles();
  const isIntl = titlesFilter === "internacional";
  const sortKey = isIntl ? titlesIntlFilter : titlesFilter;
  const source = isIntl ? state.teams : state.teams.filter((team) => team.leagueId === state.leagueId);
  const rows = source
    .map((team) => ({ ...team, leagueTitles: Number(team.leagueTitles ?? 0), cupTitles: Number(team.cupTitles ?? 0), euroCupTitles: Number(team.euroCupTitles ?? 0), championsTitles: Number(team.championsTitles ?? 0) }))
    .sort((a, b) => {
      const keyA = sortKey === "league" ? a.leagueTitles : sortKey === "cup" ? a.cupTitles : sortKey === "champions" ? a.championsTitles : a.euroCupTitles;
      const keyB = sortKey === "league" ? b.leagueTitles : sortKey === "cup" ? b.cupTitles : sortKey === "champions" ? b.championsTitles : b.euroCupTitles;
      return keyB - keyA || computedTeamOVR(b) - computedTeamOVR(a) || a.Name.localeCompare(b.Name);
    });
  const label = isIntl
    ? `${_("Internacional", "International")} · ${_("todas las ligas", "all leagues")} · ${sortKey === "league" ? _("Ligas", "Leagues") : sortKey === "cup" ? _("Copas", "Cups") : sortKey === "champions" ? _("Torneo de Campeones", "Champions Tournament") : _("Copas Europeas", "European Cups")}`
    : sortKey === "league"
      ? leagueInfo().leagueTitlesLabel
      : sortKey === "cup"
        ? leagueInfo().cupTitlesLabel
        : sortKey === "champions"
          ? _("Torneo de Campeones", "Champions Tournament")
          : _("Copas Europeas", "European Cups");
  const hl = (key) => (sortKey === key ? " class='sort-on'" : "");
  return `
    <main class="screen">
      <section class="panel">
        <div class="title-row"><h2>${_("Palmarés", "Trophies")}</h2><span class="pill">${label}</span></div>
        <div class="tabs">
          <button data-titles-entity="teams" class="${titlesEntity === "teams" ? "active" : ""}">${_("Equipos", "Teams")}</button>
          <button data-titles-entity="players" class="${titlesEntity === "players" ? "active" : ""}">${_("Jugadores", "Players")}</button>
        </div>
        <div class="tabs">
          <button data-titles-filter="league" class="${titlesFilter === "league" ? "active" : ""}">${_("Ligas", "Leagues")}</button>
          <button data-titles-filter="cup" class="${titlesFilter === "cup" ? "active" : ""}">${_("Copas", "Cups")}</button>
          <button data-titles-filter="euro" class="${titlesFilter === "euro" ? "active" : ""}">${_("Copas Europeas", "European Cups")}</button>
          <button data-titles-filter="champions" class="${titlesFilter === "champions" ? "active" : ""}">${_("Torneo de Campeones", "Champions Tournament")}</button>
          <button data-titles-filter="internacional" class="${isIntl ? "active" : ""}">${_("Internacional", "International")}</button>
        </div>
        ${isIntl ? `
        <div class="tabs">
          <button data-titles-intl-filter="league" class="${titlesIntlFilter === "league" ? "active" : ""}">${_("Ligas", "Leagues")}</button>
          <button data-titles-intl-filter="cup" class="${titlesIntlFilter === "cup" ? "active" : ""}">${_("Copas", "Cups")}</button>
          <button data-titles-intl-filter="euro" class="${titlesIntlFilter === "euro" ? "active" : ""}">${_("Copas Europeas", "European Cups")}</button>
          <button data-titles-intl-filter="champions" class="${titlesIntlFilter === "champions" ? "active" : ""}">${_("Campeones", "Champions")}</button>
        </div>` : ""}
        <div class="table-scroll">
          <table class="league-table">
            <thead><tr><th></th><th>${_("Equipo", "Team")}</th><th>${isIntl ? _("Liga", "League") : _("País", "Country")}</th><th${hl("league")}>${_("Ligas", "Leagues")}</th><th${hl("cup")}>${_("Copas", "Cups")}</th><th${hl("euro")}>${_("Europeas", "European")}</th><th${hl("champions")}>${_("Campeones", "Champions")}</th><th>${_("Total", "Total")}</th><th>OVR</th></tr></thead>
            <tbody>
              ${rows.map((row, index) => `
                <tr class="clickable" data-open-team="${row.TeamID}">
                  <td class="rank">${index + 1}</td>
                  <td><b>${row.Name}</b></td>
                  <td>${isIntl ? leagueById(row.leagueId || state.leagueId).name : row.Country}</td>
                  <td${hl("league")}><b>${row.leagueTitles}</b></td>
                  <td${hl("cup")}>${row.cupTitles}</td>
                  <td${hl("euro")}>${row.euroCupTitles}</td>
                  <td${hl("champions")}>${row.championsTitles}</td>
                  <td><b>${row.leagueTitles + row.cupTitles + row.euroCupTitles + row.championsTitles}</b></td>
                  <td>${Math.round(computedTeamOVR(row))}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `;
}

function renderPlayerTitles() {
  const filter = titlesPlayerFilter;
  const league = leagueById(state.leagueId);
  const rows = state.players
    .filter((player) => player.TeamID !== "FREE")
    .map((player) => {
      const club = teamById(player.TeamID);
      return {
        ...player,
        clubTitles: club ? Number(club.leagueTitles ?? 0) : 0,
        clubCups: club ? Number(club.cupTitles ?? 0) : 0,
        clubEuros: club ? Number(club.euroCupTitles ?? 0) : 0,
        clubChampions: club ? Number(club.championsTitles ?? 0) : 0,
        worldCupTitles: Number(player.worldCupTitles ?? 0),
        reputation: Number(player.reputation ?? 0),
        intlReputation: Number(player.intlReputation ?? 0),
      };
    })
    .sort((a, b) => {
      const keyA = playerTitleKey(a, filter);
      const keyB = playerTitleKey(b, filter);
      return keyB - keyA || rating(b) - rating(a) || a.Name.localeCompare(b.Name);
    });
  const labelMap = {
    league: `${_("Ligas de la", "Leagues of the")} ${league.name} (${_("del club actual", "current club")})`,
    cup: `${_("Copas de la", "Cups of the")} ${league.name} (${_("del club actual", "current club")})`,
    euro: `${_("Copas Europeas", "European Cups")} (${_("del club actual", "current club")})`,
    champions: `${_("Torneos de Campeones", "Champions Tournaments")} (${_("del club actual", "current club")})`,
    worldcup: `${_("Mundiales", "World Cups")}`,
    broom: `${_("Escobas de Oro", "Golden Brooms")}`,
    intlbroom: `${_("Escobas de Oro Internacionales", "International Golden Brooms")}`,
  };
  const label = labelMap[filter] || "";
  const hl = (key) => (filter === key ? " class='sort-on'" : "");
  return `
    <main class="screen">
      <section class="panel">
        <div class="title-row"><h2>${_("Palmarés de los jugadores", "Players' honours")}</h2><span class="pill">${label}</span></div>
        <div class="tabs">
          <button data-titles-entity="teams" class="${titlesEntity === "teams" ? "active" : ""}">${_("Equipos", "Teams")}</button>
          <button data-titles-entity="players" class="${titlesEntity === "players" ? "active" : ""}">${_("Jugadores", "Players")}</button>
        </div>
        <div class="tabs">
          <button data-titles-player-filter="league" class="${filter === "league" ? "active" : ""}">${_("Ligas", "Leagues")}</button>
          <button data-titles-player-filter="cup" class="${filter === "cup" ? "active" : ""}">${_("Copas", "Cups")}</button>
          <button data-titles-player-filter="euro" class="${filter === "euro" ? "active" : ""}">${_("C. Europeas", "Eur. Cups")}</button>
          <button data-titles-player-filter="champions" class="${filter === "champions" ? "active" : ""}">${_("Campeones", "Champions")}</button>
          <button data-titles-player-filter="worldcup" class="${filter === "worldcup" ? "active" : ""}">${_("Mundial", "World")}</button>
          <button data-titles-player-filter="broom" class="${filter === "broom" ? "active" : ""}">${_("Escoba de Oro", "Golden Broom")}</button>
          <button data-titles-player-filter="intlbroom" class="${filter === "intlbroom" ? "active" : ""}">${_("Escoba Intl.", "Intl. Broom")}</button>
        </div>
        <div class="table-scroll">
          <table class="league-table">
            <thead><tr><th></th><th>${_("Jugador", "Player")}</th><th>Pos</th><th>${_("Equipo", "Team")}</th><th${hl("league")}>${_("Ligas", "Leagues")}</th><th${hl("cup")}>${_("Copas", "Cups")}</th><th${hl("euro")}>${_("Europeas", "European")}</th><th${hl("champions")}>${_("Campeones", "Champions")}</th><th${hl("worldcup")}>${_("Mundial", "World")}</th><th${hl("broom")}>${_("Escoba", "Broom")}</th><th${hl("intlbroom")}>${_("Escoba Intl", "Intl Broom")}</th><th>OVR</th></tr></thead>
            <tbody>
              ${rows.map((row, index) => `
                <tr class="clickable" data-open-player="${row.PlayerID}">
                  <td class="rank">${index + 1}</td>
                  <td><b>${row.Name}</b></td>
                  <td>${posName(row.Position)}</td>
                  <td>${teamName(row.TeamID)}</td>
                  <td${hl("league")}>${row.clubTitles}</td>
                  <td${hl("cup")}>${row.clubCups}</td>
                  <td${hl("euro")}>${row.clubEuros}</td>
                  <td${hl("champions")}>${row.clubChampions}</td>
                  <td${hl("worldcup")}>${row.worldCupTitles}</td>
                  <td${hl("broom")}>${row.reputation}</td>
                  <td${hl("intlbroom")}>${row.intlReputation}</td>
                  <td>${row.OVR}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `;
}

function playerTitleKey(player, filter) {
  switch (filter) {
    case "league": return Number(player.clubTitles ?? 0);
    case "cup": return Number(player.clubCups ?? 0);
    case "euro": return Number(player.clubEuros ?? 0);
    case "champions": return Number(player.clubChampions ?? 0);
    case "worldcup": return Number(player.worldCupTitles ?? 0);
    case "broom": return Number(player.reputation ?? 0);
    case "intlbroom": return Number(player.intlReputation ?? 0);
    default: return 0;
  }
}

function renderAdvanceDock() {
  if (autoSim()) {
    return `
    <div class="advance-dock">
      <span class="muted">${onlineStatusText()}</span>
      <button disabled>${_("En vivo", "Live")}</button>
    </div>
  `;
  }
  const running = Boolean(advanceTimer) && state.status === "running";
  const spectator = running && wcAutoSpeed() >= 500;
  const label = running ? _("Pausar", "Pause") : state.status === "simulating" ? _("Simulando...", "Simulating...") : state.status === "ready" ? (state.careerMode ? _("Jugar partido", "Play match") : _("Simular partido", "Simulate match")) : _("Avanzar", "Advance");
  const hint = state.status === "ready" ? _("Partido listo", "Match ready") : running ? (spectator ? _("Eliminado del Mundial · viendo el final en automático", "Out of the World Cup · watching the end automatically") : _("Pasando días", "Skipping days")) : formatDate(state.currentDate, true);
  return `
    <div class="advance-dock">
      <span class="muted">${hint}</span>
      <button data-advance ${state.status === "simulating" ? "disabled" : ""}>${label}</button>
    </div>
  `;
}

function renderWcFinalModal() {
  const result = (state.worldCupResults || []).slice().reverse()[0];
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="title-row"><h2>${_("¡Campeón del Mundo!", "World Champion!")}</h2><span class="pill">${_("Copa del Mundo de Quidditch", "Quidditch World Cup")} ${result?.year || ""}</span></div>
        <div class="cup-champion">
          <div><b>${result?.champion?.name || "—"}</b><span class="muted">${_("Se proclama campeón del mundo de Quidditch", "is proclaimed Quidditch world champion")} ${result?.year || ""}.</span></div>
        </div>
        <div class="feed">
          ${result?.runnerUp ? `<div class="feed-item"><span>2º</span><span>${result.runnerUp.name}</span><span></span></div>` : ""}
          ${result?.third ? `<div class="feed-item"><span>3º</span><span>${result.third.name}</span><span></span></div>` : ""}
        </div>
        <p class="muted">${_("Los jugadores campeones que juegan en tu liga reciben +1 OVR y forma y moral al 100. El subcampeón sube su forma y moral al 90, y el bronce, al 85.", "Champion players who play in your league receive +1 OVR and 100 morale and form. The runner-up gets 90 morale and form, and the bronze, 85.")}</p>
        <div class="form-row">
          <button data-close-wc-final class="primary">${_("Continuar", "Continue")}</button>
        </div>
      </div>
    </div>
  `;
}

function renderWarningModal() {
  const teamId = state.managerTeamId;
  const squad = playersFor(teamId);
  const byId = Object.fromEntries(squad.map((player) => [player.PlayerID, player]));
  const lineup = state.selectedLineups?.[teamId] || [];
  const missing = REQUIRED_SLOTS.map((slot, i) => {
    const player = byId[lineup[i]];
    if (player && player.TeamID === teamId && !player.injured && (player.Position === slot || player.Position === "Reserve")) return null;
    return { slot, index: i };
  }).filter(Boolean);
  const problemPlayers = lineup.slice(0, REQUIRED_SLOTS.length).map((id) => byId[id]).filter((player) => player && (player.injured || player.TeamID !== teamId));
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="title-row"><h2>${_("Alineación incompleta", "Incomplete lineup")}</h2><span class="pill">${_("No se puede simular", "Cannot simulate")}</span></div>
        <p class="muted">${_("Tu alineación no está completa para disputar el partido. Faltan los siguientes puestos:", "Your lineup is incomplete to play the match. The following positions are missing:")}</p>
        <div class="feed">
          ${missing.map(({ slot, index }) => `<div class="feed-item"><span>${index + 1}º</span><span>${_(slot, slot)}</span><span></span></div>`).join("")}
          ${problemPlayers.length ? problemPlayers.map((player) => `<div class="feed-item"><span>!</span><span>${player.Name} ${_("está", "is")} ${player.injured ? _("lesionado", "injured") : _("fuera del equipo", "out of the team")}</span><span></span></div>`).join("") : ""}
        </div>
        <p class="muted">${_("Revisa tu plantilla, sustituye a los jugadores lesionados y rellena los puestos vacíos antes de simular.", "Check your squad, substitute injured players and fill the empty positions before simulating.")}</p>
        <div class="form-row">
          <button data-dismiss-warning class="primary">${_("Revisar plantilla", "Review squad")}</button>
          <button data-force-advance>${_("Simular igualmente", "Simulate anyway")}</button>
        </div>
      </div>
    </div>
  `;
}

function renderNegotiationModal() {
  const neg = state.negotiation;
  const player = neg ? playerById(neg.playerId) : null;
  if (!player) return "";
  const isIntl = Boolean(neg.intl);
  const value = Math.round(playerValue(player));
  const minFee = Math.round(value * 0.55);
  const maxFee = isIntl ? Math.round(value * 2) : Math.round(value * 1.1);
  const currentSalary = Number(player["Salary(G/week)"] || 0) || 200;
  const minSalary = isIntl ? Math.round(currentSalary * 1.0) : Math.round(currentSalary * 0.7);
  const maxSalary = isIntl ? Math.round(currentSalary * 1.5) : Math.round(currentSalary * 1.2);
  const fee = clamp(Number(neg.fee) || minFee, minFee, maxFee);
  const salary = clamp(Number(neg.salary) || currentSalary, minSalary, maxSalary);
  const chance = neg.round === 1 ? negotiationChance(player, fee, salary, isIntl) : null;
  const club = teamById(player.TeamID);
  const lockedNote = clauseLocked(player) ? `<p class="muted">${_("Cláusula bloqueada: la vía forzosa está vetada hasta el", "Clause locked: the forced route is banned until")} ${formatDate(player.clauseLockUntil, true)}${_("; solo cabe negociación.", "; only negotiation is allowed.")}</p>` : "";
  const introEs = `${player.Name} (${POS_NAMES.es[player.Position] || player.Position}, OVR ${player.OVR}) juega en ${club ? club.Name + " (" + (leagueById(player.leagueId || state.leagueId).name) + ")" : "su club"}${isIntl ? ". Es extranjero: no puedes ficharlo directamente, solo negociar con un límite de hasta el 200% del valor y el 150% del salario. <b>No aceptará cobrar menos de su salario actual (100% mínimo), aunque pagues el máximo al club.</b>" : ". Elige tarifa (55–110% del valor) y salario (70–120% del actual)"}. Cuanto más dinero ofrezcas, más probable que acepte; pero un club mejor clasificado que el tuyo resiste.${isIntl ? " <b>Además, si acepta pagarás 70.000 G por el traspaso de liga, que van al fondo de su liga (no al club).</b>" : ""}`;
  const introEn = `${player.Name} (${player.Position}, OVR ${player.OVR}) plays for ${club ? club.Name + " (" + (leagueById(player.leagueId || state.leagueId).name) + ")" : "his club"}${isIntl ? ". He is a foreigner: you cannot sign him directly, only negotiate with a limit of up to 200% of his value and 150% of his wage. <b>He won't accept earning less than his current wage (100% minimum) even if you pay the club the maximum.</b>" : ". Choose fee (55–110% of value) and wage (70–120% of current)"}. The more money you offer, the likelier he accepts; but a better-ranked club than yours resists.${isIntl ? " <b>Also, if he accepts you will pay 70,000 G for the cross-league transfer, which goes to his league's fund (not the club).</b>" : ""}`;
  const intro = UI_LANG === "es" ? introEs : introEn;
  const counterEs = `${player.Name} aceptaría por <b>${money(neg.fee)}</b> y <b>${money(neg.salary)}/sem</b>. Si te retiras, se mosquea y puede pedir salir al mercado.`;
  const counterEn = `${player.Name} would accept for <b>${money(neg.fee)}</b> and <b>${money(neg.salary)}/sem</b>. If you withdraw, he gets annoyed and may ask to leave to the market.`;
  const counter = UI_LANG === "es" ? counterEs : counterEn;
  if (neg.result) {
    return `
      <div class="modal-backdrop">
        <div class="modal">
          <div class="title-row"><h2>${neg.result.success ? _("¡Fichaje cerrado!", "Deal done!") : _("Resultado de la negociación", "Negotiation result")}</h2><span class="pill">${player.Name}</span></div>
          <p class="${neg.result.success ? "status-good" : "text-warn"}">${neg.result.text}</p>
          <div class="form-row">
            <button data-offer-close class="primary">${_("Continuar", "Continue")}</button>
          </div>
        </div>
      </div>
    `;
  }
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="title-row"><h2>${neg.round === 1 ? (isIntl ? _("Negociación internacional: ", "International negotiation: ") : _("Negociación: ", "Negotiation: ")) + player.Name : _("Contraoferta de ", "Counter-offer from ") + player.Name}</h2><span class="pill">${club ? club.Name + " · " + club.ReputationStars + "★" : "—"}${isIntl ? _(" · Traspaso de liga", " · Cross-league transfer") : ""}</span></div>
        ${neg.round === 1 ? `
          <p class="muted">${intro}</p>
          <div class="form-row">
            <label>${_("Tarifa", "Fee")}: <input type="range" data-offer-fee min="${minFee}" max="${maxFee}" step="100" value="${fee}" /><span class="offer-fee-label">${money(fee)}</span></label>
          </div>
          <div class="form-row">
            <label>${_("Salario", "Wage")}: <input type="range" data-offer-salary min="${minSalary}" max="${maxSalary}" step="5" value="${salary}" /><span class="offer-salary-label">${money(salary)}/sem</span></label>
          </div>
          ${lockedNote}
          <p class="offer-chance-label">${_("Probabilidad estimada", "Estimated chance")}: ${negotiationChance(player, fee, salary)}%</p>
          <div class="form-row">
            <button data-offer-submit class="primary">${_("Enviar oferta", "Send offer")}</button>
            <button data-offer-cancel>${_("Cancelar", "Cancel")}</button>
          </div>
          <p class="muted">${_("Si el jugador se queda en la misma situación, esta operación no se completa.", "If the player stays in the same situation, this operation will not be completed.")}</p>
        ` : `
          <p class="muted">${counter}</p>
          <div class="form-row">
            <button data-offer-accept class="primary">${_("Aceptar contraoferta", "Accept counter-offer")} (${money(neg.fee)})</button>
            <button data-offer-withdraw>${_("Retirar oferta", "Withdraw offer")}</button>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderGalaModal() {
  const gala = state.galaResult;
  if (!gala) return "";
  const intl = gala.intl;
  const localPreambleEs = `Premio de la ${leagueInfo().name}: se compara solo a los jugadores de esta liga (el país o grupo de países que la forman) y solo entran quienes hayan jugado al menos 10 partidos. Puntuación: rendimiento por partido frente a los mejores de su puesto, aportación total, regularidad, nivel y bonus por títulos (Liga +35, Copa +25, Copa Europea +45, Mundial +55). El ganador sube su reputación y gana +1 OVR y +5% de valor.`;
  const localPreambleEn = `Award of the ${leagueInfo().name}: only players of this league (the country or group of countries that form it) are compared and only those who have played at least 10 matches qualify. Score: performance per match against the best of their position, total contribution, consistency, level and bonus for titles (League +35, Cup +25, European Cup +45, World Cup +55). The winner raises his reputation and gains +1 OVR and +5% value.`;
  const localPreamble = UI_LANG === "es" ? localPreambleEs : localPreambleEn;
  const intlPreambleEs = `Se compara a todos los jugadores del mundo: rendimiento individual más bonus por títulos (Liga +35, Copa +25, Copa Europea +45, Mundial +55).`;
  const intlPreambleEn = `All players in the world are compared: individual performance plus bonus for titles (League +35, Cup +25, European Cup +45, World Cup +55).`;
  const intlPreamble = UI_LANG === "es" ? intlPreambleEs : intlPreambleEn;
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="title-row"><h2>${_("Gala del Mejor Jugador", "Best Player Gala")}</h2><span class="pill">${_("Escoba de Oro", "Golden Broom")} · 20 ${_("de agosto", "August")}</span></div>
        <div class="cup-champion">
          <div><b>${gala.winnerName}</b><span class="muted">${gala.winnerTeam} · ${_("Mejor Jugador de la Temporada de la", "Best Player of the")} ${leagueInfo().name} ${gala.seasonYear}/${gala.seasonYear + 1}</span></div>
        </div>
        <div class="feed">${gala.podium.map((entry, index) => `<div class="feed-item"><span>${index + 1}º</span><span>${entry.name} <span class="muted">(${entry.team} · ${entry.score} pts)</span></span><span></span></div>`).join("")}</div>
        <p class="muted">${localPreamble}</p>
        ${intl ? `
          <div class="title-row" style="margin-top:14px"><h2>${_("Escoba de Oro Internacional", "International Golden Broom")}</h2><span class="pill">${_("Mejor del mundo", "Best in the world")}</span></div>
          <div class="cup-champion">
            <div><b>${intl.winnerName}</b><span class="muted">${intl.winnerTeam} · ${_("Mejor Jugador del Mundo", "World Player of the Year")} ${gala.seasonYear}/${gala.seasonYear + 1}</span></div>
          </div>
          <div class="feed">${intl.podium.map((entry, index) => `<div class="feed-item"><span>${index + 1}º</span><span>${entry.name} <span class="muted">(${entry.team} · ${entry.score} pts)</span></span><span></span></div>`).join("")}</div>
          <p class="muted">${intlPreamble}</p>
        ` : ""}
        <div class="form-row">
          <button data-close-gala class="primary">${_("Continuar", "Continue")}</button>
        </div>
      </div>
    </div>
  `;
}

function renderResultModal() {

  const fixture = state.lastResult;
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="title-row"><h2>${_("Resultado final", "Final result")}</h2><span class="pill">${competitionLabel(fixture)} · ${formatDate(fixture.date, true)}</span></div>
        <div class="scoreline">
          <span>${teamName(fixture.homeId)}</span>
          <b>${fixture.homeScore}-${fixture.awayScore}</b>
          <span>${teamName(fixture.awayId)}</span>
        </div>
        <div class="feed">${fixture.events.map((event) => `<div class="feed-item"><span>•</span><span>${event}</span><span></span></div>`).join("")}</div>
        <br />
        <button data-close-result class="primary">${_("Continuar", "Continue")}</button>
      </div>
    </div>
  `;
}

/* ================= MODO CARRERA DE JUGADOR ================= */

function isCareerPlayer(player) { return Boolean(state.careerMode) && player.PlayerID === state.careerPlayerId; }
function careerPlayer() { return state.careerPlayerId ? playerById(state.careerPlayerId) : null; }

function careerNationalities() {
  const set = new Set();
  (state.players || []).forEach((p) => { if (p.Nationality) set.add(p.Nationality); });
  return [...set].sort((a, b) => a.localeCompare(b));
}

function renderCareerSetup() {
  if (careerSetup === "player") {
    return `
      <main class="screen">
        <div class="title-row">
          <div><h1>${_("Carrera de Jugador", "Player Career")}</h1><p class="muted">${_("Juega como un único jugador: tu club lo gestiona la IA, tú entrenas, juegas, recibes ofertas y construyes tu leyenda.", "Play as a single player: your club is managed by the AI, you train, play, receive offers and build your legend.")}</p></div>
          <span class="pill">${_("Versión", "Version")} ${GAME_VERSION}</span>
        </div>
        <button data-career-back class="save-file">← ${_("Volver", "Back")}</button>
        <section class="team-pick">
          <button data-career-mode="random">
            <span class="team-name">${_("Jugador aleatorio", "Random player")}</span><br />
            <span class="muted">${_("Empieza con una promesa existente del mundo de Quidditch (16-22 años).", "Start with an existing prospect from the Quidditch world (16-22 years old).")}</span>
          </button>
          <button data-career-mode="custom">
            <span class="team-name">${_("Crear mi jugador", "Create my player")}</span><br />
            <span class="muted">${_("Define nombre, nacionalidad, posición y reparte tus atributos.", "Set name, nationality, position and distribute your attributes.")}</span>
          </button>
        </section>
      </main>
    `;
  }
  if (careerSetup === "custom") {
    const nationalities = careerNationalities();
    return `
      <main class="screen">
        <div class="title-row"><h1>${_("Crear mi jugador", "Create my player")}</h1><span class="pill">${_("Reparte 210 puntos", "Distribute 210 points")}</span></div>
        <button data-career-back class="save-file">← ${_("Volver", "Back")}</button>
        <section class="panel">
          <div class="form-row"><label>${_("Nombre", "Name")}: <input data-career-name type="text" value="${careerSetupCustom?.name || ""}" placeholder="${_("Ej: Draco Carter", "e.g. Draco Carter")}" /></label></div>
          <div class="form-row"><label>${_("Nacionalidad", "Nationality")}:
            <select data-career-nationality>${nationalities.map((n) => `<option ${careerSetupCustom?.nationality === n ? "selected" : ""}>${n}</option>`).join("")}</select>
          </label></div>
          <div class="form-row"><label>${_("Posición", "Position")}:
            <select data-career-position>
              ${["Chaser", "Beater", "Keeper", "Seeker"].map((pos) => `<option ${careerSetupCustom?.position === pos ? "selected" : ""}>${posName(pos)}</option>`).join("")}
            </select>
          </label></div>
          <div class="form-row"><label>${_("Edad", "Age")}: <input data-career-age type="range" min="17" max="20" value="${careerSetupCustom?.age || 18}" /><span class="pill" data-career-age-label>${careerSetupCustom?.age || 18} ${_("años", "years")}</span></label></div>
          <div class="metric-row">
            <div class="metric"><span class="muted">OVR</span><b><input data-career-ovr type="range" min="45" max="85" value="${careerSetupCustom?.ovr || 70}" /></b><span class="pill" data-career-ovr-label>${careerSetupCustom?.ovr || 70}</span></div>
            <div class="metric"><span class="muted">${_("Técnica", "Technique")}</span><b><input data-career-v1 type="range" min="45" max="85" value="${careerSetupCustom?.v1 || 70}" /></b><span class="pill" data-career-v1-label>${careerSetupCustom?.v1 || 70}</span></div>
            <div class="metric"><span class="muted">${_("Física", "Fitness")}</span><b><input data-career-v2 type="range" min="45" max="85" value="${careerSetupCustom?.v2 || 70}" /></b><span class="pill" data-career-v2-label>${careerSetupCustom?.v2 || 70}</span></div>
          </div>
          <p class="muted" data-career-budget></p>
          <button data-career-submit class="primary">${_("Siguiente: elegir club →", "Next: choose club →")}</button>
        </section>
      </main>
    `;
  }
  const pending = careerSetupRandom || careerSetupCustom;
  const groups = {};
  state.teams.forEach((team) => { (groups[team.leagueId] = groups[team.leagueId] || []).push(team); });
  return `
    <main class="screen">
      <div class="title-row"><h1>${_("Elige tu club", "Choose your club")}</h1><span class="pill">${pending ? pending.Name + " (" + pending.Position + ", " + pending.OVR + ")" : _("Tu jugador", "Your player")}</span></div>
      <button data-career-back class="save-file">← ${_("Volver", "Back")}</button>
      ${careerSetupRandom ? `<button data-career-random-club class="primary">${_("Comenzar con el club actual de", "Start with")} ${careerSetupRandom.Name}${_("'s current club", "'s current club")}</button>` : ""}
      ${Object.entries(groups).map(([leagueId, teams]) => `
        <h3>${leagueById(leagueId).name}</h3>
        <section class="team-pick">
          ${teams.map((team) => `
            <button data-career-club="${team.TeamID}">
              <span class="team-name">${team.Name}</span><br />
              <span class="muted">${team.Country}</span><br /><br />
              <span class="pill">OVR ${Math.round(computedTeamOVR(team))}</span>
              <span class="pill">${money(team.budget)}</span>
              <span class="pill">${team.ReputationStars}★</span>
            </button>
          `).join("")}
        </section>
      `).join("")}
    </main>
  `;
}

function pickRandomCareerPlayer() {
  const pool = state.players.filter((p) => p.TeamID !== "FREE" && ["Chaser", "Beater", "Keeper", "Seeker"].includes(p.Position) && Number(p.Age || 99) <= 22);
  if (!pool.length) return null;
  return pool.sort(() => Math.random() - 0.5)[0];
}

function buildCareerState(playerRow, clubId) {
  const club = teamById(clubId);
  const leagueId = club.leagueId;
  const base = buildInitialState(clubId, START_YEAR, false, leagueId);
  const fromRandom = playerRow && playerRow.PlayerID && base.players.some((p) => p.PlayerID === playerRow.PlayerID);
  let careerId = null;
  if (fromRandom) {
    const p = base.players.find((item) => item.PlayerID === playerRow.PlayerID);
    careerId = p.PlayerID;
  } else {
    const p = makePlayer({ ...playerRow, leagueId, PlayerID: "CAREER-" + Date.now(), TeamID: clubId, ContractYears: 3 }, "career");
    p["Salary(G/week)"] = Math.max(150, Math.round(intrinsicValue(p) / 95));
    p["Value(G)"] = intrinsicValue(p);
    base.players.push(p);
    careerId = p.PlayerID;
  }
  const cp = base.players.find((p) => p.PlayerID === careerId);
  cp.TeamID = clubId;
  cp.leagueId = leagueId;
  cp.morale = 80;
  cp.form = 78;
  const startSalary = Number(cp["Salary(G/week)"] || 0);
  base.careerMode = true;
  base.careerPlayerId = careerId;
  base.career = {
    clubId,
    training: "none",
    trainingWeek: -1,
    development: 0,
    ratings: [],
    playerOfMatch: 0,
    cleanSheets: 0,
    scoringGames: 0,
    objectives: [],
    offers: [],
    offerWindow: "none",
    nextOfferAt: null,
    bets: [],
    history: [],
    awards: [],
    lastMatch: null,
    benched: false,
    money: Math.round(startSalary * 2),
    moneyWeek: -1,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    notice: null,
    wc: null,
    wcFinalModal: false,
    sponsor: null,
    mansion: null,
  };
  return base;
}

function careerClubLineup(teamId) {
  const squad = playersFor(teamId);
  const base = lineupFromIds(teamId, [], state);
  const cp = careerPlayer();
  if (!cp || cp.TeamID !== teamId || cp.injured) return base;
  const slotIdx = REQUIRED_SLOTS.findIndex((slot) => slot === cp.Position);
  if (slotIdx < 0) return base;
  if (base.includes(cp.PlayerID)) return base;
  const occupantId = base[slotIdx];
  if (occupantId === cp.PlayerID) return base;
  const occupant = occupantId ? playerById(occupantId) : null;
  const cpWeight = roleWeight(cp, cp.Position);
  const occWeight = occupant ? roleWeight(occupant, cp.Position) : -Infinity;
  if (cpWeight >= occWeight - 6) {
    base[slotIdx] = cp.PlayerID;
    if (occupantId) {
      const freeIdx = base.findIndex((id, i) => id === null || playerById(id)?.Position === "Reserve");
      if (freeIdx >= 0) base[freeIdx] = occupantId;
    }
  }
  return base;
}

function careerMatchRating(player, delta, won, fixture) {
  const pos = player.Position;
  const oppTeam = fixture && fixture.homeId === state.managerTeamId ? teamById(fixture.awayId) : (fixture ? teamById(fixture.homeId) : null);
  const myTeam = teamById(state.managerTeamId);
  const oppFactor = myTeam && oppTeam ? (computedTeamOVR(oppTeam) - computedTeamOVR(myTeam)) / 25 : 0;
  let base = 5.0 + (Number(player.OVR || 70) - 70) * 0.02 + (Number(player.form || 70) - 70) * 0.004 + (Math.random() - 0.5) * 1.2 + oppFactor;
  if (pos === "Chaser") {
    const g = Math.min(delta.goals, 5);
    if (g >= 1) base += 1.1;
    if (g >= 2) base += 0.7;
    if (g >= 3) base += 0.5;
    if (g >= 4) base += 0.4;
    if (g >= 5) base += 0.3;
    base += won ? 0.4 : 0;
    base += delta.goals === 0 && won ? 0.2 : 0;
  } else if (pos === "Beater") {
    base += delta.blocks * 0.4 + (won ? 0.4 : 0);
  } else if (pos === "Keeper") {
    base += delta.saves * 0.45 - delta.conceded * 0.7 + (delta.conceded === 0 && delta.saves > 0 ? 0.8 : 0) + (won ? 0.3 : 0);
  } else if (pos === "Seeker") {
    base += (delta.snitches ? 2.6 : 0) + (won ? 0.4 : delta.snitches ? 0 : -0.6);
  }
  return Math.round(clamp(base, 1, 10) * 10) / 10;
}

function simulateCareerMatch() {
  const fixture = state.fixtures.find((item) => item.id === state.pendingMatchId) || nextManagerFixture(true);
  if (!fixture) return;
  state.status = "simulating";
  saveAndRender();
  window.setTimeout(() => {
    const clubId = state.managerTeamId;
    const cp = careerPlayer();
    const lineup = careerClubLineup(clubId);
    state.selectedLineups[clubId] = lineup;
    const benched = !lineup.includes(cp.PlayerID);
    const before = cp ? { goals: cp.goals, snitches: cp.snitches, saves: cp.saves, blocks: cp.blocks, conceded: cp.goalsConceded || 0 } : null;
    simulateMatch(fixture);
    state.lastResult = clone(fixture);
    state.pendingMatchId = null;
    state.status = "idle";
    pushFeed(`${competitionLabel(fixture)}: ${teamName(fixture.homeId)} ${fixture.homeScore}-${fixture.awayScore} ${teamName(fixture.awayId)}.`, `${competitionLabel(fixture)}: ${teamName(fixture.homeId)} ${fixture.homeScore}-${fixture.awayScore} ${teamName(fixture.awayId)}.`, fixtureFeedScope(fixture));
    resolveCupFinal();
    completeCupIfDone();
    resolveBackgroundCupFinals();
    completeBackgroundCups();
    resolveEuroCupBracket();
    completeEuroCupIfDone();
    resolveChampionsCupBracket();
    completeChampionsCupIfDone();
    updatePlayerValues();
    let rating = null;
    if (cp && !benched && before) {
      const after = { goals: cp.goals, snitches: cp.snitches, saves: cp.saves, blocks: cp.blocks, conceded: cp.goalsConceded || 0 };
      const delta = { goals: after.goals - before.goals, snitches: after.snitches - before.snitches, saves: after.saves - before.saves, blocks: after.blocks - before.blocks, conceded: Math.max(0, after.conceded - before.conceded) };
      const won = fixture.winnerId === clubId;
      rating = careerMatchRating(cp, delta, won, fixture);
      if (state.worldCup) {
        if (!state.career.wc.ratings) state.career.wc.ratings = [];
        state.career.wc.ratings.push(rating);
      } else {
        state.career.ratings.push(rating);
      }
      const formDelta = (rating - 6.5) * 1.5;
      cp.form = clamp(Number(cp.form || 70) + formDelta, 35, 100);
      cp.morale = clamp(Number(cp.morale || 70) + (rating - 6.5) * 2, 30, 100);
      if (!state.worldCup) {
        state.career.development += Math.max(0, rating - 6) * 1.2;
        if (cp.Position === "Keeper" && delta.conceded === 0 && delta.saves > 0) state.career.cleanSheets += 1;
        if (delta.goals > 0) state.career.scoringGames += 1;
        const potm = rating >= 9 || delta.goals >= 4 || (cp.Position === "Seeker" && delta.snitches > 0 && won && rating >= 8);
        if (potm) { state.career.playerOfMatch += 1; cp.morale = clamp(cp.morale + 5, 30, 100); }
        checkCareerObjectives();
      }
      state.career.lastMatch = { fixture: clone(fixture), rating, stats: delta, benched: false, potm: rating >= 9 || delta.goals >= 4 || (cp.Position === "Seeker" && delta.snitches > 0 && won && rating >= 8) };
    } else if (cp) {
      cp.form = clamp(Number(cp.form || 70) - (benched ? 2 : 3), 30, 100);
      cp.morale = clamp(Number(cp.morale || 70) - (benched ? 2 : 3), 30, 100);
      state.career.lastMatch = { fixture: clone(fixture), rating: null, stats: null, benched, potm: false };
    }
    saveAndRender();
  }, 2300);
}

function renderCareerMatchModal() {
  const m = state.career.lastMatch;
  if (!m) return "";
  const f = m.fixture;
  const cp = careerPlayer();
  const injuredNow = Boolean(cp?.injured);
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="title-row"><h2>${injuredNow ? _("Lesionado", "Injured") : m.benched ? _("Estuviste en el banquillo", "You were on the bench") : _("Resultado final", "Final result")}</h2><span class="pill">${competitionLabel(f)} · ${formatDate(f.date, true)}</span></div>
        <div class="scoreline">
          <span>${teamName(f.homeId)}</span>
          <b>${f.homeScore}-${f.awayScore}</b>
          <span>${teamName(f.awayId)}</span>
        </div>
        ${injuredNow
          ? `<p class="muted">${_("Estás lesionado", "You are injured")} (${cp.injuryDays} ${_("días de baja", "days out")}) ${_("y no has podido jugar. Recupérate con fisioterapia o semanas de descanso.", "and could not play. Recover with physiotherapy or rest weeks.")}</p>`
          : m.benched
          ? `<p class="muted">${_("El entrenador no te dio minutos en este partido. Tu forma y moral han bajado un poco.", "The manager gave you no minutes in this match. Your form and morale dropped a little.")}</p>`
          : `
          <div class="metric-row">
            <div class="metric"><span class="muted">${_("Tu nota", "Your rating")}</span><b>${m.rating}</b></div>
            <div class="metric"><span class="muted">${_("Goles", "Goals")}</span><b>${m.stats.goals}</b></div>
            <div class="metric"><span class="muted">${_("Snitchs", "Snitches")}</span><b>${m.stats.snitches}</b></div>
            <div class="metric"><span class="muted">${_("Paradas", "Saves")}</span><b>${m.stats.saves}</b></div>
            <div class="metric"><span class="muted">${_("Bloqueos", "Blocks")}</span><b>${m.stats.blocks}</b></div>
          </div>
          ${m.potm ? `<p class="status-good">${_("¡Jugador del partido!", "Player of the match!")}</p>` : ""}`}
        <div class="form-row"><button data-career-close-match class="primary">${_("Continuar", "Continue")}</button></div>
      </div>
    </div>
  `;
}

function doCareerTraining(focus) {
  const cp = careerPlayer();
  if (!cp) return;
  const week = Math.floor(daysBetween(seasonStart(state.seasonYear), state.currentDate) / 7);
  if (state.career.trainingWeek === week) { pushFeed("Ya has entrenado esta semana. Vuelve la próxima.", "You already trained this week. Come back next week."); saveAndRender(); return; }
  state.career.trainingWeek = week;
  state.career.training = focus;
  if (focus === "fisico") {
    cp.stamina = clamp(Number(cp.stamina ?? 100) + 12, 20, 100);
    if (cp.injured) { cp.injuryDays = Math.max(0, Number(cp.injuryDays || 0) - 5); }
    state.career.development += 2;
    pushFeed("Entrenamiento físico completado: +stamina y recuperación.", "Physical training done: +stamina and recovery.");
  } else if (focus === "tecnico") {
    state.career.development += 3;
    pushFeed("Entrenamiento técnico completado: +desarrollo.", "Technical training done: +development.");
  } else if (focus === "mental") {
    cp.form = clamp(Number(cp.form || 70) + 6, 35, 100);
    cp.morale = clamp(Number(cp.morale || 70) + 6, 30, 100);
    state.career.development += 1;
    pushFeed("Entrenamiento mental completado: +forma y moral.", "Mental training done: +form and morale.");
  } else if (focus === "descanso") {
    cp.stamina = 100;
    cp.morale = clamp(Number(cp.morale || 70) + 4, 30, 100);
    if (cp.injured) { cp.injuryDays = Math.max(0, Number(cp.injuryDays || 0) - 7); }
    pushFeed("Semana de descanso: recuperación total.", "Rest week: full recovery.");
  }
  saveAndRender();
}

function careerSeasonObjectives() {
  const cp = careerPlayer();
  const pos = cp.Position;
  const list = [];
  const base = [
    { type: "apps", target: 20, text: _("Juega 20 partidos esta temporada", "Play 20 matches this season") },
    { type: "avg", target: 7.2, text: _("Acaba la temporada con nota media ≥ 7.2", "End the season with average rating ≥ 7.2") },
    { type: "wins", target: 12, text: _("Tu equipo gana 12 partidos", "Your team wins 12 matches") },
  ];
  if (pos === "Chaser") list.push({ type: "goals", target: 30, text: _("Marca 30 goles esta temporada", "Score 30 goals this season") }, { type: "scoring", target: 15, text: _("Marca en 15 partidos", "Score in 15 matches") });
  if (pos === "Beater") list.push({ type: "blocks", target: 60, text: _("Haz 60 bloqueos esta temporada", "Make 60 blocks this season") });
  if (pos === "Keeper") list.push({ type: "saves", target: 40, text: _("Haz 40 paradas", "Make 40 saves") }, { type: "clean", target: 10, text: _("Mantén la portería a cero en 10 partidos", "Keep a clean sheet in 10 matches") });
  if (pos === "Seeker") list.push({ type: "snitches", target: 8, text: _("Captura 8 snitchs esta temporada", "Catch 8 snitches this season") });
  list.push(...base);
  return list.sort(() => Math.random() - 0.5).slice(0, 3).map((o) => ({ ...o, progress: 0, done: false }));
}

function careerObjectiveProgress(obj) {
  const cp = careerPlayer();
  const club = teamById(state.managerTeamId);
  switch (obj.type) {
    case "apps": return cp.appearances || 0;
    case "avg": { const r = state.career.ratings; return r.length ? r.reduce((s, v) => s + v, 0) / r.length : 0; }
    case "wins": return (state.standings.find((row) => row.teamId === state.managerTeamId) || {}).wins || 0;
    case "goals": return cp.goals || 0;
    case "scoring": return state.career.scoringGames;
    case "blocks": return cp.blocks || 0;
    case "saves": return cp.saves || 0;
    case "clean": return state.career.cleanSheets;
    case "snitches": return cp.snitches || 0;
    default: return 0;
  }
}

function checkCareerObjectives() {
  const cp = careerPlayer();
  (state.career.objectives || []).forEach((obj) => {
    obj.progress = careerObjectiveProgress(obj);
    if (!obj.done && obj.progress >= obj.target) {
      obj.done = true;
      cp.morale = clamp(cp.morale + 10, 30, 100);
      state.career.development += 5;
       pushFeed("Objetivo cumplido: " + `${obj.text}` + ". +moral y +desarrollo.", "Objective completed: " + `${obj.text}` + ". +morale and +development.");
    }
  });
}

function careerOfferWindowKey() {
  if (state.worldCup) return "none";
  const month = state.currentDate.slice(5, 7);
  return `${state.seasonYear}-${month}`;
}

function maybeGenerateCareerOffers() {
  if (!state.careerMode || !state.career) return;
  const key = careerOfferWindowKey();
  if (state.career.offerWindow !== key) {
    state.career.offerWindow = key;
    if (key === "none") { state.career.offers = []; state.career.nextOfferAt = null; }
  }
  if (key === "none") return;
  const active = (state.career.offers || []).filter((o) => !o.expiresAt || o.expiresAt >= state.currentDate);
  if (active.length !== (state.career.offers || []).length) {
    state.career.offers = active;
    if (state.career.offers.length) pushFeed("Algunas ofertas han caducado: solo se mantienen las que no han cumplido 2 semanas.", "Algunas ofertas han caducado: solo se mantienen las que no han cumplido 2 semanas.");
  }
  if (state.career.nextOfferAt && state.currentDate < state.career.nextOfferAt) return;
  if (state.career.offers.length >= 3) { state.career.nextOfferAt = addDays(state.currentDate, 10); return; }
  generateCareerOffers(Math.min(Math.random() < 0.3 ? 2 : 1, 3 - state.career.offers.length));
  state.career.nextOfferAt = addDays(state.currentDate, 7 + Math.floor(Math.random() * 5));
}

function generateCareerOffers(count = 1) {
  const cp = careerPlayer();
  if (!cp) return;
  if (state.worldCup) return;
  const playerOVR = Number(cp.OVR || 70);
  const value = Math.max(500, Number(cp["Value(G)"] || 0));
  const ownLeagueId = state.leagueId;
  const activeClubs = new Set((state.career.offers || []).map((o) => o.clubId));
  const buckets = { mejor: [], nivel: [], peor: [] };
  state.teams
    .filter((team) => team.TeamID !== cp.TeamID && !activeClubs.has(team.TeamID) && team.leagueId)
    .forEach((team) => {
      const clubLevel = computedTeamOVR(team);
      const prestige = Number(team.ReputationStars || 3);
      if (playerOVR < clubLevel - 15) return;
      if (prestige >= 4 && playerOVR < 74) return;
      const crossLeague = team.leagueId !== ownLeagueId;
      const gap = clubLevel - playerOVR;
      const item = { team, crossLeague, gap, prestige, clubLevel };
      if (gap >= 5) buckets.mejor.push(item);
      else if (gap <= -5) buckets.peor.push(item);
      else buckets.nivel.push(item);
    });
  ["mejor", "nivel", "peor"].forEach((k) => buckets[k].sort(() => Math.random() - 0.5));
  const keys = ["mejor", "nivel", "peor"];
  const startKey = Math.floor(Math.random() * 3);
  let created = 0;
  let guard = 0;
  while (created < count && guard < 60) {
    guard += 1;
    const k = keys[(startKey + created) % 3];
    const c = buckets[k].shift();
    if (!c) continue;
    const prestige = c.prestige;
    const clubLevel = c.clubLevel;
    const strengthMod = clamp(clubLevel / playerOVR, 0.75, 1.25);
    const baseFee = Math.max(500, Math.round(value * (0.65 + Math.random() * 0.6) * strengthMod));
    const fee = baseFee + (c.crossLeague ? CROSS_LEAGUE_FEE : 0);
    const salary = Math.max(150, Math.round((baseFee / 110) * (0.7 + Math.random() * 0.6) * (1 + Math.max(0, prestige - 3) * 0.08)));
    if (Number(c.team.budget || 0) < fee) continue;
    state.career.offers = state.career.offers || [];
    const offer = { clubId: c.team.TeamID, salary, years: 2 + Math.floor(Math.random() * 3), prestige, fee, expiresAt: addDays(state.currentDate, 30), crossLeague: c.crossLeague, level: k, id: `O-${Date.now()}-${c.team.TeamID}-${Math.floor(Math.random() * 100000)}` };
    state.career.offers.push(offer);
    created += 1;
    const kindLabel = prestige >= 4 ? _("un equipo de élite", "an elite team") : k === "mejor" ? _("un club más fuerte", "a stronger club") : k === "peor" ? _("un club más modesto", "a more modest club") : _("un club de tu nivel", "a club at your level");
    pushFeed(`${"Nueva oferta de"} ${kindLabel}: ${teamName(c.team.TeamID)} (${prestige}★) ${"te ofrece"} ${money(salary)}/${"semana"} ${"por"} ${offer.years} ${"años"}. ${c.crossLeague ? "Jugarías en otra liga: la operación incluye una tasa de traspaso de" + money(CROSS_LEAGUE_FEE) + ". " : ""}${"Caduca el"} ${formatDate(offer.expiresAt, true)}.`, `${"New offer from"} ${kindLabel}: ${teamName(c.team.TeamID)} (${prestige}★) ${"offers you"} ${money(salary)}/${"week"} ${"for"} ${offer.years} ${"years"}. ${c.crossLeague ? "You would play in another league: the deal includes a transfer fee of" + money(CROSS_LEAGUE_FEE) + ". " : ""}${"Expires on"} ${formatDate(offer.expiresAt, true)}.`);
  }
}

function careerSignOffer(offer) {
  const cp = careerPlayer();
  if (!cp || !offer) return;
  const oldClub = cp.TeamID;
  const newClub = offer.clubId;
  const fee = Math.max(500, Number(offer.fee) || Math.round(Number(cp["Value(G)"] || 0)));
  const crossLeague = Boolean(offer.crossLeague);
  const baseFee = Math.max(500, fee - (crossLeague ? CROSS_LEAGUE_FEE : 0));
  const oldTeam = oldClub === "FREE" ? null : teamById(oldClub);
  const newTeam = teamById(newClub);
  if (newTeam && Number(newTeam.budget || 0) < fee) { pushFeed(`${newTeam.Name} ya no puede afrontar el traspaso de ${money(fee)}.`, `${newTeam.Name} ya no puede afrontar el traspaso de ${money(fee)}.`); saveAndRender(); return; }
  if (oldClub !== "FREE" && oldTeam) {
    state.selectedLineups[oldClub] = (state.selectedLineups[oldClub] || []).map((id) => (id === cp.PlayerID ? null : id));
  }
  cp.TeamID = newClub;
  cp.leagueId = newTeam.leagueId;
  cp["Salary(G/week)"] = Math.round(offer.salary);
  cp.ContractYears = offer.years;
  cp.morale = clamp(cp.morale + 8, 30, 100);
  if (newTeam) newTeam.budget = Math.max(0, Number(newTeam.budget || 0) - fee);
  if (oldTeam) oldTeam.budget = Number(oldTeam.budget || 0) + baseFee;
  state.managerTeamId = newClub;
  state.leagueId = cp.leagueId;
  state.career.clubId = newClub;
  state.career.offers = [];
  state.career.nextOfferAt = addDays(state.currentDate, 14);
  state.selectedLineups[newClub] = careerClubLineup(newClub);
  recalcStandings(state);
  const taxText = crossLeague ? ` ${_("Tu club anterior ingresa", "Your previous club receives")} ${money(baseFee)} ${_("y la tasa de traspaso entre ligas", "and the cross-league transfer fee")} (${money(CROSS_LEAGUE_FEE)}) ${_("se queda en la federación.", "stays with the federation.")}` : ` ${_("Tu club anterior ingresa", "Your previous club receives")} ${money(baseFee)} ${_("por tu traspaso.", "for your transfer.")}`;
  pushFeed(`${"¡Has fichado por"} ${teamName(newClub)}! ${money(offer.salary)}/${"semana"} ${"durante"} ${offer.years} ${"años."}${taxText}`, `${"You signed for"} ${teamName(newClub)}! ${money(offer.salary)}/${"week"} ${"for"} ${offer.years} ${"years."}${taxText}`);
  saveAndRender();
}

function careerClubTrophiesThisSeason() {
  const club = state.managerTeamId;
  const trophies = [];
  if (state.standings[0]?.teamId === club) trophies.push("Liga");
  const cupF = cupFinal();
  if (cupF && cupF.played && cupF.winnerId === club) trophies.push(cupShortName());
  if (state.euroCupResult?.champion?.id === club) trophies.push("Copa Europea");
  if (state.championsCupResult?.champion?.id === club) trophies.push("Torneo de Campeones");
  return trophies;
}

function careerSeasonWrap() {
  const cp = careerPlayer();
  if (!cp) return;
  const avg = state.career.ratings.length ? state.career.ratings.reduce((s, v) => s + v, 0) / state.career.ratings.length : 0;
  state.career.history.unshift({
    season: `${state.seasonYear}/${state.seasonYear + 1}`,
    clubId: state.managerTeamId,
    clubName: teamName(state.managerTeamId),
    apps: cp.appearances || 0,
    goals: cp.goals || 0,
    snitches: cp.snitches || 0,
    saves: cp.saves || 0,
    blocks: cp.blocks || 0,
    avgRating: Math.round(avg * 10) / 10,
    playerOfMatch: state.career.playerOfMatch,
    trophies: careerClubTrophiesThisSeason(),
  });
  const growth = clamp(Math.round(state.career.development / 3), 0, 4);
  if (growth > 0) {
    cp.OVR = clamp(Number(cp.OVR || 70) + growth, 40, 99);
    cp.Value1 = clamp(Number(cp.Value1 || 70) + growth, 40, 99);
    cp.Value2 = clamp(Number(cp.Value2 || 70) + growth, 40, 99);
    pushFeed(`Fin de temporada: ${cp.Name} sube +${growth} OVR gracias a su desarrollo.`, `Fin de temporada: ${cp.Name} sube +${growth} OVR gracias a su desarrollo.`);
  }
  if (state.standings[0]?.teamId === state.managerTeamId) pushFeed(`Tu club gana la liga ${state.seasonYear}/${state.seasonYear + 1}.`, `Tu club gana la liga ${state.seasonYear}/${state.seasonYear + 1}.`);
  state.career.ratings = [];
  state.career.development = 0;
  state.career.playerOfMatch = 0;
  state.career.cleanSheets = 0;
  state.career.scoringGames = 0;
  state.career.objectives = careerSeasonObjectives();
  state.career.trainingWeek = -1;
  state.career.moneyWeek = -1;
  state.career.offerWindow = "none";
  state.career.nextOfferAt = null;
  state.career.offers = [];
  const unsettledBets = (state.career.bets || []).filter((bet) => !bet.settled);
  if (unsettledBets.length) {
    const refund = unsettledBets.reduce((sum, bet) => sum + Number(bet.amount || 0), 0);
    if (refund > 0) {
      state.career.money = (state.career.money || 0) + refund;
      pushFeed(`Se devuelven ${money(refund)} de apuestas no resueltas al terminar la temporada.`, `Se devuelven ${money(refund)} de apuestas no resueltas al terminar la temporada.`);
    }
  }
  state.career.bets = [];
}

function careerYearsPro() {
  return Math.max(0, state.career?.history?.length || 0);
}

function careerLivingCost() {
  const cp = careerPlayer();
  const salary = Number(cp?.["Salary(G/week)"] || 0);
  const years = careerYearsPro();
  const base = Math.round(100 * (1 + Math.min(1, years * 0.08)));
  return Math.max(10, Math.min(base, Math.round(salary * 0.6)));
}

function careerSponsorWeekly() {
  const years = careerYearsPro();
  return Math.round(150 * (1 + Math.min(1, years * 0.06)));
}

function careerSpendPrice(kind) {
  const years = careerYearsPro();
  const factor = 1 + Math.min(1, years * 0.06);
  const prices = {
    personal: Math.round(300 * factor),
    fisio: Math.round(250 * factor),
    cocina: Math.round(150 * factor),
    casa: Math.round(800 * factor),
    restaurante: Math.round(400 * factor),
    ocio: Math.round(180 * factor),
    viaje: Math.round(700 * factor),
    auto: Math.round(1500 * factor),
    moda: Math.round(900 * factor),
    apuestas: Math.round(250 * factor),
    invertir: Math.round(1200 * factor),
    escoba: Math.round(6000 * factor),
    publicidad: Math.round(4500 * factor),
    fundacion: Math.round(8000 * factor),
    mansion: Math.round(12000 * factor),
  };
  return prices[kind] || 0;
}

function doCareerSpend(kind) {
  const cp = careerPlayer();
  if (!cp) return;
  if (kind === "apuestas") { placeCareerBet(); return; }
  const cost = careerSpendPrice(kind);
  if ((state.career.money || 0) < cost) { pushFeed("No te llega el dinero para eso. Ahorra unas semanas y vuelve.", "No te llega el dinero para eso. Ahorra unas semanas y vuelve."); saveAndRender(); return; }
  state.career.money -= cost;
  state.career.lifetimeSpent = (state.career.lifetimeSpent || 0) + cost;
  switch (kind) {
    case "personal":
      state.career.development += 4;
      pushFeed(`${cp.Name} contrata a un entrenador personal: +desarrollo.`, `${cp.Name} contrata a un entrenador personal: +desarrollo.`);
      break;
    case "fisio":
      cp.stamina = clamp(Number(cp.stamina ?? 100) + 15, 20, 100);
      if (cp.injured) cp.injuryDays = Math.max(0, Number(cp.injuryDays || 0) - 3);
      pushFeed(`${cp.Name} ${"pasa por fisioterapia: +energía y recuperación."}`, `${cp.Name} ${"goes to physiotherapy: +energy and recovery."}`);
      break;
    case "cocina":
      cp.form = clamp(Number(cp.form || 70) + 4, 35, 100);
      pushFeed(`${cp.Name} lleva una cocina sana: +forma.`, `${cp.Name} lleva una cocina sana: +forma.`);
      break;
    case "casa":
      if (Math.random() < 0.75) {
        cp.morale = clamp(Number(cp.morale || 70) + 15, 30, 100);
        pushFeed(`${cp.Name} ${"se toma una noche de fiesta en la Casa de señoritas. +moral."}`, `${cp.Name} ${"has a wild night at the Gentlemen's club. +morale."}`);
      } else {
        const mBefore = Number(cp.morale || 70);
        const fBefore = Number(cp.form || 70);
        const vBefore = Number(cp["Value(G)"] || 0);
        const salary = Number(cp["Salary(G/week)"] || 0);
        const fine = Math.min((state.career.money || 0), Math.round(salary * 2));
        cp.morale = clamp(mBefore - 30, 30, 100);
        cp.form = clamp(fBefore - 10, 35, 100);
        cp["Value(G)"] = Math.round(vBefore * 0.85);
        cp.celebrity = Math.max(0, Number(cp.celebrity || 0) - 1);
        state.career.money = (state.career.money || 0) - fine;
        const lostMorale = mBefore - cp.morale;
        const lostForm = fBefore - cp.form;
        const lostValue = vBefore - cp["Value(G)"];
  pushFeed(`${"¡ESCÁNDALO! La visita de"} ${cp.Name} ${"a la Casa de señoritas sale a la luz y le sacude de lleno: pierde"} ${lostMorale} ${"de moral,"} ${lostForm} ${"de forma,"} ${money(lostValue)} ${"de valor,"} ${money(fine)} ${"en multas y su fama se resiente."}`, `${"SCANDAL! The visit of"} ${cp.Name} ${"to the Gentlemen's club comes to light and hits him hard: he loses"} ${lostMorale} ${"of morale,"} ${lostForm} ${"of form,"} ${money(lostValue)} ${"of value,"} ${money(fine)} ${"in fines and his fame suffers."}`);
  state.career.notice = { title: _("¡Escándalo en la Casa de señoritas!", "Scandal at the Gentlemen's club!"), text: `${_("Los paparazzi pillan a", "The paparazzi catch")} ${cp.Name} ${_("saliendo de madrugada. La prensa destroza su imagen y el club le sanciona: pierde", "leaving at dawn. The press destroys his image and the club punishes him: he loses")} ${lostMorale} ${_("de moral,", "of morale,")} ${lostForm} ${_("de forma,", "of form,")} ${money(lostValue)} ${_("de valor de mercado y", "of market value and")} ${money(fine)} ${_("en multas. Además, su fama baja y tendrá que rehacerla con campañas e inversiones.", "in fines. Moreover, his fame drops and he will have to rebuild it with campaigns and investments.")}` };
      }
      break;
    case "restaurante":
      cp.morale = clamp(Number(cp.morale || 70) + 8, 30, 100);
      pushFeed(`${cp.Name} disfruta de una cena de lujo: +moral.`, `${cp.Name} disfruta de una cena de lujo: +moral.`);
      break;
    case "ocio":
      cp.morale = clamp(Number(cp.morale || 70) + 5, 30, 100);
      pushFeed(`${cp.Name} va al cine y al teatro: +moral.`, `${cp.Name} va al cine y al teatro: +moral.`);
      break;
    case "viaje":
      cp.morale = clamp(Number(cp.morale || 70) + 10, 30, 100);
      cp.stamina = clamp(Number(cp.stamina ?? 100) + 10, 20, 100);
      pushFeed(`${cp.Name} ${"se va un fin de semana de viaje: +moral y +energía."}`, `${cp.Name} ${"goes on a weekend trip: +morale and +energy."}`);
      break;
    case "auto":
      cp.morale = clamp(Number(cp.morale || 70) + 10, 30, 100);
      cp.form = clamp(Number(cp.form || 70) + 3, 35, 100);
      cp.stamina = clamp(Number(cp.stamina ?? 100) + 10, 20, 100);
      cp["Value(G)"] = Math.round(Number(cp["Value(G)"] || 0) * 1.05);
      pushFeed(`${cp.Name} ${"se compra un coche de lujo: sube su moral, forma, energía y hasta su valor de mercado."}`, `${cp.Name} ${"buys a luxury car: raises his morale, form, energy and even his market value."}`);
      break;
    case "moda":
      cp.morale = clamp(Number(cp.morale || 70) + 6, 30, 100);
      cp.form = clamp(Number(cp.form || 70) + 2, 35, 100);
      pushFeed(`${cp.Name} ${"renueva su armario con ropa de diseño: +moral y +forma."}`, `${cp.Name} ${"renews his wardrobe with designer clothes: +morale and +form."}`);
      break;
case "invertir": {
      if (Math.random() < 0.5) {
        const gain = cost * 2;
        state.career.money += gain;
        state.career.lifetimeEarned = (state.career.lifetimeEarned || 0) + gain;
        pushFeed(`${cp.Name} invierte en un negocio que triunfa: recupera su dinero y duplica la apuesta (${money(cost)} → ${money(cost * 2)}).`, `${cp.Name} invierte en un negocio que triunfa: recupera su dinero y duplica la apuesta (${money(cost)} → ${money(cost * 2)}).`);
      } else {
        pushFeed(`${cp.Name} mete su dinero en un negocio que quiebra: pierde los ${money(cost)}. No todo son escobas voladoras...`, `${cp.Name} mete su dinero en un negocio que quiebra: pierde los ${money(cost)}. No todo son escobas voladoras...`);
      }
      break;
    }
    case "escoba":
      cp.form = clamp(Number(cp.form || 70) + 2, 35, 100);
      cp.morale = clamp(Number(cp.morale || 70) + 6, 30, 100);
      state.career.development += 3;
      cp["Value(G)"] = Math.round(Number(cp["Value(G)"] || 0) * 1.08);
      pushFeed(`${cp.Name} ${"estrena una escoba de competición hecha a medida: vuela más rápido, sube su desarrollo, su moral y su valor un 8%."}`, `${cp.Name} ${"unveils a custom-made competition broom: he flies faster, raising his development, morale and value by 8%."}`);
      break;
    case "publicidad": {
      cp.celebrity = clamp(Number(cp.celebrity || 0) + 1, 0, 10);
      cp["Value(G)"] = Math.round(Number(cp["Value(G)"] || 0) * 1.05);
      const sponsorWeekly = careerSponsorWeekly();
      state.career.sponsor = { weekly: sponsorWeekly, season: state.seasonYear };
      pushFeed(`${cp.Name} ${"firma una campaña de imagen con una marca deportiva: +fama, +5% valor y un patrocinio de"} ${money(sponsorWeekly)}/${"semana"} ${"durante toda la temporada."}`, `${cp.Name} ${"signs an image campaign with a sports brand: +fame, +5% value and a sponsorship of"} ${money(sponsorWeekly)}/${"week"} ${"for the whole season."}`);
      break;
    }
    case "fundacion":
      cp.celebrity = clamp(Number(cp.celebrity || 0) + 2, 0, 10);
      cp.morale = clamp(Number(cp.morale || 70) + 6, 30, 100);
      cp["Value(G)"] = Math.round(Number(cp["Value(G)"] || 0) * 1.08);
      pushFeed(`${cp.Name} ${"crea su fundación benéfica: la prensa lo adora (+fama, +8% valor)."}`, `${cp.Name} ${"creates his charitable foundation: the press adores him (+fame, +8% value)."}`);
      break;
    case "mansion":
      cp.morale = clamp(Number(cp.morale || 70) + 15, 30, 100);
      cp.form = clamp(Number(cp.form || 70) + 6, 35, 100);
      cp["Value(G)"] = Math.round(Number(cp["Value(G)"] || 0) * 1.1);
      cp.celebrity = clamp(Number(cp.celebrity || 0) + 1, 0, 10);
      state.career.mansion = state.seasonYear;
      pushFeed(`${cp.Name} ${"se compra una mansión de ensueño: moral por las nubes, +10% valor y, mientras la mantenga, +2 moral cada semana."}`, `${cp.Name} ${"buys a dream mansion: morale through the roof, +10% value and, while he keeps it, +2 morale every week."}`);
      break;
    default:
      return;
  }
  saveAndRender();
}

function placeCareerBet(fixtureId, clubId) {
  const cp = careerPlayer();
  if (!cp || !state.career) return;
  if (!fixtureId || !clubId) { pushFeed("Elige un equipo de tu liga y su próximo partido para apostar.", "Pick a team from your league and its next match to place a bet."); saveAndRender(); return; }
  const fixture = state.fixtures.find((f) => f.id === fixtureId);
  if (!fixture) return;
  if (fixture.played) { pushFeed("Ese partido ya se ha jugado.", "Ese partido ya se ha jugado."); saveAndRender(); return; }
  const cost = careerSpendPrice("apuestas");
  if ((state.career.money || 0) < cost) { pushFeed("No te llega el dinero para apostar. Ahorra y vuelve.", "No te llega el dinero para apostar. Ahorra y vuelve."); saveAndRender(); return; }
  if ((state.career.bets || []).filter((bet) => !bet.settled).length >= 3) { pushFeed("Ya tienes 3 apuestas pendientes por resolver.", "Ya tienes 3 apuestas pendientes por resolver."); saveAndRender(); return; }
  state.career.money -= cost;
  state.career.lifetimeSpent = (state.career.lifetimeSpent || 0) + cost;
  state.career.bets = state.career.bets || [];
  const opponentId = fixture.homeId === clubId ? fixture.awayId : fixture.homeId;
  state.career.bets.push({ fixtureId, clubId, opponentId, amount: cost, placedDate: state.currentDate, settled: false });
  pushFeed(`Apuesta colocada: ${teamName(clubId)} gana a ${teamName(opponentId)} el ${formatDate(fixture.date, true)}. Si aciertas cobras ×1.5 (${money(cost * 1.5)}).`, `Apuesta colocada: ${teamName(clubId)} gana a ${teamName(opponentId)} el ${formatDate(fixture.date, true)}. Si aciertas cobras ×1.5 (${money(cost * 1.5)}).`);
  saveAndRender();
}

function settleBetsForFixture(fixture) {
  if (!state.career?.bets?.length) return;
  state.career.bets.forEach((bet) => {
    if (bet.settled || bet.fixtureId !== fixture.id) return;
    bet.settled = true;
    if (fixture.winnerId === bet.clubId) {
      const prize = Math.round(bet.amount * 1.5);
      state.career.money = (state.career.money || 0) + prize;
      state.career.lifetimeEarned = (state.career.lifetimeEarned || 0) + prize;
      pushFeed(`${"¡Tu apuesta por"} ${teamName(bet.clubId)} ${"acertó! Ganas"} ${money(prize)} (${"beneficio"} +${money(prize - bet.amount)}).`, `${"Your bet on"} ${teamName(bet.clubId)} ${"won! You win"} ${money(prize)} (${"profit"} +${money(prize - bet.amount)}).`);
    } else if (fixture.winnerId === null) {
      state.career.money = (state.career.money || 0) + bet.amount;
      pushFeed(`Empate en el partido de ${teamName(bet.clubId)}: tu apuesta queda anulada y recuperas ${money(bet.amount)}.`, `Empate en el partido de ${teamName(bet.clubId)}: tu apuesta queda anulada y recuperas ${money(bet.amount)}.`);
    } else {
      pushFeed(`${"Tu apuesta por"} ${teamName(bet.clubId)} ${"falló: pierdes"} ${money(bet.amount)}.`, `${"Your bet on"} ${teamName(bet.clubId)} ${"lost: you lose"} ${money(bet.amount)}.`);
    }
  });
}

function renderCareerNeeds() {
  const cp = careerPlayer();
  const balance = state.career.money || 0;
  const salary = Number(cp["Salary(G/week)"] || 0);
  const living = careerLivingCost();
  const sponsorActive = state.career.sponsor && state.career.sponsor.season === state.seasonYear;
  const sponsorWeekly = sponsorActive ? Number(state.career.sponsor.weekly || 0) : 0;
  const mansionActive = state.career.mansion === state.seasonYear;
  const week = Math.floor(daysBetween(seasonStart(state.seasonYear), state.currentDate) / 7);
  const paidThisWeek = state.career.moneyWeek === week;
  const item = (kind, title, desc) => {
    const price = careerSpendPrice(kind);
    return `<div class="feed-item"><span></span><span><b>${title}</b><br /><span class="muted">${desc} · ${money(price)}</span></span><span><button data-career-spend="${kind}" ${balance < price ? "disabled" : ""}>${_("Gastar", "Spend")}</button></span></div>`;
  };
  const betPrice = careerSpendPrice("apuestas");
  const pendingBets = (state.career.bets || []).filter((bet) => !bet.settled);
  const betOptions = state.teams
    .filter((team) => team.leagueId === state.leagueId)
    .map((team) => {
      const next = state.fixtures.find((fixture) => fixture.competition === "league" && !fixture.played && fixture.date >= state.currentDate && (fixture.homeId === team.TeamID || fixture.awayId === team.TeamID));
      return { team, next };
    })
    .filter((entry) => entry.next);
  const betBlock = `
    <section class="panel">
        <div class="title-row"><h2>${_("Apuestas de quidditch", "Quidditch bets")}</h2><span class="pill">×1.5</span></div>
        <p class="muted">${_("Elige un equipo de tu liga y apuesta a que gana su próximo partido", "Choose a team from your league and bet they win their next match")} (${money(betPrice)} ${_("por apuesta, máximo 3 pendientes", "per bet, max 3 pending")}). ${_("Si aciertas cobras ×1.5; si hay empate, recuperas tu dinero.", "If you win you get ×1.5; if it's a draw, your money is refunded.")}</p>
      <div class="feed">
        <div class="feed-item">
          <span></span>
          <span>
            <select data-bet-team>
              ${betOptions.map((entry) => `<option value="${entry.team.TeamID}:${entry.next.id}">${teamName(entry.team.TeamID)} gana a ${teamName(entry.next.homeId === entry.team.TeamID ? entry.next.awayId : entry.next.homeId)} · ${formatDate(entry.next.date, true)}</option>`).join("")}
            </select>
          </span>
          <span><button data-bet-submit ${betOptions.length && balance >= betPrice && pendingBets.length < 3 ? "" : "disabled"}>${_("Apostar", "Bet")} ${money(betPrice)}</button></span>
        </div>
        ${pendingBets.map((bet) => {
          const fixture = state.fixtures.find((f) => f.id === bet.fixtureId);
          const opponent = bet.opponentId ? teamName(bet.opponentId) : (fixture ? teamName(fixture.homeId === bet.clubId ? fixture.awayId : fixture.homeId) : "—");
          const date = fixture ? formatDate(fixture.date, true) : formatDate(bet.placedDate, true);
          return `<div class="feed-item"><span>•</span><span><b>${teamName(bet.clubId)}</b> vs ${opponent} <span class="muted">(${date} · ${money(bet.amount)} en juego)</span></span><span></span></div>`;
        }).join("")}
      </div>
    </section>
  `;
  return `
    <main class="screen grid two">
      <section class="panel">
        <div class="title-row"><h2>${_("Mis finanzas", "My finances")}</h2><span class="pill">${money(balance)}</span></div>
        <div class="metric-row">
          <div class="metric"><span class="muted">${_("Salario", "Wage")}</span><b>${money(salary)}/sem</b></div>
          <div class="metric"><span class="muted">${_("Necesidades", "Needs")}</span><b>−${money(living)}/sem</b></div>
          <div class="metric"><span class="muted">${_("Patrocinio", "Sponsorship")}</span><b>+${money(sponsorWeekly)}/sem</b></div>
          <div class="metric"><span class="muted">${_("Dinero actual", "Current money")}</span><b>${money(balance)}</b></div>
        </div>
        <p class="muted">${_("Cada semana cobras tu salario y se descuenta un coste de vida fijo (vivienda, comida, transporte) que sube poco a poco con los años, no con lo que ganas.", "Each week you collect your wage and a fixed living cost (housing, food, transport) is deducted, which rises slowly with the years, not with what you earn.")} ${sponsorActive ? _("Tu patrocinio te paga", "Your sponsorship pays you") + " " + money(sponsorWeekly) + "/semana " + _("esta temporada.", "this season.") : ""} ${mansionActive ? _("Tu mansión te da +2 moral cada semana.", "Your mansion gives +2 morale every week.") : ""} ${_("Si no te llega para vivir, tu moral cae.", "If you can't make ends meet, your morale drops.")} ${paidThisWeek ? _("Salario de esta semana cobrado.", "Wage for this week collected.") : _("Aún no has cobrado esta semana.", "You haven't collected this week yet.")}</p>
      </section>
      <aside class="grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Necesidades", "Needs")}</h2><span class="pill">${_("Rendimiento", "Performance")}</span></div>
          <div class="feed">
            ${item("personal", _("Entrenador personal", "Personal trainer"), _("+desarrollo (OVR crece más rápido)", "+development (OVR grows faster)"))}
            ${item("fisio", _("Fisioterapia", "Physiotherapy"), _("+energía y recuperación de lesiones", "+energy and injury recovery"))}
            ${item("cocina", _("Cocina sana", "Healthy cooking"), _("+forma", "+form"))}
          </div>
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Otras cosas", "Other things")}</h2><span class="pill">${_("Ocio y lujo", "Leisure & luxury")}</span></div>
          <div class="feed">
            ${item("casa", _("Casa de señoritas", "Gentlemen's club"), _("75% +15 moral · 25% escándalo grave (-moral, -forma, -valor, multas y fama)", "75% +15 morale · 25% serious scandal (-morale, -form, -value, fines and fame)"))}
            ${item("restaurante", _("Restaurante de lujo", "Luxury restaurant"), _("+moral", "+morale"))}
            ${item("ocio", _("Cine y teatro", "Cinema and theatre"), _("+moral", "+morale"))}
            ${item("viaje", _("Viaje de descanso", "Rest trip"), _("+moral y +energía", "+morale and +energy"))}
          </div>
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Caprichos y oportunidades", "Whims and opportunities")}</h2><span class="pill">${_("Solo para soñadores", "For dreamers only")}</span></div>
          <div class="feed">
            ${item("auto", _("Coche de lujo", "Luxury car"), _("+moral, +forma, +energía y +5% valor", "+morale, +form, +energy and +5% value"))}
            ${item("moda", _("Moda de diseño", "Designer fashion"), _("+moral y +forma", "+morale and +form"))}
            ${item("invertir", _("Invertir en negocios", "Invest in business"), _("50% doblas tu dinero · 50% lo pierdes", "50% you double your money · 50% you lose it"))}
            ${item("escoba", _("Escoba de competición", "Competition broom"), _("+desarrollo, +moral, +forma y +8% valor", "+development, +morale, +form and +8% value"))}
            ${item("publicidad", _("Campaña de imagen", "Public image campaign"), _("+fama, +5% valor y patrocinio semanal toda la temporada", "+fame, +5% value and weekly sponsorship all season"))}
          </div>
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Inversiones a lo grande", "Big-time investments")}</h2><span class="pill">${_("Solo para estrellas", "For stars only")}</span></div>
          <div class="feed">
            ${item("fundacion", _("Fundación benéfica", "Charity foundation"), _("+fama, +moral y +8% valor", "+fame, +morale and +8% value"))}
            ${item("mansion", _("Mansión de lujo", "Luxury mansion"), _("+15 moral, +forma, +10% valor y +2 moral cada semana", "+15 morale, +form, +10% value and +2 morale every week"))}
          </div>
        </section>
        ${betBlock}
      </aside>
    </main>
  `;
}

function renderCareer() {
  if (!state.career) { state.careerMode = false; state.careerPlayerId = null; render(); return; }
  if (state.worldCup) { renderCareerWorldCup(); return; }
  const cp = careerPlayer();
  const club = teamById(state.managerTeamId);
  const standing = managerStanding();
  const nav = (view, label, extra = "") => `<button data-view="${view}" class="${activeView === view ? "active" : ""} ${extra}">${label}</button>`;
  const view = renderCareerView();
  const dock = renderAdvanceDock();
  const modal = state.career.lastMatch ? renderCareerMatchModal() : state.career.notice ? renderCareerNoticeModal() : state.pendingWarning ? renderWarningModal() : state.galaModal ? renderGalaModal() : state.lastResult ? renderResultModal() : state.career.wcFinalModal ? renderCareerWcFinalModal() : "";
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div><strong>${cp ? cp.Name : _("Carrera", "Career")}</strong><span>${cp ? cp.Position + " · " + club.Name + " · " + formatDate(state.currentDate) + " · " + _("versión", "version") + " " + GAME_VERSION : ""}</span></div>
        <div class="center"><strong>${standing.position}.º · ${standing.points} ${_("pts", "pts")}</strong><span>${standing.played} ${_("PJ", "MP")} · ${_("DG", "GD")} ${standing.diff}</span></div>
        <div class="right"><strong>${cp ? _("OVR", "OVR") + " " + cp.OVR + " · " + cp.Age + " " + _("años", "yrs") : ""}</strong><span>${cp ? _("Valor", "Value") + " " + money(cp["Value(G)"]) + " · " + _("Dinero", "Money") + " " + money(state.career.money || 0) : ""}</span></div>
      </header>
      <nav class="nav">
        ${nav("career-home", _("Inicio", "Home"))}
        ${nav("career-training", _("Entrenar", "Train"))}
        ${nav("career-needs", _("Gastos", "Expenses"))}
        ${nav("career-offers", _("Ofertas", "Offers"))}
        ${nav("career-history", _("Carrera", "Career"))}
        ${nav("squad", _("Plantilla", "Squad"))}
        ${nav("career-league", _("Liga", "League"))}
        ${nav("fixtures", _("Partidos", "Matches"))}
        <button data-action="reset" class="danger">${confirmReset ? _("Confirmar nueva partida", "Confirm new game") : _("Nueva partida", "New game")}</button>
        ${confirmReset ? `<button data-action="cancel-reset">${_("Cancelar", "Cancel")}</button>` : ""}
        <button data-action="save-file" class="save-file">${_("Guardar", "Save")}</button>
        <button data-action="load-file" class="save-file">${_("Cargar", "Load")}</button>
        ${nav("titles", _("Títulos", "Trophies"), "push-right")}
      </nav>
      ${view}
      ${dock}
      ${modal}
    </div>
  `;
  bindEvents();
}

function renderCareerView() {
  if (activeView === "career-training") return renderCareerTraining();
  if (activeView === "career-needs") return renderCareerNeeds();
  if (activeView === "career-offers") return renderCareerOffers();
  if (activeView === "career-history") return renderCareerHistory();
  if (activeView === "titles") return renderTitles();
  if (activeView === "fixtures") return renderFixtures();
  if (activeView === "squad") return renderSquad();
  if (activeView === "career-league") return renderCareerLeague();
  if (activeView === "team") return renderTeamPage(selectedTeamId || state.managerTeamId);
  if (activeView === "player") return renderPlayerPage(selectedPlayerId);
  return renderCareerHome();
}

function renderCareerLeague() {
  const euroActive = Boolean(state.euroCup && Number(state.currentDate.slice(0, 4)) >= (state.euroCup.year || state.seasonYear + 1));
  const championsActive = Boolean(state.championsCup && championsCupSeason(state.seasonYear));
  const cupLive = cupFixtures().length > 0;
  const tab = careerCompTab === "euro" && euroActive ? "euro" : careerCompTab === "champions" && championsActive ? "champions" : careerCompTab === "cup" ? "cup" : "liga";
  const tabs = `
    <div class="tabs">
      <button data-comp-tab="liga" class="${tab === "liga" ? "active" : ""}">${_("Liga", "League")}</button>
      <button data-comp-tab="cup" class="${tab === "cup" ? "active" : ""}">${cupShortName()}</button>
      ${euroActive ? `<button data-comp-tab="euro" class="${tab === "euro" ? "active" : ""}">${_("Copa Europea", "European Cup")}</button>` : ""}
      ${championsActive ? `<button data-comp-tab="champions" class="${tab === "champions" ? "active" : ""}">${_("Torneo de Campeones", "Champions Tournament")}</button>` : ""}
    </div>`;
  const body = tab === "cup"
    ? (cupLive ? renderCupBracket() : `<p class="muted">${_("La", "The")} ${cupName()} ${_("aún no ha empezado: los 4 primeros de la", "has not started yet: the top 4 of the")} ${leagueInfo().name} ${_("se clasifican para las semifinales (5 y 10 de agosto) y la final (15 de agosto).", "qualify for the semi-finals (5 and 10 August) and the final (15 August).")}</p>`)
    : tab === "euro"
      ? renderEuroHome()
      : tab === "champions"
        ? renderChampionsHome()
        : renderLeagueTable();
  const statsScope = tab === "euro" ? "euro" : tab === "champions" ? "champions" : "league";
  return `
    <main class="screen grid two">
      <section class="panel">
        <div class="title-row"><h2>${leagueInfo().name}</h2><span class="pill">${state.seasonYear}/${state.seasonYear + 1} · ${formatDate(state.currentDate, true)}</span></div>
        ${tabs}
        ${body}
      </section>
      <aside class="grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Máximos puntuadores", "Top scorers")}</h2><span class="pill">${_("Quaffle", "Quaffle")}</span></div>
          ${renderStatsTable("goals", statsScope)}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Buscadores", "Seekers")}</h2><span class="pill">${_("Snitchs", "Snitches")}</span></div>
          ${renderStatsTable("snitches", statsScope)}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Noticias", "News")}</h2><span class="pill">${_("Tu liga", "Your league")}</span></div>
          ${renderFeedPanel()}
        </section>
      </aside>
    </main>
  `;
}

function renderCareerCompetitions() {
  const euroActive = Boolean(state.euroCup && Number(state.currentDate.slice(0, 4)) >= (state.euroCup.year || state.seasonYear + 1));
  const championsActive = Boolean(state.championsCup && championsCupSeason(state.seasonYear));
  const cupLive = cupFixtures().length > 0;
  const tab = homeMode === "euro" && euroActive ? "euro" : homeMode === "champions" && championsActive ? "champions" : "cup";
  return `
    <main class="screen grid two">
      <section class="panel">
        <div class="title-row"><h2>${_("Competiciones", "Competitions")}</h2><span class="pill">${teamName(state.managerTeamId)} · ${state.seasonYear}/${state.seasonYear + 1}</span></div>
        ${euroActive || championsActive ? `
        <div class="tabs">
          <button data-home-mode="cup" class="${tab === "cup" ? "active" : ""}">${cupShortName()}</button>
          ${euroActive ? `<button data-home-mode="euro" class="${tab === "euro" ? "active" : ""}">${_("Copa Europea", "European Cup")}</button>` : ""}
          ${championsActive ? `<button data-home-mode="champions" class="${tab === "champions" ? "active" : ""}">${_("Torneo de Campeones", "Champions Tournament")}</button>` : ""}
        </div>` : ""}
        ${tab === "euro" ? renderEuroHome() : tab === "champions" ? renderChampionsHome() : cupLive ? renderCupBracket() : `<p class="muted">${_("Los 4 primeros de la", "The top 4 of the")} ${leagueInfo().name} ${_("se clasifican para la", "qualify for the")} ${cupName()}: ${_("semifinales el 5 y el 10 de agosto y final el 15 de agosto.", "semi-finals on 5 and 10 August and final on 15 August.")}</p>`}
      </section>
      <aside class="grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Próximo partido", "Next match")}</h2><span class="pill">${nextManagerFixture(true) ? formatDate(nextManagerFixture(true).date, true) : _("Final", "Final")}</span></div>
          ${nextManagerFixture(true) ? `<div class="scoreline"><span>${teamName(nextManagerFixture(true).homeId)}</span><b>${_("vs", "vs")}</b><span>${teamName(nextManagerFixture(true).awayId)}</span></div><p class="muted">${competitionLabel(nextManagerFixture(true))} · ${nextManagerFixture(true).round}. ${_("Al llegar, el avance se pausa para jugar tu partido.", "When it arrives, advance pauses to play your match.")}</p>` : `<p class="muted">${_("No quedan partidos pendientes.", "No matches left pending.")}</p>`}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Noticias", "News")}</h2><span class="pill">${_("Tu liga", "Your league")}</span></div>
          ${renderFeedPanel()}
        </section>
      </aside>
    </main>
  `;
}

function renderCareerHome() {
  const cp = careerPlayer();
  const club = teamById(state.managerTeamId);
  const next = nextManagerFixture(true);
  const recent = state.career.ratings.slice(-5).reverse();
  const avg = state.career.ratings.length ? (state.career.ratings.reduce((s, v) => s + v, 0) / state.career.ratings.length).toFixed(2) : "—";
  const objectives = state.career.objectives || [];
  const offers = state.career.offers || [];
  const wc = state.career.wc || null;
  const weekTrained = state.career.trainingWeek === Math.floor(daysBetween(seasonStart(state.seasonYear), state.currentDate) / 7);
  return `
    <main class="screen grid two">
      <section class="panel">
          <div class="title-row"><h2>${cp.Name}</h2><span class="pill">${posName(cp.Position)} · ${club.Name} · ${club.ReputationStars}★</span></div>
        ${cp.injured ? `<p class="status-bad">${_("Lesionado", "Injured")}: ${cp.injuryDays} ${_("días de baja. No podrás jugar hasta recuperarte (fisioterapia o descanso aceleran la vuelta).", "days out. You won't be able to play until you recover (physiotherapy or rest speed up your return).")}</p>` : ""}
        <div class="metric-row">
          <div class="metric"><span class="muted">OVR</span><b>${cp.OVR}</b></div>
          <div class="metric"><span class="muted">${_("Técnica", "Technique")}</span><b>${cp.Value1}</b></div>
          <div class="metric"><span class="muted">${_("Física", "Fitness")}</span><b>${cp.Value2}</b></div>
          <div class="metric"><span class="muted">${_("Edad", "Age")}</span><b>${cp.Age}</b></div>
          <div class="metric"><span class="muted">${_("Nacionalidad", "Nationality")}</span><b>${cp.Nationality}</b></div>
          <div class="metric"><span class="muted">${_("Fama", "Fame")}</span><b>${Math.round(Number(cp.celebrity || 0))}/10</b></div>
          <div class="metric"><span class="muted">${_("Valor", "Value")}</span><b>${money(cp["Value(G)"])}</b></div>
        </div>
        <div class="metric-row">
          <div class="metric"><span class="muted">${_("Forma", "Form")}</span><b>${Math.round(cp.form)}</b></div>
          <div class="metric"><span class="muted">${_("Moral", "Morale")}</span><b>${Math.round(cp.morale)}</b></div>
          <div class="metric"><span class="muted">${_("Energía", "Energy")}</span><b>${Math.round(cp.stamina ?? 100)}</b></div>
          <div class="metric"><span class="muted">${_("Contrato", "Contract")}</span><b>${cp.ContractYears} ${_("años", "yrs")}</b></div>
          <div class="metric"><span class="muted">${_("Salario", "Wage")}</span><b>${money(cp["Salary(G/week)"])}/sem</b></div>
          <div class="metric"><span class="muted">${_("Cláusula", "Clause")}</span><b>${money(cp["ReleaseClause(G)"] ?? playerValue(cp) * 1.8)}</b></div>
        </div>
        <h3>${_("Esta temporada", "This season")}</h3>
        <div class="metric-row">
          <div class="metric"><span class="muted">${_("Partidos", "Matches")}</span><b>${cp.appearances || 0}</b></div>
          <div class="metric"><span class="muted">${_("Goles", "Goals")}</span><b>${cp.goals || 0}</b></div>
          <div class="metric"><span class="muted">${_("Snitchs", "Snitches")}</span><b>${cp.snitches || 0}</b></div>
          <div class="metric"><span class="muted">${_("Paradas", "Saves")}</span><b>${cp.saves || 0}</b></div>
          <div class="metric"><span class="muted">${_("Bloqueos", "Blocks")}</span><b>${cp.blocks || 0}</b></div>
          <div class="metric"><span class="muted">${_("MVP", "MVP")}</span><b>${state.career.playerOfMatch}</b></div>
          <div class="metric"><span class="muted">${_("Nota media", "Avg rating")}</span><b>${avg}</b></div>
        </div>
        ${recent.length ? `
          <h3>${_("Últimas notas", "Latest ratings")}</h3>
          <div class="feed">${recent.map((r) => `<div class="feed-item"><span>•</span><span>${_("Nota", "Rating")} ${r}</span><span></span></div>`).join("")}</div>` : ""}
      </section>
      <aside class="grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Próximo partido", "Next match")}</h2><span class="pill">${next ? formatDate(next.date, true) : _("Final", "Final")}</span></div>
          ${next ? `
            <div class="scoreline"><span>${teamName(next.homeId)}</span><b>${_("vs", "vs")}</b><span>${teamName(next.awayId)}</span></div>
            <p class="muted">${competitionLabel(next)} · ${next.round}. ${_("Al llegar, el avance se pausa para jugar tu partido.", "When it arrives, advance pauses to play your match.")}</p>
          ` : `<p class="muted">${_("No quedan partidos pendientes.", "No matches left pending.")}</p>`}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Entrenamiento semanal", "Weekly training")}</h2><span class="pill">${weekTrained ? _("Hecho esta semana", "Done this week") : _("Disponible", "Available")}</span></div>
          ${weekTrained
            ? `<p class="muted">${_("Ya has entrenado esta semana. Vuelve la semana que viene.", "You already trained this week. Come back next week.")}</p>`
            : `<div class="tabs">
                <button data-career-training="fisico">${_("Físico", "Physical")}</button>
                <button data-career-training="tecnico">${_("Técnico", "Technical")}</button>
                <button data-career-training="mental">${_("Mental", "Mental")}</button>
                <button data-career-training="descanso">${_("Descanso", "Rest")}</button>
              </div>
              <p class="muted">${_("Físico", "Physical")} (+${_("energía", "energy")}/${_("recovery", "recovery")}) · ${_("Técnico", "Technical")} (+${_("desarrollo", "development")}) · ${_("Mental", "Mental")} (+${_("forma", "form")}/${_("moral", "morale")}) · ${_("Descanso", "Rest")} (${_("recuperación total", "full recovery")}).</p>`}
        </section>
        ${offers.length ? `
        <section class="panel">
          <div class="title-row"><h2>${_("Ofertas recibidas", "Offers received")}</h2><span class="pill">${offers.length}</span></div>
          ${offers.slice(0, 2).map((o) => `<div class="feed-item"><span>${o.prestige}★</span><span>${teamName(o.clubId)} · ${money(o.salary)}/sem</span><span></span></div>`).join("")}
          <br /><button data-view="career-offers" class="primary">${_("Ver todas", "See all")}</button>
        </section>` : ""}
        <section class="panel">
          <div class="title-row"><h2>${_("Objetivos", "Objectives")}</h2><span class="pill">${objectives.filter((o) => o.done).length}/${objectives.length}</span></div>
          <div class="feed">${objectives.map((o) => `<div class="feed-item"><span>${o.done ? "✔" : "•"}</span><span>${o.text} <span class="muted">(${typeof o.progress === "number" ? Math.round(o.progress * 10) / 10 : 0}/${o.target})</span></span><span></span></div>`).join("")}</div>
        </section>
        ${wc ? `
        <section class="panel">
          <div class="title-row"><h2>${_("Mundial de Quidditch", "Quidditch World Cup")} ${wc.year}</h2><span class="pill">${wc.mode === "playing" ? _("Convocado", "Called up") : _("Espectador", "Spectator")}</span></div>
          ${wc.mode === "playing"
            ? `<p class="muted">${_("Jugaste el Mundial con", "You played the World Cup with")} ${wc.teamName}.${wc.final ? (wc.final.championed ? " <b class='status-good'>" + _("¡Campeón del mundo!", "World champion!") + "</b>" : ` ${_("Tu selección no levantó el título.", "Your national team did not lift the title.")}`) : ""}</p>`
            : `<p class="muted">${_("No fuiste convocado por tu selección", "You were not called up by your national team")} (${wc.teamName || _("sin selección nacional", "no national team")}): ${_("seguiste el Mundial como espectador.", "you followed the World Cup as a spectator.")}</p>`}
          ${wc.result ? `<p class="muted">${_("Campeón", "Champion")}: <b>${wc.result.champion?.name || "—"}</b>${wc.result.championed ? " <span class='status-good'>(" + _("tu selección", "your national team") + ")</span>" : ""}${wc.result.runnerUp ? ` · ${_("Subcampeón", "Runner-up")}: ${wc.result.runnerUp.name}` : ""}${wc.result.third ? ` · ${_("3º", "3rd")}: ${wc.result.third.name}` : ""}</p>` : ""}
        </section>` : ""}
        <section class="panel">
          <div class="title-row"><h2>${_("Noticias", "News")}</h2><span class="pill">${_("Tu liga", "Your league")}</span></div>
          ${renderFeedPanel()}
        </section>
      </aside>
    </main>
  `;
}

function renderCareerPlayer() {
  const cp = careerPlayer();
  const club = teamById(state.managerTeamId);
  const avg = state.career.ratings.length ? (state.career.ratings.reduce((s, v) => s + v, 0) / state.career.ratings.length).toFixed(2) : "—";
  const season = state.career.history[0];
  return `
    <main class="screen grid two">
      <section class="panel">
          <div class="title-row"><h2>${cp.Name}</h2><span class="pill">${posName(cp.Position)} · ${club.Name}</span></div>
        <div class="metric-row">
          <div class="metric"><span class="muted">OVR</span><b>${cp.OVR}</b></div>
          <div class="metric"><span class="muted">${_("Técnica", "Technique")}</span><b>${cp.Value1}</b></div>
          <div class="metric"><span class="muted">${_("Física", "Fitness")}</span><b>${cp.Value2}</b></div>
          <div class="metric"><span class="muted">${_("Edad", "Age")}</span><b>${cp.Age}</b></div>
          <div class="metric"><span class="muted">${_("Nacionalidad", "Nationality")}</span><b>${cp.Nationality}</b></div>
          <div class="metric"><span class="muted">${_("Valor", "Value")}</span><b>${money(cp["Value(G)"])}</b></div>
        </div>
        <p class="muted">${_("Cláusula de rescisión", "Release clause")}: ${money(cp["ReleaseClause(G)"])} · ${_("Salario", "Wage")}: ${money(cp["Salary(G/week)"])}/${_("semana", "week")} · ${_("Contrato", "Contract")}: ${cp.ContractYears} ${_("año(s)", "yr(s)")}.</p>
      </section>
      <aside class="grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Esta temporada", "This season")}</h2><span class="pill">${_("Nota media", "Avg rating")} ${avg}</span></div>
          <div class="feed">
            <div class="feed-item"><span>${_("PJ", "MP")}</span><span>${cp.appearances || 0}</span><span></span></div>
            <div class="feed-item"><span>${_("Goles", "Goals")}</span><span>${cp.goals || 0}</span><span></span></div>
            <div class="feed-item"><span>${_("Snitchs", "Snitches")}</span><span>${cp.snitches || 0}</span><span></span></div>
            <div class="feed-item"><span>${_("Paradas", "Saves")}</span><span>${cp.saves || 0}</span><span></span></div>
            <div class="feed-item"><span>${_("Bloqueos", "Blocks")}</span><span>${cp.blocks || 0}</span><span></span></div>
            <div class="feed-item"><span>${_("Jugador del partido", "Player of the match")}</span><span>${state.career.playerOfMatch}</span><span></span></div>
          </div>
        </section>
      </aside>
    </main>
  `;
}

function renderCareerTraining() {
  const cp = careerPlayer();
  const week = Math.floor(daysBetween(seasonStart(state.seasonYear), state.currentDate) / 7);
  const weekTrained = state.career.trainingWeek === week;
  return `
    <main class="screen">
      <section class="panel">
        <div class="title-row"><h2>${_("Entrenamiento", "Training")}</h2><span class="pill">${weekTrained ? _("Hecho esta semana", "Done this week") : _("Una acción por semana", "One action per week")}</span></div>
        ${weekTrained ? `<p class="muted">${_("Ya has entrenado esta semana. Elige la próxima semana para volver a entrenar. Tu enfoque actual:", "You already trained this week. Choose next week to train again. Your current focus:")} <b>${state.career.training}</b>.</p>` : `
          <div class="team-pick">
            <button data-career-training="fisico"><span class="team-name">${_("Físico", "Physical")}</span><br /><span class="muted">${_("+Energía, acelera la recuperación de lesiones y suma desarrollo.", "+Energy, speeds up injury recovery and adds development.")}</span></button>
            <button data-career-training="tecnico"><span class="team-name">${_("Técnico", "Technical")}</span><br /><span class="muted">${_("Máximo desarrollo: tu OVR crece más rápido.", "Max development: your OVR grows faster.")}</span></button>
            <button data-career-training="mental"><span class="team-name">${_("Mental", "Mental")}</span><br /><span class="muted">${_("+Forma y +moral para rendir mejor los domingos.", "+Form and +morale to perform better on matchdays.")}</span></button>
            <button data-career-training="descanso"><span class="team-name">${_("Descanso", "Rest")}</span><br /><span class="muted">${_("Recuperación total de energía y moral.", "Full recovery of energy and morale.")}</span></button>
          </div>`}
        <p class="muted">${_("Tu estado actual", "Your current state")}: ${_("Forma", "Form")} ${Math.round(cp.form)} · ${_("Moral", "Morale")} ${Math.round(cp.morale)} · ${_("Energía", "Energy")} ${Math.round(cp.stamina ?? 100)}. ${_("Desarrollo acumulado", "Accumulated development")}: ${Math.round(state.career.development * 10) / 10}.</p>
      </section>
    </main>
  `;
}

function renderCareerOffers() {
  const offers = state.career.offers || [];
  const cp = careerPlayer();
  if (!offers.length) return `<main class="screen"><section class="panel"><div class="title-row"><h2>${_("Ofertas", "Offers")}</h2></div><p class="muted">${_("Aún no tienes ofertas. Juega bien, mantén tu forma alta y llegarán a lo largo de toda la temporada: de equipos más fuertes y más modestos, con buenas y malas condiciones. Cada oferta caduca al cabo de un mes si no la aceptas o rechazas.", "You have no offers yet. Play well, keep your form high and they will come throughout the season: from stronger and more modest clubs, with good and bad conditions. Each offer expires after a month if you don't accept or reject it.")}</p></section></main>`;
  const standingFor = (clubId) => {
    const team = teamById(clubId);
    if (!team) return "";
    const rows = state.leagueStandings?.[team.leagueId] || [];
    const index = rows.findIndex((row) => row.teamId === clubId);
    return index >= 0 ? `${index + 1}.º en ${leagueById(team.leagueId).name} · ${rows[index].points} pts` : "";
  };
  return `
    <main class="screen">
      <section class="panel">
        <div class="title-row"><h2>${_("Ofertas de otros clubes", "Offers from other clubs")}</h2><span class="pill">${offers.length} · ${_("caducan al cabo de un mes", "expire after a month")}</span></div>
        ${offers.map((o) => `
          <div class="cup-champion" data-career-offer-team="${o.clubId}">
            <div><b>${teamName(o.clubId)}</b><span class="muted">${o.prestige}★ ${_("reputación", "reputation")} · ${o.level === "mejor" ? _("Club más fuerte", "Stronger club") : o.level === "peor" ? _("Club más modesto", "Modest club") : _("Tu nivel", "Your level")} · ${money(o.salary)}/${_("semana", "week")} · ${o.years} ${_("años", "yrs")} · ${_("Traspaso", "Transfer")} ${money(o.fee || Math.round(cp["Value(G)"] || 0))}${o.crossLeague ? " (" + _("otra liga", "other league") + ", +" + money(CROSS_LEAGUE_FEE) + " " + _("de tasa", "fee") + ")" : ""} · ${standingFor(o.clubId) || _("Tu liga", "Your league")} · ${_("Caduca el", "Expires on")} ${formatDate(o.expiresAt || addDays(state.currentDate, 30), true)}</span></div>
            <div class="form-row">
              <button data-career-offer-sign="${o.id}" class="primary">${_("Fichar", "Sign")}</button>
              <button data-career-offer-reject="${o.id}">${_("Rechazar", "Reject")}</button>
            </div>
          </div>`).join("")}
      </section>
    </main>
  `;
}

function renderCareerHistory() {
  const history = state.career.history || [];
  const awards = state.career.awards || [];
  const cp = careerPlayer();
  const trophyCounts = {};
  history.forEach((h) => (h.trophies || []).forEach((t) => { trophyCounts[t] = (trophyCounts[t] || 0) + 1; }));
  const cupLabel = cupShortName();
  const summary = [
    [_("Ligas", "Leagues"), trophyCounts["Liga"] || 0],
    [_("Copas", "Cups"), trophyCounts[cupLabel] || trophyCounts["Copa"] || 0],
    [_("Copas Europeas", "European Cups"), trophyCounts["Copa Europea"] || 0],
    [_("Torneos de Campeones", "Champions Tournaments"), trophyCounts["Torneo de Campeones"] || 0],
    [_("Mundiales", "World Cups"), Number(cp?.worldCupTitles || 0)],
    [_("Escobas de Oro", "Golden Brooms"), Number(cp?.reputation || 0)],
    [_("Escobas de Oro Internacionales", "International Golden Brooms"), Number(cp?.intlReputation || 0)],
  ];
  const teamTrophies = (trophyCounts["Liga"] || 0) + (trophyCounts[cupLabel] || trophyCounts["Copa"] || 0) + (trophyCounts["Copa Europea"] || 0) + (trophyCounts["Torneo de Campeones"] || 0) + Number(cp?.worldCupTitles || 0);
  const totalTrophies = teamTrophies + awards.length;
  return `
    <main class="screen grid two">
      <section class="panel">
        <div class="title-row"><h2>${_("Historial de temporadas", "Season history")}</h2><span class="pill">${history.length} ${_("temporada(s)", "season(s)")}</span></div>
        ${history.length ? `<div class="feed">${history.map((h) => `
          <div class="feed-item"><span>${h.season}</span><span><b>${h.clubName}</b> · ${_("PJ", "MP")} ${h.apps} · ${_("G", "G")} ${h.goals} · ${_("S", "S")} ${h.snitches} · ${_("P", "Saves")} ${h.saves} · ${_("B", "B")} ${h.blocks} · ${_("Nota", "Rating")} ${h.avgRating} · ${_("MVP", "MVP")} ${h.playerOfMatch}</span><span>${h.trophies.length ? h.trophies.join(", ") : ""}</span></div>`).join("")}</div>` : `<p class="muted">${_("Aún no has acabado ninguna temporada.", "You haven't finished any season yet.")}</p>`}
      </section>
      <aside class="grid">
        <section class="panel">
          <div class="title-row"><h2>${_("Vitrina de trofeos", "Trophy cabinet")}</h2><span class="pill">${totalTrophies}</span></div>
          ${summary.some((row) => row[1] > 0)
            ? `<div class="table-scroll"><table class="data-table"><tbody>${summary.filter((row) => row[1] > 0).map((row) => `<tr><td>${row[0]}</td><td><b>${row[1]}</b></td></tr>`).join("")}</tbody></table></div><p class="muted">${_("Ligas, copas y competiciones ganadas por tus clubes en tus temporadas, más tus Mundiales y premios individuales.", "Leagues, cups and competitions won by your clubs in your seasons, plus your World Cups and individual awards.")}</p>`
            : `<p class="muted">${_("Tu vitrina está vacía. Gana ligas, copas, Mundiales y premios individuales para llenarla.", "Your cabinet is empty. Win leagues, cups, World Cups and individual awards to fill it.")}</p>`}
        </section>
        <section class="panel">
          <div class="title-row"><h2>${_("Reconocimientos", "Awards")}</h2><span class="pill">${awards.length}</span></div>
          ${awards.length ? `<div class="feed">${awards.map((a) => `<div class="feed-item"><span>🏆</span><span>${a}</span><span></span></div>`).join("")}</div>` : `<p class="muted">${_("Gana títulos y premios individuales para llenar tu vitrina.", "Win titles and individual awards to fill your cabinet.")}</p>`}
        </section>
      </aside>
    </main>
  `;
}

function careerWcEligibility() {
  const cp = careerPlayer();
  if (!cp) return { team: null, callup: false };
  const wcTeams = worldCupTeamsList();
  const team = wcTeams.find((t) => (t.Country || "").trim().toLowerCase() === (cp.Nationality || "").trim().toLowerCase()) || null;
  if (!team) return { team: null, callup: false };
  const pool = state.players.map((p) => ({ ...p, leagueId: p.leagueId || state.leagueId }));
  const squad = composeNationalSquad(team, pool);
  if (!squad) return { team, callup: false };
  return { team, callup: squad.some((p) => p.PlayerID === cp.PlayerID) };
}

function startCareerWorldCup() {
  stopAdvance();
  const cp = careerPlayer();
  if (!cp) { startWorldCup(); return; }
  const { team, callup } = careerWcEligibility();
  const year = worldCupYear();
  if (!callup || !team) { simulateCareerWorldCupSpectator(team, cp, year); return; }
  const league = clone(state);
  league.worldCup = null;
  const wc = buildWorldCupState(year, league);
  const roster = wc.players.find((p) => p.sourcePlayerId === cp.PlayerID);
  wc.careerMode = true;
  wc.career = clone(league.career);
  wc.careerPlayerId = roster ? roster.PlayerID : null;
  wc.career.wc = { year, mode: "playing", clubId: league.managerTeamId, playerId: league.careerPlayerId, teamId: team.TeamID, teamName: team.Name, ratings: [] };
  wc.managerTeamId = team.TeamID;
  wc.worldCup.league = clone(league);
  wc.feed = [`${_("Copa del Mundo de Quidditch", "Quidditch World Cup")} ${year}: ${cp.Name} ${_("ha sido convocado por", "has been called up by")} ${team.Name}. ${_("Juegas el Mundial con tu selección.", "You play the World Cup with your national team.")}`, ...wc.feed];
  state = wc;
  activeView = "home";
  selectedTeamId = null;
  marketTab = "buy";
  confirmReset = false;
  saveAndRender();
}

function simulateCareerWorldCupSpectator(team, cp, year) {
  const league = clone(state);
  league.worldCup = null;
  const wc = buildWorldCupState(year, league);
  wc.managerTeamId = null;
  const savedState = state;
  state = wc;
  try {
    const dates = [...new Set(wc.fixtures.map((f) => f.date))].sort();
    dates.forEach((date) => {
      wc.fixtures.filter((f) => f.date === date && !f.played && f.homeId && f.awayId).forEach((f) => simulateMatch(f));
      resolveWorldCupBracket();
    });
  } finally {
    state = savedState;
  }
  const final = wc.fixtures.find((f) => f.competition === "worldcup" && f.round === "Final");
  const champion = final && final.winnerId ? wc.teams.find((t) => t.TeamID === final.winnerId) : null;
  const runnerUp = final && final.loserId ? wc.teams.find((t) => t.TeamID === final.loserId) : null;
  const thirdF = wc.fixtures.find((f) => f.competition === "worldcup" && f.round === "Tercer puesto");
  const third = thirdF && thirdF.winnerId ? wc.teams.find((t) => t.TeamID === thirdF.winnerId) : null;
  const result = {
    year,
    champion: champion ? { id: champion.TeamID, name: champion.Name } : null,
    runnerUp: runnerUp ? { id: runnerUp.TeamID, name: runnerUp.Name } : null,
    third: third ? { id: third.TeamID, name: third.Name } : null,
    championed: champion ? champion.TeamID === (team?.TeamID || "") : false,
  };
  state.worldCupResults = state.worldCupResults || [];
  state.worldCupResults.push(result);
  state.worldCupPlayedYear = year - 1;
  state.currentDate = addDays(wcFinalDate(year), 1);
  state.career.wc = { year, mode: "spectator", teamId: team ? team.TeamID : null, teamName: team ? team.Name : null, result };
  state.career.wcFinalModal = true;
  const teamNameStr = team ? team.Name : _("sin selección que te convocara", "no national team called you up");
  state.feed = [
    { text: `${_("Copa del Mundo", "World Cup")} ${year}: ${champion ? champion.Name : "—"} ${_("se proclama campeón.", "is proclaimed champion.")} ${team ? (team.TeamID === final?.winnerId ? _("¡Tu selección es campeona!", "Your national team are the champions!") : `${_("Tu selección", "Your national team")} (${team.Name}) ${_("no pudo con el título.", "could not take the title.")}`) : _("No tenías selección nacional.", "You had no national team.")}`, scope: "world" },
    { text: `${_("Mundial de Quidditch", "Quidditch World Cup")} ${year}: ${_("no fuiste convocado por", "you were not called up by")} ${teamNameStr}, ${_("así que lo seguiste todo como espectador. Entrena duro para ser convocado la próxima vez.", "so you followed it all as a spectator. Train hard to be called up next time.")}`, scope: "world" },
    ...state.feed,
  ].slice(0, 24);
  saveAndRender();
}

function renderCareerWorldCup() {
  const cp = careerPlayer();
  const team = teamById(state.managerTeamId);
  const wc = state.career.wc || {};
  const standingLabel = (() => {
    const tables = wcGroupTables(state);
    for (const letter of ["A", "B", "C", "D"]) {
      const idx = (tables[letter] || []).findIndex((row) => row.teamId === state.managerTeamId);
      if (idx >= 0) return `${idx + 1}.º grupo ${letter} · ${(tables[letter][idx] || {}).points || 0} pts`;
    }
    return "Mundial";
  })();
  const nav = (view, label) => `<button data-view="${view}" class="${activeView === view ? "active" : ""}">${label}</button>`;
  const content = activeView === "squad" ? renderWorldCupGroupView("squad") : activeView === "fixtures" ? renderWorldCupGroupView("fixtures") : activeView === "team" ? renderTeamPage(selectedTeamId || state.managerTeamId) : activeView === "player" ? renderPlayerPage(selectedPlayerId) : renderWorldCupHome();
  const dock = renderAdvanceDock();
  const modal = state.career.lastMatch ? renderCareerMatchModal() : state.career.notice ? renderCareerNoticeModal() : "";
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div><strong>${cp ? cp.Name : _("Mundial", "World Cup")}</strong><span>${team ? team.Name + " · " + formatDate(state.currentDate) + " · " + _("versión", "version") + " " + GAME_VERSION : _("Mundial", "World Cup") + " " + state.seasonYear}</span></div>
        <div class="center"><strong>${standingLabel}</strong><span>${wc.mode === "playing" ? _("Convocado · juegas el Mundial", "Called up · you play the World Cup") : _("Espectador", "Spectator")}</span></div>
        <div class="right"><strong>${cp ? _("OVR", "OVR") + " " + cp.OVR + " · " + cp.Age + " " + _("años", "yrs") : ""}</strong><span>${cp ? _("Valor", "Value") + " " + money(cp["Value(G)"]) + " · " + _("Dinero", "Money") + " " + money(state.career.money || 0) : ""}</span></div>
      </header>
      <nav class="nav">
        ${nav("home", _("Inicio", "Home"))}
        ${nav("fixtures", _("Partidos", "Matches"))}
        ${nav("squad", _("Plantilla", "Squad"))}
        <button data-action="save-file" class="save-file">${_("Guardar", "Save")}</button>
        <button data-action="load-file" class="save-file">${_("Cargar", "Load")}</button>
      </nav>
      ${content}
      ${dock}
      ${modal}
    </div>
  `;
  bindEvents();
}

function renderCareerNoticeModal() {
  const notice = state.career.notice;
  if (!notice) return "";
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="title-row"><h2>${notice.title}</h2></div>
        <p>${notice.text}</p>
        <div class="form-row"><button data-career-close-notice class="primary">${_("Continuar", "Continue")}</button></div>
      </div>
    </div>
  `;
}

function renderCareerWcFinalModal() {
  const wc = state.career.wc || {};
  const result = wc.result || {};
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="title-row"><h2>${result.championed ? _("¡Campeón del Mundo!", "World Champion!") : _("Mundial terminado", "World Cup finished")}</h2><span class="pill">${_("Copa del Mundo de Quidditch", "Quidditch World Cup")} ${result.year || ""}</span></div>
        ${wc.mode === "playing"
          ? `<p>${result.championed ? `${_("Jugaste el Mundial con", "You played the World Cup with")} ${wc.teamName} ${_("y os proclamásteis", "and you were crowned")} <b>${_("campeones del mundo", "world champions")}</b>. ${_("Si fuiste parte de la plantilla campeona, tu OVR sube +1 y tu forma y moral van al 100.", "If you were part of the champion squad, your OVR rises +1 and your form and morale go to 100.")}` : `${_("Jugaste el Mundial con", "You played the World Cup with")} ${wc.teamName}${_(", pero no pudisteis levantar el título.", ", but you could not lift the title.")}`}</p>`
          : `<p>${_("No fuiste convocado por", "You were not called up by")} ${wc.teamName || _("tu selección", "your national team")}${_(", así que seguiste el Mundial como espectador desde casa. Entrena duro para entrar en la próxima convocatoria.", ", so you followed the World Cup as a spectator from home. Train hard to make the next call-up.")}</p>`}
        <div class="cup-champion"><div><b>${result.champion?.name || "—"}</b><span class="muted">${_("Se proclama campeón del mundo de Quidditch", "is proclaimed Quidditch world champion")} ${result.year || ""}.</span></div></div>
        <div class="feed">
          ${result.runnerUp ? `<div class="feed-item"><span>2º</span><span>${result.runnerUp.name}</span><span></span></div>` : ""}
          ${result.third ? `<div class="feed-item"><span>3º</span><span>${result.third.name}</span><span></span></div>` : ""}
        </div>
        <div class="form-row"><button data-career-close-wc class="primary">${_("Continuar", "Continue")}</button></div>
      </div>
    </div>
  `;
}

function startCareerAtClub(clubId) {
  const playerRow = careerSetupRandom || careerSetupCustom;
  if (!playerRow || !clubId || !teamById(clubId)) return;
  stopAdvance();
  state = buildCareerState(playerRow, clubId);
  careerSetup = null;
  careerSetupRandom = null;
  careerSetupCustom = null;
  activeView = "career-home";
  selectedTeamId = null;
  marketTab = "buy";
  confirmReset = false;
  pushFeed(`Comienza tu carrera de jugador: ${careerPlayer().Name} ficha por ${teamName(state.managerTeamId)}.`, `Comienza tu carrera de jugador: ${careerPlayer().Name} ficha por ${teamName(state.managerTeamId)}.`);
  saveAndRender();
}

function careerGameReset() {
  if (!confirmReset) { confirmReset = true; render(); return; }
  stopAdvance();
  try { localStorage.removeItem(CAREER_SAVE_KEY); } catch (e) {}
  careerSetup = null;
  careerSetupRandom = null;
  careerSetupCustom = null;
  state = buildInitialState();
  activeView = "home";
  selectedTeamId = null;
  confirmReset = false;
  render();
}

function bindEvents() {
  const langSel = app.querySelector("[data-lang]");
  if (langSel) langSel.addEventListener("change", () => { setLang(langSel.value, true); });
  app.querySelectorAll("[data-team-pick]").forEach((button) => { button.addEventListener("click", () => chooseTeam(button.dataset.teamPick)); });
  app.querySelectorAll("[data-league-pick]").forEach((button) => { button.addEventListener("click", () => chooseLeague(button.dataset.leaguePick)); });
  app.querySelectorAll("[data-back-league]").forEach((button) => { button.addEventListener("click", () => { selectedLeagueId = null; render(); }); });
  app.querySelectorAll("[data-wc-team]").forEach((rowEl) => { rowEl.addEventListener("click", () => { selectedTeamId = rowEl.dataset.wcTeam; activeView = "team"; render(); }); });
  app.querySelectorAll("[data-view]").forEach((button) => { button.addEventListener("click", () => { activeView = button.dataset.view; confirmReset = false; render(); }); });
  app.querySelectorAll("[data-open-team]").forEach((rowEl) => { rowEl.addEventListener("click", () => { selectedTeamId = rowEl.dataset.openTeam; activeView = "team"; render(); }); });
  app.querySelectorAll("[data-promote]").forEach((button) => { button.addEventListener("click", () => { promoteStarter(button.dataset.promote); onlineEcho("promoteStarter", [button.dataset.promote]); }); });
  app.querySelectorAll("[data-demote]").forEach((button) => { button.addEventListener("click", () => { demoteStarter(button.dataset.demote); onlineEcho("demoteStarter", [button.dataset.demote]); }); });
  app.querySelectorAll("[data-sell]").forEach((button) => { button.addEventListener("click", () => { sellPlayer(button.dataset.sell); onlineEcho("sellPlayer", [button.dataset.sell]); }); });
  app.querySelectorAll("[data-sell-league]").forEach((button) => { button.addEventListener("click", () => { sellPlayerToLeague(button.dataset.sellLeague); onlineEcho("sellPlayerToLeague", [button.dataset.sellLeague]); }); });
  app.querySelectorAll("[data-buy]").forEach((button) => { button.addEventListener("click", () => { buyPlayer(button.dataset.buy, true); onlineEcho("buyPlayer", [button.dataset.buy, true]); }); });
  app.querySelectorAll("[data-offer]").forEach((button) => { button.addEventListener("click", () => { startNegotiation(button.dataset.offer); onlineEcho("startNegotiation", [button.dataset.offer]); }); });
  app.querySelectorAll("[data-intl-offer]").forEach((button) => { button.addEventListener("click", () => { startIntlNegotiation(button.dataset.intlOffer); onlineEcho("startIntlNegotiation", [button.dataset.intlOffer]); }); });
  app.querySelectorAll("[data-offer-submit]").forEach((button) => {
    button.addEventListener("click", () => {
      const fee = Number(app.querySelector("[data-offer-fee]")?.value ?? 0);
      const salary = Number(app.querySelector("[data-offer-salary]")?.value ?? 0);
      submitNegotiation(fee, salary);
      onlineEcho("submitNegotiation", [fee, salary]);
    });
  });
  const feeInput = app.querySelector("[data-offer-fee]");
  const salaryInput = app.querySelector("[data-offer-salary]");
  if (feeInput && salaryInput) {
    const updateOfferPreview = () => {
      const fee = Number(feeInput.value);
      const salary = Number(salaryInput.value);
      const neg = state.negotiation;
      const player = neg ? playerById(neg.playerId) : null;
      if (!player) return;
      const feeLabel = app.querySelector(".offer-fee-label");
      const salaryLabel = app.querySelector(".offer-salary-label");
      if (feeLabel) feeLabel.textContent = money(fee);
      if (salaryLabel) salaryLabel.textContent = money(salary) + "/sem";
      const chance = negotiationChance(player, fee, salary, Boolean(state.negotiation.intl));
      const chanceLabel = app.querySelector(".offer-chance-label");
      if (chanceLabel) chanceLabel.textContent = `${_("Probabilidad estimada:", "Estimated probability:")} ${chance}% (${fee >= releaseClause(player) ? _("garantizada por cláusula", "guaranteed by release clause") : _("aceptación, contraoferta o rechazo", "acceptance, counter-offer or rejection")})`;
    };
    feeInput.addEventListener("input", updateOfferPreview);
    salaryInput.addEventListener("input", updateOfferPreview);
    updateOfferPreview();
  }
  app.querySelectorAll("[data-offer-accept]").forEach((button) => { button.addEventListener("click", () => { acceptNegotiationCounter(); onlineEcho("acceptNegotiationCounter", []); }); });
  app.querySelectorAll("[data-offer-withdraw]").forEach((button) => { button.addEventListener("click", () => { withdrawNegotiation(); onlineEcho("withdrawNegotiation", []); }); });
  app.querySelectorAll("[data-offer-cancel]").forEach((button) => { button.addEventListener("click", () => { state.negotiation = null; render(); }); });
  app.querySelectorAll("[data-offer-close]").forEach((button) => { button.addEventListener("click", () => { state.negotiation = null; saveAndRender(); }); });
  app.querySelectorAll("[data-market-tab]").forEach((button) => { button.addEventListener("click", () => { marketTab = button.dataset.marketTab; render(); }); });
  app.querySelectorAll("[data-feed-tab]").forEach((button) => { button.addEventListener("click", () => { homeFeedTab = button.dataset.feedTab; render(); }); });
  app.querySelectorAll("[data-renew]").forEach((button) => { button.addEventListener("click", () => { renewContract(button.dataset.renew); onlineEcho("renewContract", [button.dataset.renew]); }); });
  app.querySelectorAll("[data-shield]").forEach((button) => { button.addEventListener("click", () => { shieldPlayer(button.dataset.shield); onlineEcho("shieldPlayer", [button.dataset.shield]); }); });
  app.querySelectorAll("[data-titles-filter]").forEach((button) => { button.addEventListener("click", () => { titlesFilter = button.dataset.titlesFilter; render(); }); });
  app.querySelectorAll("[data-titles-intl-filter]").forEach((button) => { button.addEventListener("click", () => { titlesIntlFilter = button.dataset.titlesIntlFilter; render(); }); });
  app.querySelectorAll("[data-titles-entity]").forEach((button) => { button.addEventListener("click", () => { titlesEntity = button.dataset.titlesEntity; render(); }); });
  app.querySelectorAll("[data-titles-player-filter]").forEach((button) => { button.addEventListener("click", () => { titlesPlayerFilter = button.dataset.titlesPlayerFilter; render(); }); });
  app.querySelectorAll("[data-open-player]").forEach((row) => { row.addEventListener("click", (event) => { if (event.target.closest("button, a, input, select, label")) return; selectedPlayerId = row.dataset.openPlayer; activeView = "player"; render(); }); });
  app.querySelectorAll("[data-back-player]").forEach((button) => { button.addEventListener("click", () => { activeView = "squad"; selectedPlayerId = null; render(); }); });
  app.querySelectorAll("[data-home-mode]").forEach((button) => { button.addEventListener("click", () => { homeMode = button.dataset.homeMode; render(); }); });
  app.querySelectorAll("[data-comp-tab]").forEach((button) => { button.addEventListener("click", () => { careerCompTab = button.dataset.compTab; render(); }); });
  app.querySelector("[data-close-result]")?.addEventListener("click", () => {
    state.lastResult = null;
    if (state.cupWrapPending) { state.cupWrapPending = false; state.pendingLeagueWrap = true; }
    saveAndRender();
  });
  app.querySelector("[data-dismiss-warning]")?.addEventListener("click", () => { state.pendingWarning = null; render(); });
  app.querySelector("[data-force-advance]")?.addEventListener("click", () => { state.pendingWarning = null; startAdvance(true); });
  app.querySelector("[data-next-season]")?.addEventListener("click", () => { resetSeason(state.seasonYear + 1); saveAndRender(); });
  app.querySelector("[data-gala]")?.addEventListener("click", () => { holdGala(); saveAndRender(); });
  app.querySelector("[data-close-wc-final]")?.addEventListener("click", () => { state.wcFinalModal = false; saveAndRender(); });
  app.querySelector("[data-close-gala]")?.addEventListener("click", () => { state.galaModal = false; saveAndRender(); });
  app.querySelector("[data-start-cup]")?.addEventListener("click", () => {
    if (isWorldCupSeason() && state.worldCupPlayedYear !== state.seasonYear) { if (state.careerMode && state.career) startCareerWorldCup(); else startWorldCup(); saveAndRender(); return; }
    if (championsCupSeason(state.seasonYear) && !state.championsCup?.done) { startChampionsPhase(); saveAndRender(); return; }
    startCupPhase(); saveAndRender();
  });
  app.querySelector("[data-action='reset']")?.addEventListener("click", resetGame);
  app.querySelector("[data-action='save-file']")?.addEventListener("click", exportGame);
  app.querySelector("[data-action='load-file']")?.addEventListener("click", openImportPicker);
  app.querySelector("[data-load-file]")?.addEventListener("click", openImportPicker);
  app.querySelector("[data-action='cancel-reset']")?.addEventListener("click", () => { confirmReset = false; render(); });
  app.querySelectorAll("[data-career-start]").forEach((button) => { button.addEventListener("click", () => { careerSetup = "player"; render(); }); });
  app.querySelectorAll("[data-career-back]").forEach((button) => { button.addEventListener("click", () => { careerSetup = null; render(); }); });
  app.querySelectorAll("[data-career-mode]").forEach((button) => { button.addEventListener("click", () => {
    if (button.dataset.careerMode === "random") { careerSetupRandom = pickRandomCareerPlayer(); careerSetup = "club"; }
    else { careerSetup = "custom"; }
    render();
  }); });
  const careerNameInput = app.querySelector("[data-career-name]");
  if (careerNameInput) careerNameInput.addEventListener("input", () => { careerSetupCustom = careerSetupCustom || {}; careerSetupCustom.name = careerNameInput.value; });
  const careerNatInput = app.querySelector("[data-career-nationality]");
  if (careerNatInput) careerNatInput.addEventListener("change", () => { careerSetupCustom = careerSetupCustom || {}; careerSetupCustom.nationality = careerNatInput.value; });
  const careerPosInput = app.querySelector("[data-career-position]");
  if (careerPosInput) careerPosInput.addEventListener("change", () => { careerSetupCustom = careerSetupCustom || {}; careerSetupCustom.position = careerPosInput.value; });
  const careerSliders = ["[data-career-age]", "[data-career-ovr]", "[data-career-v1]", "[data-career-v2]"];
  const careerSliderLabels = { "[data-career-age]": "[data-career-age-label]", "[data-career-ovr]": "[data-career-ovr-label]", "[data-career-v1]": "[data-career-v1-label]", "[data-career-v2]": "[data-career-v2-label]" };
  careerSliders.forEach((sel) => {
    const input = app.querySelector(sel);
    if (!input) return;
    const label = app.querySelector(careerSliderLabels[sel]);
    input.addEventListener("input", () => {
      careerSetupCustom = careerSetupCustom || {};
      if (sel === "[data-career-age]") careerSetupCustom.age = Number(input.value);
      if (sel === "[data-career-ovr]") careerSetupCustom.ovr = Number(input.value);
      if (sel === "[data-career-v1]") careerSetupCustom.v1 = Number(input.value);
      if (sel === "[data-career-v2]") careerSetupCustom.v2 = Number(input.value);
      if (label) label.textContent = sel === "[data-career-age]" ? `${input.value} ${_("años", "years")}` : input.value;
      const budget = app.querySelector("[data-career-budget]");
      if (budget) {
        const ovr = Number(app.querySelector("[data-career-ovr]")?.value || 0);
        const v1 = Number(app.querySelector("[data-career-v1]")?.value || 0);
        const v2 = Number(app.querySelector("[data-career-v2]")?.value || 0);
        const remaining = 210 - ovr - v1 - v2;
        budget.textContent = `${_("Reparte 210 puntos entre OVR, Técnica y Física. Puntos restantes:", "Distribute 210 points among OVR, Technique and Fitness. Remaining points:")} ${remaining}.${remaining < 0 ? _(" Te pasas: baja algún atributo.", " You exceed: lower some attribute.") : ""}`;
        budget.style.color = remaining < 0 ? "#c0392b" : "";
      }
    });
  });
  app.querySelectorAll("[data-career-submit]").forEach((button) => { button.addEventListener("click", () => {
    const ovr = Number(app.querySelector("[data-career-ovr]")?.value || 70);
    const v1 = Number(app.querySelector("[data-career-v1]")?.value || 70);
    const v2 = Number(app.querySelector("[data-career-v2]")?.value || 70);
    if (ovr + v1 + v2 > 210) { pushFeed("No puedes repartir más de 210 puntos: baja OVR, Técnica o Física.", "You cannot distribute more than 210 points: lower OVR, Technique or Fitness."); saveAndRender(); return; }
    careerSetupCustom = {
      Name: (careerSetupCustom?.name || "").trim() || _("Jugador Anónimo", "Anonymous Player"),
      Nationality: careerSetupCustom?.nationality || (careerNationalities()[0] || "Inglaterra"),
      Position: careerSetupCustom?.position || "Chaser",
      Age: Number(careerSetupCustom?.age || 18),
      OVR: ovr,
      Value1: v1,
      Value2: v2,
    };
    careerSetup = "club";
    render();
  }); });
  app.querySelectorAll("[data-career-club]").forEach((button) => { button.addEventListener("click", () => startCareerAtClub(button.dataset.careerClub)); });
  app.querySelectorAll("[data-career-random-club]").forEach((button) => { button.addEventListener("click", () => { if (careerSetupRandom) startCareerAtClub(careerSetupRandom.TeamID); }); });
  app.querySelectorAll("[data-career-training]").forEach((button) => { button.addEventListener("click", () => doCareerTraining(button.dataset.careerTraining)); });
  app.querySelectorAll("[data-career-spend]").forEach((button) => { button.addEventListener("click", () => doCareerSpend(button.dataset.careerSpend)); });
  app.querySelector("[data-bet-submit]")?.addEventListener("click", () => {
    const select = app.querySelector("[data-bet-team]");
    const value = select?.value;
    if (!value) return;
    const separator = value.indexOf(":");
    placeCareerBet(value.slice(separator + 1), value.slice(0, separator));
  });
  app.querySelectorAll("[data-career-offer-sign]").forEach((button) => { button.addEventListener("click", () => { const offer = (state.career?.offers || []).find((o) => o.id === button.dataset.careerOfferSign); if (offer) careerSignOffer(offer); }); });
  app.querySelectorAll("[data-career-offer-reject]").forEach((button) => { button.addEventListener("click", () => { state.career.offers = (state.career.offers || []).filter((o) => o.id !== button.dataset.careerOfferReject); saveAndRender(); }); });
  app.querySelectorAll("[data-career-offer-team]").forEach((row) => { row.addEventListener("click", (event) => { if (event.target.closest("button, a, input, select, label")) return; selectedTeamId = row.dataset.careerOfferTeam; activeView = "team"; render(); }); });
  app.querySelectorAll("[data-career-close-match]").forEach((button) => { button.addEventListener("click", () => { if (state.career) state.career.lastMatch = null; state.lastResult = null; saveAndRender(); }); });
  app.querySelectorAll("[data-career-close-notice]").forEach((button) => { button.addEventListener("click", () => { if (state.career) state.career.notice = null; saveAndRender(); }); });
  app.querySelectorAll("[data-career-close-wc]").forEach((button) => { button.addEventListener("click", () => { if (state.career) { state.career.wcFinalModal = false; state.wcFinalModal = false; } saveAndRender(); }); });
}

document.addEventListener("click", (event) => {
  const onlineButton = event.target.closest("[data-online]");
  if (onlineButton) { onlineClick(onlineButton.dataset.online, onlineButton, event); return; }
  const advanceButton = event.target.closest("[data-advance]");
  if (!advanceButton) return;
  if (state.onlineAuto) return;
  if (state.status === "running") { stopAdvance(); saveAndRender(); } else { startAdvance(); }
});
document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-online-input]");
  if (input) onlineInput(input.dataset.onlineInput, input);
});

if (!globalThis.__qmHeadless) render();

globalThis.__qm = {
  get state() { return state; },
  set state(v) { state = v; },
  get UI_LANG() { return UI_LANG; },
  buildInitialState, migrateState, advanceDay, startAdvance, stopAdvance,
  simulateMatch, fixturesOn, teamById, playersFor, teamName, playerById,
  humanTeamIds, isHumanTeam, legalLineup, lineupIssue, defaultLineup,
  completeTransfer, buyPrice, money, rating, formatDate, addDays, daysBetween,
  clone, recalcStandings, computeStandings, teamPower, resetSeason,
  startCupPhase, leagueIsFinished, pushFeed,
  buyPlayer, sellPlayer, sellPlayerToLeague, shieldPlayer, renewContract,
  promoteStarter, demoteStarter, startNegotiation, startIntlNegotiation,
  submitNegotiation, acceptNegotiationCounter, withdrawNegotiation,
};

window.setInterval(() => { saveState(); }, 10000);
window.addEventListener("beforeunload", () => { saveState(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) saveState(); });

// ==================== MODO ONLINE ====================
// El servidor es autoritativo: simula la temporada solo (reloj virtual)
// y el cliente aplica snapshots + envía sus acciones (onlineEcho).
// (Las variables `online*` están declaradas arriba del todo por el TDZ.)
const ONLINE_SPEEDS = [30, 60, 120, 300, 600];

function onlineEcho(fn, args) {
  if (!onlineSocket || onlineSocket.readyState !== 1 || !state.onlineAuto) return;
  try { onlineSocket.send(JSON.stringify({ t: "action", action: { type: "call", fn, args } })); } catch { /* sin conexión: el snapshot manda */ }
}

function onlineErrorText(code) {
  const map = {
    EQUIPO_OCUPADO: [_("Ese equipo ya tiene mánager.", "That team already has a manager."), "That team already has a manager."],
    EQUIPO_INVALIDO: [_("Equipo no válido para esa sala.", "Invalid team for that room."), "Invalid team for that room."],
    SALA_NO_EXISTE: [_("La sala ya no existe.", "The room no longer exists."), "The room no longer exists."],
    SIN_EQUIPO: [_("No tienes equipo en esa sala.", "You have no team in that room."), "You have no team in that room."],
    SIN_SALA: [_("No estás en ninguna sala.", "You are in no room."), "You are in no room."],
    ACCION_DESCONOCIDA: [_("Acción no permitida online.", "Action not allowed online."), "Action not allowed online."],
    ARGS_INVALIDOS: [_("Parámetros no válidos.", "Invalid parameters."), "Invalid parameters."],
    LIGA_INVALIDA: [_("Liga no válida.", "Invalid league."), "Invalid league."],
  };
  const entry = map[code];
  if (!entry) return code;
  return entry[0];
}

function onlineStatusText() {
  if (onlineError && Date.now() - onlineErrorAt < 10000) return onlineError;
  const date = formatDate(state.currentDate, true);
  if (onlineSocket && onlineSocket.readyState === 1) return `${_("En vivo", "Live")} · ${onlineRoomName} · ${date}`;
  return `${_("Reconectando…", "Reconnecting…")} · ${date}`;
}

function onlineClick(kind, el) {
  if (kind === "open") { onlineLobby = true; selectedLeagueId = null; render(); }
  else if (kind === "back") { onlineLobby = false; render(); }
  else if (kind === "connect") { onlineConnect(false); }
  else if (kind === "disconnect") { try { if (onlineSocket) onlineSocket.close(); } catch { /* noop */ } onlineSocket = null; onlineRooms = []; render(); }
  else if (kind === "join") {
    const roomId = el.dataset.room;
    const teamId = onlineJoinTeam[roomId] || "";
    if (!onlineSocket || onlineSocket.readyState !== 1) { onlineError = _("Conéctate primero al servidor.", "Connect to the server first."); onlineErrorAt = Date.now(); render(); return; }
    if (!onlineNick.trim()) { onlineError = _("Escribe tu nombre de mánager.", "Type your manager name."); onlineErrorAt = Date.now(); render(); return; }
    if (!teamId) { onlineError = _("Elige un equipo libre.", "Pick a free team."); onlineErrorAt = Date.now(); render(); return; }
    onlineSocket.send(JSON.stringify({ t: "join", roomId, teamId, nick: onlineNick.trim().slice(0, 24) }));
  }
  else if (kind === "create") {
    if (!onlineSocket || onlineSocket.readyState !== 1) { onlineError = _("Conéctate primero al servidor.", "Connect to the server first."); onlineErrorAt = Date.now(); render(); return; }
    if (!onlineNick.trim()) { onlineError = _("Escribe tu nombre de mánager.", "Type your manager name."); onlineErrorAt = Date.now(); render(); return; }
    if (!onlineCreate.teamId) { onlineError = _("Elige tu equipo.", "Pick your team."); onlineErrorAt = Date.now(); render(); return; }
    onlineSocket.send(JSON.stringify({
      t: "create",
      name: (onlineCreate.name || "").trim().slice(0, 40) || `${onlineNick.trim().slice(0, 24)} · ${leagueById(onlineCreate.leagueId)?.name || ""}`,
      leagueId: onlineCreate.leagueId,
      dayMs: Number(onlineCreate.daySec) * 1000,
      teamId: onlineCreate.teamId,
      nick: onlineNick.trim().slice(0, 24),
    }));
  }
  else if (kind === "exit") { try { if (onlineSocket) onlineSocket.close(); } catch { /* noop */ } window.location.reload(); }
}

function onlineInput(name, input) {
  if (name === "url") onlineUrl = input.value;
  else if (name === "nick") onlineNick = input.value;
  else if (name === "cname") onlineCreate.name = input.value;
  else if (name === "cleague") { onlineCreate.leagueId = input.value; onlineCreate.teamId = ""; render(); }
  else if (name === "cteam") onlineCreate.teamId = input.value;
  else if (name === "cspeed") onlineCreate.daySec = Number(input.value);
  else if (name === "jteam") onlineJoinTeam[input.dataset.room] = input.value;
}

function onlineConnect(autoJoin) {
  try { if (onlineSocket) onlineSocket.close(); } catch { /* noop */ }
  onlineSocket = null;
  onlineReconnects = 0;
  let ws;
  try { ws = new WebSocket(onlineUrl); } catch {
    onlineError = _("No se pudo conectar a esa dirección.", "Could not connect to that address.");
    onlineErrorAt = Date.now();
    render();
    return;
  }
  onlineSocket = ws;
  render();
  ws.onopen = () => {
    render();
    if (autoJoin && onlineRoomId && onlineMyTeam) {
      try { ws.send(JSON.stringify({ t: "join", roomId: onlineRoomId, teamId: onlineMyTeam, nick: onlineNick })); } catch { /* noop */ }
    }
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.t === "rooms") { onlineRooms = msg.rooms || []; if (onlineLobby) render(); }
    else if (msg.t === "snapshot" && msg.state) {
      onlineError = "";
      onlineReconnects = 0;
      state = msg.state;
      onlineMyTeam = msg.myTeam;
      state.managerTeamId = onlineMyTeam;
      onlineRoomId = (msg.room && msg.room.id) || onlineRoomId;
      onlineRoomName = (msg.room && msg.room.name) || "";
      onlineLobby = false;
      activeView = "home";
      selectedTeamId = null;
      selectedPlayerId = null;
      marketTab = "buy";
      homeMode = "league";
      render();
    }
    else if (msg.t === "error" && msg.error) {
      onlineError = onlineErrorText(msg.error);
      onlineErrorAt = Date.now();
      render();
    }
  };
  ws.onclose = () => {
    if (onlineSocket !== ws) return;
    if (onlineRoomId && onlineMyTeam && onlineReconnects < 20 && !onlineLobby) {
      onlineReconnects += 1;
      render();
      setTimeout(() => {
        if (onlineRoomId && (!onlineSocket || onlineSocket.readyState > 1)) onlineConnect(true);
      }, 3000);
      return;
    }
    render();
  };
}

function renderOnlineWaiting() {
  return `
    <main class="screen">
      <section class="panel">
        <div class="title-row"><h2>${_("Mundial en curso", "World Cup in progress")}</h2><span class="pill">${formatDate(state.currentDate, true)}</span></div>
        <p class="muted">${_("Tu club descansa mientras se disputa el Mundial en el servidor. La liga volverá al terminar el torneo.", "Your club rests while the World Cup is played on the server. The league will resume when the tournament ends.")}</p>
        <div class="form-row">
          <button data-online="exit" class="danger">${_("Salir", "Leave")}</button>
        </div>
      </section>
      <section class="panel">
        <div class="title-row"><h2>${_("Noticias", "News")}</h2><span class="pill">${_("Mundo", "World")}</span></div>
        ${renderFeedPanel()}
      </section>
    </main>
  `;
}

function onlineRoomTeams(room) {
  const league = leagueById(room.leagueId);
  const preview = league ? leagueTeamsPreview(league) : [];
  const taken = new Set((room.managers || []).map((m) => m.teamId));
  return preview.map((team) => ({ ...team, taken: taken.has(team.TeamID) }));
}

function renderOnlineLobby() {
  const connected = onlineSocket && onlineSocket.readyState === 1;
  const createLeague = leagueById(onlineCreate.leagueId) || leagueById("BR");
  const createTeams = leagueTeamsPreview(createLeague);
  return `
    <main class="screen">
      <div class="title-row">
        <div>
          <h1>${_("Liga Online", "Online League")}</h1>
          <p class="muted">${_("El servidor simula la temporada solo, día y noche. Entra cuando quieras a ver cómo va y a gestionar tu equipo en vivo.", "The server simulates the season on its own, day and night. Join whenever you want to watch it unfold and manage your team live.")}</p>
        </div>
        <div class="title-side" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
          ${langSelector()}
          <button data-online="back">← ${_("Volver", "Back")}</button>
        </div>
      </div>
      ${onlineError ? `<div class="panel" style="border-color:#c0392b; margin-bottom:16px"><p style="color:#c0392b">${onlineError}</p></div>` : ""}
      <section class="panel">
        <div class="title-row"><h2>${_("Conexión", "Connection")}</h2><span class="pill">${connected ? _("Conectado", "Connected") : _("Desconectado", "Disconnected")}</span></div>
        <div class="form-row">
          <label>${_("Servidor", "Server")}: <input data-online-input="url" value="${onlineUrl.replace(/"/g, "&quot;")}" placeholder="ws://localhost:8787" style="min-width:240px" /></label>
          <label>${_("Mánager", "Manager")}: <input data-online-input="nick" value="${onlineNick.replace(/"/g, "&quot;")}" placeholder="${_("Tu nombre", "Your name")}" maxlength="24" /></label>
          ${connected
            ? `<button data-online="disconnect">${_("Desconectar", "Disconnect")}</button>`
            : `<button data-online="connect" class="primary">${_("Conectar", "Connect")}</button>`}
        </div>
      </section>
      ${connected ? `
      <section class="panel">
        <div class="title-row"><h2>${_("Crear sala", "Create room")}</h2><span class="pill">${_("Reloj configurable", "Configurable clock")}</span></div>
        <div class="form-row">
          <label>${_("Nombre", "Name")}: <input data-online-input="cname" value="${(onlineCreate.name || "").replace(/"/g, "&quot;")}" maxlength="40" /></label>
          <label>${_("Liga", "League")}: <select data-online-input="cleague">${LEAGUES.map((l) => `<option value="${l.id}" ${onlineCreate.leagueId === l.id ? "selected" : ""}>${l.name}</option>`).join("")}</select></label>
          <label>${_("Tu equipo", "Your team")}: <select data-online-input="cteam">
            <option value="">—</option>
            ${createTeams.map((t) => `<option value="${t.TeamID}" ${onlineCreate.teamId === t.TeamID ? "selected" : ""}>${t.Name} (OVR ${t.realOVR})</option>`).join("")}
          </select></label>
          <label>${_("Velocidad", "Speed")}: <select data-online-input="cspeed">${ONLINE_SPEEDS.map((s) => `<option value="${s}" ${Number(onlineCreate.daySec) === s ? "selected" : ""}>1 ${_("día", "day")} / ${s < 60 ? `${s} s` : `${s / 60} min`}</option>`).join("")}</select></label>
          <button data-online="create" class="primary">${_("Crear y entrar", "Create & join")}</button>
        </div>
      </section>
      <section class="panel">
        <div class="title-row"><h2>${_("Salas abiertas", "Open rooms")}</h2><span class="pill">${onlineRooms.length}</span></div>
        ${onlineRooms.length ? onlineRooms.map((room) => {
          const teams = onlineRoomTeams(room);
          const free = teams.filter((t) => !t.taken);
          const chosen = onlineJoinTeam[room.id] || "";
          return `
          <div class="panel" style="margin-bottom:12px">
            <div class="title-row"><h3>${room.name}</h3><span class="pill">${leagueById(room.leagueId)?.name || room.leagueId} · ${formatDate(room.date, true)} · 1 ${_("día", "day")} / ${(room.dayMs / 60000) < 1 ? `${Math.round(room.dayMs / 1000)} s` : `${room.dayMs / 60000} min`}</span></div>
            <p class="muted">${(room.managers || []).length ? room.managers.map((m) => `${m.name} (${teamName(m.teamId)})`).join(" · ") : _("Sala vacía: ¡sé el primero!", "Empty room: be the first!")}</p>
            <div class="form-row">
              <label>${_("Tu equipo", "Your team")}: <select data-online-input="jteam" data-room="${room.id}">
                <option value="">—</option>
                ${free.map((t) => `<option value="${t.TeamID}" ${chosen === t.TeamID ? "selected" : ""}>${t.Name} (OVR ${t.realOVR})</option>`).join("")}
              </select></label>
              <button data-online="join" data-room="${room.id}" class="primary">${_("Unirse", "Join")}</button>
            </div>
          </div>`;
        }).join("") : `<p class="muted">${_("No hay salas todavía. Crea la primera.", "No rooms yet. Create the first one.")}</p>`}
      </section>
      ` : ""}
    </main>
  `;
}

