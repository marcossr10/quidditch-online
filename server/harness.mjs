// Harness headless: carga el código REAL del juego (src/app.js) en Node.
// El servidor reutiliza el 100% de la lógica de simulación del cliente,
// sin duplicar ni una línea: mismo motor, mismos resultados.
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

globalThis.__qmHeadless = true;

// ---- localStorage en memoria (saveState está desactivado en headless,
// ---- pero otras rutas lo tocan: chooseTeam, etc.)
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
};

// ---- DOM mínimo: solo para que el módulo evalúe sin romperse.
// ---- render() está desactivado en headless, así que casi no se usa.
function stubEl() {
  return {
    innerHTML: "", textContent: "", value: "", checked: false, files: null,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, removeChild() {},
    click() {}, focus() {}, blur() {},
    setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => stubEl(),
  body: stubEl(),
  hidden: true,
  addEventListener() {},
  removeEventListener() {},
};

// ---- window: temporizadores reales de Node + eventos no-op.
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.window = globalThis;

const here = dirname(fileURLToPath(import.meta.url));
const appPath = join(here, "..", "src", "app.js");
await import(pathToFileURL(appPath).href);

if (!globalThis.__qm) throw new Error("app.js no expuso globalThis.__qm (¿hooks online presentes?)");

const leaguesPath = join(here, "..", "src", "leagues.js");
const { LEAGUES, leagueById } = await import(pathToFileURL(leaguesPath).href);

export const qm = globalThis.__qm;
export { LEAGUES, leagueById };
export const START_YEAR = 2025;
