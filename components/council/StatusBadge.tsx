import { Badge } from '@/components/ui/badge'
import type { OwlProposalRow } from '@/lib/db/owl-council'
import { getProposalTimeline } from '@/lib/council/proposal-status'

export function StatusBadge({ proposal }: { proposal: OwlProposalRow }) {
  const t = getProposalTimeline(proposal)
  const label =
    proposal.status === 'draft'
      ? 'Draft'
      : t === 'upcoming'
        ? 'Upcoming'
        : t === 'active'
          ? 'Voting live'
          : proposal.status === 'archived'
            ? 'Archived'
            : proposal.status === 'ended'
              ? 'Ended'
              : 'Closed'

  const variantClass =
    t === 'active'
      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
      : t === 'upcoming'
        ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
        : proposal.status === 'draft'
          ? 'border-muted-foreground/40 bg-muted/30 text-muted-foreground'
          : 'border-border/70 bg-muted/20 text-muted-foreground'

  return (
    <Badge variant="outline" className={`font-normal ${variantClass}`}>
      {label}
    </Badge>
  )
}
