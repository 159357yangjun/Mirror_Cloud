import type { ProviderGuide } from './types'

export const githubGuide = {
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
} as const satisfies ProviderGuide
