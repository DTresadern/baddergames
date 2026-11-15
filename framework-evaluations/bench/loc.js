// @ts-check
// Lines of code per build: non-blank lines that are not only a comment.
// Counted: every .js file under each build's src/<mode>/ plus its <mode>.html page;
// shared/ is counted once, separately (all builds use it). bench/ is not a build.
// Comment rules: lines starting with // and lines inside /* ... */ blocks (JSDoc
// included) are comments; a code line with a trailing comment counts as code.
// GLSL inside template strings counts as code.
//
//   node bench/loc.js          prints a markdown table
//   import { countLoc } from './loc.js'   for report.js

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : jsFiles(p);
    return p.endsWith('.js') ? [p] : [];
  });
}

/** @param {string} text */
export function countLines(text) {
  let code = 0, comment = 0, blank = 0, inBlock = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (inBlock) {
      comment++;
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (!line) { blank++; continue; }
    if (line.startsWith('//') || line.startsWith('<!--')) { comment++; continue; }
    if (line.startsWith('/*')) {
      comment++;
      if (!line.includes('*/', 2)) inBlock = true;
      continue;
    }
    code++;
  }
  return { code, comment, blank };
}

// Framework packages whose API names are counted (a proxy for "framework concepts").
const FRAMEWORK_PKG = /^(three|pixi\.js|@pixi\/3d)(\/|$)/;

/**
 * Distinct framework API names a set of files uses: every name imported with
 * `import { A, B as C } from '<framework>'`, plus every `NS.Name` for a namespace
 * import `import * as NS from '<framework>'` (this includes `NS.Name` in JSDoc types, such as
 * `THREE.IUniform`). A proxy only: it counts names, not how hard each one is.
 * @param {string[]} files
 */
export function frameworkApi(files) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
      if (!FRAMEWORK_PKG.test(m[2])) continue;
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name) names.add(name);
      }
    }
    for (const m of text.matchAll(/import\s*\*\s*as\s+(\w+)\s+from\s*'([^']+)'/g)) {
      if (!FRAMEWORK_PKG.test(m[2])) continue;
      for (const u of text.matchAll(new RegExp(`\\b${m[1]}\\.(\\w+)`, 'g'))) names.add(u[1]);
    }
  }
  return [...names].sort();
}

/** @param {string[]} files */
function sum(files) {
  const total = { files: files.length, code: 0, comment: 0, blank: 0, apiNames: frameworkApi(files).length };
  for (const f of files) {
    const c = countLines(readFileSync(f, 'utf8'));
    total.code += c.code; total.comment += c.comment; total.blank += c.blank;
  }
  return total;
}

export function countLoc() {
  /** @type {Record<string, ReturnType<typeof sum>>} */
  const out = {};
  for (const fw of ['threejs', 'pixijs']) {
    for (const mode of ['2d', '3d']) {
      const files = jsFiles(join(ROOT, fw, 'src', mode));
      const page = join(ROOT, fw, `${mode}.html`);
      out[`${fw}-${mode}`] = sum(existsSync(page) ? [...files, page] : files);
    }
  }
  out.shared = sum(jsFiles(join(ROOT, 'shared')));
  out.bench = sum(jsFiles(join(ROOT, 'bench')));
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const loc = countLoc();
  console.log('| part | files | code lines | comment lines | blank lines | framework API names |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const [k, v] of Object.entries(loc)) console.log(`| ${k} | ${v.files} | ${v.code} | ${v.comment} | ${v.blank} | ${v.apiNames} |`);
}
