import type { ProviderGuide } from './types'

export const cosGuide = {
  "title": "腾讯云 COS",
  "prepare": "带APPID后缀的完整桶名、地域Endpoint、SecretId/SecretKey、图片访问域名。",
  "links": [
    {
      "label": "打开 COS 控制台",
      "href": "https://console.cloud.tencent.com/cos"
    },
    {
      "label": "打开 CAM 用户管理",
      "href": "https://console.cloud.tencent.com/cam/user"
    },
    {
      "label": "管理 API 密钥",
      "href": "https://console.cloud.tencent.com/cam/capi"
    }
  ],
  "fields": [
    {
      "label": "显示名称",
      "requirement": "必填",
      "source": "自己命名",
      "path": "在镜云填写，不需要到平台申请",
      "fill": "取一个自己能分辨的连接名称。",
      "example": "我的 COS",
      "mistake": "不是账号名，也不会创建存储桶或仓库。",
      "href": "",
      "step": ""
    },
    {
      "label": "Bucket",
      "requirement": "必填",
      "source": "COS存储桶列表的完整名称",
      "path": "COS控制台 → 存储桶列表 → 目标桶 → 概览",
      "fill": "复制包含APPID后缀的完整桶名。",
      "example": "my-images-1250000000",
      "mistake": "只填my-images会找不到桶；APPID示例请换成自己的。",
      "href": "https://console.cloud.tencent.com/cos",
      "step": ""
    },
    {
      "label": "Endpoint",
      "requirement": "必填",
      "source": "目标桶的地域 + 官方域名表",
      "path": "目标桶 → 概览 → 地域；查对应的地域简称",
      "fill": "填该地域的服务根地址，不拼完整桶名。",
      "example": "https://cos.ap-guangzhou.myqcloud.com",
      "mistake": "广州只是例子；北京等地域必须换成对应值。",
      "href": "https://cloud.tencent.com/document/product/436/6224",
      "step": ""
    },
    {
      "label": "SecretId",
      "requirement": "必填",
      "source": "专用CAM子用户API密钥",
      "path": "CAM → 用户 → 目标子用户 → API密钥；或该用户登录后管理API密钥",
      "fill": "复制已授权当前桶的子用户SecretId。",
      "example": "粘贴自己的SecretId",
      "mistake": "不能填APPID；当前镜云没有临时Session Token字段。",
      "href": "https://console.cloud.tencent.com/cam/user",
      "step": ""
    },
    {
      "label": "SecretKey",
      "requirement": "必填",
      "source": "与SecretId配对的API密钥",
      "path": "CAM → API密钥管理 → 创建 / 按控制台流程取得密钥",
      "fill": "完整粘贴与上项配对的SecretKey。",
      "example": "粘贴自己的SecretKey",
      "mistake": "不是腾讯云登录密码；不要混用不同密钥对。",
      "href": "https://console.cloud.tencent.com/cam/capi",
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
      "source": "已配置的域名或可匿名读的桶域名",
      "path": "目标桶 → 域名与传输管理；确认访问策略、HTTPS、回源",
      "fill": "填可实际显示图片的HTTPS根地址。",
      "example": "https://my-images-1250000000.cos.ap-guangzhou.myqcloud.com",
      "mistake": "默认域名仅作格式示例，匿名读取和预览须实际验证；私有桶填地址不会自动公开。",
      "href": "https://cloud.tencent.com/document/product/436/6224",
      "step": ""
    }
  ]
} as const satisfies ProviderGuide
