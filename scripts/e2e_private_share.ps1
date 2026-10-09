# R2/S3 临时分享真实 E2E（仅 Windows、本机手动执行）
# 不向终端、测试产物或 CI 输出签名 URL。脚本只读取剪贴板内的链接，不读取凭据。
# Windows PowerShell 5.1+ / PowerShell 7+。不建议在录屏、Transcript 或屏幕共享中运行。
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
    [string]$ExpectedFile,

    # 至少提供 S3 API 匿名对象地址；若配置了公开域名，必须额外提供它对应的对象地址。
    [Parameter(Mandatory = $true)]
    [ValidateCount(1, 16)]
    [string[]]$AnonymousUrls,

    [ValidateSet(600, 3600, 86400)]
    [int]$ExpiresInSeconds = 600,

    [switch]$CheckExpiration,

    # 默认读入后清空系统剪贴板；Windows 剪贴板历史/云同步不能通过此操作可靠清除。
    [switch]$KeepClipboard
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Net.Http

function Assert-Https([string]$Value) {
    $parsed = $null
    if (-not [System.Uri]::TryCreate($Value, [System.UriKind]::Absolute, [ref]$parsed) -or
        $parsed.Scheme -ne 'https' -or
        -not [string]::IsNullOrWhiteSpace($parsed.UserInfo)) {
        throw '仅允许无嵌入凭据的 HTTPS URL。'
    }
}

function Get-Anonymous([System.Net.Http.HttpClient]$Client, [string]$Url) {
    # HttpClient 不携带 Authorization 和 Cookie；仅以 URL 本身进行 GET。
    try {
        return $Client.GetAsync($Url).GetAwaiter().GetResult()
    }
    catch {
        # .NET 异常有时包含完整带签名查询参数的 URL；绝不回显异常文本。
        throw 'HTTPS 请求失败，未输出原始错误详情或 URL。'
    }
}

$signedUrl = ''
try {
    $signedUrl = (Get-Clipboard -Raw).Trim()
    Assert-Https $signedUrl
    if ($signedUrl -notmatch 'X-Amz-(Algorithm|Signature)=') {
        throw '剪贴板中不是预期的 S3/R2 预签名 URL。'
    }
}
finally {
    if (-not $KeepClipboard) {
        Set-Clipboard -Value ''
    }
}

$expectedHash = (Get-FileHash -LiteralPath $ExpectedFile -Algorithm SHA256).Hash.ToLowerInvariant()
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(45)

try {
    for ($i = 0; $i -lt $AnonymousUrls.Count; $i++) {
        Assert-Https $AnonymousUrls[$i]
        $response = Get-Anonymous $client $AnonymousUrls[$i]
        try {
            Write-Host ("anonymous[{0}]: HTTP {1}" -f ($i + 1), [int]$response.StatusCode)
            if ($response.IsSuccessStatusCode) {
                throw ('FAIL: anonymous[{0}] 可以在无签名情况下直接访问，该对象不满足私有访问前提。' -f ($i + 1))
            }
        }
        finally {
            $response.Dispose()
        }
    }

    $response = Get-Anonymous $client $signedUrl
    try {
        if (-not $response.IsSuccessStatusCode) {
            throw ('FAIL: 签名 GET 返回 HTTP {0}；未输出 URL。' -f [int]$response.StatusCode)
        }
        $body = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $actualHash = [System.BitConverter]::ToString($sha.ComputeHash($body)).Replace('-', '').ToLowerInvariant()
        }
        finally {
            $sha.Dispose()
        }
        if ($actualHash -ne $expectedHash) {
            throw 'FAIL: 签名 GET 内容 SHA256 与上传源文件不一致。'
        }
        Write-Host 'PASS: 无额外凭据的签名 GET 成功，内容 SHA256 匹配。'
    }
    finally {
        $response.Dispose()
    }

    if ($CheckExpiration) {
        # 计时从运行脚本开始，因此必晚于签名实际签发时间；额外留 30 秒时钟偏移余量。
        Write-Host ("待有效期 {0} 秒与 30 秒余量结束后，检查过期拒绝。" -f $ExpiresInSeconds)
        Start-Sleep -Seconds ($ExpiresInSeconds + 30)
        $response = Get-Anonymous $client $signedUrl
        try {
            Write-Host ("expired: HTTP {0}" -f [int]$response.StatusCode)
            if ($response.IsSuccessStatusCode) {
                throw 'FAIL: 过期后原签名 GET 仍可成功读取；需调查缓存或签名实现。'
            }
            Write-Host 'PASS: 原签名链接到期后已被拒绝。'
        }
        finally {
            $response.Dispose()
        }
    }
    else {
        Write-Host 'NOT VERIFIED: 未执行到期检查；加 -CheckExpiration 才能验收完整 E2E。'
    }
}
finally {
    $client.Dispose()
    $signedUrl = ''
}
