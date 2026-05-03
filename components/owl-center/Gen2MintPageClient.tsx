'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'

import { HeroVideoBackground } from '@/components/HeroVideoBackground'
import { ActivityLog } from '@/components/owl-center/ActivityLog'
import { CommandCard } from '@/components/owl-center/CommandCard'
import { Gen2MintPanel } from '@/components/owl-center/Gen2MintPanel'
import { LaunchPhaseTimeline } from '@/components/owl-center/LaunchPhaseTimeline'
import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'
import { PhaseBadge } from '@/components/owl-center/PhaseBadge'
import { StatPanel } from '@/components/owl-center/StatPanel'
import { StatusBadge } from '@/components/owl-center/StatusBadge'
import { SupplyProgress } from '@/components/owl-center/SupplyProgress'
import type { MintTerminalLine, OwlCenterLaunchPublic } from '@/lib/owl-center/types'
import { isDevnetMintEnabled } from '@/lib/solana/network'

type Gen2StateApi = {
  launch: OwlCenterLaunchPublic
  marketplace?: {
    trading_links_active: boolean
    magic_eden_url: string | null
    tensor_url: string | null
  }
  supply: { total: number; minted: number; remaining: number; percent_minted: number }
  phases: { airdrop: number; presale: number; whitelist: number; public: number }
  prices_usdc: { presale: number | null; whitelist: number | null; public: number | null }
  terminal: MintTerminalLine[]
}

export function Gen2MintPageClient() {
  const [state, setState] = useState<Gen2StateApi | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [adminTradingWarn, setAdminTradingWarn] = useState(false)

  const load = useCallback(async () => {
    setLoadErr(null)
    try {
      const res = await fetch('/api/owl-center/gen2/state', { cache: 'no-store' })
      const j = (await res.json()) as Gen2StateApi & { error?: string }
      if (!res.ok) throw new Error(j.error || 'state_failed')
      setState(j)
    } catch (e) {
      setState(null)
      setLoadErr(e instanceof Error ? e.message : 'state_failed')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 45_000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    let cancelled = false
    async function hint() {
      try {
        const res = await fetch('/api/owl-center/gen2/admin-trading-hint', { credentials: 'include' })
        if (!res.ok) return
        const j = (await res.json()) as { show_missing_links_warning?: boolean }
        if (!cancelled && j.show_missing_links_warning) setAdminTradingWarn(true)
      } catch {
        /* not signed in / not admin */
      }
    }
    void hint()
    return () => {
      cancelled = true
    }
  }, [])

  if (loadErr || !state) {
    return (
      <OwlCenterShell title="Owltopia Gen2" subtitle="Loading launch telemetry…">
        <p className="font-mono text-sm text-[#FF9C9C]">{loadErr ?? 'Loading…'}</p>
      </OwlCenterShell>
    )
  }

  const { launch, supply, phases, prices_usdc, terminal } = state
  const marketplace = state.marketplace ?? {
    trading_links_active: false,
    magic_eden_url: null,
    tensor_url: null,
  }
  const meHref = launch.magic_eden_url?.trim()
  const teHref = launch.tensor_url?.trim()
  const showSecondaryLinks =
    marketplace.trading_links_active && ((meHref != null && meHref !== '') || (teHref != null && teHref !== ''))

  const videoSrc = '/videos/owltopia-gen2-presale-bg.mp4'
  const posterSrc = '/images/owltopia-gen2-presale-poster.jpg'

  const inner = (
    <OwlCenterShell>
      {adminTradingWarn ? (
        <aside className="mb-6 border border-[#FF9C9C]/40 bg-[#FF9C9C]/10 px-4 py-3 font-mono text-xs leading-relaxed text-[#FFD6D6]">
          Admin notice: trading activation is on but Magic Eden / Tensor URLs are missing in launch settings. Paste indexed marketplace
          links in <Link href="/admin/owl-center">Owl Center admin</Link>.
        </aside>
      ) : null}

      <nav aria-label="Breadcrumb" className="mb-8 font-mono text-xs text-[#5C6773]">
        <Link href="/" className="touch-manipulation hover:text-[#00FF9C]">
          Home
        </Link>
        <span className="mx-2">/</span>
        <Link href="/owl-center" className="touch-manipulation hover:text-[#00FF9C]">
          Owl Center
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[#C5D0D8]">{launch.name}</span>
      </nav>

      <header className="mb-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#00C97A]">
            Powered by Owl Center · Solana-native launch infrastructure
          </p>
          <h1 className="mt-3 font-display text-4xl text-[#F4FBF8] md:text-5xl">{launch.name}</h1>
          <p className="mt-3 max-w-xl text-sm text-[#9BA8B4]">{launch.description}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <StatusBadge status={launch.status} />
            <PhaseBadge phase={launch.active_phase} pulse={launch.active_phase === 'PRESALE'} />
            {isDevnetMintEnabled() ? (
              <span className="border border-[#FFD769]/50 bg-[#FFD769]/15 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#FFD769]">
                DEVNET TEST MINT
              </span>
            ) : null}
          </div>
          {isDevnetMintEnabled() ? (
            <p className="mt-4 max-w-xl border border-[#FFD769]/35 bg-[#FFD769]/10 px-4 py-3 text-sm text-[#FFD769]">
              This is a devnet Candy Machine test. No mainnet NFT will be minted.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/gen2-presale"
              className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-5 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10"
            >
              Buy presale spots
            </Link>
            <Link
              href="/owl-center"
              className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#1A222B] px-5 text-sm font-semibold text-[#9BA8B4] hover:border-[#00FF9C]/25 hover:text-[#F4FBF8]"
            >
              Owl Center hub
            </Link>
          </div>
        </div>
        <div className="relative border border-[#1A222B] bg-[#10161C]/80 p-4">
          <div className="relative mx-auto aspect-square max-h-[220px] w-full">
            <Image
              src={launch.image_url?.startsWith('/') ? launch.image_url : '/images/gen2-logo-mark.png'}
              alt={`${launch.name} mark`}
              fill
              className="object-contain"
              sizes="280px"
              priority
            />
          </div>
          <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-widest text-[#5C6773]">
            Owltopia Gen2 — Token Metadata · CM V3
          </p>
        </div>
      </header>

      <section className="mb-10 grid gap-4 md:grid-cols-4">
        <StatPanel label="Minted" value={`${supply.minted} / ${supply.total}`} hint="On-chain primary tracked via Owl Center" />
        <StatPanel label="Remaining" value={supply.remaining} />
        <StatPanel
          label="Launch deadline"
          value={launch.launch_deadline_at ? new Date(launch.launch_deadline_at).toLocaleDateString() : '—'}
          hint="June 27, 2026 target"
        />
        <StatPanel label="Paused" value={launch.is_paused ? 'YES' : 'NO'} hint="Admin kill-switch" />
      </section>

      <CommandCard label="supply_allocation.sys" className="mb-10">
        <SupplyProgress minted={supply.minted} total={supply.total} />
        <div className="mt-6 grid gap-3 font-mono text-xs text-[#9BA8B4] sm:grid-cols-2">
          <p>
            Airdrop cap <span className="text-[#00FF9C]">{phases.airdrop}</span>
          </p>
          <p>
            Presale cap <span className="text-[#00FF9C]">{phases.presale}</span>{' '}
            <span className="text-[#5C6773]">(@ ${prices_usdc.presale ?? 20} USDC-notional)</span>
          </p>
          <p>
            WL cap <span className="text-[#00FF9C]">{phases.whitelist}</span>{' '}
            <span className="text-[#5C6773]">(@ ${prices_usdc.whitelist ?? 30})</span>
          </p>
          <p>
            Public cap <span className="text-[#00FF9C]">{phases.public}</span>{' '}
            <span className="text-[#5C6773]">(@ ${prices_usdc.public ?? 40})</span>
          </p>
        </div>
      </CommandCard>

      <CommandCard label="phase_timeline.sys" className="mb-10">
        <LaunchPhaseTimeline active={launch.active_phase} />
      </CommandCard>

      <section className="mb-10">
        <Gen2MintPanel launch={launch} remaining={supply.remaining} onRefresh={() => void load()} />
      </section>

      {showSecondaryLinks ? (
        <CommandCard label="MARKETPLACE_INDEXING · SECONDARY" className="mb-10">
          <p className="mb-4 text-xs text-[#9BA8B4]">
            Marketplace pages are not uploaded directly from Owl Center in V1 — collections index from on-chain metadata. These buttons
            appear only after admins activate trading links.
          </p>
          <div className="flex flex-wrap gap-3">
            {meHref ? (
              <a
                href={meHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-5 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10"
              >
                Magic Eden
              </a>
            ) : null}
            {teHref ? (
              <a
                href={teHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[44px] touch-manipulation items-center border border-[#00FF9C]/35 px-5 text-sm font-bold text-[#00FF9C] hover:bg-[#00FF9C]/10"
              >
                Tensor
              </a>
            ) : null}
          </div>
        </CommandCard>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <CommandCard label="activity_terminal.sys">
          <ActivityLog lines={terminal} />
        </CommandCard>
        <CommandCard label="protocol_notes.sys">
          <ul className="space-y-2 font-mono text-xs text-[#9BA8B4]">
            <li>• Presale redemption (Option A): CM mint should be fee-only; credits debited server-side after tx verify.</li>
            <li>• WL allowlist: DB table placeholder — production should use guard proofs / Merkle (TODO).</li>
            <li>• Public payment guard enforced by Candy Machine + on-chain SOL transfer — verify amounts before prod.</li>
            <li>• Magic Eden / Tensor links are Solana-only — no EVM or chain switching.</li>
          </ul>
        </CommandCard>
      </section>
    </OwlCenterShell>
  )

  return (
    <HeroVideoBackground videoSrc={videoSrc} posterSrc={posterSrc} className="text-[#E8EEF2]" overlayClassName="bg-black/70">
      {inner}
    </HeroVideoBackground>
  )
}
