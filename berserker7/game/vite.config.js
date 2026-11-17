import { defineConfig } from 'vite';

// "<short sha> · <UTC time>" when built by CI (GITHUB_SHA set), "dev" otherwise.
function buildLabel() {
  const sha = process.env.GITHUB_SHA;
  if (!sha) return 'dev';
  const utc = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${sha.slice(0, 7)} · ${utc} UTC`;
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_LABEL__: JSON.stringify(buildLabel()),
  },
});
