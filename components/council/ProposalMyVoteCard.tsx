'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Landmark } from 'lucide-react'
import type { OwlMyVoteRecord, OwlProposalRow } from '@/lib/db/owl-council'
import { OWL_TICKER } from '@/lib/council/owl-ticker'
import { isCouncilVotingOpen } from '@/lib/council/proposal-status'

export type ProposalMyVoteCardProps = {
  proposal: OwlProposalRow
  sessionWallet: string | null
  initialRecord: OwlMyVoteRecord | null
  councilEscrowVotingEnabled: boolean
}

export function ProposalMyVoteCard({
  proposal,
  sessionWallet,
  initialRecord,
  councilEscrowVotingEnabled,
}: ProposalMyVoteCardProps) {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''
  const sessionMatches = Boolean(sessionWallet && wallet && sessionWallet === wallet)

  const [record, setRecord] = useState<OwlMyVoteRecord | null>(initialRecord)

  useEffect(() => {
    setRecord(initialRecord)
  }, [initialRecord])

  const votingOpen = isCouncilVotingOpen(proposal)

  return (
    <section
      id="proposal-my-vote"
      aria-labelledby="proposal-my-vote-heading"
      className="mt-6 scroll-mt-24 rounded-xl border border-emerald-500/25 bg-[linear-gradient(165deg,rgba(8,22,14,0.85),rgba(4,14,10,0.92))] p-4 sm:p-5 shadow-[0_4px_28px_rgba(0,0,0,0.28)]"
    >
      <div className="flex items-start gap-2">
        <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-theme-prime/90" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2
            id="proposal-my-vote-heading"
            className="text-sm font-semibold uppercase tracking-wider text-theme-prime drop-shadow-[0_0_8px_rgba(0,255,136,0.35)]"
          >
            My vote
          </h2>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Your ballot on this proposal (same wallet as sign-in).
          </p>
        </div>
      </div>

      <div className="mt-4">
        {!connected || !wallet ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Connect your wallet to see whether you have voted and your vote weight.
          </p>
        ) : !sessionWallet || !sessionMatches ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {sessionWallet && sessionWallet !== wallet
              ? 'Switch to the wallet you signed in with, or sign in again, to load your vote for this proposal.'
              : 'Sign in with your wallet (one-time message) to view your vote status.'}
          </p>
        ) : record ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Choice</span>
              <span className="text-xl font-semibold capitalize tabular-nums text-emerald-100">{record.voteChoice}</span>
            </div>
            <div className="rounded-lg border border-emerald-500/15 bg-black/25 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Vote weight</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                {record.votingPowerDecimal} {OWL_TICKER}
              </p>
              {councilEscrowVotingEnabled && record.councilVoteUsedEscrow ? (
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Weight came from your council voting stake for this ballot; that amount stays non-withdrawable until this
                  proposal&apos;s voting window ends.
                </p>
              ) : councilEscrowVotingEnabled ? (
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Weight used your OWL balance per site rules when you voted (not drawn from voting stake for this ballot).
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  OWL-weighted ballot; totals use the same weight units as the results chart above.
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Votes cannot be changed in MVP.</p>
          </div>
        ) : votingOpen ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground/95">You have not voted on this proposal yet.</p>
            <Link
              href="#vote-heading"
              className="inline-flex min-h-[44px] items-center text-sm font-medium text-emerald-200 underline-offset-2 hover:underline touch-manipulation"
            >
              Go to voting →
            </Link>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            You did not cast a ballot before voting closed for this proposal.
          </p>
        )}
      </div>
    </section>
  )
}
