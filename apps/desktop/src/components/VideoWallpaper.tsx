import { useEffect, useRef, useState } from 'react'
import { readVideoWallpaper, VIDEO_WALLPAPER_CHANGED } from '../lib/videoWallpaper'
import { notifyError } from '../store/useToastStore'

export function VideoWallpaper({ motion }: { motion: boolean }) {
  const [src, setSrc] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    let disposed = false, currentUrl = '', revision = 0
    const reload = async () => {
      const request = ++revision
      try {
        const blob = await readVideoWallpaper()
        if (disposed || request !== revision) return
        const next = blob ? URL.createObjectURL(blob) : ''
        const previous = currentUrl
        currentUrl = next
        setSrc(next)
        if (previous) URL.revokeObjectURL(previous)
        if (!blob) notifyError('本机视频壁纸不存在，请在皮肤中重新导入。')
      } catch {
        if (!disposed && request === revision) notifyError('本机视频壁纸读取失败，请重新导入；其他功能可继续使用。')
      }
    }
    void reload()
    window.addEventListener(VIDEO_WALLPAPER_CHANGED, reload)
    return () => {
      disposed = true
      window.removeEventListener(VIDEO_WALLPAPER_CHANGED, reload)
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reported = false
    const update = () => {
      if (!motion || document.hidden || reduced.matches) video.pause()
      else void video.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (!reported) { reported = true; notifyError('动态壁纸未能播放，可暂停播放或换一个 H.264 MP4。') }
      })
    }
    update()
    video.addEventListener('loadeddata', update)
    document.addEventListener('visibilitychange', update)
    reduced.addEventListener('change', update)
    return () => {
      video.pause()
      video.removeEventListener('loadeddata', update)
      document.removeEventListener('visibilitychange', update)
      reduced.removeEventListener('change', update)
    }
  }, [motion, src])

  return src ? <video ref={videoRef} src={src} className="app-wallpaper-video" muted loop playsInline preload="auto" aria-hidden="true" onError={() => notifyError('视频壁纸无法解码，请更换 MP4；原文件不会被修改。')} /> : null
}
