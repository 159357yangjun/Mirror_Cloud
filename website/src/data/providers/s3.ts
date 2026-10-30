import type { ProviderGuide } from './types'

export const s3Guide = {
  "title": "S3 Compatible",
  "prepare": "服务商提供的桶名、Endpoint、Region、Access Key ID/Secret；公开用途另备图片域名。",
  "links": [
    {
      "label": "AWS S3 控制台",
      "href": "https://console.aws.amazon.com/s3/"
    },
    {
      "label": "AWS IAM 密钥入口",
      "href": "https://console.aws.amazon.com/iam/"
    },
    {
      "label": "AWS 地域 / Endpoint 对照表",
      "href": "https://docs.aws.amazon.com/general/latest/gr/s3.html"
    }
  ],
  "fields": [
    {
      "label": "显示名称",
      "requirement": "必填",
      "source": "自己命名",
      "path": "在镜云填写，不需要到平台申请",
      "fill": "取一个自己能分辨的连接名称。",
      "example": "我的 S3",
      "mistake": "不是账号名，也不会创建存储桶或仓库。",
      "href": "",
      "step": ""
    },
    {
      "label": "Bucket",
      "requirement": "必填",
      "source": "所用S3服务商的桶列表",
      "path": "服务商控制台 → 存储桶 → 目标桶",
      "fill": "复制准确桶名；AWS入口仅适用于AWS账户。",
      "example": "my-images",
      "mistake": "S3 Compatible是协议，不是统一的服务商；不要把AWS示例用于其他平台。",
      "href": "https://console.aws.amazon.com/s3/",
      "step": ""
    },
    {
      "label": "Endpoint",
      "requirement": "必填",
      "source": "服务商S3连接信息 / API说明",
      "path": "服务商控制台 → 目标桶 → S3 API / Endpoint",
      "fill": "填HTTPS服务根地址；遵循该服务商说明，不重复追加桶名。",
      "example": "https://s3.us-east-1.amazonaws.com",
      "mistake": "不是控制台地址；自建MinIO找管理员索取S3 API地址而非Console端口。",
      "href": "https://docs.aws.amazon.com/general/latest/gr/s3.html",
      "step": ""
    },
    {
      "label": "Region",
      "requirement": "按服务商",
      "source": "桶的实际地域 / S3兼容说明",
      "path": "目标桶 → 属性/地域；自建服务按部署管理员说明",
      "fill": "AWS填桶地域；其他服务填其签名要求值，不确定时不要照抄默认。",
      "example": "us-east-1（仅为AWS示例）",
      "mistake": "地域不匹配可能导致签名错误或重定向，不能凭距离猜。",
      "href": "https://docs.aws.amazon.com/general/latest/gr/s3.html",
      "step": ""
    },
    {
      "label": "Access Key ID",
      "requirement": "必填",
      "source": "服务商的访问密钥管理",
      "path": "AWS：IAM → 用户 → 专用用户 → Security credentials → Create access key",
      "fill": "为当前桶授予列举/读/写/删除等所需权限，复制访问密钥ID。",
      "example": "粘贴自己的Access Key ID",
      "mistake": "非AWS请在自己的服务商创建；网页登录密码不能替代。",
      "href": "https://console.aws.amazon.com/iam/",
      "step": ""
    },
    {
      "label": "Secret Access Key",
      "requirement": "必填",
      "source": "同次创建的密钥结果",
      "path": "创建Access Key后保存配对的Secret",
      "fill": "完整粘贴与ID配对的密钥。",
      "example": "粘贴自己的Secret Access Key",
      "mistake": "当前表单没有Session Token字段，临时三元组不能只填两项。",
      "href": "https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html",
      "step": ""
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
      "step": ""
    },
    {
      "label": "此 S3 存储的发布用途",
      "requirement": "二选一",
      "source": "你对访问方式的选择",
      "path": "在镜云的公开发布 / 私有存储目标按钮中选择",
      "fill": "公开用于文档外链；私有用于认证预览/服务支持的限时分享。",
      "example": "公开发布",
      "mistake": "选择私有不会修改桶策略或CDN权限。",
      "href": "",
      "step": ""
    },
    {
      "label": "公开访问域名（发布到该云端时必填）",
      "requirement": "公开时必填",
      "source": "服务商配置好的公开域名 / CDN",
      "path": "服务商域名/CDN与读取策略设置完成后",
      "fill": "填能直接打开图片的HTTPS根地址；私有用途不显示此项。",
      "example": "https://img.example.com",
      "mistake": "不要填写控制台登录地址、签名URL或带查询参数的临时链接。",
      "href": "https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-management.html",
      "step": ""
    }
  ]
} as const satisfies ProviderGuide
