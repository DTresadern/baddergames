// The title poster, shared by the main menu and the New Game screen through the asset cache,
// so it is loaded once and freed when the last of them unloads.

import { SRGBColorSpace, TextureLoader } from 'three';

// Relative path (no leading slash) so it works under any base path.
export const POSTER_URL = 'content/textures/posters/berserkerguy-classic.png';
export const POSTER_KEY = 'poster:berserkerguy-classic';

export const defaultLoadTexture = (url) => new TextureLoader().loadAsync(url);

// Size of the image scaled to cover the view, drawn centred (the crop is equal on both sides).
export function coverSize(viewWidth, viewHeight, imageWidth, imageHeight) {
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}

// Promise of the poster texture. The scene must not `track` it: the harness releases the
// cache entry when the scene unloads, and the last release disposes the texture.
export function acquirePoster(acquire, loadTexture = defaultLoadTexture) {
  return acquire(POSTER_KEY, () => {
    const ready = loadTexture(POSTER_URL).then((texture) => {
      texture.colorSpace = SRGBColorSpace;
      return texture;
    });
    return { ready, dispose: () => ready.then((texture) => texture.dispose(), () => {}) };
  }).ready;
}
