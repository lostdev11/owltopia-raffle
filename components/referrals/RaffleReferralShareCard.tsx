'use client'

import Link from 'next/link'
import { Share2 } from 'lucide-react'
import { ReferralCodeCopyRow } from '@/components/referrals/ReferralCodeCopyRow'

type Props = {
  slug: string
  referralCode: string | null
  hasSession: boolean
  variant?: 'default' | 'compact'
}

export function RaffleReferralShareCard({
  slug,
  referralCode,
  hasSession,
  variant = 'default',
}: Props) {
  const referralHref =
    typeof window !== 'undefined' && referralCode
      ? `${window.location.origin}/raffles/${encodeURIComponent(slug)}?ref=${encodeURIComponent(referralCode)}`
      : referralCode
        ? `/raffles/${slug}?ref=${referralCode}`
        : ''

  const isCompact = variant === 'compact'

  if (isCompact) {
    return (
      <div className="w-full rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] px-3 py-3 sm:px-4">
        <div className="flex items-start gap-2">
          <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-sm font-semibold leading-tight">Share referral link</p>
              <p className="text-[11px] text-muted-foreground sm:text-xs">
                SOL/USDC raffles · credit when others buy with your link
              </p>
            </div>

            {referralCode && referralHref ? (
              <ReferralCodeCopyRow
                code={referralCode}
                copyValue={referralHref}
                displayPrefix="?ref="
                copyLabel="Copy link"
              />
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {hasSession ? (
                  <>
                    Get your code in the{' '}
                    <Link href="/dashboard" className="text-primary underline touch-manipulation">
                      dashboard
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    <Link href="/dashboard" className="text-primary underline touch-manipulation">
                      Sign in
                    </Link>{' '}
                    to get your referral code.
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-2">
        <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
        <div>
          <p className="text-base font-semibold">Share referral link</p>
          <p className="text-sm text-muted-foreground">
            Track who helps sell tickets for this raffle. SOL/USDC raffles only.
          </p>
        </div>
      </div>

      {referralCode && referralHref ? (
        <ReferralCodeCopyRow
          code={referralCode}
          copyValue={referralHref}
          displayPrefix="?ref="
          copyLabel="Copy link"
        />
      ) : (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {hasSession ? (
            <>
              Open your{' '}
              <Link href="/dashboard" className="text-primary underline touch-manipulation">
                dashboard
              </Link>{' '}
              to get a referral code.
            </>
          ) : (
            <>
              <Link href="/dashboard" className="text-primary underline touch-manipulation">
                Sign in
              </Link>{' '}
              to get your referral code.
            </>
          )}
        </p>
      )}
    </div>
  )
}
