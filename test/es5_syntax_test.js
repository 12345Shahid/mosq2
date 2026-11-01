const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/display.js');
const code = fs.readFileSync(filePath, 'utf8');

// Check if acorn is available
let acorn;
try {
  acorn = require('acorn');
} catch (e) {
  // Acorn not directly installed, check node_modules or try espree
}

if (acorn) {
  try {
    acorn.parse(code, { ecmaVersion: 5 });
    console.log(' Acorn strict ES5 parse: SUCCESS! Zero ES6+ features in public/display.js');
  } catch (err) {
    console.error(' Acorn strict ES5 parse failed:', err.message, 'at line', err.loc ? err.loc.line : '');
    process.exit(1);
  }
} else {
  console.log('Acorn not in dependencies, running regex AST token scan...');
}

const forbidden = [
  { name: 'const declaration', regex: /\bconst\s+/ },
  { name: 'let declaration', regex: /\blet\s+/ },
  { name: 'arrow function', regex: /=>/ },
  { name: 'template literal backtick', regex: /[`]/ },
  { name: 'async keyword', regex: /\basync\s+(function|\()/ },
  { name: 'await keyword', regex: /\bawait\s+/ },
  { name: 'class declaration', regex: /\bclass\s+[A-Za-z]/ },
  { name: 'for..of loop', regex: /\bfor\s*\([^)]+\bof\b/ },
  { name: 'spread/rest operator', regex: /\.\.\.[a-zA-Z]/ },
  { name: 'new Set', regex: /\bnew\s+Set\b/ },
  { name: 'new Map', regex: /\bnew\s+Map\b/ },
  { name: 'Array.prototype.includes', regex: /\.includes\(/ },
  { name: 'Array.prototype.find', regex: /\.find\(/ },
  { name: 'Object.values', regex: /Object\.values\(/ },
  { name: 'String.prototype.startsWith', regex: /\.startsWith\(/ }
];

let failed = false;
const lines = code.split('\n');
for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
  const line = lines[lineNum - 1];
  // skip comments
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

  for (const item of forbidden) {
    if (item.regex.test(line)) {
      console.error(` ES5 violation: ${item.name} at line ${lineNum}: "${trimmed}"`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log(' Regex scan PASSED: Zero forbidden ES6+ idioms found in public/display.js');
}
