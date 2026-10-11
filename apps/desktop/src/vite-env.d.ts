/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DOCS_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Injected by vite.config.ts from package.json (single source: check_release_version pins it).
declare const __APP_VERSION__: string
// Only present when a CI candidate package explicitly opts into the source SHA.
declare const __APP_CANDIDATE_LABEL__: string
