import { useCallback, useEffect, useRef, useState } from 'react'
import { previewPrivateStorageEntry } from './desktop'
import type { StorageEntryView, StorageView } from '../types'

const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
const PRIVATE_IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif)$/i
const PUBLIC_IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|bmp)$/i

export interface CloudImagePreview {
  entry: StorageEntryView
  src: string
  privateMode: boolean
}

/** URL-free R2 preview is available only when the selected storage requested privacy. */
export function isPrivateR2Storage(storage?: StorageView): boolean {
  return Boolean(storage?.enabled && storage.providerKey === 'r2' && storage.accessMode === 'private_requested')
}

export function canPreviewCloudImage(entry: StorageEntryView, storage?: StorageView): boolean {
  if (entry.isDir) return false
  // Do not attempt private reads for BMP (unsupported by the Rust signature allowlist).
  // A private-requested R2 configuration takes precedence over stale public
  // URLs from legacy records. Never use such an address for private preview.
  if (isPrivateR2Storage(storage)) return PRIVATE_IMAGE_EXTENSION.test(entry.name)
  // Preserve the existing public-gallery behavior for extensionless object names:
  // public URLs may carry the image suffix even when the displayed name does not.
  if (entry.publicUrl) {
    return PUBLIC_IMAGE_EXTENSION.test(entry.name) ||
      PUBLIC_IMAGE_EXTENSION.test(entry.publicUrl.split(/[?#]/, 1)[0])
  }
  return false
}

/** Shared between the gallery and storage browser; never stores signed URLs or thumbnails. */
export function useCloudImagePreview() {
  const [preview, setPreview] = useState<CloudImagePreview | null>(null)
  const [previewingPath, setPreviewingPath] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const temporaryUrl = useRef<string | null>(null)

  const closePreview = useCallback(() => {
    generation.current += 1
    if (temporaryUrl.current) {
      URL.revokeObjectURL(temporaryUrl.current)
      temporaryUrl.current = null
    }
    setPreview(null)
    setPreviewingPath(null)
    setPreviewError(null)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
      if (temporaryUrl.current) {
        URL.revokeObjectURL(temporaryUrl.current)
        temporaryUrl.current = null
      }
    }
  }, [])

  const openPreview = useCallback(async (entry: StorageEntryView, storage?: StorageView) => {
    if (!canPreviewCloudImage(entry, storage)) return
    const request = ++generation.current
    if (temporaryUrl.current) {
      URL.revokeObjectURL(temporaryUrl.current)
      temporaryUrl.current = null
    }
    setPreview(null)
    setPreviewError(null)

    if (!isPrivateR2Storage(storage) && entry.publicUrl) {
      setPreview({ entry, src: entry.publicUrl, privateMode: false })
      setPreviewingPath(null)
      return
    }
    if (!storage || !isPrivateR2Storage(storage)) return
    if (entry.sizeBytes != null && entry.sizeBytes > MAX_PREVIEW_BYTES) {
      setPreviewError('图片超过 5 MB，请选择下载原图。')
      setPreviewingPath(null)
      return
    }
    setPreviewingPath(entry.path)
    try {
      const result = await previewPrivateStorageEntry(storage.id, entry.path)
      // Ignore stale responses after storage/path switch, close or unmount.
      if (!mounted.current || generation.current !== request) return
      const src = URL.createObjectURL(new Blob([Uint8Array.from(result.bytes)], { type: result.mimeType }))
      temporaryUrl.current = src
      setPreview({ entry, src, privateMode: true })
    } catch {
      // Tauri/SDK diagnostics may contain credentials or presigned URLs.
      if (mounted.current && generation.current === request) {
        setPreviewError('私有图片读取失败，请检查存储连接、文件大小和图片格式。')
      }
    } finally {
      if (mounted.current && generation.current === request) setPreviewingPath(null)
    }
  }, [])

  return { preview, previewingPath, previewError, openPreview, closePreview }
}
