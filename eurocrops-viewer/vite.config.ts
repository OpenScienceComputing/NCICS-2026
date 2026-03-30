import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production'
    ? '/NCICS-2026/eurocrops-viewer/'
    : '/',
  build: {
    outDir: 'dist/eurocrops-viewer',
  },
})
