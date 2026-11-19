// Tile texture for the Sandbox: a subtle checkerboard drawn like 64 px pixel art, so aliasing and
// jitter show at every zoom level. Nearest filtering both ways and no mipmaps on purpose: shimmer
// and uneven pixel widths stay visible instead of being blurred away.

import { Color, DataTexture, NearestFilter, SRGBColorSpace } from 'three';

export const TILE_CHECKER = Object.freeze({
  square: 8, // checker square size, texture px
  shade: 0.09, // the lighter squares: the legend colour moved this far towards white (0..1)
});

// RGBA bytes of a `size` x `size` checkerboard: `color` (CSS colour) and its lighter shade.
// Row 0 is the bottom row (DataTexture order); the pattern is symmetric, so it does not matter.
export function checkerPixels(size, color, { square, shade } = TILE_CHECKER) {
  const hex = new Color(color).getHex(); // sRGB bytes (Color itself stores linear values)
  const [r, g, b] = [hex >> 16, (hex >> 8) & 255, hex & 255];
  const lighter = [r, g, b].map((c) => Math.round(c + (255 - c) * shade));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const light = (Math.floor(x / square) + Math.floor(y / square)) % 2 === 1;
      data.set(light ? [...lighter, 255] : [r, g, b, 255], (y * size + x) * 4);
    }
  }
  return data;
}

// One texture per tile type, `size` px square (the map's tileSize), mapped once per tile.
export function createTileTexture(size, color) {
  const texture = new DataTexture(checkerPixels(size, color), size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
