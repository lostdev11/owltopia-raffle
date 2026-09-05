'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

import { ActivityLog } from '@/components/owl-center/ActivityLog'
import { CollectionMintedGrid } from '@/components/owl-center/CollectionMintedGrid'
import { CollectionMintPanel } from '@/components/owl-center/CollectionMintPanel'
import { CollectionSoldOutPanel } from '@/components/owl-center/CollectionSoldOutPanel'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { LaunchPhaseTimeline } from '@/components/owl-center/LaunchPhaseTimeline'
import { MintCountdown } from '@/components/owl-center/MintCountdown'
import { MintAllocationBar } from '@/components/owl-center/MintAllocationBar'
import { PartnerMintPhaseSchedule } from '@/components/owl-center/PartnerMintPhaseSchedule'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { PhaseBadge } from '@/components/owl-center/PhaseBadge'
import { StatPanel } from '@/components/owl-center/StatPanel'
import { StatusBadge } from '@/components/owl-center/StatusBadge'
import { SupplyProgress } from '@/components/owl-center/SupplyProgress'
import { TradingButtons } from '@/components/owl-center/TradingButtons'
import { useOwlCenterView } from '@/components/owl-center/OwlCenterViewProvider'
import { useSiwsSession } from '@/hooks/use-siws-session'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import { useCollectionMintEligibility } from '@/hooks/use-collection-mint-eligibility'
import { launchPublicPhaseBadgeLabel } from '@/lib/owl-center/launch-mint-open'
import type { CollectionMintStateResponse } from '@/lib/owl-center/types'

function SectionHeading({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div id={id} className="scroll-mt-28 md:scroll-mt-24">
      <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">{title}</h2>
      {hint ? <p className="mt-2 max-w-2xl text-sm text-[#9BA8B4]">{hint}</p> : null}
    </div>
  )
}

export function CollectionMintPageClient({ slug, launchName }: { slug: string; launchName: string }) {
  const { isOwlCenterAdmin } = useOwlCenterView()
  const { sessionWallet } = useSiwsSession()
  const { publicKey, connected } = useWallet()
  const walletStr = publicKey?.toBase58() ?? null
  const { elig } = useCollectionMintEligibility(slug, walletStr, connected)
  const [state, setState] = useState<CollectionMintStateResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [myMints, setMyMints] = useState<string[]>([])
  const [myMintsLoading, setMyMintsLoading] = useState(false)
  const [phaseBadgeLabel, setPhaseBadgeLabel] = useState<string | null>(null)

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

  const loadMyMints = useCallback(async () => {
    if (!connected || !walletStr) {
      setMyMints([])
      return
    }
    setMyMintsLoading(true)
    try {
      const res = await fetch(`/api/owl-center/collections/${encodeURIComponent(slug)}/my-mints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: walletStr }),
        cache: 'no-store',
      })
      const j = (await res.json()) as { mints?: string[] }
      if (res.ok && Array.isArray(j.mints)) setMyMints(j.mints)
    } catch {
      /* keep prior list on transient error */
    } finally {
      setMyMintsLoading(false)
    }
  }, [connected, walletStr, slug])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    void loadMyMints()
  }, [loadMyMints])

  useEffect(() => {
    if (!state?.launch) {
      setPhaseBadgeLabel(null)
      return
    }
    setPhaseBadgeLabel(launchPublicPhaseBadgeLabel(state.launch))
  }, [state?.launch])

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

  const { launch, supply, mint_controls, marketplace, terminal, mint_network, presale_pool, minted_mints } = state
  const trading = launch.active_phase === 'TRADING_ACTIVE'
  const soldOut = launch.active_phase === 'SOLD_OUT' || supply.remaining <= 0
  const userMintPhase = connected && elig?.is_eligible && elig.mint_window_open !== false ? launch.active_phase : null
  const canEditMintSettings =
    isOwlCenterAdmin ||
    (!!sessionWallet &&
      !!launch.creator_wallet &&
      walletsEqualSolana(sessionWallet, launch.creator_wallet))

  return (
    <OwlCenterShell
      eyebrow="OWL_CENTER // MINT"
      title={launch.name}
      subtitle={launch.description ?? `Public mint on Solana (${mint_network})`}
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatusBadge status={launch.status} />
        <PhaseBadge phase={launch.active_phase} overrideLabel={phaseBadgeLabel} />
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">{mint_network}</span>
      </div>

      {canEditMintSettings ? (
        <p className="mb-6 break-words rounded border border-[#1A222B] bg-[#0F1419]/80 px-4 py-3 font-mono text-xs leading-relaxed text-[#9BA8B4]">
          Per-wallet cap:{' '}
          <span className="text-[#E8EEF2]">{launch.wallet_mint_limit} max (public)</span>
          {' · '}
          <Link href={`/owl-center/my-launches/${launch.id}/mint-details`} className="text-[#00FF9C] hover:underline">
            Edit mint settings
          </Link>
        </p>
      ) : null}

      <div className="grid w-full min-w-0 max-w-full gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="min-w-0 space-y-8">
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
          <MintCountdown launch={launch} />
          <PartnerMintPhaseSchedule
            launch={launch}
            liveUnitLamports={elig?.unit_lamports_estimate}
          />
          <CollectionMintPanel
            slug={slug}
            launch={launch}
            remaining={supply.remaining}
            mintControls={mint_controls}
            onRefresh={() => {
              void load()
              void loadMyMints()
            }}
          />

          <section className="space-y-4">
            <SectionHeading
              id="my-minted"
              title="My mints"
              hint="Pieces this wallet (and any linked wallets) minted from this drop."
            />
            {!connected ? (
              <CommandCard label="MY MINTS">
                <p className="text-sm leading-relaxed text-[#9BA8B4]">
                  Connect your wallet in the site header to see which pieces you minted.
                </p>
              </CommandCard>
            ) : myMintsLoading && !myMints.length ? (
              <CommandCard label="MY MINTS">
                <p className="text-sm leading-relaxed text-[#9BA8B4]">Loading your mints…</p>
              </CommandCard>
            ) : myMints.length ? (
              <CollectionMintedGrid
                mints={myMints}
                preferMainnet={mint_network === 'mainnet'}
                label={`MY MINTS // ${myMints.length}`}
                description="Pieces you minted in this drop. Just minted? It appears here once confirm-mint records the tx — tap Refresh in the mint console if it's not showing yet."
              />
            ) : (
              <CommandCard label="MY MINTS // 0">
                <p className="text-sm leading-relaxed text-[#9BA8B4]">
                  You haven&apos;t minted from this drop yet. After you mint, your pieces show up here once the
                  transaction is confirmed on-chain.
                </p>
              </CommandCard>
            )}
          </section>

          <section className="space-y-4">
            <SectionHeading
              id="minted"
              title="All minted"
              hint={
                minted_mints.length
                  ? 'Every piece minted from this drop so far. New pieces appear after confirm-mint records the tx.'
                  : 'Minted pieces will appear here once the first mints are confirmed on-chain.'
              }
            />
            {minted_mints.length ? (
              <CollectionMintedGrid
                mints={minted_mints}
                preferMainnet={mint_network === 'mainnet'}
                label={`ALL MINTS // ${minted_mints.length}`}
                description="Every piece minted from this drop so far (all wallets)."
              />
            ) : (
              <CommandCard label="ALL MINTS // 0">
                <p className="text-sm leading-relaxed text-[#9BA8B4]">
                  No pieces minted yet. Once minting opens and the first transactions confirm, they will show up here.
                </p>
              </CommandCard>
            )}
          </section>

          {soldOut && canEditMintSettings ? (
            <CollectionSoldOutPanel
              slug={slug}
              launch={launch}
              mintCount={marketplace.mint_addresses_recorded}
              hashListReady={marketplace.hash_list_ready}
              orbisUrl={marketplace.orbis_url}
              magicEdenUrl={marketplace.magic_eden_url}
              tensorUrl={marketplace.tensor_url}
              tradingActive={trading || marketplace.trading_links_active}
            />
          ) : null}
          {trading || marketplace.trading_links_active ? (
            <CommandCard label="MARKETPLACES">
              <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">Trade on secondary</p>
              <TradingButtons
                orbisUrl={marketplace.orbis_url ?? launch.orbis_url}
                magicEdenUrl={marketplace.magic_eden_url ?? launch.magic_eden_url}
                tensorUrl={marketplace.tensor_url ?? launch.tensor_url}
              />
            </CommandCard>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-6">
          <StatPanel label="Supply" value={`${supply.minted} / ${supply.total}`} />
          <StatPanel label="Remaining" value={String(supply.remaining)} />
          <StatPanel label="Per wallet" value={String(launch.wallet_mint_limit)} />
          {isOwlCenterAdmin ? <ActivityLog lines={terminal} /> : null}
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
