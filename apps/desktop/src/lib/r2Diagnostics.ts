/** Deterministic, offline-only R2 setup checks. Never include credentials in a verdict. */
export interface R2SetupSnapshot {
  name: string
  accountId: string
  bucket: string
  region: string
  accessMode: 'public' | 'private_requested'
  publicBaseUrl: string
  accessKeyId: string
  secretAccessKey: string
}

export interface R2SetupIssue {
  field: 'name' | 'accountId' | 'bucket' | 'region' | 'accessMode' | 'publicBaseUrl' | 'accessKeyId' | 'secretAccessKey'
  message: string
  step: 0 | 1 | 2
}

const ACCOUNT_ID = /^[a-f0-9]{32}$/i
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

export function r2EndpointPreview(accountId: string): string | null {
  if (!ACCOUNT_ID.test(accountId.trim())) return null
  return `https://${accountId.trim().toLowerCase()}.r2.cloudflarestorage.com`
}

export function validateR2Setup(input: R2SetupSnapshot): R2SetupIssue[] {
  const issues: R2SetupIssue[] = []
  const add = (field: R2SetupIssue['field'], message: string, step: R2SetupIssue['step']) =>
    issues.push({ field, message, step })
  if (!input.name.trim()) add('name', '请输入连接名称。', 0)
  if (!BUCKET.test(input.bucket.trim())) {
    add('bucket', '桶名需为 3–63 个小写字母、数字或连字符，首尾不能是连字符。', 0)
  }
  if (!ACCOUNT_ID.test(input.accountId.trim())) {
    add('accountId', '请从 Cloudflare R2 控制台复制 32 位十六进制 Account ID；不是邮箱或 API Token。', 0)
  }
  // The existing Rust R2 provider hardcodes the default-jurisdiction endpoint; do not
  // claim EU/US/FedRAMP works simply because the frontend can construct those URLs.
  if (input.region.trim().toLowerCase() !== 'auto') {
    add('region', '当前镜云 R2 连接只支持默认辖区与 Region auto；EU、US、FedRAMP 专用 Endpoint 尚未实现。', 0)
  }
  if (input.accessMode === 'public') {
    let url: URL | null = null
    try { url = new URL(input.publicBaseUrl.trim()) } catch { /* missing/invalid URL */ }
    if (!url || !['https:', 'http:'].includes(url.protocol) || !url.hostname ||
        input.publicBaseUrl.includes('?') || input.publicBaseUrl.includes('#') ||
        url.username || url.password) {
      add('publicBaseUrl', '公开模式需要有效的 http(s) 访问地址，不能包含账号、查询串或片段。', 1)
    } else if (url.hostname.toLowerCase().endsWith('.r2.cloudflarestorage.com')) {
      add('publicBaseUrl', 'R2 的 S3 API Endpoint 不是公开图片地址。请填写已启用的自定义域名或公开访问地址。', 1)
    }
  } else if (input.publicBaseUrl.trim()) {
    add('publicBaseUrl', '私有模式请清空公开访问地址；这仍不能证明桶已经关闭匿名访问。', 1)
  }
  if (!input.accessKeyId.trim()) add('accessKeyId', '请输入 R2 的 Access Key ID，而不是普通 API Token。', 2)
  if (!input.secretAccessKey.trim()) add('secretAccessKey', '请输入对应的 Secret Access Key。', 2)
  return issues
}

export type R2FailureKind = 'bucket' | 'permission' | 'signature' | 'endpoint' | 'network' | 'unknown'
export interface R2SafeDiagnosis { kind: R2FailureKind; title: string; checks: string[] }

/**
 * Raw provider errors can embed keys, signed URLs, or request identifiers.
 * Match only known signals and emit constants. Never echo the original error.
 */
export function diagnoseR2Failure(error: unknown): R2SafeDiagnosis {
  const message = String(error).toLowerCase()
  if (/nosuchbucket|invalidbucketname|bucket.not.found|no such bucket/.test(message)) return {
    kind: 'bucket', title: '无法找到存储桶；请确认桶名、账号与辖区。',
    checks: ['对照控制台复制 Bucket 名称。', '确认桶属于输入的 Account ID。', '默认辖区以外的桶暂不支持在此向导中连接。'],
  }
  if (/signaturedoesnotmatch|invalidaccesskeyid|invalid.signature|signature mismatch/.test(message)) return {
    kind: 'signature', title: '身份签名未通过；请重新核对 R2 密钥。',
    checks: ['使用 R2 生成的 Access Key ID 和 Secret Access Key。', '确认凭据对应同一个账号，重新签发后再试。', '检查系统时间是否正确。'],
  }
  if (/accessdenied|unauthoriz|forbidden|permission|403\b|401\b/.test(message)) return {
    kind: 'permission', title: '访问受到拒绝，可能是权限或凭据范围问题。',
    checks: ['确认 Token 被授权到目标 Bucket。', '发布用途需要对象读写权限，请勿为排错扩大到管理员权限。', '读权限通过不等于写权限通过。'],
  }
  if (/endpoint|dns|tls|certificate|hostname|name resolution/.test(message)) return {
    kind: 'endpoint', title: '无法正确访问 R2 服务地址。',
    checks: ['核对 Account ID 是否来自当前账号。', '检查代理、HTTPS/TLS 与网络环境。', '如桶位于 EU/US 等专用辖区，请勿用默认 Endpoint 测试。'],
  }
  if (/timeout|timed out|network|connection refused|connect error/.test(message)) return {
    kind: 'network', title: '网络连接未完成，暂时无法确定凭据是否有效。',
    checks: ['检查网络与代理后重试。', '不要连续提交或重复创建连接。'],
  }
  return {
    kind: 'unknown', title: '远端测试未完成，尚不能确定原因。',
    checks: ['请先核对 Bucket、Account ID 和凭据。', '不要把连接失败视为权限或私有状态已经验证。', '如果需要提交诊断信息，请先移除所有密钥、链接和签名参数。'],
  }
}
