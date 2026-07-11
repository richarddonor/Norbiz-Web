import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  // react-rnd's bundled react-draggable references the Node-only `process` global
  // in a debug-logging guard (`process.env.DRAGGABLE_DEBUG`) — Vite doesn't polyfill
  // this in the browser, causing an uncaught ReferenceError the moment a Draggable
  // element mounts. Shim it to an empty object so the guard resolves to falsy.
  define: {
    'process.env': {},
  },
})
