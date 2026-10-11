import { defineConfig, loadEnv } from 'vite'
import pkg from './package.json' with { type: 'json' }
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Explicit opt-in build identity for testing only. A candidate build must supply
// the exact product-source commit. Published builds leave it unset: no fabricated
// build number or implied official GitHub Release.
export default defineConfig(({ mode }) => {
  const candidateSha = (loadEnv(mode, '.', 'MIRROR_').MIRROR_CANDIDATE_SOURCE_SHA || '').trim().toLowerCase()
  if (candidateSha && !/^[0-9a-f]{40}$/.test(candidateSha)) {
    throw new Error('MIRROR_CANDIDATE_SOURCE_SHA must be a complete 40-character Git commit SHA')
  }
  const candidateLabel = candidateSha ? `候选构建 ${candidateSha.slice(0, 12)}` : ''

  return {
    // Package version still comes only from the lock-checked package.json.
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
  }
})
