// Every runtime asset, by key. See berserker7/AGENTS.md, Assets.

export const TYPES = Object.freeze(['texture', 'music', 'map']);
// 'menubg': the menu backgrounds. Nothing loads this group whole; start-up adds the picked one to the boot load.
// 'sandbox': the Sandbox test scene's content (maps).
export const GROUPS = Object.freeze(['boot', 'menubg', 'sandbox']);
export const COLOR_SPACES = Object.freeze(['srgb', 'raw']);

export const ASSETS = freezeList([
  { key: 'logo.baddergames', path: 'content/textures/logos/baddergames.png', type: 'texture', groups: ['boot'] },
  // Black text on white, no alpha: the intro shows it inverted, using the raw values as alpha.
  { key: 'logo.w8omg', path: 'content/textures/logos/w8omg.png', type: 'texture', groups: ['boot'], colorSpace: 'raw' },
  { key: 'music.title', path: 'content/audio/music/titlescreen-1.mp3', type: 'music', groups: ['boot'] },
  { key: 'poster.classic', path: 'content/textures/menubg/berserkerguy-classic-2-1.png', type: 'texture', groups: ['menubg'] },
  { key: 'poster.thrash', path: 'content/textures/menubg/berserkerguy-thrash-2-1.png', type: 'texture', groups: ['menubg'] },
  { key: 'map.walkway', path: 'content/maps/walkway.json', type: 'map', groups: ['sandbox'] },
]);

function freezeList(list) {
  return Object.freeze(list.map((entry) => Object.freeze({ ...entry, groups: Object.freeze([...entry.groups]) })));
}

function badPath(path) {
  if (typeof path !== 'string' || !path.startsWith('content/') || path.endsWith('/')) return true;
  if (path.includes('\\') || /\s/.test(path)) return true;
  return path.split('/').some((part) => part === '' || part === '.' || part === '..');
}

// Problems in a manifest list, as readable strings; empty when the list is valid.
export function checkManifest(list, groups = GROUPS) {
  const problems = [];
  const keys = new Set();
  const used = new Set();
  for (const entry of list) {
    const key = entry?.key;
    const name = typeof key === 'string' && key !== '' ? `'${key}'` : `entry ${list.indexOf(entry)}`;
    if (name.startsWith('entry')) problems.push(`${name}: missing key`);
    else if (keys.has(key)) problems.push(`${name}: duplicate key`);
    else keys.add(key);
    if (badPath(entry?.path)) problems.push(`${name}: bad path '${entry?.path}' (want content/..., relative, no '..')`);
    if (!TYPES.includes(entry?.type)) problems.push(`${name}: unknown type '${entry?.type}'`);
    if (entry?.colorSpace !== undefined) {
      if (entry.type !== 'texture') problems.push(`${name}: colorSpace is only for textures`);
      else if (!COLOR_SPACES.includes(entry.colorSpace)) problems.push(`${name}: unknown colorSpace '${entry.colorSpace}'`);
    }
    if (!Array.isArray(entry?.groups) || entry.groups.length === 0) {
      problems.push(`${name}: no groups`);
      continue;
    }
    for (const group of entry.groups) {
      if (groups.includes(group)) used.add(group);
      else problems.push(`${name}: unknown group '${group}'`);
    }
  }
  for (const group of groups) if (!used.has(group)) problems.push(`group '${group}' has no assets`);
  return problems;
}

const problems = checkManifest(ASSETS);
if (problems.length > 0) throw new Error(`asset manifest: ${problems.join('; ')}`);

const byKey = new Map(ASSETS.map((entry) => [entry.key, entry]));

export function assetByKey(key) {
  const entry = byKey.get(key);
  if (!entry) throw new Error(`asset manifest: unknown asset key '${key}'`);
  return entry;
}

export function groupAssets(group) {
  if (!GROUPS.includes(group)) throw new Error(`asset manifest: unknown group '${group}'`);
  return ASSETS.filter((entry) => entry.groups.includes(group));
}
