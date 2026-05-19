'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import {
  estimateClaimableRewards,
  hasClaimableRewardBalance,
  meetsMinOwlClaimThreshold,
  MIN_OWL_CLAIMABLE_TO_CLAIM,
} from '@/lib/staking/rewards'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import { LockTimer } from '@/components/nesting/LockTimer'
import { NestingActionStatusLine } from '@/components/nesting/NestingActionStatusLine'
import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import {
  isPendingNftNestFreezeConfirmedButNotActive,
} from '@/lib/nesting/position-lifecycle'
import {
  isNestingTxPhaseInFlight,
  nestingTxPhaseLabel,
  type NestingTxPhase,
} from '@/lib/nesting/tx-states'
import { nestingClaimAccruingButtonClass, nestingClaimReadyButtonClass } from '@/lib/nesting/ui-classes'
import { cn } from '@/lib/utils'

function nestStatusPhrase(
  status: StakingPositionRow['status'],
  freezeConfirmedButNotActive: boolean
) {
  switch (status) {
    case 'active':
      return 'Nesting'
    case 'unstaked':
      return 'Nest closed'
    case 'pending':
      return freezeConfirmedButNotActive ? 'Activating…' : 'Opening…'
    default:
      return status
  }
}

export type PositionNestRowProps = {
  position: StakingPositionRow
  poolName: string
  /** Wallet scan row for this mint (faster image/name before Helius resolves). */
  stakedAssetHint?: { name?: string | null; image?: string | null } | null
  onUnstake: (positionId: string) => Promise<void>
  onClaim: (positionId: string, amount: number) => Promise<void>
  claimPhase?: NestingTxPhase
  unstakePhase?: NestingTxPhase
  /** On-chain NFT perch: show guidance when the wallet lock step still needs finishing via Confirm nest. */
  freezeRequired?: boolean
  /** Pending open before freeze — allows Cancel opening nest (matches server `isOpeningNftNestAbortable`). */
  cancelOpeningAllowed?: boolean
  /** When false, position actions are disabled and shown grayed (e.g. until user acknowledges security notice). */
  actionsEnabled?: boolean
  /** True when claim/leave are blocked until the safeguards checkbox is checked. */
  securityAckRequired?: boolean
  /** Blocks Leave nest / cancel opening (admin pause or deploy kill switch). */
  nestingPaused?: boolean
  /** Blocks Claim OWL (deploy kill switch only — admin pause still allows claims). */
  claimsPaused?: boolean
  /** Scroll to nest form and pre-select this coin (pending open only). */
  onResumeOpening?: () => void
}

type PositionNestRowVariant = 'standalone' | 'embedded'

/** One nest row — full card chrome, or compact block for {@link NftPerchGroupedNestCard}. */
export function PositionNestRow({
  variant = 'standalone',
  position,
  poolName,
  stakedAssetHint,
  onUnstake,
  onClaim,
  claimPhase = 'idle',
  unstakePhase = 'idle',
  freezeRequired = false,
  cancelOpeningAllowed = false,
  actionsEnabled = true,
  securityAckRequired = false,
  nestingPaused = false,
  claimsPaused,
  onResumeOpening,
}: PositionNestRowProps & { variant?: PositionNestRowVariant }) {
  const claimBlocked = claimsPaused ?? nestingPaused
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [dasNftName, setDasNftName] = useState<string | null>(null)

  useEffect(() => {
    setDasNftName(null)
  }, [position.id, position.asset_identifier])

  useEffect(() => {
    if (position.status === 'unstaked') return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [position.status])

  const claimable = useMemo(() => {
    if (position.status === 'unstaked') return 0
    return estimateClaimableRewards({
      amount: Number(position.amount),
      rewardRateSnapshot: Number(position.reward_rate_snapshot),
      rewardRateUnitSnapshot: position.reward_rate_unit_snapshot as RewardRateUnit,
      claimedRewards: Number(position.claimed_rewards),
      stakedAtMs: new Date(position.staked_at).getTime(),
      asOfMs: nowMs,
    })
  }, [position, nowMs])

  const paysOwlRewards = (position.reward_token_snapshot ?? '').trim().toUpperCase() === 'OWL'
  const stuckActivating = isPendingNftNestFreezeConfirmedButNotActive(position)
  const isOpening = position.status === 'pending' && !stuckActivating
  const canClaimOwl =
    position.status === 'active' &&
    (paysOwlRewards ? meetsMinOwlClaimThreshold(claimable) : claimable > 1e-12)

  const canUnstake =
    cancelOpeningAllowed ||
    (position.status === 'active' &&
      (!position.unlock_at || new Date(position.unlock_at).getTime() <= nowMs))

  const claimAmountInput = claimable
  const claimAmountLabel = claimable.toLocaleString(undefined, { maximumFractionDigits: 6 })

  const anyTxInFlight = isNestingTxPhaseInFlight(claimPhase) || isNestingTxPhaseInFlight(unstakePhase)
  const showLinePhase: NestingTxPhase = isNestingTxPhaseInFlight(claimPhase)
    ? claimPhase
    : isNestingTxPhaseInFlight(unstakePhase)
      ? unstakePhase
      : claimPhase === 'failed' || unstakePhase === 'failed'
        ? 'failed'
        : 'idle'
  const needsFreeze =
    freezeRequired &&
    Boolean(position.asset_identifier?.trim()) &&
    position.status !== 'unstaked' &&
    !position.external_reference?.startsWith('nft_freeze_confirmed:')
  const showFinishOpening = isOpening && needsFreeze && Boolean(onResumeOpening)

  const handleClaimMax = async () => {
    if (!canClaimOwl || !hasClaimableRewardBalance(claimAmountInput)) return
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

  const headingTitle = (dasNftName ?? stakedAssetHint?.name ?? '').trim() || poolName
  const embedded = variant === 'embedded'

  const header = embedded ? (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/40 pb-2">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-semibold leading-snug text-theme-prime/95">{headingTitle}</p>
        {headingTitle.trim() !== poolName.trim() ? (
          <p className="text-[11px] font-normal text-muted-foreground">{poolName}</p>
        ) : null}
      </div>
      <span
        className={cn(
          'text-[10px] font-medium uppercase tracking-wide shrink-0',
          position.status === 'active' ? 'text-emerald-400' : 'text-muted-foreground'
        )}
      >
        {nestStatusPhrase(position.status, stuckActivating)}
      </span>
    </div>
  ) : (
    <CardHeader className="pb-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <CardTitle className="text-base font-display text-theme-prime">{headingTitle}</CardTitle>
          {headingTitle.trim() !== poolName.trim() ? (
            <p className="text-xs font-normal text-muted-foreground">{poolName}</p>
          ) : null}
        </div>
        <span
          className={`text-xs font-medium uppercase tracking-wide ${
            position.status === 'active' ? 'text-emerald-400' : 'text-muted-foreground'
          }`}
        >
          {nestStatusPhrase(position.status, stuckActivating)}
        </span>
      </div>
    </CardHeader>
  )

  const main = (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4', embedded ? 'pt-3' : '')}>
      {position.asset_identifier ? (
        <NestingStakedAssetThumb
          mint={position.asset_identifier}
          hintImageUrl={stakedAssetHint?.image}
          hintName={stakedAssetHint?.name ?? null}
          onResolvedMintMeta={(meta) => {
            if (meta.name?.trim()) setDasNftName(meta.name.trim())
          }}
          size={embedded ? 'sm' : 'md'}
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
          <dd
            className={cn(
              'font-mono tabular-nums',
              isOpening ? 'text-muted-foreground' : 'text-theme-prime'
            )}
          >
            {isOpening ? 'After opening' : claimAmountLabel}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">OWL claimed (lifetime)</dt>
          <dd className="font-mono tabular-nums">{Number(position.claimed_rewards).toFixed(6)}</dd>
          {paysOwlRewards ? (
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              Counts successful claims. On-chain payouts require the reward treasury to send SPL.
            </p>
          ) : null}
        </div>
        <div>
          <dt className="text-muted-foreground">Opened</dt>
          <dd className="text-xs">{new Date(position.staked_at).toLocaleString()}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted-foreground mb-1">Countdown</dt>
          <dd>
            {position.status === 'unstaked' ? (
              <span className="text-xs text-muted-foreground">Ended when nest closed</span>
            ) : (
              <LockTimer unlockAtIso={position.unlock_at} />
            )}
          </dd>
        </div>
      </dl>
    </div>
  )

  const footerInner = (
    <>
      <NestingActionStatusLine phase={showLinePhase} className="w-full min-h-[1.25rem]" />
      {securityAckRequired ? (
        <p className="w-full text-xs text-amber-200/95 leading-relaxed">
          Check the safeguards box near the top of this page (Peek at safeguards before you nest) to unlock claim and
          leave actions.
        </p>
      ) : null}
      {paysOwlRewards && claimable > 0 && !canClaimOwl ? (
        <p className="w-full text-xs text-muted-foreground">
          Accruing toward {MIN_OWL_CLAIMABLE_TO_CLAIM} OWL minimum — you can claim any amount from{' '}
          {MIN_OWL_CLAIMABLE_TO_CLAIM} OWL up once ready.
        </p>
      ) : null}
      {!embedded && needsFreeze ? (
        <p className="w-full text-xs text-amber-300">
          This nest is still opening: select the same Owltopia coin in the nest form above, then tap{' '}
          <span className="font-medium text-foreground/90">Confirm nest</span> to finish the wallet lock so the NFT
          cannot trade while nested.
          {cancelOpeningAllowed ? (
            <>
              {' '}
              Wrong owl? Use <span className="font-medium text-foreground/90">Cancel opening nest</span> below before you
              complete that step.
            </>
          ) : null}
        </p>
      ) : null}
      {embedded && needsFreeze ? (
        <p className="w-full text-xs text-amber-300/95 leading-relaxed">
          Still opening — finish the wallet lock from the perch form (<span className="font-medium">Confirm nest</span>
          ){cancelOpeningAllowed ? (
            <>
              {' '}
              or <span className="font-medium">Cancel opening nest</span> below
            </>
          ) : null}
          .
        </p>
      ) : null}
      {stuckActivating ? (
        <p className="w-full text-xs text-amber-200/95 leading-relaxed">
          Wallet lock is confirmed — finishing nest sync. Tap <span className="font-medium">Refresh</span> on the
          dashboard; claim unlocks once status shows Nesting.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {showFinishOpening ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="min-h-[44px] touch-manipulation font-semibold"
            disabled={!actionsEnabled || anyTxInFlight}
            onClick={() => onResumeOpening?.()}
          >
            Finish opening
          </Button>
        ) : (
          <Button
            type="button"
            variant={canClaimOwl && !claimBlocked ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'min-h-[44px] touch-manipulation',
              canClaimOwl && !claimBlocked
                ? nestingClaimReadyButtonClass
                : nestingClaimAccruingButtonClass
            )}
            disabled={!actionsEnabled || claimBlocked || anyTxInFlight || !canClaimOwl}
            onClick={() => void handleClaimMax()}
            aria-label={canClaimOwl ? `Claim ${claimAmountLabel} OWL rewards` : 'Claim OWL rewards'}
          >
            {claimPhase !== 'idle' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {claimPhase === 'idle' ? (
              canClaimOwl ? (
                <span className="tabular-nums">
                  Claim <span className="font-medium text-theme-prime">{claimAmountLabel}</span> OWL
                </span>
              ) : paysOwlRewards && claimable > 0 ? (
                `Accruing · ${claimAmountLabel} OWL`
              ) : (
                'Claim OWL — accruing'
              )
            ) : (
              nestingTxPhaseLabel(claimPhase, 'claim')
            )}
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-[44px] touch-manipulation bg-muted/50 text-muted-foreground border border-border shadow-none hover:bg-muted/80 disabled:opacity-40"
          disabled={
            !actionsEnabled || (nestingPaused && !cancelOpeningAllowed) || anyTxInFlight || !canUnstake
          }
          onClick={() => void handleUnstake()}
        >
          {unstakePhase !== 'idle' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {unstakePhase === 'idle'
            ? cancelOpeningAllowed
              ? 'Cancel opening nest'
              : 'Leave nest'
            : nestingTxPhaseLabel(unstakePhase)}
        </Button>
      </div>
    </>
  )

  const footer = embedded ? (
    <div className="flex flex-col gap-2 border-t border-border/50 pt-3 mt-3">{footerInner}</div>
  ) : (
    <CardFooter className="flex flex-col gap-2 border-t border-border/60">{footerInner}</CardFooter>
  )

  const contentWrapper = embedded ? (
    <div>{main}</div>
  ) : (
    <CardContent className="space-y-3 text-sm">{main}</CardContent>
  )

  if (embedded) {
    return (
      <div className="space-y-0">
        {header}
        {contentWrapper}
        {footer}
      </div>
    )
  }

  return (
    <Card className="rounded-xl border-border/60 bg-card/90">
      {header}
      {contentWrapper}
      {footer}
    </Card>
  )
}

type PositionCardLegacyProps = PositionNestRowProps

/** Single nest wrapped in a full card (default dashboard layout). */
export function PositionCard(props: PositionCardLegacyProps) {
  return <PositionNestRow {...props} variant="standalone" />
}
