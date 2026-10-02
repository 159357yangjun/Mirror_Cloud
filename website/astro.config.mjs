import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// GitHub Pages project sites serve the build from a repository subpath, so base has to be
// explicit; scripts/check_docs_site.py fails CI if site, base and the app's VITE_DOCS_BASE_URL drift.
export default defineConfig({
  site: 'https://159357yangjun.github.io/image-hosting-platform/',
  base: '/image-hosting-platform',
  integrations: [
    starlight({
      title: '镜云 · Mirror Cloud',
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
            { label: '本机 HTTP API', slug: 'use/local-api' },
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
