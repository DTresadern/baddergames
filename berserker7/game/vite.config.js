import { defineConfig } from 'vite';

function buildLabel() {
  const sha = process.env.GITHUB_SHA;
  if (!sha) return 'dev';
  const utc = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${sha.slice(0, 7)} · ${utc} UTC`;
}

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 600,
  },
  define: {
    __BUILD_LABEL__: JSON.stringify(buildLabel()),
  },
});
