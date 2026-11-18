// Text labels for the menu screens: drawn once into an off-screen canvas (never added to the page).

import { CanvasTexture, SRGBColorSpace } from 'three';

const FONT = (size) => `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const TEXT_SCALE = 2; // label canvases are drawn at 2x so they stay sharp
const LINE_SPACING = 1.25;
const LATER_LINE = 0.6; // lines after the first are this fraction of the first line's size

// Centred text lines on a transparent `width` x `height` (CSS px) canvas; returns an sRGB
// CanvasTexture. The caller tracks it.
export function labelTexture(createCanvas, lines, width, height, fontSize = 28) {
  const list = Array.isArray(lines) ? lines : [lines];
  const canvas = createCanvas();
  canvas.width = width * TEXT_SCALE;
  canvas.height = height * TEXT_SCALE;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const sizes = list.map((_, i) => fontSize * TEXT_SCALE * (i === 0 ? 1 : LATER_LINE));
  const total = sizes.reduce((sum, size) => sum + size * LINE_SPACING, 0);
  let y = (canvas.height - total) / 2;
  list.forEach((line, i) => {
    const step = sizes[i] * LINE_SPACING;
    g.font = FONT(sizes[i]);
    g.fillText(line, canvas.width / 2, y + step / 2);
    y += step;
  });
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return map;
}
