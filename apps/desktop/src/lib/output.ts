import type { OutputPreferences } from '../types'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * Normalize public asset URLs before they are copied or rendered as output.
 *
 * - GitHub `blob` links are HTML pages and cannot be used as image sources, so
 *   convert the common `/owner/repo/blob/branch/path` form to raw content.
 * - URL() canonicalizes non-ASCII path segments (for example Chinese filenames)
 *   to percent-encoded URLs, preventing broken mixed-encoding links.
 */
export function normalizePublicAssetUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return trimmed

  try {
    const url = new URL(trimmed)
    if (url.hostname.toLowerCase() === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length >= 5 && parts[2] === 'blob') {
        const [owner, repo, , branch, ...path] = parts
        const raw = new URL('https://raw.githubusercontent.com/')
        raw.pathname = `/${owner}/${repo}/${branch}/${path.join('/')}`
        return raw.toString()
      }
    }
    return url.toString()
  } catch {
    return trimmed
  }
}

export function formatPublishedAsset(name: string, url: string, preferences: OutputPreferences) {
  const publicUrl = normalizePublicAssetUrl(url)
  switch (preferences.defaultFormat) {
    case 'url':
      return publicUrl
    case 'html':
      return `<img src="${escapeHtml(publicUrl)}" alt="${escapeHtml(name)}">`
    case 'bbcode':
      return `[img]${publicUrl}[/img]`
    case 'custom':
      return preferences.customTemplate.replaceAll('{url}', publicUrl).replaceAll('{name}', name)
    case 'markdown':
    default:
      return `![${name.replaceAll(']', '\\]')}](${publicUrl})`
  }
}
