// A flattened LUT strip (N*N wide, N tall, e.g. 1024x32) as 3D texture data. Pure (no three.js, no
// browser), so Node tests cover it; assets/luts.js makes the texture and loads the file.
// Ported from the scene palette work (its three.js strip LUT module), split into this pure part and
// the three.js / browser part.
//
// Strip layout: N tiles of NxN side by side. Tile index = blue, x inside a tile = red, y = green.
// greenUp true (default): green 0 is on the BOTTOM row of the image (Unity style; the shared
// palette strip); false: green 0 is on the TOP row.

// `pixels`: RGBA bytes, row-major, top row first (what getImageData returns); width = height².
// Returns the N³ RGBA Uint8Array of a 3D texture N wide, high and deep: entry (r, g, b) at
// ((b * N + g) * N + r) * 4, alpha 255. Throws on a strip of the wrong size.
export function stripToLutData(pixels, width, height, { greenUp = true } = {}) {
  const n = height;
  if (!Number.isInteger(n) || n < 1 || width !== n * n) throw new Error(`LUT strip must be N*N x N, got ${width}x${height}`);
  if (pixels.length !== width * height * 4) throw new Error(`LUT strip pixels must be RGBA, ${width * height * 4} bytes, got ${pixels.length}`);
  const data = new Uint8Array(n * n * n * 4);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      const row = greenUp ? n - 1 - g : g;
      for (let r = 0; r < n; r++) {
        const src = (row * width + b * n + r) * 4;
        const dst = ((b * n + g) * n + r) * 4;
        data[dst] = pixels[src];
        data[dst + 1] = pixels[src + 1];
        data[dst + 2] = pixels[src + 2];
        data[dst + 3] = 255;
      }
    }
  }
  return data;
}
