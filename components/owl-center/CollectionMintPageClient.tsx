'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet } from '@solana/wallet-adapter-react'

import { ActivityLog } from '@/components/owl-center/ActivityLog'
import { CollectionMintPanel } from '@/components/owl-center/CollectionMintPanel'
import { CollectionSoldOutPanel } from '@/components/owl-center/CollectionSoldOutPanel'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { LaunchPhaseTimeline } from '@/components/owl-center/LaunchPhaseTimeline'
import { MintAllocationBar } from '@/components/owl-center/MintAllocationBar'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { PhaseBadge } from '@/components/owl-center/PhaseBadge'
import { StatPanel } from '@/components/owl-center/StatPanel'
import { StatusBadge } from '@/components/owl-center/StatusBadge'
import { SupplyProgress } from '@/components/owl-center/SupplyProgress'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import { useCollectionMintEligibility } from '@/hooks/use-collection-mint-eligibility'
import type { CollectionMintStateResponse } from '@/lib/owl-center/types'

export function CollectionMintPageClient({ slug, launchName }: { slug: string; launchName: string }) {
  const { publicKey, connected } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null
  const { elig } = useCollectionMintEligibility(slug, walletStr, connected)
  const [state, setState] = useState<CollectionMintStateResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/owl-center/collections/${encodeURIComponent(slug)}/state`, { cache: 'no-store' })
      const j = (await res.json()) as CollectionMintStateResponse & { error?: string }
      if (!res.ok) throw new Error(j.error || 'load_failed')
      setState(j)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [load])

  if (loading && !state) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER // MINT" title={launchName} subtitle="Loading mint console…">
        <p className="font-mono text-sm text-[#5C6773]">sync…</p>
      </OwlCenterShell>
    )
  }

  if (err && !state) {
    return (
      <OwlCenterShell eyebrow="OWL_CENTER // MINT" title={launchName} subtitle="Mint console unavailable">
        <p className="text-sm text-red-400">{err}</p>
        <Link href="/owl-center" className="mt-4 inline-block text-sm text-[#00FF9C]">
          ← Owl Center
        </Link>
      </OwlCenterShell>
    )
  }

  if (!state) return null

  const { launch, supply, mint_controls, marketplace, terminal, mint_network, presale_pool } = state
  const trading = launch.active_phase === 'TRADING_ACTIVE'
  const soldOut = launch.active_phase === 'SOLD_OUT' || supply.remaining <= 0
  const userMintPhase = connected && elig?.is_eligible ? launch.active_phase : null

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // MINT"
      title={launch.name}
      subtitle={launch.description ?? `Public mint on Solana (${mint_network})`}
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge status={launch.status} />
        <PhaseBadge phase={launch.active_phase} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">{mint_network}</span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          <SupplyProgress minted={supply.minted} total={supply.total} />
          {presale_pool ? (
            <div className="space-y-4 border border-[#1A222B] bg-[#0F1419]/70 p-4">
              <MintAllocationBar
                label="Presale mints redeemed"
                minted={presale_pool.presale_mints_recorded}
                total={presale_pool.mint_cap}
                hint={
                  presale_pool.credits_overshoot > 0
                    ? `${presale_pool.credits_issued} credits · ${presale_pool.credits_overshoot} in Presale+ overage`
                    : `${presale_pool.credits_issued} presale credits issued`
                }
              />
              {launch.presale_overage_supply > 0 ? (
                <MintAllocationBar
                  label="Presale+ overage"
                  minted={presale_pool.overage_mints_recorded}
                  total={presale_pool.overage_supply}
                  hint="Overshoot spots mint in PRESALE_OVERAGE when admin assigns wallets"
                />
              ) : null}
            </div>
          ) : null}
          <LaunchPhaseTimeline active={launch.active_phase} launch={launch} userMintPhase={userMintPhase} />
          <CollectionMintPanel
            slug={slug}
            launch={launch}
            remaining={supply.remaining}
            mintControls={mint_controls}
            onRefresh={load}
          />
          {soldOut ? (
            <CollectionSoldOutPanel
              slug={slug}
              launch={launch}
              mintCount={marketplace.mint_addresses_recorded}
              hashListReady={marketplace.hash_list_ready}
              magicEdenUrl={marketplace.magic_eden_url}
              tensorUrl={marketplace.tensor_url}
              tradingActive={trading || marketplace.trading_links_active}
            />
          ) : null}
          {trading || marketplace.trading_links_active ? (
            <CommandCard label="MARKETPLACES">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Trade on secondary</p>
              <TradingButtons
                magicEdenUrl={marketplace.magic_eden_url ?? launch.magic_eden_url}
                tensorUrl={marketplace.tensor_url ?? launch.tensor_url}
              />
            </CommandCard>
          ) : null}
        </div>

        <aside className="space-y-6">
          <StatPanel label="Supply" value={`${supply.minted} / ${supply.total}`} />
          <StatPanel label="Remaining" value={String(supply.remaining)} />
          <StatPanel label="Per wallet" value={String(launch.wallet_mint_limit)} />
          <ActivityLog lines={terminal} />
        </aside>
      </div>

      <p className="mt-10 font-mono text-[10px] text-[#5C6773]">
        <Link href="/owl-center" className="text-[#00FF9C] hover:underline">
          ← Owl Center hub
        </Link>
        {' · '}
        <Link href="/owl-center/drops" className="text-[#7D8A93] hover:text-[#00FF9C]">
          Live drops
        </Link>
      </p>
    </OwlCenterShell>
  )
}
