import type { ConfirmationTierName, TierStrengthName } from './desktop'

/**
 * How much colour a confirmation level deserves, and why the row stops where it does.
 *
 * Kept out of the page component because the panel is one of four places this ladder will be shown,
 * and a chip whose colour is decided inline cannot be tested without mounting a page in a browser.
 * Here it is a function over values: three levels in, three verdicts out, asserted by `node
 * scripts/verify_confirmation_display.mjs`.
 */

export interface TierDisplay {
  /** Existing Tailwind classes only; no new colour token is introduced by this feature. */
  chipClass: string
  label: string
  strength: TierStrengthName
}

const STRONG_CHIP = 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
const WEAK_CHIP = 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
const UNCONFIRMED_CHIP = 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'

const TIER_LABELS: Record<ConfirmationTierName, string> = {
  unknown: '未核对',
  uploaded: '已上传',
  remote_observed: '远端可见',
  content_verified: '内容一致',
  publicly_reachable: '公开可达',
}

/** The three buckets the colour encodes, in the user's words. */
const STRENGTH_BY_TIER: Record<ConfirmationTierName, TierStrengthName> = {
  unknown: 'unconfirmed',
  uploaded: 'weak',
  remote_observed: 'weak',
  content_verified: 'strong',
  publicly_reachable: 'strong',
}

export function tierDisplay(tier: ConfirmationTierName | null): TierDisplay | null {
  if (!tier) return null
  const strength = STRENGTH_BY_TIER[tier] ?? 'unconfirmed'
  const chipClass =
    strength === 'strong' ? STRONG_CHIP : strength === 'weak' ? WEAK_CHIP : UNCONFIRMED_CHIP
  return { chipClass, label: TIER_LABELS[tier] ?? TIER_LABELS.unknown, strength }
}

/**
 * Why a row sits at its level.
 *
 * Falls back to the strength-level explanation when the backend sent no reason, which happens for
 * rows written before the reason existed. Never renders an empty string: a blank cell next to a
 * coloured chip reads as "nothing wrong here", which is the opposite of unconfirmed.
 */
export function tierReason(
  entry: { missingEvidence?: string | null; strength?: TierStrengthName | null },
): string {
  if (entry.missingEvidence) return entry.missingEvidence
  if (entry.strength === 'strong') return '内容与预期比对过并一致'
  if (entry.strength === 'weak') return '还没有做过内容比对'
  return '没有任何记录可依据'
}
