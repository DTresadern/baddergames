// Pixelation for the Sandbox (#131, debug, off by default, not saved). Not a post-process: no
// extra pass, render target or shader. While the Sandbox is the active main scene, main.js draws
// it into a smaller drawing buffer (the renderer's pixel ratio divided by 2 or 4; the canvas keeps
// its CSS size) and the browser scales the canvas up to that CSS size with nearest filtering
// (`image-rendering: pixelated`), so each buffer pixel is a hard 2 x 2 or 4 x 4 block on screen.
//
// Everything that measures screen pixels in buffer pixels (pixel snap, pixel scale, the LUT and
// dither, which run per drawn pixel) then works on the smaller buffer unchanged; the mouse and the
// aim origin are in CSS pixels, which do not change.
//
// Rounding: three.js makes the buffer floor(css size x ratio). When the device size is not a
// multiple of the factor, the buffer is up to (factor - 1) device pixels short, and the browser
// stretches it over the full canvas, so up to factor - 1 columns (rows) are one device pixel wider.

export const PIXELATION_MODES = Object.freeze(['off', 'half', 'quarter']);
export const PIXELATION_DEFAULT = 'off';
const FACTORS = Object.freeze({ off: 1, half: 2, quarter: 4 });

// Screen pixels per buffer pixel along each axis for `mode`; 1 for off or an unknown mode.
export function pixelationFactor(mode) {
  return Object.hasOwn(FACTORS, mode) ? FACTORS[mode] : 1;
}

// Keeps the renderer's pixel ratio at `baseRatio / factor` and the canvas's CSS `image-rendering` at
// `pixelated` (factor > 1) or the default (factor 1). The renderer starts at `baseRatio`, factor 1;
// nothing changes until the factor does (setPixelRatio resizes the drawing buffer).
export function createPixelation({ renderer, baseRatio, canvas = renderer.domElement }) {
  let current = 1;
  return {
    apply(factor) {
      if (factor === current) return;
      renderer.setPixelRatio(baseRatio / factor);
      canvas.style.imageRendering = factor > 1 ? 'pixelated' : '';
      current = factor;
    },
    factor: () => current,
  };
}
