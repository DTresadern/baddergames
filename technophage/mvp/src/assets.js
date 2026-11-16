// Loads assets/manifest.json and its images. Builds white silhouettes for hit flashes.

export const assets = { sprites: {}, white: {}, bg: {}, manifest: null, anims: {}, points: {} };

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
}

function silhouette(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

export async function loadAssets(onProgress) {
  const res = await fetch('assets/manifest.json');
  const m = await res.json();
  assets.manifest = m;
  const jobs = [];
  for (const [k, v] of Object.entries(m.sprites)) jobs.push(['s', k, v.src]);
  for (const [k, v] of Object.entries(m.bg)) jobs.push(['b', k, v.src]);
  // Art production pass (tools/build-production-art.py); optional
  try {
    const pp = await (await fetch('assets/pp/production.json')).json();
    for (const [k, v] of Object.entries(pp.sprites)) jobs.push(['s', k, v.src]);
    for (const [k, v] of Object.entries(pp.bg)) jobs.push(['b', k, v.src]);
    assets.anims = pp.anims || {};
    assets.points = pp.points || {};
  } catch {
    /* not built: placeholder art only */
  }
  let done = 0;
  await Promise.all(
    jobs.map(async ([kind, key, src]) => {
      const img = await loadImage(src);
      if (kind === 's') {
        assets.sprites[key] = img;
        assets.white[key] = silhouette(img, '#ffffff');
      } else assets.bg[key] = img;
      done++;
      if (onProgress) onProgress(done / jobs.length);
    }),
  );
  return assets;
}
