'use client'

import type { Gen2EligibilityResponse } from '@/lib/owl-center/types'

import { CommandCard } from '@/components/owl-center/CommandCard'
import { formatPhasePriceSol } from '@/lib/owl-center/format-phase-price-sol'

export function Gen2EligibilityCard({
  eligibility,
  loading,
}: {
  eligibility: Gen2EligibilityResponse | null
  loading: boolean
}) {
  if (loading || !eligibility) {
    return (
      <CommandCard label="wallet_eligibility.sys">
        <p className="font-mono text-sm text-[#9BA8B4]">Checking eligibility…</p>
      </CommandCard>
    )
  }

  const presale = eligibility.presale_balance
  const wl = eligibility.wl_allocation

  return (
    <CommandCard label="wallet_eligibility.sys">
      <div className="space-y-4 font-mono text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-[#5C6773]">Phase</span>
          <span className="text-[#00FF9C]">{eligibility.active_phase === 'AIRDROP' ? 'GEN1' : eligibility.active_phase}</span>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-[#5C6773]">Eligible</span>
          <span className={eligibility.is_eligible ? 'text-[#00FF9C]' : 'text-[#FF9C9C]'}>
            {eligibility.is_eligible ? 'YES' : 'NO'}
          </span>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <span className="text-[#5C6773]">Max mintable</span>
          <span className="tabular-nums text-[#F4FBF8]">{eligibility.max_mintable}</span>
        </div>
        {eligibility.reason ? (
          <p className="border border-[#1A222B] bg-[#0F1419] px-3 py-2 text-xs text-[#FFD769]">
            reason: {eligibility.reason}
          </p>
        ) : null}

        {presale && eligibility.active_phase === 'PRESALE' ? (
          <div className="grid gap-1 border border-[#1A222B] bg-[#0F1419] p-3 text-xs">
            <p className="text-[#5C6773]">Presale credits</p>
            <p className="tabular-nums text-[#C5D0D8]">
              paid participant: {presale.is_paid_participant ? 'yes' : 'no'} · purchased {presale.purchased_mints} · used{' '}
              {presale.used_mints} ·{' '}
              <span className="text-[#00FF9C]">
                {presale.purchased_available_mints ?? presale.available_mints} paid to mint
              </span>
              {presale.gifted_mints > 0 ? (
                <span className="text-[#5C6773]"> · {presale.gifted_mints} gifted</span>
              ) : null}
            </p>
          </div>
        ) : null}

        {eligibility.gen1_snapshot && eligibility.active_phase === 'AIRDROP' ? (
          <div className="grid gap-1 border border-[#1A222B] bg-[#0F1419] p-3 text-xs">
            <p className="text-[#5C6773]">Owltopia Gen1</p>
            <p className="text-[#C5D0D8]">
              {eligibility.gen1_snapshot.collection_configured === false
                ? 'Gen1 collection address not configured on server'
                : eligibility.gen1_snapshot.is_holder
                  ? `Holder · ${eligibility.gen1_snapshot.gen1_nft_count} NFT${eligibility.gen1_snapshot.gen1_nft_count === 1 ? '' : 's'} detected · 1 free Gen2 mint per Gen1`
                  : 'No Gen1 NFT detected on this wallet — confirm the NFT is in the connected wallet on mainnet'}
            </p>
          </div>
        ) : null}

        {wl && eligibility.active_phase === 'WHITELIST' ? (
          <div className="grid gap-1 border border-[#1A222B] bg-[#0F1419] p-3 text-xs">
            <p className="text-[#5C6773]">WL allocation</p>
            <p className="tabular-nums text-[#C5D0D8]">
              {wl.allowed_mints} WL spot{wl.allowed_mints === 1 ? '' : 's'} assigned · used {wl.used_mints} ·{' '}
              <span className="text-[#00FF9C]">{wl.available_mints}</span> left to mint (up to allocation per phase)
              {wl.community ? <span className="text-[#5C6773]"> · {wl.community}</span> : null}
            </p>
          </div>
        ) : null}

        {eligibility.unit_lamports_estimate ? (
          <p className="text-xs text-[#9BA8B4]">
            Mint price {formatPhasePriceSol(eligibility.unit_lamports_estimate) ?? '—'}
            {eligibility.sol_usd_price ? ` · SOL/USD ${eligibility.sol_usd_price.toFixed(2)}` : ''}. Candy Machine guards apply on-chain.
          </p>
        ) : eligibility.active_phase === 'PRESALE' ? (
          <p className="text-xs text-[#00FF9C]">
            Covered by presale credits — you only pay Solana network fees during redemption (configure Candy Guard accordingly).
          </p>
        ) : null}
      </div>
    </CommandCard>
  )
}
