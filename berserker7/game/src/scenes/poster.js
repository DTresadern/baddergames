// The menu background (the "poster"), shared by the main menu and the New Game screen through the
// asset cache, so it is loaded once and stays loaded while any user holds it. One of POSTERS is
// picked once at start-up (main.js) and passed to both scenes.

import { assetByKey, groupAssets } from '../assets/manifest.js';

// Every asset in manifest group 'menubg', in manifest order (poster.classic, poster.thrash).
export const POSTERS = Object.freeze(groupAssets('menubg').map((asset) => asset.key));
const POSTER_KEY = /^poster\.([a-z0-9-]+)$/;

// Short name -> key, the short name being the key without 'poster.'. Throws on a key that is not
// poster.<name> (lowercase letters, digits, '-').
export function shortNames(keys) {
  const bad = keys.filter((key) => !POSTER_KEY.test(key));
  if (bad.length > 0) throw new Error(`poster: menubg keys must look like poster.<name>: ${bad.join(', ')}`);
  return Object.freeze(Object.fromEntries(keys.map((key) => [POSTER_KEY.exec(key)[1], key])));
}

// The short names `?menubg=` accepts (classic, thrash); the import fails on a bad menubg key.
const SHORT_NAMES = shortNames(POSTERS);

// `?menubg=classic` or `?menubg=thrash` forces one; an unknown value warns once and is ignored;
// otherwise each poster has an equal chance.
export function pickPoster({ search = '', random = Math.random, log = console } = {}) {
  const params = new URLSearchParams(search);
  const wanted = params.get('menubg');
  if (wanted !== null) {
    if (Object.hasOwn(SHORT_NAMES, wanted)) return SHORT_NAMES[wanted];
    log.warn(`menubg '${wanted}' is not one of ${Object.keys(SHORT_NAMES).join(', ')}; picking at random`);
  }
  return POSTERS[Math.min(Math.floor(random() * POSTERS.length), POSTERS.length - 1)];
}

// A group lister for the loader: the boot group also holds the picked poster, other groups are unchanged.
export function withPoster(listGroup, posterKey) {
  checkPoster(posterKey);
  return (group) => (group === 'boot' ? [...listGroup('boot'), assetByKey(posterKey)] : listGroup(group));
}

// Throws unless `key` is one of POSTERS (the scenes call this on their `poster` parameter).
export function checkPoster(key) {
  if (!POSTERS.includes(key)) throw new Error(`poster: unknown poster '${key}' (want one of ${POSTERS.join(', ')})`);
}

// Size of the image scaled to cover the view, drawn centred (the crop is equal on both sides).
export function coverSize(viewWidth, viewHeight, imageWidth, imageHeight) {
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}
