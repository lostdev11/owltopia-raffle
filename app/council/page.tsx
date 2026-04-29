import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { CouncilHero } from '@/components/council/CouncilHero'
import { CouncilOwlEscrowPanel } from '@/components/council/CouncilOwlEscrowPanel'
import { CouncilVotingExplainer } from '@/components/council/CouncilVotingExplainer'
import { CouncilCreateProposalButton } from '@/components/council/CouncilCreateProposalButton'
import { SectionHeader } from '@/components/council/SectionHeader'
import { EmptyState } from '@/components/council/EmptyState'
import { ProposalCard } from '@/components/council/ProposalCard'
import {
  listPublishedOwlProposals,
  sumVoteTotalsForManyProposals,
  type OwlProposalRow,
} from '@/lib/db/owl-council'
import { getProposalTimeline } from '@/lib/council/proposal-status'
import { PLATFORM_NAME } from '@/lib/site-config'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import { isCouncilOwlEscrowVotingEnabled } from '@/lib/council/council-owl-escrow-keypair'
import { OWL_TICKER } from '@/lib/council/owl-ticker'

export const metadata: Metadata = {
  title: `Owl Council | ${PLATFORM_NAME}`,
  description: `Proposals and votes for Owltopia — ${OWL_TICKER}-weighted voting; new ideas go live after team review.`,
}

export const dynamic = 'force-dynamic'

function segmentPublished(rows: OwlProposalRow[]) {
  const active: OwlProposalRow[] = []
  const upcoming: OwlProposalRow[] = []
  const past: OwlProposalRow[] = []

  for (const p of rows) {
    const t = getProposalTimeline(p)
    if (t === 'active') active.push(p)
    else if (t === 'upcoming') upcoming.push(p)
    else if (t === 'past') past.push(p)
  }

  return { active, upcoming, past }
}

type CouncilPageProps = {
  searchParams?: Promise<{ submitted?: string }>
}

export default async function CouncilPage({ searchParams }: CouncilPageProps) {
  const sp = searchParams ? await searchParams : {}
  const showSubmittedPending = sp.submitted === 'pending'

  const all = await listPublishedOwlProposals('all', { limit: 200 })
  const { active, upcoming, past } = segmentPublished(all)

  const pastIds = past.map((p) => p.id)
  const totalsMap = await sumVoteTotalsForManyProposals(pastIds)

  const cookieStore = await cookies()
  const rawSession = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = parseSessionCookieValue(rawSession)
  const sessionWallet = session?.wallet ?? null
  const councilEscrowVotingEnabled = isCouncilOwlEscrowVotingEnabled()

  return (
    <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 pb-16 max-w-6xl">
      <CouncilHero />

      <div className="relative z-10 min-w-0">
        <CouncilOwlEscrowPanel sessionWallet={sessionWallet} />
      </div>

      <CouncilVotingExplainer escrowVotingEnabled={councilEscrowVotingEnabled} />

      {showSubmittedPending ? (
        <div
          className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
          role="status"
        >
          <p className="font-medium">Proposal submitted for review.</p>
          <p className="text-emerald-200/90 mt-1">
            It will appear on Owl Council after a moderator activates it in Owl Vision (Admin → Owl Council).
          </p>
        </div>
      ) : null}

      <CouncilCreateProposalButton />

      <section id="active-proposals" className="scroll-mt-28">
        <SectionHeader title="Active proposals" description="Voting is open now within the scheduled window." />
        {active.length === 0 ? (
          <EmptyState title="No proposals in voting right now." body="When a vote opens, it will appear here." />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((p) => (
              <li key={p.id}>
                <ProposalCard proposal={p} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 sm:mt-16">
        <SectionHeader title="Upcoming" description="Scheduled votes that have not started yet." />
        {upcoming.length === 0 ? (
          <EmptyState title="Nothing upcoming." />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((p) => (
              <li key={p.id}>
                <ProposalCard proposal={p} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 sm:mt-16">
        <SectionHeader title="Past decisions" description="Closed proposals with final tallies." />
        {past.length === 0 ? (
          <EmptyState title="No completed proposals yet." />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((p) => {
              const t = totalsMap.get(p.id)
              const sum = t ? t.yes + t.no + t.abstain : 0
              return (
                <li key={p.id}>
                  <ProposalCard proposal={p} voteTotal={sum} />
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
