import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

import { MintCountdown } from '@/components/owl-center/MintCountdown'
import { SupplyProgress } from '@/components/owl-center/SupplyProgress'
import { launchHasPresaleProgram, launchShowsPresaleOverage } from '@/lib/owl-center/launch-presale'
import { resolveMintOpensAt } from '@/lib/owl-center/launch-mint-config'
import { getLaunchMintPriceDisplay } from '@/lib/owl-center/launch-price-quotes'
import { formatRoyaltyPercentLabel, launchSellerFeeBasisPoints } from '@/lib/owl-center/royalty'
import { formatMintDate, getMintCountdownInfo } from '@/lib/owl-center/phase-schedule'

type PhaseRow = { label: string; supply: number; note?: string }

function phaseRows(launch: OwlCenterLaunchPublic): PhaseRow[] {
  const rows: PhaseRow[] = []
  if (launch.airdrop_supply > 0) {
    rows.push({
      label: launch.slug === 'gen2' ? 'GEN1' : 'Airdrop',
      supply: launch.airdrop_supply,
      note: 'free',
    })
  }
  if (launchHasPresaleProgram(launch) && launch.presale_supply > 0) {
    rows.push({ label: 'Presale', supply: launch.presale_supply, note: 'prepaid · free mint' })
  }
  if (launchShowsPresaleOverage(launch)) {
    rows.push({
      label: 'Presale+',
      supply: launch.presale_overage_supply,
      note: 'overage',
    })
  }
  if (launch.wl_supply > 0) {
    rows.push({ label: 'WL', supply: launch.wl_supply, note: 'FCFS' })
  }
  if (launch.public_supply > 0) {
    rows.push({ label: 'Public', supply: launch.public_supply })
  }
  return rows
}

export async function LaunchMintDetails({ launch }: { launch: OwlCenterLaunchPublic }) {
  const phases = phaseRows(launch)
  const prices = await getLaunchMintPriceDisplay(launch)
  const countdown = getMintCountdownInfo(launch)
  const mintOpensAt = resolveMintOpensAt(launch)

  return (
    <div className="space-y-3 border-t border-[#1A222B] pt-3">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">Mint details</p>
      {countdown ? (
        <MintCountdown launch={launch} initial={countdown} />
      ) : null}
      <SupplyProgress minted={launch.minted_count} total={launch.total_supply} />
      {phases.length > 0 ? (
        <dl className="grid gap-1.5 font-mono text-xs text-[#9BA8B4] sm:grid-cols-2">
          {phases.map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline gap-x-1.5">
              <dt className="text-[#5C6773]">{row.label}</dt>
              <dd>
                <span className="tabular-nums text-[#00FF9C]">{row.supply.toLocaleString()}</span>
                {row.note ? <span className="text-[#5C6773]"> · {row.note}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <dl className="space-y-1.5 font-mono text-xs text-[#9BA8B4]">
        {prices.presale ? (
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <dt className="text-[#5C6773]">Presale mint</dt>
            <dd className="text-[#00FF9C]">{prices.presale}</dd>
          </div>
        ) : null}
        {prices.whitelist ? (
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <dt className="text-[#5C6773]">Whitelist</dt>
            <dd className="text-[#E8EEF2]">{prices.whitelist}</dd>
          </div>
        ) : null}
        {prices.public ? (
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <dt className="text-[#5C6773]">Public</dt>
            <dd className="text-[#E8EEF2]">{prices.public}</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 border-t border-[#1A222B]/80 pt-1.5">
          <dt className="text-[#5C6773]">Mint opens</dt>
          <dd className="text-[#E8EEF2]">{formatMintDate(mintOpensAt)}</dd>
        </div>
        {launch.wallet_mint_limit > 0 ? (
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
            <dt className="text-[#5C6773]">Per wallet</dt>
            <dd className="text-[#E8EEF2]">
              {launch.wallet_mint_limit} max / phase
            </dd>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
          <dt className="text-[#5C6773]">Secondary royalty</dt>
          <dd className="text-[#E8EEF2]">{formatRoyaltyPercentLabel(launchSellerFeeBasisPoints(launch))}</dd>
        </div>
      </dl>
    </div>
  )
}
