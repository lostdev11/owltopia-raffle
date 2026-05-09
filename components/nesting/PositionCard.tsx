'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { estimateClaimableRewards } from '@/lib/staking/rewards'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import { LockTimer } from '@/components/nesting/LockTimer'
import { NestingActionStatusLine } from '@/components/nesting/NestingActionStatusLine'
import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import { nestingTxPhaseLabel, type NestingTxPhase } from '@/lib/nesting/tx-states'
import { cn } from '@/lib/utils'

function nestStatusPhrase(status: StakingPositionRow['status']) {
  switch (status) {
    case 'active':
      return 'Nesting'
    case 'unstaked':
      return 'Nest closed'
    case 'pending':
      return 'Opening…'
    default:
      return status
  }
}

type Props = {
  position: StakingPositionRow
  poolName: string
  onUnstake: (positionId: string) => Promise<void>
  onClaim: (positionId: string, amount: number) => Promise<void>
  claimPhase?: NestingTxPhase
  unstakePhase?: NestingTxPhase
  /** When false, position actions are disabled and shown grayed (e.g. until user acknowledges security notice). */
  actionsEnabled?: boolean
}

export function PositionCard({
  position,
  poolName,
  onUnstake,
  onClaim,
  claimPhase = 'idle',
  unstakePhase = 'idle',
  actionsEnabled = true,
}: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const claimable = useMemo(
    () =>
      estimateClaimableRewards({
        amount: Number(position.amount),
        rewardRateSnapshot: Number(position.reward_rate_snapshot),
        rewardRateUnitSnapshot: position.reward_rate_unit_snapshot as RewardRateUnit,
        claimedRewards: Number(position.claimed_rewards),
        stakedAtMs: new Date(position.staked_at).getTime(),
        asOfMs: nowMs,
      }),
    [position, nowMs]
  )

  const canUnstake =
    position.status === 'active' &&
    (!position.unlock_at || new Date(position.unlock_at).getTime() <= nowMs)

  const claimAmountInput = Math.floor(claimable * 1e6) / 1e6
  const claimAmountLabel = claimAmountInput.toFixed(6)

  const anyTxActive = claimPhase !== 'idle' || unstakePhase !== 'idle'
  const canAct = actionsEnabled
  const showLinePhase: NestingTxPhase =
    claimPhase !== 'idle' ? claimPhase : unstakePhase !== 'idle' ? unstakePhase : 'idle'

  const handleClaimMax = async () => {
    if (claimAmountInput <= 0) return
    try {
      await onClaim(position.id, claimAmountInput)
    } catch {
      /* errors shown on dashboard */
    }
  }

  const handleUnstake = async () => {
    try {
      await onUnstake(position.id)
    } catch {
      /* errors shown on dashboard */
    }
  }

  return (
    <Card className="rounded-xl border-border/60 bg-card/90">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base font-display text-theme-prime">{poolName}</CardTitle>
          <span
            className={`text-xs font-medium uppercase tracking-wide ${
              position.status === 'active' ? 'text-emerald-400' : 'text-muted-foreground'
            }`}
          >
            {nestStatusPhrase(position.status)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          {position.asset_identifier ? (
            <NestingStakedAssetThumb
              mint={position.asset_identifier}
              size="md"
              className="mx-auto shrink-0 sm:mx-0"
            />
          ) : null}
          <dl
            className={cn(
              'grid min-w-0 flex-1 grid-cols-2 gap-2 text-xs sm:text-sm',
              !position.asset_identifier && 'w-full flex-none'
            )}
          >
          <div>
            <dt className="text-muted-foreground">Nest size</dt>
            <dd className="font-mono tabular-nums">{Number(position.amount).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ready to claim</dt>
            <dd className="font-mono tabular-nums text-theme-prime">{claimAmountLabel}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Claimed so far</dt>
            <dd className="font-mono tabular-nums">{Number(position.claimed_rewards).toFixed(6)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Opened</dt>
            <dd className="text-xs">{new Date(position.staked_at).toLocaleString()}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground mb-1">Countdown</dt>
            <dd>
              <LockTimer unlockAtIso={position.unlock_at} />
            </dd>
          </div>
          {position.asset_identifier ? (
            <div className="col-span-2">
              <dt className="text-muted-foreground">Asset tag</dt>
              <dd className="font-mono text-xs break-all">{position.asset_identifier}</dd>
            </div>
          ) : null}
        </dl>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 border-t border-border/60">
        <NestingActionStatusLine phase={showLinePhase} className="w-full min-h-[1.25rem]" />
        <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[44px] touch-manipulation border-border bg-muted/50 text-muted-foreground hover:bg-muted/80 hover:text-foreground disabled:opacity-40"
          disabled={!canAct || anyTxActive || claimAmountInput <= 0}
          onClick={() => void handleClaimMax()}
          aria-label={
            claimAmountInput > 0
              ? `Claim ${claimAmountLabel} OWL rewards`
              : 'Claim OWL rewards'
          }
        >
          {claimPhase !== 'idle' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {claimPhase === 'idle' ? (
            claimAmountInput > 0 ? (
              <span className="tabular-nums">
                Claim <span className="font-medium text-theme-prime">{claimAmountLabel}</span> OWL
              </span>
            ) : (
              'Claim OWL'
            )
          ) : (
            nestingTxPhaseLabel(claimPhase)
          )}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-[44px] touch-manipulation bg-muted/50 text-muted-foreground border border-border shadow-none hover:bg-muted/80 disabled:opacity-40"
          disabled={!canAct || anyTxActive || !canUnstake}
          onClick={() => void handleUnstake()}
        >
          {unstakePhase !== 'idle' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {unstakePhase === 'idle' ? 'Leave nest' : nestingTxPhaseLabel(unstakePhase)}
        </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
