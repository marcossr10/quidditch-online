// Crea un bundle de un solo archivo (index.html) para subir a itch.io.
// Concatena todos los módulos en orden de dependencia, elimina import/export
// y embebe el CSS inline. Resultado: un único archivo autocontenido.
// Incluye validación de sintaxis del JS resultante antes de escribir el HTML.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import vm from "vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = here;
const outDir = join(root, "build", "bundle");
mkdirSync(outDir, { recursive: true });

const order = [
  "src/database.js",                 // DATABASE
  ...["Balkan","Benelux","Brazilian","Central_European","French","German_Austrian","Iberian","Irish","Italian","Nordic","North_American","Pacific"].map((n) => `src/data/${n}.js`),
  "src/data/Youth.js",               // YOUTH (usado por app.js)
  "src/leagues.js",                  // LEAGUES, leagueById
  "src/worldcup.js",                 // WORLD_CUP
  "src/app.js",                      // juego
];

const stripImports = (code) =>
  code
    .replace(/^import\s+[^;]+;\s*$/gm, "")      // imports de una línea
    .replace(/^export\s+/gm, "")                 // prefijo 'export '
    .replace(/^export\s*\{[\s\S]*?\};\s*$/gm, ""); // bloques 'export { ... };'

let js = "";
for (const rel of order) {
  let code = readFileSync(join(root, rel), "utf8");
  code = stripImports(code);
  const leftovers = code.match(/^\s*(import|export)\s/mg);
  if (leftovers) {
    console.error(`ADVERTENCIA: quedan declaraciones import/export sin procesar en ${rel}:`);
    leftovers.forEach((l) => console.error("  ", l.trim()));
  }
  js += "/* ===== " + rel + " ===== */\n" + code + "\n";
}

// Validación de sintaxis: un error aquí petaría todo el juego en el navegador.
try {
  new vm.Script(js, { filename: "bundle.js" });
  console.log("Sintaxis del bundle OK.");
} catch (syntaxError) {
  console.error("ERROR DE SINTAXIS en el bundle:", syntaxError.message);
  console.error("Revisa los módulos antes de generar el HTML.");
  process.exit(1);
}

const css = readFileSync(join(root, "src/styles.css"), "utf8");

const html = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Quidditch Master</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module">
${js}
    <\/script>
  </body>
</html>
`;

const outFile = join(outDir, "index.html");
writeFileSync(outFile, html);
console.log(`Bundle generado: ${outFile} (${(html.length / 1048576).toFixed(2)} MB)`);