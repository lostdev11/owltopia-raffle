'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { HeroVideoBackground } from '@/components/HeroVideoBackground'
import { Gen2BalanceCard } from '@/components/gen2-presale/Gen2BalanceCard'
import { Gen2ParticipantsCard } from '@/components/gen2-presale/Gen2ParticipantsCard'
import { Gen2ElectricBorder } from '@/components/gen2-presale/Gen2ElectricBorder'
import { Gen2LiveBadge } from '@/components/gen2-presale/Gen2LiveBadge'
import { Gen2PresaleBanner } from '@/components/gen2-presale/Gen2PresaleBanner'
import { Gen2ProgressCard } from '@/components/gen2-presale/Gen2ProgressCard'
import { Gen2PurchaseCard } from '@/components/gen2-presale/Gen2PurchaseCard'
import { Gen2StickyCta } from '@/components/gen2-presale/Gen2StickyCta'
import { useGen2PresaleBalance } from '@/hooks/use-gen2-presale-balance'
import { useGen2PresaleStats } from '@/hooks/use-gen2-presale-stats'
import { useWallet } from '@solana/wallet-adapter-react'
import { getGen2PresaleBalanceIssues, getGen2PresaleStatsIssues } from '@/lib/gen2-presale/presale-sanity'
import type { Gen2PresaleBalance, Gen2PresaleStats } from '@/lib/gen2-presale/types'
import { cn } from '@/lib/utils'

function Gen2Countdown() {
  const iso = process.env.NEXT_PUBLIC_GEN2_COUNTDOWN_ISO?.trim()
  const targetMs = iso ? new Date(iso).getTime() : NaN
  const valid = Number.isFinite(targetMs)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!valid) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [valid])

  const label = useMemo(() => {
    if (!valid) return 'Mint window: to be announced'
    const diff = Math.max(0, targetMs - now)
    const s = Math.floor(diff / 1000) % 60
    const m = Math.floor(diff / 60000) % 60
    const h = Math.floor(diff / 3600000) % 24
    const d = Math.floor(diff / 86400000)
    if (diff <= 0) return 'Live'
    return `${d}d ${h}h ${m}m ${s}s`
  }, [valid, targetMs, now])

  return (
    <div className="rounded-xl border border-[#1F6F54]/50 bg-[#10161C]/90 px-4 py-3 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#A9CBB9]">Countdown</p>
      <p className="mt-1 font-mono text-lg font-bold tabular-nums text-[#00FF9C]">{label}</p>
      {!iso && <p className="mt-1 text-xs text-[#A9CBB9]">Set NEXT_PUBLIC_GEN2_COUNTDOWN_ISO for a live timer.</p>}
    </div>
  )
}

type Gen2PresalePageClientProps = {
  /** SIWS session is gen2 presale admin — show internal note when presale toggle is off */
  showAdminPausedNote?: boolean
}

export function Gen2PresalePageClient({ showAdminPausedNote = false }: Gen2PresalePageClientProps) {
  const { publicKey, connected } = useWallet()
  const wallet = publicKey?.toBase58() ?? null
  const [participantsListKey, setParticipantsListKey] = useState(0)
  const { stats, loading: statsLoading, error: statsError, refresh: refreshStats, applyStatsPatch } =
    useGen2PresaleStats(20_000)
  const { balance, loading: balLoading, refresh: refreshBal, applySnapshot } = useGen2PresaleBalance(wallet)

  const presaleLive = stats?.presale_live === true
  const statsStatusLoading = statsLoading && stats == null
  const spotPriceUsdc =
    stats?.unit_price_usdc ??
    (() => {
      const n = Number(process.env.NEXT_PUBLIC_GEN2_PRESALE_PRICE_USDC)
      return Number.isFinite(n) && n > 0 ? n : 20
    })()

  const onPresalePurchaseSettled = useCallback(
    (result?: {
      balance?: Gen2PresaleBalance
      stats?: Pick<Gen2PresaleStats, 'presale_supply' | 'sold' | 'remaining' | 'percent_sold'>
    }) => {
      if (result?.balance) applySnapshot(result.balance)
      if (result?.stats) applyStatsPatch(result.stats)
      void refreshStats()
      void refreshBal()
      setParticipantsListKey((k) => k + 1)
    },
    [applySnapshot, applyStatsPatch, refreshStats, refreshBal]
  )

  const refreshPresaleData = useCallback(() => {
    void refreshStats()
    void refreshBal()
    setParticipantsListKey((k) => k + 1)
  }, [refreshStats, refreshBal])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshPresaleData()
    }
    const onPageShow = () => refreshPresaleData()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [refreshPresaleData])

  const presaleSanityIssues = useMemo(() => {
    const fromStats = stats ? getGen2PresaleStatsIssues(stats) : []
    const fromBal = balance && connected ? getGen2PresaleBalanceIssues(balance) : []
    return [...fromStats, ...fromBal]
  }, [stats, balance, connected])

  return (
    <HeroVideoBackground
      videoSrc="/videos/owltopia-gen2-presale-bg.mp4"
      posterSrc="/images/owltopia-gen2-presale-poster.jpg"
      className="text-[#EAFBF4]"
    >
      <Gen2PresaleBanner live={stats?.presale_live} statsLoading={statsStatusLoading} />

      {presaleSanityIssues.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pt-4">
          <div
            role="alert"
            className="rounded-xl border border-amber-500/45 bg-amber-950/45 px-4 py-3 text-left text-amber-50 shadow-[0_0_24px_rgba(0,0,0,0.35)]"
          >
            <p className="text-sm font-semibold text-amber-100">Could not verify presale data</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-50/95">
              {presaleSanityIssues.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-10 md:pb-12">
        {/* Hero */}
        <section className="animate-page-enter text-center md:text-left">
          <div className="flex flex-col items-center gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl space-y-4">
              <Gen2LiveBadge live={stats?.presale_live} loading={statsStatusLoading} />
              <h1 className="font-display text-4xl tracking-tight text-[#EAFBF4] sm:text-5xl md:text-6xl">
                Owltopia Gen2 Presale
              </h1>
              <p className="text-lg font-semibold text-[#00FF9C]">1 presale spot = 1 Gen2 mint</p>
              <p className="rounded-xl border border-[#00E58B]/25 bg-[#10161C]/85 px-4 py-3 text-base font-semibold text-[#EAFBF4] shadow-[0_0_32px_rgba(0,0,0,0.35)] ring-1 ring-[#00FF9C]/10 backdrop-blur-md">
                <span className="text-[#00FF9C]">${spotPriceUsdc} dollars in SOL</span> per spot.{' '}
                <span className="text-sm font-normal text-[#A9CBB9]">
                  Amount is calculated on-chain from the live SOL/USD rate on the server.
                </span>
              </p>
              <p className="text-[#A9CBB9] leading-relaxed">
                Secure your Gen2 mint allocation early. Buy presale spots now, then redeem them during the official mint.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="#gen2-purchase"
                  className={cn(
                    'inline-flex min-h-[44px] items-center justify-center rounded-xl border px-6 font-bold touch-manipulation transition',
                    presaleLive
                      ? 'border-[#00FF9C]/45 bg-[#00E58B]/20 text-[#EAFBF4] shadow-[0_0_28px_rgba(0,255,156,0.3)] hover:bg-[#00E58B]/30'
                      : 'border-[#1F6F54] bg-[#10161C] text-[#A9CBB9] hover:border-[#FFD769]/35 hover:text-[#EAFBF4]'
                  )}
                >
                  {presaleLive ? 'Buy presale spots' : 'Presale details'}{' '}
                  <ChevronRight className="ml-1 h-5 w-5" />
                </Link>
                <Link
                  href="#gen2-about"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#1F6F54] px-6 font-semibold text-[#A9CBB9] touch-manipulation hover:border-[#00E58B]/40 hover:text-[#EAFBF4]"
                >
                  About Gen2
                </Link>
                <Link
                  href="#gen2-how"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#1F6F54] px-6 font-semibold text-[#A9CBB9] touch-manipulation hover:border-[#00E58B]/40 hover:text-[#EAFBF4]"
                >
                  How it works
                </Link>
              </div>
            </div>
            <div className="flex w-full max-w-md flex-col gap-4">
              <Gen2ElectricBorder>
                <div className="relative overflow-hidden bg-[#151D24]/95 p-6 shadow-[0_0_40px_rgba(0,229,139,0.15)]">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(0,255,156,0.12),transparent_50%)]" />
                  <div className="relative aspect-square w-full max-h-[220px] overflow-hidden rounded-xl bg-black ring-1 ring-[#00E58B]/20">
                    <div className="absolute inset-3 sm:inset-4">
                      <div className="relative h-full w-full">
                        <Image
                          src="/images/gen2-logo-mark.png"
                          alt="Owltopia Gen2 logo — neon cube with owl and GEN 2 mark"
                          fill
                          className="object-contain object-center"
                          sizes="(max-width: 768px) 100vw, 448px"
                          priority
                        />
                      </div>
                    </div>
                  </div>
                  <p className="relative mt-3 text-center text-sm text-[#A9CBB9]">Gen2 artwork reveal coming soon</p>
                </div>
              </Gen2ElectricBorder>
              <Gen2Countdown />
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="mt-14 space-y-4 animate-page-enter">
          <h2 className="text-center font-display text-2xl text-[#EAFBF4] md:text-left">Live allocation</h2>
          {stats && stats.presale_live === false && showAdminPausedNote && (
            <p className="text-center text-sm text-[#FFD769] md:text-left">
              Purchasing is paused in admin — numbers below are informational.
            </p>
          )}
          {statsError && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
              {statsError}
            </p>
          )}
          <Gen2ElectricBorder>
            <Gen2ProgressCard stats={stats} loading={statsLoading} className="border-0 shadow-none ring-0" />
          </Gen2ElectricBorder>

          <div id="gen2-participants" className="scroll-mt-28">
            <Gen2ParticipantsCard
              highlightWallet={wallet}
              listRefreshKey={participantsListKey}
              className="mt-8"
            />
          </div>
        </section>

        {/* About Gen2 — supply, mint schedule, tier pricing, utilities */}
        <section id="gen2-about" className="mt-14 scroll-mt-28 animate-page-enter">
          <h2 className="font-display text-3xl text-[#EAFBF4]">About Gen2</h2>
          <Gen2ElectricBorder className="mt-6">
            <div className="rounded-2xl border border-[#00E58B]/25 bg-[#151D24]/95 p-6 shadow-[inset_0_0_40px_rgba(0,229,139,0.06)] md:p-8">
              <dl className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold uppercase tracking-widest text-[#A9CBB9]">Supply</dt>
                  <dd className="mt-1 font-mono text-xl font-bold tabular-nums text-[#EAFBF4]">2,000</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-widest text-[#A9CBB9]">Mint</dt>
                  <dd className="mt-1 text-lg font-semibold text-[#EAFBF4]">June 27, 2026</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-widest text-[#A9CBB9]">Presale</dt>
                  <dd className="mt-1 text-lg font-semibold text-[#00FF9C]">
                    20 USDC <span className="font-normal text-[#A9CBB9]">(in SOL)</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-widest text-[#A9CBB9]">Whitelist</dt>
                  <dd className="mt-1 text-lg font-semibold text-[#EAFBF4]">
                    30 USDC <span className="font-normal text-[#A9CBB9]">(in SOL)</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-widest text-[#A9CBB9]">Public</dt>
                  <dd className="mt-1 text-lg font-semibold text-[#EAFBF4]">
                    40 USDC <span className="font-normal text-[#A9CBB9]">(in SOL)</span>
                  </dd>
                </div>
              </dl>

              <div
                className="my-8 h-px w-full bg-gradient-to-r from-transparent via-[#1F6F54]/80 to-transparent"
                role="separator"
                aria-hidden
              />

              <h3 className="font-display text-xl text-[#EAFBF4]">Gen2 utilities</h3>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[#A9CBB9] sm:text-base">
                <li className="flex gap-3">
                  <span className="mt-1.5 shrink-0 text-[#00FF9C]" aria-hidden>
                    •
                  </span>
                  <span>100% secondary sales revenue share</span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 shrink-0 text-[#00FF9C]" aria-hidden>
                    •
                  </span>
                  <span>
                    20% launchpad revenue share (designed to let projects create and run their own mints)
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 shrink-0 text-[#00FF9C]" aria-hidden>
                    •
                  </span>
                  <span>20% staking platform revenue share (infrastructure for projects on Solana)</span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-1.5 shrink-0 text-[#00FF9C]" aria-hidden>
                    •
                  </span>
                  <span>50% game revenue share</span>
                </li>
              </ul>
            </div>
          </Gen2ElectricBorder>
        </section>

        {/* Purchase + balance */}
        <section className="mt-14 grid gap-8 lg:grid-cols-2">
          <Gen2PurchaseCard
            stats={stats}
            statsLoading={statsLoading}
            presaleLive={presaleLive}
            onPurchased={onPresalePurchaseSettled}
            className="scroll-mt-28 border border-[#00FF9C]/30 bg-[#10161C]/85 shadow-[0_0_52px_rgba(0,255,156,0.16)] backdrop-blur-md"
          />
          <Gen2ElectricBorder>
            <Gen2BalanceCard
              balance={balance}
              loading={balLoading}
              connected={connected}
              onRefresh={refreshPresaleData}
              walletAddress={wallet}
              onRecorded={onPresalePurchaseSettled}
              className="border-0 shadow-none ring-0"
            />
          </Gen2ElectricBorder>
        </section>

        {/* How it works */}
        <section id="gen2-how" className="mt-20 scroll-mt-28 animate-page-enter">
          <h2 className="font-display text-3xl text-[#EAFBF4]">How it works</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {[
              {
                step: '01',
                title: 'Connect wallet',
                body: 'Use the same wallet you will mint with — your Gen2 mint credits are tied to this address.',
              },
              {
                step: '02',
                title: 'Buy presale spots',
                body: 'Pay in SOL at the site-calculated USDC rate. Payment routes to founder wallets in one signed transaction.',
              },
              {
                step: '03',
                title: 'We track your balance',
                body: 'No separate SPL token yet — Owltopia records purchased, gifted, and used mint credits for your wallet.',
              },
              {
                step: '04',
                title: 'Redeem at Gen2 mint',
                body: 'When mint opens, each available credit redeems for one Gen2 mint (details announced with mint).',
              },
            ].map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-[#00E58B]/20 bg-[#151D24]/80 p-6 shadow-inner transition hover:border-[#00FF9C]/35 hover:shadow-[0_0_24px_rgba(0,229,139,0.12)]"
              >
                <p className="font-mono text-xs font-bold text-[#1F6F54]">{item.step}</p>
                <h3 className="mt-2 text-lg font-bold text-[#EAFBF4]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#A9CBB9]">{item.body}</p>
              </div>
            ))}
          </div>
          <ul className="mt-8 space-y-2 text-sm text-[#A9CBB9]">
            <li className="flex gap-2">
              <span className="text-[#00FF9C]">✓</span> No extra token required — credits are tracked by Owltopia.
            </li>
            <li className="flex gap-2">
              <span className="text-[#00FF9C]">✓</span> Your wallet balance is stored securely in our systems.
            </li>
            <li className="flex gap-2">
              <span className="text-[#00FF9C]">✓</span> Each presale spot equals one Gen2 mint when redemption opens.
            </li>
          </ul>
        </section>

        {/* Recent / hype placeholder */}
        <section className="mt-16 rounded-2xl border border-dashed border-[#1F6F54]/60 bg-[#10161C]/60 p-8 text-center animate-page-enter">
          <p className="font-semibold text-[#EAFBF4]">Recent buyers</p>
          <p className="mt-2 text-sm text-[#A9CBB9]">
            A live feed of recent allocations can plug in here (privacy-safe summaries). Reserved for future hype mode.
          </p>
        </section>

        {/* Footer CTA */}
        <section className="mt-16 mb-12 animate-page-enter">
          <Gen2ElectricBorder>
            <div className="bg-[#151D24]/95 p-10 text-center shadow-[inset_0_0_60px_rgba(0,229,139,0.04)]">
              <Gen2LiveBadge className="mx-auto" live={stats?.presale_live} loading={statsStatusLoading} />
              <h2 className="mt-4 font-display text-3xl text-[#EAFBF4]">Ready when you are</h2>
              <p className="mx-auto mt-2 max-w-lg text-[#A9CBB9]">
                {stats?.remaining ?? '—'} spots still available — secure your Gen2 edge before the crowd.
              </p>
              <Link
                href="#gen2-purchase"
                className={cn(
                  'mt-6 inline-flex min-h-[48px] items-center justify-center rounded-xl px-8 font-bold touch-manipulation',
                  presaleLive
                    ? 'border border-[#00FF9C]/45 bg-[#00E58B]/25 text-[#EAFBF4] shadow-[0_0_32px_rgba(0,255,156,0.35)] animate-button-glow-pulse hover:bg-[#00E58B]/40'
                    : 'border border-[#1F6F54] bg-[#10161C] text-[#A9CBB9] hover:border-[#FFD769]/40 hover:text-[#EAFBF4]'
                )}
              >
                {presaleLive ? 'Buy presale spots' : 'View presale details'}
              </Link>
            </div>
          </Gen2ElectricBorder>
        </section>
      </main>

      <Gen2StickyCta presaleLive={presaleLive} />
    </HeroVideoBackground>
  )
}
