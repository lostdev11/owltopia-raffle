'use client'



import { useCallback, useEffect, useState } from 'react'

import { useWallet } from '@solana/wallet-adapter-react'

import Image from 'next/image'

import Link from 'next/link'



import { HeroVideoBackground } from '@/components/HeroVideoBackground'

import { ActivityLog } from '@/components/owl-center/ActivityLog'

import { CollectionMintedGrid } from '@/components/owl-center/CollectionMintedGrid'

import { CommandCard } from '@/components/owl-center/CommandCard'

import { Gen2MintCheckCard } from '@/components/owl-center/Gen2MintCheckCard'
import { Gen2MintMilestonesPanel } from '@/components/owl-center/Gen2MintMilestonesPanel'
import { Gen2MintPanel } from '@/components/owl-center/Gen2MintPanel'

import { LaunchPhaseTimeline } from '@/components/owl-center/LaunchPhaseTimeline'
import { MintCountdown } from '@/components/owl-center/MintCountdown'
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

  minted_mints?: string[]

  mint_network?: 'mainnet' | 'devnet'

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



export function Gen2MintPageClient() {

  const { publicKey, connected } = useWallet()

  const sessionWallet = publicKey?.toBase58() ?? null

  const [clusterRefresh] = useState(0)

  const { check: mintCheck, loading: mintCheckLoading, error: mintCheckErr, refresh: refreshMintCheck } =
    useGen2MintCheck(sessionWallet, clusterRefresh)

  const [state, setState] = useState<Gen2StateApi | null>(null)

  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [adminTradingWarn, setAdminTradingWarn] = useState(false)

  const [myMints, setMyMints] = useState<string[]>([])
  const [myMintsLoading, setMyMintsLoading] = useState(false)

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

  const loadMyMints = useCallback(async () => {
    if (!connected || !sessionWallet) {
      setMyMints([])
      return
    }
    setMyMintsLoading(true)
    try {
      const res = await fetch('/api/owl-center/gen2/my-mints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: sessionWallet }),
        cache: 'no-store',
      })
      const j = (await res.json()) as { mints?: string[] }
      if (res.ok && Array.isArray(j.mints)) setMyMints(j.mints)
    } catch {
      /* keep prior list on transient error */
    } finally {
      setMyMintsLoading(false)
    }
  }, [connected, sessionWallet])

  useEffect(() => {
    void loadMyMints()
  }, [loadMyMints])



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

      <OwlCenterShell title="Owltopia Gen2" subtitle="Loading…">

        <p className="font-mono text-sm text-[#FF9C9C]">{loadErr ?? 'Loading…'}</p>

      </OwlCenterShell>

    )

  }



  const { launch, supply, terminal, mint_controls } = state
  const mintedMints = state.minted_mints ?? []
  const preferMainnet = state.mint_network ? state.mint_network === 'mainnet' : !isDevnetMintEnabled()
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
              ? 'You have whitelist spots. Mint opens when your phase is live.'
              : presaleSoldOut
                ? 'Presale sold out. Check your spots below.'
                : 'Check your spots below, then mint when your phase is live.'}
          </p>

        </div>

        <div className="relative border border-[#1A222B] bg-[#10161C]/80 p-3">

          <div className="relative mx-auto aspect-square max-h-[180px] w-full">

            <Image

              src="/images/owltopia-gen2-presale-poster.jpg"

              alt={`${launch.name} cover`}

              fill

              className="object-cover"

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

          hint="Supply, mint phases, and your allocation."

        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

          <StatPanel label="Minted" value={`${supply.minted} / ${supply.total}`} />

          <StatPanel
            label="Remaining"
            value={supply.remaining}
            hint="All phases incl. presale, Gen1 & public"
          />

          <StatPanel

            label="Mint opens"

            value={formatMintDate(launch.launch_deadline_at)}

          />

          <StatPanel label="Paused" value={launch.is_paused ? 'YES' : 'NO'} />

        </div>



        <CommandCard label="Supply & phases">

          {mintCountdown ? (
            <div className="mb-6">
              <MintCountdown launch={launch} initial={mintCountdown} />
            </div>
          ) : null}

          <SupplyProgress minted={supply.minted} total={supply.total} />

          <div className="mt-6 border-t border-[#1A222B] pt-6">

            <LaunchPhaseTimeline
              active={launch.active_phase}
              launch={launch}
              userMintPhase={userMintPhase}
              userReservedPhases={userReservedPhases}
            />

          </div>

          <Gen2MintCheckCard
            check={mintCheck}
            loading={mintCheckLoading}
            err={mintCheckErr}
            onRefresh={refreshMintCheck}
            embedded
            collectionRemaining={supply.remaining}
          />

          <div id="mint" className="scroll-mt-28 md:scroll-mt-24">
            <Gen2MintPanel
              launch={launch}
              remaining={supply.remaining}
              presaleSoldOut={presaleSoldOut}
              mintControls={mintControls}
              mintCheckPhases={mintCheck?.phases}
              onRefresh={() => {
                void load()
                void loadMyMints()
                void refreshMintCheck()
              }}
              embedded
            />
          </div>

        </CommandCard>



        <Gen2MintMilestonesPanel mintedCount={supply.minted} />



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
          id="my-minted"
          title="My mints"
          hint="Just the owls this wallet (and any linked wallets) minted — review exactly what you got."
        />

        {!connected ? (
          <CommandCard label="MY MINTS">
            <p className="text-sm leading-relaxed text-[#9BA8B4]">
              Connect your wallet in the site header to see exactly which owls you minted.
            </p>
          </CommandCard>
        ) : myMintsLoading && !myMints.length ? (
          <CommandCard label="MY MINTS">
            <p className="text-sm leading-relaxed text-[#9BA8B4]">Loading your mints…</p>
          </CommandCard>
        ) : myMints.length ? (
          <CollectionMintedGrid
            mints={myMints}
            preferMainnet={preferMainnet}
            label={`MY MINTS // ${myMints.length}`}
            description="Owls you minted in this drop. Just minted? It appears here once confirm-mint records the tx — tap Refresh in the mint console if it's not showing yet."
          />
        ) : (
          <CommandCard label="MY MINTS // 0">
            <p className="text-sm leading-relaxed text-[#9BA8B4]">
              You haven&apos;t minted any owls from this drop yet. After you mint, your owls show up here once the
              transaction is confirmed on-chain.
            </p>
          </CommandCard>
        )}

      </section>



      <section className="mb-12 space-y-4">

        <SectionHeading
          id="minted"
          title="All minted owls"
          hint={
            mintedMints.length
              ? 'Every owl minted from this drop so far. New owls appear here after confirm-mint records the tx.'
              : 'Minted owls will appear here once the first mints are confirmed on-chain.'
          }
        />

        {mintedMints.length ? (
          <CollectionMintedGrid
            mints={mintedMints}
            preferMainnet={preferMainnet}
            label={`ALL MINTS // ${mintedMints.length}`}
            description="Every owl minted from this drop so far (all wallets). New owls appear here after confirm-mint records the tx."
          />
        ) : (
          <CommandCard label="ALL MINTS // 0">
            <p className="text-sm leading-relaxed text-[#9BA8B4]">
              No owls minted yet. Once minting opens and the first transactions confirm, the minted owls will show up
              here.
            </p>
          </CommandCard>
        )}

      </section>



      <section className="mb-6 space-y-4">

        <SectionHeading id="activity" title="Activity" hint="Recent mints." />

        <CommandCard label="Activity">

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

    <HeroVideoBackground
      videoSrc={videoSrc}
      posterSrc={posterSrc}
      className="text-[#E8EEF2]"
      overlayClassName="bg-black/70"
      videoPreload="metadata"
    >

      {inner}

    </HeroVideoBackground>

  )

}


