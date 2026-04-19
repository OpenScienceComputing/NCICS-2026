import { defineConfig } from 'vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// Inject coi-serviceworker as a plain (non-module) script without Vite bundling it
function coiServiceWorkerPlugin() {
  return {
    name: 'coi-serviceworker',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(
          '<head>',
          '<head>\n    <script src="coi-serviceworker.js"><\/script>'
        )
      },
    },
  }
}

export default defineConfig({
  plugins: [coiServiceWorkerPlugin(), wasm(), topLevelAwait()],

  base: process.env.NODE_ENV === 'production'
    ? '/NCICS-2026/icechunk-explorer/'
    : '/',

  build: {
    outDir: 'dist/icechunk-explorer',
    target: 'esnext',
  },

  server: {
    host: '0.0.0.0',
    port: 5174,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  optimizeDeps: {
    exclude: ['@earthmover/icechunk'],
    include: ['maplibre-gl', '@carbonplan/zarr-layer'],
  },
})
