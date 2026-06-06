'use client'



import { useCallback, useEffect, useState } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'

import Image from 'next/image'

import Link from 'next/link'



import { HeroVideoBackground } from '@/components/HeroVideoBackground'

import { ActivityLog } from '@/components/owl-center/ActivityLog'

import { CommandCard } from '@/components/owl-center/CommandCard'

import { Gen2MintCheckCard } from '@/components/owl-center/Gen2MintCheckCard'
import { Gen2WlStatusCard } from '@/components/owl-center/Gen2WlStatusCard'

import { OwlCenterLinkedWalletsSection } from '@/components/owl-center/OwlCenterLinkedWalletsSection'

import { Gen2MintPanel } from '@/components/owl-center/Gen2MintPanel'

import { MintAllocationBar } from '@/components/owl-center/MintAllocationBar'

import { LaunchPhaseTimeline } from '@/components/owl-center/LaunchPhaseTimeline'
import { MintCountdown } from '@/components/owl-center/MintCountdown'
import { formatPhasePriceSolOrFree } from '@/lib/owl-center/format-phase-price-sol'
import { formatMintDate, getMintCountdownInfo } from '@/lib/owl-center/phase-schedule'

import { OwlCenterSectionNav } from '@/components/owl-center/OwlCenterSectionNav'

import { OwlCenterShell } from '@/components/owl-center/OwlCenterShell'

import { PhaseBadge } from '@/components/owl-center/PhaseBadge'

import { StatPanel } from '@/components/owl-center/StatPanel'

import { StatusBadge } from '@/components/owl-center/StatusBadge'

import { SupplyProgress } from '@/components/owl-center/SupplyProgress'

import { useGen2MintCheck } from '@/hooks/use-gen2-mint-check'

import { OWL_CENTER_GEN2_SECTIONS } from '@/lib/owl-center/nav'

import type { OwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { MintTerminalLine, OwlCenterLaunchPublic, OwlCenterPhase } from '@/lib/owl-center/types'

import { isDevnetMintEnabled } from '@/lib/solana/network'

import { cn } from '@/lib/utils'



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
  prices_lamports: { presale: string | null; whitelist: string | null; public: string | null }

  presale_pool?: {

    mint_cap: number

    credits_issued: number

    credits_overshoot: number

    presale_mints_recorded: number

    presale_mints_remaining: number

    overage_supply: number

    overage_mints_recorded: number

    overage_mints_remaining: number

  }

  presale_sold_out?: boolean

  mint_controls?: OwlCenterMintControls

  terminal: MintTerminalLine[]

}



function SectionHeading({ id, title, hint }: { id: string; title: string; hint?: string }) {

  return (

    <div id={id} className="scroll-mt-28 md:scroll-mt-24">

      <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#5C6773]">{title}</h2>

      {hint ? <p className="mt-2 max-w-2xl text-sm text-[#9BA8B4]">{hint}</p> : null}

    </div>

  )

}



function supplyPhaseRowClass(phase: OwlCenterPhase, userMintPhase: OwlCenterPhase | null): string {
  if (userMintPhase !== phase) return ''
  return 'rounded border border-[#00FF9C]/45 bg-[#00FF9C]/8 px-2 py-1'
}



export function Gen2MintPageClient() {

  const { publicKey, connected } = useWallet()

  const sessionWallet = publicKey?.toBase58() ?? null

  const [clusterRefresh, setClusterRefresh] = useState(0)

  const { check: mintCheck, loading: mintCheckLoading, error: mintCheckErr, refresh: refreshMintCheck } =
    useGen2MintCheck(sessionWallet, clusterRefresh)

  const [state, setState] = useState<Gen2StateApi | null>(null)

  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [adminTradingWarn, setAdminTradingWarn] = useState(false)

  const userMintPhase =
    connected && mintCheck
      ? (mintCheck.phases.find((p) => p.is_active && p.is_eligible && p.max_mintable > 0)?.phase ?? null)
      : null

  const userReservedPhases =
    connected && mintCheck
      ? mintCheck.phases.filter((p) => !p.is_active && p.reserved_mints > 0).map((p) => p.phase)
      : []

  const wlPhasePreview = mintCheck?.phases.find((p) => p.phase === 'WHITELIST')
  const userHasWlSpots =
    connected &&
    ((wlPhasePreview?.wl?.admin_allocated && (wlPhasePreview.wl.available_mints ?? 0) > 0) ||
      (wlPhasePreview?.reserved_mints ?? 0) > 0)



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



  const { launch, supply, phases, prices_lamports, presale_pool, terminal, mint_controls } = state
  const mintCountdown = getMintCountdownInfo(launch)
  const mintControls: OwlCenterMintControls = mint_controls ?? {
    disabled: launch.is_paused,
    env_kill_switch: false,
    admin_paused: launch.is_paused,
  }

  const presaleSoldOut = state.presale_sold_out === true

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

    <OwlCenterShell className="!pt-6 md:!pt-8">

      {adminTradingWarn ? (

        <aside className="mb-6 border border-[#FF9C9C]/40 bg-[#FF9C9C]/10 px-4 py-3 font-mono text-xs leading-relaxed text-[#FFD6D6]">

          Admin notice: trading activation is on but Magic Eden / Tensor URLs are missing. Update in{' '}

          <Link href="/admin/owl-center" className="text-[#00FF9C] underline">

            Owl Center admin

          </Link>

          .

        </aside>

      ) : null}



      <header className="mb-6 grid gap-6 lg:grid-cols-[1.2fr_0.75fr] lg:items-start">

        <div>

          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.35em] text-[#00C97A]">Owltopia Gen2</p>

          <h1 className="mt-2 font-display text-3xl text-[#F4FBF8] md:text-4xl">{launch.name}</h1>

          <p className="mt-2 max-w-xl text-sm text-[#9BA8B4]">{launch.description}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">

            <StatusBadge status={launch.status} />

            <PhaseBadge

              phase={launch.active_phase}

              pulse={launch.active_phase === 'PRESALE' && !presaleSoldOut}

              presaleSoldOut={presaleSoldOut}

            />

            {isDevnetMintEnabled() ? (

              <span className="border border-[#FFD769]/50 bg-[#FFD769]/15 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#FFD769]">

                Devnet test

              </span>

            ) : null}

          </div>

          {isDevnetMintEnabled() ? (

            <p className="mt-3 max-w-xl border border-[#FFD769]/35 bg-[#FFD769]/10 px-3 py-2 text-xs text-[#FFD769]">

              Devnet Candy Machine test — no mainnet NFT is minted.

            </p>

          ) : null}

          <p className="mt-3 max-w-xl text-xs text-[#5C6773]">
            {userHasWlSpots
              ? 'You have WL spots — jump to Whitelist below. Mint from Overview when WL is live.'
              : presaleSoldOut
                ? 'Presale is sold out. Check Whitelist or Allocation for reserved spots, then mint when your phase is live.'
                : 'Use Whitelist for WL spots, Allocation for all phases, then mint when your phase is active.'}
          </p>

        </div>

        <div className="relative border border-[#1A222B] bg-[#10161C]/80 p-3">

          <div className="relative mx-auto aspect-square max-h-[180px] w-full">

            <Image

              src={launch.image_url?.startsWith('/') ? launch.image_url : '/images/gen2-logo-mark.png'}

              alt={`${launch.name} mark`}

              fill

              className="object-contain"

              sizes="240px"

              priority

            />

          </div>

        </div>

      </header>



      <OwlCenterSectionNav sections={OWL_CENTER_GEN2_SECTIONS} />



      <section className="mb-12 space-y-6">

        <SectionHeading

          id="overview"

          title="Overview"

          hint="Supply, phase order, and global presale redemption progress."

        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

          <StatPanel label="Minted" value={`${supply.minted} / ${supply.total}`} />

          <StatPanel label="Remaining" value={supply.remaining} />

          <StatPanel

            label="Mint opens"

            value={formatMintDate(launch.launch_deadline_at)}

          />

          <StatPanel label="Paused" value={launch.is_paused ? 'YES' : 'NO'} />

        </div>



        <CommandCard label="supply_and_phases">

          {mintCountdown ? (
            <div className="mb-6">
              <MintCountdown launch={launch} initial={mintCountdown} />
            </div>
          ) : null}

          <SupplyProgress minted={supply.minted} total={supply.total} />

          <div className="mt-6 grid gap-3 font-mono text-xs text-[#9BA8B4] sm:grid-cols-2">

            <p className={cn(supplyPhaseRowClass('AIRDROP', userMintPhase))}>

              GEN1 <span className="text-[#00FF9C]">{phases.airdrop}</span> <span className="text-[#5C6773]">· free</span>

              {userMintPhase === 'AIRDROP' ? (
                <span className="ml-1 text-[#00FF9C]">· your mint</span>
              ) : null}

            </p>

            <p className={cn(supplyPhaseRowClass('PRESALE', userMintPhase))}>

              Presale <span className="text-[#00FF9C]">{phases.presale}</span>{' '}

              <span className="text-[#5C6773]">· free · prepaid buyers</span>

              {userMintPhase === 'PRESALE' ? (
                <span className="ml-1 text-[#00FF9C]">· your mint</span>
              ) : null}

            </p>

            <p className={cn(supplyPhaseRowClass('WHITELIST', userMintPhase))}>

              WL <span className="text-[#00FF9C]">{phases.whitelist}</span>{' '}

              <span className="text-[#5C6773]">· {formatPhasePriceSolOrFree(prices_lamports?.whitelist)} · FCFS</span>

              {userMintPhase === 'WHITELIST' ? (
                <span className="ml-1 text-[#00FF9C]">· your mint</span>
              ) : null}

            </p>

            <p className={cn(supplyPhaseRowClass('PUBLIC', userMintPhase))}>

              Public <span className="text-[#00FF9C]">{phases.public}</span>{' '}

              <span className="text-[#5C6773]">· {formatPhasePriceSolOrFree(prices_lamports?.public)}</span>

              {userMintPhase === 'PUBLIC' ? (
                <span className="ml-1 text-[#00FF9C]">· your mint</span>
              ) : null}

            </p>

          </div>

          <div className="mt-6 border-t border-[#1A222B] pt-6">

            <LaunchPhaseTimeline
              active={launch.active_phase}
              launch={launch}
              userMintPhase={userMintPhase}
              userReservedPhases={userReservedPhases}
            />

          </div>

          {presale_pool ? (

            <div className="mt-6 border-t border-[#1A222B] pt-6">

              <MintAllocationBar

                label="Presale mints redeemed (657 cap)"

                minted={presale_pool.presale_mints_recorded}

                total={presale_pool.mint_cap}

                hint={

                  presale_pool.credits_overshoot > 0

                    ? `${presale_pool.credits_issued} credits · ${presale_pool.credits_overshoot} in Presale+13`

                    : `${presale_pool.credits_issued} presale credits issued`

                }

              />

            </div>

          ) : null}

          <div id="mint" className="scroll-mt-28 md:scroll-mt-24">
            <Gen2MintPanel
              launch={launch}
              remaining={supply.remaining}
              presaleSoldOut={presaleSoldOut}
              mintControls={mintControls}
              onRefresh={() => void load()}
              embedded
            />
          </div>

        </CommandCard>



        {showSecondaryLinks ? (

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

        ) : null}

      </section>



      <section className="mb-12 space-y-4">
        <SectionHeading
          id="whitelist"
          title="Whitelist"
          hint="Your WL mint spots — assigned by admins, FCFS when the phase opens. This is the quick view; full phase breakdown is under Allocation."
        />
        <Gen2WlStatusCard
          check={mintCheck}
          loading={mintCheckLoading}
          activePhase={launch.active_phase}
          wlSupply={phases.whitelist}
          wlPriceLamports={prices_lamports?.whitelist ?? null}
          onRefresh={refreshMintCheck}
        />
      </section>

      <section className="mb-12 space-y-4">

        <SectionHeading

          id="wallets"

          title="Linked wallets"

          hint="Paid from more than one wallet? Link them here so Allocation shows all presale credits. Mint from each wallet in your app."

        />

        <OwlCenterLinkedWalletsSection

          connected={connected}

          sessionWallet={sessionWallet}

          onClusterChange={() => {

            setClusterRefresh((n) => n + 1)

            void load()

          }}

        />

      </section>



      <section className="mb-12 space-y-4">

        <SectionHeading

          id="allocation"

          title="Your allocation"

          hint="Full breakdown for every phase. For WL only, use the Whitelist section above."

        />

        <Gen2MintCheckCard
          check={mintCheck}
          loading={mintCheckLoading}
          err={mintCheckErr}
          onRefresh={refreshMintCheck}
        />

      </section>



      <section className="mb-6 space-y-4">

        <SectionHeading id="activity" title="Activity" hint="Recent mints recorded by Owl Center." />

        <CommandCard label="activity_terminal">

          <ActivityLog lines={terminal} />

        </CommandCard>

        <details className="border border-[#1A222B] bg-[#0B0F14] px-4 py-3">

          <summary className="cursor-pointer touch-manipulation font-mono text-[10px] font-bold uppercase tracking-widest text-[#5C6773]">

            Technical notes

          </summary>

          <ul className="mt-3 space-y-2 font-mono text-xs text-[#9BA8B4]">

            <li>• Presale redemption: fee-only CM mint; credits debited server-side after tx verify.</li>

            <li>• WL: per-wallet allocations in DB; global 800 cap enforced at confirm.</li>

            <li>• Marketplace links appear after admin trading activation.</li>

          </ul>

        </details>

      </section>

    </OwlCenterShell>

  )



  return (

    <HeroVideoBackground videoSrc={videoSrc} posterSrc={posterSrc} className="text-[#E8EEF2]" overlayClassName="bg-black/70">

      {inner}

    </HeroVideoBackground>

  )

}


