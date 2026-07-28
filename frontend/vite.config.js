import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  server: {
    port: 3344,
    proxy: {
      '/api': {
        target: 'http://localhost:5566',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
