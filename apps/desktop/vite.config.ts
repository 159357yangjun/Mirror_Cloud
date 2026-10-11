import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Explicit opt-in build identity for testing only. A candidate build must supply
// the exact product-source commit. Published builds leave it unset: no fabricated
// build number or implied official GitHub Release.
const candidateSha = (process.env.MIRROR_CANDIDATE_SOURCE_SHA || '').trim().toLowerCase()
if (candidateSha && !/^[0-9a-f]{40}$/.test(candidateSha)) {
  throw new Error('MIRROR_CANDIDATE_SOURCE_SHA must be a complete 40-character Git commit SHA')
}
const candidateLabel = candidateSha ? `候选构建 ${candidateSha.slice(0, 12)}` : ''

export default defineConfig({
  // One source for the version badge: package.json is already pinned to the release
  // declarations by check_release_version.py, so this can no longer drift from the shipped build.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_CANDIDATE_LABEL__: JSON.stringify(candidateLabel),
  },
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    strictPort: true,
    port: 1420,
  },
})
