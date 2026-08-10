'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { useSendTransactionForWallet } from '@/lib/hooks/useSendTransactionForWallet'
import { WalletConnectButton } from '@/components/WalletConnectButton'
import { PackOpenVideo } from '@/components/packs/PackOpenVideo'
import { PackPrizeReveal } from '@/components/packs/PackPrizeReveal'
import { PackVisual } from '@/components/packs/PackVisual'
import { executePackPurchase, type PackOpenClientResult } from '@/lib/client/execute-pack-purchase'
import { fireMintConfetti, preloadConfetti } from '@/lib/confetti'
import { Gift, Loader2, Ticket } from 'lucide-react'
import { cn } from '@/lib/utils'

type RipPhase = 'idle' | 'paying' | 'video' | 'reveal'

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

export function PacksClient() {
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()
  const sendTransaction = useSendTransactionForWallet()
  const [config, setConfig] = useState<PacksConfig | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ripping, setRipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PackOpenClientResult | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [phase, setPhase] = useState<RipPhase>('idle')
  const pendingResultRef = useRef<PackOpenClientResult | null>(null)
  const videoDoneRef = useRef(false)
  const videoStartedRef = useRef(false)
  const openErrorRef = useRef<string | null>(null)

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
    void load()
    preloadConfetti()
  }, [load])

  useEffect(() => {
    void loadCredits()
  }, [loadCredits])

  const tryReveal = useCallback(() => {
    if (openErrorRef.current) {
      // Wait for the opening clip if it already started (skip/end will clear)
      if (videoStartedRef.current && !videoDoneRef.current) return
      setError(openErrorRef.current)
      setPhase('idle')
      setRipping(false)
      pendingResultRef.current = null
      videoDoneRef.current = false
      videoStartedRef.current = false
      openErrorRef.current = null
      return
    }
    if (!videoDoneRef.current || !pendingResultRef.current) return
    const won = pendingResultRef.current
    pendingResultRef.current = null
    videoDoneRef.current = false
    videoStartedRef.current = false
    setResult(won)
    setPhase('reveal')
    setRipping(false)
    fireMintConfetti()
    void load()
    void loadCredits()
  }, [load, loadCredits])

  function onVideoFinished() {
    videoDoneRef.current = true
    tryReveal()
  }

  async function onRip() {
    if (!publicKey || !sendTransaction) return
    setError(null)
    setResult(null)
    pendingResultRef.current = null
    videoDoneRef.current = false
    videoStartedRef.current = false
    openErrorRef.current = null
    setRipping(true)
    setPhase('paying')
    try {
      const out = await executePackPurchase({
        publicKey,
        connection,
        sendTransaction,
        onPaymentConfirmed: () => {
          // Payment landed — play opening video while prize resolves server-side
          videoStartedRef.current = true
          setPhase('video')
        },
      })
      if (!out.ok) {
        openErrorRef.current = out.error
        tryReveal()
        return
      }
      pendingResultRef.current = out.result
      tryReveal()
    } catch (e) {
      openErrorRef.current = e instanceof Error ? e.message : 'Rip failed'
      tryReveal()
    }
  }

  const paused = config?.vault.paused ?? true
  const price = config?.product.priceSol ?? 0.1
  const showReveal = phase === 'reveal' && result

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden text-[#EAFBF4]">
      <PackOpenVideo active={phase === 'video'} onFinished={onVideoFinished} />

      {/* Full-bleed atmosphere */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[#060b09]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-5%,rgba(0,255,156,0.22),transparent_58%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_95%_15%,rgba(251,191,36,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_35%_at_5%_70%,rgba(0,229,139,0.08),transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
          }}
        />
      </div>

      {/* Hero — one composition */}
      <section className="relative mx-auto flex min-h-[min(100dvh,880px)] max-w-5xl flex-col items-center justify-center px-4 pb-16 pt-10 text-center sm:px-6 sm:pt-14">
        <p
          className="font-display text-[clamp(3.4rem,14vw,7rem)] leading-[0.9] tracking-[0.06em] text-[#EAFBF4] animate-hero-rise"
          style={{ animationDelay: '40ms' }}
        >
          OWL PACKS
        </p>
        <p
          className="mt-4 max-w-md text-base text-[#A9CBB9] animate-hero-rise sm:text-lg"
          style={{ animationDelay: '120ms' }}
        >
          Rip a pack for {price} SOL. Every open wins — $OWL, SOL, or an NFT from the vault.
        </p>

        <div
          className="mt-8 w-full animate-hero-rise"
          style={{ animationDelay: '200ms' }}
        >
          {showReveal ? (
            <PackPrizeReveal
              result={result}
              onRipAgain={() => {
                setResult(null)
                setPhase('idle')
                setError(null)
              }}
            />
          ) : (
            <PackVisual phase={phase === 'video' ? 'paying' : phase} />
          )}
        </div>

        {!showReveal ? (
          <div
            className="mt-8 flex w-full max-w-sm flex-col items-center gap-3 animate-hero-rise"
            style={{ animationDelay: '280ms' }}
          >
            {!connected ? (
              <WalletConnectButton />
            ) : (
              <button
                type="button"
                disabled={ripping || paused || !config?.vault.address}
                onClick={() => void onRip()}
                className={cn(
                  'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl px-6',
                  'bg-[#00FF9C] text-base font-bold uppercase tracking-[0.14em] text-[#062016]',
                  'shadow-[0_0_40px_-8px_rgba(0,255,156,0.65)] transition',
                  'hover:bg-[#7DFFB8] disabled:cursor-not-allowed disabled:opacity-45',
                  !ripping && !paused ? 'animate-button-glow-pulse' : ''
                )}
              >
                {ripping ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    {phase === 'paying'
                      ? 'Confirm payment…'
                      : phase === 'video'
                        ? 'Opening pack…'
                        : 'Ripping…'}
                  </>
                ) : (
                  <>Rip pack · {price} SOL</>
                )}
              </button>
            )}

            {paused && (
              <p className="text-sm text-amber-200/90">
                Packs paused{config?.vault.pauseReason ? `: ${config.vault.pauseReason}` : ''}
              </p>
            )}
            {error && <p className="text-sm text-red-300">{error}</p>}
            {loadError && <p className="text-sm text-red-300">{loadError}</p>}
          </div>
        ) : null}

        <p
          className="mt-8 text-[11px] uppercase tracking-[0.28em] text-[#A9CBB9]/55 animate-hero-rise"
          style={{ animationDelay: '340ms' }}
        >
          60% $OWL · 20% SOL · 20% NFT · ~{((config?.product.rtpBps ?? 8000) / 100).toFixed(0)}% RTP
        </p>
      </section>

      {/* Below-fold: tickets + recent + tiers — one job each */}
      <section className="mx-auto max-w-3xl px-4 pb-10 sm:px-6">
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

      <section className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <div className="border-t border-white/10 pt-10">
          <h2 className="font-display text-3xl tracking-[0.12em] text-[#EAFBF4]">Prize tiers</h2>
          <p className="mt-2 text-sm text-[#A9CBB9]">
            Bottom-heavy weights fund rarer tops. Target EV ≈ {config?.ev.targetEvSol ?? 0.08} SOL per open.
            {config ? ` Vault NFTs ready: ${config.vault.availableNfts}.` : null}
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
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#00FF9C]/85">NFT bands</p>
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
