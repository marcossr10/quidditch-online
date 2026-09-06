const fs = require('fs');
const code = fs.readFileSync('src/app.js', 'utf8');
const lines = code.split('\n');
let depth = 0;        // backtick template depth
let brace = 0;        // brace depth inside ${ }
let i = 0;
let report = [];
for (let ln = 0; ln < lines.length; ln++) {
  const line = lines[ln];
  for (let c = 0; c < line.length; c++) {
    const ch = line[c];
    if (ch === '\\') { c++; continue; } // skip escaped char
    if (ch === '`') {
      if (depth === 0) { depth = 1; brace = 0; }
      else if (brace > 0) { /* backtick inside ${ } nested template */ depth++; }
      else { depth = 0; }
      continue;
    }
    if (depth > 0) {
      if (ch === '$' && line[c + 1] === '{') { brace++; c++; continue; }
      if (ch === '{' && brace > 0) { brace++; continue; }
      if (ch === '}' && brace > 0) { brace--; continue; }
    }
  }
  if (depth > 0 && brace > 0) {
    report.push(`line ${ln + 1}: template open with unclosed \${ (brace=${brace}) -> ${line.trim().slice(0,80)}`);
  }
}
console.log(report.slice(0, 20).join('\n') || 'no obvious unclosed ${ found by simple scan');
