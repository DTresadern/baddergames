import { defineConfig } from 'vite';

// Build info, computed once: the embedded values, the label and version.json all come from it.
// Null when GITHUB_SHA is unset (dev, local builds).
function buildInfo() {
  const sha = process.env.GITHUB_SHA;
  return sha ? { sha, builtAt: new Date().toISOString() } : null;
}

function buildLabel(info) {
  if (!info) return 'dev';
  const utc = info.builtAt.slice(0, 16).replace('T', ' ');
  return `${info.sha.slice(0, 7)} · ${utc} UTC`;
}

// Writes version.json next to index.html in a build with build info, for the menu's outdated check.
function versionFile(info) {
  return {
    name: 'b7-version-file',
    apply: 'build',
    generateBundle() {
      if (!info) return;
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(info) + '\n' });
    },
  };
}

const info = buildInfo();

export default defineConfig({
  base: './',
  plugins: [versionFile(info)],
  build: {
    chunkSizeWarningLimit: 600,
  },
  define: {
    __BUILD_LABEL__: JSON.stringify(buildLabel(info)),
    __BUILD_SHA__: JSON.stringify(info?.sha ?? null),
    __BUILD_AT__: JSON.stringify(info?.builtAt ?? null),
  },
});
