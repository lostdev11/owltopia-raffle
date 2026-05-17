'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import type { StakingPositionRow } from '@/lib/db/staking-positions'
import { PositionNestRow } from '@/components/nesting/PositionCard'
import { nestGalleryAnchorId } from '@/components/nesting/StakedNftNestGallery'
import { isOpeningNftNestAbortable } from '@/lib/nesting/position-lifecycle'
import type { NestingTxPhase } from '@/lib/nesting/tx-states'

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
  nestingPaused: boolean
}

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
  nestingPaused,
}: Props) {
  const pending = positions.filter((p) => p.status === 'pending').length
  const needsWalletLock = positions.filter(
    (p) =>
      freezeRequired &&
      Boolean(p.asset_identifier?.trim()) &&
      !p.external_reference?.startsWith('nft_freeze_confirmed:')
  ).length

  const headerStatus =
    pending > 0 && needsWalletLock > 0
      ? `${needsWalletLock} opening — finish wallet lock`
      : pending > 0
        ? 'Opening…'
        : 'Nesting'

  const headerStatusClass =
    pending > 0 ? 'text-amber-400' : 'text-emerald-400'

  return (
    <Card className="rounded-xl border-border/60 bg-card/90">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base font-display text-theme-prime">{poolName}</CardTitle>
            <CardDescription className="text-xs text-muted-foreground leading-relaxed">
              {positions.length} Owltopia coin{positions.length === 1 ? '' : 's'} on this perch — one card; claim or leave
              each row below.
            </CardDescription>
            {needsWalletLock > 0 ? (
              <p className="text-xs text-amber-300/95 leading-relaxed pt-0.5">
                {needsWalletLock === positions.length
                  ? 'Each row still needs the wallet lock: select the matching coin in the nest form above, then tap Confirm nest — your wallet may ask once per coin (Backpack, etc.).'
                  : `${needsWalletLock} still need the wallet lock — use Confirm nest above for each coin that shows Opening.`}
              </p>
            ) : null}
          </div>
          <span className={`text-xs font-medium uppercase tracking-wide shrink-0 ${headerStatusClass}`}>
            {headerStatus}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
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
                nestingPaused={nestingPaused}
              />
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
