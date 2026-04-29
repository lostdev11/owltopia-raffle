'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'
import { Button } from '@/components/ui/button'
import { Loader2, PlusCircle } from 'lucide-react'
import { MIN_OWL_TO_CREATE_PROPOSAL } from '@/lib/council/owl-proposal-rules'
import { OWL_TICKER } from '@/lib/council/owl-ticker'

/**
 * Uses 7-day cached OWL snapshot via GET /api/council/owl-eligibility (refreshes when stale).
 * Creating a proposal runs a server OWL gate; moderators activate proposals in admin.
 */
export function CouncilCreateProposalButton() {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const [eligible, setEligible] = useState<boolean | null>(null)
  const [owlConfigured, setOwlConfigured] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!wallet) {
      setEligible(null)
      setOwlConfigured(true)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/council/owl-eligibility?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' })
      .then((res) => res.json().catch(() => ({})))
      .then((data: {
        owlConfigured?: boolean
        eligible?: boolean
      }) => {
        if (cancelled) return
        if (data.owlConfigured === false) {
          setOwlConfigured(false)
          setEligible(false)
          return
        }
        setOwlConfigured(true)
        setEligible(Boolean(data.eligible))
      })
      .catch(() => {
        if (!cancelled) {
          setEligible(false)
          setOwlConfigured(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [wallet])

  const lit =
    connected &&
    owlConfigured &&
    eligible === true &&
    !loading

  const hint = !connected
    ? `Connect a wallet to check the ${MIN_OWL_TO_CREATE_PROPOSAL} ${OWL_TICKER} requirement (snapshot refreshes about every 7 days).`
    : loading
      ? `Checking ${OWL_TICKER} balance snapshot…`
      : !owlConfigured
        ? `${OWL_TICKER} is not configured on this deployment.`
        : eligible === false
          ? `You need at least ${MIN_OWL_TO_CREATE_PROPOSAL} ${OWL_TICKER} to create a proposal (last snapshot may be up to 7 days old).`
          : `Create a proposal (10+ ${OWL_TICKER} and sign-in required on the next page).`

  return (
    <div className="flex flex-col items-center gap-3 mb-10 sm:mb-12 max-w-lg mx-auto text-center px-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {lit ? (
          <Button
            asChild
            size="lg"
            className="min-h-[48px] touch-manipulation border border-emerald-400/60 bg-emerald-500/20 text-emerald-50 hover:bg-emerald-500/35 shadow-[0_0_24px_rgba(16,185,129,0.28)] hover:shadow-[0_0_28px_rgba(16,185,129,0.4)] transition-shadow"
          >
            <Link href="/council/create" className="inline-flex items-center gap-2">
              <PlusCircle className="h-5 w-5 shrink-0" aria-hidden />
              Create proposal
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            disabled
            variant="secondary"
            className="min-h-[48px] touch-manipulation opacity-70 grayscale-[0.35] cursor-not-allowed border border-border/80 bg-muted/40 text-muted-foreground"
          >
            <PlusCircle className="h-5 w-5 shrink-0 mr-2 opacity-70" aria-hidden />
            Create proposal
          </Button>
        )}
        {loading && connected ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>
    </div>
  )
}
