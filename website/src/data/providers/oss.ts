import type { ProviderGuide } from './types'

export const ossGuide = {
  "title": "阿里云 OSS",
  "prepare": "桶名、外网Endpoint、RAM AccessKey ID/Secret、已配置的图片HTTPS域名。",
  "links": [
    {
      "label": "打开 OSS 控制台",
      "href": "https://oss.console.aliyun.com/"
    },
    {
      "label": "打开 RAM 控制台",
      "href": "https://ram.console.aliyun.com/"
    },
    {
      "label": "配置图片自定义域名",
      "href": "https://help.aliyun.com/zh/oss/user-guide/access-buckets-via-custom-domain-names"
    }
  ],
  "fields": [
    {
      "label": "显示名称",
      "requirement": "必填",
      "source": "自己命名",
      "path": "在镜云填写，不需要到平台申请",
      "fill": "取一个自己能分辨的连接名称。",
      "example": "我的 OSS",
      "mistake": "不是账号名，也不会创建存储桶或仓库。",
      "href": "",
      "step": ""
    },
    {
      "label": "Bucket",
      "requirement": "必填",
      "source": "OSS控制台存储桶列表",
      "path": "OSS控制台 → Bucket列表 → 选择目标桶",
      "fill": "复制桶名，保持与密钥授权的桶一致。",
      "example": "my-images",
      "mistake": "不带地域后缀、域名或目录。",
      "href": "https://oss.console.aliyun.com/",
      "step": ""
    },
    {
      "label": "Endpoint",
      "requirement": "必填",
      "source": "目标桶概览 / 访问端口",
      "path": "OSS控制台 → 目标桶 → 概览 → 访问端口；选外网Endpoint",
      "fill": "复制该地域的服务Endpoint并补https://，不要拼桶名。",
      "example": "https://oss-cn-hangzhou.aliyuncs.com",
      "mistake": "杭州只是例子；不要填内网-internal地址或图片域名。",
      "href": "https://help.aliyun.com/zh/oss/user-guide/regions-and-endpoints",
      "step": ""
    },
    {
      "label": "AccessKey ID",
      "requirement": "必填",
      "source": "专用RAM用户AccessKey",
      "path": "RAM控制台 → 身份管理/用户 → 目标用户 → 认证管理 → 创建AccessKey",
      "fill": "选择对目标桶有列举/读/写/删除权限的RAM用户，复制ID。",
      "example": "粘贴自己的AccessKey ID",
      "mistake": "不要使用无关账号密钥；当前表单没有STS Token字段。",
      "href": "https://ram.console.aliyun.com/",
      "step": ""
    },
    {
      "label": "AccessKey Secret",
      "requirement": "必填",
      "source": "同一RAM AccessKey创建结果",
      "path": "创建AccessKey后立即保存Secret",
      "fill": "与上项配对，完整粘贴。",
      "example": "粘贴自己的AccessKey Secret",
      "mistake": "不是控制台登录密码；Secret通常只显示一次。",
      "href": "https://help.aliyun.com/zh/ram/user-guide/create-an-accesskey-pair",
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
      "label": "公开访问域名（发布到该云端时必填）",
      "requirement": "必填",
      "source": "已绑定的自定义域名 / CDN",
      "path": "OSS桶 → 域名管理 → 绑定域名；配置DNS与HTTPS后验证",
      "fill": "填能匿名直接显示图片的HTTPS根地址。",
      "example": "https://img.example.com",
      "mistake": "API Endpoint不是图片根地址；默认OSS域名可能强制下载，不能替代已验证的预览域名。",
      "href": "https://help.aliyun.com/zh/oss/user-guide/access-buckets-via-custom-domain-names",
      "step": ""
    }
  ]
} as const satisfies ProviderGuide
