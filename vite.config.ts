import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(process.cwd(), 'ui'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(process.cwd(), 'dist/ui'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4377',
    },
  },
})
