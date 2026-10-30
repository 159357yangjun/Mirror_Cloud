import { githubGuide } from './providers/github'
import { giteeGuide } from './providers/gitee'
import { r2Guide } from './providers/r2'
import { ossGuide } from './providers/oss'
import { cosGuide } from './providers/cos'
import { s3Guide } from './providers/s3'
import { webdavGuide } from './providers/webdav'
import type { ProviderGuide } from './providers/types'

export type { SetupField, ProviderGuide } from './providers/types'

// Keep the shared registry stable; platform-specific instructions live beside their fields.
export const providerGuides = {
  github: githubGuide,
  gitee: giteeGuide,
  r2: r2Guide,
  oss: ossGuide,
  cos: cosGuide,
  s3: s3Guide,
  webdav: webdavGuide,
} as const satisfies Record<string, ProviderGuide>

export type ProviderKey = keyof typeof providerGuides
