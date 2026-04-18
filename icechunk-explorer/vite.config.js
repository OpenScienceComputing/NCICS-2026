import { defineConfig } from 'vite'

export default defineConfig({
  base: process.env.NODE_ENV === 'production'
    ? '/NCICS-2026/icechunk-explorer/'
    : '/',

  build: {
    outDir: 'dist/icechunk-explorer',
  },

  server: {
    host: '0.0.0.0',
    port: 5174,
  },
  optimizeDeps: {
    include: ['maplibre-gl', '@carbonplan/zarr-layer', '@carbonplan/icechunk-js'],
  },
})
