import type { ProbeFailureKindName } from './desktop'

/**
 * §18B: the words a failed reconciliation probe is shown with.
 *
 * Same discipline as confirmationDisplay.ts (see that file's header): the classification itself is
 * hardcoded in Rust (`domain::ProbeFailureKind`), this module only decides how each kind reads on
 * screen, and it stays a pure function so `verify_probe_display.mjs` can prove the four buckets are
 * present, distinct, and never silent - without mounting SettingsPage in a browser.
 */

export interface ProbeDisplay {
  chipClass: string
  label: string
  /** What the user should do next; always non-empty, because an unnamed failure is undiagnosable. */
  hint: string
}

const PROBE_VIEWS: Record<ProbeFailureKindName, ProbeDisplay> = {
  network_timeout: {
    chipClass: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    label: '网络超时',
    hint: '没有收到答复（连接/超时/上游 5xx），稍后重试即可，不需要改配置',
  },
  auth_failed: {
    chipClass: 'bg-red-50 text-red-600 ring-1 ring-red-200',
    label: '认证失败',
    hint: '凭证或权限问题：请检查 Token 与授权范围',
  },
  rejected: {
    chipClass: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    label: '其他拒绝',
    hint: '服务端拒绝：请看下方原始错误信息',
  },
  unavailable: {
    chipClass: 'bg-slate-100 text-slate-500 ring-1 ring-slate-200',
    label: '未能尝试',
    hint: '该云端未启用或凭据读不出，本轮没有发出任何请求',
  },
}

export function probeDisplay(kind: ProbeFailureKindName | null | undefined): ProbeDisplay | null {
  if (!kind) return null
  // An unrecognised kind from a future backend must not render nothing: land it on `rejected`,
  // whose hint says "read the raw message", which stays correct for any unknown failure.
  return PROBE_VIEWS[kind] ?? PROBE_VIEWS.rejected
}
