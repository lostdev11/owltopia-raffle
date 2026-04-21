'use client'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import type { OwlProposalRow, OwlVoteTotals } from '@/lib/db/owl-council'
import type { OwlVoteChoice } from '@/lib/council/vote-types'
import { MarkdownContent } from '@/components/MarkdownContent'
import { StatusBadge } from '@/components/council/StatusBadge'
import { CountdownBlock } from '@/components/council/CountdownBlock'
import { ResultsBar } from '@/components/council/ResultsBar'
import { CouncilOwlEscrowPanel } from '@/components/council/CouncilOwlEscrowPanel'
import { VotePanel } from '@/components/council/VotePanel'
import { isCouncilVotingOpen } from '@/lib/council/proposal-status'

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

type ProposalDetailClientProps = {
  proposal: OwlProposalRow
  voteTotals: OwlVoteTotals
  sessionWallet: string | null
  initialMyVote: OwlVoteChoice | null
  councilEscrowVotingEnabled: boolean
}

export function ProposalDetailClient({
  proposal,
  voteTotals,
  sessionWallet,
  initialMyVote,
  councilEscrowVotingEnabled,
}: ProposalDetailClientProps) {
  const votingOpen = isCouncilVotingOpen(proposal)
  const showCountdown = votingOpen

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 max-w-3xl">
      <Link
        href="/council"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground touch-manipulation min-h-[44px] py-2"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Back to Owl Council
      </Link>

      <div className="mt-4">
        <CouncilOwlEscrowPanel sessionWallet={sessionWallet} />
      </div>

      <header className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge proposal={proposal} />
        </div>
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl tracking-wide text-foreground">
          {proposal.title}
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{proposal.summary}</p>
        <p className="text-xs sm:text-sm text-muted-foreground/90">
          <span className="text-muted-foreground/80">Window: </span>
          {formatWhen(proposal.start_time)} — {formatWhen(proposal.end_time)}
        </p>
      </header>

      {showCountdown ? <div className="mt-6">
        <CountdownBlock endTimeIso={proposal.end_time} />
      </div> : null}

      <section className="mt-8 space-y-3" aria-labelledby="desc-heading">
        <h2 id="desc-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Description
        </h2>
        <div className="rounded-xl border border-border/60 bg-card/30 p-4 sm:p-5 text-sm leading-relaxed">
          <MarkdownContent content={proposal.description} />
        </div>
      </section>

      <section className="mt-8 space-y-3" aria-labelledby="results-heading">
        <h2 id="results-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {votingOpen ? 'Tallies (OWL-weighted, live)' : 'Results (OWL-weighted)'}
        </h2>
        <div className="rounded-xl border border-border/60 bg-card/30 p-4 sm:p-5">
          <ResultsBar totals={voteTotals} />
        </div>
      </section>

      <section className="mt-8 space-y-3" aria-labelledby="vote-heading">
        <h2 id="vote-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Voting
        </h2>
        <VotePanel
          proposal={proposal}
          slug={proposal.slug}
          sessionWallet={sessionWallet}
          initialMyVote={initialMyVote}
          escrowVotingEnabled={councilEscrowVotingEnabled}
        />
      </section>
    </div>
  )
}
