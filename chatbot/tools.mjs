import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.gemini',
  '.system_generated',
  '.user_uploaded',
  'coverage',
  '.next',
  'dist',
  'build'
]);

/**
 * Read any file in full without line limits.
 * Optional startLine and endLine (1-indexed).
 */
export function readFileContent(filePath, startLine = null, endLine = null) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(ROOT_DIR, filePath);
  
  if (!fs.existsSync(fullPath)) {
    return { error: `File not found: ${filePath}` };
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return { error: `${filePath} is a directory, not a file.` };
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');
  const totalLines = lines.length;

  let s = startLine ? Math.max(1, parseInt(startLine, 10)) : 1;
  let e = endLine ? Math.min(totalLines, parseInt(endLine, 10)) : totalLines;

  if (s > e) s = 1;

  const slice = lines.slice(s - 1, e);
  const formatted = slice.map((line, idx) => `${s + idx}: ${line}`).join('\n');

  return {
    filePath: path.relative(ROOT_DIR, fullPath),
    totalLines,
    startLine: s,
    endLine: e,
    content: formatted,
    rawContent: slice.join('\n')
  };
}

/**
 * List files and directories within a directory.
 */
export function listDirectory(dirPath = '.') {
  const fullPath = path.isAbsolute(dirPath) ? dirPath : path.resolve(ROOT_DIR, dirPath);
  if (!fs.existsSync(fullPath)) {
    return { error: `Directory not found: ${dirPath}` };
  }

  const entries = fs.readdirSync(fullPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    result.push({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.relative(ROOT_DIR, path.join(fullPath, entry.name))
    });
  }

  // Sort directories first, then files
  result.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return { directory: path.relative(ROOT_DIR, fullPath) || '.', entries: result };
}

/**
 * Recursively get a file tree of the codebase.
 */
export function getTree(dir = ROOT_DIR, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let output = '';

  const filtered = entries.filter(e => !IGNORED_DIRS.has(e.name) && !e.name.startsWith('.'));
  filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  filtered.forEach((entry, idx) => {
    const isLast = idx === filtered.length - 1;
    const pointer = isLast ? '└── ' : '├── ';
    output += `${prefix}${pointer}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;

    if (entry.isDirectory()) {
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      output += getTree(path.join(dir, entry.name), nextPrefix);
    }
  });

  return output;
}

/**
 * Search across the entire codebase for matching query or regex pattern.
 */
export function searchCodebase(query, isRegex = false, maxMatches = 50) {
  try {
    const flag = isRegex ? '' : '-F';
    const cmd = `git grep -n -I ${flag} -e "${query.replace(/"/g, '\\"')}" -- . ":!node_modules" ":!.git"`;
    const stdout = execSync(cmd, { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    const matches = lines.slice(0, maxMatches).map(line => {
      const firstColon = line.indexOf(':');
      const secondColon = line.indexOf(':', firstColon + 1);
      if (firstColon === -1 || secondColon === -1) return { raw: line };
      return {
        file: line.slice(0, firstColon),
        line: parseInt(line.slice(firstColon + 1, secondColon), 10),
        snippet: line.slice(secondColon + 1).trim()
      };
    });
    return { query, totalFound: lines.length, shown: matches.length, matches };
  } catch (err) {
    // If git grep returns exit code 1 (no matches)
    return { query, totalFound: 0, matches: [] };
  }
}
