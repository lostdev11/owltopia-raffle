'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { PackAnimationPreload } from '@/components/packs/PackAnimationPreload'
import { PackHoverVideo } from '@/components/packs/PackHoverVideo'
import { PackOpeningExperience } from '@/components/packs/PackOpeningExperience'
import { PackPrizeReveal } from '@/components/packs/PackPrizeReveal'
import { executePackPurchase, type PackOpenClientResult } from '@/lib/client/execute-pack-purchase'
import { preloadConfetti } from '@/lib/confetti'
import {
  isPacksLaunchPause,
  packPauseReasonLabel,
  packPublicPauseMessage,
} from '@/lib/packs/admin-copy'
import { usePacksAdminAccess } from '@/lib/packs/use-packs-admin-access'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import { Gen2PresaleSignInPrompt } from '@/components/gen2-presale/Gen2PresaleSignInPrompt'
import {
  Check,
  Gift,
  Loader2,
  Package,
  ShoppingBag,
  ShieldCheck,
  Ticket,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type RipPhase = 'idle' | 'paying' | 'experience' | 'reveal'

type PacksConfig = {
  product: {
    name: string
    priceSol: number
    rtpBps: number
    categoryWeightsBps: { owl: number; sol: number; nft: number }
  }
  odds: {
    owlTiers: { amount: number; weight: number }[]
    solTiers: { amountSol: number; weight: number }[]
    nftBands: { min: number; max: number; weight: number }[]
    owlToTicketRatio: number
  }
  vault: {
    address: string | null
    paused: boolean
    pauseReason: string | null
    availableNfts: number
  }
  ev: { targetEvSol: number; estimatedEvSol: number; estimatedRtpBps: number }
  recentOpens: {
    id: string
    wallet: string
    category: string | null
    prizeLabel: string | null
    freeTicketCredits: number
    completedAt: string | null
  }[]
}

function shortWallet(w: string) {
  return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

function bpsToPercent(bps: number) {
  return `${(bps / 100).toFixed(0)}%`
}

function RedeemCreditsForm({ onDone }: { onDone: () => void }) {
  const [raffleId, setRaffleId] = useState('')
  const [tickets, setTickets] = useState('1')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function redeem() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/packs/credits/redeem', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raffleId: raffleId.trim(),
          tickets: Number(tickets),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Redeem failed')
      setMsg(`Redeemed ${data.tickets} ticket(s)`)
      onDone()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Redeem failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
      <label className="sr-only" htmlFor="packs-raffle-id">
        Raffle UUID
      </label>
      <input
        id="packs-raffle-id"
        className="w-full rounded-lg border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-[#EAFBF4] placeholder:text-[#A9CBB9]/50"
        placeholder="Raffle UUID"
        value={raffleId}
        onChange={(e) => setRaffleId(e.target.value)}
      />
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="packs-ticket-qty">
          Ticket quantity
        </label>
        <input
          id="packs-ticket-qty"
          className="w-20 rounded-lg border border-white/10 bg-black/35 px-3 py-2.5 text-sm text-[#EAFBF4]"
          value={tickets}
          onChange={(e) => setTickets(e.target.value)}
          inputMode="numeric"
        />
        <button
          type="button"
          disabled={busy || !raffleId.trim()}
          onClick={() => void redeem()}
          className="min-h-[44px] flex-1 rounded-lg bg-[#00E58B]/90 px-3 text-sm font-semibold text-[#062016] hover:bg-[#00FF9C] disabled:opacity-40"
        >
          {busy ? 'Redeeming…' : 'Redeem'}
        </button>
      </div>
      {msg && <p className="text-xs text-[#A9CBB9]">{msg}</p>}
    </div>
  )
}

function RarityRow({
  label,
  pct,
  tone,
}: {
  label: string
  pct: string
  tone: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-0">
      <span className={cn('text-sm font-medium', tone)}>{label}</span>
      <span className="font-mono text-sm text-white/80">{pct}</span>
    </div>
  )
}

export function PacksClient({
  initialViewerIsAdmin = false,
  isPublic = false,
}: {
  initialViewerIsAdmin?: boolean
  isPublic?: boolean
}) {
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()
  const sendTransaction = useSendTransactionForWallet()
  const access = usePacksAdminAccess({ initialViewerIsAdmin, isPublic })
  const { signIn, signingIn, error: signInError } = useSiwsSignIn()
  const [config, setConfig] = useState<PacksConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ripping, setRipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PackOpenClientResult | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [phase, setPhase] = useState<RipPhase>('idle')
  const [paymentConfirmed, setPaymentConfirmed] = useState(false)

  const allowed = access.allowed
  const showAdminPreview = access.isAdmin && !isPublic

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/packs')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setConfig(data)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load packs')
    }
  }, [])

  const loadCredits = useCallback(async () => {
    if (!publicKey) {
      setCredits(null)
      return
    }
    try {
      const res = await fetch(`/api/packs/credits?wallet=${publicKey.toBase58()}`)
      const data = await res.json()
      if (res.ok) setCredits(data.freeTicketCredits ?? 0)
    } catch {
      // ignore
    }
  }, [publicKey])

  useEffect(() => {
    if (!allowed) return
    void load()
    preloadConfetti()
  }, [allowed, load])

  useEffect(() => {
    if (!allowed) return
    void loadCredits()
  }, [allowed, loadCredits])

  async function onRip() {
    if (!publicKey || !sendTransaction) return
    setError(null)
    setResult(null)
    setPaymentConfirmed(false)
    setRipping(true)
    setPhase('paying')
    try {
      const out = await executePackPurchase({
        publicKey,
        connection,
        sendTransaction,
        onPaymentConfirmed: () => {
          setPaymentConfirmed(true)
        },
      })
      if (!out.ok) {
        setError(out.error)
        setPhase('idle')
        setRipping(false)
        setPaymentConfirmed(false)
        return
      }
      // Cinematic only after purchase succeeded and reward is resolved
      setResult(out.result)
      setPhase('experience')
      setRipping(false)
      void load()
      void loadCredits()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rip failed')
      setPhase('idle')
      setRipping(false)
      setPaymentConfirmed(false)
    }
  }

  const paused = config?.vault.paused ?? true
  const pauseLabel = packPauseReasonLabel(config?.vault.pauseReason)
  const publicPauseMessage = packPublicPauseMessage(config?.vault.pauseReason)
  const launchPause = config ? isPacksLaunchPause(config.vault.pauseReason) : true
  const price = config?.product.priceSol ?? 0.1
  const showReveal = phase === 'reveal' && !!result
  const showExperience = phase === 'experience' && !!result
  const weights = config?.product.categoryWeightsBps ?? { owl: 6000, sol: 2000, nft: 2000 }
  const packsOpened = config?.recentOpens?.length ?? 0
  const phaseCaption =
    phase === 'paying'
      ? paymentConfirmed
        ? 'Payment confirmed — resolving prize…'
        : 'Confirm in your wallet…'
      : phase === 'experience'
        ? 'Tap Open pack when you are ready'
        : null

  if (access.loading) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-[#A9CBB9]">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    )
  }

  if (!allowed) {
    if (!connected || !publicKey) {
      return (
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center text-[#EAFBF4]">
          <Package className="h-10 w-10 text-[#00FF9C]" aria-hidden />
          <h1 className="font-display text-3xl tracking-wide">Owl Packs</h1>
          <p className="text-sm text-[#A9CBB9]">
            {isPublic
              ? 'Connect a wallet to rip a pack.'
              : 'Admin preview — connect your Owl Vision admin wallet, then sign in.'}
          </p>
          <WalletConnectButton />
          {!isPublic ? (
            <p className="text-xs text-white/40">
              Or open{' '}
              <Link href="/admin" className="text-[#00FF9C] underline-offset-2 hover:underline">
                Admin
              </Link>{' '}
              and Sign in first.
            </p>
          ) : null}
        </div>
      )
    }
    if (access.denied) {
      return (
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center text-[#EAFBF4]">
          <Package className="h-10 w-10 text-[#00FF9C]" aria-hidden />
          <h1 className="font-display text-3xl tracking-wide">Owl Packs</h1>
          <p className="text-sm text-[#A9CBB9]">
            Admin preview only. This connected wallet is not on the Owl Vision admin list.
          </p>
          <p className="text-xs text-white/45">
            Switch to an admin wallet, or sign in below if this wallet is an admin (clears a stale
            session).
          </p>
          <Gen2PresaleSignInPrompt
            title="Sign in to unlock admin preview"
            message="Sign a one-time message (no fee). Your wallet must be in the admins table."
            onSignedIn={() => {
              access.recheck()
            }}
          />
          {signInError ? <p className="text-sm text-red-300">{signInError}</p> : null}
          <button
            type="button"
            disabled={signingIn}
            onClick={() => {
              void signIn({ onSuccess: () => access.recheck() })
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#00FF9C]/40 px-4 text-sm font-semibold text-[#00FF9C] hover:bg-[#00FF9C]/10 disabled:opacity-50"
          >
            {signingIn ? 'Signing…' : 'Retry admin check'}
          </button>
          <Link
            href="/admin"
            className="text-xs text-[#00FF9C]/80 underline-offset-4 hover:underline"
          >
            Open Admin →
          </Link>
        </div>
      )
    }
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center gap-2 px-4 py-16 text-sm text-[#A9CBB9]">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    )
  }

  const buyButtonClass = cn(
    'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl px-6',
    'bg-[#00FF9C] text-sm font-bold uppercase tracking-[0.12em] text-[#062016]',
    'shadow-[0_0_40px_-8px_rgba(0,255,156,0.65)] transition',
    'hover:bg-[#7DFFB8] disabled:cursor-not-allowed disabled:opacity-45'
  )
  const buyButton = paused ? (
    <button type="button" disabled className={buyButtonClass}>
      {launchPause ? 'Coming soon' : 'Temporarily paused'}
    </button>
  ) : !connected ? (
    <WalletConnectButton />
  ) : (
    <button
      type="button"
      disabled={ripping || !config?.vault.address || showReveal || showExperience}
      onClick={() => void onRip()}
      className={cn(
        buyButtonClass,
        !ripping && !showReveal ? 'animate-button-glow-pulse' : ''
      )}
    >
      {ripping ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          {phase === 'paying'
            ? paymentConfirmed
              ? 'Resolving prize…'
              : 'Confirm payment…'
            : 'Buying…'}
        </>
      ) : (
        <>
          <ShoppingBag className="h-5 w-5" aria-hidden />
          Buy pack — {price} SOL
        </>
      )}
    </button>
  )

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden text-[#EAFBF4]">
      <PackAnimationPreload opening={phase === 'paying' || phase === 'experience'} />
      {showExperience && result ? (
        <PackOpeningExperience
          reward={result}
          includeHoverGate
          onComplete={() => {
            setPhase('reveal')
            setPaymentConfirmed(false)
          }}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[#050807]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-5%,rgba(0,255,156,0.18),transparent_58%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_35%_at_85%_40%,rgba(0,229,139,0.08),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
          }}
        />
      </div>

      {/* Hero — mock composition: copy | pack | rarities (stacked on mobile) */}
      <section className="relative mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 sm:pt-10 lg:pb-6">
        {showAdminPreview ? (
          <p className="mb-5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-center text-xs font-medium text-amber-100 sm:text-left">
            Admin-only view — public nav is hidden. Set PACKS_PUBLIC to show /packs to everyone.
          </p>
        ) : access.isAdmin && paused ? (
          <p className="mb-5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-center text-xs font-medium text-amber-100 sm:text-left">
            Public can see this page, but buying is off.{' '}
            <Link href="/admin/packs" className="underline underline-offset-2 hover:text-white">
              Turn packs on in Admin → Packs
            </Link>
            {pauseLabel ? ` (${pauseLabel})` : ''}.
          </p>
        ) : null}

        <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_1.15fr_0.9fr] lg:gap-6">
          {/* Left copy + CTA */}
          <div className="order-2 space-y-5 text-center lg:order-1 lg:text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#00FF9C] animate-hero-rise">
              Premium pack
            </p>
            <h1
              className="font-display text-[clamp(2.2rem,7vw,3.6rem)] leading-[0.95] tracking-[0.02em] text-white animate-hero-rise"
              style={{ animationDelay: '60ms' }}
            >
              Owltopia Pack
              <span className="mt-1 block text-[#00FF9C]">Open Experience</span>
            </h1>
            <p
              className="text-base text-white/60 animate-hero-rise sm:text-lg"
              style={{ animationDelay: '120ms' }}
            >
              Where luck meets logic.
            </p>
            <ul
              className="mx-auto max-w-sm space-y-2.5 text-left text-sm text-white/70 animate-hero-rise lg:mx-0"
              style={{ animationDelay: '160ms' }}
            >
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#00FF9C]" aria-hidden />
                Premium digital collectibles from the vault
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#00FF9C]" aria-hidden />
                Transparent &amp; verifiable opens
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#00FF9C]" aria-hidden />
                Built on Solana — every pack wins
              </li>
            </ul>

            <div
              className="mx-auto flex w-full max-w-sm flex-col gap-2 animate-hero-rise lg:mx-0"
              style={{ animationDelay: '220ms' }}
            >
              {buyButton}
              <p className="inline-flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/40 lg:justify-start">
                <ShieldCheck className="h-3.5 w-3.5 text-[#00FF9C]/70" aria-hidden />
                Secure checkout with Solana
              </p>
              {phaseCaption ? (
                <p className="text-sm text-[#00FF9C]/90">{phaseCaption}</p>
              ) : null}
              {paused && (
                <p className="text-sm text-amber-200/90">{publicPauseMessage}</p>
              )}
              {error && <p className="text-sm text-red-300">{error}</p>}
              {loadError && <p className="text-sm text-red-300">{loadError}</p>}
            </div>
          </div>

          {/* Center pack / reveal */}
          <div
            className="order-1 flex min-h-[340px] flex-col items-center justify-center animate-hero-rise lg:order-2 lg:min-h-[460px]"
            style={{ animationDelay: '80ms' }}
          >
            {showReveal && result ? (
              <PackPrizeReveal
                result={result}
                onRipAgain={() => {
                  setResult(null)
                  setPhase('idle')
                  setError(null)
                  setPaymentConfirmed(false)
                }}
              />
            ) : (
              <PackHoverVideo phase={phase === 'paying' ? 'paying' : 'idle'} />
            )}
          </div>

          {/* Right rarities panel */}
          <aside
            className="order-3 w-full max-w-sm justify-self-center animate-hero-rise lg:max-w-none lg:justify-self-stretch"
            style={{ animationDelay: '140ms' }}
          >
            <div className="rounded-2xl border border-[#00FF9C]/20 bg-black/45 p-4 shadow-[0_0_40px_-20px_rgba(0,255,156,0.35)] backdrop-blur-sm sm:p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#00FF9C]">
                Possible prizes
              </p>
              <div className="mt-3">
                <RarityRow label="$OWL" pct={bpsToPercent(weights.owl)} tone="text-emerald-200" />
                <RarityRow label="SOL" pct={bpsToPercent(weights.sol)} tone="text-sky-200" />
                <RarityRow label="NFT" pct={bpsToPercent(weights.nft)} tone="text-amber-200" />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-white/45">
                Every open wins · prizes are worth about {bpsToPercent(config?.product.rtpBps ?? 8000)}{' '}
                of the pack price on average · prize NFTs ready: {config?.vault.availableNfts ?? 0}
              </p>
              <a
                href="#prize-tiers"
                className="mt-4 inline-flex min-h-[44px] items-center text-xs font-semibold uppercase tracking-[0.2em] text-[#00FF9C] hover:text-[#7DFFB8]"
              >
                View odds →
              </a>
            </div>
          </aside>
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-y border-[#00FF9C]/15 bg-black/50">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-5 sm:grid-cols-3 sm:px-6 sm:py-6">
          <div className="text-center sm:text-left">
            <p className="text-[10px] uppercase tracking-[0.28em] text-white/40">Recent opens shown</p>
            <p className="mt-1 font-display text-2xl tracking-wide text-[#00FF9C]">{packsOpened}</p>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-[10px] uppercase tracking-[0.28em] text-white/40">Pack price</p>
            <p className="mt-1 font-display text-2xl tracking-wide text-white">{price} SOL</p>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-[10px] uppercase tracking-[0.28em] text-white/40">Typical prize</p>
            <p className="mt-1 font-display text-2xl tracking-wide text-white">
              ≈{config?.ev.targetEvSol ?? 0.08} SOL
            </p>
          </div>
        </div>
      </section>

      {/* Below-fold */}
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="border-t border-white/10 pt-10">
          <h2 className="font-display text-3xl tracking-[0.12em] text-[#EAFBF4]">Your free tickets</h2>
          <p className="mt-2 max-w-lg text-sm text-[#A9CBB9]">
            OWL wins credit free raffle tickets. Sign in with your wallet to redeem on an active raffle.
          </p>
          <p className="mt-4 font-display text-5xl tracking-wide text-amber-200">
            {credits == null ? '—' : credits}
          </p>
          {connected && credits != null && credits > 0 ? (
            <RedeemCreditsForm onDone={() => void loadCredits()} />
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
        <div className="border-t border-white/10 pt-10">
          <h2 className="flex items-center gap-2 font-display text-3xl tracking-[0.12em] text-[#EAFBF4]">
            <Gift className="h-6 w-6 text-[#00FF9C]" aria-hidden />
            Recent opens
          </h2>
          <ul className="mt-5 divide-y divide-white/8">
            {(config?.recentOpens ?? []).length === 0 && (
              <li className="py-6 text-sm text-[#A9CBB9]/60">No opens yet — be the first to rip.</li>
            )}
            {(config?.recentOpens ?? []).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-3.5 text-sm">
                <div className="min-w-0">
                  <span className="text-[#A9CBB9]/70">{shortWallet(o.wallet)}</span>
                  <span className="mx-2 text-white/20">·</span>
                  <span className="text-[#EAFBF4]">{o.prizeLabel}</span>
                  {o.freeTicketCredits > 0 ? (
                    <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-[#00FF9C]/80">
                      <Ticket className="h-3 w-3" aria-hidden />+{o.freeTicketCredits}
                    </span>
                  ) : null}
                </div>
                <Link
                  href={`/packs/verify/${o.id}`}
                  className="shrink-0 text-xs text-[#00FF9C]/75 hover:text-[#00FF9C]"
                >
                  Verify
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="prize-tiers" className="mx-auto max-w-3xl scroll-mt-24 px-4 pb-16 sm:px-6">
        <div className="border-t border-white/10 pt-10">
          <h2 className="font-display text-3xl tracking-[0.12em] text-[#EAFBF4]">Prize tiers</h2>
          <p className="mt-2 text-sm text-[#A9CBB9]">
            Common prizes show up more often. Typical prize is about{' '}
            {config?.ev.targetEvSol ?? 0.08} SOL per open.
            {config ? ` Prize NFTs ready: ${config.vault.availableNfts}.` : null}
          </p>
          <div className="mt-6 grid gap-8 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#00FF9C]/85">$OWL</p>
              <ul className="mt-2 space-y-1 text-sm text-[#A9CBB9]">
                {(config?.odds.owlTiers ?? []).map((t) => (
                  <li key={t.amount}>
                    {t.amount} OWL <span className="text-white/30">w{t.weight}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#00FF9C]/85">SOL</p>
              <ul className="mt-2 space-y-1 text-sm text-[#A9CBB9]">
                {(config?.odds.solTiers ?? []).map((t) => (
                  <li key={t.amountSol}>
                    {t.amountSol} SOL <span className="text-white/30">w{t.weight}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#00FF9C]/85">
                NFT bands
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[#A9CBB9]">
                {(config?.odds.nftBands ?? []).map((b) => (
                  <li key={`${b.min}-${b.max}`}>
                    {b.min}–{b.max} SOL <span className="text-white/30">w{b.weight}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
