'use client'

import type { Gen2EligibilityResponse } from '@/lib/owl-center/types'

import { CommandCard } from '@/components/owl-center/CommandCard'

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
          <span className="text-[#00FF9C]">{eligibility.active_phase}</span>
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
              purchased {presale.purchased_mints} · gifted {presale.gifted_mints} · used {presale.used_mints} · available{' '}
              <span className="text-[#00FF9C]">{presale.available_mints}</span>
            </p>
          </div>
        ) : null}

        {wl && eligibility.active_phase === 'WHITELIST' ? (
          <div className="grid gap-1 border border-[#1A222B] bg-[#0F1419] p-3 text-xs">
            <p className="text-[#5C6773]">Whitelist allocation</p>
            <p className="tabular-nums text-[#C5D0D8]">
              allowed {wl.allowed_mints} · used {wl.used_mints} · available{' '}
              <span className="text-[#00FF9C]">{wl.available_mints}</span>
            </p>
          </div>
        ) : null}

        {eligibility.price_usdc != null && eligibility.price_usdc > 0 ? (
          <p className="text-xs text-[#9BA8B4]">
            Quote ~{eligibility.unit_lamports_estimate ?? '—'} lamports @ ${eligibility.price_usdc} USDC-notional
            {eligibility.sol_usd_price ? ` (SOL/USD ${eligibility.sol_usd_price.toFixed(2)})` : ''}. Candy Machine guards apply on-chain.
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
