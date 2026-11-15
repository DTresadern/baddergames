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

/** @param {string[]} files */
function sum(files) {
  const total = { files: files.length, code: 0, comment: 0, blank: 0 };
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
  console.log('| part | files | code lines | comment lines | blank lines |');
  console.log('|---|---:|---:|---:|---:|');
  for (const [k, v] of Object.entries(loc)) console.log(`| ${k} | ${v.files} | ${v.code} | ${v.comment} | ${v.blank} |`);
}
