import type { ProviderGuide } from './types'

export const webdavGuide = {
  "title": "WebDAV",
  "prepare": "服务商的完整WebDAV地址、所需账号/应用密码，以及独立可公开读的图片根URL。",
  "links": [
    {
      "label": "Nextcloud WebDAV 获取方式",
      "href": "https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html"
    },
    {
      "label": "Nextcloud 应用密码说明",
      "href": "https://docs.nextcloud.com/server/latest/user_manual/en/session_management.html"
    }
  ],
  "fields": [
    {
      "label": "显示名称",
      "requirement": "必填",
      "source": "自己命名",
      "path": "在镜云填写，不需要到平台申请",
      "fill": "取一个自己能分辨的连接名称。",
      "example": "我的 WebDAV",
      "mistake": "不是账号名，也不会创建存储桶或仓库。",
      "href": "",
      "step": ""
    },
    {
      "label": "资源目录（可选）",
      "requirement": "可选",
      "source": "自己指定的路径前缀",
      "path": "在镜云填写；也可清空",
      "fill": "只填存储内部的相对目录，留空表示根目录。",
      "example": "images",
      "mistake": "不要填完整网址、磁盘路径或重复已有前缀。",
      "href": "",
      "step": ""
    },
    {
      "label": "WebDAV Endpoint",
      "requirement": "必填",
      "source": "你自己的NAS / 网盘WebDAV连接说明",
      "path": "Nextcloud：文件页面 → 左下角文件设置 → WebDAV；其他服务向管理员索取",
      "fill": "完整复制自己的HTTPS接口地址，保留必要路径。",
      "example": "https://cloud.example.com/remote.php/dav/files/user/",
      "mistake": "示例不是可用服务；Nextcloud文档网址不能填入Endpoint。",
      "href": "https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html",
      "step": ""
    },
    {
      "label": "用户名",
      "requirement": "按服务要求",
      "source": "服务商账号 / 管理员分配账号",
      "path": "自己的服务个人设置或管理员提供的连接信息",
      "fill": "填WebDAV登录用户名；服务若允许匿名，按其要求处理。",
      "example": "自己的WebDAV用户名",
      "mistake": "不一定是昵称或邮箱；迁移重连要求重新填写。",
      "href": "https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html",
      "step": ""
    },
    {
      "label": "密码 / App Password",
      "requirement": "按服务要求",
      "source": "服务专用应用密码",
      "path": "Nextcloud：头像 → 个人设置 → 安全 → 设备与会话 → 创建应用密码",
      "fill": "启用双因素认证等情况下使用专用应用密码；其他服务按官方要求。",
      "example": "粘贴自己的应用密码",
      "mistake": "不要直接假定网页登录密码可用；迁移重连需重新填写。",
      "href": "https://docs.nextcloud.com/server/latest/user_manual/en/session_management.html",
      "step": ""
    },
    {
      "label": "公开访问域名（发布到该云端时必填）",
      "requirement": "必填",
      "source": "管理员配置的独立图片静态域名 / 代理",
      "path": "向自己的服务管理员索取无需登录的图片根URL",
      "fill": "须与WebDAV路径和资源目录映射到同一文件。",
      "example": "https://img.example.com",
      "mistake": "需要Cookie/登录的分享页不是图片外链；没有此地址先完成公开访问配置。",
      "href": "https://docs.nextcloud.com/server/latest/user_manual/en/files/access_webdav.html",
      "step": ""
    }
  ]
} as const satisfies ProviderGuide
