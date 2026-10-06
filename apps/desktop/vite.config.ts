import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // One source for the version badge: package.json is already pinned to the release
  // declarations by check_release_version.py, so this can no longer drift from the shipped build.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    strictPort: true,
    port: 1420,
  },
})
