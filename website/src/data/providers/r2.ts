import type { ProviderGuide } from './types'

export const r2Guide = {
  "title": "Cloudflare R2",
  "prepare": "Bucket、32位Account ID、同一对S3访问密钥；公开用途另备图片域名。",
  "links": [
    {
      "label": "打开 Cloudflare 控制台",
      "href": "https://dash.cloudflare.com/"
    },
    {
      "label": "R2 密钥创建说明",
      "href": "https://developers.cloudflare.com/r2/api/tokens/"
    },
    {
      "label": "公开域名设置说明",
      "href": "https://developers.cloudflare.com/r2/buckets/public-buckets/"
    }
  ],
  "fields": [
    {
      "label": "连接名称",
      "requirement": "必填",
      "source": "自己命名",
      "path": "在镜云填写，不需要到平台申请",
      "fill": "取一个自己能分辨的连接名称。",
      "example": "我的 R2",
      "mistake": "不是账号名，也不会创建存储桶或仓库。",
      "href": "",
      "step": "第1步 · 存储桶"
    },
    {
      "label": "Bucket（存储桶名）",
      "requirement": "必填",
      "source": "Cloudflare R2桶列表",
      "path": "登录控制台 → Storage & databases → R2 → Overview → 选择桶",
      "fill": "复制存储桶的准确名称。",
      "example": "my-images",
      "mistake": "不是目录、账户ID或r2.dev域名。",
      "href": "https://dash.cloudflare.com/",
      "step": "第1步 · 存储桶"
    },
    {
      "label": "Account ID",
      "requirement": "必填",
      "source": "R2概览的账户信息 / S3 API信息",
      "path": "R2 → Overview → Account Details；也可从S3 API地址识别",
      "fill": "复制自己的32位十六进制账户编号。",
      "example": "自己的32位Account ID",
      "mistake": "不是Zone ID、邮箱或API Token。",
      "href": "https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/",
      "step": "第1步 · 存储桶"
    },
    {
      "label": "API Endpoint / Region",
      "requirement": "自动生成",
      "source": "镜云根据Account ID计算",
      "path": "第1步表单下方自动预览，无需额外填写",
      "fill": "Endpoint为https://账户ID.r2.cloudflarestorage.com；Region固定auto。",
      "example": "Region：auto",
      "mistake": "当前镜云仅支持默认辖区；不能填EU/US/FedRAMP专用辖区桶。",
      "href": "https://developers.cloudflare.com/r2/get-started/s3/",
      "step": "第1步 · 存储桶"
    },
    {
      "label": "公开发布 / 私有存储目标",
      "requirement": "二选一",
      "source": "你对图片访问方式的选择",
      "path": "在镜云第2步选择用途",
      "fill": "发到文档供别人看选公开发布；认证后访问选私有存储目标。",
      "example": "公开发布",
      "mistake": "选私有不会关闭Cloudflare现有公共域名，需另行验证匿名读取拒绝。",
      "href": "https://developers.cloudflare.com/r2/buckets/public-buckets/",
      "step": "第2步 · 发布用途"
    },
    {
      "label": "公开访问地址",
      "requirement": "公开时必填",
      "source": "桶Settings中的Custom Domains或Public Development URL",
      "path": "R2 → 选桶 → Settings → Custom Domains / Public Development URL",
      "fill": "复制已启用且可访问的完整HTTPS根地址；私有用途不填。",
      "example": "https://img.example.com",
      "mistake": "不能填S3 API Endpoint；r2.dev为有限制的开发地址。",
      "href": "https://developers.cloudflare.com/r2/buckets/public-buckets/",
      "step": "第2步 · 发布用途"
    },
    {
      "label": "Access Key ID",
      "requirement": "必填",
      "source": "R2专用API令牌生成结果",
      "path": "R2概览 → API Tokens的Manage → 创建Account/User API token",
      "fill": "选Object Read & Write，范围限当前桶，创建后复制Access Key ID。",
      "example": "粘贴自己的Access Key ID",
      "mistake": "不是普通Cloudflare API Token，也不是Account ID。",
      "href": "https://developers.cloudflare.com/r2/api/tokens/",
      "step": "第3步 · API 密钥"
    },
    {
      "label": "Secret Access Key",
      "requirement": "必填",
      "source": "与Access Key ID同次生成的结果页",
      "path": "创建R2令牌后立即保存Secret Access Key",
      "fill": "完整粘贴同一对密钥的Secret；通常只显示一次。",
      "example": "粘贴自己的Secret Access Key",
      "mistake": "与ID必须配对；丢失Secret需重新创建，不能用令牌字符串代替。",
      "href": "https://developers.cloudflare.com/r2/api/tokens/",
      "step": "第3步 · API 密钥"
    },
    {
      "label": "资源目录（可选）",
      "requirement": "可选",
      "source": "自己指定的路径前缀",
      "path": "在镜云填写；也可清空",
      "fill": "只填存储内部的相对目录，留空表示根目录。",
      "example": "assets",
      "mistake": "不要填完整网址、磁盘路径或重复已有前缀。",
      "href": "",
      "step": "第3步 · API 密钥"
    }
  ]
} as const satisfies ProviderGuide
