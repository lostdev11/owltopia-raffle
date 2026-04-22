'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import type { OwlProposalRow } from '@/lib/db/owl-council'
import { OWL_TICKER } from '@/lib/council/owl-ticker'
import type { OwlVoteChoice } from '@/lib/council/vote-types'
import { isCouncilVotingOpen } from '@/lib/council/proposal-status'

const HEADER = 'X-Connected-Wallet'

type VotePanelProps = {
  proposal: OwlProposalRow
  slug: string
  sessionWallet: string | null
  initialMyVote: OwlVoteChoice | null
  /** When true, copy explains council OWL voting stake (server env). */
  escrowVotingEnabled?: boolean
}

export function VotePanel({
  proposal,
  slug,
  sessionWallet,
  initialMyVote,
  escrowVotingEnabled = false,
}: VotePanelProps) {
  const router = useRouter()
  const { publicKey, connected, signMessage } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''

  const [myVote, setMyVote] = useState<OwlVoteChoice | null>(initialMyVote)
  const [submitting, setSubmitting] = useState<OwlVoteChoice | null>(null)

  useEffect(() => {
    setMyVote(initialMyVote)
  }, [initialMyVote])
  const [voteError, setVoteError] = useState<string | null>(null)
  const { signIn: handleSignIn, signingIn, error: signInError } = useSiwsSignIn()

  const votingOpen = isCouncilVotingOpen(proposal)
  const sessionMatches = Boolean(sessionWallet && wallet && sessionWallet === wallet)

  const submitVote = useCallback(
    async (choice: OwlVoteChoice) => {
      setVoteError(null)
      setSubmitting(choice)
      try {
        const res = await fetch(`/api/council/proposals/${encodeURIComponent(slug)}/vote`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            [HEADER]: wallet,
          },
          body: JSON.stringify({ vote_choice: choice }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg =
            typeof (data as { error?: string }).error === 'string'
              ? (data as { error: string }).error
              : 'Could not submit vote'
          setVoteError(msg)
          return
        }
        setMyVote(choice)
        router.refresh()
      } catch {
        setVoteError('Network error. Try again.')
      } finally {
        setSubmitting(null)
      }
    },
    [slug, wallet, router]
  )

  if (!connected || !wallet) {
    return (
      <div className="rounded-xl border border-border/70 bg-muted/10 p-4 sm:p-5 space-y-2">
        <p className="text-sm font-medium text-foreground">Connect your wallet</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Use the wallet button in the header to connect, then sign in below to vote.
        </p>
      </div>
    )
  }

  if (!sessionWallet || !sessionMatches) {
    return (
      <div className="rounded-xl border border-border/70 bg-muted/10 p-4 sm:p-5 space-y-3">
        <p className="text-sm font-medium text-foreground">Sign in to vote</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {sessionWallet && sessionWallet !== wallet
            ? 'Your signed-in wallet does not match the connected wallet. Sign in with the wallet you connected.'
            : 'Confirm a one-time sign-in message so we can tie your vote to your wallet (same flow as the dashboard).'}
        </p>
        {signInError ? <p className="text-sm text-destructive">{signInError}</p> : null}
        <Button
          type="button"
          className="min-h-[44px] touch-manipulation w-full sm:w-auto"
          disabled={signingIn || !signMessage}
          onClick={() => void handleSignIn()}
        >
          {signingIn ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />
              Signing…
            </>
          ) : (
            'Sign in with wallet'
          )}
        </Button>
      </div>
    )
  }

  if (myVote) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 sm:p-5">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your ballot is on file. See the{' '}
          <a
            href="#proposal-my-vote"
            className="font-medium text-emerald-100 underline-offset-2 hover:underline touch-manipulation"
          >
            My vote
          </a>{' '}
          section for your choice and weight.
        </p>
      </div>
    )
  }

  if (!votingOpen) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/10 p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">
          Voting is not open for this proposal (check the schedule above).
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-green-500/30 bg-background/60 p-4 sm:p-5 space-y-4">
      <p className="text-sm font-medium text-foreground">Cast your vote</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        One ballot per wallet.
        {escrowVotingEnabled ? (
          <>
            {' '}
            Vote weight equals the {OWL_TICKER} you have credited in{' '}
            <strong className="text-foreground font-medium">voting stake</strong> (use the voting stake panel on this
            page). {OWL_TICKER} stays there for future votes until you withdraw.
          </>
        ) : (
          <>
            {' '}
            Vote weight equals your {OWL_TICKER} balance (cached when possible). Tallies aggregate {OWL_TICKER}-weight across Yes / No /
            Abstain.
          </>
        )}
      </p>
      {voteError ? <p className="text-sm text-destructive">{voteError}</p> : null}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <VoteChoiceButton
          label="Yes"
          onClick={() => void submitVote('yes')}
          loading={submitting === 'yes'}
          disabled={submitting !== null}
        />
        <VoteChoiceButton
          label="No"
          onClick={() => void submitVote('no')}
          loading={submitting === 'no'}
          disabled={submitting !== null}
        />
        <VoteChoiceButton
          label="Abstain"
          variant="outline"
          onClick={() => void submitVote('abstain')}
          loading={submitting === 'abstain'}
          disabled={submitting !== null}
        />
      </div>
    </div>
  )
}

function VoteChoiceButton({
  label,
  onClick,
  loading,
  disabled,
  variant = 'default',
}: {
  label: string
  onClick: () => void
  loading: boolean
  disabled: boolean
  variant?: 'default' | 'outline'
}) {
  return (
    <Button
      type="button"
      variant={variant}
      className="min-h-[48px] touch-manipulation flex-1"
      disabled={disabled}
      onClick={onClick}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : label}
    </Button>
  )
}
