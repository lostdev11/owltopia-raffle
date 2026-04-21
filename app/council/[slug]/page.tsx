import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, parseSessionCookieValue } from '@/lib/auth-server'
import {
  getOwlVoteForWallet,
  getPublishedOwlProposalBySlug,
  sumVoteTotalsForProposal,
} from '@/lib/db/owl-council'
import { ProposalDetailClient } from '@/components/council/ProposalDetailClient'
import { PLATFORM_NAME } from '@/lib/site-config'
import { isCouncilOwlEscrowVotingEnabled } from '@/lib/council/council-owl-escrow-keypair'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const proposal = await getPublishedOwlProposalBySlug(slug)
  if (!proposal) {
    return { title: `Proposal | Owl Council | ${PLATFORM_NAME}` }
  }
  return {
    title: `${proposal.title} | Owl Council`,
    description: proposal.summary,
  }
}

export default async function CouncilProposalPage({ params }: Props) {
  const { slug } = await params
  const proposal = await getPublishedOwlProposalBySlug(slug)
  if (!proposal) notFound()

  const voteTotals = await sumVoteTotalsForProposal(proposal.id)

  const cookieStore = await cookies()
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const session = parseSessionCookieValue(raw)
  const sessionWallet = session?.wallet ?? null

  const initialMyVote =
    sessionWallet ? await getOwlVoteForWallet(proposal.id, sessionWallet) : null

  return (
    <ProposalDetailClient
      proposal={proposal}
      voteTotals={voteTotals}
      sessionWallet={sessionWallet}
      initialMyVote={initialMyVote}
      councilEscrowVotingEnabled={isCouncilOwlEscrowVotingEnabled()}
    />
  )
}
