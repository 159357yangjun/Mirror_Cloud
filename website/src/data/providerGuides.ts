export interface SetupField {
  label: string
  requirement: string
  source: string
  path: string
  fill: string
  example: string
  mistake: string
  href: string
  step: string
}
export interface ProviderGuide {
  title: string
  prepare: string
  links: readonly { label: string; href: string }[]
  fields: readonly SetupField[]
}

// Teaching examples only: no account data or credentials are collected by the site.
export const providerGuides = {
  "github": {
    "title": "GitHub",
    "prepare": "仓库地址、实际分支名、访问令牌；目录可自行决定。",
    "links": [
      {
        "label": "打开仓库平台",
        "href": "https://github.com/"
      },
      {
        "label": "创建 / 管理访问令牌",
        "href": "https://github.com/settings/personal-access-tokens/new"
      },
      {
        "label": "创建仓库",
        "href": "https://github.com/new"
      }
    ],
    "fields": [
      {
        "label": "显示名称",
        "requirement": "必填",
        "source": "自己命名",
        "path": "在镜云填写，不需要到平台申请",
        "fill": "取一个自己能分辨的连接名称。",
        "example": "我的 GitHub",
        "mistake": "不是账号名，也不会创建存储桶或仓库。",
        "href": "",
        "step": ""
      },
      {
        "label": "用户名 / Owner",
        "requirement": "必填",
        "source": "仓库网址第一段",
        "path": "打开自己的仓库，查看浏览器地址栏",
        "fill": "例如 https://github.com/your-name/my-images，填your-name；组织仓库填组织路径。",
        "example": "your-name",
        "mistake": "不要填昵称、邮箱或完整网址。",
        "href": "https://github.com/",
        "step": ""
      },
      {
        "label": "仓库名",
        "requirement": "必填",
        "source": "仓库网址第二段",
        "path": "打开仓库，查看地址最后一段",
        "fill": "只填仓库路径名，不含域名和.git。",
        "example": "my-images",
        "mistake": "中文展示名可能与路径不同；以网址为准。",
        "href": "https://github.com/",
        "step": ""
      },
      {
        "label": "分支",
        "requirement": "必填",
        "source": "仓库文件列表上方的分支菜单",
        "path": "仓库首页 → 分支下拉菜单",
        "fill": "复制实际存在的分支，区分大小写。",
        "example": "main",
        "mistake": "示例分支不是固定值；空仓库先初始化README。",
        "href": "https://github.com/",
        "step": ""
      },
      {
        "label": "资源目录",
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
        "label": "访问令牌",
        "requirement": "必填",
        "source": "私人令牌创建完成后的结果页",
        "path": "创建令牌 → 设置仓库范围与权限 → 生成",
        "fill": "Resource owner选仓库所有者；Only select repositories只选当前仓库；Contents设为Read and write。 将生成的完整令牌粘贴到镜云。",
        "example": "粘贴自己的令牌（不提供假密钥）",
        "mistake": "不是登录密码或SSH密钥；过期、撤销或组织未批准都会失败。",
        "href": "https://github.com/settings/personal-access-tokens/new",
        "step": ""
      },
      {
        "label": "自定义公开域名（可选）",
        "requirement": "可选",
        "source": "自己配置好的图片代理 / CDN",
        "path": "公开仓库没有自建代理时，直接留空",
        "fill": "公开仓库留空使用平台Raw地址；有代理时填其HTTPS根地址。",
        "example": "留空，或 https://img.example.com",
        "mistake": "私有仓库不会自动公开；管理后台网址不是图片域名。",
        "href": "https://github.com/",
        "step": ""
      }
    ]
  },
  "gitee": {
    "title": "Gitee",
    "prepare": "仓库地址、实际分支名、访问令牌；目录可自行决定。",
    "links": [
      {
        "label": "打开仓库平台",
        "href": "https://gitee.com/"
      },
      {
        "label": "创建 / 管理访问令牌",
        "href": "https://gitee.com/profile/personal_access_tokens"
      },
      {
        "label": "创建仓库",
        "href": "https://gitee.com/projects/new"
      }
    ],
    "fields": [
      {
        "label": "显示名称",
        "requirement": "必填",
        "source": "自己命名",
        "path": "在镜云填写，不需要到平台申请",
        "fill": "取一个自己能分辨的连接名称。",
        "example": "我的 Gitee",
        "mistake": "不是账号名，也不会创建存储桶或仓库。",
        "href": "",
        "step": ""
      },
      {
        "label": "用户名 / Owner",
        "requirement": "必填",
        "source": "仓库网址第一段",
        "path": "打开自己的仓库，查看浏览器地址栏",
        "fill": "例如 https://gitee.com/your-name/my-images，填your-name；组织仓库填组织路径。",
        "example": "your-name",
        "mistake": "不要填昵称、邮箱或完整网址。",
        "href": "https://gitee.com/",
        "step": ""
      },
      {
        "label": "仓库名",
        "requirement": "必填",
        "source": "仓库网址第二段",
        "path": "打开仓库，查看地址最后一段",
        "fill": "只填仓库路径名，不含域名和.git。",
        "example": "my-images",
        "mistake": "中文展示名可能与路径不同；以网址为准。",
        "href": "https://gitee.com/",
        "step": ""
      },
      {
        "label": "分支",
        "requirement": "必填",
        "source": "仓库文件列表上方的分支菜单",
        "path": "仓库首页 → 分支下拉菜单",
        "fill": "复制实际存在的分支，区分大小写。",
        "example": "master",
        "mistake": "示例分支不是固定值；空仓库先初始化README。",
        "href": "https://gitee.com/",
        "step": ""
      },
      {
        "label": "资源目录",
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
        "label": "访问令牌",
        "requirement": "必填",
        "source": "私人令牌创建完成后的结果页",
        "path": "创建令牌 → 设置仓库范围与权限 → 生成",
        "fill": "选择仓库读写相关的projects权限；旧界面可能显示project，以权限描述为准。 将生成的完整令牌粘贴到镜云。",
        "example": "粘贴自己的令牌（不提供假密钥）",
        "mistake": "不是登录密码或SSH密钥；过期、撤销或组织未批准都会失败。",
        "href": "https://gitee.com/profile/personal_access_tokens",
        "step": ""
      },
      {
        "label": "自定义公开域名（可选）",
        "requirement": "可选",
        "source": "自己配置好的图片代理 / CDN",
        "path": "公开仓库没有自建代理时，直接留空",
        "fill": "公开仓库留空使用平台Raw地址；有代理时填其HTTPS根地址。",
        "example": "留空，或 https://img.example.com",
        "mistake": "私有仓库不会自动公开；管理后台网址不是图片域名。",
        "href": "https://gitee.com/",
        "step": ""
      }
    ]
  },
  "r2": {
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
  },
  "oss": {
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
  },
  "cos": {
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
  },
  "s3": {
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
  },
  "webdav": {
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
  }
} as const satisfies Record<string, ProviderGuide>

export type ProviderKey = keyof typeof providerGuides
