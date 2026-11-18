// The title poster, shared by the main menu and the New Game screen through the asset cache
// (manifest key POSTER), so it is loaded once and stays loaded while any user holds it.

export const POSTER = 'poster.classic';

// Size of the image scaled to cover the view, drawn centred (the crop is equal on both sides).
export function coverSize(viewWidth, viewHeight, imageWidth, imageHeight) {
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}
