const DATABASE = 'mirror-cloud-personal-wallpaper'
const STORE = 'media'
const KEY = 'video'
export const VIDEO_WALLPAPER_CHANGED = 'mirror:video-wallpaper-changed'
export const MAX_VIDEO_BYTES = 64 * 1024 * 1024

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = window.indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(new Error('本机壁纸存储不可用，请检查磁盘空间。'))
    request.onblocked = () => { blocked = true; reject(new Error('壁纸存储被其他窗口占用，请关闭其他窗口后重试。')) }
  })
}

async function transaction(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = operation(tx.objectStore(STORE))
      let result: unknown
      request.onsuccess = () => { result = request.result }
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => reject(new Error('本机视频壁纸未能保存或读取，原选择已保留。'))
    })
  } finally { db.close() }
}

export async function readVideoWallpaper(): Promise<Blob | null> {
  const value = await transaction('readonly', (store) => store.get(KEY))
  return value instanceof Blob && value.type === 'video/mp4' && value.size <= MAX_VIDEO_BYTES ? value : null
}

export async function writeVideoWallpaper(video: Blob | null): Promise<void> {
  if (video && (video.type !== 'video/mp4' || video.size > MAX_VIDEO_BYTES)) throw new Error('视频格式或大小无效。')
  await transaction('readwrite', (store) => video ? store.put(video, KEY) : store.delete(KEY))
  window.dispatchEvent(new Event(VIDEO_WALLPAPER_CHANGED))
}

export function validateVideoFile(file: Pick<File, 'type' | 'name' | 'size'>) {
  if (!(file.type === 'video/mp4' || (!file.type && /\.mp4$/i.test(file.name)))) throw new Error('动态壁纸请选择 MP4 视频。')
  if (!file.size || file.size > MAX_VIDEO_BYTES) throw new Error('MP4 需大于 0 字节且不超过 64 MB。')
}

export async function prepareVideoWallpaper(file: File): Promise<Blob> {
  validateVideoFile(file)
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => finish(new Error('视频读取超时，请换一个较小的 MP4。')), 15_000)
      const finish = (error?: Error) => {
        window.clearTimeout(timer)
        video.onloadeddata = null
        video.onerror = null
        if (error) reject(error)
        else resolve()
      }
      video.onerror = () => finish(new Error('无法解码这个视频，请使用常见 H.264 编码的 MP4。'))
      video.onloadeddata = () => {
        if (!video.videoWidth || !video.videoHeight || video.videoWidth * video.videoHeight > 16_777_216 || !Number.isFinite(video.duration) || video.duration > 600) {
          finish(new Error('视频尺寸无效、超过 4K 级别或长于 10 分钟，请选择较短的壁纸。'))
        } else finish()
      }
      video.src = url
    })
    // A local blob copy only: no original path, filename, audio playback, upload or shared asset.
    return new Blob([file], { type: 'video/mp4' })
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
