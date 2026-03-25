import { defineConfig } from 'vite'

export default defineConfig({
  // Sub-path when deployed to GitHub Pages at /NCICS-2026/ndvi-zarr-layer/
  // In dev this is overridden by the dev server serving from /
  base: process.env.NODE_ENV === 'production'
    ? '/NCICS-2026/'
    : '/',

  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  optimizeDeps: {
    include: ['maplibre-gl', '@carbonplan/zarr-layer', '@carbonplan/icechunk-js'],
  },
})
