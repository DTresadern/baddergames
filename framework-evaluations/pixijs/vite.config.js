// @ts-check
// Multi-page build: each HTML file at this folder's root is one benchmarked build.
// base './' keeps asset URLs relative so dist/ can be served from any path.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = import.meta.dirname;

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // a manifest lets bench/run.js find exactly which JS chunks each page loads
    manifest: true,
    // three.js alone is ~550 kB minified; the warning adds nothing here
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      input: {
        '2d': resolve(root, '2d.html'),
        '3d': resolve(root, '3d.html'),
      },
    },
  },
});
