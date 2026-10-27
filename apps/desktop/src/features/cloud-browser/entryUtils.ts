import type { StorageEntryView } from '../../types'

export function parentPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

export function isImage(entry: StorageEntryView) {
  if (entry.isDir) return false
  const source = `${entry.name} ${entry.publicUrl || ''}`.toLowerCase().split('?')[0]
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'].some((extension) =>
    source.endsWith(extension) || source.includes(`${extension} `),
  )
}
