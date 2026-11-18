// The menu background (the "poster"), shared by the main menu and the New Game screen through the
// asset cache, so it is loaded once and stays loaded while any user holds it. One of POSTERS is
// picked once at start-up (main.js) and passed to both scenes.

import { assetByKey } from '../assets/manifest.js';

export const POSTERS = Object.freeze(['poster.classic', 'poster.thrash']);
// The short names `?menubg=` accepts.
const SHORT_NAMES = Object.freeze({ classic: 'poster.classic', thrash: 'poster.thrash' });

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
