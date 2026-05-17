'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { RewardRateUnit, StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { PositionNestRow } from '@/components/nesting/PositionCard'
import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import { nestGalleryAnchorId } from '@/components/nesting/StakedNftNestGallery'
import { isOpeningNftNestAbortable } from '@/lib/nesting/position-lifecycle'
import type { NestingTxPhase } from '@/lib/nesting/tx-states'
import { estimateClaimableRewards, hasClaimableRewardBalance } from '@/lib/staking/rewards'
import { cn } from '@/lib/utils'

type Props = {
  pool: StakingPoolRow
  poolName: string
  positions: StakingPositionRow[]
  nestingWalletMintHints: Map<string, { name: string | null; image: string | null }>
  onUnstake: (positionId: string) => Promise<void>
  onClaim: (positionId: string, amount: number) => Promise<void>
  posPhases: Record<string, { claim: NestingTxPhase; unstake: NestingTxPhase }>
  freezeRequired: boolean
  actionsEnabled: boolean
  securityAckRequired?: boolean
  nestingPaused: boolean
  onResumeOpening?: (position: StakingPositionRow) => void
}

const COLLAPSED_THUMB_MAX = 5

export function NftPerchGroupedNestCard({
  pool,
  poolName,
  positions,
  nestingWalletMintHints,
  onUnstake,
  onClaim,
  posPhases,
  freezeRequired,
  actionsEnabled,
  securityAckRequired = false,
  nestingPaused,
  onResumeOpening,
}: Props) {
  const pending = positions.filter((p) => p.status === 'pending').length
  const needsWalletLock = positions.filter(
    (p) =>
      freezeRequired &&
      Boolean(p.asset_identifier?.trim()) &&
      !p.external_reference?.startsWith('nft_freeze_confirmed:')
  ).length
  const needsAttention = pending > 0 || needsWalletLock > 0

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const claimSummary = useMemo(() => {
    let totalClaimable = 0
    let claimableCount = 0
    for (const pos of positions) {
      if (pos.status !== 'active') continue
      if ((pos.reward_token_snapshot ?? '').trim().toUpperCase() !== 'OWL') continue
      const claimable = estimateClaimableRewards({
        amount: Number(pos.amount),
        rewardRateSnapshot: Number(pos.reward_rate_snapshot),
        rewardRateUnitSnapshot: pos.reward_rate_unit_snapshot as RewardRateUnit,
        claimedRewards: Number(pos.claimed_rewards),
        stakedAtMs: new Date(pos.staked_at).getTime(),
        asOfMs: nowMs,
      })
      if (hasClaimableRewardBalance(claimable)) {
        totalClaimable += claimable
        claimableCount += 1
      }
    }
    return { totalClaimable, claimableCount }
  }, [positions, nowMs])

  const [expanded, setExpanded] = useState(() => needsAttention)

  useEffect(() => {
    if (needsAttention) setExpanded(true)
  }, [needsAttention])

  const headerStatus =
    pending > 0 && needsWalletLock > 0
      ? `${needsWalletLock} opening — finish wallet lock`
      : pending > 0
        ? 'Opening…'
        : 'Nesting'

  const headerStatusClass = pending > 0 ? 'text-amber-400' : 'text-emerald-400'

  const contentId = `perch-group-${pool.id}`
  const collapsedSummaryParts: string[] = [
    `${positions.length} coin${positions.length === 1 ? '' : 's'}`,
  ]
  if (claimSummary.claimableCount > 0) {
    collapsedSummaryParts.push(
      `${claimSummary.totalClaimable.toLocaleString(undefined, { maximumFractionDigits: 6 })} OWL ready`
    )
  }
  if (needsWalletLock > 0) {
    collapsedSummaryParts.push(
      needsWalletLock === positions.length ? 'wallet lock needed' : `${needsWalletLock} need wallet lock`
    )
  } else if (pending > 0) {
    collapsedSummaryParts.push('opening')
  }

  const visibleThumbs = positions
    .map((p) => p.asset_identifier?.trim() ?? '')
    .filter(Boolean)
    .slice(0, COLLAPSED_THUMB_MAX)
  const extraThumbCount = Math.max(0, positions.length - visibleThumbs.length)

  return (
    <Card className="rounded-xl border-border/60 bg-card/90">
      <CardHeader className="pb-2">
        <button
          type="button"
          className={cn(
            'flex w-full min-h-[44px] touch-manipulation items-start justify-between gap-3 rounded-lg text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-prime/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
          )}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="sr-only">
            {expanded ? 'Collapse' : 'Expand'} {poolName} nests
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle className="text-base font-display text-theme-prime">{poolName}</CardTitle>
            <CardDescription className="text-xs text-muted-foreground leading-relaxed">
              {expanded
                ? `${positions.length} Owltopia coin${positions.length === 1 ? '' : 's'} on this perch — claim or leave each row below.`
                : collapsedSummaryParts.join(' · ')}
            </CardDescription>
            {!expanded && visibleThumbs.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-1" aria-hidden>
                {visibleThumbs.map((mint) => {
                  const hint = nestingWalletMintHints.get(mint)
                  return (
                    <NestingStakedAssetThumb
                      key={mint}
                      mint={mint}
                      hintImageUrl={hint?.image}
                      hintName={hint?.name}
                      size="sm"
                      className="!h-10 !w-10 !min-h-10 !min-w-10 rounded-md ring-1 ring-border/50"
                    />
                  )
                })}
                {extraThumbCount > 0 ? (
                  <span className="flex h-10 min-w-[2.5rem] items-center justify-center rounded-md bg-muted/40 px-2 text-[11px] font-medium text-muted-foreground ring-1 ring-border/50">
                    +{extraThumbCount}
                  </span>
                ) : null}
              </div>
            ) : null}
            {expanded && needsWalletLock > 0 ? (
              <p className="text-xs text-amber-300/95 leading-relaxed pt-0.5">
                {needsWalletLock === positions.length
                  ? 'Each row still needs the wallet lock: select the matching coin in the nest form above, then tap Confirm nest — your wallet may ask once per coin (Backpack, etc.).'
                  : `${needsWalletLock} still need the wallet lock — use Confirm nest above for each coin that shows Opening.`}
              </p>
            ) : null}
            {!expanded && needsWalletLock > 0 ? (
              <p className="text-xs text-amber-300/95 leading-relaxed pt-0.5">
                Expand to finish wallet lock on{' '}
                {needsWalletLock === positions.length ? 'each coin' : `${needsWalletLock} coin(s)`}.
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className={`text-xs font-medium uppercase tracking-wide ${headerStatusClass}`}>
              {headerStatus}
            </span>
            <ChevronDown
              className={cn(
                'h-5 w-5 text-muted-foreground transition-transform duration-200',
                expanded && 'rotate-180'
              )}
              aria-hidden
            />
          </div>
        </button>
      </CardHeader>
      {expanded ? (
        <CardContent id={contentId} className="space-y-3 pt-0">
          {positions.map((pos) => {
            const mint = pos.asset_identifier?.trim() ?? ''
            return (
              <div
                key={pos.id}
                id={nestGalleryAnchorId(pos.id)}
                className="scroll-mt-24 rounded-lg border border-border/50 bg-muted/15 p-3 sm:p-4"
              >
                <PositionNestRow
                  variant="embedded"
                  position={pos}
                  poolName={poolName}
                  stakedAssetHint={mint ? nestingWalletMintHints.get(mint) ?? null : null}
                  onUnstake={onUnstake}
                  onClaim={onClaim}
                  claimPhase={posPhases[pos.id]?.claim ?? 'idle'}
                  unstakePhase={posPhases[pos.id]?.unstake ?? 'idle'}
                  freezeRequired={freezeRequired}
                  cancelOpeningAllowed={isOpeningNftNestAbortable(pos, pool)}
                  actionsEnabled={actionsEnabled}
                  securityAckRequired={securityAckRequired}
                  nestingPaused={nestingPaused}
                  onResumeOpening={
                    onResumeOpening ? () => onResumeOpening(pos) : undefined
                  }
                />
              </div>
            )
          })}
        </CardContent>
      ) : null}
    </Card>
  )
}
