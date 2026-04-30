'use client'

import { useEffect, useState } from 'react'
import { Gift } from 'lucide-react'
import {
  clearReferralComplimentarySessionCache,
  fetchReferralComplimentarySessionOnce,
} from '@/lib/referrals/complimentary-session-client'

export { clearReferralComplimentarySessionCache }

type ReferralComplimentaryHintProps = {
  /**
   * Parent gates: live raffle, purchases allowed, first confirmed entry on this raffle, etc.
   * Server still requires a valid referral cookie + env flags; optional wallet excludes users
   * who already redeemed their one global free ticket.
   */
  show: boolean
  /** Connected wallet (base58); improves copy when we can hide the banner after the one free use. */
  walletAddress?: string | null
  className?: string
  /** Tighter copy for list cards; slightly more detail in the enter-raffle dialog. */
  variant?: 'compact' | 'dialog'
}

export function ReferralComplimentaryHint({
  show,
  walletAddress,
  className = '',
  variant = 'compact',
}: ReferralComplimentaryHintProps) {
  const [serverShow, setServerShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchReferralComplimentarySessionOnce(walletAddress).then(({ show: s }) => {
      if (!cancelled) setServerShow(s)
    })
    return () => {
      cancelled = true
    }
  }, [walletAddress])

  if (!show || !serverShow) return null

  const copy =
    variant === 'dialog'
      ? 'Referral link detected. You get one free ticket ever across Owl — use it on this raffle if you want. Choose exactly 1 ticket; checkout may skip payment. Same browser or in-app session as the invite link (important on mobile).'
      : 'Referral link: one free ticket ever for your wallet. Buy exactly 1 ticket here to use it — same browser or app session as the link.'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 text-left text-xs leading-snug text-foreground touch-manipulation sm:text-sm sm:leading-snug ${className}`}
    >
      <Gift className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <span>{copy}</span>
    </div>
  )
}
