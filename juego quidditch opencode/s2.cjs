const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('src/app.js', 'utf8');
const stripped = code
  .replace(/^import\s+[^;]+;\s*$/gm, '')
  .replace(/^export\s+/gm, '')
  .replace(/^export\s*\{[\s\S]*?\};\s*$/gm, '');
const removed = (code.match(/^import\s+[^;]+;\s*$/gm) || []).length;
console.log('import lines removed:', removed);
fs.writeFileSync('C:/Users/Marcos/AppData/Local/Temp/opencode/s2.cjs', stripped);
const lines = stripped.split('\n');
let lo = 1, hi = lines.length;
function ok(n) {
  try { new vm.Script(lines.slice(0, n).join('\n')); return true; } catch (e) { return false; }
}
while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (ok(mid)) lo = mid; else hi = mid; }
console.log('first failing prefix ends at line', hi);
for (let i = Math.max(1, hi - 6); i <= Math.min(lines.length, hi + 1); i++) {
  console.log((i === hi ? '>>> ' : '    ') + i + ': ' + lines[i - 1]);
}
