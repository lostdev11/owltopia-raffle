'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'

import { OwlCenterPresalePurchaseCard } from '@/components/owl-center-presale/OwlCenterPresalePurchaseCard'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { Gen2PresaleSignInPrompt } from '@/components/gen2-presale/Gen2PresaleSignInPrompt'
import { useOwlCenterPresaleBalance } from '@/hooks/use-owl-center-presale-balance'
import { useOwlCenterPresaleStats } from '@/hooks/use-owl-center-presale-stats'
import {
  canPurchaseOwlCenterPresaleSpots,
  isOwlCenterPresaleSoldOut,
} from '@/lib/owl-center-presale/purchase-availability'
import type { OwlCenterPresalePreviewImage, OwlCenterPresaleStats } from '@/lib/owl-center-presale/types'
import { cn } from '@/lib/utils'

function PresaleArtworkCarousel({
  slides,
  primary,
  surface,
}: {
  slides: OwlCenterPresalePreviewImage[]
  primary: string
  surface: string
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const touchStartXRef = useRef<number | null>(null)
  const slideCount = slides.length
  const activeSlide = slides[activeIndex]
  const canCycle = slideCount > 1

  const goToSlide = useCallback(
    (nextIndex: number) => {
      if (slideCount === 0) return
      setActiveIndex(((nextIndex % slideCount) + slideCount) % slideCount)
    },
    [slideCount]
  )

  if (!activeSlide) {
    return (
      <div
        className="flex aspect-square items-center justify-center rounded-2xl border p-8 text-center text-sm"
        style={{ borderColor: `${primary}33`, backgroundColor: surface, color: `${primary}99` }}
      >
        NFT previews coming soon
      </div>
    )
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl border shadow-lg"
      style={{ borderColor: `${primary}44`, backgroundColor: surface }}
      role="region"
      aria-roledescription="carousel"
      aria-label="NFT artwork previews"
    >
      <div
        className="relative aspect-square w-full overflow-hidden bg-black [touch-action:pan-y]"
        onTouchStart={(e) => {
          touchStartXRef.current = e.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(e) => {
          if (!canCycle || touchStartXRef.current == null) return
          const dx = e.changedTouches[0]?.clientX ? e.changedTouches[0].clientX - touchStartXRef.current : 0
          touchStartXRef.current = null
          if (Math.abs(dx) < 40) return
          if (dx < 0) goToSlide(activeIndex + 1)
          else goToSlide(activeIndex - 1)
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={activeSlide.url}
          src={activeSlide.url}
          alt={activeSlide.alt}
          className={cn(
            'absolute inset-0 h-full w-full object-center',
            activeSlide.fit === 'cover' ? 'object-cover' : 'object-contain'
          )}
        />
        {canCycle && (
          <>
            <button
              type="button"
              onClick={() => goToSlide(activeIndex - 1)}
              className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border bg-black/65 text-white backdrop-blur touch-manipulation"
              style={{ borderColor: `${primary}55` }}
              aria-label="Previous artwork"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => goToSlide(activeIndex + 1)}
              className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border bg-black/65 text-white backdrop-blur touch-manipulation"
              style={{ borderColor: `${primary}55` }}
              aria-label="Next artwork"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function LiveBadge({
  live,
  soldOut,
  loading,
  primary,
}: {
  live?: boolean
  soldOut?: boolean
  loading?: boolean
  primary: string
}) {
  if (loading) {
    return (
      <span className="inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest opacity-70">
        Loading…
      </span>
    )
  }
  if (soldOut) {
    return (
      <span className="inline-flex rounded-full border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber-200">
        Sold out
      </span>
    )
  }
  if (live) {
    return (
      <span
        className="inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest"
        style={{ borderColor: `${primary}66`, color: primary, backgroundColor: `${primary}18` }}
      >
        Presale live
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full border border-zinc-600/50 bg-zinc-900/60 px-3 py-1 text-xs font-bold uppercase tracking-widest text-zinc-300">
      Presale paused
    </span>
  )
}

type Props = {
  slug: string
}

export function OwlCenterPresalePageClient({ slug }: Props) {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  const { stats, loading: statsLoading, error: statsError, refresh: refreshStats, applyStatsPatch } =
    useOwlCenterPresaleStats(slug)
  const { balance, error: balError, loading: balLoading, refresh: refreshBal, applySnapshot } =
    useOwlCenterPresaleBalance(slug, wallet)

  const theme = stats?.theme
  const primary = theme?.primary ?? '#00FF9C'
  const accent = theme?.accent ?? '#00E58B'
  const bg = theme?.background ?? '#0B0F12'
  const surface = theme?.surface ?? '#151D24'
  const muted = theme?.muted ?? '#A9CBB9'

  const presaleSoldOut = isOwlCenterPresaleSoldOut(stats)
  const purchasesOpen = canPurchaseOwlCenterPresaleSpots(stats)
  const pct = Math.min(100, Math.max(0, stats?.percent_sold ?? 0))

  const onPurchased = useCallback(
    (result?: {
      balance?: typeof balance
      stats?: Pick<OwlCenterPresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
    }) => {
      if (result?.balance) applySnapshot(result.balance)
      if (result?.stats) applyStatsPatch(result.stats)
      void refreshStats()
      void refreshBal()
    },
    [applySnapshot, applyStatsPatch, refreshBal, refreshStats]
  )

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshStats()
        void refreshBal()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshBal, refreshStats])

  const headline = stats?.headline ?? '1 presale spot = 1 mint credit'
  const slides = useMemo(() => stats?.preview_images ?? [], [stats?.preview_images])

  if (statsError && !stats) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-red-300">Presale unavailable</h1>
        <p className="mt-2 text-zinc-400">{statsError}</p>
        <Link href="/owl-center" className="mt-6 inline-block text-green-400 underline">
          Back to Owl Center
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-[70vh] pb-24" style={{ backgroundColor: bg, color: '#EAFBF4' }}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-40"
        style={{ background: `radial-gradient(ellipse 80% 60% at 50% -20%, ${accent}44, transparent)` }}
        aria-hidden
      />
      <main className="relative mx-auto max-w-6xl px-4 py-10">
        <Link
          href="/owl-center"
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium touch-manipulation"
          style={{ color: muted }}
        >
          <ChevronLeft className="h-4 w-4" /> Owl Center
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:items-start">
          <section>
            <LiveBadge
              live={stats?.presale_live}
              soldOut={presaleSoldOut}
              loading={statsLoading && !stats}
              primary={primary}
            />
            <h1 className="mt-4 font-display text-4xl tracking-tight sm:text-5xl">
              {stats?.display_name ?? slug} Presale
            </h1>
            <p className="mt-2 text-lg font-semibold" style={{ color: primary }}>
              {headline}
            </p>
            {stats?.description && (
              <p className="mt-4 leading-relaxed" style={{ color: muted }}>
                {stats.description}
              </p>
            )}
            <div
              className="mt-6 rounded-2xl border p-5"
              style={{ borderColor: `${primary}33`, backgroundColor: `${surface}cc` }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: muted }}>
                Progress
              </p>
              <p className="mt-1 text-2xl font-black tabular-nums">
                {statsLoading ? '—' : stats?.sold ?? 0}{' '}
                <span className="text-base font-semibold" style={{ color: muted }}>
                  / {stats?.presale_supply ?? '—'} spots
                </span>
              </p>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${accent}, ${primary})` }}
                />
              </div>
              <p className="mt-3 text-sm" style={{ color: muted }}>
                ${stats?.unit_price_usdc ?? 20} USD in SOL per spot
              </p>
            </div>
            <PresaleArtworkCarousel slides={slides} primary={primary} surface={surface} />
          </section>

          <section className="space-y-6">
            <OwlCenterPresalePurchaseCard
              slug={slug}
              stats={stats}
              statsLoading={statsLoading}
              balance={balance}
              balanceLoading={balLoading}
              balanceError={balError}
              onSignedIn={() => void refreshBal()}
              purchasesOpen={purchasesOpen}
              presaleSoldOut={presaleSoldOut}
              onPurchased={onPurchased}
            />

            <div
              className="rounded-2xl border p-6"
              style={{ borderColor: `${primary}33`, backgroundColor: `${surface}cc` }}
            >
              <h2 className="text-lg font-bold">Your credits</h2>
              {!connected ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm" style={{ color: muted }}>
                    Connect your wallet to see presale credits for this community.
                  </p>
                  <WalletConnectButton />
                </div>
              ) : balError ? (
                <Gen2PresaleSignInPrompt
                  className="mt-4"
                  title="Load your credits"
                  message={balError}
                  onSignedIn={() => void refreshBal()}
                />
              ) : (
                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl bg-black/30 p-4 ring-1 ring-white/5">
                    <dt className="text-xs uppercase tracking-wider" style={{ color: muted }}>
                      Available
                    </dt>
                    <dd className="mt-1 text-3xl font-black tabular-nums" style={{ color: primary }}>
                      {balLoading ? '…' : balance?.available_mints ?? 0}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-black/30 p-4 ring-1 ring-white/5">
                    <dt className="text-xs uppercase tracking-wider" style={{ color: muted }}>
                      Purchased
                    </dt>
                    <dd className="mt-1 text-3xl font-black tabular-nums">{balLoading ? '…' : balance?.purchased_mints ?? 0}</dd>
                  </div>
                </dl>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
