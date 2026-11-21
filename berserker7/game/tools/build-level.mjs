// Builds the moge3-cyberpunk-blocks test level: the generated blockout plus the authored sections.
//
// Reads tools/moge3-cyberpunk-blocks.base.json (written by `moge_blockout.py --mode blocks`, kept
// byte for byte), adds the cells, platforms, spawns and transfer zones of
// tools/levels/moge3-cyberpunk-blocks.sections.mjs (cells deduplicated; a base cell is never
// removed) and writes public/content/maps/moge3-cyberpunk-blocks.json in the same layout as
// moge_blockout.py (one line per top-level field, one line per cell; cells sorted by z, then y,
// then x). The base's own
// top-level lines are copied as they are (so its numbers keep Python's spelling, 995.0), except
// `source`, which gains a `sections` note, and `spawns`, which gains the sections' spawns. The
// sections' `ATLAS` (the block atlas the level is drawn with) is written as `atlas`, directly after
// `tile`.
//
// Usage (from berserker7/game/): npm run build:level  (or: node tools/build-level.mjs [--check])
// --check writes nothing and exits 1 when the committed map differs from the build output.
// No dependencies beyond Node.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATLAS, PLATFORMS, SECTIONS, TRANSFERS } from './levels/moge3-cyberpunk-blocks.sections.mjs';

const BASE = new URL('./moge3-cyberpunk-blocks.base.json', import.meta.url);
const OUT = new URL('../public/content/maps/moge3-cyberpunk-blocks.json', import.meta.url);
const SECTIONS_FILE = 'tools/levels/moge3-cyberpunk-blocks.sections.mjs';

// The map object: the base's fields in order with `atlas` after `tile`, then platforms and
// transfers; spawns and cells extended.
export function buildLevel(base = JSON.parse(readFileSync(BASE, 'utf8')), sections = SECTIONS, platforms = PLATFORMS, transfers = TRANSFERS, atlas = ATLAS) {
  if (base.kind !== 'cells' || !Array.isArray(base.cells)) throw new Error('build-level: the base is not a cells map');
  const key = ([x, y, z]) => `${x},${y},${z}`;
  const seen = new Set(base.cells.map(key));
  const cells = base.cells.map((c) => [...c]);
  const spawns = base.spawns.map((s) => ({ ...s }));
  for (const section of sections) {
    for (const cell of section.cells) {
      if (!cell.every(Number.isInteger)) throw new Error(`build-level: ${section.name}: cell ${JSON.stringify(cell)} is not whole tiles`);
      if (seen.has(key(cell))) continue;
      seen.add(key(cell));
      cells.push([...cell]);
    }
    spawns.push(...section.spawns.map((s) => ({ ...s })));
  }
  cells.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  const out = {};
  for (const [name, value] of Object.entries(base)) {
    if (name === 'cells') continue;
    out[name] = value;
    if (name === 'tile') out.atlas = atlas;
  }
  out.source = { ...base.source, sections: SECTIONS_FILE };
  out.spawns = spawns;
  out.platforms = platforms.map((p) => ({ ...p, path: p.path.map((pt) => [...pt]) }));
  out.transfers = transfers.map((t) => ({ ...t }));
  out.cells = cells;
  return out;
}

// JSON with Python's json.dumps spacing (", " and ": ").
const dump = (value) => JSON.stringify(value).replace(/("(?:[^"\\]|\\.)*")|([,:])/g, (m, str, sep) => str ?? `${sep} `);

// The base file's top-level lines by field name: `  "name": value,` (moge_blockout.py's layout).
function baseLines(text) {
  const lines = new Map();
  for (const line of text.split('\n')) {
    const m = /^  "([^"]+)": (.*),$/.exec(line);
    if (m && m[1] !== 'cells') lines.set(m[1], m[2]);
  }
  return lines;
}

// The file text, as moge_blockout.py writes it. Fields equal to the base's keep the base's text;
// `source` is the base's text with the new fields appended.
export function mapText(map, baseText = readFileSync(BASE, 'utf8')) {
  const base = JSON.parse(baseText);
  const raw = baseLines(baseText);
  const text = (name, value) => {
    if (raw.has(name) && JSON.stringify(base[name]) === JSON.stringify(value)) return raw.get(name);
    if (name === 'source' && raw.has(name)) {
      const extra = Object.entries(value).filter(([k]) => !(k in base.source));
      return raw.get(name).replace(/}$/, extra.map(([k, v]) => `, ${JSON.stringify(k)}: ${dump(v)}`).join('') + '}');
    }
    return dump(value);
  };
  const lines = ['{'];
  for (const [name, value] of Object.entries(map)) {
    if (name !== 'cells') lines.push(`  ${JSON.stringify(name)}: ${text(name, value)},`);
  }
  lines.push('  "cells": [');
  lines.push(map.cells.map((c) => `    ${JSON.stringify(c)}`).join(',\n'));
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = mapText(buildLevel());
  if (process.argv.includes('--check')) {
    const same = readFileSync(OUT, 'utf8') === text;
    console.log(same ? 'build-level: the committed map matches the build output' : 'build-level: the committed map differs; run npm run build:level');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text);
  const map = JSON.parse(text);
  const baseCells = JSON.parse(readFileSync(BASE, 'utf8')).cells.length;
  console.log(`build-level: wrote public/content/maps/moge3-cyberpunk-blocks.json: ${map.cells.length} cells (${baseCells} from the base), ${map.spawns.length} spawns, ${map.platforms.length} platforms, ${map.transfers.length} transfers`);
}
