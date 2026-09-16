import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_TARGET = process.env.ALBUMED_API ?? 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    // Keeps the output free of inline <script>, so the server can send a strict CSP.
    modulePreload: { polyfill: false },
  },
  server: {
    // `npm run dev` runs Vite for the client and proxies the assistant to the API server.
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: {
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
})
