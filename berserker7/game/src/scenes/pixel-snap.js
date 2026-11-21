// Pixel snap and pixel scale for the Sandbox camera (#129, debug, off by default). Camera only: no
// shader, texture or draw call change.
//
// Screen pixels are drawing-buffer (device) pixels. Both act on one plane, the snap plane: in 2D the
// play plane (z = 0, the whole view); in 2.5D the front faces of the local player's row (its drawn
// depth + FRONT_FACE), so other depths still shimmer.
//
// - Pixel snap: the camera's x and y are rounded so that world 0 on the snap plane falls on a
//   screen pixel edge. Every texture pixel on that plane then keeps the same sub-pixel phase from
//   frame to frame (the picture moves by whole screen pixels), whatever the scale, also below one
//   screen pixel per texture pixel.
// - Pixel scale: the view height is chosen so that one texture pixel on the snap plane covers k
//   screen pixels (k whole), instead of the zoom slider's value.

// Pixel scale choices: off, auto (the k whose view height is nearest the zoom slider's, within
// the zoom range) or a fixed k.
export const PIXEL_SCALE_MODES = Object.freeze(['off', 'auto', '1', '2', '3', '4']);
export const PIXEL_SCALE_DEFAULT = 'off';
// 2.5D cubes are 1 tile deep, centred on their row's depth: the front face is half a tile nearer.
export const FRONT_FACE = 0.5;

// The drawing buffer's viewport size in device pixels: three.js renders to the default framebuffer
// with the viewport floor(css size x pixel ratio). A renderer without getPixelRatio (tests) counts
// as ratio 1.
export function bufferSize(view) {
  const ratio = view.renderer?.getPixelRatio?.() ?? 1;
  return { width: Math.floor(view.width * ratio), height: Math.floor(view.height * ratio) };
}

// View height in tiles at the snap plane for k screen pixels per texture pixel.
export function scaleTiles(bufferHeight, texelsPerTile, k) {
  return bufferHeight / (texelsPerTile * k);
}

// The k for `mode` (PIXEL_SCALE_MODES), or 0 when off. Auto: among k = 1, 2, ... whose view height
// lies within [min, max] tiles, the one nearest `zoomTiles` (the larger k on a tie); 1 when none fits.
export function pixelScaleFor(mode, bufferHeight, texelsPerTile, zoomTiles, min, max) {
  if (mode === 'off' || !PIXEL_SCALE_MODES.includes(mode)) return 0;
  if (mode !== 'auto') return Number(mode);
  let best = 1;
  let bestGap = Infinity;
  for (let k = 1; scaleTiles(bufferHeight, texelsPerTile, k) >= min; k++) {
    const tiles = scaleTiles(bufferHeight, texelsPerTile, k);
    if (tiles > max) continue;
    const gap = Math.abs(tiles - zoomTiles);
    if (gap <= bestGap) [best, bestGap] = [k, gap];
  }
  return best;
}

// Rounds one camera coordinate (tiles) so that world coordinate 0 lands on a pixel edge: screen
// position = size / 2 ± (world - camera) x pxPerTile, so camera x pxPerTile - size / 2 must be
// whole. Every other point then has a sub-pixel phase that depends only on pxPerTile, the same in
// every frame; with whole pixels per texture pixel (pixel scale) every texture pixel edge is on a
// pixel edge. `size` is the buffer's width (x) or height (y) in pixels.
export function snapAxis(camera, pxPerTile, size) {
  const half = size / 2;
  return (Math.round(camera * pxPerTile - half) + half) / pxPerTile;
}
