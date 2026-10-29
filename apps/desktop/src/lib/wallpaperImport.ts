// Decode locally and store a bounded, flattened JPEG rather than the original file or its path.
export async function prepareWallpaper(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPG 或 WebP 图片。')
  if (file.size > 16 * 1024 * 1024) throw new Error('图片不能超过 16 MB，请先缩小后再导入。')
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const picture = new window.Image()
      const timer = window.setTimeout(() => { picture.src = ''; reject(new Error('图片读取超时，请换一张重试。')) }, 10_000)
      picture.onload = () => { window.clearTimeout(timer); resolve(picture) }
      picture.onerror = () => { window.clearTimeout(timer); reject(new Error('无法读取这张图片，请换一张重试。')) }
      picture.src = url
    })
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片尺寸过大或无效，请先缩小后再导入。')
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前无法处理图片，请稍后重试。')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.85, 0.7, 0.5]) {
      const result = canvas.toDataURL('image/jpeg', quality)
      if (result.startsWith('data:image/jpeg;base64,') && result.length <= 1_200_000) return result
    }
    throw new Error('图片处理后仍然过大，请选择更小的图片。')
  } finally { URL.revokeObjectURL(url) }
}
