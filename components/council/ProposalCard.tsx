import Link from 'next/link'
import type { OwlProposalRow } from '@/lib/db/owl-council'
import { StatusBadge } from '@/components/council/StatusBadge'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

type ProposalCardProps = {
  proposal: OwlProposalRow
  voteTotal?: number
}

export function ProposalCard({ proposal, voteTotal }: ProposalCardProps) {
  return (
    <article className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-sm p-4 sm:p-5 flex flex-col gap-3 hover:border-green-500/35 transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-2 gap-y-3">
        <div className="min-w-0 flex-1">
          <StatusBadge proposal={proposal} />
          <h3 className="mt-2 font-semibold text-base sm:text-lg text-foreground leading-snug">
            {proposal.title}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{proposal.summary}</p>
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          <dt className="font-medium text-muted-foreground/80">Starts</dt>
          <dd className="tabular-nums">{formatWhen(proposal.start_time)}</dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground/80">Ends</dt>
          <dd className="tabular-nums">{formatWhen(proposal.end_time)}</dd>
        </div>
      </dl>
      {voteTotal !== undefined && voteTotal > 0 ? (
        <p className="text-xs text-muted-foreground">
          OWL-weight total:{' '}
          <span className="text-foreground font-medium tabular-nums">
            {voteTotal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </span>
        </p>
      ) : null}
      <div className="pt-1 mt-auto">
        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto min-h-[44px] touch-manipulation">
          <Link href={`/council/${encodeURIComponent(proposal.slug)}`} className="inline-flex items-center justify-center gap-2">
            View proposal
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </article>
  )
}
