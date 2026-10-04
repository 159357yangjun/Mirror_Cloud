import type { BootstrapSnapshot, RecipeView } from '../types'

export const mockBootstrap: BootstrapSnapshot = {
  appName: 'Multi-cloud Publisher',
  version: '1.0.1',
  providers: [
    { id: 'r2', name: 'Cloudflare R2', category: 'object', recommendedFor: '低成本公网图片、博客', setupMinutes: 5, status: 'available' },
    { id: 's3', name: 'S3 Compatible', category: 'object', recommendedFor: 'AWS、MinIO 与兼容服务', setupMinutes: 6, status: 'available' },
    { id: 'oss', name: '阿里云 OSS', category: 'object', recommendedFor: '国内网站与静态资源', setupMinutes: 6, status: 'available' },
    { id: 'cos', name: '腾讯云 COS', category: 'object', recommendedFor: '国内网站与静态资源', setupMinutes: 6, status: 'available' },
    { id: 'github', name: 'GitHub', category: 'repository', recommendedFor: 'README、项目文档', setupMinutes: 3, status: 'available' },
    { id: 'gitee', name: 'Gitee', category: 'repository', recommendedFor: '国内仓库资源、镜像备份', setupMinutes: 3, status: 'available' },
    { id: 'webdav', name: 'WebDAV', category: 'protocol', recommendedFor: 'NAS 与自建服务', setupMinutes: 5, status: 'available' },
  ],
}


export const mockRecipes: RecipeView[] = [
  { key: 'blog_balanced', name: '博客 · WebP 均衡', description: '限制长边到 2560px，WebP 82%，适合博客、Markdown 与日常图片。', badge: '推荐', format: 'webp', quality: 82, maxWidth: 2560, maxHeight: 2560, renameTemplate: 'images/{year}/{month}/{hash:12}-{stem}.{ext}', recommended: true },
  { key: 'docs_crisp', name: '文档 · 清晰优先', description: '限制到 1920px，WebP 90%，更适合截图、教程和项目文档。', badge: '文档', format: 'webp', quality: 90, maxWidth: 1920, maxHeight: 1920, renameTemplate: 'docs/{year}/{month}/{hash:12}.{ext}', recommended: false },
  { key: 'small_fast', name: '分享 · 小体积', description: '限制到 1600px，WebP 72%，优先减少上传时间和公网流量。', badge: '极速', format: 'webp', quality: 72, maxWidth: 1600, maxHeight: 1600, renameTemplate: 'share/{year}/{month}/{hash:12}.{ext}', recommended: false },
  { key: 'original_keep', name: '原图 · 不转换', description: '不改变图片内容，仅统一远端命名。', badge: '原图', format: 'original', quality: 100, maxWidth: null, maxHeight: null, renameTemplate: 'original/{year}/{month}/{hash:12}-{stem}.{ext}', recommended: false },
]
