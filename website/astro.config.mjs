import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  integrations: [
    starlight({
      title: '图床 · Image Hosting Platform',
      description: 'A multi-cloud image hosting, management and publishing platform.',
      sidebar: [
        { label: '开始', items: [{ label: '5 分钟上手', slug: 'index' }] },
        {
          label: '连接云端',
          items: [
            { label: 'Cloudflare R2', slug: 'guides/r2' },
            { label: '阿里云 OSS', slug: 'guides/oss' },
            { label: '腾讯云 COS', slug: 'guides/cos' },
            { label: 'S3 Compatible', slug: 'guides/s3' },
            { label: 'GitHub', slug: 'guides/github' },
            { label: 'Gitee', slug: 'guides/gitee' },
            { label: 'WebDAV', slug: 'guides/webdav' }
          ]
        },
        {
          label: '使用',
          items: [
            { label: '文件 / URL / 剪贴板', slug: 'use/publish' },
            { label: 'Typora 配置向导', slug: 'use/typora' },
            { label: '多云组与修复', slug: 'use/multicloud' },
            { label: '凭据与安全', slug: 'use/security' }
          ]
        },
        {
          label: '进阶',
          items: [{ label: '处理策略怎么选', slug: 'recipes/choose' }]
        }
      ]
    })
  ]
})
